/**
 * `answer(event)`: the only place where an event of the product turns into sound.
 * Features call it at the moment of the action; views and gestures never play sounds.
 *
 * The visible part always reaches the subscribers; the sound of a row is skipped when it
 * comes faster than its row allows (tiles: eight a second, the rest falls silent), when
 * the setting `sound` is off, or before the first gesture. Delayed beats (the second knock
 * of an error, the taps of a rule) run on the application clock when the app is bound.
 */
import { store } from '../app/store';
import { beatsOf, MIN_GAP_MS, PLAN, type FeelEvent } from './plan';
import { engine } from './sound';
import { motionReduced } from './motion';

type Listener = (e: FeelEvent) => void;

const listeners = new Map<FeelEvent['type'], Set<Listener>>();
const lastAt = new Map<FeelEvent['type'], number>();

type Timers = { set(fn: () => void, ms: number): number };
let clock: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let timers: Timers = { set: (fn, ms) => setTimeout(fn, ms) as unknown as number };

/** Moves answer() onto the application clock (bindFeel does this). */
export function useFeelClock(now: () => number, t: Timers): void {
  clock = now;
  timers = t;
}

export function answer(e: FeelEvent): void {
  const row = PLAN[e.type];
  const now = clock();
  const beats = beatsOf(e);
  const gap = row?.minGapMs ?? MIN_GAP_MS;
  const last = lastAt.get(e.type);
  // A clock that went back (a reloaded scene, a replaced clock) never silences an event.
  const tooSoon = last !== undefined && now >= last && now - last < gap;
  const soundOn = store.settings.peek().sound !== false;
  if (beats.length > 0 && !tooSoon && soundOn) {
    lastAt.set(e.type, now);
    for (const beat of beats) {
      const play = (): void => {
        try {
          engine.play(beat.sound, { at: e.at, value: e.value, pitch: beat.pitch });
        } catch (err) {
          // Sound is never a reason for an action to fail; the visible part still runs.
          console.error('feel: sound failed for', e.type, err);
        }
      };
      if (beat.delayMs) timers.set(play, beat.delayMs);
      else play();
    }
  }

  const set = listeners.get(e.type);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(e);
    } catch (err) {
      console.error('feel: subscriber failed for', e.type, err);
    }
  }
}

/** Subscribes the visible part of an event. Returns the function that unsubscribes. */
export function onFeel(type: FeelEvent['type'], fn: (e: FeelEvent) => void): () => void {
  let set = listeners.get(type);
  if (!set) listeners.set(type, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
  };
}

/** How long the sight of an event takes, given its normal time: shorter or none under "Less motion". */
export function sightMs(type: FeelEvent['type'], ms: number): number {
  return motionReduced() ? ms * (PLAN[type]?.calm ?? 1) : ms;
}
