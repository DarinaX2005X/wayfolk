/**
 * Time of the world kit. Every object of the kit is a pure function of its recorded
 * state and of time: a method (layTile, pulse, spawn…) stamps what happened at `now()`,
 * and `update(t)` sets every node from those stamps and `t` alone. A frozen clock, a
 * gallery state or a frame-by-frame capture therefore always shows the same picture.
 *
 *   useKitClock(fn)   binds the kit to the application clock (app.clock.now)
 *   atTime(ms, fn)    runs fn as if it happened at ms (gallery states, tests)
 *   animate(obj)      registers an object whose update(t) runs every frame
 *   installKit(world) registers the one system that ticks the kit and adds the shadow layer
 */
import { createSystem, type Object3D, type World } from '@iwsdk/core';
import { motionReduced } from '../../feel/motion';

export type Animated = { root: Object3D; update(t: number): void };
export type KitQuality = 'high' | 'medium' | 'low';

let source: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let override: number | null = null;

/** Kit time in ms. */
export function now(): number {
  return override ?? source();
}

/** Binds the kit to another clock (the application clock in the app). */
export function useKitClock(fn: () => number): void {
  source = fn;
}

/** Runs `fn` as if it happened at `ms`: every stamp taken inside gets this time. */
export function atTime<T>(ms: number, fn: () => T): T {
  const previous = override;
  override = ms;
  try {
    return fn();
  } finally {
    override = previous;
  }
}

const live = new Set<Animated>();
const late = new Set<Animated>();

/**
 * Registers an object to be updated every frame while it is in a scene. `last` runs it
 * after all others (batches copy what the objects just set). Returns the undo.
 */
export function animate(obj: Animated, last = false): () => void {
  const set = last ? late : live;
  set.add(obj);
  return () => {
    set.delete(obj);
  };
}

/** Updates every registered object that is attached to something, then the batches. */
export function tickKit(t = now()): void {
  for (const obj of live) if (obj.root.parent) obj.update(t);
  for (const obj of late) if (obj.root.parent) obj.update(t);
}

let quality: KitQuality = 'high';
const qualityListeners = new Set<(q: KitQuality) => void>();
export function kitQuality(): KitQuality {
  return quality;
}
/** Low quality: instrument legs stand still, long shadows are off (tokens QUALITY). */
export function setKitQuality(q: KitQuality): void {
  if (q === quality) return;
  quality = q;
  for (const fn of qualityListeners) fn(q);
}
export function onKitQuality(fn: (q: KitQuality) => void): () => void {
  qualityListeners.add(fn);
  return () => qualityListeners.delete(fn);
}

/** "Less motion": travel and bounce are dropped, end states stay. */
export function lessMotion(): boolean {
  try {
    return motionReduced();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the system

const installed = new WeakSet<World>();
const onInstall: ((world: World) => void)[] = [];

/** Something the kit adds to every world it is installed in (the shadow layer). */
export function whenInstalled(fn: (world: World) => void): void {
  onInstall.push(fn);
}

let kitWorld: World | null = null;
export function currentWorld(): World | null {
  return kitWorld;
}

/**
 * Registers the system that ticks the kit once per frame. Safe to call more than once;
 * every factory that receives the world calls it. Pass the application clock so the kit
 * runs on application time (frozen in capture and tests).
 */
export function installKit(world: World, clock?: { now(): number }): void {
  if (clock) useKitClock(() => clock.now());
  kitWorld = world;
  if (installed.has(world)) return;
  installed.add(world);
  class KitSystem extends createSystem({}) {
    update(): void {
      tickKit();
    }
  }
  world.registerSystem(KitSystem);
  for (const fn of onInstall) fn(world);
}

// ---------------------------------------------------------------- curves

export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
/**
 * Progress 0..1 of a move that started at `start` and lasts `ms` (0 ms jumps). A move
 * that never started (`start` = −Infinity) counts as long finished: the resting state.
 */
export function progress(t: number, start: number, ms: number): number {
  if (!(start > -Infinity)) return 1;
  if (ms <= 0) return t >= start ? 1 : 0;
  return clamp01((t - start) / ms);
}
export const easeOut = (k: number): number => 1 - (1 - k) ** 3;
export const easeIn = (k: number): number => k * k;
export const easeInOut = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
/** Ease out with one overshoot of `amount` (0.06 = 6%) and settle. */
export function easeBack(k: number, amount = 0.06): number {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const s = amount * 16;
  const x = k - 1;
  return 1 + x * x * ((s + 1) * x + s);
}
/** A fall from rest: accelerates and lands at k = 1 with a small settle. */
export function drop(k: number): number {
  if (k >= 1) return 1;
  return k * k;
}
/** One bump 0 → 1 → 0. */
export const bump = (k: number): number => (k <= 0 || k >= 1 ? 0 : Math.sin(Math.PI * k));

// ---------------------------------------------------------------- seeded noise

/** 32-bit hash of numbers: the same inputs give the same value on every machine. */
export function hash(...values: number[]): number {
  let h = 0x811c9dc5;
  for (const v of values) {
    h ^= Math.floor(v) | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return h >>> 0;
}
/** Uniform value in [0, 1) from a hash of the inputs. */
export function rand(...values: number[]): number {
  return hash(...values) / 4294967296;
}
/** Deterministic generator. */
export function seeded(seed: number): () => number {
  let a = hash(seed) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
/** Smooth noise in [-1, 1] over time, by seed: the sway of standing instruments. */
export function wobble(seed: number, t: number, periodMs: number): number {
  const p = t / periodMs + rand(seed) * 10;
  return Math.sin(p * 2 * Math.PI) * 0.6 + Math.sin(p * 2 * Math.PI * 2.31 + seed) * 0.4;
}
