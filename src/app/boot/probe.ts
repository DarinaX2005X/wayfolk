/**
 * Measuring hooks for scenarios: `window.__gw.probe` (on where debug hooks are, src/app/debug.ts).
 * scripts/xr.mjs asks where a named object is (step "expect", ray and mouse modes)
 * and where a point lands on the canvas (step "mouse"; scripts/web.mjs too). Loaded by
 * world.ts only where debug hooks are on.
 */
import { Box3, Vector3, type Object3D } from '@iwsdk/core';
import { registerDebug } from '../debug';
import type { App } from './world';

type Triple = [number, number, number];

export type Probe = {
  /**
   * A scene object by its `name`: its own origin, and the centre and size of its
   * bounding box. Metres in the XR origin frame, the frame `xr list-targets` reports.
   * Null when no object has that name.
   */
  locate(name: string): { origin: Triple; center: Triple; size: Triple; visible: boolean } | null;
  /**
   * Where a world point (or the box centre of a named object) lands on the canvas, in
   * CSS pixels from its top left corner. `inside` is false when the point is behind
   * the camera or outside the canvas. Meaningful in desk mode only.
   */
  screen(point: Triple | string): { x: number; y: number; inside: boolean } | null;
  /** Names of every named object in the scene, for writing scenarios. */
  names(): string[];
};

export function installProbe(app: Pick<App, 'world'>): Probe {
  const { world } = app;
  const box = new Box3();
  const point = new Vector3();
  const size = new Vector3();

  const find = (name: string): Object3D | null => {
    // Named targets of src/interact/ (findTarget) first, then any object by its name.
    const registry = (window as unknown as { __gw?: { findTarget?: (n: string) => Object3D | null } }).__gw?.findTarget;
    const registered = typeof registry === 'function' ? registry(name) : null;
    if (registered) return registered;
    let found: Object3D | null = null;
    world.scene.traverse((object) => {
      if (!found && object.name === name) found = object;
    });
    return found;
  };

  /** World to the XR origin frame (the player rig; identity while nobody moves it). */
  const toOrigin = (v: Vector3): Vector3 => {
    world.player.updateWorldMatrix(true, false);
    return world.player.worldToLocal(v);
  };

  const shown = (object: Object3D): boolean => {
    for (let o: Object3D | null = object; o; o = o.parent) {
      if (!o.visible) return false;
    }
    return true;
  };

  const worldCenter = (object: Object3D, out: Vector3): Vector3 => {
    object.updateWorldMatrix(true, true);
    box.setFromObject(object);
    return box.isEmpty() ? object.getWorldPosition(out) : box.getCenter(out);
  };

  const probe: Probe = {
    locate(name) {
      const object = find(name);
      if (!object) return null;
      const center = toOrigin(worldCenter(object, point)).toArray() as Triple;
      const extent = (box.isEmpty() ? size.set(0, 0, 0) : box.getSize(size)).toArray() as Triple;
      const origin = toOrigin(object.getWorldPosition(point)).toArray() as Triple;
      return { origin, center, size: extent, visible: shown(object) };
    },
    screen(target) {
      if (typeof target === 'string') {
        const object = find(target);
        if (!object) return null;
        worldCenter(object, point);
      } else {
        point.fromArray(target);
      }
      const canvas = world.renderer.domElement;
      world.camera.updateWorldMatrix(true, false);
      point.project(world.camera);
      const x = ((point.x + 1) / 2) * canvas.clientWidth;
      const y = ((1 - point.y) / 2) * canvas.clientHeight;
      const inside = point.z > -1 && point.z < 1 && Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1;
      return { x, y, inside };
    },
    names() {
      const names = new Set<string>();
      world.scene.traverse((object) => {
        if (object.name) names.add(object.name);
      });
      return [...names].sort();
    },
  };

  registerDebug('probe', probe);
  return probe;
}
