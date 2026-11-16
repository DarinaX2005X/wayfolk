/**
 * The voice stone: a slate pebble 5 cm across on a bone stand. States: idle; listening
 * (a cobalt ring on the stand rises with the level of the voice); thinking (the stone
 * turns slowly in place); dim (the stone settles into the stand and the ring is gone).
 * `nudge()` lifts it by 1 cm once: the first session points at it this way.
 */
import { Object3D } from '@iwsdk/core';
import { flatRing, lathe, sphere } from './geom';
import { part, setMat } from './materials';
import { attachShadow } from './shadow';
import { animate, bump, clamp01, lessMotion, now, progress, wobble } from './time';
import type { VoiceStone, VoiceStoneState } from './types';

const NUDGE_MS = 520;

export function createVoiceStone(): VoiceStone {
  const root = new Object3D();
  root.name = 'kit:voice-stone';
  root.userData.target = 'voice-stone';
  const stand = part(
    lathe(
      [
        [0.0, 0.0],
        [0.026, 0.0],
        [0.028, 0.004],
        [0.024, 0.011],
        [0.019, 0.013],
        [0.0, 0.009],
      ],
      32,
    ),
    'bone',
    'voice-stone:stand',
  );
  root.add(stand);
  const ring = part(flatRing(0.0235, 0.0016, 32), 'cobalt', 'voice-stone:ring');
  ring.position.y = 0.0105;
  ring.visible = false;
  root.add(ring);
  const stone = part(sphere(0.025, 24, 14), 'slate', 'voice-stone:stone');
  stone.scale.set(1, 0.56, 0.9);
  const holder = new Object3D();
  holder.position.y = 0.022;
  holder.add(stone);
  root.add(holder);
  attachShadow(stand, { height: 0.035, size: [0.056, 0.056], rest: 0 });

  let state: VoiceStoneState = 'idle';
  let level = 0;
  let nudgeAt = -Infinity;
  const vs: VoiceStone = {
    root,
    get state() {
      return state;
    },
    setState(next, l) {
      state = next;
      level = clamp01(l ?? 0);
      setMat(stone, next === 'dim' ? 'slateEdge' : 'slate');
    },
    nudge() {
      nudgeAt = now();
    },
    update(t) {
      const reduced = lessMotion();
      const lift = reduced ? 0 : 0.01 * bump(progress(t, nudgeAt, NUDGE_MS));
      holder.position.y = (state === 'dim' ? 0.017 : 0.022) + lift;
      ring.visible = state === 'listening';
      ring.position.y = 0.0105 + 0.006 * level;
      ring.scale.setScalar(1 + 0.08 * level);
      holder.rotation.y = state === 'thinking' && !reduced ? (t / 2400) * Math.PI * 2 : 0;
      holder.rotation.z = state === 'thinking' && !reduced ? 0.05 * wobble(3, t, 1800) : 0;
    },
  };
  animate(vs);
  return vs;
}
