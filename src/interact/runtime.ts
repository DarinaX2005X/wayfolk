/**
 * The running part of the input layer: one ECS system that feeds the rules of ./logic.ts
 * with poses every frame, entities for the objects of the kit, and the reading of a
 * pointer event (which hand, which kind of input, where its wrist is).
 *
 * `bindInteract(app)` is called once per World (the gallery calls it; the product needs
 * it called from the core feature, see the report of package 01.3). Every `onSelect`,
 * `onGrab`, `onPull` and `onReveal` made before that waits and attaches on bind.
 *
 * How IWSDK delivers input here (tests/xr/probe/README.md has the measured table):
 *   - Pointer events on objects come from @pmndrs/pointer-events: `pointerdown`,
 *     `pointerup`, `click`, `pointerenter`, `pointerleave`, with `pointerId` and
 *     `pointerType` ('ray' for hand and controller rays and gaze, 'grab' near a hand,
 *     'touch' for the fingertip, 'screen-mouse' / 'screen-touch' from the canvas).
 *   - The hand of a pointer: its id equals `world.input.xr.multiPointers[hand]
 *     .getPointer(kind).id`; gaze has `world.input.xr.gazePointer.pointer.id`.
 *   - The wrist of that hand: `world.player.raySpaces[hand]` (the ray starts at the hand
 *     and moves with it; the emulator's `pull` step moves exactly this).
 *   - Grab is the built-in `OneHandGrabbable` on the handle; `Grabbed` tells it is held,
 *     `GrabSystem.getHolderHand` which hand, `forceRelease` lets go.
 */
import {
  Box3,
  GrabSystem,
  Grabbed,
  Quaternion,
  RayInteractable,
  PokeInteractable,
  Vector3,
  createSystem,
  type Entity,
  type Object3D,
  type World,
} from '@iwsdk/core';
import type { InputKind } from '../app/store';
import type { App, Interaction } from '../app/boot/world';
import { registerDebug, registerTest } from '../app/debug';
import { store } from '../app/store';
import { nameOf } from './targets';
import type { Hand } from './logic';

type Bound = { app: App; world: World };

let bound: Bound | null = null;
const waiting: ((b: Bound) => void)[] = [];
const tickers = new Set<(dt: number, now: number) => void>();

/** Runs `fn` with the bound World now, or as soon as `bindInteract` is called. */
export function whenBound(fn: (b: Bound) => void): void {
  if (bound) fn(bound);
  else waiting.push(fn);
}

export function current(): Bound | null {
  return bound;
}

/** Adds a per-frame function; returns its removal. */
export function everyFrame(fn: (dt: number, now: number) => void): () => void {
  tickers.add(fn);
  return () => {
    tickers.delete(fn);
  };
}

class InteractSystem extends createSystem({}) {
  update(delta: number): void {
    if (!bound) return;
    const now = bound.app.clock.now();
    for (const fn of [...tickers]) {
      try {
        fn(delta, now);
      } catch (error) {
        console.error('[gw] interact: a frame step failed', error);
      }
    }
  }
}

const forcedLost: Record<Hand, number> = { left: 0, right: 0 };

/**
 * Binds the input layer to the app's World. Safe to call more than once (the second
 * call does nothing).
 */
export function bindInteract(app: App): void {
  if (bound) return;
  bound = { app, world: app.world };
  app.world.registerSystem(InteractSystem);
  // Canvas pointer events reach every object at the desk; in a session only objects with
  // RayInteractable. Keep the lists ready outside the session too, so desk input sees the
  // same targets.
  for (const fn of waiting.splice(0)) fn(bound);

  registerTest('loseHand', (hand: Hand, seconds: number) => {
    const device = (window as unknown as { IWER_DEVICE?: { hands?: Record<Hand, { connected: boolean }> } }).IWER_DEVICE;
    const ms = Math.max(0, Number(seconds) || 0) * 1000;
    const input = device?.hands?.[hand];
    if (input) {
      input.connected = false;
      setTimeout(() => {
        input.connected = true;
      }, ms);
    }
    // Also lose it in our own reading, for a browser without the emulator.
    forcedLost[hand] = performance.now() + ms;
  });
  registerDebug('interact', { tracked: handTracked, wrist: (h: Hand) => wristOf(h)?.toArray() ?? null });
}

// ---------------------------------------------------------------- entities

type WithIdx = Object3D & { entityIdx?: number };

/**
 * The ECS entity of an object, created on demand. An entity's Object3D must hang
 * directly under another entity's Object3D (IWSDK moves it to the level root otherwise),
 * so every ancestor up to the nearest entity becomes an entity too. Returns null while
 * the object is not attached to the scene yet.
 */
export function ensureEntity(world: World, obj: Object3D): Entity | null {
  const idx = (obj as WithIdx).entityIdx;
  if (idx !== undefined) {
    const found = world.entityManager.getEntityByIndex(idx) as Entity | null;
    if (found) return found;
  }
  if (obj === world.scene) return world.sceneEntity;
  if (!obj.parent) return null;
  const parent = ensureEntity(world, obj.parent);
  if (!parent) return null;
  return world.createTransformEntity(obj, { parent, persistent: true });
}

const rayRoots = new WeakSet<Object3D>();

/** Marks an object (a panel root) whose whole tree answers rays and fingertips. */
export function markRayRoot(obj: Object3D): void {
  rayRoots.add(obj);
}

export function underRayRoot(obj: Object3D): boolean {
  for (let o: Object3D | null = obj; o; o = o.parent) if (rayRoots.has(o)) return true;
  return false;
}

/** Gives `obj` an entity with RayInteractable (and PokeInteractable when asked). */
export function makeInteractable(world: World, obj: Object3D, poke = false): Entity | null {
  const entity = ensureEntity(world, obj);
  if (!entity) return null;
  if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable);
  if (poke && !entity.hasComponent(PokeInteractable)) entity.addComponent(PokeInteractable);
  return entity;
}

/** Waits until `obj` is attached under the scene, then runs `fn` (checked once a frame). */
export function whenAttached(obj: Object3D, fn: (b: Bound) => void): void {
  whenBound((b) => {
    const attached = (): boolean => {
      for (let o: Object3D | null = obj; o; o = o.parent) if (o === b.world.scene) return true;
      return false;
    };
    if (attached()) {
      fn(b);
      return;
    }
    const off = everyFrame(() => {
      if (!attached()) return;
      off();
      fn(b);
    });
  });
}

// ---------------------------------------------------------------- reading a pointer event

/** The parts of a pointer event of @pmndrs/pointer-events this layer reads. */
export type PointerEventLike = {
  pointerId?: number;
  pointerType?: string;
  nativeEvent?: unknown;
  point?: Vector3;
  object?: Object3D;
  stopPropagation?: () => void;
  target?: { setPointerCapture?: (id: number) => void; releasePointerCapture?: (id: number) => void };
};

export type Source = { kind: InputKind; hand: Hand | null };

/** Which input made a pointer event: the hand and the kind (PLAN `InputKind`). */
export function sourceOf(e: PointerEventLike): Source {
  const b = bound;
  const type = e.pointerType ?? '';
  // Canvas input is forwarded into the scene as "screen-mouse", "screen-touch", "screen-pen".
  if (type.startsWith('screen-') || type.startsWith('forward-') || type === 'mouse' || type === 'pen') return { kind: 'mouse', hand: null };
  if (!b) return { kind: 'ray', hand: null };
  const xr = b.world.input.xr;
  const id = e.pointerId;
  try {
    if (id !== undefined && xr.gazePointer?.pointer?.id === id) return { kind: 'gaze', hand: null };
    for (const hand of ['left', 'right'] as const) {
      const multi = xr.multiPointers[hand];
      for (const kind of ['ray', 'grab', 'touch'] as const) {
        if (multi.getPointer(kind).id === id) return { kind: kind === 'ray' ? 'ray' : 'hand', hand };
      }
    }
  } catch {
    // An older runtime without these lists: fall back on the pointer type.
  }
  return { kind: type === 'grab' || type === 'touch' ? 'hand' : 'ray', hand: null };
}

const tmp = new Vector3();

/** World position of a hand's wrist (its ray space), or null when that hand is not tracked. */
export function wristOf(hand: Hand, out = new Vector3()): Vector3 | null {
  const b = bound;
  if (!b || !handTracked(hand)) return null;
  const space = b.world.player.raySpaces[hand];
  space.updateWorldMatrix(true, false);
  return space.getWorldPosition(out);
}

/** Whether a hand (or controller) is tracked now. */
export function handTracked(hand: Hand): boolean {
  if (performance.now() < forcedLost[hand]) return false;
  const b = bound;
  if (!b?.world.session) return false;
  try {
    return b.world.input.xr.getPrimaryInputSource(hand) !== undefined;
  } catch {
    return false;
  }
}

/** Whether the select (pinch or trigger) of a hand is still held. */
export function selectHeld(hand: Hand): boolean {
  const b = bound;
  if (!b) return false;
  try {
    return b.world.input.xr.getSelectState(hand).active;
  } catch {
    return false;
  }
}

/** Distance from a hand to an object's centre, metres; Infinity without that hand. */
export function handDistance(hand: Hand, obj: Object3D): number {
  const at = wristOf(hand, tmp);
  if (!at) return Infinity;
  const b = bound!;
  const grip = b.world.player.gripSpaces[hand];
  grip.updateWorldMatrix(true, false);
  const g = grip.getWorldPosition(new Vector3());
  return worldCenter(obj, new Vector3()).distanceTo(g);
}

const box = new Box3();

/** Centre of an object's bounds in world space (its origin when it has no geometry). */
export function worldCenter(obj: Object3D, out: Vector3): Vector3 {
  obj.updateWorldMatrix(true, true);
  box.setFromObject(obj);
  return box.isEmpty() ? obj.getWorldPosition(out) : box.getCenter(out);
}

/** Radius of an object's bounds, metres. */
export function worldRadius(obj: Object3D): number {
  obj.updateWorldMatrix(true, true);
  box.setFromObject(obj);
  if (box.isEmpty()) return 0;
  return box.getSize(tmp).length() / 2;
}

/** The eyes of the seated person, world metres: the head in a session, the camera at the desk. */
export function eyes(out = new Vector3()): Vector3 {
  const b = bound;
  if (!b) return out.set(0, 1.15, 0);
  const head = b.world.session ? b.world.player.head : b.world.camera;
  head.updateWorldMatrix(true, false);
  return head.getWorldPosition(out);
}

/** The seated eye point (the origin of the seated frame), world metres. */
export function seatPoint(out = new Vector3()): Vector3 {
  const b = bound;
  if (!b) return out.set(0, 1.15, 0);
  b.app.roots.seat.updateWorldMatrix(true, false);
  return b.app.roots.seat.getWorldPosition(out);
}

/** The GrabSystem of the World, when grabbing is on. */
export function grabSystem(): GrabSystem | null {
  return (bound?.world.getSystem(GrabSystem) as GrabSystem | undefined) ?? null;
}

export function isGrabbed(entity: Entity): boolean {
  return entity.hasComponent(Grabbed);
}

// ---------------------------------------------------------------- reporting

/** Writes the input kind and tells the app what the person did (first session, access). */
export function report(type: Interaction['type'], obj: Object3D, input: InputKind): void {
  store.input.value = input;
  const b = bound;
  if (!b) return;
  try {
    b.app.interactions.emit({ type, target: nameOf(obj), input, at: b.app.clock.now() });
  } catch {
    // Before the core feature has set up the stream there is no one to tell.
  }
}

/** Application time, ms. */
export function now(): number {
  return bound ? bound.app.clock.now() : performance.now();
}

export const scratch = { v: new Vector3(), w: new Vector3(), q: new Quaternion() };
