/**
 * Geometry of the kit, written in TypeScript (no model files). Every geometry leaves
 * here in one shape: indexed, with `position`, `normal` and a vertex `color` (white
 * unless baked), so any of them can join a batch (./batch.ts) or a merge.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  ExtrudeGeometry,
  Matrix4,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  LatheGeometry,
  Vector2,
  CapsuleGeometry,
  Euler,
  type ColorRepresentation,
} from '@iwsdk/core';

const WHITE = new Color(1, 1, 1);

/** Normalises a geometry: indexed, no uv, normals, a vertex colour (white or `color`). */
export function prep(geometry: BufferGeometry, color?: ColorRepresentation): BufferGeometry {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'color') geometry.deleteAttribute(name);
  }
  if (!geometry.index) {
    const n = geometry.attributes.position.count;
    const index = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) index[i] = i;
    geometry.setIndex(new BufferAttribute(index, 1));
  }
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (color !== undefined || !geometry.attributes.color) tint(geometry, color ?? WHITE);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** Paints every vertex one colour. */
export function tint(geometry: BufferGeometry, color: ColorRepresentation): BufferGeometry {
  const c = color instanceof Color ? color : new Color(color);
  const n = geometry.attributes.position.count;
  const data = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new BufferAttribute(data, 3));
  return geometry;
}

/** Paints each vertex by its normal and position (a top face one colour, the sides another). */
export function tintBy(geometry: BufferGeometry, pick: (n: Vector3, p: Vector3) => ColorRepresentation): BufferGeometry {
  const pos = geometry.attributes.position;
  const nor = geometry.attributes.normal;
  const data = new Float32Array(pos.count * 3);
  const n = new Vector3();
  const p = new Vector3();
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i);
    p.fromBufferAttribute(pos, i);
    c.set(pick(n, p));
    data[i * 3] = c.r;
    data[i * 3 + 1] = c.g;
    data[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new BufferAttribute(data, 3));
  return geometry;
}

/** A plan shape with rounded corners, centred, `w` along x and `d` along the shape's y. */
export function roundRect(w: number, d: number, r: number): Shape {
  const x = -w / 2;
  const y = -d / 2;
  const s = new Shape();
  r = Math.max(0, Math.min(r, w / 2 - 1e-5, d / 2 - 1e-5));
  if (r <= 0) {
    s.moveTo(x, y);
    s.lineTo(x + w, y);
    s.lineTo(x + w, y + d);
    s.lineTo(x, y + d);
    s.lineTo(x, y);
    return s;
  }
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * A box with a chamfer `bevel` on every edge and rounded corners `radius` in plan:
 * `w` along x, `h` up, `d` along z, base on y = 0 and centred in x and z.
 */
export function bevelBox(w: number, h: number, d: number, bevel = 0.002, radius = 0, segments = 2): BufferGeometry {
  const b = Math.max(0, Math.min(bevel, w / 4, h / 4, d / 4));
  const shape = roundRect(w - 2 * b, d - 2 * b, Math.max(0, radius - b));
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, h - 2 * b),
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: b > 0 ? 1 : 0,
    curveSegments: radius > b ? segments : 1,
  });
  // Extruded along +z: lay it down so the extrusion goes up and the shape lies in x–z.
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  return prep(g);
}

/** A plain box, base on y = 0. */
export function box(w: number, h: number, d: number): BufferGeometry {
  return bevelBox(w, h, d, 0);
}

/** A cylinder (or cone) standing on y = 0. */
export function cylinder(rTop: number, rBottom: number, h: number, segments = 16, open = false): BufferGeometry {
  const g = new CylinderGeometry(rTop, rBottom, h, segments, 1, open);
  g.translate(0, h / 2, 0);
  return prep(g);
}

/** A lathe of a profile [radius, height] pairs around y. */
export function lathe(profile: [number, number][], segments = 24): BufferGeometry {
  const g = new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), segments);
  return prep(g);
}

export function sphere(r: number, w = 16, h = 10): BufferGeometry {
  return prep(new SphereGeometry(r, w, h));
}

/** A ring lying flat (torus around y). */
export function flatRing(radius: number, tube: number, segments = 24): BufferGeometry {
  const g = new TorusGeometry(radius, tube, 6, segments);
  g.rotateX(Math.PI / 2);
  return prep(g);
}

export function capsule(r: number, length: number, cap = 4, radial = 8): BufferGeometry {
  return prep(new CapsuleGeometry(r, length, cap, radial));
}

/** A flat shape extruded `h` up (base on y = 0). */
export function slab(shape: Shape, h: number, bevel = 0): BufferGeometry {
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, h - 2 * bevel),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    curveSegments: 6,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return prep(g);
}

const m4 = new Matrix4();
const q = new Quaternion();
const s3 = new Vector3();
const eu = new Euler();

/** A copy moved by position, rotation (Euler XYZ radians) and scale. */
export function placed(geometry: BufferGeometry, at: [number, number, number], rot: [number, number, number] = [0, 0, 0], scale: [number, number, number] = [1, 1, 1]): BufferGeometry {
  const g = geometry.clone();
  q.setFromEuler(eu.set(rot[0], rot[1], rot[2]));
  m4.compose(s3.set(at[0], at[1], at[2]), q, new Vector3(scale[0], scale[1], scale[2]));
  g.applyMatrix4(m4);
  return g;
}

/** Joins prepared geometries into one indexed geometry. */
export function merge(parts: BufferGeometry[]): BufferGeometry {
  let vertices = 0;
  let indices = 0;
  for (const p of parts) {
    vertices += p.attributes.position.count;
    indices += p.index ? p.index.count : p.attributes.position.count;
  }
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const index = new (vertices > 65535 ? Uint32Array : Uint16Array)(indices);
  let v = 0;
  let i = 0;
  for (const p of parts) {
    const n = p.attributes.position.count;
    position.set(p.attributes.position.array as Float32Array, v * 3);
    normal.set(p.attributes.normal.array as Float32Array, v * 3);
    if (p.attributes.color) color.set(p.attributes.color.array as Float32Array, v * 3);
    else color.fill(1, v * 3, (v + n) * 3);
    if (p.index) for (let k = 0; k < p.index.count; k++) index[i + k] = p.index.getX(k) + v;
    else for (let k = 0; k < n; k++) index[i + k] = k + v;
    i += p.index ? p.index.count : n;
    v += n;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(position, 3));
  g.setAttribute('normal', new BufferAttribute(normal, 3));
  g.setAttribute('color', new BufferAttribute(color, 3));
  g.setIndex(new BufferAttribute(index, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Copies of `geometry` tinted, placed and joined. */
export function assemble(items: { g: BufferGeometry; at?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number]; color?: ColorRepresentation }[]): BufferGeometry {
  return merge(
    items.map(({ g, at, rot, scale, color }) => {
      const c = placed(g, at ?? [0, 0, 0], rot, scale);
      if (color !== undefined) tint(c, color);
      return c;
    }),
  );
}

/** Part of a ring lying flat (an arc of `arc` radians around y). */
export function torusArc(radius: number, tube: number, arc: number, segments = 24): BufferGeometry {
  const g = new TorusGeometry(radius, tube, 6, segments, arc);
  g.rotateX(Math.PI / 2);
  return prep(g);
}
