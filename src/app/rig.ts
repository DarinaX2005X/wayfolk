/**
 * Where the person is on the island. The island stays put; the player rig (the XR origin,
 * `world.player`) is moved so that the head lands over a seat or a glide spot, facing the
 * way the spot faces, with the real floor on the island ground. At the desk the camera
 * sits at seated eye height on the same spot and looks around with the mouse or touch.
 */
import { MathUtils, Vector3, type Object3D } from '@iwsdk/core';
import type { App } from './boot/world';
import { anchorPoint, anchorYaw, type Anchor } from './ports';

export const EYE_HEIGHT = 1.15;

export type Rig = {
  /** Puts the person at an anchor (seat or glide spot). */
  placeAt(anchor: Anchor, opts?: { groundOffset?: number }): void;
  /** Desk look: yaw and pitch of the camera in radians, relative to the spot's facing. */
  look(yaw: number, pitch: number): void;
  /** Desk walking: puts the person's feet at a point of the ground, keeping the facing. */
  stepTo(x: number, y: number, z: number): void;
  readonly lookYaw: number;
  readonly lookPitch: number;
  /** The head object (the camera) in world space. */
  head(): Object3D;
  /** Where the current spot is, world space (floor level). */
  spot: Vector3;
  spotYaw: number;
};

export function createRig(app: App): Rig {
  const { world } = app;
  const p = new Vector3();
  const f = new Vector3();
  let yaw = 0;
  let pitch = MathUtils.degToRad(-8);
  const spot = new Vector3();
  let spotYaw = 0;

  const aimDesk = (): void => {
    const cam = world.camera;
    cam.position.set(0, EYE_HEIGHT, 0);
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
  };

  const rig: Rig = {
    placeAt(anchor, opts) {
      anchorPoint(anchor, p);
      spot.copy(p);
      spot.y += opts?.groundOffset ?? 0;
      spotYaw = anchorYaw(anchor);
      const player = world.player;
      if (world.renderer.xr.isPresenting) {
        // Head pose relative to the rig: keep it, turn and shift the rig around it.
        const cam = world.camera;
        f.set(0, 0, -1).applyQuaternion(cam.quaternion);
        const headYaw = Math.atan2(-f.x, -f.z);
        const ry = spotYaw - headYaw;
        player.rotation.set(0, ry, 0);
        const c = Math.cos(ry);
        const s = Math.sin(ry);
        const hx = cam.position.x;
        const hz = cam.position.z;
        player.position.set(spot.x - (c * hx + s * hz), spot.y, spot.z - (-s * hx + c * hz));
      } else {
        player.position.copy(spot);
        player.rotation.set(0, spotYaw, 0);
        yaw = 0;
        aimDesk();
      }
      player.updateMatrixWorld(true);
    },
    look(y, x) {
      yaw = y;
      pitch = MathUtils.clamp(x, -1.2, 1.0);
      if (!world.renderer.xr.isPresenting) aimDesk();
    },
    stepTo(x, y, z) {
      if (world.renderer.xr.isPresenting) return;
      spot.set(x, y, z);
      world.player.position.set(x, y, z);
      world.player.updateMatrixWorld(true);
    },
    get lookYaw() {
      return yaw;
    },
    get lookPitch() {
      return pitch;
    },
    head: () => world.camera,
    spot,
    get spotYaw() {
      return spotYaw;
    },
  };
  return rig;
}
