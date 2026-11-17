// Small geometry kit for characters and vehicles. Every function returns a fresh geometry
// in its own local space; rig.part() places it on a bone. withDetail() scales every
// segment count, so one builder makes a close-up model and a lighter far one.
import {
  BufferGeometry,
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  LatheGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from '@iwsdk/core';

let DETAIL = 1;
/** Build with segment counts scaled by d (1 = authored counts). */
export function withDetail<T>(d: number, build: () => T): T {
  const prev = DETAIL;
  DETAIL = d;
  try {
    return build();
  } finally {
    DETAIL = prev;
  }
}
const sg = (n: number, min = 3): number => Math.max(min, Math.round(n * DETAIL));

/** Ellipsoid centred at the origin. */
export function ellipsoid(rx: number, ry: number, rz: number, ws = 16, hs = 12): BufferGeometry {
  const g = new SphereGeometry(1, sg(ws, 6), sg(hs, 4));
  g.scale(rx, ry, rz);
  return g;
}

export function sphere(r: number, ws = 14, hs = 10): BufferGeometry {
  return new SphereGeometry(r, sg(ws, 6), sg(hs, 4));
}

/**
 * Egg: an ellipsoid wider at the bottom (egg > 0) and optionally flattened at the base,
 * the main mass of a round character.
 */
export function egg(rx: number, ry: number, rz: number, eggness = 0.25, ws = 18, hs = 14): BufferGeometry {
  const g = new SphereGeometry(1, sg(ws, 6), sg(hs, 4));
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 - eggness * y * 0.5;
    p.setXYZ(i, p.getX(i) * rx * k, y * ry, p.getZ(i) * rz * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Cone with its base on y=0, pointing up +y. */
export function cone(r: number, h: number, seg = 10): BufferGeometry {
  const g = new ConeGeometry(r, h, sg(seg, 4), 1);
  g.translate(0, h / 2, 0);
  return g;
}

/** Soft cone: a lathe that bulges a little, rounded tip, base on y=0. */
export function softCone(r: number, h: number, seg = 10, bulge = 0.25): BufferGeometry {
  const pts: Vector2[] = [];
  const n = sg(8, 4);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rr = r * (1 - t) * (1 + bulge * Math.sin(Math.PI * t));
    pts.push(new Vector2(Math.max(rr, 0.0001), h * t));
  }
  pts.unshift(new Vector2(0.0001, 0));
  return new LatheGeometry(pts, sg(seg, 4));
}

/** Capsule hanging down from the origin to y = -(len + 2r). */
export function limb(r: number, len: number, radial = 10): BufferGeometry {
  const g = new CapsuleGeometry(r, len, sg(4, 2), sg(radial, 5));
  g.translate(0, -(len / 2 + r), 0);
  return g;
}

/** Capsule centred at origin along y. */
export function capsule(r: number, len: number, radial = 10, cap = 3): BufferGeometry {
  return new CapsuleGeometry(r, len, sg(cap, 2), sg(radial, 5));
}

export function cylinder(rTop: number, rBottom: number, h: number, seg = 12, open = false): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, h, sg(seg, 3), 1, open);
  return g;
}

export function torus(r: number, tube: number, rs = 6, ts = 18, arc = Math.PI * 2): BufferGeometry {
  return new TorusGeometry(r, tube, sg(rs, 3), sg(ts, 6), arc);
}

/** A lathe from (radius, height) pairs, base at y=0. */
export function lathe(profile: [number, number][], seg = 16): BufferGeometry {
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(Math.max(r, 0.0001), y)), sg(seg, 6));
}

/** Teardrop/feather: round end at the origin, tapering along +y. */
export function feather(w: number, len: number, thick: number, seg = 8): BufferGeometry {
  const g = new SphereGeometry(1, sg(seg + 2, 5), sg(10, 5));
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); // -1..1
    const t = (y + 1) / 2; // 0..1
    const taper = Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * (1 - t * 0.55);
    p.setXYZ(i, p.getX(i) * w * taper, t * len, p.getZ(i) * thick * taper);
  }
  g.computeVertexNormals();
  return g;
}

/** Flattened disc (cheeks, eye patches, buttons), facing +z. */
export function disc(r: number, depth = 0.25, seg = 12): BufferGeometry {
  const g = new SphereGeometry(r, sg(seg + 2, 6), sg(6, 4));
  g.scale(1, 1, depth);
  return g;
}
