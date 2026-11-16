/**
 * The answer plan (task 01.3.4): every event of the product answers from one table; no
 * sound without a visible part; tiles sound at most eight times a second while every
 * tile still lands; the setting `sound` silences everything; delayed beats run on the
 * clock the app gives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({ value: { sound: true, lessMotion: false }, peek() { return this.value; } }));
vi.mock('../../src/app/store', () => ({ store: { settings } }));

import { answer, onFeel, sightMs, sound } from '../../src/feel';
import { PLAN, beatsOf, type FeelEvent, type FeelName } from '../../src/feel/plan';
import { engine } from '../../src/feel/sound';
import { SOUND_NAMES } from '../../src/feel/sound/palette';

const FEEL_NAMES: FeelName[] = [
  'pin-up', 'grab', 'drop', 'paper', 'stake', 'line', 'call-end', 'tile', 'stamp', 'slip-open', 'ask', 'bloom',
  'thread-pull', 'pair-open', 'filter', 'export', 'select', 'hover', 'guest-move', 'rule-apply', 'error',
];

let round = 0;
beforeEach(() => {
  settings.value = { sound: true, lessMotion: false };
  vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] });
  round += 1;
  vi.advanceTimersByTime(1000 * round);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the plan of DESIGN in code', () => {
  it('has a row for every event of the product', () => {
    expect(Object.keys(PLAN).sort()).toEqual([...FEEL_NAMES].sort());
  });

  it('never has a sound without a visible part', () => {
    for (const name of FEEL_NAMES) {
      const row = PLAN[name];
      const beats = beatsOf({ type: name, value: 3 });
      if (beats.length > 0) expect(row.sight.length, name).toBeGreaterThan(15);
    }
  });

  it('maps events to the sounds DESIGN names', () => {
    const first = (type: FeelName, value?: number): string[] => beatsOf({ type, value }).map((b) => b.sound);
    expect(first('pin-up')).toEqual(['knock']);
    expect(first('line')).toEqual(['line']);
    expect(first('thread-pull')).toEqual(['line']);
    expect(first('call-end')).toEqual(['tap']);
    expect(first('guest-move')).toEqual(['tap']);
    expect(first('slip-open')).toEqual(['flip']);
    expect(first('pair-open')).toEqual(['slide']);
    expect(first('filter')).toEqual(['slide']);
    expect(first('export')).toEqual(['fold']);
    expect(first('hover')).toEqual([]);
    expect(first('rule-apply', 3)).toEqual(['tap', 'tap', 'tap', 'slide']);
    const err = beatsOf({ type: 'error' });
    expect(err.map((b) => b.sound)).toEqual(['knock', 'knock']);
    expect(err.every((b) => b.pitch === 0.75)).toBe(true);
  });

  it('uses every sound of the palette somewhere', () => {
    const used = new Set(FEEL_NAMES.flatMap((n) => beatsOf({ type: n, value: 2 }).map((b) => b.sound)));
    for (const s of SOUND_NAMES) expect(used.has(s), s).toBe(true);
  });
});

describe('answer', () => {
  it('does not throw before sound is unlocked, and still reaches the subscribers', () => {
    for (const type of FEEL_NAMES) {
      const seen: FeelEvent[] = [];
      const off = onFeel(type, (e) => seen.push(e));
      const event: FeelEvent = { type, value: 0.4 };
      expect(() => answer(event)).not.toThrow();
      expect(seen).toEqual([event]);
      off();
      vi.advanceTimersByTime(500);
    }
    expect(() => {
      sound.play('tile', { value: 0.5 });
      sound.ambient(true);
      sound.ambient(false);
      sound.setMuted(true);
      sound.setMuted(false);
      sound.suspend();
      sound.resume();
    }).not.toThrow();
  });

  it('plays the sound of the row at the point of the event, with its value', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    const at = { x: 0.1, y: 0.7, z: -0.4 } as FeelEvent['at'];
    answer({ type: 'tile', at, value: 0.35 });
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.calls[0][0]).toBe('tile');
    expect(play.mock.calls[0][1]).toMatchObject({ at, value: 0.35 });
    answer({ type: 'hover', at });
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('lets tiles sound at most eight times a second, and every tile still lands', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    let landed = 0;
    const off = onFeel('tile', () => landed++);
    for (let i = 0; i < 60; i++) {
      answer({ type: 'tile', value: i / 60 });
      vi.advanceTimersByTime(1000 / 60);
    }
    off();
    expect(landed).toBe(60);
    expect(play.mock.calls.length).toBeLessThanOrEqual(8);
    expect(play.mock.calls.length).toBeGreaterThanOrEqual(7);
  });

  it('keeps the error knocks apart in time', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    answer({ type: 'error' });
    expect(play).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(play).toHaveBeenCalledTimes(2);
    expect(play.mock.calls[1][1]).toMatchObject({ pitch: 0.75 });
  });

  it('is silent when the setting sound is off, but the sight still runs', () => {
    const play = vi.spyOn(engine, 'play').mockImplementation(() => undefined);
    settings.value = { sound: false, lessMotion: false };
    const seen: FeelEvent[] = [];
    const off = onFeel('stamp', (e) => seen.push(e));
    answer({ type: 'stamp', value: 0.5 });
    off();
    expect(play).not.toHaveBeenCalled();
    expect(seen).toHaveLength(1);
  });

  it('shortens the sight under "Less motion"', () => {
    expect(sightMs('drop', 120)).toBe(120);
    settings.value = { sound: true, lessMotion: true };
    expect(sightMs('drop', 120)).toBe(0);
    expect(sightMs('grab', 120)).toBe(120);
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
});
