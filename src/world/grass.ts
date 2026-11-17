/**
 * Instanced grass tufts and wild flowers over the island, swaying in the wind (one draw
 * call each). Tufts under a new house or path are hidden by scaling them to zero.
 */
import { BufferAttribute, BufferGeometry, Color, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { rng } from './geo';
import { CENTER, Land, PIER, POND, SEAT, STREAM, outlineR, segDist, type Islet, isletR } from './land';
import { foliageMaterial } from './materials';

function tuftGeometry(): BufferGeometry {
  // five blades, one triangle each, leaning outward
  const pos: number[] = [];
  const col: number[] = [];
  const root = new Color('#4f8a35');
  const tip = new Color('#b7d36a');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + (i % 2) * 0.4;
    const h = 0.2 + (i % 3) * 0.06;
    const w = 0.045;
    const lean = 0.07 + (i % 2) * 0.04;
    const cx = Math.cos(a) * 0.04;
    const cz = Math.sin(a) * 0.04;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    col.push(root.r, root.g, root.b, 0, root.r, root.g, root.b, 0, tip.r, tip.g, tip.b, 1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  return g;
}

function flowerGeometry(): BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const stem = new Color('#4f8a35');
  const white = new Color('#ffffff');
  const centre = new Color('#f4c542');
  const tri = (a: number[], b: number[], c: number[], ca: Color, cb: Color, cc: Color, sa: number, sb: number, sc: number): void => {
    pos.push(...a, ...b, ...c);
    col.push(ca.r, ca.g, ca.b, sa, cb.r, cb.g, cb.b, sb, cc.r, cc.g, cc.b, sc);
  };
  const h = 0.28;
  tri([-0.012, 0, 0], [0.012, 0, 0], [0, h, 0], stem, stem, stem, 0, 0, 1);
  tri([0, 0, -0.012], [0, 0, 0.012], [0.02, h * 0.9, 0], stem, stem, stem, 0, 0, 1);
  // four petals (tinted per instance; white here so instance colour shows true)
  const r = 0.06;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const b = a + Math.PI / 4;
    const c = a - Math.PI / 4;
    tri([0, h, 0], [Math.cos(b) * r, h + 0.01, Math.sin(b) * r], [Math.cos(c) * r, h + 0.01, Math.sin(c) * r], white, white, white, 1, 1, 1);
  }
  tri([-0.02, h + 0.02, 0], [0.02, h + 0.02, 0], [0, h + 0.025, 0.025], centre, centre, centre, 1, 1, 1);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  return g;
}

interface Placed { x: number; z: number; s: number; rot: number; tint: Color }

export interface Meadow {
  root: Object3D;
  /** Hides tufts and flowers within r of (x, z). */
  clear(x: number, z: number, r: number): void;
  clearAlong(points: { x: number; z: number }[], r: number): void;
  /** Re-seats tufts on the ground after it changed. */
  refresh(): void;
  addIslet(i: Islet): void;
  triangles(): number;
}

const FLOWER_COLOURS = ['#ffffff', '#f7d046', '#f2828f', '#9fc8f0', '#f39b5a', '#e86a9a'];

export function createMeadow(parent: Object3D, land: Land): Meadow {
  const root = new Object3D();
  root.name = 'world:meadow';
  parent.add(root);
  const r = rng(808);
  const tufts: Placed[] = [];
  const flowers: Placed[] = [];
  const okAt = (x: number, z: number): boolean => {
    if (!land.inside(x, z, 0.35)) return false;
    if (Math.abs(x - SEAT.x) < 1.95 && z > SEAT.z - 1.5 && z < SEAT.z + 1.6) return false;
    if (segDist(x, z, PIER.base, PIER.end) < PIER.width / 2 + 0.2) return false;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.5) return false;
    if (segDist(x, z, STREAM[0], STREAM[1]) < 0.6) return false;
    const t = Math.atan2(z - CENTER.z, x - CENTER.x);
    const spitT = Math.atan2(-4.6 - CENTER.z, -15.5 - CENTER.x);
    let dt = Math.abs(t - spitT);
    if (dt > Math.PI) dt = Math.PI * 2 - dt;
    if (dt < 0.22 && land.mainS(x, z) > 0.7) return r() < 0.15;
    return true;
  };
  const scatter = (cx: number, cz: number, R: (t: number) => number, nT: number, nF: number): void => {
    for (let i = 0; i < nT; i++) {
      const t = r() * Math.PI * 2;
      const s = Math.sqrt(r());
      const x = cx + Math.cos(t) * R(t) * s;
      const z = cz + Math.sin(t) * R(t) * s;
      if (!okAt(x, z)) continue;
      const tint = new Color().setHSL(0.24 + (r() - 0.5) * 0.06, 0.45 + r() * 0.2, 0.42 + r() * 0.16);
      tufts.push({ x, z, s: 0.75 + r() * 0.7, rot: r() * Math.PI * 2, tint });
    }
    // flowers come in patches
    const patches = Math.max(4, Math.round(nF / 14));
    for (let p = 0; p < patches; p++) {
      const t = r() * Math.PI * 2;
      const s = Math.sqrt(r()) * 0.92;
      const px = cx + Math.cos(t) * R(t) * s;
      const pz = cz + Math.sin(t) * R(t) * s;
      const colour = FLOWER_COLOURS[Math.floor(r() * FLOWER_COLOURS.length)];
      for (let k = 0; k < 14; k++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * 1.3;
        const x = px + Math.cos(a) * d;
        const z = pz + Math.sin(a) * d;
        if (!okAt(x, z)) continue;
        const tint = new Color(r() < 0.8 ? colour : FLOWER_COLOURS[Math.floor(r() * FLOWER_COLOURS.length)]);
        flowers.push({ x, z, s: 0.8 + r() * 0.6, rot: r() * Math.PI * 2, tint });
      }
    }
  };
  scatter(CENTER.x, CENTER.z, outlineR, 3400, 520);

  const tuftGeo = tuftGeometry();
  const flowerGeo = flowerGeometry();
  let tuftMesh: InstancedMesh | null = null;
  let flowerMesh: InstancedMesh | null = null;
  const hidden = new Set<Placed>();
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const p = new Vector3();
  const sv = new Vector3();

  const write = (mesh: InstancedMesh, list: Placed[]): void => {
    list.forEach((it, i) => {
      const s = hidden.has(it) ? 0 : it.s;
      p.set(it.x, land.height(it.x, it.z) - 0.02, it.z);
      q.setFromAxisAngle(up, it.rot);
      sv.set(s, s, s);
      mesh.setMatrixAt(i, m.compose(p, q, sv));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  const rebuild = (): void => {
    for (const mesh of [tuftMesh, flowerMesh]) if (mesh) {
      root.remove(mesh);
      mesh.dispose();
    }
    tuftMesh = new InstancedMesh(tuftGeo, foliageMaterial(), tufts.length);
    tuftMesh.name = 'world:grass';
    flowerMesh = new InstancedMesh(flowerGeo, foliageMaterial(), flowers.length);
    flowerMesh.name = 'world:flowers';
    for (const [mesh, list] of [[tuftMesh, tufts], [flowerMesh, flowers]] as [InstancedMesh, Placed[]][]) {
      list.forEach((it, i) => mesh.setColorAt(i, it.tint));
      write(mesh, list);
      mesh.raycast = () => {};
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
  };
  rebuild();

  return {
    root,
    clear(x, z, rad) {
      let changed = false;
      for (const it of [...tufts, ...flowers]) if (!hidden.has(it) && Math.hypot(it.x - x, it.z - z) < rad) {
        hidden.add(it);
        changed = true;
      }
      if (changed && tuftMesh && flowerMesh) {
        write(tuftMesh, tufts);
        write(flowerMesh, flowers);
      }
    },
    clearAlong(points, rad) {
      let changed = false;
      for (const it of [...tufts, ...flowers]) {
        if (hidden.has(it)) continue;
        for (let i = 1; i < points.length; i++) if (segDist(it.x, it.z, points[i - 1], points[i]) < rad) {
          hidden.add(it);
          changed = true;
          break;
        }
      }
      if (changed && tuftMesh && flowerMesh) {
        write(tuftMesh, tufts);
        write(flowerMesh, flowers);
      }
    },
    refresh() {
      if (tuftMesh && flowerMesh) {
        write(tuftMesh, tufts);
        write(flowerMesh, flowers);
      }
    },
    addIslet(i) {
      scatter(i.cx, i.cz, (t) => isletR(i, t), 520, 90);
      rebuild();
    },
    triangles: () => tufts.length * 6 + flowers.length * 7,
  };
}
