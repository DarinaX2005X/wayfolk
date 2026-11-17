/**
 * The island itself: the grassy top (its own mesh, so hands and rays can hit the ground),
 * the cliffs dropping into the clouds in warm sandstone layers, the porch with the bench
 * where the person sits, the pier, the pond with its stream and waterfall, islets with rope
 * bridges, and the scatter of trees, bushes and rocks.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { CATALOG } from './catalog';
import { M, MAT, blob, build, cbox, cyl, join, paint, place, rng, surfaceAlpha, tone } from './geo';
import { kitGeometry } from './kit';
import { CENTER, HILL, ISLETS, LOTS, Land, PIER, POND, SEAT, STREAM, isletR, outlineR, segDist, type Islet } from './land';
import { mainMaterial, U } from './materials';
import { branchChime, buildProp, mossyRock } from './props';

/** Where the porch chimes hang (from the porch tree's bough), for their sound. */
export const CHIMES_AT = { x: -2.05, z: 0.55 };
import type { Batch } from './batch';

const TAU = Math.PI * 2;

// ---------- ground ----------

interface GroundShape {
  cx: number;
  cz: number;
  r: (t: number) => number;
  rings: number;
  segs: number;
  seed: number;
}

const GRASS = [new Color('#7cb24b'), new Color('#5e9a3e'), new Color('#9fc45a'), new Color('#6aa443')];
const SAND = new Color('#ecd59f');
const DRY = new Color('#b7b45a');
const LIP = new Color('#8fae4e');

let lastSand = 0;

function groundColor(land: Land, x: number, z: number, s: number, out: Color): Color {
  const n1 = Math.sin(x * 0.31 + 1.7) * Math.sin(z * 0.27 + 0.3) + 0.5 * Math.sin(x * 0.9 - z * 0.7);
  const n2 = Math.sin(x * 1.3 + z * 0.4) * 0.5 + 0.5;
  out.copy(GRASS[0]).lerp(n1 > 0.25 ? GRASS[2] : GRASS[1], Math.min(1, Math.abs(n1) * 0.95));
  out.lerp(GRASS[3], n2 * 0.35);
  // sun-dried patches
  const dry = Math.max(0, Math.sin(x * 0.23 + 2.1) * Math.sin(z * 0.19 + 0.7) - 0.55) * 1.6;
  out.lerp(DRY, Math.min(0.5, dry));
  // higher ground is a touch warmer and lighter
  const h = land.height(x, z);
  out.lerp(GRASS[2], Math.max(0, Math.min(0.35, (h - 1.2) * 0.2)));
  if (s > 0.9) out.lerp(LIP, (s - 0.9) * 4);
  // sand on the spit and round the pond
  const t = Math.atan2(z - CENTER.z, x - CENTER.x);
  const spitT = Math.atan2(-4.6 - CENTER.z, -15.5 - CENTER.x);
  let dt = Math.abs(t - spitT);
  if (dt > Math.PI) dt = TAU - dt;
  const spit = Math.exp(-((dt / 0.2) ** 2)) * Math.max(0, Math.min(1, (land.mainS(x, z) - 0.62) / 0.15));
  const pd = Math.hypot(x - POND.x, z - POND.z);
  const pond = Math.max(0, Math.min(1, 1 - (pd - POND.r - 0.1) / 0.7));
  const stream = Math.max(0, Math.min(1, 1 - (segDist(x, z, STREAM[0], STREAM[1]) - 0.4) / 0.5));
  lastSand = Math.max(spit, pond * 0.85, stream * 0.7);
  out.lerp(SAND, lastSand);
  // soft shade round the foot of trees, rocks and houses (fake ambient occlusion)
  let ao = 0;
  for (const o of land.obstacles) {
    const d = Math.hypot(x - o.x, z - o.z);
    if (d < o.r * 1.8) ao = Math.max(ao, (1 - d / (o.r * 1.8)) * 0.3);
  }
  for (const p of land.pads) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d < p.r + 1.2) ao = Math.max(ao, (1 - Math.max(0, d - p.r * 0.7) / (p.r * 0.3 + 1.2)) * 0.35);
  }
  out.multiplyScalar(1 - ao);
  return out;
}

/** The lawn colour at a point (what grass tufts take as their tint). */
export function groundTint(land: Land, x: number, z: number, out: Color): Color {
  const s = land.isletAt(x, z) ? 0.5 : Math.min(1, land.mainS(x, z));
  return groundColor(land, x, z, s, out);
}

function groundGeometry(land: Land, sh: GroundShape): BufferGeometry {
  const { rings, segs } = sh;
  const verts: number[] = [];
  const cols: number[] = [];
  const idx: number[] = [];
  const c = new Color();
  verts.push(sh.cx, land.height(sh.cx, sh.cz), sh.cz);
  groundColor(land, sh.cx, sh.cz, 0, c);
  cols.push(c.r, c.g, c.b, surfaceAlpha(lastSand > 0.5 ? M.sand : M.grass));
  const r = rng(sh.seed);
  for (let j = 1; j <= rings; j++) {
    const s = Math.pow(j / rings, 0.85);
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * TAU + (j % 2 ? 0.5 / segs : 0) * TAU;
      const jit = j < rings ? (r() - 0.5) * 0.35 : 0;
      const rad = sh.r(t) * s + jit;
      const x = sh.cx + Math.cos(t) * rad;
      const z = sh.cz + Math.sin(t) * rad;
      verts.push(x, land.height(x, z), z);
      groundColor(land, x, z, s, c);
      const k = 0.97 + r() * 0.06;
      cols.push(c.r * k, c.g * k, c.b * k, surfaceAlpha(lastSand > 0.5 ? M.sand : M.grass));
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, 1 + ((i + 1) % segs), 1 + i);
  for (let j = 1; j < rings; j++) {
    const a0 = 1 + (j - 1) * segs;
    const b0 = 1 + j * segs;
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      idx.push(a0 + i, a0 + i1, b0 + i);
      idx.push(a0 + i1, b0 + i1, b0 + i);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(verts), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(cols), 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  const out = g.toNonIndexed();
  out.computeBoundingSphere();
  return out;
}

const STRATA = ['#5d8a36', '#6e4a32', '#8d5f3e', '#c08458', '#a8714a', '#cf9a66', '#b67c50', '#c58d5d', '#9a6d55', '#8c6a5c', '#7b6159', '#6d5d5e', '#62575c', '#5a5560'].map((h) => new Color(h));

/** The cliff under an outline: rings dropping into the clouds, smooth-shaded strata. */
function cliffGeometry(land: Land, sh: GroundShape, depth: number): BufferGeometry {
  const segs = sh.segs;
  const D = [0, 0.25, 0.8, 1.6, 2.6, 3.8, 5.2, 6.8, 8.5, 10.3, 12.1, 13.8, 15.3, 16.4];
  const F = [1.0, 1.025, 1.01, 0.985, 0.95, 0.91, 0.86, 0.79, 0.7, 0.58, 0.45, 0.31, 0.17, 0.05];
  const depths = D.map((d) => (d * depth) / 16.4);
  const r = rng(sh.seed + 5);
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const tint = new Color();
  for (let k = 0; k < depths.length; k++) {
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * TAU;
      const edgeR = sh.r(t);
      const ex = sh.cx + Math.cos(t) * edgeR;
      const ez = sh.cz + Math.sin(t) * edgeR;
      const top = land.height(ex, ez);
      const bulge = k > 1 && k < depths.length - 1 ? Math.sin(t * 7 + k * 1.3) * 0.3 + Math.sin(t * 13 + k) * 0.15 : 0;
      const jit = k === 0 ? 0 : (r() - 0.5) * (k < 3 ? 0.12 : 0.35);
      const rad = edgeR * F[k] + jit + bulge;
      pos.push(sh.cx + Math.cos(t) * rad, top - depths[k] + (k > 0 ? (r() - 0.5) * 0.18 : 0), sh.cz + Math.sin(t) * rad);
      const band = STRATA[Math.min(STRATA.length - 1, k)];
      tint.copy(band).multiplyScalar(0.93 + r() * 0.12 + Math.sin(t * 5 + k) * 0.03);
      col.push(tint.r, tint.g, tint.b, surfaceAlpha(k === 0 ? M.grass : k === 1 ? M.dirt : M.rock));
    }
  }
  for (let k = 0; k < depths.length - 1; k++) {
    for (let i = 0; i < segs; i++) {
      const i1 = (i + 1) % segs;
      const a = k * segs + i;
      const b = k * segs + i1;
      const c = (k + 1) * segs + i;
      const d = (k + 1) * segs + i1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const last = (depths.length - 1) * segs;
  const tipIndex = pos.length / 3;
  pos.push(sh.cx, pos[last * 3 + 1] - 0.8 * (depth / 16), sh.cz);
  col.push(STRATA[STRATA.length - 1].r, STRATA[STRATA.length - 1].g, STRATA[STRATA.length - 1].b, surfaceAlpha(M.rock));
  for (let i = 0; i < segs; i++) idx.push(last + i, last + ((i + 1) % segs), tipIndex);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// ---------- water ----------

const waterVertex = /* glsl */ `
attribute float aFlow;
varying vec2 vUv;
varying float vFlow;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vFlow = aFlow;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const waterFragment = /* glsl */ `
uniform vec3 uWater;
uniform vec3 uFoam;
uniform vec3 uSkyLow;
uniform vec3 uSkyHigh;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uRain;
uniform float uTime;
uniform float uGlow;
varying vec2 vUv;
varying float vFlow;
varying vec3 vWorld;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec3 c = uWater;
  if (vFlow > 0.5) {
    // falling or running water: streaks moving along v
    vec2 p = vec2(vUv.x * 7.0, vUv.y * 2.5 - uTime * vFlow);
    float s = n(p) * 0.6 + n(p * 2.3 + 3.1) * 0.4;
    c = mix(c * 1.1, uFoam, smoothstep(0.55, 0.85, s));
    c = mix(c, uFoam, smoothstep(0.82, 1.0, vUv.y) * 0.7 + smoothstep(0.15, 0.0, vUv.y) * 0.5);
    float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
    c = mix(uFoam, c, 0.4 + 0.6 * edge);
  } else {
    // still water: ripples bend the reflected sky; rain draws rings
    vec2 p = vWorld.xz * 1.6;
    float r1 = n(p + uTime * 0.25);
    float r2 = n(p * 1.9 - uTime * 0.2);
    vec2 wob = vec2(r1 - 0.5, r2 - 0.5) * 0.35;
    float rings = 0.0;
    if (uRain > 0.01) {
      vec2 cell = floor(vWorld.xz * 2.2);
      for (int k = 0; k < 4; k++) {
        vec2 c2 = cell + vec2(float(k / 2), float(k - (k / 2) * 2)) - 0.5;
        float ph = fract(uTime * 0.9 + h(c2) * 7.0);
        vec2 ctr = (c2 + 0.5 + (vec2(h(c2 + 1.7), h(c2 + 3.1)) - 0.5) * 0.6) / 2.2;
        float d = length(vWorld.xz - ctr);
        rings += smoothstep(0.03, 0.0, abs(d - ph * 0.32)) * (1.0 - ph) * step(h(c2 + 9.0), uRain);
      }
      wob += vec2(rings) * 0.25;
    }
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(V.y + wob.x * 0.4, 0.0, 1.0), 2.2);
    float sky = clamp(-V.y * -1.0 + 0.15 + wob.y, 0.0, 1.0);
    vec3 refl = mix(uSkyLow, uSkyHigh, smoothstep(0.1, 0.9, sky + (1.0 - fres) * 0.6));
    c = mix(c * 0.85, refl, 0.35 + 0.55 * fres);
    c += uSun * pow(clamp(dot(reflect(-V, normalize(vec3(wob.x, 1.0, wob.y))), uSunDir), 0.0, 1.0), 60.0) * 0.6;
    c = mix(c, uFoam, smoothstep(0.86, 1.0, length(vUv - 0.5) * 2.0) * 0.45);
    c = mix(c, uFoam, rings * 0.35);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

function ribbon(points: Vector3[], widths: number[], flow: number, up = new Vector3(0, 1, 0), side?: Vector3): { pos: number[]; uv: number[]; flow: number[]; idx: number[] } {
  const pos: number[] = [];
  const uv: number[] = [];
  const fl: number[] = [];
  const idx: number[] = [];
  let len = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) len += points[i].distanceTo(points[i - 1]);
    const dir = new Vector3().subVectors(points[Math.min(points.length - 1, i + 1)], points[Math.max(0, i - 1)]).normalize();
    const s = side ? side.clone() : new Vector3().crossVectors(dir, up).normalize();
    const w = widths[i] / 2;
    const p = points[i];
    pos.push(p.x - s.x * w, p.y - s.y * w, p.z - s.z * w, p.x + s.x * w, p.y + s.y * w, p.z + s.z * w);
    uv.push(0, len, 1, len);
    fl.push(flow, flow);
    if (i > 0) {
      const b = (i - 1) * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
  }
  // normalise v to 0..1 along the ribbon, with repeats per metre kept in the shader
  for (let i = 1; i < uv.length; i += 2) uv[i] = uv[i] / Math.max(1e-3, len);
  return { pos, uv, flow: fl, idx };
}

// ---------- the island ----------

export interface IslandParts {
  ground: Mesh;
  water: Mesh;
  /** Rebuild the ground after pads changed. */
  refreshGround(): void;
  /** Adds the next islet's land, cliffs and bridge. */
  addIslet(i: Islet): void;
  triangles(): number;
  /** Blob shadow requests made while building: x, z, radius, strength. */
  shadows: [number, number, number, number][];
  /** Warm light pools under lamps at night. */
  lights: [number, number, number][];
  /** Ids of clearable decor in the batch, with position and radius. */
  decor: { key: string; x: number; z: number; r: number }[];
  /** Places a bird can sit: tree tops, posts, lamps. */
  perches: { pos: Vector3; kind: 'tree' | 'post' | 'lamp' }[];
}

export function createIsland(root: Object3D, land: Land, batch: Batch, decorBatch: Batch): IslandParts {
  const shadows: [number, number, number, number][] = [];
  const lights: [number, number, number][] = [];
  const decor: { key: string; x: number; z: number; r: number }[] = [];
  const perches: IslandParts['perches'] = [];
  const mainShape: GroundShape = { cx: CENTER.x, cz: CENTER.z, r: outlineR, rings: 22, segs: 96, seed: 3 };

  const ground = new Mesh(groundGeometry(land, mainShape), mainMaterial());
  ground.name = 'world:ground';
  ground.matrixAutoUpdate = false;
  root.add(ground);

  batch.add('cliff:main', cliffGeometry(land, mainShape, 24));

  // ---- water: pond, stream, waterfall ----
  const pondY = Land.mainHeight(POND.x + POND.r + 0.2, POND.z) - 0.14;
  const wpos: number[] = [];
  const wuv: number[] = [];
  const wfl: number[] = [];
  const widx: number[] = [];
  const addRibbon = (rb: ReturnType<typeof ribbon>): void => {
    const base = wpos.length / 3;
    wpos.push(...rb.pos);
    wuv.push(...rb.uv);
    wfl.push(...rb.flow);
    widx.push(...rb.idx.map((i) => i + base));
  };
  {
    const base = wpos.length / 3;
    wpos.push(POND.x, pondY, POND.z);
    wuv.push(0.5, 0.5);
    wfl.push(0);
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      const rr = POND.r + 0.35 + Math.sin(a * 3) * 0.15;
      wpos.push(POND.x + Math.cos(a) * rr, pondY, POND.z + Math.sin(a) * rr);
      wuv.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
      wfl.push(0);
      widx.push(base, base + 1 + ((i + 1) % n), base + 1 + i);
    }
  }
  const s0 = STREAM[0];
  const s1 = STREAM[1];
  const streamPts: Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = s0.x + (s1.x - s0.x) * t + Math.sin(t * Math.PI * 2) * 0.25;
    const z = s0.z + (s1.z - s0.z) * t;
    streamPts.push(new Vector3(x, Math.min(pondY, land.height(x, z) + 0.06) - t * 0.15, z));
  }
  addRibbon(ribbon(streamPts, streamPts.map((_, i) => 0.75 + i * 0.03), 1.2));
  const out = new Vector3(s1.x - CENTER.x, 0, s1.z - CENTER.z).normalize();
  const lip = streamPts[streamPts.length - 1];
  const fallPts: Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const drop = t * t * 2.0 + t * 13.5;
    fallPts.push(new Vector3(lip.x + out.x * (0.35 + Math.sqrt(t) * 1.6), lip.y - drop, lip.z + out.z * (0.35 + Math.sqrt(t) * 1.6)));
  }
  const fallSide = new Vector3(-out.z, 0, out.x);
  addRibbon(ribbon([lip.clone(), ...fallPts], [1.0, ...fallPts.map((_, i) => 1.0 + i * 0.09)], 2.6, undefined, fallSide));
  const wg = new BufferGeometry();
  wg.setAttribute('position', new BufferAttribute(new Float32Array(wpos), 3));
  wg.setAttribute('uv', new BufferAttribute(new Float32Array(wuv), 2));
  wg.setAttribute('aFlow', new BufferAttribute(new Float32Array(wfl), 1));
  wg.setIndex(widx);
  wg.computeBoundingSphere();
  const waterMat = new ShaderMaterial({
    uniforms: {
      uWater: { value: new Color('#5fb0d6') },
      uFoam: { value: new Color('#f4fbff') },
      uSkyLow: { value: new Color('#cfe6f2') },
      uSkyHigh: { value: new Color('#4f97de') },
      uSun: { value: new Color('#fff4e2') },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uRain: U.rain,
      uTime: U.time,
      uGlow: U.glow,
    },
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    side: 2,
  });
  waterMat.name = 'world:water';
  const water = new Mesh(wg, waterMat);
  water.name = 'world:water';
  water.raycast = () => {};
  root.add(water);
  // foam lumps where the stream tips over, rocks round the pond
  const r = rng(41);
  const foam: BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) foam.push(paint(blob(0.22 + r() * 0.12, 1, 60 + i, 0.2, 0.6).translate(lip.x + out.x * 0.3 + (r() - 0.5) * 0.9, lip.y + 0.02, lip.z + out.z * 0.3 + (r() - 0.5) * 0.9), '#f4fbff', { shade: 0.1 }, true));
  batch.add('foam', join(foam));
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + r() * 0.3;
    if (Math.abs(a - Math.atan2(s0.z - POND.z, s0.x - POND.x)) < 0.4) continue;
    const x = POND.x + Math.cos(a) * (POND.r + 0.45);
    const z = POND.z + Math.sin(a) * (POND.r + 0.45);
    batch.add(`pond-rock:${i}`, place(mossyRock(0.18 + r() * 0.22, 300 + i, 0.6), [x, land.height(x, z) - 0.06, z], [0, r() * TAU, 0]));
  }
  for (let i = 0; i < 4; i++) {
    const a = r() * TAU;
    const rr = r() * POND.r * 0.8;
    batch.add(`lily:${i}`, place(kitGeometry('waterlily', 3.4), [POND.x + Math.cos(a) * rr, pondY + 0.01, POND.z + Math.sin(a) * rr], [0, r() * TAU, 0]));
  }
  batch.add('reeds', join([0, 1, 2].map((i) => place(kitGeometry('waterplant', 3.2), [POND.x + POND.r * 0.8 - i * 0.4, pondY, POND.z - POND.r * 0.7 + i * 0.25], [0, i, 0]))));

  // ---- porch and bench at the seat ----
  const porch: [BufferGeometry, string][] = [];
  const deckY = 0.16;
  for (let i = 0; i < 8; i++) {
    const g = cbox(3.6, 0.1, 0.36, 0.03);
    g.translate(0, deckY - 0.1, -1.25 + i * 0.37);
    porch.push([g, i % 2 ? MAT.plank : MAT.woodLight]);
  }
  for (const x of [-1.7, 0, 1.7]) for (const z of [-1.3, 1.35]) porch.push([place(cbox(0.18, 0.5, 0.18, 0.03), [x, -0.38, z]), MAT.woodDark]);
  // railing at the back edge, low so the clouds stay in view when turning round
  for (const x of [-1.7, -0.6, 0.6, 1.7]) porch.push([place(cbox(0.1, 0.7, 0.1, 0.02), [x, deckY, 1.48]), MAT.woodDark]);
  porch.push([place(cbox(3.5, 0.08, 0.1, 0.02), [0, deckY + 0.62, 1.48]), MAT.wood]);
  porch.push([place(cbox(3.5, 0.06, 0.08, 0.02), [0, deckY + 0.32, 1.48]), MAT.wood]);
  batch.add('porch', build(porch.map(([g, c]) => [g, c] as [BufferGeometry, string])));
  const benchItem = CATALOG.bench;
  batch.add('porch:bench', place(kitGeometry('bench', benchItem.scale), [SEAT.x, deckY, SEAT.z + 0.32], [0, 0, 0]));
  batch.add('porch:lamp', place(kitGeometry('post-lantern', 0.62), [-1.6, deckY, 0.55], [0, Math.PI / 2, 0]));
  perches.push({ pos: new Vector3(-1.6, 2.2, 0.55), kind: 'lamp' });
  for (const x of [-1.7, -0.6, 0.6, 1.7]) perches.push({ pos: new Vector3(x, deckY + 0.72, 1.48), kind: 'post' });
  lights.push([-1.6, 0.2, 2.2]);
  const side: [string, number, number, number, number][] = [
    ['tea-table', 1.35, -0.45, -0.4, 0.75],
    ['flower-pot', -1.45, 0.95, 0, 1],
    ['flower-pot', 1.55, 1.05, 0.5, 0.9],
    ['mailbox', 2.45, -1.1, -0.9, 1],
  ];
  for (const [id, x, z, rot, s] of side) {
    const g = buildProp(id, 3);
    if (!g) continue;
    if (s !== 1) g.scale(s, s, s);
    batch.add(`porch:${id}:${x}`, place(g, [x, id === 'mailbox' ? land.height(x, z) - 0.02 : deckY, z], [0, rot, 0]));
  }
  batch.add('porch:books', place(kitGeometry('books', 0.5), [1.15, deckY + 0.3, -0.2], [0, 0.4, 0]));
  batch.add('porch:tree', place(kitGeometry('tree-round-b', 3.6), [-3.2, land.height(-3.2, 0.9), 0.9], [0, 0.6, 0]));
  // the porch chimes hang from a low bough of that tree, toward the bench
  const treeY = land.height(-3.2, 0.9);
  batch.add('porch:chimes', branchChime([-3.05, treeY + 1.55, 0.86], [CHIMES_AT.x, treeY + 1.72, CHIMES_AT.z]));
  shadows.push([-3.2, 0.9, 1.7, 0.6]);
  batch.add('porch:pumpkins', join([
    place(kitGeometry('pumpkin', 0.5), [-2.25, land.height(-2.25, -1.2), -1.2], [0, 0.4, 0]),
    place(kitGeometry('pumpkin-small', 0.55), [-2.6, land.height(-2.6, -0.8), -0.75], [0, 1.2, 0]),
  ]));

  // ---- pier ----
  const pierParts: [BufferGeometry, string][] = [];
  const pa = Math.atan2(PIER.dir.x, PIER.dir.z);
  const pierY = 0.12;
  const plank = (d: number, w: number, c: string): void => {
    const x = PIER.base.x + PIER.dir.x * d;
    const z = PIER.base.z + PIER.dir.z * d;
    pierParts.push([place(cbox(w, 0.09, 0.3, 0.02), [x, pierY - 0.09, z], [0, pa, 0]), c]);
  };
  for (let d = -0.4; d < PIER.length; d += 0.33) plank(d, PIER.width + (Math.sin(d * 7) * 0.08), Math.round(d * 3) % 2 ? MAT.plank : MAT.woodLight);
  // landing at the end
  for (let i = 0; i < 9; i++) plank(PIER.length + 0.1 + i * 0.33, 3.0, i % 2 ? MAT.plank : MAT.woodLight);
  const landingEnd = PIER.length + 0.1 + 9 * 0.33;
  const sideV = { x: PIER.dir.z, z: -PIER.dir.x };
  const post = (d: number, s: number, h: number, below = 2.2): void => {
    const x = PIER.base.x + PIER.dir.x * d + sideV.x * s;
    const z = PIER.base.z + PIER.dir.z * d + sideV.z * s;
    pierParts.push([place(cbox(0.18, h + below, 0.18, 0.03), [x, pierY - below, z]), MAT.woodDark]);
  };
  for (const d of [1.5, 3.5, 5.5, PIER.length])
    for (const s of [-1, 1]) {
      post(d, s * (PIER.width / 2 + 0.05), 0.65);
      perches.push({ pos: new Vector3(PIER.base.x + PIER.dir.x * d + sideV.x * s * (PIER.width / 2 + 0.05), pierY + 0.68, PIER.base.z + PIER.dir.z * d + sideV.z * s * (PIER.width / 2 + 0.05)), kind: 'post' });
    }
  for (const s of [-1, 1]) post(landingEnd, s * 1.45, 0.65);
  for (const s of [-1, 1]) {
    const a = { x: PIER.base.x + PIER.dir.x * 1.5 + sideV.x * s * (PIER.width / 2 + 0.05), z: PIER.base.z + PIER.dir.z * 1.5 + sideV.z * s * (PIER.width / 2 + 0.05) };
    const b = { x: PIER.base.x + PIER.dir.x * PIER.length + sideV.x * s * (PIER.width / 2 + 0.05), z: PIER.base.z + PIER.dir.z * PIER.length + sideV.z * s * (PIER.width / 2 + 0.05) };
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    pierParts.push([place(cyl(0.03, 0.03, len, 5), [a.x, pierY + 0.5, a.z], [Math.PI / 2, pa, 0]), MAT.rope]);
  }
  // mooring posts and a crate
  batch.add('pier', build(pierParts.map(([g, c]) => [g, c] as [BufferGeometry, string])));
  const endX = PIER.base.x + PIER.dir.x * landingEnd;
  const endZ = PIER.base.z + PIER.dir.z * landingEnd;
  batch.add('pier:lamp', place(kitGeometry('post-lantern', 0.6), [endX - PIER.dir.x * 0.3 + sideV.x * 1.3, pierY, endZ - PIER.dir.z * 0.3 + sideV.z * 1.3], [0, pa + Math.PI / 2, 0]));
  lights.push([endX + sideV.x * 1.3, endZ + sideV.z * 1.3, 2.4]);
  batch.add('pier:lamp2', place(kitGeometry('post-lantern', 0.6), [PIER.base.x - sideV.x * 1.2, land.height(PIER.base.x - sideV.x * 1.2, PIER.base.z - sideV.z * 1.2), PIER.base.z - sideV.z * 1.2], [0, pa - Math.PI / 2, 0]));
  lights.push([PIER.base.x - sideV.x * 1.2, PIER.base.z - sideV.z * 1.2, 2.2]);
  batch.add('pier:barrel', place(kitGeometry('barrel', 3.6), [PIER.base.x + PIER.dir.x * 6.3 - sideV.x * 0.55, pierY, PIER.base.z + PIER.dir.z * 6.3 - sideV.z * 0.55], [0, 0.4, 0]));
  batch.add('pier:crate', place(kitGeometry('crate-big', 3.0), [PIER.base.x + PIER.dir.x * 5.9 - sideV.x * 0.45, pierY, PIER.base.z + PIER.dir.z * 5.9 - sideV.z * 0.45], [0, 0.2, 0]));
  const bell = buildProp('bell', 2);
  if (bell) batch.add('pier:bell', place(bell.scale(0.75, 0.75, 0.75), [endX - sideV.x * 1.1, pierY, endZ - sideV.z * 1.1], [0, pa + Math.PI / 2, 0]));
  batch.add('pier:flag', place(kitGeometry('flag-yellow', 3.4), [endX + sideV.x * 1.4 + PIER.dir.x * 0.2, pierY + 0.6, endZ + sideV.z * 1.4 + PIER.dir.z * 0.2], [0, pa, 0]));

  // ---- trees, bushes, rocks ----
  scatterDecor(land, batch, decorBatch, shadows, decor, perches);

  let islandTris = 0;
  const parts: IslandParts = {
    ground,
    water,
    shadows,
    lights,
    decor,
    perches,
    refreshGround() {
      const shapes: GroundShape[] = [mainShape, ...land.islets.map((i) => isletShape(i))];
      const geo = join(shapes.map((s) => groundGeometry(land, s)));
      ground.geometry.dispose();
      ground.geometry = geo;
    },
    addIslet(i) {
      const sh = isletShape(i);
      batch.add(`cliff:${i.id}`, cliffGeometry(land, sh, 11));
      parts.refreshGround();
      bridge(land, batch, i);
      // a few trees on the far side of the islet
      const rr = rng(i.seed);
      const kinds = ['tree-round-a', 'pine-yellow-medium', 'tree-round-b', 'pine-orange-small'];
      for (let k = 0; k < 4; k++) {
        const a = Math.atan2(i.cz - CENTER.z, i.cx - CENTER.x) + (k - 1.5) * 0.7 + (rr() - 0.5) * 0.3;
        const rad = i.r * (0.62 + rr() * 0.15);
        const x = i.cx + Math.cos(a) * rad;
        const z = i.cz + Math.sin(a) * rad;
        const item = CATALOG[kinds[k]];
        decorBatch.add(`islet:${i.id}:tree:${k}`, place(kitGeometry(kinds[k], item.scale * (0.85 + rr() * 0.3)), [x, land.height(x, z) - 0.05, z], [0, rr() * TAU, 0]));
        land.obstacles.push({ x, z, r: 1.0, id: `islet:${i.id}:tree:${k}` });
        shadows.push([x, z, 1.5, 0.55]);
      }
    },
    triangles: () => ground.geometry.getAttribute('position').count / 3 + islandTris,
  };
  islandTris = wg.index ? wg.index.count / 3 : 0;
  return parts;
}

function isletShape(i: Islet): GroundShape {
  return { cx: i.cx, cz: i.cz, r: (t) => isletR(i, t), rings: 9, segs: 48, seed: i.seed };
}

function bridge(land: Land, batch: Batch, i: Islet): void {
  const parts: [BufferGeometry, string][] = [];
  const dx = i.to.x - i.from.x;
  const dz = i.to.z - i.from.z;
  const len = Math.hypot(dx, dz);
  const a = Math.atan2(dx, dz);
  const y0 = land.height(i.from.x, i.from.z);
  const y1 = land.height(i.to.x, i.to.z);
  const n = Math.max(4, Math.round(len / 0.32));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const sag = Math.sin(t * Math.PI) * 0.35;
    const x = i.from.x + dx * t;
    const z = i.from.z + dz * t;
    parts.push([place(cbox(1.3, 0.07, 0.24, 0.02), [x, y0 + (y1 - y0) * t - sag, z], [0, a + (k % 3 - 1) * 0.04, 0]), k % 2 ? MAT.plank : MAT.woodLight]);
  }
  const side = { x: Math.cos(a), z: -Math.sin(a) };
  for (const end of [0, 1])
    for (const s of [-1, 1]) {
      const x = i.from.x + dx * end + side.x * s * 0.7;
      const z = i.from.z + dz * end + side.z * s * 0.7;
      parts.push([place(cbox(0.14, 1.1, 0.14, 0.03), [x, (end ? y1 : y0) - 0.2, z]), MAT.woodDark]);
    }
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) {
      const t0 = k / 6;
      const t1 = (k + 1) / 6;
      const ya = y0 + (y1 - y0) * t0 - Math.sin(t0 * Math.PI) * 0.25 + 0.8;
      const yb = y0 + (y1 - y0) * t1 - Math.sin(t1 * Math.PI) * 0.25 + 0.8;
      const xa = i.from.x + dx * t0 + side.x * s * 0.7;
      const za = i.from.z + dz * t0 + side.z * s * 0.7;
      const segLen = Math.hypot(len / 6, yb - ya);
      const pitch = Math.atan2(yb - ya, len / 6);
      const g = cyl(0.025, 0.025, segLen, 4);
      g.rotateX(Math.PI / 2 - pitch);
      g.rotateY(a);
      g.translate(xa, ya, za);
      parts.push([g, MAT.rope]);
    }
  }
  batch.add(`bridge:${i.id}`, build(parts.map(([g, c]) => [g, c] as [BufferGeometry, string])));
}

function scatterDecor(
  land: Land,
  batch: Batch,
  decorBatch: Batch,
  shadows: [number, number, number, number][],
  decor: { key: string; x: number; z: number; r: number }[],
  perches: IslandParts['perches'],
): void {
  const r = rng(1234);
  const placed: { x: number; z: number; r: number }[] = [];
  const free = (x: number, z: number, rad: number): boolean => {
    if (!land.inside(x, z, rad * 0.6 + 0.3)) return false;
    if (Math.hypot(x - SEAT.x, z - SEAT.z) < 3.4 + rad) return false;
    if (segDist(x, z, PIER.base, PIER.end) < rad + 1.6) return false;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + rad + 0.6) return false;
    if (segDist(x, z, STREAM[0], STREAM[1]) < rad + 0.7) return false;
    for (const p of placed) if (Math.hypot(x - p.x, z - p.z) < p.r + rad) return false;
    return true;
  };
  const lotClear = (x: number, z: number, rad: number): boolean => {
    for (const l of LOTS.slice(0, 14)) if (Math.hypot(x - l.x, z - l.z) < 3.0 + rad) return false;
    // keep the line of sight from the seat to the pier open
    if (segDist(x, z, { x: 0.8, z: -1.5 }, PIER.base) < 1.8 + rad) return false;
    return true;
  };
  // hand-placed anchors: the wooded hill and the back rim
  const anchors: [string, number, number, number][] = [
    ['trees-b-large', HILL.x - 0.3, HILL.z - 0.4, 1.0],
    ['pine-orange-large', HILL.x - 3.0, HILL.z + 1.3, 1.0],
    ['pine-yellow-large', HILL.x + 2.6, HILL.z - 1.4, 1.0],
    ['tree-round-b', HILL.x - 3.6, HILL.z - 2.2, 1.1],
    ['pine-orange-medium', HILL.x + 0.8, HILL.z + 2.6, 1.0],
    ['trees-a-medium', 4.5, -24.5, 1.0],
    ['pine-yellow-medium', 9.6, -21.0, 1.0],
    ['tree-round-a', 11.5, -16.8, 1.0],
    ['trees-b-medium', -12.6, -19.5, 1.0],
    ['pine-orange-small', -12.0, -9.6, 1.0],
    ['tree-round-a', -10.4, -3.0, 0.9],
    ['tree-round-b', 6.2, -2.4, 0.9],
    ['pine-yellow-medium', 9.8, -3.8, 0.9],
  ];
  let n = 0;
  const addTree = (id: string, x: number, z: number, k: number, clearable: boolean): void => {
    const item = CATALOG[id];
    const rad = Math.max(0.9, item.footprint * k * 0.75);
    const y = land.height(x, z) - 0.06;
    const key = `tree:${n++}`;
    const g = place(kitGeometry(id, item.scale * k), [x, y, z], [0, r() * TAU, 0]);
    (clearable ? decorBatch : batch).add(key, g);
    placed.push({ x, z, r: rad });
    land.obstacles.push({ x, z, r: rad * 0.8, id: key, clearable });
    if (clearable) decor.push({ key, x, z, r: rad });
    shadows.push([x, z, rad * 1.35, 0.6]);
    perches.push({ pos: new Vector3(x, y + item.height * k * 0.92, z), kind: 'tree' });
  };
  for (const [id, x, z, k] of anchors) if (free(x, z, 0.8) && lotClear(x, z, 0.6)) addTree(id, x, z, k * (0.9 + r() * 0.2), false);
  // scatter round the rim and over the hill, leaving the meadow in front open
  const kinds = ['tree-round-a', 'tree-round-b', 'pine-yellow-medium', 'pine-orange-small', 'trees-a-small', 'trees-b-small', 'pine-orange-medium'];
  for (let tries = 0; tries < 900 && n < 44; tries++) {
    const t = r() * TAU;
    const s = 0.55 + Math.sqrt(r()) * 0.42;
    const x = CENTER.x + Math.cos(t) * outlineR(t) * s;
    const z = CENTER.z + Math.sin(t) * outlineR(t) * s;
    const hill = Math.exp(-((x - HILL.x) ** 2 + (z - HILL.z) ** 2) / (2 * 4.5 * 4.5));
    const rim = Math.max(0, (s - 0.72) / 0.25);
    const front = z > -6 && Math.abs(x) < 6 ? 0.1 : 1;
    const p = Math.max(hill, rim * 0.75) * front;
    if (r() > p) continue;
    const id = kinds[Math.floor(r() * kinds.length)];
    const k = 0.8 + r() * 0.35;
    if (!free(x, z, 1.0) || !lotClear(x, z, 0.8)) continue;
    addTree(id, x, z, k, false);
  }
  // bushes and rocks: smaller, may be cleared for a house
  for (let tries = 0, b = 0; tries < 900 && b < 46; tries++) {
    const t = r() * TAU;
    const s = 0.25 + Math.sqrt(r()) * 0.72;
    const x = CENTER.x + Math.cos(t) * outlineR(t) * s;
    const z = CENTER.z + Math.sin(t) * outlineR(t) * s;
    if (!free(x, z, 0.5)) continue;
    const rock = r() < 0.35;
    const key = `${rock ? 'rock' : 'bush'}:${b++}`;
    let g: BufferGeometry | null;
    let rad: number;
    if (rock) {
      const k = 0.18 + r() * 0.45;
      g = place(mossyRock(k, 400 + b), [x, land.height(x, z) - 0.05, z], [0, r() * TAU, 0]);
      rad = k * 1.1;
      // a smaller stone beside the big ones
      if (k > 0.35) {
        const a = r() * TAU;
        const x2 = x + Math.cos(a) * (k + 0.2);
        const z2 = z + Math.sin(a) * (k + 0.2);
        decorBatch.add(`${key}:b`, place(mossyRock(k * 0.4, 500 + b), [x2, land.height(x2, z2) - 0.03, z2], [0, r() * TAU, 0]));
      }
    } else {
      g = buildProp('bush', b * 7 + 1);
      const k = 0.7 + r() * 0.6;
      if (g) place(g.scale(k, k, k), [x, land.height(x, z) - 0.05, z], [0, r() * TAU, 0]);
      rad = 0.6 * k;
    }
    if (!g) continue;
    decorBatch.add(key, g);
    placed.push({ x, z, r: rad });
    land.obstacles.push({ x, z, r: rad, id: key, clearable: true });
    decor.push({ key, x, z, r: rad });
    shadows.push([x, z, rad * 1.3, rock ? 0.45 : 0.5]);
  }
  // mushrooms at the foot of trees, pebbles round the porch
  const mush: BufferGeometry[] = [];
  const caps = ['#d2553f', '#c98b4e', '#e7c48a'];
  for (const o of land.obstacles.slice(0, 40)) {
    if (o.clearable || r() < 0.45) continue;
    const a0 = r() * TAU;
    const cap = caps[Math.floor(r() * caps.length)];
    for (let k = 0; k < 3; k++) {
      const a = a0 + k * 0.5;
      const x = o.x + Math.cos(a) * (o.r * 0.55 + 0.15 + k * 0.08);
      const z = o.z + Math.sin(a) * (o.r * 0.55 + 0.15 + k * 0.08);
      const s = 0.6 + r() * 0.6;
      const y = land.height(x, z) - 0.01;
      mush.push(paint(cyl(0.022 * s, 0.03 * s, 0.09 * s, 6).translate(x, y, z), '#f1e6d0', { shade: 0.2, mat: M.plain }, true));
      mush.push(paint(new SphereGeometry(0.07 * s, 8, 4, 0, TAU, 0, Math.PI / 2).scale(1, 0.75, 1).translate(x, y + 0.085 * s, z), cap, { shade: 0.2 }, true));
      if (cap === '#d2553f') for (let d = 0; d < 3; d++) {
        const da = d * 2.1 + a;
        mush.push(paint(blob(0.011 * s, 0, d, 0.1).translate(x + Math.cos(da) * 0.035 * s, y + 0.13 * s, z + Math.sin(da) * 0.035 * s), '#fff8ec', { shade: 0 }, true));
      }
    }
  }
  if (mush.length) batch.add('mushrooms', join(mush));
  const pebbles: BufferGeometry[] = [];
  for (let i = 0; i < 16; i++) {
    const a = r() * TAU;
    const d = 1.9 + r() * 2.2;
    const x = SEAT.x + Math.cos(a) * d * 1.1;
    const z = SEAT.z - 0.4 + Math.sin(a) * d * 0.8;
    if (!land.inside(x, z, 0.3) || (Math.abs(x) < 1.9 && z > -1.5)) continue;
    const s = 0.025 + r() * 0.035;
    pebbles.push(paint(blob(s, 1, i, 0.2, 0.5).translate(x, land.height(x, z) + s * 0.1, z), r() < 0.5 ? '#bdb7ad' : '#a9a49b', { shade: 0.15, mat: M.rock }, true));
  }
  if (pebbles.length) batch.add('pebbles', join(pebbles));

  // sand spit: a few stones and a beached rowboat
  const spit = { x: -14.2, z: -5.0 };
  for (let i = 0; i < 4; i++) {
    const x = spit.x + (r() - 0.5) * 2.4;
    const z = spit.z + (r() - 0.5) * 1.6;
    if (!land.inside(x, z, 0.3)) continue;
    batch.add(`spit:rock:${i}`, place(mossyRock(0.15 + r() * 0.25, 600 + i, 0.2), [x, land.height(x, z) - 0.04, z], [0, r() * TAU, 0]));
  }
  const boat = build([
    [place(cbox(0.9, 0.32, 2.0, 0.12), [0, 0, 0]), MAT.wood],
    [place(cbox(0.75, 0.05, 1.7, 0.02), [0, 0.22, 0]), MAT.woodDark],
    [place(cbox(0.8, 0.06, 0.18, 0.02), [0, 0.3, 0.3]), MAT.woodLight],
    [place(cyl(0.025, 0.025, 1.6, 4), [0.3, 0.3, -0.4], [0.2, 0, 1.2]), MAT.woodLight],
  ]);
  const by = land.height(spit.x + 1.0, spit.z + 1.0);
  batch.add('spit:boat', place(boat, [spit.x + 1.0, by + 0.02, spit.z + 1.0], [0.08, 0.9, 0.05]));
  shadows.push([spit.x + 1.0, spit.z + 1.0, 1.3, 0.5]);
  const shell = buildProp('shell', 4);
  if (shell) batch.add('spit:shell', place(shell, [spit.x - 0.4, land.height(spit.x - 0.4, spit.z - 0.6), spit.z - 0.6], [0, 1, 0]));
  void tone;
}

export const ISLETS_ALL = ISLETS;
