/**
 * The shape of the land, as pure functions: the island outline, ground height, the places
 * that must stay free (porch, pier, pond, waterfall, big trees, houses) and the checks for
 * a new house. No Three.js scene here, so placement is unit-tested in Node.
 *
 * Frame: the person sits at the origin facing −z. The main island spreads in front of them
 * (centre about 10 m ahead), the pier sticks out on the right, the sand spit on the left,
 * the pond and the waterfall front-left, a wooded hill at the back left. Islets join with
 * bridges as the island grows.
 */
import type { P2 } from '../mind/types';

export const SEAT: P2 = { x: 0, z: 0 };
export const CENTER: P2 = { x: -0.5, z: -12 };
export const POND = { x: -8.3, z: -13.6, r: 1.9 };
export const HILL = { x: -6.0, z: -21.8, h: 2.2, s: 3.9 };

const TAU = Math.PI * 2;
const angDiff = (a: number, b: number): number => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const smooth = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
const angleOf = (x: number, z: number): number => Math.atan2(z - CENTER.z, x - CENTER.x);

function baseR(t: number): number {
  return 13.4 + 1.0 * Math.sin(2 * t + 0.6) + 0.6 * Math.sin(3 * t + 2.1) + 0.35 * Math.sin(5 * t + 0.3) + 0.18 * Math.sin(9 * t + 1.1);
}
const THETA_SEAT = angleOf(SEAT.x, SEAT.z);
const THETA_SPIT = angleOf(-15.5, -4.6);
const THETA_PIER = angleOf(11.6, -13.4);
const THETA_FALL = angleOf(POND.x - 1, POND.z - 0.6);
const SEAT_R = Math.hypot(SEAT.x - CENTER.x, SEAT.z - CENTER.z) + 1.7;
const BUMPS: [number, number, number][] = [
  // angle, width, amount
  [THETA_SEAT, 0.32, SEAT_R - baseR(THETA_SEAT)],
  [THETA_SPIT, 0.12, 3.6],
  [THETA_PIER, 0.16, -0.7],
  [THETA_FALL, 0.08, -0.45],
];

/** Radius of the main island's outline at polar angle t around CENTER. */
export function outlineR(t: number): number {
  let r = baseR(t);
  for (const [a, w, amt] of BUMPS) {
    const d = angDiff(t, a) / w;
    r += amt * Math.exp(-d * d);
  }
  return r;
}

export function outlinePoint(t: number, inset = 0): P2 {
  const r = outlineR(t) - inset;
  return { x: CENTER.x + Math.cos(t) * r, z: CENTER.z + Math.sin(t) * r };
}

/** Where the stream leaves the pond and where it falls off the edge. */
export const STREAM: [P2, P2] = (() => {
  const end = outlinePoint(THETA_FALL, 0.35);
  const dx = end.x - POND.x;
  const dz = end.z - POND.z;
  const l = Math.hypot(dx, dz);
  return [{ x: POND.x + (dx / l) * (POND.r - 0.2), z: POND.z + (dz / l) * (POND.r - 0.2) }, end];
})();

/** The pier: from the island edge on the right, out over the clouds. */
export const PIER = (() => {
  const base = outlinePoint(THETA_PIER, 0.9);
  const dir = { x: Math.cos(THETA_PIER + 0.15), z: Math.sin(THETA_PIER + 0.15) };
  const length = 7.5;
  return {
    base,
    dir,
    length,
    end: { x: base.x + dir.x * length, z: base.z + dir.z * length },
    width: 1.7,
  };
})();

export interface Islet {
  id: string;
  cx: number;
  cz: number;
  r: number;
  seed: number;
  /** Bridge from the main island edge to the islet edge. */
  from: P2;
  to: P2;
}

function makeIslet(id: string, cx: number, cz: number, r: number, seed: number): Islet {
  const t = angleOf(cx, cz);
  const from = outlinePoint(t, 0.8);
  const back = Math.atan2(CENTER.z - cz, CENTER.x - cx);
  const to = { x: cx + Math.cos(back) * (r - 0.8), z: cz + Math.sin(back) * (r - 0.8) };
  return { id, cx, cz, r, seed, from, to };
}

/** Islets in the order the island grows. */
export const ISLETS: Islet[] = [
  makeIslet('west', -21.5, -14.5, 5.4, 11),
  makeIslet('north', -2.5, -32.0, 5.8, 23),
  makeIslet('east', 17.0, -25.0, 5.2, 37),
];

export function isletR(i: Islet, t: number): number {
  return i.r * (1 + 0.07 * Math.sin(3 * t + i.seed) + 0.05 * Math.sin(5 * t + i.seed * 2.3));
}

export interface Zone { x: number; z: number; r: number; h?: number; id?: string; clearable?: boolean }

/**
 * The land at one moment: which islets exist, where houses stand (flattened ground) and
 * what blocks building (trees, props).
 */
export class Land {
  islets: Islet[] = [];
  /** Flattened pads under houses. */
  pads: Zone[] = [];
  /** Things a house cannot stand on: trees, rocks, props. `clearable` ones are removed instead. */
  obstacles: Zone[] = [];
  /** Polylines that houses keep clear of (the main path). */
  keepClear: P2[][] = [];

  grow(): Islet | null {
    const next = ISLETS[this.islets.length];
    if (!next) return null;
    this.islets.push(next);
    return next;
  }

  /** 0..1 position from the centre to the outline of the main island (>1 outside). */
  mainS(x: number, z: number): number {
    const d = Math.hypot(x - CENTER.x, z - CENTER.z);
    return d / outlineR(angleOf(x, z));
  }

  isletAt(x: number, z: number, margin = 0): Islet | null {
    for (const i of this.islets) {
      const d = Math.hypot(x - i.cx, z - i.cz);
      if (d < isletR(i, Math.atan2(z - i.cz, x - i.cx)) - margin) return i;
    }
    return null;
  }

  /** Distance from the point to the nearest edge (positive inside the land). */
  edgeDistance(x: number, z: number): number {
    const t = angleOf(x, z);
    const d = Math.hypot(x - CENTER.x, z - CENTER.z);
    let best = outlineR(t) - d;
    for (const i of this.islets) {
      const di = Math.hypot(x - i.cx, z - i.cz);
      best = Math.max(best, isletR(i, Math.atan2(z - i.cz, x - i.cx)) - di);
    }
    return best;
  }

  inside(x: number, z: number, margin = 0): boolean {
    return this.edgeDistance(x, z) > margin;
  }

  /** Ground height of the main island before pads. */
  static mainHeight(x: number, z: number): number {
    const back = smooth((-z - 3) / 19);
    let h = 1.15 * back;
    const hx = x - HILL.x;
    const hz = z - HILL.z;
    h += HILL.h * Math.exp(-(hx * hx + hz * hz) / (2 * HILL.s * HILL.s));
    h += 0.16 * Math.sin(x * 0.7 + 1.3) * Math.sin(z * 0.55 + 0.4) + 0.07 * Math.sin(x * 1.7 + z * 1.3);
    // pond hollow
    const pd = Math.hypot(x - POND.x, z - POND.z);
    h -= 0.5 * smooth(1 - (pd - POND.r * 0.6) / 1.6);
    // stream bed toward the waterfall
    const sd = segDist(x, z, STREAM[0], STREAM[1]);
    h -= 0.25 * smooth(1 - sd / 0.9);
    // sand spit slopes down to the clouds
    const t = angleOf(x, z);
    const spit = Math.exp(-((angDiff(t, THETA_SPIT) / 0.22) ** 2));
    const s = Math.hypot(x - CENTER.x, z - CENTER.z) / outlineR(t);
    h = h * (1 - spit * smooth((s - 0.55) / 0.4)) - 0.28 * spit * smooth((s - 0.7) / 0.3);
    // soft lip at the edge
    h -= 0.45 * smooth((s - 0.9) / 0.1);
    // porch is level
    const sdist = Math.hypot(x - SEAT.x, z - SEAT.z);
    h *= smooth((sdist - 1.9) / 2.2);
    // pier base is level with the deck
    const pb = Math.hypot(x - PIER.base.x, z - PIER.base.z);
    const pierH = 0.12;
    const k = smooth(1 - (pb - 1.2) / 2.2);
    h = h * (1 - k) + pierH * k;
    return h;
  }

  static isletHeight(i: Islet, x: number, z: number): number {
    const d = Math.hypot(x - i.cx, z - i.cz);
    const s = d / isletR(i, Math.atan2(z - i.cz, x - i.cx));
    let h = 0.25 + 0.12 * Math.sin(x * 0.9 + i.seed) * Math.sin(z * 0.8 + i.seed * 0.5) + 0.35 * (1 - s * s);
    h -= 0.45 * smooth((s - 0.85) / 0.15);
    return h;
  }

  /** Ground height in metres at (x, z), with house pads flattened. */
  height(x: number, z: number): number {
    let h: number;
    const s = this.mainS(x, z);
    if (s <= 1.02 || this.islets.length === 0) h = Land.mainHeight(x, z);
    else {
      let best: Islet | null = null;
      let bd = Infinity;
      for (const i of this.islets) {
        const d = Math.hypot(x - i.cx, z - i.cz) / i.r;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      h = best && bd < 1.3 ? Land.isletHeight(best, x, z) : Land.mainHeight(x, z);
    }
    for (const p of this.pads) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + 1.4) {
        const k = smooth(1 - (d - p.r) / 1.4);
        h = h * (1 - k) + (p.h ?? h) * k;
      }
    }
    return h;
  }

  /** How steep the ground is around a point (metres of rise over 1.5 m). */
  slope(x: number, z: number): number {
    const r = 1.5;
    let lo = Infinity;
    let hi = -Infinity;
    for (let a = 0; a < 8; a++) {
      const h = this.height(x + Math.cos((a / 8) * TAU) * r, z + Math.sin((a / 8) * TAU) * r);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    return hi - lo;
  }

  /** Why a house of radius r cannot stand at p, or null if it can. */
  blocked(x: number, z: number, r = 2.2, ignore?: string): string | null {
    const ds = Math.hypot(x - SEAT.x, z - SEAT.z);
    if (ds < 5.6) return 'too close to the seat';
    if (ds > 34) return 'too far';
    if (z > -1.5) return 'behind the seat';
    if (!this.inside(x, z, r + 0.15)) return 'off the edge';
    if (segDist(x, z, PIER.base, PIER.end) < r + 1.3) return 'on the pier';
    if (segDist(x, z, { x: 0.6, z: -1.7 }, PIER.base) < r + 0.9) return 'in the way to the pier';
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + r + 0.8) return 'in the pond';
    if (segDist(x, z, STREAM[0], STREAM[1]) < r + 0.6) return 'in the stream';
    const t = angleOf(x, z);
    if (Math.abs(angDiff(t, THETA_SPIT)) < 0.3 && this.mainS(x, z) > 0.6) return 'on the sand';
    for (const p of this.pads) if (p.id !== ignore && Math.hypot(x - p.x, z - p.z) < p.r + r + 0.9) return 'next to a house';
    for (const o of this.obstacles) if (!o.clearable && Math.hypot(x - o.x, z - o.z) < o.r + r * 0.8) return 'a tree is there';
    for (const line of this.keepClear)
      for (let i = 1; i < line.length; i++) if (segDist(x, z, line[i - 1], line[i]) < r + 0.5) return 'on the path';
    for (const i of this.islets) if (segDist(x, z, i.from, i.to) < r + 0.8) return 'on the bridge';
    if (this.slope(x, z) > 1.25) return 'too steep';
    return null;
  }

  /** Nearest spot at or around p where a house of radius r fits, facing the seat. */
  findSpot(x: number, z: number, r = 2.2, ignore?: string): { ok: boolean; x: number; z: number; rotY: number } {
    if (!this.blocked(x, z, r, ignore)) return { ok: true, x, z, rotY: faceSeat(x, z) };
    for (let rad = 0.5; rad <= 12; rad += 0.5) {
      const steps = Math.max(8, Math.round(rad * 6));
      let best: { x: number; z: number; d: number } | null = null;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * TAU;
        const px = x + Math.cos(a) * rad;
        const pz = z + Math.sin(a) * rad;
        if (this.blocked(px, pz, r, ignore)) continue;
        // prefer spots nearer the seat when equally far from the wish
        const d = Math.hypot(px - SEAT.x, pz - SEAT.z) * 0.02;
        if (!best || d < best.d) best = { x: px, z: pz, d };
      }
      if (best) return { ok: true, x: best.x, z: best.z, rotY: faceSeat(best.x, best.z) };
    }
    return { ok: false, x, z, rotY: faceSeat(x, z) };
  }
}

/** Radius a house needs on the ground (walls and the props round them). */
export const HOUSE_R = 2.1;

/** Rotation about y that turns a front facing +z toward the seat. */
export function faceSeat(x: number, z: number): number {
  return Math.atan2(SEAT.x - x, SEAT.z - z);
}

export function segDist(x: number, z: number, a: P2, b: P2): number {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
  return Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
}

/**
 * Good lots for houses, in order of preference: near the seat and in front first, fanning
 * out, then the islets. Picked once from the empty land, at least 5.6 m apart.
 */
export const LOTS: P2[] = (() => {
  const land = new Land();
  const cand: { x: number; z: number; score: number }[] = [];
  for (let x = -16; x <= 16; x += 0.5)
    for (let z = -28; z <= -3; z += 0.5) {
      if (land.blocked(x, z, HOUSE_R)) continue;
      const d = Math.hypot(x - SEAT.x, z - SEAT.z);
      const ang = Math.abs(Math.atan2(x - SEAT.x, -(z - SEAT.z)));
      // keep the middle of the view open near the seat: close houses stand to the sides
      cand.push({ x, z, score: d + ang * 4 + (ang < 0.4 && d < 10.5 ? 12 : 0) });
    }
  cand.sort((a, b) => a.score - b.score);
  const out: P2[] = [];
  for (const c of cand) {
    if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 5.3)) continue;
    // do not hide a house right behind a nearer one
    const ca = Math.atan2(c.x - SEAT.x, -(c.z - SEAT.z));
    const cd = Math.hypot(c.x - SEAT.x, c.z - SEAT.z);
    if (out.some((o) => {
      const oa = Math.atan2(o.x - SEAT.x, -(o.z - SEAT.z));
      const od = Math.hypot(o.x - SEAT.x, o.z - SEAT.z);
      return Math.abs(oa - ca) < 0.13 && cd > od && cd - od < 7;
    })) continue;
    out.push({ x: c.x, z: c.z });
    if (out.length >= 14) break;
  }
  for (const i of ISLETS) out.push({ x: i.cx, z: i.cz });
  return out;
})();
