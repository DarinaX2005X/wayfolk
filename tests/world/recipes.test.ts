import { describe, expect, it } from 'vitest';
import type { HouseSpec, Trade } from '../../src/mind/types';
import { TRADES } from '../../src/mind/types';
import { STAGES, planHouse } from '../../src/world/recipes';

const spec = (recipe: Trade, extra: Partial<HouseSpec> = {}): HouseSpec => ({
  id: `house-${recipe}`,
  residentId: 'r1',
  recipe,
  pos: { x: 0, z: -8 },
  rotY: 0,
  colors: { wall: '#f3e2c4', roof: '#c8553d', trim: '#8a5a3b' },
  props: [],
  sign: 'Test',
  builtAt: 0,
  ...extra,
});

describe('house recipes', () => {
  it('every trade gives a non-empty plan in assembly order', () => {
    for (const trade of TRADES) {
      const plan = planHouse(spec(trade));
      expect(plan.pieces.length, trade).toBeGreaterThan(8);
      const order = plan.pieces.map((p) => STAGES.indexOf(p.stage));
      for (let i = 1; i < order.length; i++) expect(order[i], `${trade} piece ${i}`).toBeGreaterThanOrEqual(order[i - 1]);
      const stages = new Set(plan.pieces.map((p) => p.stage));
      for (const s of ['foundation', 'walls', 'roof', 'details'] as const) expect(stages.has(s), `${trade} has ${s}`).toBe(true);
      for (const p of plan.pieces) {
        expect(p.geo.getAttribute('position').count, `${trade} ${p.name}`).toBeGreaterThan(0);
        expect(p.geo.getAttribute('color').itemSize).toBe(4);
        expect(p.pos.every(Number.isFinite)).toBe(true);
      }
      expect(plan.radius).toBeGreaterThan(1);
      expect(plan.height).toBeGreaterThan(2);
      expect(plan.door[2], `${trade} door in front`).toBeGreaterThan(0);
    }
  });

  it('foundations come first and walls go up after them', () => {
    const plan = planHouse(spec('baker'));
    expect(plan.pieces[0].stage).toBe('foundation');
    expect(plan.pieces.filter((p) => p.stage === 'walls').length).toBeGreaterThan(1);
  });

  it('puts the spec props round the yard as the last pieces', () => {
    const plan = planHouse(spec('fisher', { props: ['lantern', 'telescope'] }));
    const props = plan.pieces.filter((p) => p.stage === 'props').map((p) => p.name);
    expect(props).toContain('prop:lantern');
    expect(props).toContain('prop:telescope');
    expect(plan.pieces[plan.pieces.length - 1].stage).toBe('props');
  });

  it('every trade has its own silhouette', () => {
    const sigs = new Set<string>();
    for (const trade of TRADES) {
      const plan = planHouse(spec(trade));
      sigs.add(`${plan.height.toFixed(1)}:${plan.pieces.map((p) => p.name).slice(0, 8).join(',')}`);
    }
    expect(sigs.size).toBe(TRADES.length);
  });
});
