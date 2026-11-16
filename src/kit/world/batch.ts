/**
 * Batches: the draw budget of the kit. A batch takes every kit part under a root (a
 * mesh with `userData.kitMat`) and draws all parts of one material class with one
 * BatchedMesh, the instance colour taken from the part's kit colour; labels under the
 * root (./label.ts) go into one instanced mesh with the shared atlas. The parts stay
 * where they are as nodes: objects keep animating their own meshes, and every frame
 * `sync()` copies their matrices, colours and visibility into the batch. A part that
 * leaves the root (taken by the hand into another root) gets its own material back.
 *
 * This is how the home and bench zone keeps to 10 draws (DESIGN "Бюджет отрисовки по
 * зонам": dome, home tiles, slab, bench objects by material, envelope labels) and the
 * ring of eight closed plots to well under 18.
 *
 * A part stays out of a batch with `userData.noBatch` (transparent or rebuilt every frame).
 */
import {
  BatchedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  type BufferGeometry,
  type InstancedMesh,
  type Mesh,
} from '@iwsdk/core';
import { CLASS_ROUGHNESS, HIDDEN, mat, matClass, matColor, type KitMat, type MatClass } from './materials';
import { createLabelInstances, type LabelInstances } from './label';
import { animate } from './time';

type Entry = { mesh: Mesh; cls: MatClass; id: number; geometry: BufferGeometry; key: KitMat; seen: number; m: Float32Array; visible: boolean };
type Pool = { mesh: BatchedMesh; geometries: Map<BufferGeometry, { id: number; uses: number }> };

export type Batch = {
  readonly root: Object3D;
  /** Copies matrices, colours and visibility of the parts into the batch. */
  sync(): void;
  /** Fades the whole batch (the dimmed arc and ring of a work view). */
  setOpacity(k: number): void;
  /** Draw calls this batch makes now. */
  calls(): number;
  /** Gives every part its own material back and removes the batch. */
  dispose(): void;
};

const rel = new Matrix4();
const inv = new Matrix4();

function shownTo(node: Object3D, root: Object3D): boolean {
  for (let o: Object3D | null = node; o && o !== root; o = o.parent) if (!o.visible) return false;
  return true;
}

/**
 * Creates a batch over `root`. The batch keeps itself in step every frame while `root`
 * is in a scene (the kit system); `sync()` can also be called by hand.
 */
export function createBatch(root: Object3D): Batch {
  root.userData.batchRoot = true;
  const pools = new Map<MatClass, Pool>();
  const entries = new Map<Mesh, Entry>();
  let labels: LabelInstances | null = null;
  let frame = 0;
  let opacity = 1;

  const pool = (cls: MatClass): Pool => {
    let p = pools.get(cls);
    if (!p) {
      const material = new MeshStandardMaterial({ color: 0xffffff, roughness: CLASS_ROUGHNESS[cls], metalness: 0, vertexColors: true });
      material.name = `batch:${cls}`;
      const mesh = new BatchedMesh(64, 8192, 16384, material);
      mesh.name = `batch:${cls}`;
      mesh.userData.batchOwn = true;
      mesh.frustumCulled = false;
      mesh.perObjectFrustumCulled = true;
      mesh.sortObjects = false;
      mesh.raycast = () => {};
      root.add(mesh);
      p = { mesh, geometries: new Map() };
      pools.set(cls, p);
      applyOpacity();
    }
    return p;
  };

  const geometryId = (p: Pool, g: BufferGeometry): number => {
    const known = p.geometries.get(g);
    if (known) {
      known.uses += 1;
      return known.id;
    }
    const vertices = g.attributes.position.count;
    const indices = g.index ? g.index.count : vertices;
    let id: number;
    try {
      id = p.mesh.addGeometry(g);
    } catch {
      p.mesh.optimize();
      const used = usedSize(p);
      const cap = p.mesh as unknown as { _maxVertexCount: number; _maxIndexCount: number };
      p.mesh.setGeometrySize(Math.max(cap._maxVertexCount * 2, used.v + vertices * 2), Math.max(cap._maxIndexCount * 2, used.i + indices * 2));
      id = p.mesh.addGeometry(g);
    }
    p.geometries.set(g, { id, uses: 1 });
    return id;
  };

  const usedSize = (p: Pool): { v: number; i: number } => {
    let v = 0;
    let i = 0;
    for (const g of p.geometries.keys()) {
      v += g.attributes.position.count;
      i += g.index ? g.index.count : g.attributes.position.count;
    }
    return { v, i };
  };

  const releaseGeometry = (p: Pool, g: BufferGeometry): void => {
    const known = p.geometries.get(g);
    if (!known) return;
    known.uses -= 1;
    if (known.uses <= 0) {
      p.mesh.deleteGeometry(known.id);
      p.geometries.delete(g);
    }
  };

  const addInstance = (p: Pool, geometry: number): number => {
    try {
      return p.mesh.addInstance(geometry);
    } catch {
      p.mesh.setInstanceCount(p.mesh.maxInstanceCount * 2);
      return p.mesh.addInstance(geometry);
    }
  };

  const absorb = (mesh: Mesh): Entry | null => {
    const key = mesh.userData.kitMat as KitMat;
    const cls = matClass(key);
    const p = pool(cls);
    const geometry = mesh.geometry;
    if (!geometry.attributes.color || !geometry.attributes.normal) return null;
    let gid: number;
    try {
      gid = geometryId(p, geometry);
    } catch (error) {
      console.warn('[kit] a part could not join its batch', mesh.name, error);
      mesh.userData.noBatch = true;
      return null;
    }
    const id = addInstance(p, gid);
    p.mesh.setColorAt(id, matColor(key));
    mesh.material = HIDDEN;
    mesh.userData.batched = true;
    const entry: Entry = { mesh, cls, id, geometry, key, seen: frame, m: new Float32Array(16).fill(NaN), visible: true };
    entries.set(mesh, entry);
    return entry;
  };

  const release = (entry: Entry, restore: boolean): void => {
    const p = pools.get(entry.cls);
    if (p) {
      p.mesh.deleteInstance(entry.id);
      releaseGeometry(p, entry.geometry);
    }
    entries.delete(entry.mesh);
    delete entry.mesh.userData.batched;
    if (restore) entry.mesh.material = mat(entry.mesh.userData.kitMat as KitMat);
  };

  const visit = (node: Object3D): void => {
    if (node !== root && node.userData.batchRoot) return;
    if (node.userData.batchOwn) return;
    const mesh = node as Mesh;
    if (mesh.isMesh && !(mesh as unknown as InstancedMesh).isInstancedMesh) {
      if (mesh.userData.label && labels !== null) labels.track(mesh, frame);
      else if (mesh.userData.label) {
        labels = createLabelInstances(root);
        labels.track(mesh, frame);
      } else if (mesh.userData.kitMat && !mesh.userData.noBatch) {
        let entry = entries.get(mesh) ?? null;
        if (entry && (entry.geometry !== mesh.geometry || matClass(mesh.userData.kitMat as KitMat) !== entry.cls)) {
          release(entry, false);
          entry = null;
        }
        if (!entry) entry = absorb(mesh);
        if (entry) {
          entry.seen = frame;
          const p = pools.get(entry.cls)!;
          const key = mesh.userData.kitMat as KitMat;
          if (key !== entry.key) {
            entry.key = key;
            p.mesh.setColorAt(entry.id, matColor(key));
          }
          const visible = shownTo(mesh, root);
          if (visible !== entry.visible) {
            entry.visible = visible;
            p.mesh.setVisibleAt(entry.id, visible);
          }
          if (visible) {
            rel.multiplyMatrices(inv, mesh.matrixWorld);
            const e = rel.elements;
            const m = entry.m;
            let same = true;
            for (let k = 0; k < 16; k++) {
              if (m[k] !== e[k]) {
                same = false;
                m[k] = e[k];
              }
            }
            if (!same) p.mesh.setMatrixAt(entry.id, rel);
          }
        }
      }
    }
    const children = node.children;
    for (let k = 0; k < children.length; k++) visit(children[k]);
  };

  function applyOpacity(): void {
    for (const p of pools.values()) {
      const m = p.mesh.material as MeshStandardMaterial;
      m.opacity = opacity;
      const transparent = opacity < 0.999;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      p.mesh.visible = opacity > 0.001;
    }
    labels?.setOpacity(opacity);
  }

  const batch: Batch & { update(t: number): void } = {
    root,
    sync() {
      frame += 1;
      root.updateMatrixWorld(true);
      inv.copy(root.matrixWorld).invert();
      visit(root);
      for (const entry of [...entries.values()]) {
        if (entry.seen !== frame) {
          release(entry, true);
        }
      }
      labels?.finish(frame, inv);
    },
    update() {
      batch.sync();
    },
    setOpacity(k) {
      opacity = k;
      applyOpacity();
    },
    calls() {
      let n = 0;
      for (const p of pools.values()) if (p.mesh.visible && p.geometries.size > 0) n += 1;
      return n + (labels?.calls() ?? 0);
    },
    dispose() {
      for (const entry of [...entries.values()]) release(entry, true);
      for (const p of pools.values()) {
        p.mesh.removeFromParent();
        p.mesh.dispose();
      }
      pools.clear();
      labels?.dispose();
      stop();
      delete root.userData.batchRoot;
    },
  };
  const stop = animate(batch, true);
  return batch;
}
