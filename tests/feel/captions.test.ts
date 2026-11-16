/**
 * The one caption queue (task 01.3.4): folding of ordinary lines, the hold of key lines,
 * the split of a long line at a word, the pace of 1.5 s.
 */
import { describe, expect, it } from 'vitest';
import { createClock } from '../../src/app/clock';
import { CAPTION, createCaptions, railLines, sourceWord, splitCaption, type Shown } from '../../src/feel/captions';

function rig() {
  let t = 0;
  const clock = createClock(() => t, () => 0);
  clock.freeze(true);
  const writes: Shown[][] = [];
  const q = createCaptions({ now: () => clock.now(), timers: clock.timers, write: (lines) => writes.push(lines) });
  const advance = (ms: number): void => {
    t += ms;
    clock.step(ms);
  };
  const shown = (): string[] => (writes.at(-1) ?? []).map((l) => `${l.source}: ${l.text}`);
  return { q, advance, shown, writes };
}

describe('caption queue', () => {
  it('names the source as the first word', () => {
    expect(sourceWord('check:')).toBe('Check');
    expect(sourceWord('Extractor')).toBe('Extractor');
  });

  it('shows an ordinary line at once, then no faster than one per 1.5 s', () => {
    const { q, advance, shown, writes } = rig();
    q.say({ source: 'Check', text: 'Quote not found on page 23' });
    expect(shown()).toEqual(['Check: Quote not found on page 23']);
    q.say({ source: 'Run', text: 'Recorded answers.' });
    expect(writes.length).toBe(1);
    advance(1499);
    expect(writes.length).toBe(1);
    advance(1);
    expect(shown()).toEqual(['Check: Quote not found on page 23', 'Run: Recorded answers.']);
  });

  it('folds waiting ordinary lines of one source into the newest', () => {
    const { q, advance, shown, writes } = rig();
    q.say({ source: 'Run', text: 'Started.' });
    q.say({ source: 'Extractor', text: '1 batch read' });
    q.say({ source: 'Extractor', text: '2 batches read' });
    q.say({ source: 'Extractor', text: '3 more batches read' });
    advance(1500);
    expect(shown().at(-1)).toBe('Extractor: 3 more batches read');
    expect(writes.at(-1)!.at(-1)!.folded).toBe(2);
    advance(3000);
    // Nothing else was waiting: the folded lines never appear.
    expect(writes.flat().filter((l) => l.text === '1 batch read')).toHaveLength(0);
  });

  it('never folds key lines and holds each for at least 3 s', () => {
    const { q, advance, shown } = rig();
    q.say({ source: 'Check', text: 'Quote not found on page 23', key: true });
    q.say({ source: 'Check', text: 'A date in the quote was changed', key: true });
    q.say({ source: 'Check', text: '5 checked' });
    advance(2999);
    expect(shown().at(-1)).toBe('Check: Quote not found on page 23');
    advance(1);
    expect(shown().at(-1)).toBe('Check: A date in the quote was changed');
    advance(3000);
    expect(shown().at(-1)).toBe('Check: 5 checked');
  });

  it('keeps the last two lines only', () => {
    const { q, advance, shown } = rig();
    for (const n of [1, 2, 3]) {
      q.say({ source: `S${n}`, text: `line ${n}` });
      advance(1500);
    }
    expect(shown()).toEqual(['S2: line 2', 'S3: line 3']);
  });

  it('splits a long line at a word into lines of at most two rail lines', () => {
    const long =
      'Recorded answers from a live run on 16 Nov (gemini-flash, 18 calls). Every check runs now, on this device, and nothing is sent anywhere.';
    const parts = splitCaption('Run', long);
    expect(parts.length).toBe(2);
    for (const p of parts) {
      expect(`Run: ${p}`.length).toBeLessThanOrEqual(CAPTION.lineChars * CAPTION.lines);
      expect(railLines(`Run: ${p}`)).toBeLessThanOrEqual(2);
    }
    expect(parts.join(' ')).toBe(long);
    const { q, advance, shown } = rig();
    q.say({ source: 'Run', text: long, key: true });
    expect(shown()).toEqual([`Run: ${parts[0]}`]);
    advance(3000);
    expect(shown()).toEqual([`Run: ${parts[0]}`, `Run: ${parts[1]}`]);
  });

  it('shows everything waiting at once on flush (Skip to the result)', () => {
    const { q, shown } = rig();
    q.say({ source: 'A', text: 'one', key: true });
    q.say({ source: 'B', text: 'two', key: true });
    q.say({ source: 'C', text: 'three', key: true });
    q.flush();
    expect(shown()).toEqual(['B: two', 'C: three']);
    expect(q.pending()).toBe(0);
  });
});
