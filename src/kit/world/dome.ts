/**
 * The matte bone dome, 0.42 m high, over the object of a plot that is private to a
 * visitor: only the silhouette of what is under it shows through.
 */
import { DoubleSide, Mesh, MeshStandardMaterial, Object3D } from '@iwsdk/core';
import { COLOR } from '../../tokens/tokens';
import { lathe } from './geom';

export const DOME = { r: 0.27, h: 0.42 };

let material: MeshStandardMaterial | null = null;

export function createDome(): Object3D {
  const root = new Object3D();
  root.name = 'kit:dome';
  const profile: [number, number][] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    profile.push([Math.cos(a) * DOME.r, Math.sin(a) * DOME.h]);
  }
  profile.push([0, DOME.h]);
  material ??= new MeshStandardMaterial({ color: COLOR.bone, roughness: 0.95, metalness: 0, transparent: true, opacity: 0.84, depthWrite: false, side: DoubleSide, vertexColors: true });
  const mesh = new Mesh(lathe(profile, 48), material);
  mesh.name = 'dome';
  mesh.renderOrder = 3;
  mesh.userData.noBatch = true;
  root.add(mesh);
  return root;
}
