/**
 * The sky whale: a soft cloud whale (about 26 m long, nose toward +x) with a big rounded head,
 * a long body tapering to the tail stock, broad flukes, long pectoral fins, a small hump of a
 * dorsal fin, throat grooves, a smile and a dark eye. Little cloud lumps ride on its back.
 * It swims in the vertex shader: the tail beats up and down in a travelling wave, the fins
 * flap slowly, and the whole shape uses the cloud shading with soft edges.
 */
import { BufferAttribute, BufferGeometry, Color, ShaderMaterial, SphereGeometry, Vector3 } from '@iwsdk/core';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rng } from './geo';

/** Length and the x of the tail stock (flukes behind it) and of the nose. */
const TAIL_X = -12.5;
const NOSE_X = 13;
const R = 3.2;

/** Body radius along the length, s = 0 at the tail stock, 1 at the nose (relative to R). */
const PROFILE: [number, number][] = [
  [0, 0.15], [0.08, 0.19], [0.18, 0.27], [0.3, 0.41], [0.42, 0.6], [0.52, 0.78], [0.62, 0.93], [0.7, 1.0],
  [0.78, 0.98], [0.85, 0.9], [0.91, 0.75], [0.95, 0.58], [0.98, 0.36], [0.995, 0.17], [1, 0],
];

function profile(s: number): number {
  for (let i = 1; i < PROFILE.length; i++) {
    const [s1, r1] = PROFILE[i];
    if (s <= s1) {
      const [s0, r0] = PROFILE[i - 1];
      const t = (s - s0) / (s1 - s0);
      const k = t * t * (3 - 2 * t);
      return r0 + (r1 - r0) * k;
    }
  }
  return 0;
}

/** How much a point at x follows the tail beat: 0 over the head, rising to 1 at the stock, more on the flukes. */
export function bendAt(x: number): number {
  const start = 2;
  if (x >= start) return 0;
  return Math.pow((start - x) / (start - TAIL_X), 1.5);
}

const BACK = new Color('#b9c7e1');
const BELLY = new Color('#ffffff');
const GROOVE = new Color('#dde5f1');
const SMILE = new Color('#5f6c86');
const EYE = new Color('#2c3347');

interface Parts {
  pos: number[];
  col: number[];
  swim: number[];
  idx: number[];
}

function toGeometry(p: Parts): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(p.pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(p.col), 3));
  g.setAttribute('aSwim', new BufferAttribute(new Float32Array(p.swim), 3));
  g.setIndex(p.idx);
  g.computeVertexNormals();
  return g;
}

/** The body: a smooth spindle with a flatter top to the head, a deeper jaw and grooves under the throat. */
function body(rings = 46, segs = 32): BufferGeometry {
  const p: Parts = { pos: [], col: [], swim: [], idx: [] };
  for (let i = 0; i <= rings; i++) {
    const s = i / rings;
    const x = TAIL_X + (NOSE_X - TAIL_X) * s;
    const r = Math.max(0.0001, profile(s) * R);
    // the head hangs a little low (a flat brow and a round jaw), the tail stock is narrow and deep
    const cy = -0.12 * r * Math.min(1, Math.max(0, (s - 0.55) / 0.3));
    const flat = s < 0.25 ? 0.75 + s : 1;
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const sy = Math.cos(a);
      const sz = Math.sin(a);
      // grooves along the throat
      const throat = sy < -0.45 && s > 0.6 && s < 0.97 ? Math.min(1, (-sy - 0.45) / 0.3) * Math.min(1, (s - 0.6) / 0.08, (0.97 - s) / 0.1) : 0;
      const groove = throat * (j % 2 === 0 ? 1 : 0);
      const rr = r * (1 - 0.035 * groove);
      const y = cy + sy * rr * 0.88;
      const z = sz * rr * flat;
      p.pos.push(x, y, z);
      const c = BELLY.clone().lerp(BACK, Math.max(0, Math.min(1, (sy + 0.15) / 0.8))).lerp(GROOVE, groove * 0.8);
      p.col.push(c.r, c.g, c.b);
      p.swim.push(bendAt(x), 0, 0);
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      p.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  return toGeometry(p);
}

/** A flattened leaf shape from its root (origin) out along +x: for fins and flukes. */
function leaf(len: number, chord: number, thick: number, sweep: number, lift: number, color: Color, swim: (x: number, k: number) => [number, number], res = 1): BufferGeometry {
  const g = new SphereGeometry(1, Math.round(14 * res), Math.round(10 * res));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  const pos = g.getAttribute('position');
  const col: number[] = [];
  const sw: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    // unit sphere -> leaf: x along the length 0..1, narrow at the root and the tip
    const u = (pos.getX(i) + 1) / 2;
    const w = Math.sin(Math.PI * Math.pow(u, 0.75)) * (1 - 0.25 * u);
    const x = u * len;
    const z = pos.getZ(i) * chord * 0.5 * w - sweep * u * u * len;
    const y = pos.getY(i) * thick * 0.5 * w + lift * u * u * len;
    pos.setXYZ(i, x, y, z);
    col.push(color.r, color.g, color.b);
    const [a, b] = swim(x, u);
    // thin parts stay solid at grazing angles (the soft cloud edge would dissolve them)
    sw.push(a, b, 1);
  }
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aSwim', new BufferAttribute(new Float32Array(sw), 3));
  return g;
}

function transformed(g: BufferGeometry, pos: Vector3, rotY: number, rotX = 0, rotZ = 0): BufferGeometry {
  g.rotateX(rotX);
  g.rotateZ(rotZ);
  g.rotateY(rotY);
  g.translate(pos.x, pos.y, pos.z);
  return g;
}

/** The smile: a thin dark band along the side of the head, curling up at the corner. */
function smile(side: number): BufferGeometry {
  const p: Parts = { pos: [], col: [], swim: [], idx: [] };
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const s = 0.975 - (i / n) * 0.17;
    const x = TAIL_X + (NOSE_X - TAIL_X) * s;
    const r = profile(s) * R;
    const cy = -0.12 * r * Math.min(1, Math.max(0, (s - 0.55) / 0.3));
    // angle round the body from straight down: low near the nose, rising at the corner
    const corner = Math.pow(i / n, 3);
    const a = 2.05 - 0.35 * corner;
    for (const off of [-0.07, 0.07]) {
      const aa = a + off / Math.max(0.5, r);
      const y = cy + Math.cos(aa) * (r + 0.04) * 0.88;
      const z = side * Math.sin(aa) * (r + 0.04);
      p.pos.push(x, y, z);
      p.col.push(SMILE.r, SMILE.g, SMILE.b);
      p.swim.push(0, 0, 1);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    if (side > 0) p.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    else p.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  return toGeometry(p);
}

function eye(side: number): BufferGeometry {
  const s = 0.79;
  const x = TAIL_X + (NOSE_X - TAIL_X) * s;
  const r = profile(s) * R;
  const cy = -0.12 * r * Math.min(1, Math.max(0, (s - 0.55) / 0.3));
  const a = 1.72;
  const g = new SphereGeometry(0.3, 10, 8);
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.scale(1.2, 0.85, 0.55);
  g.translate(x, cy + Math.cos(a) * r * 0.88, side * Math.sin(a) * (r - 0.05));
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).map((_, i) => [EYE.r, EYE.g, EYE.b][i % 3]), 3));
  g.setAttribute('aSwim', new BufferAttribute(new Float32Array(n * 3).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  return g;
}

/** Soft cloud lumps riding on the back (they bend with the tail like the body). */
function lumps(res = 1): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  const r = rng(77);
  const spots: [number, number, number][] = [[0.66, 0.5, 1.0], [0.56, 0.42, 0.9], [0.46, 0.36, 0.8], [0.74, 0.4, 0.8], [0.36, 0.3, 0.65], [0.84, 0.3, 0.6]];
  for (const [s, k, side] of spots) {
    const x = TAIL_X + (NOSE_X - TAIL_X) * s;
    const rad = profile(s) * R;
    const g = new SphereGeometry(rad * k, Math.round(12 * res), Math.round(8 * res));
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g.scale(1.5, 0.6, 1);
    const off = (r() - 0.5) * rad * 0.5 * side;
    g.translate(x + (r() - 0.5) * 1.5, rad * 0.62, off);
    const pos = g.getAttribute('position');
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const sw = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col.set([BACK.r * 1.04, BACK.g * 1.03, BACK.b * 1.01], i * 3);
      sw[i * 3] = bendAt(pos.getX(i));
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.setAttribute('aSwim', new BufferAttribute(sw, 3));
    out.push(g);
  }
  return out;
}

/** The whale; `res` below 1 gives a lighter mesh of the same shape (for the calf). */
export function whaleGeometry(res = 1): BufferGeometry {
  const parts: BufferGeometry[] = [body(Math.round(46 * res), Math.round(32 * res / 2) * 2)];
  const finRoot = TAIL_X + (NOSE_X - TAIL_X) * 0.66;
  const finR = profile(0.66) * R;
  for (const side of [1, -1]) {
    // long pectoral fins, low on the sides, swept back and drooping
    const fin = leaf(8.4, 2.1, 0.5, -0.12 * side, 0.02, BACK.clone().lerp(BELLY, 0.6), (_x, u) => [0, side * u], res);
    parts.push(transformed(fin, new Vector3(finRoot, -finR * 0.42, side * finR * 0.8), side * -2.0, 0, -0.42));
    // flukes: broad, swept back from the tail stock, tips lifted
    const fluke = leaf(5.4, 3.0, 0.55, -0.3 * side, 0.05, BACK, () => [0, 0], res);
    const fp = new Vector3(TAIL_X + 0.8, 0.1, side * 0.2);
    transformed(fluke, fp, side * -1.8, side * 0.1, 0.06);
    // tail beat weight by the final x
    const pos = fluke.getAttribute('position');
    const sw = fluke.getAttribute('aSwim');
    for (let i = 0; i < pos.count; i++) sw.setX(i, bendAt(pos.getX(i)));
    parts.push(fluke);
    parts.push(smile(side));
    parts.push(eye(side));
  }
  // a low dorsal hump two thirds of the way back
  const hump = leaf(2.2, 1.1, 0.5, 0, 0, BACK, (x) => [bendAt(x), 0], res);
  parts.push(transformed(hump, new Vector3(TAIL_X + (NOSE_X - TAIL_X) * 0.3, profile(0.3) * R * 0.8, 0), Math.PI, Math.PI / 2, -0.3));
  {
    const pos = parts[parts.length - 1].getAttribute('position');
    const sw = parts[parts.length - 1].getAttribute('aSwim');
    for (let i = 0; i < pos.count; i++) sw.setX(i, bendAt(pos.getX(i)));
  }
  parts.push(...lumps(res));
  for (const g of parts) if (!g.index) g.setIndex([...Array(g.getAttribute('position').count).keys()]);
  for (const g of parts) if (!g.getAttribute('normal')) g.computeVertexNormals();
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('whale geometry did not merge');
  merged.computeBoundingSphere();
  return merged;
}

const WHALE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uPhase;
uniform float uAmp;
attribute vec3 aSwim;
attribute vec3 color;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTint;
varying float vSolid;
void main() {
  vec3 p = position;
  vec3 n = normal;
  float ph = uTime * uBeat + uPhase;
  float w = aSwim.x;
  // the tail beats in a wave running back along the body; the head answers a little
  float wave = sin(ph - w * 1.7);
  p.y += uAmp * (w * w * wave - 0.1 * sin(ph + 0.6));
  float slope = uAmp * (w * 2.0 * wave + w * w * -1.7 * cos(ph - w * 1.7)) / 14.0;
  n = normalize(vec3(n.x + n.y * slope, n.y - n.x * slope, n.z));
  // pectoral fins flap slowly, more toward the tips
  float f = aSwim.y;
  p.y += abs(f) * abs(f) * 1.6 * sin(ph * 0.5 + 0.8);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vTint = color;
  vSolid = aSwim.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/**
 * The whale's material: the cloud shading (shared uniforms, so it follows the sky) tinted by
 * the vertex colours, with a fade for appearing from and melting back into the haze.
 */
export function whaleMaterial(cloud: ShaderMaterial, beat: number, phase: number, amp: number): ShaderMaterial {
  const frag = cloud.fragmentShader
    .replace('varying vec3 vNormal;', 'varying vec3 vNormal;\nvarying vec3 vTint;\nvarying float vSolid;\nuniform float uFade;')
    .replace('float edge = smoothstep(0.02, 0.38, facing);', 'c *= vTint;\n  float edge = max(smoothstep(0.02, 0.3, facing), vSolid) * uFade;');
  const m = new ShaderMaterial({
    uniforms: { ...cloud.uniforms, uBeat: { value: beat }, uPhase: { value: phase }, uAmp: { value: amp }, uFade: { value: 0 } },
    vertexShader: WHALE_VERTEX,
    fragmentShader: frag,
    fog: false,
    alphaToCoverage: true,
  });
  m.name = 'world:sky-whale';
  return m;
}
