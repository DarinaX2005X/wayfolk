import { describe, expect, it } from 'vitest';
import { CHAPTER_LIMITS, cleanChapter, directChapter, preparedChapter, preparedCount } from '../../src/mind/chapters';
import { PREPARED } from '../../src/mind/prepared';
import { SILHOUETTES, STAGE_PLACES, STAGE_VERBS, type Chapter } from '../../src/mind/types';

const kinds = new Set<string>(SILHOUETTES);
const verbs = new Set<string>(STAGE_VERBS);
const places = new Set<string>(STAGE_PLACES);

function valid(c: Chapter): void {
  expect(c.beats.length).toBeGreaterThanOrEqual(CHAPTER_LIMITS.beatsMin);
  expect(c.beats.length).toBeLessThanOrEqual(CHAPTER_LIMITS.beatsMax);
  const ids = new Set(c.cast.map((m) => m.id));
  for (const m of c.cast) {
    expect(kinds.has(m.kind)).toBe(true);
    expect(places.has(m.at)).toBe(true);
  }
  for (const b of c.beats) {
    expect(b.line.length).toBeGreaterThan(0);
    expect(b.line).not.toMatch(/!/);
    for (const a of b.actions) {
      expect(verbs.has(a.do)).toBe(true);
      expect(ids.has(a.who)).toBe(true);
      if (a.to) expect(places.has(a.to)).toBe(true);
    }
  }
  const chars = c.beats.reduce((s, b) => s + b.line.length, 0);
  expect(chars).toBeGreaterThanOrEqual(CHAPTER_LIMITS.charsMin);
  expect(chars).toBeLessThanOrEqual(CHAPTER_LIMITS.charsMax);
}

describe('chapters of the evening of stories', () => {
  it('directs a valid chapter from the story beats of every prepared traveler', () => {
    for (const r of PREPARED) {
      for (const n of [1, 2, 3]) {
        const c = directChapter(r, n);
        valid(c);
        expect(c.cast.some((m) => m.kind === r.species)).toBe(true);
      }
    }
  });

  it('every prepared chapter passes the checks', () => {
    for (const r of PREPARED) {
      for (let n = 1; n <= preparedCount(r.id); n += 1) {
        const c = preparedChapter(r, n);
        expect(c, `${r.id} chapter ${n}`).not.toBeNull();
        valid(c!);
      }
    }
  });

  it('repairs what a model gets slightly wrong and refuses what it cannot use', () => {
    const r = PREPARED[0];
    const fixed = cleanChapter(
      {
        title: 'The oven that floated.',
        mood: 'twilight',
        cast: [
          { id: 'me', kind: 'dragon', layer: 'near', at: 'left', hidden: true },
          { id: 'tub', kind: 'stove', layer: 'mid', at: 'middle', hidden: true },
          { id: 'boat', kind: 'ship', layer: 'mid', at: 'nowhere' },
          { id: 'robot', kind: 'robot', layer: 'near', at: 'left' },
        ],
        beats: Array.from({ length: 7 }, (_, i) => ({
          line: `This is line ${i + 1} of a small story about an oven that floated off one windy morning!`,
          actions: [
            { do: 'walk', who: 'me', to: 'center' },
            { do: 'show', who: 'tub', to: 'right' },
            { do: 'explode', who: 'boat' },
            { do: 'enter', who: 'robot' },
          ],
        })),
      },
      r,
      1,
      'live',
    );
    expect(typeof fixed).not.toBe('string');
    const c = fixed as Chapter;
    expect(c.title).toBe('The oven that floated');
    expect(c.mood).toBe('dusk');
    expect(c.cast.find((m) => m.id === 'me')?.kind).toBe(r.species);
    expect(c.cast.find((m) => m.id === 'tub')?.kind).toBe('oven');
    expect(c.cast.find((m) => m.id === 'boat')?.at).toBe('center');
    expect(c.cast.some((m) => m.id === 'robot')).toBe(false);
    expect(c.beats[0].actions.map((a) => a.do)).toEqual(['move', 'appear']);
    expect(c.beats[0].line).not.toMatch(/!/);
    valid(c);

    expect(cleanChapter({ title: 'x', cast: [], beats: [{ line: 'Too short.', actions: [] }] }, r, 1, 'live')).toMatch(/usable lines/);
    expect(cleanChapter('nonsense', r, 1, 'live')).toMatch(/object/);
  });
});
