/**
 * The answer plan: what one event of the product looks and sounds like. This is the
 * table of DESIGN "Движение и ограничения" in code, kept in one file so that the
 * visible part and the sound of an action cannot drift apart.
 *
 * A feature fires `answer({ type, at, value })` at the moment of the action. The sound
 * of the row plays from here at `at`; the feature (or a view it drives) draws what
 * `sight` says, where it fired the event or in an `onFeel(type, fn)` subscriber. No row
 * has a sound without a sight: a sound never carries information alone. Views name the
 * event, never the sound.
 *
 * `value` of an event: the share of the plot laid (tile, stamp: the note), the station
 * as a share 0…1 (stake: station 1 is 0, station 5 is 1), the number of notebooks that
 * move (rule-apply). Times under "Less motion" are multiplied by `calm` (0 means the
 * end state at once).
 */
import type { Vector3 } from '@iwsdk/core';
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

/** at: where the sound comes from; value: a share from 0 to 1 (see above). */
export type FeelEvent = { type: FeelName; at?: Vector3; value?: number };

/** One sound of a row: when after the event, and at what pitch (playback rate). */
export type Beat = { sound: SoundName; delayMs?: number; pitch?: number };

export type Answer = {
  /** What the person sees at the same moment. */
  sight: string;
  /** The sounds of the event, in order; none for hover. */
  sounds: Beat[] | ((value: number | undefined) => Beat[]);
  /** What `value` of the event means, when the row uses it. */
  value?: string;
  /** The sound plays at most once per this many ms (tiles: eight a second); the sight always runs. */
  minGapMs?: number;
  /** Duration multiplier of the sight under "Less motion" (0: the end state at once). */
  calm: number;
};

/** The same sound of one row more often than this is skipped: 30 times a second. */
export const MIN_GAP_MS = 1000 / 30;

/** A fourth down, for the error knocks. */
const FOURTH_DOWN = 0.75;

export const PLAN: Record<FeelName, Answer> = {
  'pin-up': { sight: 'The cobalt flag pin of the inbox rises 5 cm', sounds: [{ sound: 'knock' }], calm: 0 },
  grab: { sight: 'The object follows the hand and lifts a little, its shadow widens', sounds: [{ sound: 'grab' }], calm: 1 },
  drop: { sight: 'The object is pulled onto its place in 120 ms and settles; its shadow tightens', sounds: [{ sound: 'drop' }], calm: 0 },
  paper: { sight: 'The envelope opens and its sheets fan out to the left end of the shelf', sounds: [{ sound: 'paper' }], calm: 0 },
  stake: {
    sight: 'A stake rises out of the shelf and settles, left to right',
    sounds: [{ sound: 'stake' }],
    value: 'station as a share: 0 is station 1, 1 is station 5',
    calm: 0,
  },
  line: { sight: 'The plan line pulls taut from stake to stake', sounds: [{ sound: 'line' }], calm: 0 },
  'call-end': { sight: 'The instrument hops once and its cobalt ring goes out', sounds: [{ sound: 'tap' }], calm: 0 },
  tile: {
    sight: 'A checked card turns face down and drops 4 cm into its cell as a tile',
    sounds: [{ sound: 'tile' }],
    value: 'share of the plot laid, 0 to 1: the note rises a step every tenth',
    minGapMs: 125,
    calm: 0,
  },
  stamp: {
    sight: 'The stamp head drops 15 mm in 90 ms and a slip flies to the tray',
    sounds: [{ sound: 'stamp' }],
    value: 'share of the plot laid: the stamp sounds a fourth under that note',
    calm: 0,
  },
  'slip-open': { sight: 'The slip unfolds from quarters into an 18 × 16 cm sheet', sounds: [{ sound: 'flip' }], calm: 0 },
  ask: { sight: 'The question card flies from the reconcile station to the bench; the notes go quiet', sounds: [{ sound: 'ask' }], calm: 0 },
  bloom: { sight: 'The tiles close into a grid, the plot settles 2 cm and its object grows', sounds: [{ sound: 'bloom' }], calm: 0 },
  'thread-pull': { sight: 'The bead rides toward the person and the thread pulls taut', sounds: [{ sound: 'line' }], calm: 1 },
  'pair-open': { sight: 'Both pages of the pair lie down over the bench', sounds: [{ sound: 'slide' }], calm: 0 },
  filter: { sight: 'Marks outside the filter fade to 25 % and the threads run a wave', sounds: [{ sound: 'slide' }], calm: 0 },
  export: { sight: 'The envelope folds and flies up; the code appears', sounds: [{ sound: 'fold' }], calm: 0 },
  select: { sight: 'The chosen thing presses in to 0.96 and springs back', sounds: [{ sound: 'select' }], calm: 0 },
  hover: { sight: 'The object under the pointer lifts 4 mm', sounds: [], calm: 0 },
  'guest-move': { sight: 'A guest figure steps onto its new table', sounds: [{ sound: 'tap' }], calm: 0 },
  'rule-apply': {
    sight: 'The notebooks it touches rise, their totals roll, then they move in the fan',
    sounds: (value) => {
      const n = Math.max(1, Math.min(24, Math.round(value ?? 1)));
      const beats: Beat[] = [];
      for (let i = 0; i < n; i++) beats.push({ sound: 'tap', delayMs: i * 40 });
      beats.push({ sound: 'slide', delayMs: n * 40 + 60 });
      return beats;
    },
    value: 'number of notebooks the rule changes',
    calm: 0,
  },
  error: {
    sight: 'The failed part turns grey and its plate names what failed',
    sounds: [
      { sound: 'knock', pitch: FOURTH_DOWN },
      { sound: 'knock', pitch: FOURTH_DOWN, delayMs: 140 },
    ],
    calm: 0,
  },
};

/** The beats of an event. */
export function beatsOf(e: FeelEvent): Beat[] {
  const row = PLAN[e.type];
  if (!row) return [];
  return typeof row.sounds === 'function' ? row.sounds(e.value) : row.sounds;
}
