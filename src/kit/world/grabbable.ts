/**
 * The three nodes of an object the hand takes (PLAN "Захват и выбор на одном предмете"):
 * `handle` belongs to the grab system (src/interact/ wraps it in an entity), `body` is
 * what the kit animates (update writes only there), `proxy` is an invisible volume of the
 * same size that stands next to `handle` (a sibling, never a child, because IWSDK denies
 * rays on a grab node and all of its children) and takes rays, gaze, dwell and the mouse.
 */
import { BoxGeometry, Object3D, type Mesh } from '@iwsdk/core';
import { proxyMesh } from './materials';

export type Grabbable = { handle: Object3D; body: Object3D; proxy: Object3D };

/**
 * Wraps `body` into a handle and makes a proxy box `size` (w, h, d) whose centre sits
 * `center` above the handle's origin.
 */
export function makeGrabbable(name: string, body: Object3D, size: [number, number, number], center: [number, number, number] = [0, size[1] / 2, 0]): Grabbable {
  const handle = new Object3D();
  handle.name = `${name}:handle`;
  handle.add(body);
  body.name = body.name || `${name}:body`;
  const geometry = new BoxGeometry(size[0], size[1], size[2]);
  geometry.translate(center[0], center[1], center[2]);
  const proxy: Mesh = proxyMesh(geometry, `${name}:proxy`);
  proxy.userData.handle = handle;
  handle.userData.proxy = proxy;
  return { handle, body, proxy };
}

/** Puts handle and proxy side by side into `parent` and keeps the proxy on the handle until the interaction layer does. */
export function placeGrabbable(g: Grabbable, parent: Object3D): void {
  parent.add(g.handle);
  parent.add(g.proxy);
  followHandle(g);
}

/** Copies the handle's local pose to the proxy (both have the same parent). */
export function followHandle(g: Grabbable): void {
  if (g.proxy.parent !== g.handle.parent) return;
  g.proxy.position.copy(g.handle.position);
  g.proxy.quaternion.copy(g.handle.quaternion);
  g.proxy.scale.copy(g.handle.scale);
}

/** Takes handle and proxy out of their parent. */
export function removeGrabbable(g: Grabbable): void {
  g.handle.removeFromParent();
  g.proxy.removeFromParent();
}
