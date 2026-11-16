/**
 * The musical scale of the product sounds: the major pentatonic on C. Every tonal sound
 * takes its notes from it (DESIGN "Движение и ограничения"), so the run sounds as one
 * rising phrase with a resolution: a tile rises a step for every tenth laid, a stamp
 * falls a fourth below the note the tiles have reached, the finished plot resolves to
 * the tonic.
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

/** Semitones of the pentatonic degrees above C. */
const DEGREES = [0, 2, 4, 7, 9] as const;

/** C4, the root of the phrase of a run. */
export const C4 = SCALE_HZ[0] / 2;

/**
 * Hertz of pentatonic degree `n` counted from C4: 0 C4, 1 D4, 2 E4, 3 G4, 4 A4, 5 C5,
 * and so on up; negative degrees go down (−1 is A3).
 */
export function penta(n: number): number {
  const i = Math.round(n);
  const octave = Math.floor(i / 5);
  const step = DEGREES[((i % 5) + 5) % 5];
  return C4 * 2 ** (octave + step / 12);
}

/** True when a frequency is a note of the pentatonic in any octave (within 0.5 %). */
export function inPentatonic(hz: number): boolean {
  if (!(hz > 0)) return false;
  const semis = 12 * Math.log2(hz / C4);
  const near = Math.round(semis);
  if (Math.abs(semis - near) > 0.09) return false;
  return (DEGREES as readonly number[]).includes(((near % 12) + 12) % 12);
}

/** The degree a tile sounds at when `share` of the plot is laid: one step per tenth, 0…10. */
export function tileDegree(share: number): number {
  const s = Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
  return Math.min(10, Math.floor(s * 10 + 1e-9));
}
