/**
 * `answer(event)`: the only place where an event of the product turns into sound.
 * Features call it at the moment of the action; views and gestures never do.
 */
import { motionReduced } from './motion';
import { MIN_GAP_MS, PLAN, type FeelEvent } from './plan';
import { engine } from './sound';

type Listener = (e: FeelEvent) => void;

const listeners = new Map<FeelEvent['type'], Set<Listener>>();
const lastAt = new Map<FeelEvent['type'], number>();

const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Answers one event: plays the sound of its plan row (if the row has one) at `e.at` and
 * hands the event to the subscribers that draw the visible part. The same event arriving
 * more often than 30 times a second is dropped whole, sound and sight together. Safe before `sound.unlock()`.
 */
export function answer(e: FeelEvent): void {
  const row = PLAN[e.type];
  const now = clock();
  const last = lastAt.get(e.type);
  // A clock that went back (a reloaded scene, a replaced clock) never silences an event.
  if (last !== undefined && now >= last && now - last < MIN_GAP_MS) return;
  lastAt.set(e.type, now);

  if (row?.sound) {
    try {
      const value = typeof e.value === 'number' && Number.isFinite(e.value) ? e.value : undefined;
      engine.play(
        row.sound,
        {
          at: e.at,
          pitch: value !== undefined && row.pitch ? row.pitch(value) : undefined,
          gain: value !== undefined && row.gain ? row.gain(value) : undefined,
        },
        row.calmStretch !== undefined && motionReduced() ? row.calmStretch : 1,
      );
    } catch (err) {
      // Sound is never a reason for an action to fail; the visible part still runs.
      console.error('feel: sound failed for', e.type, err);
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
