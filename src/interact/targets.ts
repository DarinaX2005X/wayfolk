/**
 * Named targets (PLAN "Набор ремесла", "Именованные цели"): hand scenarios, the first
 * session and the path without pinches find objects by a stable name such as
 * `envelope:harbor-street` or `slip:e23-a41b0c`, never by coordinates. A target is the
 * object that answers selection: for a takeable object that is its proxy.
 *
 * The probe of the app (src/app/boot/probe.ts) asks `window.__gw.findTarget` first, so
 * `npm run xr` steps, `expect` checks and mouse steps reach the same object.
 */
import type { Object3D } from '@iwsdk/core';
import { registerDebug } from '../app/debug';

const byName = new Map<string, Object3D>();
const names = new WeakMap<Object3D, string>();

/** Registers `obj` under `name`. A later registration of the same name replaces the earlier one. */
export function target(name: string, obj: Object3D): void {
  const before = byName.get(name);
  if (before && before !== obj) names.delete(before);
  byName.set(name, obj);
  names.set(obj, name);
  // The scenario tools also find it by the object's name (xr list-targets, probe.names).
  if (!obj.name) obj.name = name;
}

/** Removes a name (when its object leaves the scene for good). */
export function untarget(name: string): void {
  const obj = byName.get(name);
  if (obj) names.delete(obj);
  byName.delete(name);
}

export function findTarget(name: string): Object3D | null {
  return byName.get(name) ?? null;
}

/** The registered name of an object or of its nearest named ancestor. */
export function nameOf(obj: Object3D | null): string {
  for (let o = obj; o; o = o.parent) {
    const n = names.get(o);
    if (n) return n;
  }
  return obj?.name || 'unnamed';
}

/** Every registered name, sorted: for writing scenarios. */
export function targetNames(): string[] {
  return [...byName.keys()].sort();
}

registerDebug('findTarget', findTarget);
registerDebug('targets', targetNames);
