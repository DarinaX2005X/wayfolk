/**
 * Voice notes: push to talk, never an open microphone (Quest speakers would feed the
 * friend's voice back into the mic). While the person holds the talk gesture a short clip
 * records as Opus; on release it goes to the room and plays on the other side from the
 * speaker's avatar, placed in space, with the avatar's mouth moving to its loudness.
 */
import { Vector3, type Camera } from '@iwsdk/core';
import { LIMITS } from './protocol';

export interface VoiceClip {
  audio: Uint8Array;
  mime: string;
  durationMs: number;
}

const MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'];
const MIN_MS = 350;

export function pickMime(): string | null {
  const MR = (globalThis as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR) return null;
  for (const m of MIMES) if (MR.isTypeSupported?.(m)) return m;
  return '';
}

export async function defaultMic(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
}

/** Records one clip at a time; the microphone stays ready until release(). */
export class TalkRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private done: Promise<VoiceClip | null> | null = null;
  /** Called when a clip stops by itself at the length limit. */
  onLimit: ((clip: VoiceClip | null) => void) | null = null;

  constructor(private readonly mic: () => Promise<MediaStream> = defaultMic, private readonly maxMs = LIMITS.voiceSeconds * 1000) {}

  get active(): boolean {
    return this.rec?.state === 'recording';
  }

  /** Starts a clip. False when there is no microphone or the person declined it. */
  async start(): Promise<boolean> {
    if (this.active) return true;
    const mime = pickMime();
    if (mime === null) return false;
    try {
      if (!this.stream || this.stream.getAudioTracks().every((t) => t.readyState === 'ended')) this.stream = await this.mic();
    } catch {
      return false;
    }
    const rec = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24_000 });
    this.rec = rec;
    this.chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.done = new Promise((resolve) => {
      rec.onstop = async () => {
        const durationMs = performance.now() - this.startedAt;
        const type = rec.mimeType || mime || 'audio/webm';
        const blob = new Blob(this.chunks, { type });
        this.chunks = [];
        if (durationMs < MIN_MS || blob.size === 0) return resolve(null);
        const audio = new Uint8Array(await blob.arrayBuffer());
        // Leave room for the frame header.
        if (audio.byteLength > LIMITS.voiceBytes - 96) return resolve(null);
        resolve({ audio, mime: type, durationMs });
      };
    });
    this.startedAt = performance.now();
    rec.start();
    this.limitTimer = setTimeout(() => {
      void this.stop().then((clip) => this.onLimit?.(clip));
    }, this.maxMs);
    return true;
  }

  /** Ends the clip; null when it was too short or failed. */
  async stop(): Promise<VoiceClip | null> {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    const rec = this.rec;
    const done = this.done;
    this.rec = null;
    this.done = null;
    if (!rec || !done) return null;
    if (rec.state !== 'inactive') rec.stop();
    return done;
  }

  cancel(): void {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    this.limitTimer = null;
    const rec = this.rec;
    this.rec = null;
    this.done = null;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
    this.chunks = [];
  }

  /** Lets the microphone go (leaving the room). */
  release(): void {
    this.cancel();
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }
}

export interface VoiceSource {
  /** World position the voice comes from. */
  where(out: Vector3): Vector3;
  /** 0..1 loudness, for the mouth. */
  setLevel(level: number): void;
}

interface Playing {
  source: VoiceSource;
  panner: PannerNode;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  node: AudioBufferSourceNode;
}

/** Plays voice notes from avatars, one at a time per speaker. */
export class VoicePlayer {
  private playing = new Set<Playing>();
  private queues = new Map<VoiceSource, Promise<void>>();
  private readonly v = new Vector3();
  private readonly f = new Vector3();
  private readonly u = new Vector3();

  constructor(private readonly context: () => AudioContext | null) {}

  /** Queues a clip on the speaker; resolves when it has played (or failed to). */
  play(audio: Uint8Array, source: VoiceSource): Promise<void> {
    const before = this.queues.get(source) ?? Promise.resolve();
    const next = before.then(() => this.playNow(audio, source)).catch(() => {});
    this.queues.set(source, next);
    void next.then(() => {
      if (this.queues.get(source) === next) this.queues.delete(source);
    });
    return next;
  }

  private async playNow(audio: Uint8Array, source: VoiceSource): Promise<void> {
    const ctx = this.context();
    if (!ctx) return;
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    const copy = audio.slice().buffer;
    const buffer = await ctx.decodeAudioData(copy);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1.5;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 0.9;
    panner.rolloffFactor = 0.7;
    panner.maxDistance = 40;
    node.connect(gain).connect(analyser).connect(panner).connect(ctx.destination);
    const p: Playing = { source, panner, analyser, data: new Uint8Array(new ArrayBuffer(analyser.fftSize)), node };
    this.place(p);
    this.playing.add(p);
    await new Promise<void>((resolve) => {
      node.onended = () => resolve();
      node.start();
    });
    this.playing.delete(p);
    source.setLevel(0);
    node.disconnect();
    panner.disconnect();
  }

  /** Per frame: the listener follows the camera, voices follow their avatars. */
  update(camera: Camera | undefined): void {
    if (this.playing.size === 0) return;
    const ctx = this.context();
    if (!ctx) return;
    if (camera) {
      camera.updateWorldMatrix(true, false);
      camera.getWorldPosition(this.v);
      this.f.set(0, 0, -1).transformDirection(camera.matrixWorld);
      this.u.set(0, 1, 0).transformDirection(camera.matrixWorld);
      const l = ctx.listener;
      if (l.positionX) {
        const t = ctx.currentTime;
        l.positionX.setTargetAtTime(this.v.x, t, 0.02);
        l.positionY.setTargetAtTime(this.v.y, t, 0.02);
        l.positionZ.setTargetAtTime(this.v.z, t, 0.02);
        l.forwardX.setTargetAtTime(this.f.x, t, 0.02);
        l.forwardY.setTargetAtTime(this.f.y, t, 0.02);
        l.forwardZ.setTargetAtTime(this.f.z, t, 0.02);
        l.upX.setTargetAtTime(this.u.x, t, 0.02);
        l.upY.setTargetAtTime(this.u.y, t, 0.02);
        l.upZ.setTargetAtTime(this.u.z, t, 0.02);
      } else {
        l.setPosition(this.v.x, this.v.y, this.v.z);
        l.setOrientation(this.f.x, this.f.y, this.f.z, this.u.x, this.u.y, this.u.z);
      }
    }
    for (const p of this.playing) {
      this.place(p);
      p.analyser.getByteTimeDomainData(p.data);
      let sum = 0;
      for (let i = 0; i < p.data.length; i++) {
        const x = (p.data[i] - 128) / 128;
        sum += x * x;
      }
      p.source.setLevel(Math.min(1, Math.sqrt(sum / p.data.length) * 4));
    }
  }

  private place(p: Playing): void {
    const at = p.source.where(this.v);
    const ctx = p.panner.context;
    if (p.panner.positionX) {
      p.panner.positionX.setTargetAtTime(at.x, ctx.currentTime, 0.03);
      p.panner.positionY.setTargetAtTime(at.y, ctx.currentTime, 0.03);
      p.panner.positionZ.setTargetAtTime(at.z, ctx.currentTime, 0.03);
    } else {
      p.panner.setPosition(at.x, at.y, at.z);
    }
  }

  stopAll(): void {
    for (const p of this.playing) {
      try {
        p.node.stop();
      } catch {
        /* already ended */
      }
    }
  }
}
