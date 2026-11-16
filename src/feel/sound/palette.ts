/**
 * The sound palette: every sound of the product as a recipe of layers.
 *
 * One family, two materials. Paper: short bursts of filtered noise that differ in
 * envelope, band and crackle. Comb: the plucked steel teeth of a music box (comb.ts).
 * Each recipe starts with one line saying what it has to sound like; the numbers under
 * it are checked by tests/feel/palette.test.ts (length, level, where the energy sits),
 * because nobody listens to a sound in a unit test.
 */
import { SCALE_HZ } from './scale';
import {
  bp,
  glide,
  hit,
  hp,
  lp,
  plateau,
  shaped,
  swell,
  type Band,
  type Env,
  type Grain,
  type Layer,
  type Sweep,
} from './dsp';

export type SoundName =
  | 'unroll'
  | 'flap'
  | 'slide-out'
  | 'open-card'
  | 'close-card'
  | 'pick'
  | 'place'
  | 'snap'
  | 'snap-limit'
  | 'cut-done'
  | 'letter'
  | 'punch'
  | 'spring'
  | 'stamp'
  | 'postmark'
  | 'sent'
  | 'crumple'
  | 'page'
  | 'error';

export type LoopName = 'snip' | 'ink' | 'tab';

/** Draws layers of one recipe. */
export type Pen = {
  noise(at: number, gain: number, env: Env, band: Band | Band[], grain?: Grain): void;
  tone(at: number, gain: number, env: Env, freq: Sweep): void;
};

export type CombHit = { hz: number; at: number; gain: number };

export type Patch = {
  /** What it has to sound like. */
  like: string;
  /** Peak of the rendered paper part before the master gain, 0…1. Sets the balance of the palette. */
  level: number;
  /** Who gives way when every voice is busy: 1 small ticks, 2 touches, 3 moments. */
  rank: 1 | 2 | 3;
  /** How many different noise takes to keep, so that a repeat is never the same sound. */
  takes: number;
  /** The paper part. `stretch` scales its length (the mat unrolls faster under "Less motion"). */
  draw(p: Pen, stretch: number): void;
  /**
   * Comb notes over the paper part. When present, the `pitch` option of `play` moves
   * these notes and the paper part keeps its own pitch; without it `pitch` moves the paper.
   */
  comb?(pitch: number): CombHit[];
};

/** The comb's own key, an octave or two down, for the muffled "no". */
const C4 = SCALE_HZ[0] / 2;
const G3 = SCALE_HZ[3] / 4;

export const PALETTE: Record<SoundName, Patch> = {
  unroll: {
    like: 'The cutting mat unrolls: a long rustle that climbs in pitch, then the far edge lands',
    level: 0.55,
    rank: 3,
    takes: 1,
    draw(p, s) {
      const d = 0.54 * s;
      const body = plateau(0.08 * s, d, 0.09 * s);
      p.noise(0, 0.8, body, bp(glide(300, 1700, d), 0.9), { rate: glide(90, 300, d), length: 0.004, floor: 0.45 });
      p.noise(0, 0.55, body, lp(glide(180, 380, d)));
      p.noise(d - 0.02, 0.6, hit(0.001, 0.012), lp(600));
      p.tone(d - 0.02, 0.5, hit(0.001, 0.012), 120);
    },
  },
  flap: {
    like: 'An envelope flap swings open: a short soft whoosh, then the crease gives',
    level: 0.45,
    rank: 2,
    takes: 2,
    draw(p) {
      p.noise(0, 0.8, swell(0.13, 0.55), bp(glide(450, 1300, 0.12), 0.8));
      p.noise(0.12, 0.4, hit(0.0004, 0.005), bp(2400, 2));
      p.noise(0.125, 0.3, hit(0.001, 0.012), lp(400));
    },
  },
  'slide-out': {
    like: 'A card slides out of its envelope: an even dry hiss that stops with a light catch',
    level: 0.36,
    rank: 2,
    takes: 2,
    draw(p) {
      const hiss = [hp(700), bp(glide(2100, 2600, 0.25), 0.9)];
      p.noise(0, 0.7, plateau(0.025, 0.25, 0.05), hiss, { rate: 900, length: 0.0008, floor: 0.7 });
      p.noise(0.245, 0.3, hit(0.0005, 0.006), bp(1500, 1.5));
    },
  },
  'open-card': {
    like: 'The card opens: a rustle that brightens as it goes, with small creases as the layers stand up',
    level: 0.6,
    rank: 3,
    takes: 2,
    draw(p) {
      p.noise(0, 0.8, swell(0.37, 0.6), bp(glide(700, 3600, 0.36), 1.1), {
        rate: glide(260, 520, 0.36),
        length: 0.002,
        floor: 0.35,
      });
      p.noise(0, 0.2, swell(0.33, 0.45), lp(glide(500, 1200, 0.33)));
      const creases: [number, number, number][] = [
        [0.1, 2600, 0.25],
        [0.17, 3000, 0.3],
        [0.24, 3400, 0.36],
        [0.3, 3800, 0.42],
      ];
      for (const [at, hz, gain] of creases) p.noise(at, gain, hit(0.0003, 0.003), bp(hz, 2.5));
    },
  },
  'close-card': {
    like: 'The card folds shut: a soft puff of air with a low 90 Hz thump under it',
    level: 0.85,
    rank: 3,
    takes: 2,
    draw(p) {
      p.noise(0, 0.6, hit(0.008, 0.06), lp(glide(900, 300, 0.16)));
      p.tone(0.004, 1, hit(0.004, 0.055), glide(104, 88, 0.05));
      p.tone(0.004, 0.3, hit(0.004, 0.035), glide(196, 176, 0.05));
      p.noise(0, 0.3, hit(0.0005, 0.005), bp(1800, 1.2));
    },
  },
  pick: {
    like: 'A fingernail lifts a playing card off the table: a small tick, then a short upward breath',
    level: 0.5,
    rank: 2,
    takes: 3,
    draw(p) {
      p.noise(0, 0.8, hit(0.0004, 0.004), bp(3600, 2.5));
      p.noise(0.008, 0.55, swell(0.08, 0.35), bp(glide(1400, 3400, 0.07), 1.6), {
        rate: 500,
        length: 0.0015,
        floor: 0.5,
      });
    },
  },
  place: {
    like: 'A card cutout set down on card: a soft tap with a short hollow body, lower for pieces near you',
    level: 0.65,
    rank: 2,
    takes: 3,
    draw(p) {
      p.noise(0, 1, hit(0.0005, 0.007), bp(2000, 1.8));
      p.noise(0, 0.7, hit(0.001, 0.022), bp(420, 5));
      p.tone(0, 0.35, hit(0.001, 0.018), glide(420, 385, 0.04));
      p.noise(0.028, 0.15, hit(0.002, 0.012), lp(900));
    },
  },
  snap: {
    like: 'A dry, very quiet fingernail click on a card edge as a piece crosses a grid line',
    level: 0.36,
    rank: 1,
    takes: 3,
    draw(p) {
      p.noise(0, 1, hit(0.0002, 0.0025), [hp(2800), bp(4300, 1.2)]);
      p.tone(0, 0.5, hit(0.0001, 0.0018), 2900);
    },
  },
  'snap-limit': {
    like: 'A dull knock as the piece meets its stop: a knuckle on thick cardboard, no brightness',
    level: 0.75,
    rank: 2,
    takes: 2,
    draw(p) {
      p.tone(0, 1, hit(0.001, 0.022), glide(210, 175, 0.03));
      p.tone(0, 0.3, hit(0.001, 0.012), glide(420, 350, 0.03));
      p.noise(0, 0.5, hit(0.0008, 0.009), lp(520));
      p.noise(0, 0.7, hit(0.0008, 0.006), bp(520, 2));
    },
  },
  'cut-done': {
    like: 'Scissors close on the last bit of the line: a crisp snip, then the shape pops free of the sheet',
    level: 0.6,
    rank: 3,
    takes: 2,
    draw(p) {
      p.noise(0, 0.6, swell(0.052, 0.88, 1.4), bp(glide(3200, 5200, 0.05), 2), {
        rate: 700,
        length: 0.0007,
        floor: 0.3,
      });
      p.noise(0.048, 0.9, hit(0.0002, 0.003), bp(4300, 3));
      p.tone(0.048, 0.25, hit(0.0002, 0.0025), 2100);
      p.noise(0.085, 0.4, swell(0.09, 0.3), bp(glide(1200, 2600, 0.08), 1.4));
      p.noise(0.085, 0.35, hit(0.001, 0.014), bp(500, 3));
    },
  },
  letter: {
    like: 'A cardboard letter drops into the type case: a light woody tick',
    level: 0.42,
    rank: 1,
    takes: 3,
    draw(p) {
      p.noise(0, 0.8, hit(0.0003, 0.004), bp(1900, 3));
      p.noise(0, 0.6, hit(0.0006, 0.009), bp(760, 5));
    },
  },
  punch: {
    like: 'A hole punch bites through the paper strip: a tight "tk", and the note of that hole rings at once',
    level: 0.42,
    rank: 2,
    takes: 2,
    draw(p) {
      p.noise(0, 0.9, hit(0.0005, 0.008), bp(420, 2.5));
      p.tone(0, 0.3, hit(0.0005, 0.007), 210);
      p.noise(0.006, 0.6, hit(0.0002, 0.0025), hp(3000));
    },
    comb: (pitch) => [{ hz: SCALE_HZ[0] * pitch, at: 0.012, gain: 0.7 }],
  },
  spring: {
    like: 'A folded paper spring lets go: a fast fluttering "frrr" that dies away',
    level: 0.5,
    rank: 2,
    takes: 2,
    draw(p) {
      for (let i = 0; i < 10; i++) {
        p.noise(i * 0.026, 0.9 * 0.74 ** i, hit(0.0004, 0.006), bp(i % 2 ? 1250 : 1650, 4));
      }
      p.noise(0, 0.15, hit(0.003, 0.05), bp(1400, 0.8));
    },
  },
  stamp: {
    like: 'A stamp pressed down with a thumb: a soft dull "pt" and a short rub to flatten it',
    level: 0.5,
    rank: 2,
    takes: 2,
    draw(p) {
      p.noise(0, 0.9, hit(0.0015, 0.014), lp(800));
      p.tone(0, 0.4, hit(0.002, 0.016), glide(240, 200, 0.03));
      p.noise(0.035, 0.25, swell(0.09, 0.4), bp(1700, 1), { rate: 800, length: 0.001, floor: 0.6 });
    },
  },
  postmark: {
    like: 'A rubber postmark comes down: the handle knocks, then the heavy thump on the table',
    level: 0.85,
    rank: 3,
    takes: 2,
    draw(p) {
      p.noise(0, 0.8, hit(0.0005, 0.008), bp(1100, 2));
      p.tone(0, 0.35, hit(0.0005, 0.008), glide(340, 300, 0.02));
      p.noise(0, 0.5, hit(0.0002, 0.002), hp(2500));
      p.tone(0.085, 1, hit(0.0015, 0.03), glide(140, 112, 0.04));
      p.tone(0.085, 0.4, hit(0.0015, 0.018), glide(280, 236, 0.04));
      p.noise(0.085, 0.8, hit(0.0006, 0.012), bp(600, 0.8));
      p.noise(0.085, 0.5, hit(0.0003, 0.003), bp(2400, 1.5));
    },
  },
  sent: {
    like: 'The envelope is off: a rising swish of paper through air, then two comb notes stepping up',
    level: 0.4,
    rank: 3,
    takes: 1,
    draw(p) {
      p.noise(0, 0.7, swell(0.3, 0.65), bp(glide(500, 3000, 0.28), 1), { rate: 600, length: 0.002, floor: 0.6 });
    },
    comb: () => [
      { hz: SCALE_HZ[3], at: 0.24, gain: 0.55 },
      { hz: SCALE_HZ[5], at: 0.39, gain: 0.65 },
    ],
  },
  crumple: {
    like: 'A paper scrap crushed into a ball: three squeezes of dense crackle',
    level: 0.8,
    rank: 2,
    takes: 2,
    draw(p) {
      const squeezes: [number, number, number][] = [
        [0.045, 0.035, 1],
        [0.175, 0.04, 0.8],
        [0.31, 0.05, 0.55],
      ];
      const env = shaped(plateau(0.004, 0.46, 0.06), (t) => {
        let v = 0;
        for (const [at, width, gain] of squeezes) v += gain * Math.exp(-(((t - at) / width) ** 2));
        return v;
      });
      p.noise(0, 0.9, env, [hp(900), bp(3000, 0.5)], { rate: 320, length: 0.0012, floor: 0.15 });
      p.noise(0, 0.7, env, bp(700, 0.8), { rate: 90, length: 0.004, floor: 0.1 });
    },
  },
  page: {
    like: 'A sheet of the tray turns over: a quick "fwip" up, a breath on its edge, a light slap down',
    level: 0.42,
    rank: 2,
    takes: 3,
    draw(p) {
      p.noise(0, 0.7, swell(0.095, 0.6), bp(glide(900, 2600, 0.09), 1.2));
      p.noise(0.115, 0.5, swell(0.08, 0.3), bp(glide(2400, 1100, 0.08), 1.2));
      p.noise(0.195, 0.45, hit(0.0005, 0.007), lp(1400));
    },
  },
  error: {
    like: 'Two low, muffled comb notes, the second lower: a polite "no", never loud',
    level: 0.48,
    rank: 2,
    takes: 1,
    draw(p) {
      const tooth = (at: number, hz: number, tau: number, gain: number): void => {
        p.tone(at, gain, hit(0.006, tau), hz);
        p.tone(at, gain * 0.35, hit(0.006, tau * 0.6), hz * 2);
        p.tone(at, gain * 0.12, hit(0.006, tau * 0.4), hz * 3);
        p.tone(at, gain * 0.05, hit(0.001, 0.008), hz * 6.27);
        p.noise(at, gain * 0.2, hit(0.002, 0.008), lp(500));
      };
      tooth(0, C4, 0.045, 0.9);
      tooth(0.15, G3, 0.055, 1);
    },
  },
};

export const SOUND_NAMES = Object.keys(PALETTE) as SoundName[];

export type LoopPatch = {
  like: string;
  /** Peak of the loop buffer at full intensity. */
  level: number;
  /** Loop length in seconds. Any tremolo in the recipe fits it a whole number of times. */
  span: number;
  draw(p: Pen, span: number): void;
  /** How hand speed (0…1) plays the loop: gain, low-pass cutoff in Hz, playback rate. */
  shape(intensity: number): { gain: number; cutoff: number; rate: number };
};

const steady = (span: number): Env => ({ span, at: () => 1 });
const pulse = (hz: number, depth: number, sharp: number) => (t: number) =>
  1 - depth + depth * Math.pow(0.5 - 0.5 * Math.cos(Math.PI * 2 * hz * t), sharp);

export const LOOPS: Record<LoopName, LoopPatch> = {
  snip: {
    like: 'Scissors working through card: a crisp gritty "shk-shk", faster and brighter with a quick hand',
    level: 0.45,
    span: 1,
    draw(p, span) {
      p.noise(0, 1, shaped(steady(span), pulse(9, 0.45, 2)), [hp(1800), bp(4200, 0.8)], {
        rate: 260,
        length: 0.001,
        floor: 0.25,
      });
    },
    shape: (i) => ({ gain: i ** 0.8, cutoff: 2500 + 6500 * i, rate: 0.85 + 0.4 * i }),
  },
  ink: {
    like: 'A felt pen moving on paper: a low even whisper that swells on a fast stroke',
    level: 0.2,
    span: 1.2,
    draw(p, span) {
      p.noise(0, 1, steady(span), [hp(500), bp(1500, 0.7)], { rate: 1500, length: 0.0008, floor: 0.75 });
    },
    shape: (i) => ({ gain: i ** 0.7, cutoff: 1200 + 3000 * i, rate: 0.9 + 0.25 * i }),
  },
  tab: {
    like: 'A paper pull tab dragged through its slot: dry card friction with a fine stick-slip shiver',
    level: 0.34,
    span: 1,
    draw(p, span) {
      p.noise(0, 1, shaped(steady(span), pulse(32, 0.5, 1)), bp(900, 1), { rate: 150, length: 0.0025, floor: 0.5 });
      p.noise(0, 0.35, steady(span), bp(2600, 1.5), { rate: 60, length: 0.002, floor: 0.2 });
    },
    shape: (i) => ({ gain: i ** 0.8, cutoff: 900 + 2600 * i, rate: 0.8 + 0.5 * i }),
  },
};

export const LOOP_NAMES = Object.keys(LOOPS) as LoopName[];

/** Collects what a recipe draws into a list of layers. */
export function layersOf(draw: (p: Pen) => void): Layer[] {
  const layers: Layer[] = [];
  draw({
    noise: (at, gain, env, band, grain) =>
      layers.push({ kind: 'noise', at, gain, env, band: Array.isArray(band) ? band : [band], grain }),
    tone: (at, gain, env, freq) => layers.push({ kind: 'tone', at, gain, env, freq }),
  });
  return layers;
}
