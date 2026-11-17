/**
 * Blob shadows (soft dark discs on the ground under trees, houses, props) and warm light
 * pools under lamps at night. Two instanced meshes; no shadow maps anywhere.
 */
import {
  AdditiveBlending,
  Color,
  DataTexture,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RGBAFormat,
  Vector3,
} from '@iwsdk/core';
import type { Land } from './land';

function radial(size = 64): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 2);
      const a = Math.pow(1 - d, 1.6) * (d < 1 ? 1 : 0);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface Blobs {
  root: Object3D;
  /** Sets every shadow: [x, z, radius, strength]. */
  setShadows(list: [number, number, number, number][]): void;
  setLights(list: [number, number, number][]): void;
  setNight(k: number, color: Color): void;
}

export function createBlobs(parent: Object3D, land: Land): Blobs {
  const root = new Object3D();
  root.name = 'world:blobs';
  parent.add(root);
  const tex = radial();
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const shadowMat = new MeshBasicMaterial({
    color: '#2b2a1e',
    alphaMap: tex,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  shadowMat.name = 'world:blob-shadow';
  const lightMat = new MeshBasicMaterial({
    color: '#ffb35c',
    alphaMap: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -6,
  });
  lightMat.name = 'world:light-pool';
  let shadows: InstancedMesh | null = null;
  let lights: InstancedMesh | null = null;
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();

  const fill = (list: [number, number, number, number][], mat: MeshBasicMaterial, prev: InstancedMesh | null, name: string, lift: number): InstancedMesh => {
    if (prev) {
      root.remove(prev);
      prev.dispose();
    }
    const mesh = new InstancedMesh(geo, mat, Math.max(1, list.length));
    mesh.name = name;
    mesh.count = list.length;
    list.forEach(([x, z, r, k], i) => {
      p.set(x, land.height(x, z) + lift, z);
      s.set(r * 2, 1, r * 2);
      mesh.setMatrixAt(i, m.compose(p, q, s));
      mesh.setColorAt(i, new Color(k, k, k));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.renderOrder = 2;
    mesh.raycast = () => {};
    mesh.computeBoundingSphere();
    root.add(mesh);
    return mesh;
  };

  return {
    root,
    setShadows(list) {
      // colour carries strength: darker colour on a dark base means a fainter shadow, so invert
      shadows = fill(list.map(([x, z, r, k]) => [x, z, r, k] as [number, number, number, number]), shadowMat, shadows, 'world:shadows', 0.03);
      if (shadows.instanceColor) {
        for (let i = 0; i < list.length; i++) shadows.setColorAt(i, new Color(1, 1, 1));
        shadows.instanceColor.needsUpdate = true;
      }
    },
    setLights(list) {
      lights = fill(list.map(([x, z, r]) => [x, z, r, 1] as [number, number, number, number]), lightMat, lights, 'world:light-pools', 0.05);
    },
    setNight(k, color) {
      lightMat.opacity = 0.55 * k;
      lightMat.color.copy(color);
      if (lights) lights.visible = k > 0.02;
    },
  };
}
