/**
 * The one sound object of the product (PLAN "Contracts", "Feel"). Features do not call
 * it for their actions: they call `answer()` in ../answer.ts, which looks the event up
 * in the plan. Direct use is for the melody, the loops and the app wiring (unlock,
 * mute, pause, listener).
 */
import type { Vector3 } from '@iwsdk/core';
import type { Tune } from './scale';
import { SoundEngine } from './engine';
import type { LoopName, SoundName } from './palette';

export type { LoopName, SoundName } from './palette';

export const engine = new SoundEngine();

export const sound = {
  /** Call from the first user gesture. Before it everything below is silent and safe to call. */
  unlock(): void {
    engine.unlock();
  },
  setMuted(m: boolean): void {
    engine.setMuted(m);
  },
  /** Pause: headset taken off, system menu, hidden session. */
  suspend(): void {
    engine.suspend();
  },
  resume(): void {
    engine.resume();
  },
  /** Head position and view direction in world space, for placing sounds in the room. */
  listener(position: Vector3, forward: Vector3): void {
    engine.listener(position, forward);
  },
  play(name: SoundName, opts?: { at?: Vector3; pitch?: number; gain?: number }): void {
    engine.play(name, opts);
  },
  /** A sound that follows the hand: call on every move with intensity 0…1 from hand speed. */
  loop(name: LoopName, on: boolean, intensity?: number): void {
    engine.loop(name, on, intensity);
  },
  tune: {
    play(t: Tune, onStep?: (i: number) => void): void {
      engine.tunePlay(t, onStep);
    },
    stop(): void {
      engine.tuneStop();
    },
    note(n: number): void {
      engine.tuneNote(n);
    },
  },
};

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  // Browsers start audio only from a gesture. The first one unlocks sound even if no
  // feature remembered to; touch counts as a gesture on release, not on press.
  const gestures = ['pointerup', 'click', 'keydown', 'touchend'] as const;
  const onGesture = (): void => {
    engine.unlock();
    for (const type of gestures) window.removeEventListener(type, onGesture, true);
  };
  for (const type of gestures) window.addEventListener(type, onGesture, { capture: true, passive: true });

  // A hidden page never sounds.
  document.addEventListener('visibilitychange', () => engine.setHidden(document.hidden));
  engine.setHidden(document.hidden);

  // Synthesis needs no audio context, so the palette is ready before the first tap.
  engine.warm();
}
