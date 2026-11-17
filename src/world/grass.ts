/**
 * The meadow: instanced grass in clumps, eight kinds of wild flowers in patches and mixed
 * through the grass, clover and ferns, all swaying on the GPU with the island wind (one draw
 * call per kind). Blades taper to light tips and curve over; tufts round the seat have three
 * segments per blade, further out two, and far away one, so the meadow costs little where it
 * is small on screen. Every plant has its own turn, lean, size and tint. Anything under a
 * new house or path is hidden by scaling it to zero.
 */
import { BufferAttribute, BufferGeometry, Color, Euler, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { rng } from './geo';
import { CENTER, Land, PIER, POND, SEAT, STREAM, outlineR, segDist, type Islet, isletR } from './land';
import { groundTint } from './island';
import { foliageMaterial } from './materials';

/** Geometry builder that writes position, up normals and colour with sway in alpha. */
class Geo {
  pos: number[] = [];
  col: number[] = [];
  tri(a: number[], b: number[], c: number[], ca: Color, cb: Color, cc: Color, sa: number, sb: number, sc: number): void {
    this.pos.push(...a, ...b, ...c);
    this.col.push(ca.r, ca.g, ca.b, sa, cb.r, cb.g, cb.b, sb, cc.r, cc.g, cc.b, sc);
  }
  quad(a: number[], b: number[], c: number[], d: number[], ca: Color, cc: Color, sa: number, sc: number): void {
    this.tri(a, b, c, ca, ca, cc, sa, sa, sc);
    this.tri(a, c, d, ca, cc, cc, sa, sc, sc);
  }
  done(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('color', new BufferAttribute(new Float32Array(this.col), 4));
    return g;
  }
}

const WHITE = new Color('#ffffff');
const STEM = new Color('#4f8a35');
const TAU = Math.PI * 2;

// Blade colours multiply the ground colour under the tuft (the instance tint), so a tuft
// grows out of the lawn without a seam: a little darker at the root, light at the tip.
const G_ROOT = new Color(0.8, 0.83, 0.78);
const G_MID = new Color(1.0, 1.03, 0.95);
const G_TIP = new Color(1.55, 1.5, 1.08);
const G_DRY = new Color(1.6, 1.38, 0.8);

/**
 * One blade: tapered to a point, curving over with its lean, `segs` segments, colour from a
 * dark root through the meadow green to a light tip. Sway (alpha) grows with height.
 */
function blade(g: Geo, cx: number, cz: number, a: number, h: number, w: number, lean: number, segs: number, dry: number): void {
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  const px = -dz;
  const pz = dx;
  const tip = G_TIP.clone().lerp(G_DRY, dry);
  const col = (t: number): Color => (t < 0.5 ? G_ROOT.clone().lerp(G_MID, t * 2) : G_MID.clone().lerp(tip, (t - 0.5) * 2));
  const at = (t: number): [number, number, number, number] => {
    const off = lean * t * t;
    const width = w * Math.pow(1 - t, 0.7);
    return [cx + dx * off, h * t * (1 - lean * t * 0.8), cz + dz * off, width];
  };
  for (let k = 0; k < segs; k++) {
    const t0 = k / segs;
    const t1 = (k + 1) / segs;
    const [x0, y0, z0, w0] = at(t0);
    const [x1, y1, z1, w1] = at(t1);
    if (k === segs - 1) {
      g.tri([x0 - px * w0, y0, z0 - pz * w0], [x0 + px * w0, y0, z0 + pz * w0], [x1, y1, z1], col(t0), col(t0), col(1), t0, t0, 1);
    } else {
      g.quad([x0 - px * w0, y0, z0 - pz * w0], [x0 + px * w0, y0, z0 + pz * w0], [x1 + px * w1, y1, z1 + pz * w1], [x1 - px * w1, y1, z1 - pz * w1], col(t0), col(t1), t0, t1);
    }
  }
}

/** A tuft of blades fanning out from one root. */
function tuftGeometry(blades: number, segs: number, seed: number, tall = 1): BufferGeometry {
  const g = new Geo();
  const r = rng(seed);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * TAU + r() * 0.8;
    const h = (0.13 + r() * 0.17) * tall;
    const w = 0.011 + r() * 0.008;
    const lean = 0.04 + r() * 0.1;
    const rr = 0.12 * Math.sqrt(r()) * tall;
    blade(g, Math.cos(a) * rr, Math.sin(a) * rr, a + (r() - 0.5) * 0.6, h, w, lean, segs, r() < 0.2 ? 0.6 : r() * 0.25);
  }
  return g.done();
}

function stem(g: Geo, h: number, bend = 0.03, leaves = true): void {
  const mid = [bend * 0.3, h * 0.5, 0];
  g.quad([-0.006, 0, 0], [0.006, 0, 0], [mid[0] + 0.004, mid[1], 0], [mid[0] - 0.004, mid[1], 0], STEM, STEM, 0, 0.5);
  g.tri([mid[0] - 0.004, mid[1], 0], [mid[0] + 0.004, mid[1], 0], [bend, h, 0], STEM, STEM, STEM, 0.5, 0.5, 1);
  if (!leaves) return;
  // two small leaves
  g.tri([0, h * 0.18, 0], [0.075, h * 0.3, 0.025], [0.015, h * 0.4, 0], STEM, STEM, STEM, 0.15, 0.35, 0.4);
  g.tri([0, h * 0.3, 0], [-0.065, h * 0.44, -0.025], [-0.01, h * 0.5, 0], STEM, STEM, STEM, 0.3, 0.5, 0.5);
}

/** A ring of `n` petals of length r round an eye at (x, y, z), lifted at the tips by `cup`. */
function petalRing(g: Geo, x: number, y: number, z: number, n: number, r: number, wid: number, cup: number, petal: Color, eye: Color | null, eyeR = 0.016): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const b0 = a - wid;
    const b1 = a + wid;
    const mid = r * 0.55;
    const p0: number[] = [x, y, z];
    const p1 = [x + Math.cos(b0) * mid, y + cup * 0.5, z + Math.sin(b0) * mid];
    const p2 = [x + Math.cos(a) * r, y + cup, z + Math.sin(a) * r];
    const p3 = [x + Math.cos(b1) * mid, y + cup * 0.5, z + Math.sin(b1) * mid];
    g.tri(p0, p1, p2, petal, petal, petal, 1, 1, 1);
    g.tri(p0, p2, p3, petal, petal, petal, 1, 1, 1);
  }
  if (eye)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      g.tri([x, y + 0.012, z], [x + Math.cos(a) * eyeR, y + 0.006, z + Math.sin(a) * eyeR], [x + Math.cos(a + 1.26) * eyeR, y + 0.006, z + Math.sin(a + 1.26) * eyeR], eye, eye, eye, 1, 1, 1);
    }
}

/** Daisy: a ring of long petals round a yellow eye. */
function daisy(): BufferGeometry {
  const g = new Geo();
  const h = 0.24;
  stem(g, h);
  petalRing(g, 0.03, h, 0, 11, 0.06, 0.12, 0.012, WHITE, new Color('#f4c542'), 0.018);
  return g.done();
}

/** Tulip: a cup of upright petals. */
function tulip(): BufferGeometry {
  const g = new Geo();
  const h = 0.3;
  stem(g, h, 0.0);
  const dark = new Color('#d8d8d8');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    const r0 = 0.012;
    const r1 = 0.038;
    const p0 = [Math.cos(a - 0.7) * r0, h, Math.sin(a - 0.7) * r0];
    const p1 = [Math.cos(a + 0.7) * r0, h, Math.sin(a + 0.7) * r0];
    const p2 = [Math.cos(a + 0.6) * r1, h + 0.075, Math.sin(a + 0.6) * r1];
    const p3 = [Math.cos(a - 0.6) * r1, h + 0.075, Math.sin(a - 0.6) * r1];
    const tip = [Math.cos(a) * r1 * 0.9, h + 0.1, Math.sin(a) * r1 * 0.9];
    g.quad(p0, p1, p2, p3, dark, WHITE, 1, 1);
    g.tri(p3, p2, tip, WHITE, WHITE, WHITE, 1, 1, 1);
  }
  return g.done();
}

/** Bell flowers: a bending stem with little hanging bells. */
function bells(): BufferGeometry {
  const g = new Geo();
  const h = 0.26;
  stem(g, h, 0.06);
  for (let i = 0; i < 4; i++) {
    const t = 0.55 + i * 0.13;
    const x = 0.06 * t * t + 0.015 * (i % 2 ? 1 : -1);
    const y = h * t;
    const r = 0.022;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU;
      const b = a + TAU / 5;
      g.tri([x, y, 0], [x + Math.cos(a) * r, y - 0.035, Math.sin(a) * r], [x + Math.cos(b) * r, y - 0.035, Math.sin(b) * r], WHITE, WHITE, WHITE, 1, 1, 1);
    }
  }
  return g.done();
}

/** Puffball (dandelion clock): a round white head. */
function puff(): BufferGeometry {
  const g = new Geo();
  const h = 0.28;
  stem(g, h, 0.02, false);
  const r = 0.04;
  const c = [0.02, h + r, 0];
  const pts: number[][] = [];
  for (let k = 0; k < 10; k++) {
    const y = 1 - (k / 9) * 2;
    const rr = Math.sqrt(1 - y * y);
    const a = k * 2.399;
    pts.push([c[0] + Math.cos(a) * rr * r, c[1] + y * r, c[2] + Math.sin(a) * rr * r]);
  }
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % pts.length];
    g.tri(c, p, q, WHITE, WHITE, WHITE, 1, 1, 1);
    g.tri(p, q, [c[0] + (p[0] - c[0]) * 1.3, c[1] + (p[1] - c[1]) * 1.3, c[2] + (p[2] - c[2]) * 1.3], WHITE, WHITE, WHITE, 1, 1, 1);
  }
  return g.done();
}

/** Poppy: a wide cup of four round petals with a dark heart, on a thin bending stem. */
function poppy(): BufferGeometry {
  const g = new Geo();
  const h = 0.32;
  stem(g, h, 0.05, false);
  g.tri([0, h * 0.15, 0], [0.06, h * 0.22, 0.03], [0.01, h * 0.3, 0], STEM, STEM, STEM, 0.1, 0.25, 0.3);
  const x = 0.05;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const fan = 4;
    for (let k = 0; k < fan; k++) {
      const b0 = a - 0.75 + (k / fan) * 1.5;
      const b1 = a - 0.75 + ((k + 1) / fan) * 1.5;
      const r0 = 0.055 * (0.8 + 0.2 * Math.sin((k / fan) * Math.PI));
      const r1 = 0.055 * (0.8 + 0.2 * Math.sin(((k + 1) / fan) * Math.PI));
      g.tri([x, h, 0], [x + Math.cos(b0) * r0, h + 0.035, Math.sin(b0) * r0], [x + Math.cos(b1) * r1, h + 0.035, Math.sin(b1) * r1], WHITE, WHITE, WHITE, 1, 1, 1);
    }
  }
  const dark = new Color('#2b2420');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU;
    g.tri([x, h + 0.02, 0], [x + Math.cos(a) * 0.013, h + 0.012, Math.sin(a) * 0.013], [x + Math.cos(a + 1.26) * 0.013, h + 0.012, Math.sin(a + 1.26) * 0.013], dark, dark, dark, 1, 1, 1);
  }
  return g.done();
}

/** Buttercups: a branching stem with three small glossy cups. */
function buttercup(): BufferGeometry {
  const g = new Geo();
  const heads: [number, number, number][] = [[0.0, 0.2, 0], [0.05, 0.16, 0.03], [-0.04, 0.14, -0.02]];
  for (const [x, y, z] of heads) {
    g.tri([-0.004, 0, 0], [0.004, 0, 0], [x, y, z], STEM, STEM, STEM, 0, 0, 1);
    petalRing(g, x, y, z, 5, 0.022, 0.4, 0.012, WHITE, null);
  }
  g.tri([0, 0.02, 0], [0.05, 0.05, 0.02], [0.01, 0.07, 0], STEM, STEM, STEM, 0.1, 0.3, 0.3);
  return g.done();
}

/** Lavender: a little bush of upright stems, each with a spike of tiny buds. */
function lavender(): BufferGeometry {
  const g = new Geo();
  const r = rng(71);
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * TAU + r();
    const lean = 0.05 + r() * 0.05;
    const h = 0.26 + r() * 0.1;
    const tx = Math.cos(a) * lean;
    const tz = Math.sin(a) * lean;
    g.tri([-0.004, 0, 0], [0.004, 0, 0], [tx, h, tz], STEM, STEM, STEM, 0, 0, 1);
    for (let k = 0; k < 5; k++) {
      const t = 0.62 + k * 0.08;
      const x = tx * t;
      const y = h * t;
      const z = tz * t;
      const w = 0.013 * (1 - k * 0.12);
      g.tri([x - w, y, z], [x + w, y, z], [x, y + 0.035, z], WHITE, WHITE, WHITE, t, t, 1);
      g.tri([x, y, z - w], [x, y, z + w], [x, y + 0.035, z], WHITE, WHITE, WHITE, t, t, 1);
    }
  }
  return g.done();
}

/** Cornflower: a ragged star of narrow petals on a tall wiry stem. */
function cornflower(): BufferGeometry {
  const g = new Geo();
  const h = 0.34;
  stem(g, h, 0.04);
  petalRing(g, 0.04, h, 0, 9, 0.042, 0.09, 0.02, WHITE, new Color('#3a3f73'), 0.012);
  return g.done();
}

/** Clover: three round leaves close to the ground. */
function clover(): BufferGeometry {
  const g = new Geo();
  const leaf = new Color('#5f9a3a');
  for (let s = 0; s < 3; s++) {
    const ox = (s - 1) * 0.06;
    const oz = (s % 2) * 0.05;
    const h = 0.04 + s * 0.012;
    g.tri([ox - 0.004, 0, oz], [ox + 0.004, 0, oz], [ox, h, oz], STEM, STEM, STEM, 0, 0, 0.6);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + s;
      for (let k = 0; k < 4; k++) {
        const b0 = a - 0.5 + (k / 4) * 1.0;
        const b1 = a - 0.5 + ((k + 1) / 4) * 1.0;
        g.tri([ox, h, oz], [ox + Math.cos(b0) * 0.03, h + 0.004, oz + Math.sin(b0) * 0.03], [ox + Math.cos(b1) * 0.03, h + 0.004, oz + Math.sin(b1) * 0.03], leaf, leaf, leaf, 0.6, 0.7, 0.7);
      }
    }
  }
  return g.done();
}

/** Fern: arching fronds round a crown. */
function fern(): BufferGeometry {
  const g = new Geo();
  const base = new Color('#3f7a32');
  const tip = new Color('#86b84f');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const segs = 4;
    let prev = [0, 0, 0];
    for (let k = 1; k <= segs; k++) {
      const t = k / segs;
      const p = [dx * t * 0.42, Math.sin(t * Math.PI * 0.85) * 0.3, dz * t * 0.42];
      const w = 0.06 * (1 - t * 0.7);
      const px = -dz * w;
      const pz = dx * w;
      const c0 = base.clone().lerp(tip, (k - 1) / segs);
      const c1 = base.clone().lerp(tip, t);
      g.quad([prev[0] - px, prev[1], prev[2] - pz], [prev[0] + px, prev[1], prev[2] + pz], [p[0] + px * 0.6, p[1], p[2] + pz * 0.6], [p[0] - px * 0.6, p[1], p[2] - pz * 0.6], c0, c1, (k - 1) / segs, t);
      prev = p;
    }
  }
  return g.done();
}

interface Placed { x: number; z: number; s: number; rot: number; tilt: number; tint: Color }

interface Kind {
  name: string;
  geo: BufferGeometry;
  list: Placed[];
  mesh: InstancedMesh | null;
  tris: number;
  flowers: boolean;
}

export interface Meadow {
  root: Object3D;
  clear(x: number, z: number, r: number): void;
  clearAlong(points: { x: number; z: number }[], r: number): void;
  refresh(): void;
  addIslet(i: Islet): void;
  triangles(): number;
}

const SPECIES: { name: string; geo: () => BufferGeometry; colours: string[] }[] = [
  { name: 'daisies', geo: daisy, colours: ['#ffffff', '#fff3d6', '#ffd9e0'] },
  { name: 'tulips', geo: tulip, colours: ['#e8513f', '#f6c33b', '#f28aa0', '#f39b4a'] },
  { name: 'bells', geo: bells, colours: ['#8fb6ef', '#a9c8f5', '#ffffff'] },
  { name: 'puffs', geo: puff, colours: ['#fbf7ee'] },
  { name: 'poppies', geo: poppy, colours: ['#e2442f', '#ef6a3a', '#f08a4b'] },
  { name: 'buttercups', geo: buttercup, colours: ['#f7d23e', '#fbe36a', '#f2c12e'] },
  { name: 'lavender', geo: lavender, colours: ['#9c8acb', '#a99ad6', '#8f7fc4'] },
  { name: 'cornflowers', geo: cornflower, colours: ['#4f7fd6', '#6b95e3', '#5b6fd0'] },
];

/** Smooth value noise in 0..1 for clumps and patches. */
function noise2(seed: number): (x: number, z: number) => number {
  const r = rng(seed);
  const n = 64;
  const g = new Float32Array(n * n).map(() => r());
  const at = (i: number, j: number): number => g[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
  const sm = (t: number): number => t * t * (3 - 2 * t);
  return (x, z) => {
    const i = Math.floor(x);
    const j = Math.floor(z);
    const fx = sm(x - i);
    const fz = sm(z - j);
    const a = at(i, j) * (1 - fx) + at(i + 1, j) * fx;
    const b = at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx;
    return a * (1 - fz) + b * fz;
  };
}

/** Distance bands from the seat: full blades near, fewer and simpler further out. */
const NEAR = 7.5;
const MID = 14;

export function createMeadow(parent: Object3D, land: Land): Meadow {
  const root = new Object3D();
  root.name = 'world:meadow';
  parent.add(root);
  const r = rng(808);
  const clump = noise2(31);
  const patchy = noise2(57);
  const kinds: Kind[] = [
    { name: 'grass', geo: tuftGeometry(7, 3, 3), list: [], mesh: null, tris: 0, flowers: false },
    { name: 'grass-mid', geo: tuftGeometry(6, 2, 5, 1.1), list: [], mesh: null, tris: 0, flowers: false },
    { name: 'grass-far', geo: tuftGeometry(4, 1, 7, 1.3), list: [], mesh: null, tris: 0, flowers: false },
    ...SPECIES.map((s) => ({ name: s.name, geo: s.geo(), list: [] as Placed[], mesh: null, tris: 0, flowers: true })),
    { name: 'clover', geo: clover(), list: [], mesh: null, tris: 0, flowers: false },
    { name: 'ferns', geo: fern(), list: [], mesh: null, tris: 0, flowers: false },
  ];
  for (const k of kinds) k.tris = k.geo.getAttribute('position').count / 3;
  const byName = (n: string): Kind => kinds.find((k) => k.name === n)!;

  const okAt = (x: number, z: number): boolean => {
    if (!land.inside(x, z, 0.3)) return false;
    if (Math.abs(x - SEAT.x) < 1.95 && z > SEAT.z - 1.5 && z < SEAT.z + 1.6) return false;
    if (segDist(x, z, PIER.base, PIER.end) < PIER.width / 2 + 0.2) return false;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.45) return false;
    if (segDist(x, z, STREAM[0], STREAM[1]) < 0.55) return false;
    for (const o of land.obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r * 0.45) return false;
    const t = Math.atan2(z - CENTER.z, x - CENTER.x);
    const spitT = Math.atan2(-4.6 - CENTER.z, -15.5 - CENTER.x);
    let dt = Math.abs(t - spitT);
    if (dt > Math.PI) dt = Math.PI * 2 - dt;
    if (dt < 0.22 && land.mainS(x, z) > 0.7) return r() < 0.15;
    return true;
  };

  const tiltOf = (): number => (r() - 0.5) * 0.3;

  const tuft = (x: number, z: number, k = 1): void => {
    if (!okAt(x, z)) return;
    const d = Math.hypot(x - SEAT.x, z - SEAT.z);
    const c = clump(x * 0.9, z * 0.9);
    // clumps are taller and a shade deeper; open ground between them is short and sunlit
    const tall = 0.75 + c * 0.75;
    const tint = groundTint(land, x, z, new Color()).offsetHSL((patchy(x * 0.25, z * 0.25) - 0.5) * 0.05 + (r() - 0.5) * 0.02, (r() - 0.5) * 0.08, (r() - 0.5) * 0.04);
    const kind = d < NEAR ? 'grass' : d < MID ? 'grass-mid' : 'grass-far';
    byName(kind).list.push({ x, z, s: (0.8 + r() * 0.45) * tall * k * (1 + Math.min(1, d / 16) * 0.35), rot: r() * TAU, tilt: tiltOf() * 0.6, tint });
  };

  const flower = (sp: (typeof SPECIES)[number], x: number, z: number, main?: string): void => {
    if (!okAt(x, z)) return;
    const hex = main && r() < 0.75 ? main : sp.colours[Math.floor(r() * sp.colours.length)];
    const tint = new Color(hex).offsetHSL((r() - 0.5) * 0.03, (r() - 0.5) * 0.1, (r() - 0.5) * 0.08);
    byName(sp.name).list.push({ x, z, s: 0.75 + r() * 0.55, rot: r() * TAU, tilt: tiltOf(), tint });
  };

  const scatter = (cx: number, cz: number, R: (t: number) => number, area: number, main: boolean): void => {
    // grass: a thin even layer, more where the clump noise is high, densest round the seat
    const tries = Math.round(area * 4.2);
    for (let i = 0; i < tries; i++) {
      const t = r() * TAU;
      const s = Math.sqrt(r());
      const x = cx + Math.cos(t) * R(t) * s;
      const z = cz + Math.sin(t) * R(t) * s;
      const d = Math.hypot(x - SEAT.x, z - SEAT.z);
      const near = d < NEAR ? 1 : d < MID ? 0.32 : 0.16;
      const c = clump(x * 0.9, z * 0.9);
      if (r() > near * (0.35 + c * 0.9)) continue;
      tuft(x, z);
    }
    if (main) {
      // the lawn round the seat: clumps of tufts with sunlit gaps between them
      for (let i = 0; i < 190; i++) {
        const a = -Math.PI * 0.95 + r() * Math.PI * 0.9;
        const d = 2.0 + Math.sqrt(r()) * (NEAR - 1.8);
        const ccx = SEAT.x + Math.cos(a) * d * 1.15;
        const ccz = SEAT.z + Math.sin(a) * d;
        const n = 3 + Math.floor(r() * 5);
        for (let k = 0; k < n; k++) {
          const aa = r() * TAU;
          const dd = Math.sqrt(r()) * (0.18 + r() * 0.35);
          tuft(ccx + Math.cos(aa) * dd, ccz + Math.sin(aa) * dd, 1 - dd * 0.5);
        }
      }
    }
    // flower patches: each one species, a main colour with strays
    const patches = Math.round(area / 9);
    for (let p = 0; p < patches; p++) {
      const t = r() * TAU;
      const s = Math.sqrt(r()) * 0.94;
      const nearSeat = main && p % 3 === 0;
      const px = nearSeat ? SEAT.x + (r() - 0.5) * 13 : cx + Math.cos(t) * R(t) * s;
      const pz = nearSeat ? SEAT.z - 2.4 - r() * 7 : cz + Math.sin(t) * R(t) * s;
      const sp = SPECIES[Math.floor(r() * SPECIES.length)];
      const mainC = sp.colours[Math.floor(r() * sp.colours.length)];
      const d = Math.hypot(px - SEAT.x, pz - SEAT.z);
      const n = Math.round((5 + r() * 9) * (d < MID ? 1 : 0.6));
      for (let k = 0; k < n; k++) {
        const a = r() * TAU;
        const dd = Math.sqrt(r()) * (0.6 + r() * 0.6);
        flower(sp, px + Math.cos(a) * dd, pz + Math.sin(a) * dd, mainC);
      }
      // clover round the patch
      if (r() < 0.5) {
        const cl = byName('clover');
        for (let k = 0; k < 5; k++) {
          const a = r() * TAU;
          const x = px + Math.cos(a) * (0.8 + r() * 0.8);
          const z = pz + Math.sin(a) * (0.8 + r() * 0.8);
          if (k < 3 && okAt(x, z)) cl.list.push({ x, z, s: 1.2 + r() * 0.8, rot: r() * TAU, tilt: 0, tint: new Color().setHSL(0.25, 0.3, 0.85 + r() * 0.12) });
        }
      }
    }
    // single flowers mixed through the grass, more of them near the seat
    const singles = Math.round(area * 0.22);
    for (let i = 0; i < singles; i++) {
      const t = r() * TAU;
      const s = Math.sqrt(r());
      let x = cx + Math.cos(t) * R(t) * s;
      let z = cz + Math.sin(t) * R(t) * s;
      if (main && i % 2 === 0) {
        x = SEAT.x + (r() - 0.5) * 12;
        z = SEAT.z - 1.8 - r() * 6;
      }
      flower(SPECIES[Math.floor(r() * SPECIES.length)], x, z);
    }
    // ferns at the foot of trees and by the pond
    const ferns = byName('ferns');
    for (const o of land.obstacles) {
      if (o.clearable || r() < 0.3) continue;
      if (Math.hypot(o.x - cx, o.z - cz) > R(Math.atan2(o.z - cz, o.x - cx)) + 1) continue;
      for (let k = 0; k < 2; k++) {
        const a = r() * TAU;
        const x = o.x + Math.cos(a) * (o.r * 0.7 + 0.3);
        const z = o.z + Math.sin(a) * (o.r * 0.7 + 0.3);
        if (okAt(x, z)) ferns.list.push({ x, z, s: 0.8 + r() * 0.7, rot: r() * TAU, tilt: tiltOf(), tint: new Color().setHSL(0.24, 0.3, 0.85 + r() * 0.12) });
      }
    }
    if (main)
      for (let k = 0; k < 10; k++) {
        const a = r() * TAU;
        const x = POND.x + Math.cos(a) * (POND.r + 0.7);
        const z = POND.z + Math.sin(a) * (POND.r + 0.7);
        if (okAt(x, z)) ferns.list.push({ x, z, s: 0.7 + r() * 0.5, rot: r() * TAU, tilt: tiltOf(), tint: new Color().setHSL(0.24, 0.3, 0.9) });
      }
  };
  scatter(CENTER.x, CENTER.z, outlineR, Math.PI * 13.4 * 13.4, true);

  const hidden = new Set<Placed>();
  const m = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const p = new Vector3();
  const sv = new Vector3();
  const write = (k: Kind): void => {
    if (!k.mesh) return;
    const mesh = k.mesh;
    k.list.forEach((it, i) => {
      const s = hidden.has(it) ? 0 : it.s;
      p.set(it.x, land.height(it.x, it.z) - 0.015, it.z);
      q.setFromEuler(e.set(it.tilt, it.rot, it.tilt * 0.7, 'YXZ'));
      sv.set(s, s, s);
      mesh.setMatrixAt(i, m.compose(p, q, sv));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  };
  const rebuild = (): void => {
    for (const k of kinds) {
      if (k.mesh) {
        root.remove(k.mesh);
        k.mesh.dispose();
      }
      const mesh = new InstancedMesh(k.geo, foliageMaterial(k.flowers), Math.max(1, k.list.length));
      mesh.count = k.list.length;
      mesh.name = `world:${k.name}`;
      k.list.forEach((it, i) => mesh.setColorAt(i, it.tint));
      k.mesh = mesh;
      write(k);
      mesh.raycast = () => {};
      root.add(mesh);
    }
  };
  rebuild();

  const hideWhere = (test: (it: Placed) => boolean): void => {
    for (const k of kinds) {
      let changed = false;
      for (const it of k.list)
        if (!hidden.has(it) && test(it)) {
          hidden.add(it);
          changed = true;
        }
      if (changed) write(k);
    }
  };

  return {
    root,
    clear(x, z, rad) {
      hideWhere((it) => Math.hypot(it.x - x, it.z - z) < rad);
    },
    clearAlong(points, rad) {
      hideWhere((it) => {
        for (let i = 1; i < points.length; i++) if (segDist(it.x, it.z, points[i - 1], points[i]) < rad) return true;
        return false;
      });
    },
    refresh() {
      for (const k of kinds) write(k);
    },
    addIslet(i) {
      scatter(i.cx, i.cz, (t) => isletR(i, t), Math.PI * i.r * i.r, false);
      rebuild();
    },
    triangles: () => kinds.reduce((a, k) => a + k.tris * k.list.length, 0),
  };
}
