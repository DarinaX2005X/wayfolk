/**
 * Reads the local person's pose for presence: the head from the camera, and each hand
 * as its wrist pose and five fingertips from IWSDK's hand adapters (or the grip pose of a
 * controller), all in the island's frame so that every visitor shares one space.
 */
import { Matrix4, Quaternion, Vector3, type Camera, type Object3D } from '@iwsdk/core';
import type { HandPose, Presence } from './protocol';

/** The parts of an IWSDK hand adapter this module reads. */
interface HandAdapterLike {
  readonly connected: boolean;
  jointTransforms?: Float32Array;
  gripSpace?: Object3D;
}

interface ControllerAdapterLike {
  readonly connected: boolean;
  gripSpace?: Object3D;
}

/** The parts of the IWSDK World this module reads. */
export interface PoseWorld {
  camera: Camera;
  input?: {
    xr?: {
      visualAdapters?: {
        hand: { left: HandAdapterLike; right: HandAdapterLike };
        controller: { left: ControllerAdapterLike; right: ControllerAdapterLike };
        left?: { value?: unknown; peek?: () => unknown };
        right?: { value?: unknown; peek?: () => unknown };
      };
    };
  };
  renderer?: { xr?: { isPresenting?: boolean } };
}

// WebXR hand joint order: wrist 0, thumb tip 4, index tip 9, middle 14, ring 19, pinky 24.
const TIP_JOINTS = [4, 9, 14, 19, 24];
/** A hand whose joints have not moved at all for this long counts as untracked. */
const FROZEN_MS = 400;

export class PoseReader {
  private readonly inv = new Matrix4();
  private readonly spaceQ = new Quaternion();
  private readonly m = new Matrix4();
  private readonly j = new Matrix4();
  private readonly v = new Vector3();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly last = [new Float32Array(25 * 16), new Float32Array(25 * 16)];
  private readonly movedAt = [0, 0];

  constructor(private readonly world: PoseWorld, private readonly space: () => Object3D | null) {}

  /** Fills `out` (head, hands, immersive) in island space. */
  read(out: Presence, now: number): boolean {
    const cam = this.world.camera;
    const space = this.space();
    if (space) {
      space.updateWorldMatrix(true, false);
      this.inv.copy(space.matrixWorld).invert();
      space.matrixWorld.decompose(this.v, this.spaceQ, this.s);
      this.spaceQ.invert();
    } else {
      this.inv.identity();
      this.spaceQ.identity();
    }
    cam.updateWorldMatrix(true, false);
    this.m.multiplyMatrices(this.inv, cam.matrixWorld);
    this.m.decompose(this.v, this.q, this.s);
    out.head.pos = [this.v.x, this.v.y, this.v.z];
    out.head.quat = [this.q.x, this.q.y, this.q.z, this.q.w];
    out.immersive = Boolean(this.world.renderer?.xr?.isPresenting);
    const adapters = out.immersive ? this.world.input?.xr?.visualAdapters : undefined;
    out.left = adapters ? this.hand(adapters, 'left', 0, now) : undefined;
    out.right = adapters ? this.hand(adapters, 'right', 1, now) : undefined;
    return true;
  }

  private hand(adapters: NonNullable<NonNullable<PoseWorld['input']>['xr']>['visualAdapters'] & object, side: 'left' | 'right', h: number, now: number): HandPose | undefined {
    const active = adapters[side];
    const current = active ? (active.peek ? active.peek() : active.value) : undefined;
    const hand = adapters.hand[side];
    const ctl = adapters.controller[side];
    if (hand.connected && hand.jointTransforms && hand.gripSpace && (current === undefined || current === hand)) {
      const jt = hand.jointTransforms;
      if (jt.length < 25 * 16) return undefined;
      // Tracking lost: the runtime stops filling the joints and they freeze.
      const last = this.last[h];
      let moved = false;
      for (let i = 0; i < last.length; i++) {
        if (last[i] !== jt[i]) moved = true;
        last[i] = jt[i];
      }
      if (moved) this.movedAt[h] = now;
      if (now - this.movedAt[h] > FROZEN_MS) return undefined;
      const grip = hand.gripSpace;
      grip.updateWorldMatrix(true, false);
      this.m.multiplyMatrices(this.inv, grip.matrixWorld);
      this.j.fromArray(jt, 0);
      this.j.premultiply(this.m);
      this.j.decompose(this.v, this.q, this.s);
      const wrist: [number, number, number] = [this.v.x, this.v.y, this.v.z];
      const quat: [number, number, number, number] = [this.q.x, this.q.y, this.q.z, this.q.w];
      const tips: [number, number, number][] = [];
      for (const joint of TIP_JOINTS) {
        this.j.fromArray(jt, joint * 16);
        this.v.setFromMatrixPosition(this.j).applyMatrix4(this.m);
        tips.push([this.v.x, this.v.y, this.v.z]);
      }
      return { wrist, quat, tips };
    }
    if (ctl.connected && ctl.gripSpace && (current === undefined || current === ctl)) {
      const grip = ctl.gripSpace;
      grip.updateWorldMatrix(true, false);
      this.m.multiplyMatrices(this.inv, grip.matrixWorld);
      this.m.decompose(this.v, this.q, this.s);
      return { wrist: [this.v.x, this.v.y, this.v.z], quat: [this.q.x, this.q.y, this.q.z, this.q.w] };
    }
    return undefined;
  }
}

/** Whether two presence poses differ enough to be worth a frame. */
export function poseMoved(a: Presence, b: Presence, minMove = 0.003, minTurn = 0.004): boolean {
  if (a.talking !== b.talking || a.immersive !== b.immersive) return true;
  if (Boolean(a.left) !== Boolean(b.left) || Boolean(a.right) !== Boolean(b.right)) return true;
  if (dist(a.head.pos, b.head.pos) > minMove) return true;
  if (1 - Math.abs(dot4(a.head.quat, b.head.quat)) > minTurn * minTurn) return true;
  for (const side of ['left', 'right'] as const) {
    const ha = a[side];
    const hb = b[side];
    if (!ha || !hb) continue;
    if (dist(ha.wrist, hb.wrist) > minMove) return true;
    if (ha.tips && hb.tips) for (let i = 0; i < ha.tips.length; i++) if (dist(ha.tips[i], hb.tips[i]) > minMove) return true;
  }
  return false;
}

function dist(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function dot4(a: readonly number[], b: readonly number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
}
