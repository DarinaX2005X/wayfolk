/**
 * The sixteen sounds of Groundwork measured on their rendered samples (DESIGN "Движение и
 * ограничения", task 01.3.4): length, level, band of the noise, notes from the pentatonic,
 * the one envelope, the rise of the tile note and the air of the Void.
 */
import { describe, expect, it } from 'vitest';
import { layersOf, PALETTE, SOUND_NAMES, AIR, degreeOf, type SoundName } from '../../src/feel/sound/palette';
import { SAMPLE_RATE, airSwing, mixdown, renderAir, renderSound } from '../../src/feel/sound/render';
import { C4, inPentatonic, penta, tileDegree } from '../../src/feel/sound/scale';
import { bandShare, dB, envelope, peak, strongestHz } from './measure';

const sr = SAMPLE_RATE;

/** The table of the task, verbatim: length ms, level dB, noise band or notes. */
const TABLE: Record<SoundName, { ms: number; db: number; band?: [number, number]; notes?: number[] }> = {
  knock: { ms: 90, db: -20, band: [1000, 3000], notes: [196] },
  grab: { ms: 70, db: -26, band: [800, 3000] },
  drop: { ms: 110, db: -22, notes: [262] },
  paper: { ms: 220, db: -28, band: [1000, 4000] },
  stake: { ms: 160, db: -22 },
  line: { ms: 240, db: -28, notes: [294] },
  tap: { ms: 60, db: -26, notes: [587] },
  tile: { ms: 180, db: -24 },
  stamp: { ms: 140, db: -18, band: [300, 1500] },
  flip: { ms: 160, db: -27, band: [600, 3500] },
  ask: { ms: 420, db: -24, notes: [392, 587] },
  bloom: { ms: 900, db: -20 },
  select: { ms: 50, db: -28, notes: [784] },
  slide: { ms: 300, db: -30, band: [400, 1600] },
  fold: { ms: 260, db: -26, band: [1000, 3000] },
};

/** Start frequency of every tone layer of a recipe. */
function toneStarts(name: SoundName, degree = 0): number[] {
  return layersOf((p) => PALETTE[name].draw(p, degree), { noise: false }).map((l) => {
    const f = (l as { freq: number | ((t: number) => number) }).freq;
    return typeof f === 'number' ? f : f(0);
  });
}

describe('the palette of Groundwork', () => {
  it('has exactly the sixteen sounds of DESIGN (fifteen voices and the air)', () => {
    expect([...SOUND_NAMES].sort()).toEqual(Object.keys(TABLE).sort());
    expect(SOUND_NAMES.length + 1).toBe(16);
    for (const name of SOUND_NAMES) expect(PALETTE[name].like.length).toBeGreaterThan(20);
  });

  it.each(SOUND_NAMES)('%s lasts as long as the table says (±20 %)', (name) => {
    const x = renderSound(name, { degree: 3 });
    const ms = (x.length / sr) * 1000;
    expect(ms).toBeGreaterThan(TABLE[name].ms * 0.8);
    expect(ms).toBeLessThan(TABLE[name].ms * 1.2);
  });

  it.each(SOUND_NAMES)('%s peaks at its level in dBFS, and nothing is above −18 dB', (name) => {
    const x = renderSound(name, { degree: 3 });
    expect(dB(peak(x))).toBeCloseTo(TABLE[name].db, 1);
    expect(dB(peak(x))).toBeLessThanOrEqual(-18 + 1e-6);
  });

  it.each(SOUND_NAMES)('%s has one envelope: an attack of 8 ms at most, then an exponential fall', (name) => {
    const x = renderSound(name, { degree: 3 });
    // Within 8 ms (and the 2 ms of the meter) the sound is already within 3 dB of its loudest
    // moment: paper grains flicker on top of the envelope, so the very top can come later.
    const env = envelope(x, sr, 2);
    const top = peak(env);
    let reached = env.length;
    for (let i = 0; i < env.length; i++) {
      if (env[i] >= top * 10 ** (-3 / 20)) {
        reached = i;
        break;
      }
    }
    expect((reached / sr) * 1000).toBeLessThanOrEqual(10);
    // Every layer is drawn with an attack of at most 8 ms.
    for (const l of layersOf((p) => PALETTE[name].draw(p, 3))) {
      const at = l.env.at.bind(l.env);
      let peakAt = 0;
      for (let t = 0; t < 0.02; t += 0.0001) if (at(t) > at(peakAt)) peakAt = t;
      expect(peakAt).toBeLessThanOrEqual(0.0081);
      // And after the peak it only falls.
      expect(at(peakAt + 0.01)).toBeLessThanOrEqual(at(peakAt) + 1e-9);
    }
  });

  it.each(SOUND_NAMES.filter((n) => TABLE[n].band))('%s keeps its noise in its band and inside 300–4000 Hz', (name) => {
    const [lo, hi] = TABLE[name].band!;
    expect(PALETTE[name].band).toEqual([lo, hi]);
    const noise = renderSound(name, { degree: 3, part: 'noise' });
    // Two poles each side: most of the energy sits in the band, almost none outside 300–4000 Hz.
    expect(bandShare(noise, sr, lo * 0.7, hi * 1.4)).toBeGreaterThan(0.85);
    expect(bandShare(noise, sr, 250, 4800)).toBeGreaterThan(0.95);
  });

  it.each(SOUND_NAMES)('%s takes its notes only from the pentatonic', (name) => {
    for (const degree of [0, 3, 7, 10]) {
      for (const f of toneStarts(name, degree)) {
        // The stamp sounds a fourth under the note of the tiles: a fourth below a pentatonic note.
        const note = name === 'stamp' ? f / 0.75 : f;
        expect(inPentatonic(note), `${name} ${f.toFixed(1)} Hz`).toBe(true);
      }
    }
  });

  it('plays the fixed notes of the table', () => {
    for (const name of SOUND_NAMES) {
      const want = TABLE[name].notes;
      if (!want) continue;
      const got = toneStarts(name);
      for (const hz of want) expect(got.some((f) => Math.abs(f - hz) / hz < 0.01), `${name} has ${hz} Hz`).toBe(true);
    }
    // The drop falls a third, from 262 to 208 Hz; the line rises a fifth, 294 to 440 Hz.
    const glide = (name: SoundName, t: number): number => {
      const l = layersOf((p) => PALETTE[name].draw(p, 0), { noise: false })[0] as { freq: (t: number) => number };
      return l.freq(t);
    };
    expect(glide('drop', 1)).toBeCloseTo(208, 0);
    expect(glide('line', 1)).toBeCloseTo(penta(4), 0);
    expect(penta(4)).toBeCloseTo(440, 1);
  });

  it('raises the tile one pentatonic step every tenth of the plot laid, 0 to 100 %', () => {
    let before = 0;
    for (let k = 0; k <= 10; k++) {
      const share = k / 10;
      expect(tileDegree(share)).toBe(k);
      expect(degreeOf('tile', share)).toBe(k);
      const x = renderSound('tile', { degree: degreeOf('tile', share), part: 'tones' });
      const hz = strongestHz(x, sr, 200, 1200);
      expect(Math.abs(hz - penta(k)) / penta(k)).toBeLessThan(0.02);
      expect(hz).toBeGreaterThan(before);
      before = hz;
    }
    expect(penta(0)).toBeCloseTo(C4, 6);
    expect(penta(10)).toBeCloseTo(C4 * 4, 3);
  });

  it('puts the stamp a fourth under the note the tiles have reached', () => {
    for (const share of [0, 0.35, 0.8]) {
      const d = degreeOf('stamp', share);
      const x = renderSound('stamp', { degree: d, part: 'tones' });
      const hz = strongestHz(x, sr, 150, 1200);
      expect(hz / penta(d)).toBeCloseTo(0.75, 2);
    }
  });

  it('gives the five stakes the first five steps of the scale, left to right', () => {
    const got = [0, 0.25, 0.5, 0.75, 1].map((v) => degreeOf('stake', v));
    expect(got).toEqual([0, 1, 2, 3, 4]);
  });

  it('resolves the bloom to the tonic: E, D, C', () => {
    expect(toneStarts('bloom').slice(0, 3).map((f) => Math.round(f))).toEqual([659, 587, 523]);
  });

  it('keeps three voices at their loudest together under −8 dBFS', () => {
    const loud = (['stamp', 'bloom', 'knock'] as SoundName[]).map((n) => ({ samples: renderSound(n, { degree: 4 }) }));
    expect(dB(peak(mixdown(loud)))).toBeLessThan(-8);
  });
});

describe('the air of the Void', () => {
  const air = renderAir();
  it('is low pink noise under 500 Hz at −36 dB', () => {
    expect(dB(peak(air))).toBeCloseTo(AIR.db, 1);
    expect(bandShare(air, sr, 0, 700)).toBeGreaterThan(0.95);
  });
  it('loops without a seam', () => {
    const a = air[air.length - 1];
    const b = air[0];
    expect(Math.abs(a - b)).toBeLessThan(peak(air) * 0.2);
  });
  it('breathes ±2 dB with a period of 14 s', () => {
    expect(dB(airSwing(AIR.periodS / 4))).toBeCloseTo(2, 3);
    expect(dB(airSwing((AIR.periodS * 3) / 4))).toBeCloseTo(-2, 3);
    expect(airSwing(0)).toBeCloseTo(airSwing(AIR.periodS), 9);
  });
});
