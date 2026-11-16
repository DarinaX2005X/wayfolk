/**
 * Zones of the draw budget (DESIGN "Бюджет отрисовки по зонам"). A kit or view tags the
 * root of what it draws with `zone(root, 'arc')`; the frame measure (./info.ts) walks the
 * scene, counts one draw call per visible pair of object and material that passed
 * frustum culling, and files it under the nearest tagged ancestor. Untagged draws go
 * under 'none', which the budget has no room for: tag every root.
 */
import { Frustum, Matrix4, Sphere, type Camera, type Material, type Object3D } from '@iwsdk/core';
import type { Zone } from '../../tokens/tokens';

export type ZoneName = Zone | 'none';

/** Files everything under `obj` into a zone of the budget. Returns `obj`. */
export function zone<T extends Object3D>(obj: T, name: Zone): T {
  obj.userData.zone = name;
  return obj;
}

type Drawable = Object3D & {
  geometry?: { boundingSphere: Sphere | null; computeBoundingSphere(): void; groups?: { materialIndex?: number }[]; index?: { count: number } | null; attributes?: Record<string, { count: number }>; drawRange?: { start: number; count: number } };
  material?: Material | Material[];
  isMesh?: boolean;
  isLine?: boolean;
  isPoints?: boolean;
  isSprite?: boolean;
  isInstancedMesh?: boolean;
  count?: number;
};

const frustum = new Frustum();
const matrix = new Matrix4();
const sphere = new Sphere();

function shown(object: Object3D): boolean {
  for (let o: Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function zoneOf(object: Object3D): ZoneName {
  for (let o: Object3D | null = object; o; o = o.parent) {
    const z = o.userData?.zone as Zone | undefined;
    if (z) return z;
  }
  return 'none';
}

/** Draw calls one object makes: one per material it really uses (groups of a multi-material geometry). */
function callsOf(object: Drawable): number {
  const material = object.material;
  if (!material) return 0;
  if (Array.isArray(material)) {
    const groups = object.geometry?.groups ?? [];
    if (groups.length === 0) return material.length ? 1 : 0;
    let n = 0;
    for (const g of groups) if (material[g.materialIndex ?? 0]?.visible !== false) n += 1;
    return n;
  }
  return material.visible === false ? 0 : 1;
}

function inside(object: Drawable, cameras: readonly Camera[]): boolean {
  if (object.frustumCulled === false || object.isInstancedMesh) return true;
  const geometry = object.geometry;
  if (!geometry) return true;
  if (geometry.boundingSphere === null) geometry.computeBoundingSphere();
  if (!geometry.boundingSphere) return true;
  sphere.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld);
  for (const camera of cameras) {
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(matrix);
    if (frustum.intersectsSphere(sphere)) return true;
  }
  return false;
}

/**
 * Unique draw calls per eye by zone: an object seen by either eye counts once.
 * `cameras` are the eye cameras in a session or the one page camera.
 */
export function countZones(scene: Object3D, cameras: readonly Camera[]): { zones: Partial<Record<ZoneName, number>>; total: number } {
  const zones: Partial<Record<ZoneName, number>> = {};
  let total = 0;
  scene.updateMatrixWorld();
  scene.traverseVisible((node) => {
    const object = node as Drawable;
    if (!(object.isMesh || object.isLine || object.isPoints || object.isSprite)) return;
    if (object.isInstancedMesh && object.count === 0) return;
    if (!shown(object) || !inside(object, cameras)) return;
    const calls = callsOf(object);
    if (calls === 0) return;
    const name = zoneOf(object);
    zones[name] = (zones[name] ?? 0) + calls;
    total += calls;
  });
  return { zones, total };
}
