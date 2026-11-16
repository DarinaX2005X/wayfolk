/**
 * Plays the palette through Web Audio.
 *
 * Every sound is rendered by the pure code in render.ts into a buffer, so what a test
 * measures is what the browser plays. The graph is small and linear:
 *
 *   voice (buffer -> gain -> panner at its source) --\
 *                                                     >--> master -> output
 *   air   (looping buffer -> gain, breathing) -------/
 *
 * Rules (DESIGN "Движение и ограничения", feel.md): silent until the first gesture and
 * while the page is hidden or the app is paused; ±3 % of pitch on every play; three
 * voices plus the air; every voice placed at its source and heard from the head.
 * With `?capture=1` every sound is written to a log with the application time, which
 * the film uses as the backbone of its music.
 */
import type { Vector3 } from '@iwsdk/core';
import { AIR, PALETTE, SOUND_NAMES, degreeOf, type SoundName } from './palette';
import { MASTER_GAIN, MAX_VOICES, PITCH_JITTER, SAMPLE_RATE, airSwing, dbToGain, renderAir, renderSound, voiceGain } from './render';

export type PlayOptions = { at?: Vector3; value?: number; gain?: number; pitch?: number };

export type SoundLogEntry = { t: number; name: SoundName; degree: number; at: [number, number, number] | null };

export type EngineOptions = {
  /** Makes the audio context. Returns null where the platform has no Web Audio. */
  context?: () => BaseAudioContext | null;
  /** Source of the per-play variation, 0…1. */
  random?: () => number;
};

type Voice = { rank: number; endsAt: number; gain: GainNode; exit: AudioNode; source: AudioBufferSourceNode };

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

function defaultContext(): BaseAudioContext | null {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
}

export class SoundEngine {
  private readonly make: () => BaseAudioContext | null;
  private readonly random: () => number;
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private unlocked = false;
  private muted = false;
  private paused = false;
  private hidden = false;
  private readonly samples = new Map<string, Float32Array>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly takeAt = new Map<SoundName, number>();
  private voices: Voice[] = [];
  private warming = false;
  private readonly heard = new Float64Array(6).fill(NaN);
  private air: { src: AudioBufferSourceNode; gain: GainNode; timer: ReturnType<typeof setInterval> | null } | null = null;
  private airWanted = false;
  /** Application time for the log (set by bindFeel to the app clock). */
  clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** The capture log; null unless the page captures. */
  log: SoundLogEntry[] | null = null;

  constructor(o: EngineOptions = {}) {
    this.make = o.context ?? defaultContext;
    this.random = o.random ?? Math.random;
  }

  // ------------------------------------------------------------ state

  /** Call from a user gesture. Until then nothing sounds; calling it again is harmless. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = this.make();
      } catch {
        this.ctx = null;
      }
      if (!this.ctx) return;
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(ctx.destination);
      this.voiceBus = ctx.createGain();
      this.voiceBus.connect(this.master);
    }
    this.unlocked = true;
    this.sync();
    this.warm();
    if (this.airWanted) this.startAir();
  }

  /** True once a gesture has unlocked sound and the context is not held back. */
  get live(): boolean {
    return this.unlocked && this.ctx !== null && !this.paused && !this.hidden;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    const ctx = this.ctx;
    if (ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.015);
    if (!m) this.warm();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** App pause (headset taken off, system menu). Sound stops where it is. */
  suspend(): void {
    this.paused = true;
    this.sync();
  }

  resume(): void {
    this.paused = false;
    this.sync();
  }

  /** The page became hidden or visible. A hidden page never sounds. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.sync();
  }

  private sync(): void {
    const ctx = this.ctx as (BaseAudioContext & { suspend?: () => Promise<void>; resume?: () => Promise<void> }) | null;
    if (!ctx || !this.unlocked) return;
    try {
      const done = this.paused || this.hidden ? ctx.suspend?.() : ctx.resume?.();
      done?.catch(() => undefined);
    } catch {
      // A context that cannot change state keeps playing what it has.
    }
  }

  /** Where the ears are. Called every frame by the app, so it only writes on change. */
  listener(position: Vector3, forward: Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const h = this.heard;
    const vals = [position.x, position.y, position.z, forward.x, forward.y, forward.z];
    if (vals.every((v, i) => Math.abs(h[i] - v) < 1e-3)) return;
    vals.forEach((v, i) => (h[i] = v));
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = h[0];
      l.positionY.value = h[1];
      l.positionZ.value = h[2];
      l.forwardX.value = h[3];
      l.forwardY.value = h[4];
      l.forwardZ.value = h[5];
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(h[0], h[1], h[2]);
      l.setOrientation(h[3], h[4], h[5], 0, 1, 0);
    }
  }

  // ------------------------------------------------------------ buffers

  private render(key: string): Float32Array {
    let data = this.samples.get(key);
    if (data) return data;
    if (key === 'air') data = renderAir(SAMPLE_RATE);
    else {
      const [name, degree, take] = key.split('|');
      data = renderSound(name as SoundName, { degree: Number(degree), take: Number(take) });
    }
    this.samples.set(key, data);
    return data;
  }

  private buffer(key: string): AudioBuffer {
    let buf = this.buffers.get(key);
    if (buf) return buf;
    const data = this.render(key);
    buf = this.ctx!.createBuffer(1, data.length, SAMPLE_RATE);
    buf.getChannelData(0).set(data);
    this.buffers.set(key, buf);
    return buf;
  }

  /** Renders the palette ahead of use, one sound per idle slice. Needs no audio context. */
  warm(): void {
    if (this.warming || this.muted || typeof window === 'undefined') return;
    this.warming = true;
    const keys: string[] = [];
    for (const name of SOUND_NAMES) keys.push(`${name}|0|0`);
    keys.push('air');
    for (let d = 1; d <= 10; d++) keys.push(`tile|${d}|0`);
    for (let d = 1; d <= 4; d++) keys.push(`stake|${d}|0`);
    const idle =
      (window as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void }).requestIdleCallback ??
      ((fn: () => void) => setTimeout(fn, 30));
    const next = (): void => {
      if (this.muted) {
        this.warming = false;
        return;
      }
      let key = keys.shift();
      while (key && this.samples.has(key)) key = keys.shift();
      if (!key) return;
      this.render(key);
      idle(next, { timeout: 500 });
    };
    idle(next, { timeout: 500 });
  }

  // ------------------------------------------------------------ voices

  private release(v: Voice): void {
    this.voices = this.voices.filter((x) => x !== v);
    try {
      v.exit.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  /** Room for a new voice: the one closest to its end among those of the same or lower rank gives way. */
  private claim(rank: number, now: number): boolean {
    for (const v of [...this.voices]) if (v.endsAt <= now) this.release(v);
    if (this.voices.length < MAX_VOICES) return true;
    let victim: Voice | null = null;
    for (const v of this.voices) if (v.rank <= rank && (!victim || v.endsAt < victim.endsAt)) victim = v;
    if (!victim) return false;
    victim.gain.gain.cancelScheduledValues(now);
    victim.gain.gain.setTargetAtTime(0, now, 0.004);
    try {
      victim.source.stop(now + 0.03);
    } catch {
      // Already stopped.
    }
    this.release(victim);
    return true;
  }

  private nextTake(name: SoundName): number {
    const takes = PALETTE[name].takes;
    if (takes <= 1) return 0;
    const prev = this.takeAt.get(name) ?? Math.floor(this.random() * takes);
    const take = (prev + 1 + Math.floor(this.random() * (takes - 1))) % takes;
    this.takeAt.set(name, take);
    return take;
  }

  /**
   * One sound of the palette at its source. `value` is the event's share (the plot laid
   * for a tile and a stamp, the station for a stake), `gain` can only lower a voice.
   */
  play(name: SoundName, opts: PlayOptions = {}): void {
    const patch = PALETTE[name];
    if (!patch) return;
    const degree = patch.pitched ? degreeOf(name, opts.value) : 0;
    if (this.log) {
      const at = opts.at ? ([opts.at.x, opts.at.y, opts.at.z] as [number, number, number]) : null;
      this.log.push({ t: Math.round(this.clock()), name, degree, at });
    }
    const ctx = this.ctx;
    if (!ctx || !this.live || this.muted || !this.voiceBus) return;
    const now = ctx.currentTime;
    if (!this.claim(patch.rank, now)) return;

    const gain = ctx.createGain();
    // The level only ever varies downward, so the voice stays inside its budget.
    gain.gain.value = voiceGain(opts.gain ?? 1) * (0.92 + 0.08 * this.random());
    let exit: AudioNode = gain;
    if (opts.at) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 0.6;
      p.rolloffFactor = 1;
      p.maxDistance = 10;
      if (p.positionX) {
        p.positionX.value = opts.at.x;
        p.positionY.value = opts.at.y;
        p.positionZ.value = opts.at.z;
      } else {
        p.setPosition(opts.at.x, opts.at.y, opts.at.z);
      }
      gain.connect(p);
      exit = p;
    }
    exit.connect(this.voiceBus);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(`${name}|${degree}|${this.nextTake(name)}`);
    src.playbackRate.value = clamp(opts.pitch ?? 1, 0.25, 4) * (1 + (this.random() * 2 - 1) * PITCH_JITTER);
    src.connect(gain);
    src.start(now);
    const voice: Voice = { rank: patch.rank, endsAt: now + src.buffer.duration / src.playbackRate.value, gain, exit, source: src };
    this.voices.push(voice);
    src.onended = () => this.release(voice);
  }

  // ------------------------------------------------------------ air

  /** The air of the Void: on comes in over 2 s, off fades in 0.8 s. Silent until unlocked. */
  ambient(on: boolean): void {
    this.airWanted = on;
    if (on) this.startAir();
    else this.stopAir();
  }

  get ambientOn(): boolean {
    return this.air !== null;
  }

  private startAir(): void {
    const ctx = this.ctx;
    if (!ctx || !this.unlocked || !this.master || this.air) return;
    const src = ctx.createBufferSource();
    src.buffer = this.buffer('air');
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    gain.connect(this.master);
    const now = ctx.currentTime;
    src.start(now, this.random() * (src.buffer.duration - 0.1));
    gain.gain.setTargetAtTime(airSwing(0), now, AIR.fadeInS / 3);
    // The breathing: a slow curve, retargeted twice a second.
    const t0 = now;
    const timer =
      typeof setInterval === 'function'
        ? setInterval(() => {
            if (!this.ctx) return;
            const t = this.ctx.currentTime;
            if (t - t0 < AIR.fadeInS) return;
            gain.gain.setTargetAtTime(airSwing(t - t0), t, 0.25);
          }, 500)
        : null;
    this.air = { src, gain, timer };
  }

  private stopAir(): void {
    const a = this.air;
    const ctx = this.ctx;
    if (!a || !ctx) return;
    this.air = null;
    if (a.timer !== null) clearInterval(a.timer);
    const now = ctx.currentTime;
    a.gain.gain.cancelScheduledValues(now);
    a.gain.gain.setTargetAtTime(0, now, 0.25);
    try {
      a.src.stop(now + 1);
    } catch {
      // Already stopped.
    }
  }

  /** Number of voices sounding now; the air is not counted. */
  get voiceCount(): number {
    const now = this.ctx?.currentTime ?? 0;
    return this.voices.filter((v) => v.endsAt > now).length;
  }

  /** Level of the air at its peak, linear (for the gallery). */
  static airLevel(): number {
    return dbToGain(AIR.db + AIR.swingDb);
  }

  /** Length of a sound in seconds. */
  lengthOf(name: SoundName): number {
    return this.render(`${name}|0|0`).length / SAMPLE_RATE;
  }
}

