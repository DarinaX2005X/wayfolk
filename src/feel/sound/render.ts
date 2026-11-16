/**
 * Recipes to samples. Everything here is a pure function of its arguments: the engine
 * turns the result into AudioBuffers, the tests measure the very same arrays.
 */
import { blockRumble, fadeTail, foldLoop, normalize, renderLayers, runBand, trimTail, lp, rng } from './dsp';
import { AIR, PALETTE, layersOf, type SoundName } from './palette';

export const SAMPLE_RATE = 48_000;

/**
 * Master gain. The levels of the palette are written as the peak each voice reaches at
 * the output (DESIGN gives them in dBFS), so the master passes them through unchanged.
 */
export const MASTER_GAIN = 1;

/** Voices that may sound at once; `air` is counted apart. */
export const MAX_VOICES = 3;

/** Every play is moved in pitch by a random amount within this share. */
export const PITCH_JITTER = 0.03;

/** The largest gain a single play may ask for through `opts.gain` (it never raises a voice). */
export const MAX_PLAY_GAIN = 1;

export const dbToGain = (db: number): number => 10 ** (db / 20);

function seedOf(name: string, take: number, degree: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) + take * 104_729 + degree * 7_919;
}

/**
 * One sound at its level: the recipe drawn for `degree`, one take of its noise, peak
 * normalised to the patch level in dBFS. `part` renders only the tones or only the
 * noise (for the band tests).
 */
export function renderSound(
  name: SoundName,
  o: { sr?: number; take?: number; degree?: number; part?: 'all' | 'tones' | 'noise' } = {},
): Float32Array {
  const sr = o.sr ?? SAMPLE_RATE;
  const patch = PALETTE[name];
  const degree = o.degree ?? 0;
  const keep = o.part === 'tones' ? { noise: false } : o.part === 'noise' ? { tones: false } : {};
  const raw = renderLayers(layersOf((p) => patch.draw(p, degree), keep), sr, seedOf(name, o.take ?? 0, degree));
  blockRumble(raw, sr);
  const out = trimTail(raw).slice();
  normalize(out, dbToGain(patch.db));
  fadeTail(out, sr);
  return out;
}

/** Gain of one voice: the caller's gain, never above the level of the patch. */
export function voiceGain(asked: number): number {
  return Math.min(Math.max(Number.isFinite(asked) ? asked : 1, 0), MAX_PLAY_GAIN);
}

/**
 * The air of the Void: pink noise (Paul Kellet's filter) under a 500 Hz low-pass, a
 * seamless loop at the ambient level. The breathing (±2 dB over 14 s) is applied by the
 * engine with a slow gain curve, so the loop itself stays short.
 */
export function renderAir(sr = SAMPLE_RATE): Float32Array {
  const overlap = 0.25;
  const n = Math.round((AIR.loopS + overlap) * sr);
  const raw = new Float32Array(n);
  const rand = rng(424242);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const white = rand() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
  }
  runBand(raw, sr, lp(AIR.cutoff));
  runBand(raw, sr, lp(AIR.cutoff));
  blockRumble(raw, sr, 30);
  const out = foldLoop(raw, sr, overlap);
  normalize(out, dbToGain(AIR.db));
  return out;
}

/** The breathing of the air: its gain factor at time `t` seconds (±2 dB, 14 s). */
export function airSwing(t: number): number {
  return dbToGain(AIR.swingDb * Math.sin((2 * Math.PI * t) / AIR.periodS));
}

/** Sums several voices to the output at their times (for the mix test). */
export function mixdown(parts: { samples: Float32Array; at?: number }[], sr = SAMPLE_RATE): Float32Array {
  let length = 0;
  for (const p of parts) length = Math.max(length, Math.round((p.at ?? 0) * sr) + p.samples.length);
  const out = new Float32Array(length);
  for (const p of parts) {
    const off = Math.round((p.at ?? 0) * sr);
    for (let i = 0; i < p.samples.length && off + i < out.length; i++) out[off + i] += p.samples[i] * MASTER_GAIN;
  }
  return out;
}
