/**
 * Ties the feel of the product to one running app: the application clock for answers,
 * captions and the sound log; the listener at the head every frame; the settings
 * `sound`; the air of the Void; silence while the session is hidden or blurred.
 * Called once by `bindInteract(app)` (src/interact/bind.ts).
 */
import { Vector3, createSystem } from '@iwsdk/core';
import { effect } from '@preact/signals-core';
import type { App } from '../app/boot/world';
import { registerDebug } from '../app/debug';
import { parseAppParams } from '../app/params';
import { debugEnabled } from '../app/debug';
import { useFeelClock } from './answer';
import { useCaptionClock } from './captions';
import { engine, sound } from './sound';

let bound: App | null = null;
const pos = new Vector3();
const fwd = new Vector3();

class ListenerSystem extends createSystem({}) {
  update(): void {
    const app = bound;
    if (!app) return;
    const head = app.world.session ? app.world.player.head : app.world.camera;
    head.updateWorldMatrix(true, false);
    head.getWorldPosition(pos);
    fwd.set(0, 0, -1).transformDirection(head.matrixWorld);
    engine.listener(pos, fwd);
  }
}

export function bindFeel(app: App): void {
  if (bound) return;
  bound = app;
  const now = (): number => app.clock.now();
  useFeelClock(now, app.clock.timers);
  useCaptionClock(now, app.clock.timers);
  engine.clock = now;
  if (parseAppParams(location.search, debugEnabled()).capture) engine.log = [];
  app.world.registerSystem(ListenerSystem);

  effect(() => {
    engine.setMuted(app.store.settings.value.sound === false);
  });
  // The air breathes only under the sky of the Void, and only while the session is seen.
  effect(() => {
    const mode = app.store.mode.value;
    const visible = app.session.visible.value;
    sound.ambient(mode === 'void' && visible && app.store.settings.value.sound !== false);
    if (visible) engine.resume();
    else engine.suspend();
  });
  registerDebug('sound', { log: () => sound.log(), voices: () => engine.voiceCount, air: () => engine.ambientOn });
}
