/**
 * Small construction library for the world's procedural pieces. Every helper returns a
 * non-indexed BufferGeometry with position, normal and a vec4 colour (linear RGB, alpha
 * used as a glow mask: 0 glows at night). That one attribute layout lets every static piece
 * share one material and be merged into a handful of draw calls (batch.ts).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  IcosahedronGeometry,
  LatheGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Hex = string;

const tmpColor = new Color();

/** Deterministic random numbers from a string or number seed (mulberry32). */
export function rng(seed: string | number): () => number {
  let h = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  return () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Surface ids, stored in the colour alpha as id / 15. The main material picks a stylized
 * detail texture by id (materials.ts); 0 glows at night, 15 is plain colour.
 */
export const M = {
  glow: 0, grass: 1, dirt: 2, cobble: 3, rock: 4, plank: 5, bark: 6, leaf: 7,
  tile: 8, plaster: 9, thatch: 10, sand: 11, brick: 12, metal: 13, cloth: 14, plain: 15,
} as const;
export type SurfaceId = (typeof M)[keyof typeof M];
export const surfaceAlpha = (id: number): number => id / 15;

export interface PaintOpts {
  /** Smooth normals (organic shapes: bushes, rocks, puffs). */
  smooth?: boolean;
  /** Surface id for the detail texture (M). */
  mat?: number;
  /** Darken toward the bottom of the piece: 0 none, 0.25 gentle. */
  shade?: number;
  /** Random per-face brightness wobble, 0.04 is subtle. */
  wobble?: number;
  /** Glows at night. */
  glow?: boolean;
  seed?: number;
  /**
   * Moves in the wind (cloth, flags, a cat's tail): 'down' frees the lower edge (laundry),
   * 'x' frees the +x end (a flag on a pole at x = min), 'all' moves everything a little.
   */
  flutter?: 'down' | 'x' | 'all';
}

/** Colour alpha for a surface id with a flutter weight 0..1 (see materials.ts). */
export const flutterAlpha = (id: number, w: number): number => (id + 0.15 + 0.3 * Math.max(0, Math.min(1, w))) / 15;

/** Makes geometry non-indexed with flat normals (or keeps smooth normals) and paints it. */
export function paint(g: BufferGeometry, hex: Hex | Color, opts: PaintOpts = {}, smooth = false): BufferGeometry {
  let geo = g;
  if (smooth || opts.smooth) {
    if (!geo.index) {
      for (const name of Object.keys(geo.attributes)) if (name !== 'position') geo.deleteAttribute(name);
      geo = mergeVertices(geo, 1e-4);
      geo.computeVertexNormals();
    } else if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (geo.index) geo = geo.toNonIndexed();
  } else {
    if (geo.index) geo = geo.toNonIndexed();
    geo.deleteAttribute('normal');
    geo.computeVertexNormals();
  }
  for (const name of Object.keys(geo.attributes)) if (name !== 'position' && name !== 'normal') geo.deleteAttribute(name);
  const base = hex instanceof Color ? hex : tmpColor.set(hex).clone();
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const col = new Float32Array(n * 4);
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    const x = pos.getX(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  const shade = opts.shade ?? 0.18;
  const wobble = opts.wobble ?? 0.03;
  const r = rng(opts.seed ?? 7);
  const span = Math.max(1e-4, maxY - minY);
  let faceK = 1;
  for (let i = 0; i < n; i++) {
    if (i % 3 === 0) faceK = 1 + (r() - 0.5) * 2 * wobble;
    const k = (1 - shade + shade * ((pos.getY(i) - minY) / span)) * faceK;
    col[i * 4] = base.r * k;
    col[i * 4 + 1] = base.g * k;
    col[i * 4 + 2] = base.b * k;
    if (opts.glow) col[i * 4 + 3] = 0;
    else if (opts.flutter) {
      const w = opts.flutter === 'down' ? (maxY - pos.getY(i)) / span : opts.flutter === 'x' ? (pos.getX(i) - minX) / Math.max(1e-4, maxX - minX) : 0.6;
      col[i * 4 + 3] = flutterAlpha(opts.mat ?? M.cloth, w);
    } else col[i * 4 + 3] = surfaceAlpha(opts.mat ?? M.plain);
  }
  geo.setAttribute('color', new BufferAttribute(col, 4));
  return geo;
}

/**
 * Replaces normals of a non-indexed geometry with smooth ones: every corner gets the
 * area-weighted average of the faces sharing its position. Keeps colours as they are.
 */
export function smoothNormals(geo: BufferGeometry): BufferGeometry {
  const pos = geo.getAttribute('position');
  const n = pos.count;
  const acc = new Map<string, [number, number, number]>();
  const keys: string[] = new Array(n);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const fn = new Vector3().subVectors(c, b).cross(new Vector3().subVectors(a, b));
    for (let k = 0; k < 3; k++) {
      const key = `${pos.getX(i + k).toFixed(3)},${pos.getY(i + k).toFixed(3)},${pos.getZ(i + k).toFixed(3)}`;
      keys[i + k] = key;
      const v = acc.get(key);
      if (v) {
        v[0] += fn.x;
        v[1] += fn.y;
        v[2] += fn.z;
      } else acc.set(key, [fn.x, fn.y, fn.z]);
    }
  }
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = acc.get(keys[i])!;
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    out[i * 3] = v[0] / l;
    out[i * 3 + 1] = v[1] / l;
    out[i * 3 + 2] = v[2] / l;
  }
  geo.setAttribute('normal', new BufferAttribute(out, 3));
  return geo;
}

/** Applies a transform to geometry in place and returns it. */
export function place(
  g: BufferGeometry,
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: number | [number, number, number] = 1,
): BufferGeometry {
  const s = typeof scale === 'number' ? new Vector3(scale, scale, scale) : new Vector3(...scale);
  const m = new Matrix4().compose(new Vector3(...pos), new Quaternion().setFromEuler(new Euler(...rot)), s);
  g.applyMatrix4(m);
  return g;
}

/** Concatenates painted geometries (same layout) into one. */
export function join(parts: BufferGeometry[]): BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 4);
  let o = 0;
  for (const p of parts) {
    const pa = p.getAttribute('position');
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    const na = p.getAttribute('normal');
    const ca = p.getAttribute('color');
    for (let i = 0; i < pa.count; i++) {
      pos[(o + i) * 3] = pa.getX(i);
      pos[(o + i) * 3 + 1] = pa.getY(i);
      pos[(o + i) * 3 + 2] = pa.getZ(i);
      nor[(o + i) * 3] = na.getX(i);
      nor[(o + i) * 3 + 1] = na.getY(i);
      nor[(o + i) * 3 + 2] = na.getZ(i);
      col[(o + i) * 4] = ca.getX(i);
      col[(o + i) * 4 + 1] = ca.getY(i);
      col[(o + i) * 4 + 2] = ca.getZ(i);
      col[(o + i) * 4 + 3] = ca.itemSize > 3 ? ca.getW(i) : 1;
    }
    o += pa.count;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nor, 3));
  g.setAttribute('color', new BufferAttribute(col, 4));
  g.computeBoundingSphere();
  return g;
}

// ---------- primitive shapes (all with the bottom at y = 0 unless noted) ----------

/** A box with chamfered edges: chunky and soft in light. */
export function cbox(w: number, h: number, d: number, bevel = 0.04): BufferGeometry {
  const b = Math.min(bevel, w / 2.2, h / 2.2, d / 2.2);
  const pts: Vector3[] = [];
  for (const sx of [-1, 1])
    for (const sy of [0, 1])
      for (const sz of [-1, 1]) {
        const x = (sx * w) / 2;
        const y = sy * h;
        const z = (sz * d) / 2;
        const iy = sy ? h - b : b;
        pts.push(new Vector3(x - sx * b, y, z - sz * b));
        pts.push(new Vector3(x, iy, z - sz * b));
        pts.push(new Vector3(x - sx * b, iy, z));
      }
  return new ConvexGeometry(pts);
}

/** Convex hull of points. */
export function hull(points: [number, number, number][]): BufferGeometry {
  return new ConvexGeometry(points.map((p) => new Vector3(...p)));
}

/** A triangular prism along x: a gable end shape (width w along x, span d along z, rise h). */
export function gable(w: number, d: number, h: number): BufferGeometry {
  return hull([
    [-w / 2, 0, -d / 2], [-w / 2, 0, d / 2], [-w / 2, h, 0],
    [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [w / 2, h, 0],
  ]);
}

export function cyl(rTop: number, rBot: number, h: number, sides = 8, open = false): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBot, h, sides, 1, open);
  g.translate(0, h / 2, 0);
  return g;
}

export function cone(r: number, h: number, sides = 8): BufferGeometry {
  const g = new ConeGeometry(r, h, sides);
  g.translate(0, h / 2, 0);
  return g;
}

/** Upper half sphere. */
export function dome(r: number, w = 12, h = 5): BufferGeometry {
  return new SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2);
}

export function ball(r: number, w = 8, h = 6): BufferGeometry {
  return new SphereGeometry(r, w, h);
}

/** A lumpy low-poly blob (bushes, rocks, cloud puffs). Centred on the origin. */
export function blob(r: number, detail: number, seed: number, jitter = 0.18, squash = 1): BufferGeometry {
  const g = new IcosahedronGeometry(r, detail);
  const pos = g.getAttribute('position');
  const rand = rng(seed);
  const cache = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let k = cache.get(key);
    if (k === undefined) {
      k = 1 + (rand() - 0.5) * 2 * jitter;
      cache.set(key, k);
    }
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * squash, pos.getZ(i) * k);
  }
  return g;
}

export function lathe(profile: [number, number][], sides = 10): BufferGeometry {
  return new LatheGeometry(profile.map(([x, y]) => new Vector2(x, y)), sides);
}

/** A cog wheel lying in the XY plane (axis along z), centred on the origin. */
export function gear(r: number, thick: number, teeth = 8): BufferGeometry[] {
  const parts: BufferGeometry[] = [];
  const disc = new CylinderGeometry(r * 0.82, r * 0.82, thick, teeth * 2);
  disc.rotateX(Math.PI / 2);
  parts.push(disc);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const t = cbox(r * 0.32, r * 0.3, thick, 0.01);
    t.translate(0, -r * 0.15, 0);
    t.translate(0, r * 0.88, 0);
    t.rotateZ(a);
    parts.push(t);
  }
  const hub = new CylinderGeometry(r * 0.22, r * 0.22, thick * 1.6, 8);
  hub.rotateX(Math.PI / 2);
  parts.push(hub);
  return parts;
}

/** Surface id for the shared material colours (anything else stays plain). */
export function autoSurface(c: Hex | Color): number {
  if (typeof c !== 'string') return M.plain;
  switch (c) {
    case MAT.stone: case MAT.stoneDark: case MAT.cobble: return M.cobble;
    case MAT.wood: case MAT.woodDark: case MAT.woodLight: case MAT.plank: return M.plank;
    case MAT.leaf: case MAT.leafDark: case MAT.leafLight: return M.leaf;
    case MAT.straw: return M.thatch;
    case MAT.terracotta: return M.brick;
    case MAT.soil: return M.dirt;
    case MAT.iron: case MAT.brass: return M.metal;
    case MAT.cloth: case MAT.cream: case MAT.paper: return M.cloth;
    default: return M.plain;
  }
}

/** Paints and joins a list of [geometry, colour] pairs. */
export function build(parts: [BufferGeometry, Hex | Color, PaintOpts?][]): BufferGeometry {
  return join(parts.map(([g, c, o], i) => paint(g, c, { seed: i + 1, mat: autoSurface(c), ...(o ?? {}) }, o?.smooth ?? false)));
}

/** Darker or lighter version of a hex colour, as hex. */
export function tone(hex: Hex, k: number): Hex {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * k)));
  return `#${c.getHexString()}`;
}

/** Mixes two hex colours. */
export function mixHex(a: Hex, b: Hex, t: number): Hex {
  return `#${new Color(a).lerp(new Color(b), t).getHexString()}`;
}

/** Fixed material colours shared by every piece. */
export const MAT = {
  stone: '#b3a593',
  stoneDark: '#8f8273',
  cobble: '#a59a8b',
  wood: '#9a6a43',
  woodDark: '#6e4a31',
  woodLight: '#c08a5a',
  plank: '#a87650',
  glass: '#3b5770',
  glassLight: '#9fd0d8',
  brass: '#d9a441',
  iron: '#4f4a4a',
  straw: '#d8b25a',
  leaf: '#5f9e45',
  leafDark: '#477f36',
  leafLight: '#8cbf55',
  soil: '#6b4a33',
  cloth: '#efe4cf',
  rope: '#c9a46f',
  terracotta: '#c8683f',
  paper: '#f1e3c2',
  red: '#d0573f',
  cream: '#f3e6cc',
  honey: '#f0a830',
  sea: '#4f8fb0',
} as const;
