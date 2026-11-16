/**
 * The one sound object of the product. Features do not call it for their actions: they
 * call `answer()` in ../answer.ts, which looks the event up in the plan. Direct use is
 * for the app wiring (unlock, mute, pause, listener, the air of the Void) and for the
 * gallery's listening buttons.
 */
import type { Vector3 } from '@iwsdk/core';
import { SoundEngine, type SoundLogEntry } from './engine';
import type { SoundName } from './palette';

export type { SoundName } from './palette';
export type { SoundLogEntry } from './engine';

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
  play(name: SoundName, opts?: { at?: Vector3; value?: number; gain?: number; pitch?: number }): void {
    engine.play(name, opts);
  },
  /** The air of the Void. */
  ambient(on: boolean): void {
    engine.ambient(on);
  },
  /** What has sounded since capture began (only with ?capture=1). */
  log(): SoundLogEntry[] {
    return engine.log ?? [];
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
