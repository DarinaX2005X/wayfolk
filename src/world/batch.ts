/**
 * A static batch: many painted geometries (same layout) drawn as one mesh. Entries are keyed
 * so a house or a prop can be added and removed; the merged buffer is rebuilt lazily on the
 * next flush, which costs a few milliseconds for tens of thousands of triangles.
 */
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, type Material } from '@iwsdk/core';

export class Batch {
  readonly mesh: Mesh;
  private entries = new Map<string, BufferGeometry[]>();
  private dirty = false;

  constructor(name: string, material: Material) {
    this.mesh = new Mesh(new BufferGeometry(), material);
    this.mesh.name = name;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.visible = false;
  }

  /** Adds geometry (copied and moved by `matrix` if given) under a key. */
  add(key: string, geo: BufferGeometry, matrix?: Matrix4): void {
    const g = matrix ? geo.clone().applyMatrix4(matrix) : geo;
    const list = this.entries.get(key);
    if (list) list.push(g);
    else this.entries.set(key, [g]);
    this.dirty = true;
  }

  remove(key: string): boolean {
    const had = this.entries.delete(key);
    if (had) this.dirty = true;
    return had;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  triangles(): number {
    let n = 0;
    for (const list of this.entries.values()) for (const g of list) n += g.getAttribute('position').count / 3;
    return n;
  }

  /** Rebuilds the merged buffer if anything changed. */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let count = 0;
    for (const list of this.entries.values()) for (const g of list) count += g.getAttribute('position').count;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 4);
    let o = 0;
    for (const list of this.entries.values())
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
