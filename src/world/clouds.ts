/**
 * The sea of clouds. A wide disc far below carries soft lumps from a tiling noise texture,
 * shaded toward the sun and faded into the haze; over it float instanced puffs in three rings
 * (close under the cliffs, the middle distance, tall heads on the horizon), and a few small
 * clouds drift past at eye level. Everything orbits the island very slowly.
 */
import {
  Color,
  DataTexture,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  Object3D,
  CircleGeometry,
  Quaternion,
  RedFormat,
  RepeatWrapping,
  ShaderMaterial,
  Vector2,
  Vector3,
  type BufferGeometry,
} from '@iwsdk/core';
import type { SkyState } from './daylight';
import { blob, join, paint, rng } from './geo';
import { CENTER } from './land';
import { U } from './materials';

export const SEA_Y = -19;
export const FOG_DENSITY = 0.0026;

function noiseTexture(size = 128): DataTexture {
  const r = rng(99);
  const grid = (n: number): Float32Array => {
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = r();
    return g;
  };
  const octaves = [8, 16, 32];
  const grids = octaves.map(grid);
  const data = new Uint8Array(size * size);
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0;
      let amp = 0.6;
      let tot = 0;
      octaves.forEach((n, k) => {
        const fx = (x / size) * n;
        const fy = (y / size) * n;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const g = grids[k];
        const at = (i: number, j: number): number => g[((j + n) % n) * n + ((i + n) % n)];
        const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
        const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
        v += (a * (1 - ty) + b * ty) * amp;
        tot += amp;
        amp *= 0.5;
      });
      data[y * size + x] = Math.round((v / tot) * 255);
    }
  const tex = new DataTexture(data, size, size, RedFormat);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const common = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uUnder;
uniform vec3 uFog;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uDensity;
vec3 haze(vec3 c, vec3 world) {
  float d = length(world - cameraPosition) * uDensity;
  return mix(c, uFog, 1.0 - exp(-d * d));
}`;

const seaVertex = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const seaFragment = /* glsl */ `
${common}
uniform sampler2D uNoise;
varying vec3 vWorld;
float lumps(vec2 uv) {
  return texture2D(uNoise, uv).r * 0.62 + texture2D(uNoise, uv * 2.7 + 0.37).r * 0.28 + texture2D(uNoise, uv * 6.3 + 0.71).r * 0.1;
}
void main() {
  vec2 uv = vWorld.xz * 0.0042 + vec2(uTime * 0.0009, uTime * 0.0003);
  float n = lumps(uv);
  vec2 toSun = normalize(uSunDir.xz + vec2(1e-4));
  float n2 = lumps(uv - toSun * 0.01);
  float slope = clamp((n - n2) * 9.0, -1.0, 1.0);
  float lit = smoothstep(0.32, 0.72, n) * 0.75 + 0.25 + slope * 0.35 * clamp(1.0 - uSunDir.y, 0.2, 1.0);
  vec3 c = mix(uShade, uLit, clamp(lit, 0.0, 1.0));
  c = mix(c, uUnder, (1.0 - smoothstep(0.25, 0.55, n)) * 0.35);
  gl_FragColor = vec4(haze(c, vWorld), 1.0);
  #include <colorspace_fragment>
}`;

const puffVertex = /* glsl */ `
uniform float uTime;
attribute float aSpeed;
varying vec3 vWorld;
varying vec3 vNormal;
uniform vec2 uCenter;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  float a = uTime * aSpeed;
  float ca = cos(a), sa = sin(a);
  vec2 rel = wp.xz - uCenter;
  wp.xz = uCenter + vec2(rel.x * ca - rel.y * sa, rel.x * sa + rel.y * ca);
  n.xz = vec2(n.x * ca - n.z * sa, n.x * sa + n.z * ca);
  vWorld = wp.xyz;
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const puffFragment = /* glsl */ `
${common}
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  float l = dot(n, normalize(uSunDir + vec3(0.0, 0.25, 0.0))) * 0.5 + 0.5;
  vec3 c = mix(uShade, uLit, smoothstep(0.2, 0.9, l));
  c = mix(c, uUnder, smoothstep(0.05, -0.7, n.y) * 0.6);
  c = mix(c, uLit, smoothstep(0.4, 1.0, n.y) * 0.25);
  vec3 v = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(v, n), 0.0), 2.5);
  c += uLit * rim * 0.22;
  gl_FragColor = vec4(haze(c, vWorld), 1.0);
  #include <colorspace_fragment>
}`;

export interface Clouds {
  root: Object3D;
  apply(s: SkyState): void;
  /** Adds small kit clouds drifting at eye level (after the kit has loaded). */
  addDrifters(geo: BufferGeometry): void;
  triangles(): number;
}

function puffGeometry(seed: number): BufferGeometry {
  // a cumulus: a big dome on a flattened base with smaller heads round it
  const heads: [number, number, number, number][] = [
    [0, 0.05, 0, 1], [0.95, -0.12, 0.2, 0.72], [-0.9, -0.15, -0.1, 0.68], [0.35, 0.35, -0.45, 0.6], [-0.3, 0.25, 0.5, 0.55], [0.1, -0.25, 0.75, 0.6],
  ];
  const parts = heads.map(([x, y, z, r], i) => {
    const g = blob(r, 1, seed + i, 0.08, 0.85);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) if (pos.getY(k) < -r * 0.35) pos.setY(k, -r * 0.35 + (pos.getY(k) + r * 0.35) * 0.25);
    return paint(g.translate(x, y, z), '#ffffff', { shade: 0, wobble: 0 }, true);
  });
  return join(parts);
}

export function createClouds(parent: Object3D): Clouds {
  const root = new Object3D();
  root.name = 'world:clouds';
  parent.add(root);
  const uniforms = {
    uLit: { value: new Color('#ffffff') },
    uShade: { value: new Color('#c2cedd') },
    uUnder: { value: new Color('#e6edf2') },
    uFog: { value: new Color('#d4e6ef') },
    uSunDir: { value: new Vector3(0, 1, 0) },
    uTime: U.time,
    uDensity: { value: FOG_DENSITY },
    uCenter: { value: new Vector2(CENTER.x, CENTER.z) },
    uNoise: { value: noiseTexture() },
  };

  const seaMat = new ShaderMaterial({ uniforms, vertexShader: seaVertex, fragmentShader: seaFragment, fog: false });
  seaMat.name = 'world:cloud-sea';
  const seaGeo = new CircleGeometry(1100, 48);
  seaGeo.rotateX(-Math.PI / 2);
  const sea = new Mesh(seaGeo, seaMat);
  sea.name = 'world:cloud-sea';
  sea.position.set(CENTER.x, SEA_Y, CENTER.z);
  sea.renderOrder = -900;
  sea.raycast = () => {};
  root.add(sea);

  const puffMat = new ShaderMaterial({ uniforms, vertexShader: puffVertex, fragmentShader: puffFragment, fog: false });
  puffMat.name = 'world:cloud-puff';
  const geo = puffGeometry(5);
  const r = rng(2024);
  type Ring = { n: number; r0: number; r1: number; y0: number; y1: number; s0: number; s1: number; sq: number; speed: number };
  const rings: Ring[] = [
    { n: 26, r0: 17, r1: 48, y0: -22, y1: -13, s0: 4, s1: 8, sq: 0.8, speed: 0.0022 },
    { n: 36, r0: 55, r1: 190, y0: -21, y1: -12, s0: 10, s1: 22, sq: 0.75, speed: 0.0011 },
    { n: 18, r0: 240, r1: 460, y0: -14, y1: 14, s0: 26, s1: 55, sq: 0.9, speed: 0.0004 },
  ];
  // mist where the waterfall meets the clouds
  const extra: [number, number, number, number][] = [[-16.5, -16, -15.5, 4.5], [-14.5, -18, -18.5, 3.8], [-18.5, -15, -12, 3.2]];
  const total = rings.reduce((a, b) => a + b.n, 0) + extra.length;
  const puffs = new InstancedMesh(geo, puffMat, total);
  puffs.name = 'world:cloud-puffs';
  puffs.frustumCulled = false;
  puffs.raycast = () => {};
  const speeds = new Float32Array(total);
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  let i = 0;
  for (const ring of rings) {
    for (let k = 0; k < ring.n; k++) {
      const a = (k / ring.n) * Math.PI * 2 + r() * 0.5;
      const rad = ring.r0 + (ring.r1 - ring.r0) * Math.sqrt(r());
      p.set(CENTER.x + Math.cos(a) * rad, ring.y0 + (ring.y1 - ring.y0) * r(), CENTER.z + Math.sin(a) * rad);
      const sc = ring.s0 + (ring.s1 - ring.s0) * r();
      s.set(sc * (1 + r() * 0.5), sc * ring.sq * (0.8 + r() * 0.4), sc);
      q.setFromAxisAngle(new Vector3(0, 1, 0), r() * Math.PI * 2);
      puffs.setMatrixAt(i, m.compose(p, q, s));
      speeds[i] = ring.speed * (0.7 + r() * 0.6);
      i++;
    }
  }
  for (const [x, y, z, sc] of extra) {
    p.set(x, y, z);
    s.set(sc, sc * 0.65, sc);
    q.identity();
    puffs.setMatrixAt(i, m.compose(p, q, s));
    speeds[i] = 0;
    i++;
  }
  geo.setAttribute('aSpeed', new InstancedBufferAttribute(speeds, 1));
  puffs.renderOrder = -800;
  root.add(puffs);
  let tris = 2 * 48 + (geo.getAttribute('position').count / 3) * total;

  return {
    root,
    apply(st) {
      uniforms.uLit.value.copy(st.cloudLit);
      uniforms.uShade.value.copy(st.cloudShade);
      uniforms.uUnder.value.copy(st.cloudUnder);
      uniforms.uFog.value.copy(st.fog);
      uniforms.uSunDir.value.copy(st.night > 0.5 ? st.moonDir : st.sunDir);
    },
    addDrifters(g) {
      const n = 9;
      const dg = g.clone();
      const drift = new InstancedMesh(dg, puffMat, n);
      drift.name = 'world:cloud-drifters';
      drift.frustumCulled = false;
      drift.raycast = () => {};
      const sp = new Float32Array(n);
      const rr = rng(77);
      for (let k = 0; k < n; k++) {
        const a = -Math.PI * 0.5 + (k / n) * Math.PI * 2 + rr() * 0.4;
        const rad = 40 + rr() * 60;
        p.set(CENTER.x + Math.cos(a) * rad, 3 + rr() * 9, CENTER.z + Math.sin(a) * rad);
        const sc = 2.2 + rr() * 2.2;
        s.set(sc, sc, sc);
        q.setFromAxisAngle(new Vector3(0, 1, 0), rr() * Math.PI * 2);
        drift.setMatrixAt(k, m.compose(p, q, s));
        sp[k] = 0.004 + rr() * 0.003;
      }
      dg.setAttribute('aSpeed', new InstancedBufferAttribute(sp, 1));
      root.add(drift);
      tris += (dg.getAttribute('position').count / 3) * n;
    },
    triangles: () => tris,
  };
}
