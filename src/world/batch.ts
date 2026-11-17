/**
 * A static batch: many painted geometries (same layout) drawn as one mesh. Entries are keyed
 * so a house or a prop can be added and removed; the merged buffer is rebuilt lazily on the
 * next flush, which costs a few milliseconds for tens of thousands of triangles.
 *
 * An entry can carry a simpler far version (see lod.ts): `lod(key, cell, near)` makes one, and
 * `updateLod(eye)` swaps each entry to it when the viewer is further than `near` metres away.
 */
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type Material } from '@iwsdk/core';
import { join } from './geo';
import { simplify } from './lod';

interface Far {
  geo: BufferGeometry;
  x: number;
  z: number;
  near: number;
}

export class Batch {
  readonly mesh: Mesh;
  private entries = new Map<string, BufferGeometry[]>();
  private far = new Map<string, Far>();
  private coarse = new Set<string>();
  private dirty = false;

  constructor(name: string, material: Material) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.name = name;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
    this.mesh.userData.batch = this;
  }

  /** Adds geometry (copied and moved by `matrix` if given) under a key. */
  add(key: string, geo: BufferGeometry, matrix?: Matrix4): void {
    const g = matrix ? geo.clone().applyMatrix4(matrix) : geo;
    const list = this.entries.get(key);
    if (list) list.push(g);
    else this.entries.set(key, [g]);
    this.far.delete(key);
    this.coarse.delete(key);
    this.dirty = true;
  }

  remove(key: string): boolean {
    const had = this.entries.delete(key);
    this.far.delete(key);
    this.coarse.delete(key);
    if (had) this.dirty = true;
    return had;
  }

  /**
   * Makes a simpler version of the entry (vertex clusters of `cell` metres) shown while the
   * viewer is more than `near` metres from it. Skipped when it would save little.
   */
  lod(key: string, cell: number, near: number): void {
    const list = this.entries.get(key);
    if (!list?.length) return;
    const whole = list.length === 1 ? list[0] : join(list);
    const geo = simplify(whole, cell);
    const before = whole.getAttribute('position').count;
    if (geo.getAttribute('position').count > before * 0.85) return;
    if (!whole.boundingSphere) whole.computeBoundingSphere();
    const c = whole.boundingSphere!.center;
    this.far.set(key, { geo, x: c.x, z: c.z, near });
  }

  /** Swaps entries between their full and far versions for a viewer at (x, z). */
  updateLod(x: number, z: number): void {
    for (const [key, f] of this.far) {
      const d = Math.hypot(f.x - x, f.z - z);
      const far = this.coarse.has(key) ? d > f.near - 1 : d > f.near + 1;
      if (far !== this.coarse.has(key)) {
        if (far) this.coarse.add(key);
        else this.coarse.delete(key);
        this.dirty = true;
      }
    }
  }

  private shown(key: string, list: BufferGeometry[]): BufferGeometry[] {
    const f = this.coarse.has(key) ? this.far.get(key) : undefined;
    return f ? [f.geo] : list;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Triangles drawn now (far versions where they are shown). */
  triangles(): number {
    let n = 0;
    for (const [key, list] of this.entries) for (const g of this.shown(key, list)) n += g.getAttribute('position').count / 3;
    return n;
  }

  /** Rebuilds the merged buffer if anything changed. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const all: BufferGeometry[][] = [];
    for (const [key, list] of this.entries) all.push(this.shown(key, list));
    let count = 0;
    for (const list of all) for (const g of list) count += g.getAttribute('position').count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 4);
    let o = 0;
    for (const list of all)
      for (const g of list) {
        const p = g.getAttribute('position');
        const n = g.getAttribute('normal');
        const c = g.getAttribute('color');
        const k = p.count;
        if (p.array instanceof Float32Array && p.itemSize === 3 && !(p as BufferAttribute).normalized) pos.set(p.array.subarray(0, k * 3), o * 3);
        else for (let i = 0; i < k; i++) pos.set([p.getX(i), p.getY(i), p.getZ(i)], (o + i) * 3);
        if (n && n.array instanceof Float32Array && n.itemSize === 3) nor.set(n.array.subarray(0, k * 3), o * 3);
        else if (n) for (let i = 0; i < k; i++) nor.set([n.getX(i), n.getY(i), n.getZ(i)], (o + i) * 3);
        if (c && c.array instanceof Float32Array && c.itemSize === 4) col.set(c.array.subarray(0, k * 4), o * 4);
        else
          for (let i = 0; i < k; i++)
            col.set([c ? c.getX(i) : 1, c ? c.getY(i) : 1, c ? c.getZ(i) : 1, c && c.itemSize > 3 ? c.getW(i) : 1], (o + i) * 4);
        o += k;
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setAttribute('color', new BufferAttribute(col, 4));
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    this.mesh.visible = count > 0;
  }
}
