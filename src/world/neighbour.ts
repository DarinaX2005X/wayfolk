/**
 * A friend's island, docked beside this one, and the pieces of the rope bridge between
 * them (src/together/ builds the bridge plank by plank with the flocks).
 *
 * The friend's island is a smaller cousin of the main one: a lumpy grass top with a gentle
 * hill, a dirt path from the bridge head to their houses, warm sandstone cliffs dropping
 * into the clouds, their own houses from the same recipes (simplified, it is seen from a
 * few metres away at least), trees, bushes, mossy rocks, flowers and grass tufts, a lamp
 * post and a signpost at the bridge head. Everything is painted for the world's one
 * material and merged into one geometry: one draw call, about 20k triangles.
 *
 * Local frame: centre at the origin, the bridge head on the ground at (−(R − 0.9), 0, 0),
 * the bridge arriving from −x. The ground at the bridge head is y = 0.
 */
import { BufferAttribute, BufferGeometry, Color, Matrix4, Quaternion, Vector3 } from '@iwsdk/core';
import type { HouseSpec, Trade } from '../mind/types';
import { CATALOG } from './catalog';
import { M, MAT, blob, build, cbox, cyl, join, paint, place, rng, surfaceAlpha } from './geo';
import { kitGeometry } from './kit';
import { simplify } from './lod';
import { buildProp, mossyRock } from './props';
import { planHouse } from './recipes';

const TAU = Math.PI * 2;

export interface NeighbourHouseLook {
  id: string;
  recipe: Trade;
  colors: HouseSpec['colors'];
  sign?: string;
}

export interface NeighbourLook {
  seed: number;
  radius?: number;
  houses: NeighbourHouseLook[];
}

export interface NeighbourShape {
  geometry: BufferGeometry;
  radius: number;
  /** Ground height in the local frame. */
  height(x: number, z: number): number;
  /** The bridge head on this island (local, on the ground). */
  head: Vector3;
  /** Where its folk can stand about (local, on the ground). */
  stands: Vector3[];
  /** Door steps of its houses (local). */
  doors: Vector3[];
  /** Perches for birds: tree tops and roofs (local). */
  perches: Vector3[];
  triangles: number;
}

const GRASS = ['#7cb24b', '#5e9a3e', '#9fc45a', '#6aa443'].map((h) => new Color(h));
const DIRT = new Color('#a98457');
const STRATA = ['#5d8a36', '#6e4a32', '#8d5f3e', '#c08458', '#a8714a', '#cf9a66', '#b67c50', '#c58d5d', '#9a6d55', '#8c6a5c', '#7b6159', '#6d5d5e'].map((h) => new Color(h));

function catalogGeometry(id: string, scale = 1): BufferGeometry | null {
  const item = CATALOG[id];
  if (!item) return null;
  const g = 'kit' in item.source ? kitGeometry(item.source.kit, item.scale * scale) : buildProp(item.source.proc, 3);
  if (g && !('kit' in item.source) && scale !== 1) g.scale(scale, scale, scale);
  return g;
}

/** Distance from point p to segment ab in the xz plane. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export function neighbourIsland(look: NeighbourLook): NeighbourShape {
  const R = look.radius ?? 6.2;
  const seed = look.seed >>> 0;
  const r = rng(seed + 101);
  // The outline is exactly R toward the bridge (−x), lumpy elsewhere.
  const p1 = r() * TAU;
  const p2 = r() * TAU;
  const outline = (t: number): number => {
    let d = Math.atan2(Math.sin(t - Math.PI), Math.cos(t - Math.PI));
    d /= 0.45;
    const keep = 1 - Math.exp(-d * d);
    return R * (1 + keep * (0.07 * Math.sin(3 * t + p1) + 0.05 * Math.sin(5 * t + p2) + 0.03 * Math.sin(7 * t + p1 * 2)));
  };
  const head = new Vector3(-(R - 0.9), 0, 0);
  // A hill to one side at the back, house pads, a soft droop at the edge.
  const side = r() > 0.5 ? 1 : -1;
  const hill = { x: R * 0.32, z: side * R * 0.32, h: 0.85 + r() * 0.4, s: R * 0.36 };
  const houseSpots: { x: number; z: number; rotY: number }[] = [];
  const nHouses = Math.min(2, look.houses.length);
  const lots = [
    { x: R * 0.18, z: -side * R * 0.36 },
    { x: R * 0.42, z: side * R * 0.02 },
  ];
  for (let i = 0; i < nHouses; i++) {
    const l = lots[i];
    houseSpots.push({ x: l.x, z: l.z, rotY: Math.atan2(head.x - l.x, head.z - l.z) });
  }
  const pads = houseSpots.map((h) => ({ x: h.x, z: h.z, r: 2.1 }));
  const raw = (x: number, z: number): number => {
    const dh = Math.hypot(x - hill.x, z - hill.z);
    let y = hill.h * Math.exp(-(dh * dh) / (2 * hill.s * hill.s));
    y += 0.07 * Math.sin(x * 0.9 + p1) * Math.cos(z * 0.8 + p2);
    const t = Math.atan2(z, x);
    const k = Math.hypot(x, z) / outline(t);
    y -= 0.28 * Math.max(0, (k - 0.82) / 0.18) ** 2;
    return y;
  };
  const base = raw(head.x, head.z);
  const height = (x: number, z: number): number => {
    let y = raw(x, z) - base;
    for (const p of pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + 0.8) {
        const k = Math.max(0, Math.min(1, (p.r + 0.8 - d) / 0.8));
        y += (raw(p.x, p.z) - base - y) * k * k * (3 - 2 * k);
      }
    }
    return y;
  };
  // The path: bridge head → between the houses.
  const pathEnds = houseSpots.length ? houseSpots.map((h) => ({ x: h.x + Math.sin(h.rotY) * 1.9, z: h.z + Math.cos(h.rotY) * 1.9 })) : [{ x: R * 0.2, z: 0 }];
  const onPath = (x: number, z: number): number => {
    let d = Infinity;
    for (const e of pathEnds) d = Math.min(d, segDist(x, z, head.x, head.z, e.x, e.z));
    return Math.max(0, 1 - d / 0.75);
  };

  const parts: BufferGeometry[] = [];
  // ---- ground
  const rings = 9;
  const segs = 44;
  {
    const verts: number[] = [];
    const cols: number[] = [];
    const idx: number[] = [];
    const c = new Color();
    const push = (x: number, z: number, s: number): void => {
      verts.push(x, height(x, z), z);
      const g = GRASS[Math.floor((Math.sin(x * 1.7 + p1) * 0.5 + 0.5) * 3.99)];
      c.copy(g).lerp(GRASS[(Math.floor(z * 3 + 10) >>> 0) % 4], 0.35);
      // the lip toward the edge is a little drier
      c.lerp(new Color('#b7b45a'), Math.max(0, (s - 0.86) / 0.14) * 0.35);
      const p = onPath(x, z);
      if (p > 0) c.lerp(DIRT, Math.min(1, p * 1.5));
      const k = 0.96 + r() * 0.07;
      cols.push(c.r * k, c.g * k, c.b * k, surfaceAlpha(p > 0.45 ? M.dirt : M.grass));
    };
    push(0, 0, 0);
    for (let j = 1; j <= rings; j++) {
      const s = Math.pow(j / rings, 0.85);
      for (let i = 0; i < segs; i++) {
        const t = (i / segs) * TAU + (j % 2 ? 0.5 / segs : 0) * TAU;
        const jit = j < rings ? (r() - 0.5) * 0.3 : 0;
        const rad = outline(t) * s + jit;
        push(Math.cos(t) * rad, Math.sin(t) * rad, s);
      }
    }
    for (let i = 0; i < segs; i++) idx.push(0, 1 + ((i + 1) % segs), 1 + i);
    for (let j = 1; j < rings; j++) {
      const a0 = 1 + (j - 1) * segs;
      const b0 = 1 + j * segs;
      for (let i = 0; i < segs; i++) {
        const i1 = (i + 1) % segs;
        idx.push(a0 + i, a0 + i1, b0 + i, a0 + i1, b0 + i1, b0 + i);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(cols), 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g.toNonIndexed());
  }
  // ---- cliffs: strata dropping into the clouds
  {
    const D = [0, 0.25, 0.8, 1.5, 2.4, 3.4, 4.6, 5.8, 7.0, 8.0, 8.8, 9.3];
    const F = [1.0, 1.03, 1.01, 0.97, 0.92, 0.85, 0.76, 0.64, 0.5, 0.34, 0.18, 0.05];
    const pos: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const tint = new Color();
    for (let k = 0; k < D.length; k++) {
      for (let i = 0; i < segs; i++) {
        const t = (i / segs) * TAU;
        const er = outline(t);
        const ex = Math.cos(t) * er;
        const ez = Math.sin(t) * er;
        const top = height(ex, ez);
        const bulge = k > 1 && k < D.length - 1 ? Math.sin(t * 7 + k * 1.3) * 0.22 + Math.sin(t * 13 + k) * 0.1 : 0;
        const rad = er * F[k] + (k === 0 ? 0 : (r() - 0.5) * (k < 3 ? 0.1 : 0.28)) + bulge;
        pos.push(Math.cos(t) * rad, top - D[k] + (k > 0 ? (r() - 0.5) * 0.15 : 0), Math.sin(t) * rad);
        tint.copy(STRATA[Math.min(STRATA.length - 1, k)]).multiplyScalar(0.93 + r() * 0.12 + Math.sin(t * 5 + k) * 0.03);
        col.push(tint.r, tint.g, tint.b, surfaceAlpha(k === 0 ? M.grass : k === 1 ? M.dirt : M.rock));
      }
    }
    for (let k = 0; k < D.length - 1; k++)
      for (let i = 0; i < segs; i++) {
        const i1 = (i + 1) % segs;
        const a = k * segs + i;
        const b = k * segs + i1;
        const c = (k + 1) * segs + i;
        const d = (k + 1) * segs + i1;
        idx.push(a, b, c, b, d, c);
      }
    const last = (D.length - 1) * segs;
    const tip = pos.length / 3;
    pos.push(0, pos[last * 3 + 1] - 0.6, 0);
    const lc = STRATA[STRATA.length - 1];
    col.push(lc.r, lc.g, lc.b, surfaceAlpha(M.rock));
    for (let i = 0; i < segs; i++) idx.push(last + i, last + ((i + 1) % segs), tip);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
    g.setIndex(idx);
    g.computeVertexNormals();
    parts.push(g.toNonIndexed());
  }

  // ---- houses, from the same recipes as at home
  const doors: Vector3[] = [];
  const perches: Vector3[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const yAxis = new Vector3(0, 1, 0);
  houseSpots.forEach((spot, i) => {
    const h = look.houses[i];
    const spec: HouseSpec = { id: h.id, residentId: '', recipe: h.recipe, pos: { x: spot.x, z: spot.z }, rotY: spot.rotY, colors: h.colors, props: [], sign: h.sign, builtAt: 0 };
    let plan;
    try {
      plan = planHouse(spec);
    } catch {
      return;
    }
    const y = height(spot.x, spot.z);
    const hm = new Matrix4().compose(new Vector3(spot.x, y, spot.z), q.setFromAxisAngle(yAxis, spot.rotY), new Vector3(1, 1, 1));
    const pieces: BufferGeometry[] = [];
    for (const piece of plan.pieces) {
      // Small things are lost at this distance: keep the house and its bigger yard pieces.
      if (piece.stage === 'props') continue;
      const g = piece.geo.clone();
      g.applyMatrix4(m.makeTranslation(piece.pos[0], piece.pos[1], piece.pos[2]).premultiply(hm));
      pieces.push(g);
    }
    if (pieces.length) parts.push(simplify(join(pieces), 0.045));
    doors.push(new Vector3(...plan.door).applyMatrix4(hm));
    perches.push(new Vector3(...plan.top).applyMatrix4(hm));
  });

  // ---- trees, bushes, rocks, flowers: dense round the back, clear on the path
  const taken: { x: number; z: number; r: number }[] = [...pads.map((p) => ({ x: p.x, z: p.z, r: p.r + 0.3 })), { x: head.x, z: head.z, r: 1.4 }];
  const free = (x: number, z: number, rad: number): boolean => {
    const t = Math.atan2(z, x);
    if (Math.hypot(x, z) > outline(t) - rad - 0.35) return false;
    if (onPath(x, z) > 0) return false;
    return taken.every((o) => Math.hypot(x - o.x, z - o.z) > o.r + rad);
  };
  const drop = (rad: number, tries: number, prefer: (x: number, z: number) => boolean = () => true): [number, number] | null => {
    for (let k = 0; k < tries; k++) {
      const a = r() * TAU;
      const d = Math.sqrt(r()) * R;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (free(x, z, rad) && prefer(x, z)) {
        taken.push({ x, z, r: rad });
        return [x, z];
      }
    }
    return null;
  };
  const trees = ['tree-round-a', 'pine-yellow-medium', 'tree-round-b', 'pine-orange-medium', 'trees-a-small', 'pine-orange-small'];
  const nTrees = 5 + (look.houses.length ? 0 : 2);
  for (let k = 0; k < nTrees; k++) {
    const at = drop(0.9, 40, (x) => x > -R * 0.2);
    if (!at) continue;
    const id = trees[(k + seed) % trees.length];
    const g = catalogGeometry(id, 0.8 + r() * 0.35);
    if (!g) continue;
    const y = height(at[0], at[1]) - 0.05;
    parts.push(place(g, [at[0], y, at[1]], [0, r() * TAU, 0]));
    perches.push(new Vector3(at[0], y + 3.2, at[1]));
  }
  for (let k = 0; k < 7; k++) {
    const at = drop(0.45, 30);
    if (!at) continue;
    const s = 0.35 + r() * 0.3;
    const leaf = ['#5f9e45', '#477f36', '#6aa443', '#4f8a3a'][k % 4];
    const b = paint(blob(s, 1, seed + 40 + k, 0.18, 0.75), leaf, { smooth: true, shade: 0.35, mat: M.leaf }, true);
    parts.push(b.translate(at[0], height(at[0], at[1]) + s * 0.45, at[1]));
    // a few berries or blossoms on some bushes
    if (k % 2 === 0)
      for (let f = 0; f < 4; f++) {
        const a = r() * TAU;
        parts.push(paint(blob(0.045, 0, seed + k * 9 + f, 0.1), ['#f2b134', '#f08a8a', '#fff1d0'][f % 3], { smooth: true, shade: 0 }, true).translate(at[0] + Math.cos(a) * s * 0.8, height(at[0], at[1]) + s * (0.6 + r() * 0.3), at[1] + Math.sin(a) * s * 0.8));
      }
  }
  for (let k = 0; k < 5; k++) {
    const at = drop(0.4, 30);
    if (!at) continue;
    const g = mossyRock(0.25 + r() * 0.35, seed + 70 + k);
    parts.push(place(g, [at[0], height(at[0], at[1]) - 0.06, at[1]], [0, r() * TAU, 0]));
  }
  // flowers in small drifts
  const petals = ['#f6d65a', '#f39ab0', '#ffffff', '#f2884b', '#b9a4ff', '#ffd1e3'];
  for (let k = 0; k < 9; k++) {
    const at = drop(0.3, 25);
    if (!at) continue;
    const colour = petals[(k + seed) % petals.length];
    for (let f = 0; f < 6; f++) {
      const x = at[0] + (r() - 0.5) * 0.7;
      const z = at[1] + (r() - 0.5) * 0.7;
      const y = height(x, z);
      const h = 0.14 + r() * 0.12;
      parts.push(paint(cyl(0.008, 0.01, h, 3), '#5b8f3a', { mat: M.leaf, shade: 0.3 }).translate(x, y, z));
      parts.push(paint(blob(0.04, 0, seed + k * 13 + f, 0.25, 0.55), colour, { smooth: true, shade: 0.1, mat: M.leaf }, true).translate(x, y + h, z));
    }
  }
  // grass tufts: a few blades each, swaying with the island wind (leaf surface)
  const blades = ['#8cc152', '#7cb24b', '#a3c95a', '#6aa443'].map((h) => new Color(h));
  for (let k = 0; k < 260; k++) {
    const a = r() * TAU;
    const d = Math.sqrt(r()) * R * 0.97;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.hypot(x, z) > outline(a) - 0.25 || onPath(x, z) > 0.3) continue;
    if (pads.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 0.85)) continue;
    const y = height(x, z);
    const tuft: BufferGeometry[] = [];
    const n = 4 + Math.floor(r() * 3);
    for (let b = 0; b < n; b++) {
      const h = 0.12 + r() * 0.16;
      const w = 0.022;
      const ang = r() * TAU;
      const lean = (r() - 0.5) * 0.4;
      const blade = new BufferGeometry();
      // both faces, so a blade reads from either side
      blade.setAttribute('position', new BufferAttribute(new Float32Array([-w, 0, 0, w, 0, 0, lean * h, h, 0.02, w, 0, 0, -w, 0, 0, lean * h, h, 0.02]), 3));
      blade.rotateY(ang);
      blade.translate((r() - 0.5) * 0.12, 0, (r() - 0.5) * 0.12);
      tuft.push(blade);
    }
    const g = blades[Math.floor(r() * 4)];
    parts.push(join(tuft.map((t) => paint(t, g, { mat: M.leaf, shade: 0.3, wobble: 0.06 }))).translate(x, y, z));
  }
  // ---- at the bridge head: a lamp post on one side, a signpost on the other
  // a stone lamp (a lantern hung off a post's arm reads badly from afar)
  const lamp = catalogGeometry('stone-lamp', 1) ?? catalogGeometry('lantern', 1);
  if (lamp) parts.push(place(lamp, [head.x + 0.35, height(head.x + 0.35, head.z + 1.05), head.z + 1.05], [0, Math.PI / 2, 0]));
  const sign = catalogGeometry('signpost', 1);
  if (sign) parts.push(place(sign, [head.x + 0.45, height(head.x + 0.45, head.z - 1.15), head.z - 1.15], [0, -Math.PI / 2 + 0.3, 0]));
  const bench = catalogGeometry('bench', 1);
  if (bench) {
    const at = drop(0.8, 30, (x) => x < R * 0.1);
    if (at) parts.push(place(bench, [at[0], height(at[0], at[1]), at[1]], [0, Math.atan2(-at[0], -at[1]) + Math.PI, 0]));
  }
  const mailbox = catalogGeometry('mailbox', 1);
  if (mailbox && pathEnds[0]) {
    const e = pathEnds[0];
    const x = (head.x + e.x) / 2 + 0.7;
    const z = (head.z + e.z) / 2 + 0.75;
    parts.push(place(mailbox, [x, height(x, z), z], [0, -Math.PI / 2, 0]));
  }

  // ---- where folk stand: along the path and near the bridge head
  const stands: Vector3[] = [];
  for (const e of pathEnds) stands.push(new Vector3(e.x, height(e.x, e.z), e.z));
  stands.push(new Vector3(head.x + 1.6, height(head.x + 1.6, head.z + 0.6), head.z + 0.6));
  stands.push(new Vector3(head.x + 2.4, height(head.x + 2.4, head.z - 0.7), head.z - 0.7));

  const geometry = join(parts);
  geometry.computeBoundingSphere();
  return { geometry, radius: R, height, head, stands, doors, perches, triangles: geometry.getAttribute('position').count / 3 };
}

// ---------------------------------------------------------------------------------------
// The rope bridge's pieces

/** One plank, centred, its length across the bridge along x (1.3 m). */
export function bridgePlank(k: number): BufferGeometry {
  return build([
    [cbox(1.3, 0.07, 0.24, 0.02), k % 2 ? MAT.plank : MAT.woodLight, { mat: M.plank, wobble: 0.05, seed: k + 3 }],
    // rope lashings at both ends
    [place(cyl(0.035, 0.035, 0.09, 6), [-0.62, -0.01, 0], [Math.PI / 2, 0, 0]), MAT.rope, { mat: M.cloth }],
    [place(cyl(0.035, 0.035, 0.09, 6), [0.62, -0.01, 0], [Math.PI / 2, 0, 0]), MAT.rope, { mat: M.cloth }],
  ]);
}

/** A bridge post with a rope ring near the top, 1.15 m above the ground. */
export function bridgePost(): BufferGeometry {
  return build([
    [place(cbox(0.15, 1.3, 0.15, 0.03), [0, -0.2, 0]), MAT.woodDark, { mat: M.bark }],
    [place(cyl(0.11, 0.11, 0.1, 8), [0, 0.86, 0]), MAT.rope, { mat: M.cloth }],
    [place(cyl(0.09, 0.07, 0.08, 8), [0, 1.1, 0]), MAT.woodDark, { mat: M.bark }],
  ]);
}

/** A coil of rope on a stump with a wooden toggle on its free end: what a person holds. */
export function ropeCoil(): BufferGeometry {
  const parts: [BufferGeometry, string, { mat?: number; smooth?: boolean; shade?: number }?][] = [
    [place(cyl(0.2, 0.24, 0.5, 9), [0, 0, 0]), MAT.woodDark, { mat: M.bark }],
  ];
  for (let k = 0; k < 4; k++) parts.push([place(cyl(0.2 - k * 0.012, 0.2 - k * 0.012, 0.06, 12, true), [0, 0.52 + k * 0.055, 0]), k % 2 ? MAT.rope : '#b8915d', { mat: M.cloth, shade: 0.2 }]);
  parts.push([place(cbox(0.28, 0.06, 0.06, 0.02), [0, 0.8, 0.04]), MAT.woodLight, { mat: M.plank }]);
  return build(parts as [BufferGeometry, string, object?][]);
}

/** A rope as a soft tube through points, painted for the world's material. */
export function ropeTube(points: Vector3[], radius = 0.025): BufferGeometry {
  const sides = 5;
  const pos: number[] = [];
  const up = new Vector3(0, 1, 0);
  const t = new Vector3();
  const n = new Vector3();
  const b = new Vector3();
  const ring = (i: number): Vector3[] => {
    const p = points[i];
    t.copy(points[Math.min(points.length - 1, i + 1)]).sub(points[Math.max(0, i - 1)]).normalize();
    n.crossVectors(t, up);
    if (n.lengthSq() < 1e-6) n.set(1, 0, 0);
    n.normalize();
    b.crossVectors(n, t).normalize();
    const out: Vector3[] = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * TAU;
      out.push(p.clone().addScaledVector(n, Math.cos(a) * radius).addScaledVector(b, Math.sin(a) * radius));
    }
    return out;
  };
  let prev = ring(0);
  for (let i = 1; i < points.length; i++) {
    const cur = ring(i);
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides;
      pos.push(...prev[s].toArray(), ...cur[s].toArray(), ...prev[s1].toArray(), ...prev[s1].toArray(), ...cur[s].toArray(), ...cur[s1].toArray());
    }
    prev = cur;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return paint(g, MAT.rope, { mat: M.cloth, shade: 0.1, wobble: 0 }, true);
}
