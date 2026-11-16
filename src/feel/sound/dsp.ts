/**
 * Pure signal building blocks: seeded noise, envelopes, biquad bands, sine partials.
 * No AudioContext here, so the same code renders a sound into a Float32Array in a unit
 * test and into an AudioBuffer in the browser. Times are seconds, frequencies are Hz.
 */

const TWO_PI = Math.PI * 2;

/** Deterministic white noise source (mulberry32): the same seed gives the same sound. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value that may move in time: a constant or a function of seconds since layer start. */
export type Sweep = number | ((t: number) => number);

/** Amplitude over time. `span` is how long the layer lasts before it is silent. */
export type Env = { span: number; at(t: number): number };

/** A struck sound: a raised-cosine rise of `attack`, then decay with time constant `tau`. */
export function hit(attack: number, tau: number): Env {
  return {
    span: attack + tau * 7.5,
    at: (t) =>
      t < 0 ? 0 : t < attack ? 0.5 - 0.5 * Math.cos((Math.PI * t) / attack) : Math.exp(-(t - attack) / tau),
  };
}

/** A swish: rises to its peak at the `peakAt` share of `span` and falls back; `sharp` narrows it. */
export function swell(span: number, peakAt: number, sharp = 1): Env {
  const tp = span * peakAt;
  return {
    span,
    at: (t) => {
      if (t <= 0 || t >= span) return 0;
      const x = t < tp ? t / tp : 1 - (t - tp) / (span - tp);
      return Math.pow(0.5 - 0.5 * Math.cos(Math.PI * x), sharp);
    },
  };
}

/** A held sound: rise `attack`, stay at 1, fall over the last `release` of `span`. */
export function plateau(attack: number, span: number, release: number): Env {
  return {
    span,
    at: (t) => {
      if (t <= 0 || t >= span) return 0;
      if (t < attack) return 0.5 - 0.5 * Math.cos((Math.PI * t) / attack);
      if (t > span - release) return 0.5 - 0.5 * Math.cos((Math.PI * (span - t)) / release);
      return 1;
    },
  };
}

/** Any envelope scaled by a second curve, for lobes and tremolo. */
export function shaped(env: Env, by: (t: number) => number): Env {
  return { span: env.span, at: (t) => env.at(t) * by(t) };
}

/** Exponential glide from one frequency to another over `over` seconds, then it stays. */
export function glide(from: number, to: number, over: number): (t: number) => number {
  const r = Math.log(to / from);
  return (t) => from * Math.exp(r * Math.min(1, Math.max(0, t / over)));
}

export type BandType = 'lowpass' | 'highpass' | 'bandpass';

/** One filter stage. `q` is the plain quality factor (0.707 is flat for low and high pass). */
export type Band = { type: BandType; freq: Sweep; q?: number };

export const lp = (freq: Sweep, q = 0.707): Band => ({ type: 'lowpass', freq, q });
export const hp = (freq: Sweep, q = 0.707): Band => ({ type: 'highpass', freq, q });
export const bp = (freq: Sweep, q = 1): Band => ({ type: 'bandpass', freq, q });

/**
 * Paper texture. Smooth noise sounds like wind; paper is a crowd of tiny crackles.
 * `rate` grains per second each open the noise for about `length` seconds, between
 * grains the level falls to `floor` (1 = no texture, 0 = separate crackles only).
 */
export type Grain = { rate: Sweep; length: number; floor: number };

export type Layer =
  | { kind: 'noise'; at: number; gain: number; env: Env; band: Band[]; grain?: Grain }
  | { kind: 'tone'; at: number; gain: number; env: Env; freq: Sweep };

/** How often a moving filter recomputes its coefficients, in samples. */
const COEFF_EVERY = 16;

/** Runs one biquad stage over `x` in place. Coefficients as in the Audio EQ Cookbook. */
export function runBand(x: Float32Array, sr: number, band: Band): void {
  const q = band.q ?? (band.type === 'bandpass' ? 1 : 0.707);
  const moving = typeof band.freq === 'function';
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let a1 = 0;
  let a2 = 0;
  const set = (f: number): void => {
    const w = (TWO_PI * Math.min(Math.max(f, 10), sr * 0.45)) / sr;
    const cs = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    if (band.type === 'lowpass') {
      b0 = (1 - cs) / 2 / a0;
      b1 = (1 - cs) / a0;
      b2 = b0;
    } else if (band.type === 'highpass') {
      b0 = (1 + cs) / 2 / a0;
      b1 = -(1 + cs) / a0;
      b2 = b0;
    } else {
      b0 = alpha / a0;
      b1 = 0;
      b2 = -alpha / a0;
    }
    a1 = (-2 * cs) / a0;
    a2 = (1 - alpha) / a0;
  };
  set(moving ? (band.freq as (t: number) => number)(0) : (band.freq as number));
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    if (moving && i % COEFF_EVERY === 0) set((band.freq as (t: number) => number)(i / sr));
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    x[i] = yi;
  }
}

/** Renders one layer on its own; the caller mixes it in at `layer.at`. */
function renderLayer(layer: Layer, sr: number, seed: number): Float32Array {
  const n = Math.max(1, Math.ceil(layer.env.span * sr));
  const out = new Float32Array(n);
  if (layer.kind === 'tone') {
    const f = layer.freq;
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      out[i] = Math.sin(phase) * layer.env.at(t) * layer.gain;
      phase += (TWO_PI * (typeof f === 'number' ? f : f(t))) / sr;
    }
    return out;
  }
  const rand = rng(seed);
  const g = layer.grain;
  if (g) {
    const keep = Math.exp(-1 / (g.length * sr));
    let open = 0;
    for (let i = 0; i < n; i++) {
      const rate = typeof g.rate === 'number' ? g.rate : g.rate(i / sr);
      if (rand() < rate / sr) {
        const a = 0.35 + 0.65 * rand();
        if (a > open) open = a;
      }
      out[i] = (rand() * 2 - 1) * (g.floor + (1 - g.floor) * open);
      open *= keep;
    }
  } else {
    for (let i = 0; i < n; i++) out[i] = rand() * 2 - 1;
  }
  for (const band of layer.band) runBand(out, sr, band);
  // A narrow band lets through less noise than a wide one. Bring every noise layer to
  // unit RMS before its envelope, so `gain` means loudness whatever the band is.
  let power = 0;
  for (let i = 0; i < n; i++) power += out[i] * out[i];
  const unit = power > 0 ? 1 / Math.sqrt(power / n) : 0;
  for (let i = 0; i < n; i++) out[i] *= layer.env.at(i / sr) * layer.gain * unit;
  return out;
}

/** Length in seconds needed to hold every layer. */
export function layersSpan(layers: readonly Layer[]): number {
  let end = 0;
  for (const l of layers) end = Math.max(end, l.at + l.env.span);
  return end;
}

/** Mixes the layers into one buffer. Every layer gets its own noise stream from `seed`. */
export function renderLayers(layers: readonly Layer[], sr: number, seed: number): Float32Array {
  const out = new Float32Array(Math.ceil(layersSpan(layers) * sr) + 1);
  layers.forEach((layer, k) => {
    const part = renderLayer(layer, sr, seed + k * 7919);
    const at = Math.round(layer.at * sr);
    for (let i = 0; i < part.length && at + i < out.length; i++) out[at + i] += part[i];
  });
  return out;
}

/** Removes the offset and the rumble under `hz` that small speakers cannot play anyway. */
export function blockRumble(x: Float32Array, sr: number, hz = 35): void {
  runBand(x, sr, hp(hz, 0.707));
}

export function peakOf(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] < 0 ? -x[i] : x[i];
    if (a > p) p = a;
  }
  return p;
}

/** Scales the buffer so that its largest sample equals `level`. */
export function normalize(x: Float32Array, level: number): void {
  const p = peakOf(x);
  if (p <= 0) return;
  const k = level / p;
  for (let i = 0; i < x.length; i++) x[i] *= k;
}

/** Fades the last `seconds` to zero so that a buffer never ends on a step. */
export function fadeTail(x: Float32Array, sr: number, seconds = 0.003): void {
  const n = Math.min(x.length, Math.round(seconds * sr));
  for (let i = 0; i < n; i++) x[x.length - 1 - i] *= i / n;
}

/** Cuts the silent tail below `floor` of the peak (default −66 dB). */
export function trimTail(x: Float32Array, floor = 0.0005): Float32Array {
  const limit = peakOf(x) * floor;
  let end = x.length;
  while (end > 1 && Math.abs(x[end - 1]) < limit) end--;
  return x.subarray(0, end);
}

/**
 * Makes a buffer loop without a seam: the extra `overlap` seconds rendered past the
 * loop length are folded back over the start with an equal-power crossfade.
 */
export function foldLoop(x: Float32Array, sr: number, overlap: number): Float32Array {
  const o = Math.round(overlap * sr);
  const n = x.length - o;
  const out = x.slice(0, n);
  for (let i = 0; i < o; i++) {
    const a = (i / o) * (Math.PI / 2);
    out[i] = x[i] * Math.sin(a) + x[n + i] * Math.cos(a);
  }
  return out;
}

/** What `playbackRate` does to a buffer: linear-interpolated resampling. */
export function resample(x: Float32Array, rate: number): Float32Array {
  const n = Math.floor((x.length - 1) / rate);
  const out = new Float32Array(Math.max(1, n));
  for (let i = 0; i < n; i++) {
    const p = i * rate;
    const k = Math.floor(p);
    out[i] = x[k] + (x[k + 1] - x[k]) * (p - k);
  }
  return out;
}

/** Adds `src` into `dst` starting at `at` seconds, scaled by `gain`. */
export function mixInto(dst: Float32Array, src: Float32Array, sr: number, at = 0, gain = 1): void {
  const off = Math.round(at * sr);
  const n = Math.min(src.length, dst.length - off);
  for (let i = 0; i < n; i++) dst[off + i] += src[i] * gain;
}
