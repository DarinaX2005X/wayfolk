import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ value: { sound: true, lessMotion: false } }));
vi.mock('../../src/app/store', () => ({ store: { settings } }));

import { answer, onFeel, sound } from '../../src/feel';
import { MIN_GAP_MS, PLAN, pitchOfNote, type FeelEvent, type FeelName } from '../../src/feel/plan';
import { engine } from '../../src/feel/sound';
import { SCALE_HZ } from '../../src/feel/sound/scale';

/** Rows used by these tests; the product table is filled by package 01.3. */
const ROWS: Partial<typeof PLAN> = {
  grab: { sight: 'The object follows the hand', sound: 'pick' },
  drop: { sight: 'The object settles where it was let go', sound: 'place' },
  tile: { sight: 'A card lands as a tile', sound: 'punch', value: 'note 0…7', pitch: pitchOfNote },
  stamp: { sight: 'The stamp head comes down', sound: 'stamp', value: 'strength 0…1', gain: (v) => 0.55 + 0.45 * Math.max(0, Math.min(1, v)) },
  bloom: { sight: 'The plot settles and the object grows', sound: 'unroll', calmStretch: 0.25 },
  hover: { sight: 'The object under the pointer lifts' },
};
const TYPES = Object.keys(ROWS) as FeelName[];
/** Fake time restarts with every test; each test starts later than the one before, clear of the rate limit. */
let round = 0;

beforeEach(() => {
  Object.assign(PLAN, ROWS);
  settings.value.lessMotion = false;
  vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] });
  // Each test starts well clear of the rate limit of the one before.
  round += 1;
  vi.advanceTimersByTime(1000 * round);
});

afterEach(() => {
  for (const key of Object.keys(PLAN) as FeelName[]) delete PLAN[key];
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the plan', () => {
  it('maps a note of the scale to its pitch', () => {
    SCALE_HZ.forEach((hz, n) => expect(pitchOfNote(n) * SCALE_HZ[0]).toBeCloseTo(hz, 6));
    expect(pitchOfNote(-3)).toBe(1);
    expect(pitchOfNote(99)).toBeCloseTo(SCALE_HZ[SCALE_HZ.length - 1] / SCALE_HZ[0], 9);
  });

  it('still hands an event without a row to its subscribers, silently', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    const seen: FeelEvent[] = [];
    const off = onFeel('filter', (e) => seen.push(e));
    answer({ type: 'filter' });
    off();
    expect(seen).toHaveLength(1);
    expect(play).not.toHaveBeenCalled();
  });
});

describe('answer', () => {
  it('does not throw for any event before sound.unlock(), and still reaches the subscribers', () => {
    for (const type of TYPES) {
      const seen: FeelEvent[] = [];
      const off = onFeel(type, (e) => seen.push(e));
      const event: FeelEvent = { type, value: 40 };
      expect(() => answer(event)).not.toThrow();
      expect(seen).toEqual([event]);
      off();
    }
    // The same holds for everything else on the sound object.
    expect(() => {
      sound.play('pick');
      sound.loop('snip', true, 0.5);
      sound.loop('snip', false);
      sound.tune.note(3);
      sound.tune.stop();
      sound.setMuted(true);
      sound.setMuted(false);
      sound.suspend();
      sound.resume();
    }).not.toThrow();
  });

  it('turns an event into its sound with the position, and hover and select into none', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    const at = { x: 0.1, y: 0.7, z: -0.4 } as FeelEvent['at'];
    answer({ type: 'grab', at });
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0]).toBe('pick');
    expect(play.mock.calls[0][1]?.at).toBe(at);
    answer({ type: 'hover', at });
    answer({ type: 'select', at });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('gives a tile its note as pitch and a stamp its strength as gain', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    answer({ type: 'tile', value: 5 });
    expect((play.mock.lastCall?.[1]?.pitch ?? 0) * SCALE_HZ[0]).toBeCloseTo(SCALE_HZ[5], 6);
    vi.advanceTimersByTime(100);
    answer({ type: 'tile' });
    expect(play.mock.lastCall?.[1]?.pitch).toBeUndefined();
    answer({ type: 'stamp', value: 0 });
    const soft = play.mock.lastCall?.[1]?.gain ?? 0;
    vi.advanceTimersByTime(100);
    answer({ type: 'stamp', value: 1 });
    const hard = play.mock.lastCall?.[1]?.gain ?? 0;
    expect(soft).toBeGreaterThan(0.4);
    expect(hard).toBe(1);
    vi.advanceTimersByTime(100);
    answer({ type: 'stamp', value: NaN });
    expect(play.mock.lastCall?.[1]?.gain).toBeUndefined();
  });

  it('stretches a sound by its row under "Less motion"', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    answer({ type: 'bloom' });
    expect(play.mock.lastCall?.[2]).toBe(1);
    vi.advanceTimersByTime(100);
    settings.value.lessMotion = true;
    answer({ type: 'bloom' });
    expect(play.mock.lastCall?.[2]).toBe(0.25);
    answer({ type: 'grab' });
    expect(play.mock.lastCall?.[2]).toBe(1);
  });

  it('drops the same event when it repeats faster than 30 times a second, sound and sight together', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    const seen: number[] = [];
    const off = onFeel('tile', (e) => seen.push(e.value ?? -1));
    // 200 events in one second: one every 5 ms.
    for (let i = 0; i < 200; i++) {
      answer({ type: 'tile', value: i });
      vi.advanceTimersByTime(5);
    }
    off();
    expect(seen.length).toBe(play.mock.calls.length);
    expect(seen.length).toBeLessThanOrEqual(30);
    expect(seen.length).toBeGreaterThanOrEqual(28);
    for (let i = 1; i < seen.length; i++) expect((seen[i] - seen[i - 1]) * 5).toBeGreaterThanOrEqual(MIN_GAP_MS);
  });

  it('limits each event on its own: a different event right after is not dropped', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    answer({ type: 'grab' });
    answer({ type: 'drop' });
    answer({ type: 'grab' });
    expect(play.mock.calls.map((c) => c[0])).toEqual(['pick', 'place']);
    vi.advanceTimersByTime(MIN_GAP_MS + 1);
    answer({ type: 'grab' });
    expect(play.mock.calls.length).toBe(3);
  });

  it('keeps going when a subscriber or the sound itself fails', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(engine, 'play').mockImplementation(() => {
      throw new Error('no audio');
    });
    const seen: string[] = [];
    const off1 = onFeel('stamp', () => {
      throw new Error('broken view');
    });
    const off2 = onFeel('stamp', () => seen.push('second'));
    expect(() => answer({ type: 'stamp' })).not.toThrow();
    expect(seen).toEqual(['second']);
    expect(errors).toHaveBeenCalledTimes(2);
    off1();
    off2();
  });

  it('stops calling a subscriber after it unsubscribes', () => {
    vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    const fn = vi.fn();
    const off = onFeel('select', fn);
    answer({ type: 'select' });
    off();
    vi.advanceTimersByTime(100);
    answer({ type: 'select' });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
