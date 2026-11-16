import { describe, expect, it } from 'vitest';
import { Object3D, Vector3 } from '@iwsdk/core';
import type { Station } from '../../../src/agents/types';
import { createInstruments, routePoints, timeRoute } from '../../../src/kit/world/instrument';
import { createPath } from '../../../src/kit/world/path';
import { atTime } from '../../../src/kit/world/time';

const CASE: Station[] = [
  { id: 's1', step: 'read', label: 'Read', by: 'code' },
  { id: 's2', step: 'extract', label: 'Extract', by: 'model', role: 'extractor' },
  { id: 's3', step: 'verify', label: 'Check', by: 'code' },
  { id: 's4', step: 'reconcile', label: 'Reconcile', by: 'model', role: 'reconciler' },
  { id: 's5', step: 'assemble', label: 'Assemble', by: 'code' },
];

function scene() {
  const root = new Object3D();
  const path = createPath();
  const pool = createInstruments(null, 6);
  root.add(path.root, pool.root);
  atTime(0, () => path.setPlan(CASE));
  return { path, pool };
}

describe('instrument walks', () => {
  it('reaches Extract within 1.0 s and Reconcile within 1.6 s from the parking', () => {
    const { path } = scene();
    // Four extractors leave from the four places nearest the shelf.
    for (let p = 0; p < 4; p++) {
      for (let s = 0; s < 4; s++) {
        const { ms } = timeRoute(routePoints(path.parking(p), path.spot('s2', s)), 0);
        expect(ms, `parking ${p} → Extract spot ${s}`).toBeLessThanOrEqual(1000);
      }
    }
    // Two reconcilers leave from the two nearest places.
    for (let p = 0; p < 2; p++) {
      for (let s = 0; s < 4; s++) {
        const { ms } = timeRoute(routePoints(path.parking(p), path.spot('s4', s)), 0);
        expect(ms, `parking ${p} → Reconcile spot ${s}`).toBeLessThanOrEqual(1600);
      }
    }
  });

  it('keeps the last 10 cm at five steps of 5 cm a second', () => {
    const pts = [new Vector3(0, 0, -1.3), new Vector3(0.5, 0, -1.3)];
    const { legs, ms } = timeRoute(pts, 0);
    const tail = legs.filter((l) => l.tail);
    expect(tail.reduce((s, l) => s + l.from.distanceTo(l.to), 0)).toBeCloseTo(0.1, 5);
    expect(ms).toBeCloseTo((0.4 / 0.9) * 1000 + 400, 0);
  });

  it('places four at a station 11 cm apart, feet never overlapping', () => {
    const { path } = scene();
    const spots = [0, 1, 2, 3].map((i) => path.spot('s2', i));
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) expect(spots[a].distanceTo(spots[b])).toBeGreaterThanOrEqual(0.092 + 0.012);
  });

  it('burns exactly as many rings as calls are open', () => {
    const { path, pool } = scene();
    const calls = ['c1', 'c2', 'c3', 'c4'];
    const inst = calls.map((c, i) => atTime(100 + i, () => pool.spawn('extractor', c)));
    inst.forEach((x, i) => atTime(110, () => x.moveTo(path.spot('s2', i))));
    expect(pool.lit()).toBe(4);
    expect(pool.byCall('c3')).toBe(inst[2]);
    atTime(2000, () => inst[1].setCall(null));
    expect(pool.lit()).toBe(3);
    atTime(2100, () => inst[1].fold());
    pool.update(5000);
    expect(pool.lit()).toBe(3);
    expect(pool.byCall('c2')).toBeNull();
  });

  it('waits short of instruments standing on the lane and goes on when they leave', () => {
    const { path, pool } = scene();
    const a = atTime(0, () => pool.spawn('extractor', 'a'));
    const b = atTime(0, () => pool.spawn('extractor', 'b'));
    atTime(0, () => a.moveTo(path.spot('s2', 2)));
    atTime(0, () => b.moveTo(path.spot('s2', 3)));
    pool.update(3000);
    const r = atTime(3000, () => pool.spawn('reconciler', 'r'));
    atTime(3000, () => r.moveTo(path.spot('s4', 0)));
    pool.update(6000);
    expect(atTime(6000, () => r.state)).toBe('waiting');
    const waitAt = atTime(6000, () => r.position());
    expect(Math.atan2(waitAt.x, -waitAt.z) * (180 / Math.PI)).toBeLessThan(-13);
    atTime(6000, () => {
      a.fold();
      b.fold();
    });
    for (let t = 6000; t <= 12000; t += 100) pool.update(t);
    const end = atTime(12000, () => r.position());
    expect(end.distanceTo(path.spot('s4', 0))).toBeLessThan(0.001);
  });
});
