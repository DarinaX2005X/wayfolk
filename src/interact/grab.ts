/**
 * `onGrab(grabbable, opts)`: take an object of the kit by hand, carry it and let go
 * (PLAN "Набор ремесла", "Захват и выбор на одном предмете").
 *
 * A takeable object has three nodes (the kit's `Grabbable`):
 *   handle  moved by the built-in grab: `OneHandGrabbable` on its entity. IWSDK denies
 *           rays on it and on all its children, and a hand pinch next to it grabs.
 *   body    animated by the kit; this layer never writes it.
 *   proxy   an invisible volume of the same size next to the handle (a sibling): rays,
 *           gaze, dwell and the mouse hit it. This layer puts it on the handle every frame,
 *           hides it while the object is held, and never lets a hand closer than 12 cm
 *           select through it (near, the object is taken; from afar, it is selected).
 *
 * On release the object snaps to the nearest target within its radius in 120 ms and
 * calls `onDrop(target, 'released')`; released anywhere else it returns to where it
 * was taken in `returnMs` (400 ms) and calls `onDrop(null, 'released')`. A hand lost for
 * more than 0.5 s lets go (`onDrop(null, 'lost')`). While `Grabbed` is on the entity
 * nothing here writes the handle. A second hand never takes over what the first holds.
 *
 * At the desk a mouse drag on the proxy carries the object over the bench plane the
 * same way, and a click without a drag stays a select.
 */
import {
  Mesh,
  OneHandGrabbable,
  Plane,
  Quaternion,
  Ray,
  Vector2,
  Vector3,
  type Entity,
  type Object3D,
} from '@iwsdk/core';
import { answer } from '../feel';
import { Holds, LossTimer, RULES, pickSnap, tween, type Hand, type V3 } from './logic';
import { swallowClick } from './select';
import {
  current,
  ensureEntity,
  everyFrame,
  grabSystem,
  handTracked,
  isGrabbed,
  makeInteractable,
  now,
  report,
  seatPoint,
  sourceOf,
  whenAttached,
  worldRadius,
  type PointerEventLike,
} from './runtime';

/** The three nodes of a takeable object (PLAN "Набор ремесла", `Grabbable`). */
export type Grabbable = { handle: Object3D; body: Object3D; proxy: Object3D };

export type DropWhy = 'released' | 'lost';

export type GrabOptions = {
  snapTo?: { target: Object3D; radius: number }[];
  /** Called every frame while the object is carried, with the handle. */
  onMove?: (handle: Object3D) => void;
  onDrop(hit: Object3D | null, why: DropWhy): void;
  /** Time of the return to the place it was taken from, ms (400 by default). */
  returnMs?: number;
  /** Called the moment the object is taken. */
  onTake?: (hand: Hand | 'mouse') => void;
};

/** Who holds what, shared with pull: one holder per object, one pull at a time. */
export const holds = new Holds();

type Rec = {
  g: Grabbable;
  opts: GrabOptions;
  entity: Entity | null;
  held: Hand | 'mouse' | null;
  /** Local pose of the handle when it was taken. */
  home: { p: Vector3; q: Quaternion };
  move: { from: Vector3; to: Vector3; qFrom: Quaternion; qTo: Quaternion; t0: number; ms: number } | null;
  loss: LossTimer;
  lost: boolean;
  inflate: number;
};

const recs = new Set<Rec>();
const byHandle = new WeakMap<Object3D, Rec>();

/** The grab record of a handle: reveal reads the hold from it. */
export function grabState(handle: Object3D): { held: Hand | 'mouse' | null; home: { p: Vector3; q: Quaternion } } | null {
  const r = byHandle.get(handle);
  return r ? { held: r.held, home: r.home } : null;
}

const v = new Vector3();
const w = new Vector3();

function hideProxyMaterial(proxy: Object3D): void {
  const mesh = proxy as Mesh;
  if (!mesh.isMesh) return;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  // Not drawn, still hit: three's raycast ignores material visibility.
  for (const m of mats) if (m) m.visible = false;
}

/** World point of a snap target. */
function targetAt(t: Object3D, out: Vector3): Vector3 {
  t.updateWorldMatrix(true, false);
  return t.getWorldPosition(out);
}

function syncProxy(r: Rec): void {
  const { handle, proxy } = r.g;
  if (proxy.parent !== handle.parent) handle.parent?.add(proxy);
  proxy.position.copy(handle.position);
  proxy.quaternion.copy(handle.quaternion);
  proxy.scale.copy(handle.scale).multiplyScalar(r.inflate);
  const show = r.held === null;
  if (proxy.visible !== show) proxy.visible = show;
}

function startMove(r: Rec, toLocal: Vector3, qTo: Quaternion, ms: number): void {
  const h = r.g.handle;
  r.move = { from: h.position.clone(), to: toLocal.clone(), qFrom: h.quaternion.clone(), qTo: qTo.clone(), t0: now(), ms };
}

/** Lets go: snap to the nearest target in reach, or go back home. */
function drop(r: Rec, why: DropWhy): void {
  const h = r.g.handle;
  h.updateWorldMatrix(true, false);
  const at = h.getWorldPosition(v).toArray() as V3;
  const targets = (r.opts.snapTo ?? []).map((s) => ({ target: s.target, radius: s.radius, at: targetAt(s.target, w).toArray() as V3 }));
  const hit = why === 'released' ? pickSnap(at, targets) : null;
  if (hit) {
    const local = new Vector3(...hit.at);
    h.parent?.worldToLocal(local);
    startMove(r, local, h.quaternion, RULES.snapMs);
    answer({ type: 'drop', at: new Vector3(...hit.at) });
  } else {
    startMove(r, r.home.p, r.home.q, r.opts.returnMs ?? RULES.returnMs);
  }
  report('drop', r.g.proxy, r.held === 'mouse' ? 'mouse' : 'hand');
  r.held = null;
  holds.release(r);
  try {
    r.opts.onDrop(hit ? hit.target : null, why);
  } catch (error) {
    console.error('[gw] onDrop failed', error);
  }
}

function take(r: Rec, hand: Hand | 'mouse'): void {
  const h = r.g.handle;
  if (!r.move) r.home = { p: h.position.clone(), q: h.quaternion.clone() };
  r.move = null;
  r.held = hand;
  r.loss.reset();
  r.lost = false;
  if (hand !== 'mouse') holds.take(r, hand);
  h.updateWorldMatrix(true, false);
  answer({ type: 'grab', at: h.getWorldPosition(new Vector3()) });
  report('grab', r.g.proxy, hand === 'mouse' ? 'mouse' : 'hand');
  r.opts.onTake?.(hand);
}

function frame(r: Rec, t: number): void {
  const h = r.g.handle;
  const entity = r.entity;
  const grabbed = entity ? isGrabbed(entity) : false;

  if (r.held !== 'mouse') {
    if (grabbed && r.held === null) {
      const hand = grabSystem()?.getHolderHand(entity!) ?? 'right';
      take(r, hand);
    } else if (!grabbed && r.held !== null) {
      drop(r, r.lost ? 'lost' : 'released');
    } else if (grabbed && r.held) {
      const holder = grabSystem()?.getHolderHand(entity!);
      if (holder && holder !== r.held) {
        // The other hand reached in: the first hand keeps it.
        console.warn('[gw] a second hand tried to take a held object; the first hand keeps it');
      }
      if (r.loss.update(handTracked(r.held), t)) {
        r.lost = true;
        grabSystem()?.forceRelease(entity!);
      }
    }
  }

  if (r.held !== null) {
    r.opts.onMove?.(h);
  } else if (r.move) {
    const m = r.move;
    const k = Math.min(1, (t - m.t0) / Math.max(1, m.ms));
    const p = tween(m.from.toArray() as V3, m.to.toArray() as V3, t - m.t0, m.ms);
    h.position.set(p[0], p[1], p[2]);
    h.quaternion.slerpQuaternions(m.qFrom, m.qTo, 1 - (1 - k) ** 3);
    if (k >= 1) r.move = null;
  }
  syncProxy(r);
}

// ---------------------------------------------------------------- the mouse at the desk

const ndc = new Vector2();
const plane = new Plane();
const ray = new Ray();

function mouseRay(native: MouseEvent): Ray | null {
  const b = current();
  if (!b) return null;
  const canvas = b.world.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  ndc.set(((native.clientX - rect.left) / rect.width) * 2 - 1, -((native.clientY - rect.top) / rect.height) * 2 + 1);
  const camera = b.world.camera;
  camera.updateMatrixWorld();
  ray.origin.setFromMatrixPosition(camera.matrixWorld);
  ray.direction.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(ray.origin).normalize();
  return ray;
}

/** A drag that starts on the proxy carries the object over a level plane at its height (lifted 3 cm). */
function startMouseDrag(r: Rec, e: PointerEventLike): void {
  const native = e.nativeEvent as PointerEvent | undefined;
  if (!native || typeof native.clientX !== 'number') return;
  const h = r.g.handle;
  h.updateWorldMatrix(true, false);
  const start = h.getWorldPosition(new Vector3());
  const lift = 0.03;
  plane.set(new Vector3(0, 1, 0), -(start.y + lift));
  const x0 = native.clientX;
  const y0 = native.clientY;
  let dragging = false;
  const grabAt = new Vector3();
  const first = mouseRay(native);
  if (first) first.intersectPlane(plane, grabAt);
  const offset = new Vector3().subVectors(start, grabAt);
  offset.y = lift;

  const onMove = (ev: PointerEvent): void => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!dragging) {
      dragging = true;
      take(r, 'mouse');
    }
    const ry = mouseRay(ev);
    if (!ry || !ry.intersectPlane(plane, w)) return;
    w.add(offset);
    h.parent?.worldToLocal(w);
    h.position.copy(w);
    r.opts.onMove?.(h);
  };
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!dragging) return;
    swallowClick(r.g.proxy);
    drop(r, 'released');
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

// ---------------------------------------------------------------- the contract

export function onGrab(g: Grabbable, opts: GrabOptions): () => void {
  const r: Rec = {
    g,
    opts,
    entity: null,
    held: null,
    home: { p: g.handle.position.clone(), q: g.handle.quaternion.clone() },
    move: null,
    loss: new LossTimer(),
    lost: false,
    inflate: 1,
  };
  let alive = true;
  let stopFrame: (() => void) | null = null;
  byHandle.set(g.handle, r);

  const onDown = (event: unknown): void => {
    const e = event as PointerEventLike;
    if (sourceOf(e).kind === 'mouse' && r.held === null) startMouseDrag(r, e);
  };

  whenAttached(g.handle, ({ world }) => {
    if (!alive) return;
    hideProxyMaterial(g.proxy);
    if (!g.proxy.parent) g.handle.parent?.add(g.proxy);
    r.entity = ensureEntity(world, g.handle);
    if (r.entity && !r.entity.hasComponent(OneHandGrabbable)) r.entity.addComponent(OneHandGrabbable, {});
    // The hit volume is never smaller than 2.2° from the seat.
    const radius = worldRadius(g.handle);
    const seat = seatPoint(w);
    g.handle.getWorldPosition(v);
    const need = Math.tan(((RULES.minAngleDeg / 2) * Math.PI) / 180) * v.distanceTo(seat);
    r.inflate = radius > 1e-6 ? Math.max(1, need / radius) : 1;
    makeInteractable(world, g.proxy);
    g.proxy.addEventListener('pointerdown' as never, onDown as never);
    syncProxy(r);
    recs.add(r);
    stopFrame = everyFrame((_dt, t) => frame(r, t));
  });

  return () => {
    alive = false;
    stopFrame?.();
    recs.delete(r);
    holds.release(r);
    g.proxy.removeEventListener('pointerdown' as never, onDown as never);
    const b = current();
    if (b && r.entity?.hasComponent(OneHandGrabbable)) r.entity.removeComponent(OneHandGrabbable);
  };
}
