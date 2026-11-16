/**
 * The inbox block: bone, 21 × 10 × 7.5 cm, with a slot 19 cm wide in its front face.
 * Envelopes lie inside; the top one sticks out of the slot toward the person by 3.6 cm,
 * so its label (both lines) shows on the strip, the others show only their edges. When
 * the block is selected they fan out in front of it. Beside it a cobalt flag pin of 5 cm
 * on a bone base rises in 180 ms with a settle when something new is waiting: the raised
 * pin explains the action without text.
 *
 * Origin at the centre of the block's footprint on the slab; +z faces the person.
 */
import { Object3D, Vector3 } from '@iwsdk/core';
import type { EnvelopeSpec } from '../../agents/types';
import { MOTION } from '../../tokens/tokens';
import { bevelBox, cylinder, merge, placed, tint, box } from './geom';
import { COLOR } from '../../tokens/tokens';
import { createEnvelope, ENVELOPE } from './envelope';
import { followHandle } from './grabbable';
import { part } from './materials';
import { attachShadow } from './shadow';
import { animate, easeBack, easeInOut, easeOut, lessMotion, now, progress } from './time';
import type { Envelope, InboxBlock } from './types';

export const INBOX = { w: 0.21, d: 0.1, h: 0.075, slotW: 0.19, slotY: 0.016, slotH: 0.024 };
const OUT = 0.036;
const PIN = { h: 0.05, r: 0.0045, x: -INBOX.w / 2 - 0.016 };
const FAN_MS = 360;
const MOVE_MS = 300;

function blockGeometry(): ReturnType<typeof merge> {
  const { w, d, h, slotW, slotY, slotH } = INBOX;
  const bone = COLOR.bone;
  const pieces = [
    tint(bevelBox(w, slotY, d, 0.003, 0.006), bone),
    tint(placed(bevelBox(w, h - slotY - slotH, d, 0.003, 0.006), [0, slotY + slotH, 0]), bone),
    tint(placed(box((w - slotW) / 2, slotH, d), [-(w + slotW) / 4, slotY, 0]), bone),
    tint(placed(box((w - slotW) / 2, slotH, d), [(w + slotW) / 4, slotY, 0]), bone),
    // The back of the slot is shaded, so the opening reads as depth.
    tint(placed(box(slotW, slotH, 0.006), [0, slotY, -d / 2 + 0.003]), COLOR.boneShade),
    tint(placed(box(slotW, 0.001, d - 0.006), [0, slotY + slotH - 0.001, 0.003]), COLOR.boneShade),
  ];
  return merge(pieces);
}

export function createInbox(): InboxBlock {
  const root = new Object3D();
  root.name = 'kit:inbox';
  root.userData.target = 'inbox';
  const block = part(blockGeometry(), 'vcCeramic', 'inbox:block');
  root.add(block);
  attachShadow(block, { height: INBOX.h, size: [INBOX.w, INBOX.d], rest: 0 });

  // The flag pin on its base, at the left end of the block.
  const base = part(cylinder(0.011, 0.013, 0.006, 20), 'bone', 'inbox:pin-base');
  base.position.set(PIN.x, 0, 0.02);
  root.add(base);
  const pin = new Object3D();
  pin.position.set(PIN.x, 0, 0.02);
  const shaft = part(cylinder(PIN.r, PIN.r, PIN.h, 12), 'cobalt', 'inbox:pin');
  const flag = part(placed(bevelBox(0.016, 0.011, 0.002, 0.0005), [0.008, PIN.h - 0.012, 0]), 'cobalt', 'inbox:flag');
  pin.add(shaft, flag);
  root.add(pin);

  let pinUp = false;
  let pinAt = -Infinity;
  let fan = false;
  let fanAt = -Infinity;
  const envelopes: Envelope[] = [];
  const out = new Set<string>();
  const backAt = new Map<string, { at: number; from: Vector3 }>();
  const tmp = new Vector3();

  /** Where envelope i of n rests in the block (and in the fan). */
  const rest = (i: number, fanned: number, target: Vector3): { pos: Vector3; yaw: number } => {
    const n = envelopes.length;
    const top = i === n - 1;
    const y = INBOX.slotY + 0.002 + Math.min(i, 3) * ((INBOX.slotH - 0.006) / 4);
    const z = INBOX.d / 2 - ENVELOPE.d / 2 + (top ? OUT : 0.006 + 0.004 * (i % 2));
    target.set(0, y, z);
    if (fanned > 0) {
      // Fan: each envelope slides forward and turns, the top one furthest.
      const k = fanned;
      const spread = n > 1 ? i / (n - 1) - 0.5 : 0;
      target.x += spread * 0.12 * k;
      target.z += (0.07 + 0.012 * i) * k;
      target.y += 0.004 * i * k;
      return { pos: target, yaw: -spread * 0.5 * k };
    }
    return { pos: target, yaw: 0 };
  };

  const inbox: InboxBlock = {
    root,
    get pinUp() {
      return pinUp;
    },
    setPin(up) {
      if (up === pinUp) return;
      pinUp = up;
      pinAt = now();
    },
    offer(list: EnvelopeSpec[]) {
      for (const e of envelopes) {
        e.handle.removeFromParent();
        e.proxy.removeFromParent();
      }
      envelopes.length = 0;
      out.clear();
      for (const spec of list) {
        const env = createEnvelope(spec);
        envelopes.push(env);
        root.add(env.handle, env.proxy);
      }
    },
    setFan(on) {
      if (on === fan) return;
      fan = on;
      fanAt = now();
    },
    take(id) {
      const env = envelopes.find((e) => e.spec.id === id) ?? null;
      if (env) out.add(id);
      return env;
    },
    putBack(id) {
      const env = envelopes.find((e) => e.spec.id === id);
      if (!env) return;
      out.delete(id);
      if (env.handle.parent !== root) {
        // Bring it back into the block's frame where it is now, then slide home.
        env.handle.updateWorldMatrix(true, false);
        const world = env.handle.getWorldPosition(new Vector3());
        root.add(env.handle, env.proxy);
        root.updateWorldMatrix(true, false);
        env.handle.position.copy(root.worldToLocal(world));
      }
      backAt.set(id, { at: now(), from: env.handle.position.clone() });
      env.setState('rest');
    },
    envelope(id) {
      return envelopes.find((e) => e.spec.id === id) ?? null;
    },
    envelopes() {
      return [...envelopes];
    },
    update(t) {
      const reduced = lessMotion();
      // Pin: rises 5 cm in 180 ms with a settle; goes down in 180 ms.
      const k = reduced ? (t >= pinAt ? 1 : 0) : progress(t, pinAt, MOTION.stake.settleMs);
      const up = pinUp ? easeBack(k, 0.12) : 1 - easeOut(k);
      pin.position.y = -PIN.h + 0.008 + (PIN.h - 0.008) * up;
      pin.visible = up > 0.02 || pinUp;
      const kf = reduced ? (t >= fanAt ? 1 : 0) : easeInOut(progress(t, fanAt, FAN_MS));
      const fanned = fan ? kf : 1 - kf;
      envelopes.forEach((env, i) => {
        if (out.has(env.spec.id)) return;
        const r = rest(i, fanned, tmp);
        const back = backAt.get(env.spec.id);
        const kb = back ? easeOut(progress(t, back.at, reduced ? 0 : MOVE_MS)) : 1;
        if (back && kb < 1) env.handle.position.lerpVectors(back.from, r.pos, kb);
        else {
          env.handle.position.copy(r.pos);
          if (back) backAt.delete(env.spec.id);
        }
        env.handle.rotation.set(0, r.yaw, 0);
        followHandle(env);
      });
    },
  };
  animate(inbox);
  return inbox;
}
