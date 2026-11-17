/**
 * The sound palette of Wayfolk: sixteen synthesized sounds of one family (DESIGN
 * "Движение и ограничения"). Ceramic, slate and paper in a calm field, with tones taken
 * only from the pentatonic on C (./scale.ts). All share one envelope: an attack of at
 * most 8 ms and an exponential fall. Noise stays inside 300–4000 Hz, `air` under 500 Hz.
 * No sound is louder than −18 dBFS.
 *
 * Each recipe starts with one line of what it has to sound like; the numbers under it
 * (length, level, band, notes) are what tests/feel/palette.test.ts measures on the
 * rendered samples, because nobody listens to a sound in a unit test.
 */
import { C4, penta } from './scale';
import { glide, hit, hp, lp, bp, type Band, type Env, type Grain, type Layer } from './dsp';

export type SoundName =
  | 'knock'
  | 'grab'
  | 'drop'
  | 'paper'
  | 'stake'
  | 'line'
  | 'tap'
  | 'tile'
  | 'stamp'
  | 'flip'
  | 'ask'
  | 'bloom'
  | 'select'
  | 'slide'
  | 'fold';

/** The ambient bed of the Void. */
export type AmbientName = 'air';

/** Draws layers of one recipe. */
export type Pen = {
  noise(at: number, gain: number, env: Env, band: Band | Band[], grain?: Grain): void;
  tone(at: number, gain: number, env: Env, freq: number | ((t: number) => number)): void;
};

export type Patch = {
  /** What it has to sound like. */
  like: string;
  /** Length to silence (−60 dB), milliseconds. */
  ms: number;
  /** Peak level of the voice at the output, dBFS. */
  db: number;
  /** Band of the noise part, Hz; null when the sound has no noise. */
  band: [number, number] | null;
  /** What the notes are, in words (the gallery shows it). */
  notes: string;
  /** Who gives way when every voice is busy: 1 small ticks, 2 touches, 3 moments. */
  rank: 1 | 2 | 3;
  /** Noise takes kept, so that a repeat is never the same noise. */
  takes: number;
  /** Whether the note moves with the event (tile, stake, stamp). */
  pitched: boolean;
  /** Layers for `degree` (the pentatonic degree from C4 the event asks for). */
  draw(p: Pen, degree: number): void;
};

/** The one envelope: attack `a` (≤ 8 ms), exponential fall that reaches −65 dB at `total` seconds. */
export function env(total: number, a = 0.004): Env {
  const attack = Math.min(0.008, Math.max(0.0005, a));
  return hit(attack, Math.max(0.001, (total - attack) / 7.5));
}

/**
 * A noise band held to [lo, hi] by two second-order stages on each side, set a little
 * inside the edges so that the skirts of the filters stay in the band too.
 */
const band = (lo: number, hi: number, centre?: Band): Band[] => {
  const b = [hp(lo * 1.1), hp(lo * 1.1), lp(hi * 0.85), lp(hi * 0.85)];
  return centre ? [centre, ...b] : b;
};

export const PALETTE: Record<SoundName, Patch> = {
  knock: {
    like: 'A dry knock on ceramic as the inbox pin comes up: a low short body and a hard tick',
    ms: 90,
    db: -20,
    band: [1000, 3000],
    notes: 'G3 196 Hz and a noise tick',
    rank: 2,
    takes: 2,
    pitched: false,
    draw(p) {
      p.tone(0, 1, env(0.09, 0.002), penta(-2));
      p.tone(0, 0.25, env(0.05, 0.002), penta(-2) * 2);
      p.noise(0, 0.6, env(0.02, 0.0005), band(1000, 3000));
    },
  },
  grab: {
    like: 'Paper lifted off the bench: a short rustle that rises',
    ms: 70,
    db: -26,
    band: [800, 3000],
    notes: 'no notes',
    rank: 2,
    takes: 3,
    pitched: false,
    draw(p) {
      p.noise(0, 1, env(0.07, 0.006), band(800, 3000, bp(glide(1000, 2600, 0.06), 1.4)));
    },
  },
  drop: {
    like: 'Set down on slate: a soft tone that falls a third, with a muffled touch',
    ms: 110,
    db: -22,
    band: [300, 900],
    notes: 'C4 262 Hz gliding to 208 Hz',
    rank: 2,
    takes: 2,
    pitched: false,
    draw(p) {
      p.tone(0, 1, env(0.11, 0.003), glide(C4, 208, 0.07));
      p.noise(0, 0.35, env(0.03, 0.001), band(300, 900));
    },
  },
  paper: {
    like: 'Sheets fan out of an envelope: two quick bursts of paper',
    ms: 220,
    db: -28,
    band: [1000, 4000],
    notes: 'no notes',
    rank: 2,
    takes: 3,
    pitched: false,
    draw(p) {
      const grain: Grain = { rate: 500, length: 0.0015, floor: 0.5 };
      p.noise(0, 1, env(0.1, 0.004), band(1000, 4000), grain);
      p.noise(0.1, 0.8, env(0.12, 0.004), band(1000, 4000), grain);
    },
  },
  stake: {
    like: 'A cobalt stake seats in the shelf: a clear ceramic note, one step higher for each station',
    ms: 160,
    db: -22,
    band: null,
    notes: 'C4, D4, E4, G4, A4 for stations 1 to 5, with the octave',
    rank: 2,
    takes: 1,
    pitched: true,
    draw(p, degree) {
      const f = penta(Math.max(0, Math.min(4, degree)));
      p.tone(0, 1, env(0.16, 0.003), f);
      p.tone(0, 0.3, env(0.1, 0.003), f * 2);
    },
  },
  line: {
    like: 'The plan line pulls taut: a tone sliding up a fifth',
    ms: 240,
    db: -28,
    band: null,
    notes: 'D4 294 Hz sliding to A4 440 Hz',
    rank: 2,
    takes: 1,
    pitched: false,
    draw(p) {
      p.tone(0, 1, env(0.24, 0.006), glide(penta(1), penta(4), 0.18));
    },
  },
  tap: {
    like: 'A small tap: an answer arrived, a figure moved',
    ms: 60,
    db: -26,
    band: null,
    notes: 'D5 587 Hz',
    rank: 1,
    takes: 1,
    pitched: false,
    draw(p) {
      p.tone(0, 1, env(0.06, 0.002), penta(6));
    },
  },
  tile: {
    like: 'A tile lands in the plot: a short bright note that climbs as the plot fills',
    ms: 180,
    db: -24,
    band: null,
    notes: 'C4 rising one pentatonic step per tenth laid, to C6',
    rank: 1,
    takes: 1,
    pitched: true,
    draw(p, degree) {
      const f = penta(Math.max(0, Math.min(10, degree)));
      p.tone(0, 1, env(0.18, 0.002), f);
      p.tone(0, 0.35, env(0.11, 0.002), f * 2);
    },
  },
  stamp: {
    like: 'The stamp head comes down on a refused card: a dull hit and a note a fourth under the tiles',
    ms: 140,
    db: -18,
    band: [300, 1500],
    notes: 'a fourth below the note the tiles have reached',
    rank: 3,
    takes: 2,
    pitched: true,
    draw(p, degree) {
      p.noise(0, 1, env(0.08, 0.001), band(300, 1500));
      p.tone(0, 0.7, env(0.14, 0.002), penta(Math.max(0, Math.min(10, degree))) * 0.75);
    },
  },
  flip: {
    like: 'A folded slip opens in the hand: paper turning, the brightness sweeping up',
    ms: 160,
    db: -27,
    band: [600, 3500],
    notes: 'no notes',
    rank: 2,
    takes: 2,
    pitched: false,
    draw(p) {
      p.noise(0, 1, env(0.16, 0.008), band(600, 3500, bp(glide(700, 3000, 0.14), 1.6)), { rate: 400, length: 0.002, floor: 0.6 });
    },
  },
  ask: {
    like: 'A question waits: two quiet tones a fifth apart',
    ms: 420,
    db: -24,
    band: null,
    notes: 'G4 392 Hz, then D5 587 Hz',
    rank: 3,
    takes: 1,
    pitched: false,
    draw(p) {
      p.tone(0, 0.8, env(0.2, 0.006), penta(3));
      p.tone(0.18, 1, env(0.24, 0.006), penta(6));
    },
  },
  bloom: {
    like: 'The work is done: three notes come home to the tonic, the only celebration',
    ms: 900,
    db: -20,
    band: null,
    notes: 'E5, D5, C5',
    rank: 3,
    takes: 1,
    pitched: false,
    draw(p) {
      p.tone(0, 0.85, env(0.3, 0.004), penta(7));
      p.tone(0.22, 0.9, env(0.3, 0.004), penta(6));
      p.tone(0.45, 1, env(0.45, 0.004), penta(5));
      p.tone(0.45, 0.25, env(0.3, 0.004), penta(10));
    },
  },
  select: {
    like: 'Something is chosen: the smallest high click of a note',
    ms: 50,
    db: -28,
    band: null,
    notes: 'G5 784 Hz',
    rank: 1,
    takes: 1,
    pitched: false,
    draw(p) {
      p.tone(0, 1, env(0.05, 0.001), penta(8));
    },
  },
  slide: {
    like: 'Things slide into new places: soft air through a filter that opens',
    ms: 300,
    db: -30,
    band: [400, 1600],
    notes: 'no notes',
    rank: 1,
    takes: 2,
    pitched: false,
    draw(p) {
      p.noise(0, 1, env(0.3, 0.008), band(400, 1600, bp(glide(450, 1500, 0.26), 1.2)));
    },
  },
  fold: {
    like: 'An envelope folds and flies to the phone: two creases and a tone rising away',
    ms: 260,
    db: -26,
    band: [1000, 3000],
    notes: 'G4 rising to C5 523 Hz',
    rank: 3,
    takes: 2,
    pitched: false,
    draw(p) {
      p.noise(0, 1, env(0.05, 0.002), band(1000, 3000));
      p.noise(0.06, 0.8, env(0.05, 0.002), band(1000, 3000));
      p.tone(0.08, 0.8, env(0.18, 0.006), glide(penta(3), penta(5), 0.1));
    },
  },
};

export const SOUND_NAMES = Object.keys(PALETTE) as SoundName[];

/** The ambient bed (only in the Void). */
export const AIR = {
  like: 'Still air under a high sky: low pink noise that breathes ±2 dB every 14 seconds',
  db: -36,
  cutoff: 500,
  swingDb: 2,
  periodS: 14,
  /** Comes in this long after the first gesture. */
  fadeInS: 2,
  /** Length of the seamless loop buffer, seconds. */
  loopS: 6,
} as const;

/** Collects what a recipe draws into a list of layers; `tones: false` keeps only the noise. */
export function layersOf(draw: (p: Pen) => void, keep: { tones?: boolean; noise?: boolean } = {}): Layer[] {
  const layers: Layer[] = [];
  draw({
    noise: (at, gain, e, b, grain) => {
      if (keep.noise !== false) layers.push({ kind: 'noise', at, gain, env: e, band: Array.isArray(b) ? b : [b], grain });
    },
    tone: (at, gain, e, freq) => {
      if (keep.tones !== false) layers.push({ kind: 'tone', at, gain, env: e, freq });
    },
  });
  return layers;
}

/** Degree (from C4) an event value asks for: tile and stamp take the share laid, stake the station. */
export function degreeOf(name: SoundName, value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  if (name === 'stake') return Math.max(0, Math.min(4, Math.round(value * 4)));
  return Math.min(10, Math.floor(Math.max(0, Math.min(1, value)) * 10 + 1e-9));
}
