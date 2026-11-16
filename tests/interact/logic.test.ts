/**
 * Rules of the hand actions without a browser (task 01.3.3): thresholds, hysteresis, the
 * return of a dropped object, the double pinch, dwell timing, who may take what, and the
 * target under a pointer.
 */
import { describe, expect, it } from 'vitest';
import {
  DwellState,
  Holds,
  Hysteresis,
  LossTimer,
  PullState,
  RULES,
  RevealState,
  SelectGuard,
  liftOf,
  mousePull,
  pickSnap,
  pickTarget,
  pullProgress,
  smoothDir,
  turnOf,
  tween,
} from '../../src/interact/logic';

describe('pinch hysteresis', () => {
  it('turns on at the high threshold and off only under the low one', () => {
    const h = new Hysteresis(0.9, 0.7);
    expect([0.5, 0.89, 0.9, 0.8, 0.71, 0.69, 0.85].map((x) => h.update(x))).toEqual([false, false, true, true, true, false, false]);
  });
});

describe('one select per pinch', () => {
  it('drops a second select of the same target within 300 ms', () => {
    const g = new SelectGuard();
    expect(g.accept('a', 0)).toBe(true);
    expect(g.accept('a', 299)).toBe(false);
    expect(g.accept('b', 100)).toBe(true);
    expect(g.accept('a', 300)).toBe(true);
  });
});

describe('who holds what', () => {
  it('lets a second hand never take what the first holds', () => {
    const h = new Holds();
    expect(h.take('slip', 'right')).toBe(true);
    expect(h.take('slip', 'left')).toBe(false);
    expect(h.holder('slip')).toBe('right');
    h.release('slip');
    expect(h.take('slip', 'left')).toBe(true);
  });

  it('pulls one thread at a time', () => {
    const h = new Holds();
    expect(h.startPull('thread-a', 'right')).toBe(true);
    expect(h.startPull('thread-b', 'left')).toBe(false);
    expect(h.startPull('thread-a', 'left')).toBe(false);
    h.endPull('thread-a');
    expect(h.startPull('thread-b', 'left')).toBe(true);
  });
});

describe('lost tracking', () => {
  it('lets go after 0.5 s without the hand, not before; tracking back resets', () => {
    const l = new LossTimer();
    expect(l.update(false, 0)).toBe(false);
    expect(l.update(false, 499)).toBe(false);
    expect(l.update(true, 450)).toBe(false);
    expect(l.update(false, 600)).toBe(false);
    expect(l.update(false, 1101)).toBe(true);
  });
});

describe('drop: snap or return', () => {
  const targets = [
    { target: 'stake', at: [0, 0, -0.46] as const, radius: 0.08 },
    { target: 'tray', at: [0.3, 0, -0.46] as const, radius: 0.08 },
  ];
  it('snaps to the nearest target within its radius', () => {
    expect(pickSnap([0.02, 0.03, -0.45], targets)?.target).toBe('stake');
    expect(pickSnap([0.26, 0, -0.46], targets)?.target).toBe('tray');
  });
  it('misses outside every radius', () => {
    expect(pickSnap([0.15, 0, -0.46], targets)).toBeNull();
    expect(pickSnap([0, 0.081, -0.46], targets)).toBeNull();
  });
  it('travels home in 400 ms and stays there', () => {
    const from = [0.2, 0.1, -0.3] as const;
    const home = [0, 0, -0.5] as const;
    expect(tween(from, home, 0, RULES.returnMs)).toEqual([0.2, 0.1, -0.3]);
    const mid = tween(from, home, 200, RULES.returnMs);
    expect(mid[0]).toBeLessThan(0.2);
    expect(mid[0]).toBeGreaterThan(0);
    expect(tween(from, home, 400, RULES.returnMs)).toEqual([0, 0, -0.5]);
    expect(tween(from, home, 900, RULES.returnMs)).toEqual([0, 0, -0.5]);
  });
});

describe('pull', () => {
  const toward = [0, 0, 1] as const; // the seat is behind the bead, along +Z
  it('measures only the wrist travel along the axis toward the seat', () => {
    expect(pullProgress([0, 0, 0], [0, 0, 0.075], toward)).toBeCloseTo(0.5, 6);
    expect(pullProgress([0, 0, 0], [0.2, 0.1, 0.075], toward)).toBeCloseTo(0.5, 6);
    expect(pullProgress([0, 0, 0], [0, 0, -0.1], toward)).toBe(0);
    expect(pullProgress([0, 0, 0], [0, 0, 0.4], toward)).toBe(1);
  });
  it('commits once at 15 cm and cancels when let go before', () => {
    const p = new PullState();
    expect(p.update(0.5)).toBeNull();
    expect(p.release()).toBe('cancel');
    const q = new PullState();
    expect(q.update(0.99)).toBeNull();
    expect(q.update(1)).toBe('commit');
    expect(q.update(1)).toBeNull();
    expect(q.release()).toBe('done');
  });
  it('takes a drag of 120 px down the screen as the whole pull', () => {
    expect(mousePull(60)).toBeCloseTo(0.5, 6);
    expect(mousePull(120)).toBe(1);
    expect(mousePull(-40)).toBe(0);
  });
});

describe('reveal', () => {
  it('opens at 6 cm of lift without any turn', () => {
    const r = new RevealState();
    expect(r.update(0.059, 0)).toBeNull();
    expect(r.update(0.06, 0)).toBe('open');
  });
  it('opens at 60° of turn without lift', () => {
    const r = new RevealState();
    expect(r.update(0, 59)).toBeNull();
    expect(r.update(0, 60)).toBe('open');
  });
  it('closes only under 3 cm and 35° together (hysteresis)', () => {
    const r = new RevealState();
    r.update(0.07, 0);
    expect(r.update(0.04, 0)).toBeNull();
    expect(r.update(0.02, 40)).toBeNull();
    expect(r.update(0.029, 34)).toBe('close');
  });
  it('folds when let go', () => {
    const r = new RevealState();
    r.update(0.08, 0);
    expect(r.release()).toBe('close');
    expect(r.release()).toBeNull();
  });
  it('counts a lift up and a lift toward the eyes, not a move away', () => {
    const eye = [0, 0, 0] as const;
    const start = [0, -0.3, -0.45] as const;
    expect(liftOf(start, [0, -0.24, -0.45], eye)).toBeCloseTo(0.06, 6);
    expect(liftOf(start, [0, -0.3, -0.33], eye)).toBeCloseTo(0.06, 6);
    expect(liftOf(start, [0, -0.3, -0.6], eye)).toBe(0);
    expect(liftOf(start, [0, -0.35, -0.45], eye)).toBe(0);
  });
  it('measures the turn of the sheet normal; spinning flat is no turn', () => {
    expect(turnOf([0, 1, 0], [0, 1, 0])).toBeCloseTo(0, 6);
    expect(turnOf([0, 1, 0], [Math.sin(Math.PI / 3), Math.cos(Math.PI / 3), 0])).toBeCloseTo(60, 4);
  });
});

describe('dwell', () => {
  it('arms for 250 ms, fills for the dwell time, then selects once and rests for 1 s', () => {
    const d = new DwellState(800);
    expect(d.update('button', 0)).toBeNull();
    expect(d.phase).toBe('arming');
    expect(d.update('button', 249)).toBeNull();
    expect(d.update('button', 650)).toBeNull();
    expect(d.phase).toBe('filling');
    expect(d.fill(650)).toBeCloseTo(0.5, 3);
    expect(d.update('button', 1050)).toBe('button');
    expect(d.update('button', 1500)).toBeNull();
    expect(d.phase).toBe('cooldown');
    expect(d.update('button', 2049)).toBeNull();
  });
  it('starts over when the pointer leaves before the ring is full', () => {
    const d = new DwellState(800);
    d.update('button', 0);
    d.update('button', 900);
    d.update(null, 950);
    expect(d.phase).toBe('idle');
    d.update('button', 1000);
    expect(d.update('button', 1900)).toBeNull();
    expect(d.update('button', 2050)).toBe('button');
  });
  it('follows the setting: slower and faster dwell', () => {
    for (const ms of [600, 800, 1200]) {
      const d = new DwellState(ms);
      d.update('t', 0);
      expect(d.update('t', 250 + ms - 1)).toBeNull();
      expect(d.update('t', 250 + ms)).toBe('t');
    }
  });
});

describe('the target under a pointer', () => {
  const origin = [0, 0, 0] as const;
  const ahead = [0, 0, -1] as const;
  it('gives a small far target a hit volume of 2.2°', () => {
    const bead = { target: 'bead', center: [0.02, 0, -1.3] as const, radius: 0.015 };
    // 0.88° off its centre: outside the bead itself (0.66°), inside the 1.1° half-cone.
    expect(pickTarget(origin, ahead, [bead])).toBe('bead');
    const off = { ...bead, center: [0.03, 0, -1.3] as const };
    expect(pickTarget(origin, ahead, [off])).toBeNull();
  });
  it('picks the neighbour whose centre is closer to the ray', () => {
    const a = { target: 'a', center: [-0.01, 0, -0.6] as const, radius: 0.02 };
    const b = { target: 'b', center: [0.006, 0, -0.6] as const, radius: 0.02 };
    expect(pickTarget(origin, ahead, [a, b])).toBe('b');
  });
  it('does not pick a target behind a blocking panel', () => {
    const t = { target: 't', center: [0, 0, -1.2] as const, radius: 0.02 };
    expect(pickTarget(origin, ahead, [t], 2.2, 0.6)).toBeNull();
    expect(pickTarget(origin, ahead, [t], 2.2, 2)).toBe('t');
  });
  it('ignores what is behind the head', () => {
    expect(pickTarget(origin, ahead, [{ target: 'x', center: [0, 0, 1], radius: 0.5 }])).toBeNull();
  });
  it('smooths the head pointer toward the new direction', () => {
    const s = smoothDir([0, 0, -1], [1, 0, 0], 0.016);
    expect(s[0]).toBeGreaterThan(0);
    expect(s[0]).toBeLessThan(0.5);
    expect(Math.hypot(...s)).toBeCloseTo(1, 6);
  });
});
