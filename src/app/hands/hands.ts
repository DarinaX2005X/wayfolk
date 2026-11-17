/**
 * Hands, read straight from the XR frame: joint poses of both hands, the palm and its
 * normal, pinch, the pointing ray, a fingertip, and a palm anchor that Pip lands on.
 *
 * Gentle tracking loss (meta-lessons "Hands"): when a hand drops out, its anchor stays
 * where it was (anything on it waits there), and when it comes back the anchor glides to
 * the hand over about 0.3 s instead of jumping. Pinch releases use the pose from a few
 * frames earlier, so a release does not throw the aim.
 *
 * Coordinates are world space. Joint poses come in the XR reference space, which is the
 * local space of the player rig (`world.player`), so they go through its matrix.
 */
import { Matrix4, Object3D, Quaternion, Vector3, type World } from '@iwsdk/core';
import { registerDebug, registerTest } from '../debug';

export type Side = 'left' | 'right';
export const SIDES: Side[] = ['left', 'right'];

export type HandState = {
  side: Side;
  tracked: boolean;
  /** Application time (ms) of the last frame the hand was seen. */
  seenAt: number;
  wrist: Vector3;
  /** Middle of the palm, a little off the skin on the palm side. */
  palm: Vector3;
  /** Out of the palm. */
  palmNormal: Vector3;
  /** From the wrist toward the fingers. */
  along: Vector3;
  indexTip: Vector3;
  thumbTip: Vector3;
  middleTip: Vector3;
  /** Thumb to index tip, metres. */
  pinchGap: number;
  pinching: boolean;
  /** Palm faces up and the fingers are open: a perch for Pip. */
  palmUp: boolean;
  /** The system pointing ray of the hand. */
  rayOrigin: Vector3;
  rayDir: Vector3;
  /** Roll of the wrist around the forearm, radians (for turning a house footprint). */
  roll: number;
  /** Follows the palm, frozen while the hand is lost (Pip sits on it). */
  anchor: Object3D;
};

type PinchFn = (side: Side, down: boolean, hand: HandState) => void;

const J = {
  wrist: 'wrist',
  thumbTip: 'thumb-tip',
  indexTip: 'index-finger-tip',
  middleTip: 'middle-finger-tip',
  ringTip: 'ring-finger-tip',
  indexMeta: 'index-finger-metacarpal',
  middleMeta: 'middle-finger-metacarpal',
  pinkyMeta: 'pinky-finger-metacarpal',
} as const;

export type Hands = {
  left: HandState;
  right: HandState;
  get(side: Side): HandState;
  onPinch(fn: PinchFn): () => void;
  /** The hand that holds Pip, or the one that last pinched. */
  primary(): HandState | null;
  /** Lose a hand on purpose for `seconds` (scenario hook). */
  lose(side: Side, seconds: number): void;
  update(frame: XRFrame | null, now: number, dt: number): void;
};

function blank(side: Side): HandState {
  const anchor = new Object3D();
  anchor.name = `hand:${side}:palm`;
  anchor.userData.side = side;
  anchor.userData.tracked = false;
  return {
    side,
    tracked: false,
    seenAt: -1,
    wrist: new Vector3(),
    palm: new Vector3(),
    palmNormal: new Vector3(0, 1, 0),
    along: new Vector3(0, 0, -1),
    indexTip: new Vector3(),
    thumbTip: new Vector3(),
    middleTip: new Vector3(),
    pinchGap: 1,
    pinching: false,
    palmUp: false,
    rayOrigin: new Vector3(),
    rayDir: new Vector3(0, 0, -1),
    roll: 0,
    anchor,
  };
}

export const PINCH_ON = 0.022;
export const PINCH_OFF = 0.04;

/** Whether a palm normal and finger spread make a perch (pure; tested). */
export function isPalmUp(normalY: number, fingersOpen: boolean): boolean {
  return normalY > 0.55 && fingersOpen;
}

export function createHands(world: World, now: () => number): Hands {
  const state = { left: blank('left'), right: blank('right') };
  const listeners = new Set<PinchFn>();
  const lostUntil: Record<Side, number> = { left: 0, right: 0 };
  const selecting: Record<Side, boolean> = { left: false, right: false };
  const regainAt: Record<Side, number> = { left: -1e9, right: -1e9 };
  const m = new Matrix4();
  const rig = new Matrix4();
  const q = new Quaternion();
  const v = new Vector3();
  const w = new Vector3();
  const tmp = new Vector3();
  const metaI = new Vector3();
  const metaP = new Vector3();
  const ringTip = new Vector3();
  // A short history of ray poses per hand: a release aims with the pose from ~120 ms before.
  const history: Record<Side, { o: Vector3; d: Vector3 }[]> = {
    left: Array.from({ length: 8 }, () => ({ o: new Vector3(), d: new Vector3(0, 0, -1) })),
    right: Array.from({ length: 8 }, () => ({ o: new Vector3(), d: new Vector3(0, 0, -1) })),
  };
  let historyAt = 0;
  let lastPinched: Side | null = null;

  // Hand select events count as a pinch too (the emulator and some runtimes give them
  // before the joints close).
  let watched: XRSession | null = null;
  const onSelect = (down: boolean) => (e: XRInputSourceEvent) => {
    const side = e.inputSource.handedness as Side;
    if (!e.inputSource.hand || (side !== 'left' && side !== 'right')) return;
    selecting[side] = down;
  };
  const onStart = onSelect(true);
  const onEnd = onSelect(false);
  const watch = (session: XRSession | null): void => {
    if (session === watched) return;
    watched?.removeEventListener('selectstart', onStart as EventListener);
    watched?.removeEventListener('selectend', onEnd as EventListener);
    watched = session;
    session?.addEventListener('selectstart', onStart as EventListener);
    session?.addEventListener('selectend', onEnd as EventListener);
    selecting.left = selecting.right = false;
  };

  const emit = (side: Side, down: boolean): void => {
    if (down) lastPinched = side;
    for (const fn of [...listeners]) {
      try {
        fn(side, down, state[side]);
      } catch (error) {
        console.error('[wf] pinch listener failed', error);
      }
    }
  };

  const jointPos = (frame: XRFrame, hand: XRHand, space: XRReferenceSpace, name: string, out: Vector3): boolean => {
    const joint = hand.get(name as XRHandJoint);
    if (!joint) return false;
    const pose = frame.getJointPose?.(joint, space);
    if (!pose) return false;
    const p = pose.transform.position;
    out.set(p.x, p.y, p.z).applyMatrix4(rig);
    return true;
  };

  const hands: Hands = {
    left: state.left,
    right: state.right,
    get: (side) => state[side],
    onPinch(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    primary() {
      if (lastPinched && state[lastPinched].tracked) return state[lastPinched];
      if (state.right.tracked) return state.right;
      if (state.left.tracked) return state.left;
      return null;
    },
    lose(side, seconds) {
      lostUntil[side] = now() + seconds * 1000;
      const device = (window as unknown as { IWER_DEVICE?: { hands?: Record<Side, { connected: boolean }> } }).IWER_DEVICE;
      const input = device?.hands?.[side];
      if (input) {
        input.connected = false;
        setTimeout(() => {
          input.connected = true;
        }, seconds * 1000);
      }
    },
    update(frame, t, dt) {
      const session = world.renderer.xr.getSession();
      watch(session);
      world.player.updateWorldMatrix(true, false);
      rig.copy(world.player.matrixWorld);
      const space = world.renderer.xr.getReferenceSpace();
      const seen: Record<Side, boolean> = { left: false, right: false };
      historyAt = (historyAt + 1) % 8;
      if (frame && session && space) {
        for (const source of session.inputSources) {
          const side = source.handedness as Side;
          if (!source.hand || (side !== 'left' && side !== 'right')) continue;
          if (t < lostUntil[side]) continue;
          const h = state[side];
          if (!jointPos(frame, source.hand, space, J.wrist, h.wrist)) continue;
          seen[side] = true;
          jointPos(frame, source.hand, space, J.thumbTip, h.thumbTip);
          jointPos(frame, source.hand, space, J.indexTip, h.indexTip);
          jointPos(frame, source.hand, space, J.middleTip, h.middleTip);
          jointPos(frame, source.hand, space, J.ringTip, ringTip);
          const hasMeta = jointPos(frame, source.hand, space, J.indexMeta, metaI) && jointPos(frame, source.hand, space, J.pinkyMeta, metaP);
          // Palm orientation from the middle metacarpal: -Y is out of the palm, -Z along the bone.
          const mid = source.hand.get(J.middleMeta as XRHandJoint);
          const midPose = mid ? frame.getJointPose?.(mid, space) : null;
          if (midPose) {
            const o = midPose.transform.orientation;
            q.set(o.x, o.y, o.z, o.w);
            m.extractRotation(rig);
            h.palmNormal.set(0, -1, 0).applyQuaternion(q).transformDirection(m);
            h.along.set(0, 0, -1).applyQuaternion(q).transformDirection(m);
            const p = midPose.transform.position;
            h.palm.set(p.x, p.y, p.z).applyMatrix4(rig);
            h.palm.addScaledVector(h.palmNormal, 0.035);
          } else if (hasMeta) {
            h.palm.copy(metaI).add(metaP).multiplyScalar(0.5);
            h.along.subVectors(h.middleTip, h.wrist).normalize();
          }
          // Roll: how far the palm normal turned around the forearm, from palm-down.
          tmp.set(0, 1, 0).cross(h.along).normalize();
          h.roll = Math.atan2(h.palmNormal.dot(tmp), -h.palmNormal.y);
          h.pinchGap = h.thumbTip.distanceTo(h.indexTip);
          const fingersOpen = h.middleTip.distanceTo(h.wrist) > 0.13 && ringTip.distanceTo(h.wrist) > 0.12;
          h.palmUp = isPalmUp(h.palmNormal.y, fingersOpen);
          // The pointing ray.
          const rayPose = frame.getPose(source.targetRaySpace, space);
          if (rayPose) {
            const p = rayPose.transform.position;
            const o = rayPose.transform.orientation;
            h.rayOrigin.set(p.x, p.y, p.z).applyMatrix4(rig);
            q.set(o.x, o.y, o.z, o.w);
            m.extractRotation(rig);
            h.rayDir.set(0, 0, -1).applyQuaternion(q).transformDirection(m);
          }
          const slot = history[side][historyAt];
          slot.o.copy(h.rayOrigin);
          slot.d.copy(h.rayDir);
        }
      }
      for (const side of SIDES) {
        const h = state[side];
        if (seen[side] && !h.tracked) regainAt[side] = t;
        h.tracked = seen[side];
        h.anchor.userData.tracked = h.tracked;
        if (h.tracked) {
          h.seenAt = t;
          // Glide back after a loss, follow closely otherwise.
          const k = t - regainAt[side] < 350 ? 9 : 40;
          const a = 1 - Math.exp(-dt * k);
          h.anchor.position.lerp(h.palm, a);
          // +Y of the anchor out of the palm, +Z along the fingers.
          w.copy(h.anchor.position).add(h.along);
          h.anchor.up.copy(h.palmNormal);
          h.anchor.lookAt(w);
          h.anchor.updateMatrixWorld();
          const pinchNow = selecting[side] || (h.pinching ? h.pinchGap < PINCH_OFF : h.pinchGap < PINCH_ON);
          if (pinchNow !== h.pinching) {
            h.pinching = pinchNow;
            if (!pinchNow) {
              // Aim with the pose from a few frames before the release.
              const old = history[side][(historyAt + 1) % 8];
              h.rayOrigin.copy(old.o);
              h.rayDir.copy(old.d);
            }
            emit(side, pinchNow);
          }
        } else if (h.pinching) {
          h.pinching = false;
          emit(side, false);
        }
      }
    },
  };

  registerTest('loseHand', (side: Side, seconds: number) => hands.lose(side, Number(seconds) || 0.8));
  registerDebug('hands', {
    state: () => ({
      left: { tracked: state.left.tracked, palmUp: state.left.palmUp, pinching: state.left.pinching, normalY: +state.left.palmNormal.y.toFixed(2), gap: +state.left.pinchGap.toFixed(3) },
      right: { tracked: state.right.tracked, palmUp: state.right.palmUp, pinching: state.right.pinching, normalY: +state.right.palmNormal.y.toFixed(2), gap: +state.right.pinchGap.toFixed(3) },
    }),
    palm: (side: Side) => state[side].palm.toArray(),
    tip: (side: Side) => state[side].indexTip.toArray(),
    ray: (side: Side) => ({ o: state[side].rayOrigin.toArray(), d: state[side].rayDir.toArray() }),
  });
  return hands;
}
