import { beforeEach, describe, expect, it, vi } from 'vitest';

// The setting lives in the app store; here it is a plain switch so that the spring
// tests do not depend on storage. tests/feel/motion.test.ts checks the real wiring.
const settings = vi.hoisted(() => ({ value: { sound: true, lessMotion: false } }));
vi.mock('../../src/app/store', () => ({ store: { settings } }));

import {
  SETTLE_OVERSHOOT_DEG,
  SETTLE_SECONDS,
  SNAP_SECONDS,
  Spring,
  WOBBLE_HZ,
  WOBBLE_SECONDS,
  WOBBLE_SWING_DEG,
  springs,
  tuned,
} from '../../src/feel/spring';

/** Frame lengths of real devices, from a 120 Hz headset down to a 20 fps stall. */
const FRAMES = [1 / 120, 1 / 90, 1 / 72, 1 / 60, 1 / 30, 0.05];

type Run = { values: number[]; times: number[] };

function run(s: Spring, dt: number, seconds: number): Run {
  const values: number[] = [];
  const times: number[] = [];
  for (let t = dt; t <= seconds + 1e-9; t += dt) {
    values.push(s.step(dt));
    times.push(t);
  }
  return { values, times };
}

/** Largest distance from `target` at or after `from` seconds. */
function errorAfter(r: Run, target: number, from: number): number {
  let worst = 0;
  r.times.forEach((t, i) => {
    if (t >= from - 1e-9) worst = Math.max(worst, Math.abs(r.values[i] - target));
  });
  return worst;
}

beforeEach(() => {
  settings.value.lessMotion = false;
});

describe('Spring', () => {
  it('keeps the contract shape: stiffness, damping, target, value, step', () => {
    const s = new Spring(400, 20);
    expect(s.target).toBe(0);
    expect(s.value).toBe(0);
    s.target = 1;
    expect(s.step(1 / 60)).toBe(s.value);
    expect(s.value).toBeGreaterThan(0);
  });

  it('stays stable on a 50 ms frame for every preset and for a very stiff spring', () => {
    for (const make of [springs.settle, springs.wobble, springs.snap, () => new Spring(250_000, 100)]) {
      const s = make();
      s.value = 30;
      s.target = 0;
      const r = run(s, 0.05, 3);
      expect(r.values.every(Number.isFinite)).toBe(true);
      expect(Math.max(...r.values.map(Math.abs))).toBeLessThanOrEqual(30);
      expect(Math.abs(s.value)).toBeLessThan(0.03);
    }
  });

  it('ignores a frame of zero, negative or broken length', () => {
    const s = springs.settle();
    s.value = 10;
    s.target = 90;
    for (const dt of [0, -0.016, NaN]) expect(s.step(dt)).toBe(10);
  });

  it('is at rest on its target after a pause far longer than any motion', () => {
    const s = springs.settle();
    s.value = 10;
    s.velocity = 500;
    s.target = 90;
    expect(s.step(5)).toBe(90);
    expect(s.velocity).toBe(0);
    expect(s.resting()).toBe(true);
  });

  it('continues from its current value and speed when the target changes mid-flight', () => {
    const s = springs.settle();
    s.target = 90;
    run(s, 1 / 90, 0.06);
    const value = s.value;
    const velocity = s.velocity;
    expect(velocity).toBeGreaterThan(0);
    s.target = 0;
    s.step(1 / 90);
    // One frame later it has not jumped: it is still close and still carries its speed.
    expect(Math.abs(s.value - value)).toBeLessThan(Math.abs(velocity) / 90 + 1);
    expect(s.velocity).toBeLessThan(velocity);
    const r = run(s, 1 / 90, 1);
    expect(errorAfter(r, 0, 0.6)).toBeLessThan(0.05);
  });

  it('tuned() gives the asked settling time for a plain Spring too', () => {
    const { stiffness, damping } = tuned(0.4, 0.6);
    const s = new Spring(stiffness, damping);
    s.target = 1;
    expect(errorAfter(run(s, 1 / 60, 1.2), 1, 0.4)).toBeLessThan(0.001);
  });
});

describe('springs.settle: an angle comes to its stop', () => {
  it.each(FRAMES)('is within 0.1 %% of the travel from 250 ms on (frame %f s)', (dt) => {
    for (const [from, to] of [
      [0, 90],
      [70, 90],
      [35, 0],
      [88, 90],
    ]) {
      const s = springs.settle();
      s.jump(from);
      s.target = to;
      const r = run(s, dt, 1);
      expect(errorAfter(r, to, SETTLE_SECONDS)).toBeLessThan(Math.abs(to - from) * 0.001);
    }
  });

  it('overshoots the stop, by at most 4 degrees on the longest travel', () => {
    for (const dt of FRAMES) {
      const s = springs.settle();
      s.target = 90;
      const top = Math.max(...run(s, dt, 1).values);
      expect(top).toBeGreaterThan(92);
      expect(top).toBeLessThanOrEqual(90 + SETTLE_OVERSHOOT_DEG);
    }
  });

  it('never swings more than 4 degrees past the stop, however fast the hand threw the cover', () => {
    for (const dt of FRAMES) {
      for (const speed of [600, 3000, 20_000]) {
        const open = springs.settle();
        open.jump(80);
        open.velocity = speed;
        open.target = 90;
        expect(Math.max(...run(open, dt, 1).values)).toBeLessThanOrEqual(90 + SETTLE_OVERSHOOT_DEG + 1e-6);
        expect(Math.abs(open.value - 90)).toBeLessThan(0.01);

        const shut = springs.settle();
        shut.jump(10);
        shut.velocity = -speed;
        shut.target = 0;
        expect(Math.min(...run(shut, dt, 1).values)).toBeGreaterThanOrEqual(-SETTLE_OVERSHOOT_DEG - 1e-6);
        expect(Math.abs(shut.value)).toBeLessThan(0.01);
      }
    }
  });

  it('treats a new far target as travel, not as overshoot', () => {
    const s = springs.settle();
    s.target = 90;
    run(s, 1 / 90, 0.12);
    expect(s.value).toBeGreaterThan(90);
    s.target = 0;
    const r = run(s, 1 / 90, 1);
    expect(Math.min(...r.values)).toBeGreaterThanOrEqual(-SETTLE_OVERSHOOT_DEG - 1e-6);
    expect(Math.abs(s.value)).toBeLessThan(0.01);
  });
});

describe('springs.wobble: a piece on a paper spring', () => {
  it.each(FRAMES)('is still within 0.1 %% of its swing from 1.2 s on (frame %f s)', (dt) => {
    const s = springs.wobble();
    s.value = WOBBLE_SWING_DEG;
    const r = run(s, dt, 2.4);
    expect(errorAfter(r, 0, WOBBLE_SECONDS)).toBeLessThan(WOBBLE_SWING_DEG * 0.001);
  });

  it('swings to and fro at about 4 Hz, each swing smaller than the one before', () => {
    const s = springs.wobble();
    s.value = WOBBLE_SWING_DEG;
    const r = run(s, 1 / 240, 1.2);
    const crossings: number[] = [];
    const peaks: number[] = [];
    let extreme = 0;
    for (let i = 1; i < r.values.length; i++) {
      extreme = Math.max(extreme, Math.abs(r.values[i]));
      if (r.values[i - 1] * r.values[i] < 0) {
        crossings.push(r.times[i]);
        if (crossings.length > 1) peaks.push(extreme);
        extreme = 0;
      }
    }
    expect(crossings.length).toBeGreaterThanOrEqual(8);
    const period = (crossings[4] - crossings[0]) / 2;
    expect(1 / period).toBeGreaterThan(WOBBLE_HZ * 0.92);
    expect(1 / period).toBeLessThan(WOBBLE_HZ * 1.08);
    for (let i = 1; i < 5; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1] * 0.6);
  });

  it('never swings past 14 degrees, even from a hard push', () => {
    for (const dt of FRAMES) {
      const s = springs.wobble();
      s.velocity = 9000;
      const r = run(s, dt, 2);
      expect(Math.max(...r.values.map(Math.abs))).toBeLessThanOrEqual(WOBBLE_SWING_DEG + 1e-6);
      expect(Math.abs(s.value)).toBeLessThan(0.02);
    }
  });
});

describe('springs.snap: the click to the 5 mm grid', () => {
  it.each(FRAMES)('is within 0.1 %% of the step from 60 ms on (frame %f s)', (dt) => {
    const s = springs.snap();
    s.target = 5;
    expect(errorAfter(run(s, dt, 0.5), 5, SNAP_SECONDS)).toBeLessThan(0.005);
  });

  it('has only a hint of overshoot', () => {
    const s = springs.snap();
    s.target = 5;
    const top = Math.max(...run(s, 1 / 1000, 0.3).values);
    expect(top).toBeGreaterThan(5);
    expect(top).toBeLessThan(5 * 1.03);
  });
});

describe('"Less motion"', () => {
  beforeEach(() => {
    settings.value.lessMotion = true;
  });

  it.each(FRAMES)('settle and snap arrive on time and never pass the target (frame %f s)', (dt) => {
    for (const [make, from, to, seconds] of [
      [springs.settle, 0, 90, SETTLE_SECONDS],
      [springs.settle, 70, 0, SETTLE_SECONDS],
      [springs.snap, 0, 5, SNAP_SECONDS],
    ] as const) {
      const s = make();
      s.jump(from);
      s.target = to;
      const r = run(s, dt, 1);
      const side = Math.sign(to - from);
      for (const v of r.values) expect((v - to) * side).toBeLessThanOrEqual(0);
      expect(errorAfter(r, to, seconds)).toBeLessThan(Math.abs(to - from) * 0.001);
      expect(s.value).toBe(to);
    }
  });

  it('a thrown cover stops at the stop instead of passing it', () => {
    for (const dt of FRAMES) {
      const s = springs.settle();
      s.jump(80);
      s.velocity = 5000;
      s.target = 90;
      const r = run(s, dt, 0.5);
      expect(Math.max(...r.values)).toBeLessThanOrEqual(90);
      expect(s.value).toBe(90);
      expect(s.velocity).toBe(0);
    }
  });

  it('a wobble does not move at all', () => {
    const s = springs.wobble();
    s.velocity = 4000;
    const r = run(s, 1 / 90, 1);
    expect(r.values.every((v) => v === 0)).toBe(true);
    s.value = 9;
    expect(s.step(1 / 90)).toBe(0);
  });

  it('ends on the same value as with full motion', () => {
    const calm = springs.settle();
    calm.jump(20);
    calm.target = 90;
    run(calm, 1 / 72, 1.5);
    settings.value.lessMotion = false;
    const lively = springs.settle();
    lively.jump(20);
    lively.target = 90;
    run(lively, 1 / 72, 1.5);
    expect(calm.value).toBe(90);
    expect(lively.value).toBeCloseTo(90, 5);
  });

  it('is read on every step: a spring made earlier obeys a switch flipped later', () => {
    settings.value.lessMotion = false;
    const s = springs.settle();
    s.target = 90;
    run(s, 1 / 90, 0.05);
    settings.value.lessMotion = true;
    const r = run(s, 1 / 90, 1);
    expect(Math.max(...r.values)).toBeLessThanOrEqual(90);
    expect(s.value).toBe(90);
  });
});
