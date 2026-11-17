import { describe, expect, it } from 'vitest';
import { SPECIES, TRADES } from '../../src/mind/types';
import { birdsFor, MAX_TOTAL, MIN_TOTAL, planBuild } from '../../src/life/build-plan';
import { gearFor, planFor, SPECIES_PLAN, TRADE_GEAR, TRADE_WORK } from '../../src/life/species';
import { BASE_HZ, BASE_SYLLABLES_PER_SEC, mouthAt, syllablePlan, voiceProfile } from '../../src/life/voice';

describe('species mapping', () => {
  it('has a body plan for every species, built from a known model', () => {
    for (const sp of SPECIES) {
      const plan = SPECIES_PLAN[sp];
      expect(plan, sp).toBeDefined();
      expect(SPECIES).toContain(plan.model);
      expect(plan.colors.main).toMatch(/^#[0-9a-f]{6}$/i);
      expect(plan.head).toBeGreaterThan(0.5);
    }
  });

  it('gives an unknown species a friendly stand-in', () => {
    expect(planFor('dragon').model).toBe('cat');
    expect(planFor('owl').model).toBe('owl');
  });

  it('dresses and employs every trade', () => {
    for (const t of TRADES) {
      expect(TRADE_GEAR[t].length, t).toBeGreaterThan(0);
      expect(TRADE_WORK[t], t).toBeTruthy();
    }
    expect(gearFor('nobody')).toEqual([]);
  });

  it('keeps species apart by silhouette', () => {
    const shapes = new Set(SPECIES.map((s) => `${SPECIES_PLAN[s].ears}/${SPECIES_PLAN[s].snout}/${SPECIES_PLAN[s].tail}/${SPECIES_PLAN[s].eyes}`));
    expect(shapes.size).toBe(SPECIES.length);
  });
});

describe('voice parameters', () => {
  it('reads pitch and rate as multipliers and clamps them', () => {
    const mid = voiceProfile({ pitch: 1, rate: 1, timbre: 'soft' });
    expect(mid.baseHz).toBeCloseTo(BASE_HZ);
    expect(mid.syllableSec).toBeCloseTo(1 / BASE_SYLLABLES_PER_SEC);
    expect(voiceProfile({ pitch: 1.5, rate: 1, timbre: 'soft' }).baseHz).toBeGreaterThan(mid.baseHz);
    expect(voiceProfile({ pitch: 9, rate: 9, timbre: 'soft' }).baseHz).toBe(BASE_HZ * 2);
    expect(voiceProfile({ pitch: 0.1, rate: 0.1, timbre: 'soft' }).baseHz).toBe(BASE_HZ * 0.5);
    expect(voiceProfile({ pitch: 1, rate: 2, timbre: 'soft' }).syllableSec).toBeLessThan(mid.syllableSec);
  });

  it('reads large values as Hz and syllables per second', () => {
    expect(voiceProfile({ pitch: 320, rate: 12, timbre: 'warm' }).baseHz).toBe(320);
    expect(voiceProfile({ pitch: 320, rate: 12, timbre: 'warm' }).syllableSec).toBeCloseTo(1 / 12);
  });

  it('maps every timbre to its own sound and survives bad input', () => {
    const waves = new Set((['soft', 'bright', 'croaky', 'warm'] as const).map((t) => `${voiceProfile({ pitch: 1, rate: 1, timbre: t }).wave}/${voiceProfile({ pitch: 1, rate: 1, timbre: t }).cutoff}`));
    expect(waves.size).toBe(4);
    expect(voiceProfile({ pitch: 1, rate: 1, timbre: 'croaky' }).creak).toBeGreaterThan(0);
    const bad = voiceProfile({ pitch: Number.NaN, rate: undefined as unknown as number, timbre: 'shouty' as 'soft' });
    expect(bad.baseHz).toBe(BASE_HZ);
    expect(bad.wave).toBe('triangle');
    expect(voiceProfile(undefined).baseHz).toBe(BASE_HZ);
  });

  it('plans syllables with pauses, rising questions and a mouth envelope', () => {
    const p = voiceProfile({ pitch: 1, rate: 1, timbre: 'soft' });
    const a = syllablePlan('I came on the evening wind. Do you have room for a baker?', p);
    expect(a.syllables.length).toBeGreaterThan(10);
    expect(a.duration).toBeGreaterThan(1);
    expect(a.duration).toBeLessThanOrEqual(9.5);
    for (let i = 1; i < a.syllables.length; i++) expect(a.syllables[i].t).toBeGreaterThan(a.syllables[i - 1].t);
    const last = a.syllables[a.syllables.length - 1];
    expect(last.hz).toBeGreaterThan(p.baseHz); // a question rises
    expect(syllablePlan('I came on the evening wind. Do you have room for a baker?', p)).toEqual(a); // deterministic
    const s0 = a.syllables[0];
    expect(mouthAt(a, s0.t + s0.d / 2)).toBeGreaterThan(0.2);
    expect(mouthAt(a, -1)).toBe(0);
    expect(mouthAt(a, a.duration + 1)).toBe(0);
    expect(syllablePlan('', p).syllables).toHaveLength(0);
  });

  it('keeps very long lines under ten seconds', () => {
    const p = voiceProfile({ pitch: 1, rate: 0.5, timbre: 'warm' });
    const long = syllablePlan('word '.repeat(200), p);
    expect(long.duration).toBeLessThan(10);
  });
});

describe('build sequence', () => {
  it('lands pieces in assembly order within 12 to 20 seconds', () => {
    for (const n of [1, 2, 5, 11, 20, 40, 80]) {
      for (const flock of [1, 3, 7]) {
        const sizes = Array.from({ length: n }, (_, i) => (i === 0 ? 2 : 0.3 + ((i * 7) % 10) / 6));
        const s = planBuild(sizes, flock);
        expect(s.items).toHaveLength(n);
        expect(s.total, `${n} pieces, ${flock} birds`).toBeGreaterThanOrEqual(MIN_TOTAL - 0.05);
        expect(s.total, `${n} pieces, ${flock} birds`).toBeLessThanOrEqual(MAX_TOTAL + 0.05);
        for (let i = 0; i < n; i++) {
          const it = s.items[i];
          expect(it.index).toBe(i);
          expect(it.pick).toBeLessThan(it.land);
          expect(it.settle).toBeGreaterThan(it.land);
          if (i > 0) expect(it.land).toBeGreaterThan(s.items[i - 1].land);
          expect(it.birds.length).toBeGreaterThan(0);
          for (const b of it.birds) expect(b).toBeLessThan(flock);
        }
        expect(s.finish).toBeLessThan(s.total);
      }
    }
  });

  it('never gives one bird two pieces at once', () => {
    const s = planBuild([2, 1.5, 1.5, 1.5, 1.5, 0.4, 0.4, 0.4, 2.2, 0.3, 0.3], 7);
    const busy = new Map<number, [number, number][]>();
    for (const it of s.items) for (const b of it.birds) busy.set(b, [...(busy.get(b) ?? []), [it.pick, it.land]]);
    for (const spans of busy.values()) {
      spans.sort((a, b) => a[0] - b[0]);
      for (let i = 1; i < spans.length; i++) expect(spans[i][0]).toBeGreaterThanOrEqual(spans[i - 1][1]);
    }
  });

  it('sends more birds for bigger pieces', () => {
    expect(birdsFor(0.3, 7)).toBe(1);
    expect(birdsFor(0.9, 7)).toBe(2);
    expect(birdsFor(2.5, 7)).toBe(3);
    expect(birdsFor(2.5, 2)).toBe(2);
    expect(planBuild([], 7).total).toBe(0);
  });
});
