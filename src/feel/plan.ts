/**
 * The answer plan: what one event of the product looks and sounds like. This is the
 * table of DESIGN "Движение и ограничения" in code, kept in one file so that the
 * visible part and the sound of an action cannot drift apart.
 *
 * A feature fires `answer({ type, at, value })` at the moment of the action. The sound
 * in the row plays from here; the feature (or a view it drives) draws what `sight`
 * says, either where it fired the event or in an `onFeel(type, fn)` subscriber.
 * No row has a sound without a sight: a sound never carries information alone.
 *
 * The table is filled by package 01.3 together with the sound palette of Groundwork;
 * until then events still reach their subscribers and play nothing.
 */
import type { Vector3 } from '@iwsdk/core';
import { SCALE_HZ } from './sound/scale';
import type { SoundName } from './sound/palette';

/** Events of the product that get an answer (PLAN "Набор ремесла"). */
export type FeelName =
  | 'pin-up'
  | 'grab'
  | 'drop'
  | 'paper'
  | 'stake'
  | 'line'
  | 'call-end'
  | 'tile'
  | 'stamp'
  | 'slip-open'
  | 'ask'
  | 'bloom'
  | 'thread-pull'
  | 'pair-open'
  | 'filter'
  | 'export'
  | 'select'
  | 'hover'
  | 'guest-move'
  | 'rule-apply'
  | 'error';

/** at: where the sound comes from; value: a share from 0 to 1 (the note of a tile). */
export type FeelEvent = { type: FeelName; at?: Vector3; value?: number };

export type Answer = {
  /** What the person sees at the same moment. */
  sight: string;
  /** The sound of the event. Hover and selection may stay silent: they repeat too often to ring. */
  sound?: SoundName;
  /** What `value` of the event means, when the row uses it. */
  value?: string;
  /** `value` to a pitch multiplier. */
  pitch?(value: number): number;
  /** `value` to a gain multiplier. */
  gain?(value: number): number;
  /** Length scale of the sound under "Less motion", for moves that become shorter there. */
  calmStretch?: number;
};

/** Note n (0…7) of the scale as a pitch multiplier of the lowest note. */
export function pitchOfNote(n: number): number {
  const i = Math.max(0, Math.min(SCALE_HZ.length - 1, Math.round(n)));
  return SCALE_HZ[i] / SCALE_HZ[0];
}

/** One row per event that answers with more than its subscribers. Filled by 01.3. */
export const PLAN: Partial<Record<FeelName, Answer>> = {};

/** The same event more often than this is dropped: 30 times a second. */
export const MIN_GAP_MS = 1000 / 30;
