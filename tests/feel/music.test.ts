import { describe, expect, it } from 'vitest';
import { songFor, TRADE_INSTRUMENT } from '../../src/feel/music';

const PENTA = new Set([0, 2, 4, 7, 9]);

describe('the evening music', () => {
  it('is the same tune for the same evening and a new one the next', () => {
    const a = songFor(1234, 'musician');
    const b = songFor(1234, 'musician');
    const c = songFor(1235, 'musician');
    expect(a.notes).toEqual(b.notes);
    expect(c.notes.map((n) => n.midi).join(',')).not.toBe(a.notes.map((n) => n.midi).join(','));
  });

  it('keeps the tune on the pentatonic scale of its key and ends home', () => {
    for (const seed of [1, 7, 99, 2024, 31337]) {
      const s = songFor(seed, 'tea-maker');
      const lead = s.notes.filter((n) => n.voice === 'lead');
      expect(lead.length).toBeGreaterThan(40);
      for (const n of lead) expect(PENTA.has((((n.midi - s.root) % 12) + 12) % 12)).toBe(true);
      expect((((lead[lead.length - 1].midi - s.root) % 12) + 12) % 12).toBe(0);
    }
  });

  it('a concert lasts about a minute and a story plays softly underneath for longer', () => {
    const concert = songFor(5, 'musician', 'concert');
    expect(concert.length).toBeGreaterThan(55);
    expect(concert.length).toBeLessThan(110);
    expect(concert.notes.some((n) => n.voice === 'drum')).toBe(true);
    const story = songFor(5, 'storyteller', 'story');
    expect(story.instrument).toBe('musicbox');
    expect(story.notes.some((n) => n.voice === 'drum')).toBe(false);
    expect(story.length).toBeGreaterThan(concert.length * 0.8);
  });

  it('gives every trade an instrument', () => {
    expect(TRADE_INSTRUMENT.musician).toBe('fiddle');
    expect(TRADE_INSTRUMENT['tea-maker']).toBe('glass');
    expect(songFor(3, 'baker').instrument).toBe('marimba');
  });
});
