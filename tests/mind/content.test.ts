/**
 * The prepared set is the product whenever no live model is available: it must be large
 * enough, valid, varied and in the house style.
 */
import { describe, expect, it } from 'vitest';
import { cleanPublicIsland, cleanResident } from '../../src/mind/check';
import { DEMO_ISLANDS } from '../../src/mind/demo';
import { FIRST_IDS, LINES, PREPARED } from '../../src/mind/prepared';
import { offStyle } from '../../src/mind/schema';
import { GIFT_KINDS, TRADES } from '../../src/mind/types';
import travelersJson from '../../content/travelers.json';
import islandsJson from '../../content/islands.json';

const allText = (r: (typeof PREPARED)[number]): string => [r.name, r.personality, r.tagline ?? '', r.story.intro, ...r.story.beats, r.story.secret].join(' ');

describe('prepared travelers', () => {
  it('has at least 24, every one valid and marked prepared', () => {
    expect(travelersJson.travelers.length).toBeGreaterThanOrEqual(24);
    expect(PREPARED.length).toBe(travelersJson.travelers.length);
    for (const raw of travelersJson.travelers) expect(typeof cleanResident(raw), JSON.stringify(raw).slice(0, 60)).toBe('object');
    expect(PREPARED.every((r) => r.prepared === true && r.story.revealed === 0 && r.memory.length === 0)).toBe(true);
  });

  it('covers every trade, has no repeated names or ids, and four to six beats each', () => {
    expect(new Set(PREPARED.map((r) => r.trade))).toEqual(new Set(TRADES));
    const names = PREPARED.map((r) => r.name.split(' ')[0].toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(PREPARED.map((r) => r.id)).size).toBe(PREPARED.length);
    for (const r of PREPARED) {
      expect(r.story.beats.length).toBeGreaterThanOrEqual(4);
      expect(r.story.beats.length).toBeLessThanOrEqual(6);
      expect(r.likes.length).toBeGreaterThanOrEqual(2);
      expect(r.likes.every((l) => (GIFT_KINDS as string[]).includes(l))).toBe(true);
      expect(r.house?.sign).toBeTruthy();
    }
  });

  it('is in the house style: no exclamation marks, no generic words', () => {
    for (const r of PREPARED) {
      expect(allText(r)).not.toMatch(/!/);
      expect(offStyle(allText(r)), r.name).toBeNull();
    }
  });

  it('names strong travelers for the first minute', () => {
    expect(FIRST_IDS.length).toBeGreaterThanOrEqual(3);
    expect(FIRST_IDS.every((id) => PREPARED.some((p) => p.id === id))).toBe(true);
  });
});

describe('prepared lines', () => {
  it('has every situation for every trade, with the placeholders filled in later', () => {
    for (const trade of TRADES) {
      const l = LINES[trade];
      for (const key of ['greet', 'chat', 'stay', 'leave', 'giftLove', 'giftLike', 'hint', 'news', 'tripStory'] as const) {
        expect(l[key].length, `${trade}.${key}`).toBeGreaterThanOrEqual(2);
        for (const line of l[key]) expect(line).not.toMatch(/!/);
      }
      expect(l.news.every((n) => n.includes('{name}'))).toBe(true);
      expect(l.tripStory.every((n) => n.includes('{island}'))).toBe(true);
    }
  });
});

describe('demo islands', () => {
  it('fills the horizon with three or more valid public islands, each with residents and houses', () => {
    expect(islandsJson.islands.length).toBeGreaterThanOrEqual(3);
    expect(DEMO_ISLANDS.length).toBe(islandsJson.islands.length);
    for (const raw of islandsJson.islands) expect(typeof cleanPublicIsland(raw)).toBe('object');
    for (const { island } of DEMO_ISLANDS) {
      expect(island.id).toMatch(/^demo-/);
      expect(island.residents.length).toBeGreaterThanOrEqual(3);
      expect(island.houses.map((h) => h.residentId).sort()).toEqual(island.residents.map((r) => r.id).sort());
    }
    const demoNames = new Set(DEMO_ISLANDS.flatMap((d) => d.island.residents.map((r) => r.name)));
    expect(PREPARED.some((p) => demoNames.has(p.name))).toBe(false);
  });
});
