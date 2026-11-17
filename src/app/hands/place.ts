/**
 * Choosing where a house goes: a glowing ghost footprint follows the pointing hand over
 * the island, warm where the ground is free and grey where it is not (world.validSpot).
 * A pinch confirms; turning the wrist turns the house. At the desk the mouse aims and a
 * click confirms. Also used, without the house outline, for gliding to a spot.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Plane,
  PlaneGeometry,
  Quaternion,
  Ray,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { sound } from '../../feel/sound';
import type { App } from '../boot/world';
import { registerDebug, registerTest } from '../debug';
import { anchorPoint, type WorldPort } from '../ports';
import type { Hands, Side } from './hands';
import type { Replies } from './replies';

export type Spot = { x: number; z: number; rotY: number };

export type Placement = {
  choose(): Promise<Spot>;
  cancel(): void;
  /** Desk: aim with a ray in world space. */
  aim(ray: Ray): void;
  /** Desk and tests: confirm the current aim. */
  confirm(): void;
  readonly active: boolean;
  /** A suggested free spot near the middle of the view, for scenarios. */
  suggest(): Spot | null;
};

function footprintTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,230,170,0.55)');
  grad.addColorStop(0.7, 'rgba(255,200,120,0.35)');
  grad.addColorStop(0.86, 'rgba(255,240,200,0.95)');
  grad.addColorStop(0.92, 'rgba(255,200,120,0.4)');
  grad.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createPlacement(app: App, hands: Hands, world: WorldPort, replies: Replies): Placement {
  const ghost = new Group();
  ghost.name = 'ghost:house';
  ghost.visible = false;
  app.roots.fx.add(ghost);
  const padMat = new MeshBasicMaterial({ map: footprintTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, color: '#ffd28a' });
  const pad = new Mesh(new PlaneGeometry(3.6, 3.6), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.04;
  pad.renderOrder = 5;
  const lineMat = new LineBasicMaterial({ color: '#ffe2a8', transparent: true, opacity: 0.85 });
  const walls = new LineSegments(new EdgesGeometry(new BoxGeometry(2.6, 1.9, 2.2)), lineMat);
  walls.position.y = 0.95;
  const roof = new LineSegments(new EdgesGeometry(new ConeGeometry(2.0, 1.4, 4)), lineMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.6;
  const door = new LineSegments(new EdgesGeometry(new BoxGeometry(0.6, 1.0, 0.02)), lineMat);
  door.position.set(0, 0.5, 1.11);
  ghost.add(pad, walls, roof, door);

  // A named point where a free spot is, so scenarios can aim the hand ray at it.
  const suggested = new Object3D();
  suggested.name = 'spot:suggested';
  app.roots.fx.add(suggested);

  let resolve: ((s: Spot) => void) | null = null;
  let side: Side | null = null;
  let rollAtStart = 0;
  let extraTurn = 0;
  let current: Spot | null = null;
  let valid = false;
  const ground = new Plane(new Vector3(0, 1, 0), 0);
  const ray = new Ray();
  const hit = new Vector3();
  const seatP = new Vector3();

  const groundY = (): number => {
    anchorPoint(world.seat, seatP);
    return seatP.y;
  };

  const aimAt = (r: Ray): void => {
    let y = groundY();
    for (let i = 0; i < 2; i += 1) {
      ground.constant = -y;
      if (!r.intersectPlane(ground, hit)) {
        valid = false;
        return;
      }
      const g = world.groundY?.(hit.x, hit.z) ?? world.groundAt?.(hit.x, hit.z);
      if (g === undefined || !Number.isFinite(g) || Math.abs(g - y) < 0.05) break;
      if (g < y - 5) break;
      y = g;
    }
    if (hit.distanceTo(r.origin) > 40) {
      valid = false;
      ghost.visible = false;
      return;
    }
    const v = world.validSpot({ x: hit.x, y: hit.y, z: hit.z });
    valid = v.ok;
    const sx = v.snapped?.x ?? hit.x;
    const sz = v.snapped?.z ?? hit.z;
    const sy = v.snapped?.y ?? world.groundY?.(sx, sz) ?? world.groundAt?.(sx, sz) ?? y;
    current = { x: sx, z: sz, rotY: v.rotY + extraTurn };
    ghost.visible = true;
    const a = ghost.userData.seen ? 0.35 : 1;
    ghost.position.x += (sx - ghost.position.x) * a;
    ghost.position.z += (sz - ghost.position.z) * a;
    ghost.position.y = Number.isFinite(sy) ? sy : y;
    ghost.rotation.y = current.rotY;
    ghost.userData.seen = true;
    padMat.color.set(valid ? '#ffd28a' : '#7d7d86');
    lineMat.color.set(valid ? '#ffe2a8' : '#9a9aa6');
  };

  const confirm = (): void => {
    if (!resolve || !current || !valid) {
      if (resolve) sound.play('ask');
      return;
    }
    const r = resolve;
    resolve = null;
    ghost.visible = false;
    ghost.userData.seen = false;
    sound.play('stake', { at: ghost.position });
    r({ ...current });
  };

  hands.onPinch((s, down) => {
    if (!resolve || replies.consumed(s)) return;
    if (down) {
      side = s;
      rollAtStart = hands.get(s).roll;
      return;
    }
    if (side === s) confirm();
  });

  app.everyFrame(() => {
    if (!resolve || app.store.mode.peek() === 'desk') return;
    // The pointing hand: the one that pinches, else the primary one.
    const h = side && hands.get(side).tracked ? hands.get(side) : hands.primary();
    if (!h) return;
    if (h.pinching && side === h.side) {
      // Wrist turn while pinching turns the house.
      let d = h.roll - rollAtStart;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      extraTurn = d * 1.5;
    }
    ray.origin.copy(h.rayOrigin);
    ray.direction.copy(h.rayDir);
    aimAt(ray);
  });

  const placement: Placement = {
    choose() {
      extraTurn = 0;
      current = null;
      side = null;
      const s = placement.suggest();
      if (s) {
        suggested.position.set(s.x, world.groundY?.(s.x, s.z) ?? groundY(), s.z);
        // In a page the ghost waits on the suggested spot until the pointer moves it.
        if (app.store.mode.peek() === 'desk') aimAt(new Ray(new Vector3(s.x, groundY() + 6, s.z), new Vector3(0, -1, 0)));
      }
      return new Promise((r) => {
        resolve = r;
      });
    },
    cancel() {
      resolve = null;
      ghost.visible = false;
    },
    aim(r) {
      if (resolve) aimAt(r);
    },
    confirm,
    get active() {
      return resolve !== null;
    },
    suggest() {
      const offered = world.suggestSpot?.();
      if (offered?.ok) {
        // A house close by fills a side of the seated view: the same way out, but a little
        // further, when the ground there is free.
        anchorPoint(world.seat, seatP);
        const dx = offered.snapped.x - seatP.x;
        const dz = offered.snapped.z - seatP.z;
        const d = Math.hypot(dx, dz);
        if (d > 1 && d < 10.5) {
          const k = 11.2 / d;
          const v = world.validSpot({ x: seatP.x + dx * k, y: seatP.y, z: seatP.z + dz * k });
          const far = v.snapped ? Math.hypot(v.snapped.x - seatP.x, v.snapped.z - seatP.z) : 0;
          if (v.ok && v.snapped && far >= 10 && far <= 13.5) return { x: v.snapped.x, z: v.snapped.z, rotY: v.rotY };
        }
        return { x: offered.snapped.x, z: offered.snapped.z, rotY: offered.rotY };
      }
      // Walk out from the seat along its view until validSpot says yes.
      anchorPoint(world.seat, seatP);
      const cam = app.world.camera;
      const f = new Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new Quaternion()));
      f.y = 0;
      f.normalize();
      for (let d = 6.5; d < 16; d += 0.5) {
        for (const side of [0, 1, -1, 2, -2]) {
          const x = seatP.x + f.x * d - f.z * side * 1.5;
          const z = seatP.z + f.z * d + f.x * side * 1.5;
          const v = world.validSpot({ x, y: seatP.y, z });
          if (v.ok) return { x: v.snapped?.x ?? x, z: v.snapped?.z ?? z, rotY: v.rotY };
        }
      }
      return null;
    },
  };

  registerTest('place', (x?: number, z?: number) => {
    const s = x === undefined || z === undefined ? placement.suggest() : { x, z, rotY: 0 };
    if (!s) return false;
    const r = new Ray(new Vector3(s.x, groundY() + 5, s.z), new Vector3(0, -1, 0));
    aimAt(r);
    confirm();
    return true;
  });
  registerDebug('placement', { suggest: () => placement.suggest(), active: () => placement.active, valid: () => valid, current: () => current });
  return placement;
}
