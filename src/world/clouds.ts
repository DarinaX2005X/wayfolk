/**
 * The sea of clouds. A wide disc far below carries soft lumps from a tiling noise texture,
 * shaded toward the sun and faded into the haze; over it float instanced puffs in three rings
 * (close under the cliffs, the middle distance, tall heads on the horizon), and a few small
 * clouds drift past at eye level. Everything orbits the island very slowly.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry as Geometry,
  Color,
  DataTexture,
  DoubleSide,
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
uniform float uDeep;
varying vec3 vWorld;
float lumps(vec2 uv) {
  return texture2D(uNoise, uv).r * 0.62 + texture2D(uNoise, uv * 2.7 + 0.37).r * 0.28 + texture2D(uNoise, uv * 6.3 + 0.71).r * 0.1;
}
void main() {
  float speed = uDeep > 0.5 ? 0.55 : 1.0;
  vec2 uv = vWorld.xz * (uDeep > 0.5 ? 0.0031 : 0.0042) + vec2(uTime * 0.0009, uTime * 0.0003) * speed + uDeep * 0.37;
  float n = lumps(uv);
  if (uDeep < 0.5) {
    // gaps in the top layer open onto the deeper clouds; their rims are soft
    float gap = texture2D(uNoise, vWorld.xz * 0.0016 + vec2(uTime * 0.0004, -uTime * 0.0002)).r;
    float a = smoothstep(0.5, 0.6, gap + n * 0.22);
    gl_FragColor.a = a;
    if (a < 0.02) discard;
  }
  vec2 toSun = normalize(uSunDir.xz + vec2(1e-4));
  float n2 = lumps(uv - toSun * 0.01);
  float slope = clamp((n - n2) * 9.0, -1.0, 1.0);
  float lit = smoothstep(0.32, 0.72, n) * 0.75 + 0.25 + slope * 0.35 * clamp(1.0 - uSunDir.y, 0.2, 1.0);
  vec3 c = mix(uShade, uLit, clamp(lit, 0.0, 1.0));
  c = mix(c, uUnder, (1.0 - smoothstep(0.25, 0.55, n)) * 0.35);
  if (uDeep > 0.5) c = mix(c * 0.78, uUnder * 0.85, 0.35);
  float alpha = uDeep > 0.5 ? 1.0 : gl_FragColor.a;
  gl_FragColor = vec4(haze(c, vWorld), alpha);
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
  float facing = max(dot(v, n), 0.0);
  float rim = pow(1.0 - facing, 2.5);
  c += uLit * rim * 0.22;
  // light from below: the sea of clouds glows up into the undersides
  c += uUnder * smoothstep(0.1, -0.8, n.y) * 0.18;
  // soft silhouettes (alpha to coverage, no sorting)
  float edge = smoothstep(0.02, 0.38, facing);
  gl_FragColor = vec4(haze(c, vWorld), edge);
  #include <colorspace_fragment>
}`;

const SHAFT_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vAlong;
void main() {
  vUv = uv;
  vAlong = position.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SHAFT_FRAGMENT = /* glsl */ `
uniform float uShaft;
uniform vec3 uShaftColor;
uniform float uTime;
varying vec2 vUv;
varying float vAlong;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = smoothstep(0.0, 0.25, vAlong) * smoothstep(1.0, 0.55, vAlong);
  float breathe = 0.65 + 0.35 * sin(uTime * 0.13 + vUv.y * 40.0);
  float a = across * across * along * breathe * uShaft * 0.22;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uShaftColor * a, a);
}`;

export interface Clouds {
  root: Object3D;
  apply(s: SkyState): void;
  /** The cloud shading for one-off meshes (the sky whale). */
  solid(): ShaderMaterial;
  /** Adds small kit clouds drifting at eye level (after the kit has loaded). */
  addDrifters(geo: BufferGeometry): void;
  triangles(): number;
}

function puffGeometry(seed: number, count = 6): BufferGeometry {
  // a cumulus: a big dome on a flattened base with smaller heads round it
  const heads: [number, number, number, number][] = [
    [0, 0.05, 0, 1], [0.95, -0.12, 0.2, 0.72], [-0.9, -0.15, -0.1, 0.68], [0.35, 0.35, -0.45, 0.6], [-0.3, 0.25, 0.5, 0.55], [0.1, -0.25, 0.75, 0.6],
  ].slice(0, count) as [number, number, number, number][];
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

  // two layers: the top one breaks into gaps that show a deeper, darker one drifting slower
  const seaGeo = new CircleGeometry(1100, 48);
  seaGeo.rotateX(-Math.PI / 2);
  const layer = (deep: boolean): Mesh => {
    const mat = new ShaderMaterial({ uniforms: { ...uniforms, uDeep: { value: deep ? 1 : 0 } }, vertexShader: seaVertex, fragmentShader: seaFragment, fog: false, alphaToCoverage: !deep });
    mat.name = deep ? 'world:cloud-deep' : 'world:cloud-sea';
    const sea = new Mesh(seaGeo, mat);
    sea.name = mat.name;
    sea.position.set(CENTER.x, deep ? SEA_Y - 34 : SEA_Y, CENTER.z);
    sea.renderOrder = deep ? -950 : -900;
    sea.raycast = () => {};
    root.add(sea);
    return sea;
  };
  layer(true);
  layer(false);

  const puffMat = new ShaderMaterial({ uniforms, vertexShader: puffVertex, fragmentShader: puffFragment, fog: false, alphaToCoverage: true });
  puffMat.name = 'world:cloud-puff';
  const r = rng(2024);
  type Ring = { n: number; heads: number; r0: number; r1: number; y0: number; y1: number; s0: number; s1: number; sq: number; speed: number };
  const rings: Ring[] = [
    { n: 18, heads: 6, r0: 17, r1: 48, y0: -22, y1: -13, s0: 4, s1: 8, sq: 0.8, speed: 0.0022 },
    { n: 26, heads: 5, r0: 55, r1: 190, y0: -21, y1: -12, s0: 10, s1: 22, sq: 0.75, speed: 0.0011 },
    { n: 14, heads: 4, r0: 240, r1: 460, y0: -14, y1: 14, s0: 26, s1: 55, sq: 0.9, speed: 0.0004 },
  ];
  // mist where the waterfall meets the clouds
  const extra: [number, number, number, number][] = [[-16.5, -16, -15.5, 4.5], [-14.5, -18, -18.5, 3.8], [-18.5, -15, -12, 3.2]];
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  let tris = 4 * 48;
  rings.forEach((ring, ri) => {
    const geo = puffGeometry(5 + ri, ring.heads);
    const n = ring.n + (ri === 0 ? extra.length : 0);
    const puffs = new InstancedMesh(geo, puffMat, n);
    puffs.name = `world:cloud-puffs-${ri}`;
    puffs.frustumCulled = false;
    puffs.raycast = () => {};
    const speeds = new Float32Array(n);
    let i = 0;
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
    if (ri === 0)
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
    tris += (geo.getAttribute('position').count / 3) * n;
  });

  // sun shafts: long soft fans from the low sun down through the clouds at golden hour
  const shaftU = { uShaft: { value: 0 }, uShaftColor: { value: new Color('#ffd49a') }, uTime: U.time };
  const shaftGeo = new Geometry();
  {
    const pos: number[] = [];
    const uv: number[] = [];
    const rr = rng(4);
    const nShaft = 7;
    for (let k = 0; k < nShaft; k++) {
      // a quad from the apex (sun side, x = 0) to the far end (x = 1), spread fan-wise in y
      const a0 = (k / nShaft - 0.5) * 0.9 + (rr() - 0.5) * 0.05;
      const w = 0.025 + rr() * 0.035;
      const seed = rr();
      const quad = [[0, a0 * 0.15 - w * 0.1], [0, a0 * 0.15 + w * 0.1], [1, a0 + w], [1, a0 - w]];
      for (const idx of [0, 1, 2, 0, 2, 3]) {
        pos.push(quad[idx][0], quad[idx][1], 0);
        uv.push(idx === 0 || idx === 3 ? 0 : 1, seed);
      }
    }
    shaftGeo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    shaftGeo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  }
  const shaftMat = new ShaderMaterial({
    uniforms: shaftU,
    vertexShader: SHAFT_VERTEX,
    fragmentShader: SHAFT_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  });
  shaftMat.name = 'world:sun-shafts';
  const shafts = new Mesh(shaftGeo, shaftMat);
  shafts.name = 'world:sun-shafts';
  shafts.frustumCulled = false;
  shafts.raycast = () => {};
  shafts.renderOrder = 5;
  shafts.visible = false;
  root.add(shafts);
  tris += 14;
  const aimShafts = (st: SkyState): void => {
    const el = st.sunDir.y;
    const k = Math.max(0, Math.min(1, (el + 0.02) / 0.06)) * Math.max(0, 1 - Math.max(0, el - 0.1) / 0.3) * (1 - st.night);
    shaftU.uShaft.value = k;
    shaftU.uShaftColor.value.copy(st.sun).lerp(st.cloudLit, 0.3);
    shafts.visible = k > 0.02;
    if (!shafts.visible) return;
    // from a point high toward the sun, falling past the island into the cloud sea
    const flat = new Vector3(st.sunDir.x, 0, st.sunDir.z).normalize();
    const apex = new Vector3(CENTER.x, 0, CENTER.z).addScaledVector(flat, 260).setY(70 + el * 300);
    const end = new Vector3(CENTER.x, SEA_Y - 6, CENTER.z).addScaledVector(flat, -10);
    const len = apex.distanceTo(end);
    shafts.position.copy(apex);
    shafts.scale.set(len, len * 0.55, 1);
    // x along the shaft, the fan opens sideways (across the sun line)
    const xAxis = end.clone().sub(apex).normalize();
    const side = new Vector3(-flat.z, 0, flat.x);
    const zAxis = new Vector3().crossVectors(xAxis, side).normalize();
    const yAxis = new Vector3().crossVectors(zAxis, xAxis).normalize();
    shafts.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, zAxis));
  };


  let solidMat: ShaderMaterial | null = null;
  return {
    root,
    solid() {
      solidMat ??= new ShaderMaterial({
        uniforms,
        vertexShader: 'varying vec3 vWorld; varying vec3 vNormal; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }',
        fragmentShader: puffFragment,
        fog: false,
        alphaToCoverage: true,
      });
      return solidMat;
    },
    apply(st) {
      uniforms.uLit.value.copy(st.cloudLit);
      uniforms.uShade.value.copy(st.cloudShade);
      uniforms.uUnder.value.copy(st.cloudUnder);
      uniforms.uFog.value.copy(st.fog);
      uniforms.uSunDir.value.copy(st.night > 0.5 ? st.moonDir : st.sunDir);
      aimShafts(st);
    },
    addDrifters(g) {
      const n = 6;
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
