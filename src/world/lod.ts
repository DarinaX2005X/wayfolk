/**
 * Simpler versions of pieces for when they are far from the viewer, by vertex clustering:
 * every vertex snaps to the mean of its grid cell and triangles that collapse are dropped.
 * Colour and normal stay those of each vertex, so surfaces keep their paint and only small
 * shapes (trims, knobs, leaves on the far side) melt away. Works on the world's non-indexed
 * layout (position, normal, vec4 colour).
 */
import { BufferAttribute, BufferGeometry } from '@iwsdk/core';

export function simplify(src: BufferGeometry, cell: number): BufferGeometry {
  const pos = src.getAttribute('position');
  const nor = src.getAttribute('normal');
  const col = src.getAttribute('color');
  const n = pos.count;
  const inv = 1 / cell;
  const cellOf = new Int32Array(n);
  const ids = new Map<string, number>();
  const sum: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const key = `${Math.floor(x * inv)},${Math.floor(y * inv)},${Math.floor(z * inv)}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
      sum.push(0, 0, 0, 0);
    }
    cellOf[i] = id;
    sum[id * 4] += x;
    sum[id * 4 + 1] += y;
    sum[id * 4 + 2] += z;
    sum[id * 4 + 3] += 1;
  }
  const keep: number[] = [];
  const seen = new Set<string>();
  for (let t = 0; t + 2 < n; t += 3) {
    const a = cellOf[t];
    const b = cellOf[t + 1];
    const c = cellOf[t + 2];
    if (a === b || b === c || a === c) continue;
    // the same triangle twice (same winding) after snapping
    const k = a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`;
    if (seen.has(k)) continue;
    seen.add(k);
    keep.push(t);
  }
  const m = keep.length * 3;
  const p = new Float32Array(m * 3);
  const q = new Float32Array(m * 3);
  const cs = col ? col.itemSize : 4;
  const c = new Float32Array(m * cs);
  let o = 0;
  for (const t of keep)
    for (let v = t; v < t + 3; v++) {
      const id = cellOf[v];
      const w = 1 / sum[id * 4 + 3];
      p[o * 3] = sum[id * 4] * w;
      p[o * 3 + 1] = sum[id * 4 + 1] * w;
      p[o * 3 + 2] = sum[id * 4 + 2] * w;
      if (nor) {
        q[o * 3] = nor.getX(v);
        q[o * 3 + 1] = nor.getY(v);
        q[o * 3 + 2] = nor.getZ(v);
      }
      if (col) {
        c[o * cs] = col.getX(v);
        c[o * cs + 1] = col.getY(v);
        c[o * cs + 2] = col.getZ(v);
        if (cs > 3) c[o * cs + 3] = col.getW(v);
      } else c.fill(1, o * cs, o * cs + cs);
      o++;
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(p, 3));
  g.setAttribute('normal', new BufferAttribute(q, 3));
  g.setAttribute('color', new BufferAttribute(c, cs));
  g.computeBoundingSphere();
  return g;
}
