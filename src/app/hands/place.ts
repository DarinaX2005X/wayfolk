/**
 * Choosing where a house goes: a glowing ghost footprint follows the pointing hand over
 * the island, warm where the ground is free and grey where it is not (world.validSpot).
 * A pinch confirms; turning the wrist turns the house. At the desk the mouse aims and a
 * click confirms. Also used, without the house outline, for gliding to a spot.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  Group,
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

/** A soft glowing footprint: a warm rounded patch of light with a brighter rim. */
function footprintTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rr = (inset: number, r: number): void => {
    g.beginPath();
    g.roundRect(inset, inset, 256 - inset * 2, 256 - inset * 2, r);
  };
  g.filter = 'blur(10px)';
  rr(26, 60);
  g.fillStyle = 'rgba(255,214,150,0.4)';
  g.fill();
  g.filter = 'blur(5px)';
  g.lineWidth = 9;
  rr(40, 52);
  g.strokeStyle = 'rgba(255,240,205,0.95)';
  g.stroke();
  g.filter = 'none';
  // A few sparks of light along the rim, like dust caught in the sun.
  for (let i = 0; i < 14; i += 1) {
    const a = (i / 14) * Math.PI * 2;
    const x = 128 + Math.cos(a) * 92;
    const y = 128 + Math.sin(a) * 92;
    const s = g.createRadialGradient(x, y, 0, x, y, 9);
    s.addColorStop(0, 'rgba(255,250,225,0.9)');
    s.addColorStop(1, 'rgba(255,230,170,0)');
    g.fillStyle = s;
    g.fillRect(x - 9, y - 9, 18, 18);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * The house to be, as a soft column of light: a body and a gabled roof, bright where it
 * meets the grass and fading to nothing at the ridge. Vertex colours carry the fade.
 */
function silhouetteGeometry(w: number, h: number, d: number, rise: number): BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const top = h + rise;
  const pos: number[] = [];
  const quad = (a: number[], b: number[], c: number[], e: number[]): void => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...e);
  };
  // Four walls.
  quad([-hw, 0, hd], [hw, 0, hd], [hw, h, hd], [-hw, h, hd]);
  quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, -hd], [hw, h, -hd]);
  quad([-hw, 0, -hd], [-hw, 0, hd], [-hw, h, hd], [-hw, h, -hd]);
  quad([hw, 0, hd], [hw, 0, -hd], [hw, h, -hd], [hw, h, hd]);
  // Gable ends and the two roof slopes.
  pos.push(-hw, h, hd, hw, h, hd, 0, top, hd);
  pos.push(hw, h, -hd, -hw, h, -hd, 0, top, -hd);
  quad([-hw - 0.15, h - 0.05, hd + 0.15], [0, top, hd + 0.15], [0, top, -hd - 0.15], [-hw - 0.15, h - 0.05, -hd - 0.15]);
  quad([hw + 0.15, h - 0.05, -hd - 0.15], [0, top, -hd - 0.15], [0, top, hd + 0.15], [hw + 0.15, h - 0.05, hd + 0.15]);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  const col = new Float32Array((pos.length / 3) * 4);
  for (let i = 0; i < pos.length / 3; i += 1) {
    const y = pos[i * 3 + 1];
    const k = Math.max(0, 1 - y / (top * 1.05));
    col[i * 4] = 1;
    col[i * 4 + 1] = 0.92;
    col[i * 4 + 2] = 0.78;
    col[i * 4 + 3] = 0.05 + 0.32 * k * k;
  }
  g.setAttribute('color', new BufferAttribute(col, 4));
  return g;
}

export function createPlacement(app: App, hands: Hands, world: WorldPort, replies: Replies): Placement {
  const ghost = new Group();
  ghost.name = 'ghost:house';
  ghost.visible = false;
  app.roots.fx.add(ghost);
  const padMat = new MeshBasicMaterial({ map: footprintTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, color: '#ffd28a' });
  const pad = new Mesh(new PlaneGeometry(3.4, 3.1), padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.05;
  pad.renderOrder = 5;
  const lineMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, color: '#ffe2a8', toneMapped: false });
  const shape = new Mesh(silhouetteGeometry(2.5, 1.8, 2.1, 1.15), lineMat);
  shape.renderOrder = 6;
  ghost.add(pad, shape);
  // It breathes a little while it waits for the pinch.
  app.everyFrame((_dt, now) => {
    if (!ghost.visible) return;
    const k = 0.85 + Math.sin(now / 420) * 0.15;
    lineMat.opacity = k;
    padMat.opacity = 0.8 + Math.sin(now / 420 + 1) * 0.2;
  });

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
        if (d > 1 && d < 9.4) {
          const k = 10.2 / d;
          const v = world.validSpot({ x: seatP.x + dx * k, y: seatP.y, z: seatP.z + dz * k });
          const far = v.snapped ? Math.hypot(v.snapped.x - seatP.x, v.snapped.z - seatP.z) : 0;
          if (v.ok && v.snapped && far >= 9.3 && far <= 12) return { x: v.snapped.x, z: v.snapped.z, rotY: v.rotY };
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
