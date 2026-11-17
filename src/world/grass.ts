/**
 * The meadow: instanced grass, several kinds of wild flowers growing in clusters, clover
 * and ferns, all swaying on the GPU with the island wind (one draw call per kind). Grass
 * is thick round the seat and thins out with distance. Anything under a new house or path
 * is hidden by scaling it to zero.
 */
import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { rng } from './geo';
import { CENTER, Land, PIER, POND, SEAT, STREAM, outlineR, segDist, type Islet, isletR } from './land';
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

function tuftGeometry(blades = 7): BufferGeometry {
  const g = new Geo();
  const root = new Color('#63a043');
  const tip = new Color('#c6df78');
  const r = rng(3);
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + r() * 0.5;
    const h = 0.11 + r() * 0.12;
    const w = 0.014 + r() * 0.008;
    const lean = 0.03 + r() * 0.06;
    const cx = Math.cos(a) * 0.035 * r();
    const cz = Math.sin(a) * 0.035 * r();
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    const mx = cx + Math.cos(a) * lean * 0.4;
    const mz = cz + Math.sin(a) * lean * 0.4;
    const mid = root.clone().lerp(tip, 0.55);
    // two segments so the blade curves
    g.quad([cx - px, 0, cz - pz], [cx + px, 0, cz + pz], [mx + px * 0.6, h * 0.55, mz + pz * 0.6], [mx - px * 0.6, h * 0.55, mz - pz * 0.6], root, mid, 0, 0.4);
    g.tri([mx - px * 0.6, h * 0.55, mz - pz * 0.6], [mx + px * 0.6, h * 0.55, mz + pz * 0.6], [cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean], mid, mid, tip, 0.4, 0.4, 1);
  }
  return g.done();
}

function stem(g: Geo, h: number, bend = 0.03): void {
  g.tri([-0.008, 0, 0], [0.008, 0, 0], [bend, h, 0], STEM, STEM, STEM, 0, 0, 1);
  g.tri([0, 0, -0.008], [0, 0, 0.008], [bend, h, 0.004], STEM, STEM, STEM, 0, 0, 1);
  // two small leaves
  g.tri([0, h * 0.25, 0], [0.07, h * 0.35, 0.02], [0.02, h * 0.42, 0], STEM, STEM, STEM, 0.2, 0.4, 0.4);
  g.tri([0, h * 0.35, 0], [-0.06, h * 0.47, -0.02], [-0.01, h * 0.5, 0], STEM, STEM, STEM, 0.3, 0.5, 0.5);
}

/** Daisy: a flat ring of petals round a yellow eye. */
function daisy(): BufferGeometry {
  const g = new Geo();
  const h = 0.24;
  stem(g, h);
  const eye = new Color('#f4c542');
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = a + 0.16;
    const c = a - 0.16;
    const r = 0.055;
    g.tri([0.03, h, 0], [0.03 + Math.cos(b) * r, h + 0.008, Math.sin(b) * r], [0.03 + Math.cos(c) * r, h + 0.008, Math.sin(c) * r], WHITE, WHITE, WHITE, 1, 1, 1);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.tri([0.03, h + 0.016, 0], [0.03 + Math.cos(a) * 0.018, h + 0.01, Math.sin(a) * 0.018], [0.03 + Math.cos(a + 1.26) * 0.018, h + 0.01, Math.sin(a + 1.26) * 0.018], eye, eye, eye, 1, 1, 1);
  }
  return g.done();
}

/** Tulip: a cup of three upright petals. */
function tulip(): BufferGeometry {
  const g = new Geo();
  const h = 0.3;
  stem(g, h, 0.0);
  const dark = new Color('#d8d8d8');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
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
      const a = (k / 5) * Math.PI * 2;
      const b = a + (Math.PI * 2) / 5;
      g.tri([x, y, 0], [x + Math.cos(a) * r, y - 0.035, Math.sin(a) * r], [x + Math.cos(b) * r, y - 0.035, Math.sin(b) * r], WHITE, WHITE, WHITE, 1, 1, 1);
    }
  }
  return g.done();
}

/** Puffball (dandelion clock): a round white head. */
function puff(): BufferGeometry {
  const g = new Geo();
  const h = 0.28;
  stem(g, h, 0.02);
  const r = 0.04;
  const c = [0.02, h + r, 0];
  const pts: number[][] = [];
  for (let k = 0; k < 12; k++) {
    const y = 1 - (k / 11) * 2;
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

interface Placed { x: number; z: number; s: number; rot: number; tint: Color }

interface Kind {
  name: string;
  geo: BufferGeometry;
  list: Placed[];
  mesh: InstancedMesh | null;
  tris: number;
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
];

export function createMeadow(parent: Object3D, land: Land): Meadow {
  const root = new Object3D();
  root.name = 'world:meadow';
  parent.add(root);
  const r = rng(808);
  const kinds: Kind[] = [
    { name: 'grass', geo: tuftGeometry(7), list: [], mesh: null, tris: 0 },
    { name: 'grass-far', geo: tuftGeometry(4), list: [], mesh: null, tris: 0 },
    ...SPECIES.map((s) => ({ name: s.name, geo: s.geo(), list: [] as Placed[], mesh: null, tris: 0 })),
    { name: 'clover', geo: clover(), list: [], mesh: null, tris: 0 },
    { name: 'ferns', geo: fern(), list: [], mesh: null, tris: 0 },
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

  const scatter = (cx: number, cz: number, R: (t: number) => number, nTufts: number, nPatches: number): void => {
    const grass = byName('grass');
    const far = byName('grass-far');
    const tuft = (x: number, z: number): void => {
      // thick near the seat, thinning with distance; far tufts have fewer blades
      const d = Math.hypot(x - SEAT.x, z - SEAT.z);
      if (r() > 0.28 + 0.72 * Math.exp(-d / 6)) return;
      if (!okAt(x, z)) return;
      // a light tint over the blade colours: hue drifts, brightness varies a little
      const tint = new Color().setHSL(0.2 + (r() - 0.5) * 0.12, 0.3 + r() * 0.25, 0.82 + r() * 0.16);
      (d < 11 ? grass : far).list.push({ x, z, s: (0.8 + r() * 0.7) * (1 + Math.min(1, d / 14) * 0.6), rot: r() * Math.PI * 2, tint });
    };
    for (let i = 0; i < nTufts; i++) {
      const t = r() * Math.PI * 2;
      const s = Math.sqrt(r());
      tuft(cx + Math.cos(t) * R(t) * s, cz + Math.sin(t) * R(t) * s);
    }
    // the lawn round the seat
    if (cx === CENTER.x)
      for (let i = 0; i < nTufts * 0.6; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * 6.5;
        tuft(SEAT.x + Math.cos(a) * d * 1.3, SEAT.z - 3.2 + Math.sin(a) * d);
      }
    for (let p = 0; p < nPatches; p++) {
      const t = r() * Math.PI * 2;
      const s = Math.sqrt(r()) * 0.94;
      const nearSeat = cx === CENTER.x && p % 3 === 0;
      const px = nearSeat ? SEAT.x + (r() - 0.5) * 12 : cx + Math.cos(t) * R(t) * s;
      const pz = nearSeat ? SEAT.z - 2.5 - r() * 6 : cz + Math.sin(t) * R(t) * s;
      const sp = SPECIES[p % SPECIES.length];
      const kind = byName(sp.name);
      const main = sp.colours[Math.floor(r() * sp.colours.length)];
      const n = 7 + Math.floor(r() * 9);
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2;
        const dd = Math.sqrt(r()) * 1.0;
        const x = px + Math.cos(a) * dd;
        const z = pz + Math.sin(a) * dd;
        if (!okAt(x, z)) continue;
        const tint = new Color(r() < 0.8 ? main : sp.colours[Math.floor(r() * sp.colours.length)]);
        kind.list.push({ x, z, s: 0.8 + r() * 0.5, rot: r() * Math.PI * 2, tint });
      }
      // clover round the patch
      if (r() < 0.6) {
        const cl = byName('clover');
        for (let k = 0; k < 6; k++) {
          const a = r() * Math.PI * 2;
          const x = px + Math.cos(a) * (0.8 + r() * 0.8);
          const z = pz + Math.sin(a) * (0.8 + r() * 0.8);
          if (okAt(x, z)) cl.list.push({ x, z, s: 1.2 + r() * 0.8, rot: r() * 6.28, tint: new Color().setHSL(0.25, 0.3, 0.85 + r() * 0.12) });
        }
      }
    }
    // ferns at the foot of trees and by the pond
    const ferns = byName('ferns');
    for (const o of land.obstacles) {
      if (o.clearable || r() < 0.3) continue;
      for (let k = 0; k < 2; k++) {
        const a = r() * Math.PI * 2;
        const x = o.x + Math.cos(a) * (o.r * 0.7 + 0.3);
        const z = o.z + Math.sin(a) * (o.r * 0.7 + 0.3);
        if (okAt(x, z)) ferns.list.push({ x, z, s: 0.8 + r() * 0.7, rot: r() * 6.28, tint: new Color().setHSL(0.24, 0.3, 0.85 + r() * 0.12) });
      }
    }
    for (let k = 0; k < 8; k++) {
      const a = r() * Math.PI * 2;
      const x = POND.x + Math.cos(a) * (POND.r + 0.7);
      const z = POND.z + Math.sin(a) * (POND.r + 0.7);
      if (okAt(x, z)) ferns.list.push({ x, z, s: 0.7 + r() * 0.5, rot: r() * 6.28, tint: new Color().setHSL(0.24, 0.3, 0.9) });
    }
  };
  scatter(CENTER.x, CENTER.z, outlineR, 4200, 60);

  const hidden = new Set<Placed>();
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const sv = new Vector3();
  const write = (k: Kind): void => {
    if (!k.mesh) return;
    const mesh = k.mesh;
    k.list.forEach((it, i) => {
      const s = hidden.has(it) ? 0 : it.s;
      p.set(it.x, land.height(it.x, it.z) - 0.015, it.z);
      q.setFromAxisAngle(up, it.rot);
      sv.set(s, s, s);
      mesh.setMatrixAt(i, m.compose(p, q, sv));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  const rebuild = (): void => {
    for (const k of kinds) {
      if (k.mesh) {
        root.remove(k.mesh);
        k.mesh.dispose();
      }
      const mesh = new InstancedMesh(k.geo, foliageMaterial(), Math.max(1, k.list.length));
      mesh.count = k.list.length;
      mesh.name = `world:${k.name}`;
      k.list.forEach((it, i) => mesh.setColorAt(i, it.tint));
      k.mesh = mesh;
      write(k);
      mesh.raycast = () => {};
      mesh.computeBoundingSphere();
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
      scatter(i.cx, i.cz, (t) => isletR(i, t), 900, 5);
      rebuild();
    },
    triangles: () => kinds.reduce((a, k) => a + k.tris * k.list.length, 0),
  };
}
