// Spatial sound for life: one AudioContext, HRTF panners at speakers and places, the
// listener following the head, short synthesized effects (wooden knock, arrival sting,
// finish chime, pick-up chirp) and quiet looping place sounds generated in code.
import { Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import type { SoundHandle, SoundKind } from './types';

const tmp = new Vector3();
const fwd = new Vector3();
const up = new Vector3();
const q4 = new Quaternion();

export class LifeAudio {
  /** When the last chirp sounded (audio clock), so chirps stay rare. */
  private lastChirp = -10;
  ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private loops = new Map<SoundKind, AudioBuffer>();
  private nightLevel = 0;
  private ambientVolume = 1;

  constructor(provided?: AudioContext) {
    if (provided) this.attach(provided);
  }

  private attach(ctx: AudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.ambientBus = ctx.createGain();
    this.ambientBus.gain.value = 1;
    this.ambientBus.connect(this.master);
  }

  /** The context, created on first use where Web Audio exists. */
  ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctor) return null;
    try {
      this.attach(new Ctor({ latencyHint: 'interactive' }));
    } catch {
      return null;
    }
    return this.ctx;
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** A positional source at a world point; connect sounds into it. */
  panner(pos?: Vector3, bus: 'main' | 'ambient' = 'main', refDistance = 1): PannerNode | null {
    const ctx = this.ensure();
    if (!ctx || !this.master) return null;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.maxDistance = 60;
    p.rolloffFactor = 1;
    if (pos) setPannerPos(p, pos);
    p.connect(bus === 'ambient' ? this.ambientBus! : this.master);
    return p;
  }

  /** Follow the head every frame. */
  listen(head: Object3D): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    head.getWorldPosition(tmp);
    head.getWorldDirection(fwd).negate(); // cameras look down -Z
    up.set(0, 1, 0).applyQuaternion(head.getWorldQuaternion(q4));
    if (l.positionX) {
      l.positionX.value = tmp.x;
      l.positionY.value = tmp.y;
      l.positionZ.value = tmp.z;
      l.forwardX.value = fwd.x;
      l.forwardY.value = fwd.y;
      l.forwardZ.value = fwd.z;
      l.upX.value = up.x;
      l.upY.value = up.y;
      l.upZ.value = up.z;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(tmp.x, tmp.y, tmp.z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  /** 0 day … 1 deep night: place sounds get quieter. */
  setNight(level: number): void {
    this.nightLevel = level;
    this.applyAmbient();
  }

  setAmbientVolume(v: number): void {
    this.ambientVolume = v;
    this.applyAmbient();
  }

  private applyAmbient(): void {
    if (!this.ctx || !this.ambientBus) return;
    this.ambientBus.gain.setTargetAtTime(this.ambientVolume * (1 - this.nightLevel * 0.55), this.ctx.currentTime, 0.8);
  }

  /** Wooden knock of a settling piece. */
  knock(pos: Vector3, weight = 1): void {
    const ctx = this.ensure();
    const p = this.panner(pos, 'main', 2);
    if (!ctx || !p) return;
    const t = ctx.currentTime + 0.01;
    const body = ctx.createOscillator();
    body.type = 'sine';
    const f = 210 / Math.sqrt(Math.max(0.4, weight)) * (0.92 + Math.random() * 0.16);
    body.frequency.setValueAtTime(f * 1.6, t);
    body.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0, t);
    bg.gain.linearRampToValueAtTime(0.5, t + 0.004);
    bg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    body.connect(bg).connect(p);
    const n = ctx.createBufferSource();
    n.buffer = this.noise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 300;
    bp.Q.value = 2.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.35, t + 0.003);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(bp).connect(ng).connect(p);
    body.start(t);
    body.stop(t + 0.3);
    n.start(t);
    n.stop(t + 0.12);
    setTimeout(() => p.disconnect(), 600);
  }

  /** Little pick-up chirp. */
  chirp(pos: Vector3, pitch = 1): void {
    const ctx = this.ensure();
    // Rare and soft: a chirp by the ear is charming once, tiring the fifth time.
    if (!ctx || ctx.currentTime - this.lastChirp < 2.5) return;
    const p = this.panner(pos, 'main', 1);
    if (!p) return;
    this.lastChirp = ctx.currentTime;
    const t = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(1500 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(2600 * pitch, t + 0.06);
    o.frequency.exponentialRampToValueAtTime(1900 * pitch, t + 0.11);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.04, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + 0.13);
    o.connect(g).connect(p);
    o.start(t);
    o.stop(t + 0.15);
    setTimeout(() => p.disconnect(), 400);
  }

  /**
   * Musical sting: soft bells on a pentatonic chord over a warm pad. 'arrive' rises
   * slowly; 'finish' is a short bright cadence when a house is done.
   */
  sting(pos: Vector3, kind: 'arrive' | 'finish' | 'hello' = 'arrive'): void {
    const ctx = this.ensure();
    const p = this.panner(pos, 'main', 4);
    if (!ctx || !p) return;
    const t0 = ctx.currentTime + 0.02;
    const root = kind === 'finish' ? 523.25 : kind === 'hello' ? 659.25 : 392.0;
    const steps = kind === 'finish' ? [0, 4, 7, 12] : kind === 'hello' ? [0, 7] : [0, 2, 4, 7, 9, 14];
    const gap = kind === 'finish' ? 0.11 : kind === 'hello' ? 0.09 : 0.2;
    steps.forEach((st, i) => {
      const f = root * Math.pow(2, st / 12);
      const t = t0 + i * gap;
      for (const [mult, amp] of [[1, 0.16], [2.01, 0.05], [3.98, 0.02]] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0008, t + (kind === 'arrive' ? 2.6 : 1.4) / mult);
        o.connect(g).connect(p);
        o.start(t);
        o.stop(t + 2.8);
      }
    });
    if (kind === 'arrive') {
      // Pad under the bells.
      for (const f of [root / 2, (root / 2) * 1.5, root * 0.75 * 1.0]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = (Math.random() - 0.5) * 8;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.045, t0 + 1.2);
        g.gain.linearRampToValueAtTime(0, t0 + 4.2);
        o.connect(lp).connect(g).connect(p);
        o.start(t0);
        o.stop(t0 + 4.4);
      }
    }
    setTimeout(() => p.disconnect(), 5000);
  }

  /** A quiet looping place sound at a world point. */
  loop(kind: SoundKind, pos: Vector3, volume = 1): SoundHandle {
    const ctx = this.ensure();
    const p = this.panner(pos, 'ambient', 1.5);
    if (!ctx || !p) return { stop() {}, setVolume() {} };
    const src = ctx.createBufferSource();
    src.buffer = this.loopBuffer(ctx, kind);
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(LOOP_GAIN[kind] * volume, ctx.currentTime, 1.2);
    src.connect(g).connect(p);
    src.start(ctx.currentTime + Math.random() * 0.2, Math.random() * (src.buffer.duration * 0.9));
    let stopped = false;
    return {
      stop() {
        if (stopped) return;
        stopped = true;
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
        setTimeout(() => {
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
          p.disconnect();
        }, 2000);
      },
      setVolume(v: number) {
        g.gain.setTargetAtTime(LOOP_GAIN[kind] * v, ctx.currentTime, 0.5);
      },
    };
  }

  private noiseBuf: AudioBuffer | null = null;
  private noise(ctx: BaseAudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = b;
    return b;
  }

  private loopBuffer(ctx: BaseAudioContext, kind: SoundKind): AudioBuffer {
    const cached = this.loops.get(kind);
    if (cached) return cached;
    const rate = 22050;
    const data = synthLoop(kind, rate);
    const b = ctx.createBuffer(1, data.length, rate);
    b.getChannelData(0).set(data);
    this.loops.set(kind, b);
    return b;
  }
}


export function setPannerPos(p: PannerNode, pos: Vector3): void {
  if (p.positionX) {
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
  } else {
    (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
  }
}

const LOOP_GAIN: Record<SoundKind, number> = {
  waves: 0.5,
  oven: 0.45,
  chimes: 0.35,
  bees: 0.22,
  wind: 0.3,
  stream: 0.3,
  fire: 0.45,
  birds: 0.25,
  night: 0.18,
};

/** Seamless loops synthesised in plain JS (seconds of mono samples at `rate`). */
export function synthLoop(kind: SoundKind, rate: number): Float32Array {
  const seconds = kind === 'chimes' ? 12 : kind === 'birds' ? 10 : 8;
  const n = Math.floor(seconds * rate);
  const out = new Float32Array(n);
  let s = 12345 + kind.length * 977;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const white = (): number => rnd() * 2 - 1;
  const TAU = Math.PI * 2;
  // One-pole low-pass state helpers.
  let lp1 = 0;
  let lp2 = 0;
  let bp = 0;
  let bpv = 0;
  switch (kind) {
    case 'waves':
    case 'wind':
    case 'stream': {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const w = white();
        lp1 += (w - lp1) * (kind === 'waves' ? 0.02 : kind === 'wind' ? 0.05 : 0.25);
        lp2 += (lp1 - lp2) * (kind === 'waves' ? 0.08 : 0.2);
        let amp: number;
        if (kind === 'waves') amp = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(TAU * t * 2 - 1.2), 2.2);
        else if (kind === 'wind') amp = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(TAU * t + 0.4 * Math.sin(TAU * t * 3)));
        else amp = 0.7 + 0.3 * Math.sin(TAU * t * 5);
        let v = kind === 'stream' ? (lp1 - lp2) * 3.2 : lp2 * 6;
        if (kind === 'stream' && rnd() < 0.0009) bpv = 0.5;
        bpv *= 0.9992;
        bp += 0.08;
        if (kind === 'stream') v += Math.sin(bp * (1 + bpv)) * bpv * 0.25;
        out[i] = v * amp;
      }
      break;
    }
    case 'oven':
    case 'fire': {
      let crack = 0;
      for (let i = 0; i < n; i++) {
        const w = white();
        lp1 += (w - lp1) * 0.03;
        if (rnd() < (kind === 'fire' ? 0.0011 : 0.0007)) crack = 0.6 + rnd() * 0.5;
        crack *= 0.985;
        lp2 += (w * crack - lp2) * 0.5;
        out[i] = lp1 * 1.6 + lp2 * 0.8;
      }
      break;
    }
    case 'bees': {
      let ph = 0;
      let drift = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        drift += (white() * 0.5 - drift) * 0.0005;
        const f = 210 + 25 * Math.sin(TAU * t * 3) + drift * 60;
        ph += f / rate;
        const saw = 2 * (ph - Math.floor(ph)) - 1;
        lp1 += (saw - lp1) * 0.25;
        const flutter = 0.6 + 0.4 * Math.sin(TAU * t * 7 + Math.sin(TAU * t * 2) * 2);
        out[i] = lp1 * 0.5 * flutter;
      }
      break;
    }
    case 'chimes':
    case 'birds':
    case 'night': {
      const notes = [0, 2, 4, 7, 9, 12, 14];
      const hits = kind === 'chimes' ? 9 : kind === 'birds' ? 7 : 26;
      for (let h = 0; h < hits; h++) {
        const at = Math.floor(rnd() * n);
        if (kind === 'chimes') {
          const f = 880 * Math.pow(2, notes[Math.floor(rnd() * notes.length)] / 12);
          const len = Math.floor(rate * 2.2);
          for (let k = 0; k < len; k++) {
            const t = k / rate;
            const env = Math.exp(-t * 2.2);
            const v = (Math.sin(TAU * f * t) * 0.6 + Math.sin(TAU * f * 2.76 * t) * 0.25 * Math.exp(-t * 4) + Math.sin(TAU * f * 5.4 * t) * 0.1 * Math.exp(-t * 7)) * env * 0.5;
            out[(at + k) % n] += v;
          }
        } else if (kind === 'birds') {
          const f0 = 2200 + rnd() * 1400;
          const notesN = 2 + Math.floor(rnd() * 4);
          for (let c = 0; c < notesN; c++) {
            const start = at + Math.floor(c * rate * 0.13);
            const len = Math.floor(rate * 0.09);
            let ph = 0;
            for (let k = 0; k < len; k++) {
              const u = k / len;
              const f = f0 * (1 + 0.35 * Math.sin(Math.PI * u));
              ph += f / rate;
              out[(start + k) % n] += Math.sin(TAU * ph) * Math.sin(Math.PI * u) * 0.25;
            }
          }
        } else {
          // crickets: trains of short high pulses
          const f = 4300 + rnd() * 500;
          for (let c = 0; c < 4; c++) {
            const start = at + Math.floor(c * rate * 0.05);
            const len = Math.floor(rate * 0.025);
            for (let k = 0; k < len; k++) {
              const u = k / len;
              out[(start + k) % n] += Math.sin((TAU * f * k) / rate) * Math.sin(Math.PI * u) * 0.12;
            }
          }
        }
      }
      break;
    }
  }
  // Crossfade the seam for noise-based loops.
  const x = Math.floor(rate * 0.25);
  if (kind === 'waves' || kind === 'wind' || kind === 'stream' || kind === 'oven' || kind === 'fire' || kind === 'bees') {
    const head = out.slice(0, x);
    for (let i = 0; i < x; i++) {
      const a = i / x;
      out[i] = head[i] * a + out[n - x + i] * (1 - a);
    }
    const trimmed = out.slice(0, n - x);
    return normalize(trimmed);
  }
  return normalize(out);
}

function normalize(a: Float32Array): Float32Array {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) {
    const k = 0.8 / m;
    for (let i = 0; i < a.length; i++) a[i] *= k;
  }
  return a;
}
