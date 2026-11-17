/**
 * A short voice clip for mind.talk (Quest Browser has no speech recognition, so the
 * sound itself goes to a model with audio input). Recording starts when the hand with
 * Pip comes up near the mouth, or on a pinch held for half a second away from any
 * bubble, and stops when the hand goes down or the pinch opens; at most 8 seconds.
 * The microphone is opened on the first clip and kept for the visit.
 */
import { Vector3 } from '@iwsdk/core';
import { sound } from '../../feel/sound';
import type { App } from '../boot/world';
import { registerTest } from '../debug';
import type { Hands, Side } from './hands';
import type { Replies } from './replies';

/** A recorded clip as base64 WAV, 16 kHz mono 16-bit, the format mind.talk takes. */
export async function clipToWav16k(clip: Blob): Promise<string> {
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
  if (!Ctx) throw new Error('no audio context');
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await clip.arrayBuffer());
    const rate = 16000;
    const length = Math.max(1, Math.ceil(decoded.duration * rate));
    const off = new OfflineAudioContext(1, length, rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    return wavBase64(pcm, rate);
  } finally {
    void ctx.close();
  }
}

/** 16-bit PCM WAV of mono samples, as base64. */
export function wavBase64(pcm: Float32Array, rate: number): string {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(bytes.buffer);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) bytes[at + i] = s.charCodeAt(i);
  };
  text(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) {
    const x = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export type Voice = {
  /** Called with each finished clip. */
  onClip(fn: (clip: Blob) => void): () => void;
  /** Whether a clip may be recorded now (a conversation or a live visit wants it). */
  armed: boolean;
  /** Starts a clip by a button (the browser's mic button); `stop` ends and sends it. */
  start(): Promise<void>;
  stop(): void;
  readonly recording: boolean;
};

const NEAR_MOUTH = 0.2;
const AWAY = 0.3;
const MAX_MS = 8000;

export function createVoice(app: App, hands: Hands, replies: Replies, pipSide: () => Side | null): Voice {
  const listeners = new Set<(clip: Blob) => void>();
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let by: 'mouth' | 'pinch' | 'button' | null = null;
  let pinchSince: Record<Side, number> = { left: -1, right: -1 };
  const mouth = new Vector3();

  const begin = async (how: 'mouth' | 'pinch' | 'button'): Promise<void> => {
    if (recorder || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    by = how;
    try {
      stream ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (error) {
      console.warn('[wf] no microphone; replies by touch still work', error);
      by = null;
      return;
    }
    if (!by) return;
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported?.(t));
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const clip = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      recorder = null;
      app.store.listening.value = false;
      if (clip.size > 2000) for (const fn of [...listeners]) fn(clip);
    };
    recorder.start();
    startedAt = app.clock.now();
    app.store.listening.value = true;
    sound.play('ask');
  };

  const end = (): void => {
    by = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      sound.play('select');
    }
  };

  hands.onPinch((side, down) => {
    pinchSince[side] = down ? app.clock.now() : -1;
    if (!down && by === 'pinch') end();
  });

  app.everyFrame((_dt, now) => {
    if (recorder && now - startedAt > MAX_MS) end();
    if (!voice.armed) {
      if (recorder) end();
      return;
    }
    const cam = app.world.camera;
    cam.getWorldPosition(mouth);
    mouth.y -= 0.09;
    const side = pipSide();
    if (side) {
      const h = hands.get(side);
      const d = h.tracked ? h.anchor.position.distanceTo(mouth) : 9;
      if (!recorder && by === null && d < NEAR_MOUTH) void begin('mouth');
      else if (by === 'mouth' && d > AWAY) end();
    }
    for (const s of ['left', 'right'] as const) {
      const t = pinchSince[s];
      if (t > 0 && now - t > 500 && by === null && !recorder && !replies.consumed(s) && hands.get(s).pinching) void begin('pinch');
    }
  });

  const voice: Voice = {
    onClip(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    armed: false,
    start: () => begin('button'),
    stop: () => {
      if (by === 'button' || recorder) end();
    },
    get recording() {
      return recorder !== null;
    },
  };
  // Scenario hook: hand in a synthetic clip as if it had been recorded.
  registerTest('clip', (seconds = 1.2) => {
    const rate = 16000;
    const pcm = new Float32Array(Math.round(rate * seconds));
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.sin((i / rate) * Math.PI * 2 * 220) * 0.2 * Math.sin((i / pcm.length) * Math.PI);
    const bin = atob(wavBase64(pcm, rate));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const clip = new Blob([bytes], { type: 'audio/wav' });
    for (const fn of [...listeners]) fn(clip);
  });
  void pinchSince;
  return voice;
}
