/**
 * Winding dirt paths with little stones along the edges. A path bends gently away from the
 * straight line, steps round houses, and returns its walking line for the residents.
 */
import { BufferAttribute, BufferGeometry, Color } from '@iwsdk/core';
import type { P2 } from '../mind/types';
import { M, blob, join, paint, rng, surfaceAlpha } from './geo';
import { Land, segDist } from './land';

const DIRT = new Color('#c49a6c');
const DIRT_EDGE = new Color('#a98257');

export interface PathShape {
  points: P2[];
  geo: BufferGeometry;
}

/** A smooth winding line from a to b that keeps clear of round obstacles. */
export function routePath(a: P2, b: P2, avoid: { x: number; z: number; r: number }[], seed: number): P2[] {
  const r = rng(seed);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len;
  const nz = dx / len;
  const bend = (r() - 0.5) * Math.min(2.2, len * 0.18);
  const n = Math.max(6, Math.round(len / 0.45));
  let pts: P2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const w = Math.sin(t * Math.PI) * bend + Math.sin(t * Math.PI * 3 + seed) * 0.22 * Math.sin(t * Math.PI);
    pts.push({ x: a.x + dx * t + nx * w, z: a.z + dz * t + nz * w });
  }
  // push points out of obstacles, a few relaxation passes keep it smooth
  for (let pass = 0; pass < 6; pass++) {
    pts = pts.map((p, i) => {
      if (i === 0 || i === pts.length - 1) return p;
      let x = p.x;
      let z = p.z;
      for (const o of avoid) {
        const d = Math.hypot(x - o.x, z - o.z);
        if (d < o.r && d > 1e-3) {
          x = o.x + ((x - o.x) / d) * o.r;
          z = o.z + ((z - o.z) / d) * o.r;
        }
      }
      return { x, z };
    });
    pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: (pts[i - 1].x + p.x * 2 + pts[i + 1].x) / 4, z: (pts[i - 1].z + p.z * 2 + pts[i + 1].z) / 4 }));
  }
  return pts;
}

/** The ground ribbon and edge stones for a walking line. */
export function pathGeometry(land: Land, pts: P2[], seed: number, width = 0.95): BufferGeometry {
  const r = rng(seed + 17);
  const pos: number[] = [];
  const col: number[] = [];
  const lift = 0.09;
  const left: [number, number, number][] = [];
  const mid: [number, number, number][] = [];
  const right: [number, number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    const end = i === 0 || i === pts.length - 1 ? 0.7 : 1;
    const wl = (width / 2) * (0.85 + r() * 0.3) * end;
    const wr = (width / 2) * (0.85 + r() * 0.3) * end;
    const y = (x: number, z: number): number => land.height(x, z) + lift;
    left.push([p.x + nx * wl, y(p.x + nx * wl, p.z + nz * wl), p.z + nz * wl]);
    mid.push([p.x, y(p.x, p.z) + 0.01, p.z]);
    right.push([p.x - nx * wr, y(p.x - nx * wr, p.z - nz * wr), p.z - nz * wr]);
  }
  const push = (v: [number, number, number], c: Color, k: number): void => {
    pos.push(...v);
    col.push(c.r * k, c.g * k, c.b * k, surfaceAlpha(M.dirt));
  };
  for (let i = 1; i < pts.length; i++) {
    const k = 0.95 + r() * 0.1;
    for (const [A, B] of [[left, mid], [mid, right]] as const) {
      const ea = A === left ? DIRT_EDGE : DIRT;
      const eb = B === right ? DIRT_EDGE : DIRT;
      push(A[i - 1], ea, k); push(B[i - 1], eb, k); push(A[i], ea, k);
      push(B[i - 1], eb, k); push(B[i], eb, k); push(A[i], ea, k);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  g.computeVertexNormals();
  // stones along the edges
  const stones: BufferGeometry[] = [];
  for (let i = 1; i < pts.length - 1; i += 2) {
    if (r() < 0.45) continue;
    const side = r() < 0.5 ? left : right;
    const [x, , z] = side[i];
    const s = 0.07 + r() * 0.08;
    stones.push(paint(blob(s, 0, Math.floor(r() * 1000), 0.25, 0.55).translate(x, land.height(x, z) + s * 0.25, z), r() < 0.5 ? '#b8ad9c' : '#a2978a', { shade: 0.2, mat: M.rock }, true));
  }
  return stones.length ? join([g, ...stones]) : g;
}

export function pathLength(pts: P2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  return l;
}

export function nearPath(x: number, z: number, pts: P2[], r: number): boolean {
  for (let i = 1; i < pts.length; i++) if (segDist(x, z, pts[i - 1], pts[i]) < r) return true;
  return false;
}
