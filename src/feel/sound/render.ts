/**
 * Recipes to samples. Everything here is a pure function of its arguments: the engine
 * turns the result into AudioBuffers, the tests measure the very same arrays.
 */
import type { Tune } from './scale';
import { SCALE_HZ, stepSeconds } from './scale';
import { COMB_LEVEL, combNote, nearestTooth } from './comb';
import {
  blockRumble,
  fadeTail,
  foldLoop,
  layersSpan,
  lp,
  mixInto,
  normalize,
  renderLayers,
  resample,
  runBand,
  trimTail,
} from './dsp';
import { LOOPS, PALETTE, layersOf, type LoopName, type SoundName } from './palette';

export const SAMPLE_RATE = 48_000;

/** Master gain of the product: −14 dB, as feel.md asks for a low master. */
export const MASTER_GAIN = 10 ** (-14 / 20);

/**
 * Gain of the melody bus. The fullest phrase a Tune allows (32 steps of three notes at
 * the fastest tempo) peaks under 1 with this gain, so three voices plus the
 * melody stay under −1 dBFS after the master gain; tests/feel/mix.test.ts holds this.
 */
export const TUNE_GAIN = 0.62;

/** Voices that may sound at once, loops included. The melody is counted apart. */
export const MAX_VOICES = 3;

/** Every play is moved in pitch by a random amount within this share. */
export const PITCH_JITTER = 0.03;

/** The largest gain a single play may ask for through `opts.gain`. */
export const MAX_PLAY_GAIN = 1.25;

/** Q of the loop low-pass, as a plain quality factor (BiquadFilterNode takes it in dB). */
export const LOOP_Q = 0.707;

function seedOf(name: string, take: number): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
  return (h >>> 0) + take * 104_729;
}

/** The paper part of a sound at its own pitch: one take of noise, normalized to the recipe level. */
export function renderPaper(name: SoundName, sr = SAMPLE_RATE, take = 0, stretch = 1): Float32Array {
  const patch = PALETTE[name];
  const raw = renderLayers(
    layersOf((p) => patch.draw(p, stretch)),
    sr,
    seedOf(name, take),
  );
  blockRumble(raw, sr);
  const out = trimTail(raw).slice();
  normalize(out, patch.level);
  fadeTail(out, sr);
  return out;
}

/** The buffer of a loop at full intensity; it repeats without a seam. */
export function renderLoopBuffer(name: LoopName, sr = SAMPLE_RATE): Float32Array {
  const patch = LOOPS[name];
  const overlap = 0.08;
  const layers = layersOf((p) => patch.draw(p, patch.span + overlap));
  const raw = renderLayers(layers, sr, seedOf(name, 0)).subarray(0, Math.round(layersSpan(layers) * sr));
  blockRumble(raw, sr);
  const out = foldLoop(raw, sr, overlap);
  normalize(out, patch.level);
  return out;
}

const teeth = new Map<string, Float32Array>();

/** A comb note of the scale, cached per sample rate. */
export function renderTooth(note: number, sr = SAMPLE_RATE): Float32Array {
  const key = `${note}@${sr}`;
  let buf = teeth.get(key);
  if (!buf) teeth.set(key, (buf = combNote(SCALE_HZ[note], sr, 17 + note)));
  return buf;
}

/**
 * What one `play(name, opts)` sends to the voice bus, without the random pitch move:
 * the paper part (moved by `pitch` unless the sound carries comb notes) plus its notes.
 */
export function renderSound(
  name: SoundName,
  o: { sr?: number; take?: number; pitch?: number; gain?: number; stretch?: number } = {},
): Float32Array {
  const sr = o.sr ?? SAMPLE_RATE;
  const pitch = o.pitch ?? 1;
  const patch = PALETTE[name];
  const hits = patch.comb?.(pitch) ?? [];
  let paper = renderPaper(name, sr, o.take ?? 0, o.stretch ?? 1);
  if (!patch.comb && pitch !== 1) paper = resample(paper, pitch);
  let length = paper.length;
  const notes = hits.map((h) => {
    const { note, rate } = nearestTooth(h.hz);
    const tooth = rate === 1 ? renderTooth(note, sr) : resample(renderTooth(note, sr), rate);
    length = Math.max(length, Math.round(h.at * sr) + tooth.length);
    return { tooth, at: h.at, gain: h.gain };
  });
  const out = new Float32Array(length);
  mixInto(out, paper, sr);
  for (const n of notes) mixInto(out, n.tooth, sr, n.at, n.gain);
  const gain = voiceGain(name, o.gain ?? 1);
  if (gain !== 1) for (let i = 0; i < out.length; i++) out[i] *= gain;
  return out;
}

/** The most a voice can peak at gain 1: its paper level plus each of its comb notes at full level. */
export function peakBound(name: SoundName): number {
  const patch = PALETTE[name];
  let bound = patch.level;
  for (const hit of patch.comb?.(1) ?? []) bound += hit.gain * COMB_LEVEL;
  return bound;
}

/** Gain of one voice: the caller's gain, held so that the voice never peaks over 1. */
export function voiceGain(name: SoundName, asked: number): number {
  const g = Math.min(Math.max(Number.isFinite(asked) ? asked : 1, 0), MAX_PLAY_GAIN);
  return Math.min(g, 1 / peakBound(name));
}

/** `seconds` of a loop held at one intensity, as the engine's filter and gain would play it. */
export function renderLoop(name: LoopName, intensity: number, seconds: number, sr = SAMPLE_RATE): Float32Array {
  const shape = LOOPS[name].shape(Math.min(Math.max(intensity, 0), 1));
  const cycle = resample(renderLoopBuffer(name, sr), shape.rate);
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i++) out[i] = cycle[i % cycle.length];
  runBand(out, sr, lp(shape.cutoff, LOOP_Q));
  for (let i = 0; i < out.length; i++) out[i] *= shape.gain;
  return out;
}

/** A whole melody on the melody bus (before the master gain), every note left to ring. */
export function renderTune(t: Tune, sr = SAMPLE_RATE): Float32Array {
  const step = stepSeconds(t.bpm);
  const ring = renderTooth(0, sr).length;
  const out = new Float32Array(Math.round(t.steps.length * step * sr) + ring);
  t.steps.forEach((notes, i) => {
    for (const n of notes) mixInto(out, renderTooth(n, sr), sr, i * step, TUNE_GAIN);
  });
  return out;
}

/** Sums what several buses send to the output and applies the master gain. */
export function mixdown(parts: { samples: Float32Array; at?: number }[], sr = SAMPLE_RATE): Float32Array {
  let length = 0;
  for (const p of parts) length = Math.max(length, Math.round((p.at ?? 0) * sr) + p.samples.length);
  const out = new Float32Array(length);
  for (const p of parts) mixInto(out, p.samples, sr, p.at ?? 0, MASTER_GAIN);
  return out;
}
