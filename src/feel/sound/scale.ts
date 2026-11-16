/**
 * The musical scale of the product sounds: eight notes of the major pentatonic from C5,
 * and the length of one step of a played phrase. The run sounds as one rising phrase on
 * this scale (DESIGN "Движение и ограничения"): a tile rises a step, a stamp falls a fourth.
 */

/** C5, D5, E5, G5, A5, C6, D6, E6 in hertz (equal temperament, A4 = 440). */
export const SCALE_HZ: readonly number[] = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51];

/** Tempo limits of a phrase, beats per minute. */
export const BPM_MIN = 60;
export const BPM_MAX = 180;

/** A phrase: up to 32 steps, each a list of notes 0…7 of the scale. */
export type Tune = { bpm: number; steps: number[][] };

/** Seconds per step. A step is an eighth: two steps per beat. Tempo is held to 60…180. */
export function stepSeconds(bpm: number): number {
  const b = Number.isFinite(bpm) ? Math.min(BPM_MAX, Math.max(BPM_MIN, bpm)) : 96;
  return 30 / b;
}
