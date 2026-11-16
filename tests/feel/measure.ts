/**
 * Measuring tools for sound tests. Nobody can listen to a sound inside a unit test, so
 * every claim about a sound ("short", "dull", "bright", "quiet", "tuned to C5") is
 * turned into a number taken from the rendered samples.
 */

export const dB = (x: number): number => 20 * Math.log10(Math.max(x, 1e-12));

export function peak(x: Float32Array): number {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

/** In-place radix-2 FFT. `re` and `im` must have a power-of-two length. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? -2 : 2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function pow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Power spectrum of the whole signal: `power[k]` belongs to `k * sr / size` Hz. */
export function spectrum(x: Float32Array, sr: number): { power: Float64Array; hzPerBin: number } {
  const size = pow2(Math.max(x.length, 4096));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(x);
  fft(re, im);
  const power = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
  return { power, hzPerBin: sr / size };
}

/** Share of the signal's energy between two frequencies, 0…1. */
export function bandShare(x: Float32Array, sr: number, fromHz: number, toHz: number): number {
  const { power, hzPerBin } = spectrum(x, sr);
  let all = 0;
  let band = 0;
  for (let k = 1; k < power.length; k++) {
    all += power[k];
    const f = k * hzPerBin;
    if (f >= fromHz && f < toHz) band += power[k];
  }
  return all > 0 ? band / all : 0;
}

/** Spectral centroid in Hz: the "brightness" of a sound. */
export function centroid(x: Float32Array, sr: number): number {
  const { power, hzPerBin } = spectrum(x, sr);
  let num = 0;
  let den = 0;
  for (let k = 1; k < power.length; k++) {
    num += k * hzPerBin * power[k];
    den += power[k];
  }
  return den > 0 ? num / den : 0;
}

/** Frequency of the strongest spectral line between two frequencies, refined between bins. */
export function strongestHz(x: Float32Array, sr: number, fromHz = 20, toHz = sr / 2): number {
  const { power, hzPerBin } = spectrum(x, sr);
  let best = 1;
  for (let k = Math.max(1, Math.floor(fromHz / hzPerBin)); k < Math.min(power.length - 1, toHz / hzPerBin); k++) {
    if (power[k] > power[best]) best = k;
  }
  const a = Math.log(power[best - 1] + 1e-30);
  const b = Math.log(power[best] + 1e-30);
  const c = Math.log(power[best + 1] + 1e-30);
  const shift = (0.5 * (a - c)) / (a - 2 * b + c);
  return (best + (Number.isFinite(shift) ? shift : 0)) * hzPerBin;
}

/** Energy at one frequency (Goertzel), as the amplitude of a sine that would give it. */
export function lineLevel(x: Float32Array, sr: number, hz: number, from = 0, to = x.length): number {
  const w = (2 * Math.PI * hz) / sr;
  const c = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = from; i < to; i++) {
    const s = x[i] + c * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  const power = s1 * s1 + s2 * s2 - c * s1 * s2;
  return (2 * Math.sqrt(Math.max(power, 0))) / Math.max(1, to - from);
}

/** A-weighting gain (linear) at a frequency: how much the ear counts it at low levels. */
export function aWeight(f: number): number {
  const f2 = f * f;
  const ra =
    (12194 ** 2 * f2 * f2) /
    ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
  return ra * 1.2589;
}

/**
 * Loudness as a sound level meter set to "A, fast" would show it: the signal is
 * A-weighted, then the largest mean square over any 125 ms window is taken, in dB
 * relative to full scale. Short ticks come out quieter than long sounds of the same
 * peak, which is how they are heard.
 */
export function loudness(x: Float32Array, sr: number): number {
  const size = pow2(Math.max(x.length + Math.round(0.125 * sr), 4096));
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(x);
  fft(re, im);
  for (let k = 0; k < size; k++) {
    const f = (k <= size / 2 ? k : size - k) * (sr / size);
    const g = aWeight(f);
    re[k] *= g;
    im[k] *= g;
  }
  fft(re, im, true);
  const win = Math.round(0.125 * sr);
  let sum = 0;
  let best = 0;
  for (let i = 0; i < size; i++) {
    sum += re[i] * re[i];
    if (i >= win) sum -= re[i - win] * re[i - win];
    if (sum > best) best = sum;
  }
  return 10 * Math.log10(Math.max(best / win, 1e-24));
}

/** Smoothed level envelope: RMS over a sliding window of `ms` milliseconds. */
export function envelope(x: Float32Array, sr: number, ms = 4): Float32Array {
  const win = Math.max(1, Math.round((ms / 1000) * sr));
  const out = new Float32Array(x.length);
  let sum = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i];
    if (i >= win) sum -= x[i - win] * x[i - win];
    out[i] = Math.sqrt(Math.max(sum, 0) / win);
  }
  return out;
}

/** Seconds from the first to the last moment the level is within `downDb` of its maximum. */
export function audibleSeconds(x: Float32Array, sr: number, downDb = 40): number {
  const env = envelope(x, sr, 2);
  const limit = peak(env) * 10 ** (-downDb / 20);
  let first = 0;
  let last = env.length - 1;
  while (first < env.length && env[first] < limit) first++;
  while (last > first && env[last] < limit) last--;
  return (last - first) / sr;
}

/** Seconds from the start of the buffer to the loudest moment of the envelope. */
export function timeOfPeak(x: Float32Array, sr: number): number {
  const env = envelope(x, sr, 4);
  let best = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[best]) best = i;
  return best / sr;
}

/** Where the energy sits in time, as a share of the audible length: 0 start, 1 end. */
export function timeCentre(x: Float32Array): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    num += i * x[i] * x[i];
    den += x[i] * x[i];
  }
  return den > 0 ? num / den / x.length : 0;
}

/** Number of separate strikes: rises of the envelope through half of its maximum. */
export function strikes(x: Float32Array, sr: number, ms = 6, gapMs = 30): number {
  const env = envelope(x, sr, ms);
  const high = peak(env) * 0.5;
  const low = peak(env) * 0.2;
  let count = 0;
  let armed = true;
  let lastAt = -Infinity;
  for (let i = 0; i < env.length; i++) {
    if (armed && env[i] > high) {
      if ((i - lastAt) / sr > gapMs / 1000) count++;
      lastAt = i;
      armed = false;
    } else if (!armed && env[i] < low) {
      armed = true;
    }
  }
  return count;
}

/**
 * How even the sound is while it lasts: mean level over the audible part divided by
 * its maximum. A held hiss is near 1, a single strike with a tail is near 0.
 */
export function steadiness(x: Float32Array, sr: number): number {
  const env = envelope(x, sr, 8);
  const top = peak(env);
  const limit = top * 0.01;
  let first = 0;
  let last = env.length - 1;
  while (first < env.length && env[first] < limit) first++;
  while (last > first && env[last] < limit) last--;
  let sum = 0;
  for (let i = first; i <= last; i++) sum += env[i];
  return top > 0 ? sum / (last - first + 1) / top : 0;
}

/** The numbers that tell one sound from another by ear: length, brightness, weight, shape. */
export type Portrait = {
  seconds: number;
  centroid: number;
  low: number;
  mid: number;
  high: number;
  loud: number;
  peak: number;
  centre: number;
  steady: number;
};

export function portrait(x: Float32Array, sr: number): Portrait {
  return {
    seconds: audibleSeconds(x, sr),
    centroid: centroid(x, sr),
    low: bandShare(x, sr, 20, 400),
    mid: bandShare(x, sr, 400, 2000),
    high: bandShare(x, sr, 2000, sr / 2),
    loud: loudness(x, sr),
    peak: peak(x),
    centre: timeCentre(x),
    steady: steadiness(x, sr),
  };
}

/**
 * How far apart two sounds are for the ear, in rough "clearly different" units: a
 * doubling of length, an octave of brightness, a third of the energy moving between
 * low, middle and high, the weight of the sound moving from its start to its end, or
 * a held sound against a struck one each count as one.
 */
export function distance(a: Portrait, b: Portrait): number {
  const length = Math.abs(Math.log2(a.seconds / b.seconds));
  const bright = Math.abs(Math.log2(a.centroid / b.centroid));
  const weight = (Math.abs(a.low - b.low) + Math.abs(a.mid - b.mid) + Math.abs(a.high - b.high)) / 0.66;
  const shape = Math.abs(a.centre - b.centre) / 0.25;
  const held = Math.abs(a.steady - b.steady) / 0.3;
  return Math.hypot(length, bright, weight, shape, held);
}
