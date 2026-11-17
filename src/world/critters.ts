/**
 * Small living things, all moved on the GPU from time alone: butterflies and bees over the
 * meadow by day, fireflies over the grass and the pond at night, seeds and petals carried
 * by the wind, a flock of far birds circling over the clouds, and a fish that jumps in the
 * pond now and then with a ring of ripples.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  Object3D,
  Points,
  RingGeometry,
  ShaderMaterial,
  Vector3,
} from '@iwsdk/core';
import { rng } from './geo';
import { CENTER, Land, POND, SEAT } from './land';
import { U } from './materials';
import { WIND_GLSL, wind } from './wind';

const flyerVertex = /* glsl */ `
${WIND_GLSL}
uniform float uTime;
uniform float uShow;
attribute vec3 aHome;
attribute vec4 aParam; // speed, radius, flap speed, size
attribute vec3 aColor;
attribute float aSeed;
varying vec3 vColor;
void main() {
  float t = uTime * aParam.x + aSeed * 17.0;
  vec3 off = vec3(sin(t * 0.7) * aParam.y + sin(t * 1.9) * aParam.y * 0.3,
                  0.45 + sin(t * 1.3 + aSeed) * 0.25 + sin(t * 3.1) * 0.06,
                  cos(t * 0.5) * aParam.y + cos(t * 2.3) * aParam.y * 0.25);
  vec3 vel = vec3(cos(t * 0.7) * 0.7 * aParam.y + cos(t * 1.9) * 1.9 * aParam.y * 0.3, 0.0, -sin(t * 0.5) * 0.5 * aParam.y - sin(t * 2.3) * 2.3 * aParam.y * 0.25);
  vec3 c = aHome + off;
  c.xz += uWindDir * windGust(c.xz) * 0.25;
  float heading = atan(vel.x, vel.z);
  vec3 p = position * aParam.w * uShow;
  // wings flap about the body axis
  float side = sign(position.x);
  float flap = sin(uTime * aParam.z + aSeed * 9.0) * 0.9 + 0.25;
  float ax = abs(p.x);
  p = vec3(side * ax * cos(flap), ax * sin(flap) + p.y, p.z);
  float ch = cos(heading), sh = sin(heading);
  p = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch);
  vColor = aColor * (abs(position.x) < 0.01 ? 0.35 : 1.0);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(c + p, 1.0);
}`;

const flyerFragment = /* glsl */ `
uniform vec3 uLight;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor * uLight, 1.0);
  #include <colorspace_fragment>
}`;

const sparkVertex = /* glsl */ `
${WIND_GLSL}
uniform float uTime;
uniform float uSize;
uniform float uMode; // 0 fireflies, 1 drifting seeds
attribute vec3 aSeedV;
varying float vBlink;
void main() {
  vec3 p = position;
  float s = aSeedV.x;
  if (uMode < 0.5) {
    p += vec3(sin(uTime * 0.31 + s * 11.0) * 1.2, sin(uTime * 0.53 + s * 7.0) * 0.35, cos(uTime * 0.27 + s * 5.0) * 1.2);
    vBlink = smoothstep(0.55, 1.0, sin(uTime * (0.9 + aSeedV.y) + s * 30.0) * 0.5 + 0.5);
  } else {
    // seeds ride the wind across a 40 m square round the island and wrap round
    float span = 40.0;
    float travel = uTime * (1.2 + aSeedV.y * 1.5) + s * span;
    vec2 base = position.xz + uWindDir * travel;
    vec2 c = vec2(${CENTER.x.toFixed(2)}, ${CENTER.z.toFixed(2)});
    vec2 rel = mod(base - c + span * 0.5, span) - span * 0.5;
    p.xz = c + rel;
    float g = windGust(p.xz);
    p.y = position.y + sin(uTime * 0.8 + s * 13.0) * 0.4 + g * 0.8;
    vBlink = 0.55 + 0.45 * g;
  }
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * (1.0 / max(0.5, -mv.z)) * 300.0;
  gl_Position = projectionMatrix * mv;
}`;

const sparkFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uShow;
varying float vBlink;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d));
  float k = a * vBlink * uShow;
  if (k < 0.01) discard;
  gl_FragColor = vec4(uColor * k, k);
  #include <colorspace_fragment>
}`;

const birdVertex = /* glsl */ `
uniform float uTime;
attribute vec4 aOrbit; // radius, height, speed, phase
varying float vShade;
void main() {
  float a = uTime * aOrbit.z + aOrbit.w;
  vec3 c = vec3(${CENTER.x.toFixed(2)} + cos(a) * aOrbit.x, aOrbit.y + sin(a * 2.0) * 2.0, ${CENTER.z.toFixed(2)} + sin(a) * aOrbit.x);
  float flap = sin(uTime * 6.0 + aOrbit.w * 5.0);
  flap = flap * smoothstep(-0.2, 0.4, sin(uTime * 0.4 + aOrbit.w));
  vec3 p = position;
  p.y += abs(p.x) * flap * 0.6;
  float heading = a + 1.5708 * sign(aOrbit.z);
  float ch = cos(heading), sh = sin(heading);
  p = vec3(p.x * ch + p.z * sh, p.y, -p.x * sh + p.z * ch);
  vShade = 1.0;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(c + p, 1.0);
}`;

const birdFragment = /* glsl */ `
uniform vec3 uColor;
varying float vShade;
void main() {
  gl_FragColor = vec4(uColor, 1.0);
  #include <colorspace_fragment>
}`;

const fishVertex = /* glsl */ `
uniform float uTime;
uniform vec3 uPond;
varying float vK;
void main() {
  float period = 9.0;
  float cyc = floor(uTime / period);
  float ph = fract(uTime / period);
  float jump = clamp((ph - 0.1) / 0.12, 0.0, 1.0);
  float a = fract(sin(cyc * 12.9898) * 43758.5453) * 6.2831;
  float r = fract(sin(cyc * 78.233) * 13758.5453) * 0.9;
  vec3 base = uPond + vec3(cos(a) * r, 0.0, sin(a) * r);
  vec3 dir = vec3(cos(a + 1.3), 0.0, sin(a + 1.3));
  vec3 c = base + dir * (jump - 0.5) * 0.6 + vec3(0.0, sin(jump * 3.14159) * 0.45 - 0.05, 0.0);
  float pitch = (0.5 - jump) * 2.2;
  vec3 p = position;
  p = vec3(p.x, p.y * cos(pitch) - p.z * sin(pitch), p.y * sin(pitch) + p.z * cos(pitch));
  float yaw = atan(dir.x, dir.z);
  p = vec3(p.x * cos(yaw) + p.z * sin(yaw), p.y, -p.x * sin(yaw) + p.z * cos(yaw));
  float show = step(0.001, jump) * step(jump, 0.999);
  vK = show;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(c + p * show, 1.0);
}`;

const fishFragment = /* glsl */ `
varying float vK;
void main() {
  if (vK < 0.5) discard;
  gl_FragColor = vec4(1.0, 0.55, 0.25, 1.0);
  #include <colorspace_fragment>
}`;

const rippleVertex = /* glsl */ `
uniform float uTime;
uniform vec3 uPond;
varying float vA;
void main() {
  float period = 9.0;
  float cyc = floor(uTime / period);
  float ph = fract(uTime / period);
  float a = fract(sin(cyc * 12.9898) * 43758.5453) * 6.2831;
  float r = fract(sin(cyc * 78.233) * 13758.5453) * 0.9;
  vec3 dir = vec3(cos(a + 1.3), 0.0, sin(a + 1.3));
  vec3 c = uPond + vec3(cos(a) * r, 0.02, sin(a) * r) + dir * 0.3;
  float k = clamp((ph - 0.22) / 0.35, 0.0, 1.0);
  vA = (1.0 - k) * step(0.001, k);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(c + position * (0.15 + k * 1.1), 1.0);
}`;

const rippleFragment = /* glsl */ `
varying float vA;
void main() {
  if (vA < 0.01) discard;
  gl_FragColor = vec4(vec3(0.95, 0.98, 1.0) * vA * 0.6, vA * 0.6);
  #include <colorspace_fragment>
}`;

const smokeVertex = /* glsl */ `
${WIND_GLSL}
uniform float uTime;
uniform vec3 uSources[16];
uniform float uCount;
attribute vec3 aSeedV;
varying float vA;
void main() {
  float idx = floor(aSeedV.x * 16.0);
  vec3 src = uSources[int(idx)];
  float life = fract(uTime * 0.11 + aSeedV.y);
  float up = life * 2.6;
  vec2 drift = uWindDir * (0.4 + windGust(src.xz)) * uWindStrength * life * life * 2.2;
  vec3 p = src + vec3(drift.x + sin(uTime * 0.7 + aSeedV.z * 6.0) * 0.15 * life, up, drift.y + cos(uTime * 0.6 + aSeedV.z * 4.0) * 0.15 * life);
  vA = (idx < uCount ? 1.0 : 0.0) * smoothstep(0.0, 0.12, life) * (1.0 - life);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.25 + life * 0.6) * (1.0 / max(0.5, -mv.z)) * 300.0;
  gl_Position = projectionMatrix * mv;
}`;

const smokeFragment = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(d)) * vA * 0.45;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

export interface Critters {
  /** Chimney tops that smoke (up to 16). */
  setSmoke(tops: Vector3[]): void;
  update(t: number): void;
  setDaylight(night: number, glow: number): void;
  triangles(): number;
}

function wingGeometry(): BufferGeometry {
  // body along z at x = 0, two wings (two triangles each) out to ±x
  const pos = [
    0, 0, 0.5, 0, 0, -0.5, 0, 0.08, 0,
    0, 0, 0.35, 0, 0, -0.25, 1, 0, 0.55,
    0, 0, -0.25, 1, 0, -0.45, 1, 0, 0.55,
    0, 0, 0.35, -1, 0, 0.55, 0, 0, -0.25,
    0, 0, -0.25, -1, 0, 0.55, -1, 0, -0.45,
  ];
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  return g;
}

export function createCritters(parent: Object3D, land: Land): Critters {
  const root = new Object3D();
  root.name = 'world:critters';
  parent.add(root);
  const r = rng(555);
  const time = U.time;

  // butterflies and bees
  const nB = 18;
  const nBee = 14;
  const n = nB + nBee;
  const geo = wingGeometry();
  const home = new Float32Array(n * 3);
  const param = new Float32Array(n * 4);
  const col = new Float32Array(n * 3);
  const seed = new Float32Array(n);
  const colours = ['#f29b38', '#f7d046', '#ffffff', '#8fc3f0', '#f2828f'].map((h) => new Color(h));
  for (let i = 0; i < n; i++) {
    let x = 0;
    let z = 0;
    for (let k = 0; k < 30; k++) {
      x = SEAT.x + (r() - 0.5) * 18;
      z = SEAT.z - 3 - r() * 14;
      if (land.inside(x, z, 1)) break;
    }
    home[i * 3] = x;
    home[i * 3 + 1] = land.height(x, z) + 0.2;
    home[i * 3 + 2] = z;
    const bee = i >= nB;
    param.set(bee ? [1.6 + r(), 0.5 + r() * 0.6, 60, 0.035] : [0.35 + r() * 0.3, 1.2 + r() * 1.6, 13 + r() * 4, 0.075 + r() * 0.03], i * 4);
    const c = bee ? new Color('#f2c230') : colours[i % colours.length];
    col.set([c.r, c.g, c.b], i * 3);
    seed[i] = r() * 10;
  }
  geo.setAttribute('aHome', new InstancedBufferAttribute(home, 3));
  geo.setAttribute('aParam', new InstancedBufferAttribute(param, 4));
  geo.setAttribute('aColor', new InstancedBufferAttribute(col, 3));
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1));
  const flyMat = new ShaderMaterial({
    uniforms: { uTime: time, uShow: { value: 1 }, uLight: { value: new Color(1, 1, 1) }, ...wind.uniforms },
    vertexShader: flyerVertex,
    fragmentShader: flyerFragment,
    side: DoubleSide,
  });
  flyMat.name = 'world:butterflies';
  const flyers = new InstancedMesh(geo, flyMat, n);
  flyers.name = 'world:butterflies';
  flyers.frustumCulled = false;
  flyers.raycast = () => {};
  for (let i = 0; i < n; i++) flyers.setMatrixAt(i, new Matrix4());
  root.add(flyers);

  // fireflies and drifting seeds
  const spark = (count: number, mode: number, colour: string, size: number, spread: () => [number, number, number]): Points => {
    const pos = new Float32Array(count * 3);
    const sd = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos.set(spread(), i * 3);
      sd.set([r() * 10, r(), r()], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeedV', new BufferAttribute(sd, 3));
    const m = new ShaderMaterial({
      uniforms: { uTime: time, uSize: { value: size }, uMode: { value: mode }, uColor: { value: new Color(colour) }, uShow: { value: 0 }, ...wind.uniforms },
      vertexShader: sparkVertex,
      fragmentShader: sparkFragment,
      transparent: true,
      depthWrite: false,
      blending: mode === 0 ? AdditiveBlending : NormalBlending,
    });
    const pts = new Points(g, m);
    pts.frustumCulled = false;
    pts.raycast = () => {};
    root.add(pts);
    return pts;
  };
  const fireflies = spark(80, 0, '#ffe27a', 0.07, () => {
    for (let k = 0; k < 20; k++) {
      const near = r() < 0.35;
      const x = near ? POND.x + (r() - 0.5) * 6 : SEAT.x + (r() - 0.5) * 20;
      const z = near ? POND.z + (r() - 0.5) * 6 : SEAT.z - 2 - r() * 18;
      if (land.inside(x, z, 0.5)) return [x, land.height(x, z) + 0.3 + r() * 1.4, z];
    }
    return [0, 1, -5];
  });
  fireflies.name = 'world:fireflies';
  const seeds = spark(70, 1, '#fff6ea', 0.035, () => [CENTER.x + (r() - 0.5) * 40, 0.6 + r() * 3.5, CENTER.z + (r() - 0.5) * 40]);
  seeds.name = 'world:seeds';

  // far birds
  const birdGeo = new BufferGeometry();
  birdGeo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0.25, 0, 0, -0.2, 1.1, 0.05, -0.15, 0, 0, 0.25, -1.1, 0.05, -0.15, 0, 0, -0.2]), 3));
  const orbit = new Float32Array(16 * 4);
  for (let i = 0; i < 16; i++) {
    const flock = i < 9 ? 0 : 1;
    orbit.set([flock ? 140 + r() * 6 : 90 + r() * 6, flock ? 22 + r() * 3 : 12 + r() * 3, (flock ? -0.03 : 0.045) * (0.97 + r() * 0.06), (flock ? 2.5 : 0) + r() * 0.12], i * 4);
  }
  birdGeo.setAttribute('aOrbit', new InstancedBufferAttribute(orbit, 4));
  const birdMat = new ShaderMaterial({ uniforms: { uTime: time, uColor: { value: new Color('#3b3a46') } }, vertexShader: birdVertex, fragmentShader: birdFragment, side: DoubleSide });
  const birds = new InstancedMesh(birdGeo, birdMat, 16);
  birds.name = 'world:far-birds';
  birds.frustumCulled = false;
  birds.raycast = () => {};
  for (let i = 0; i < 16; i++) birds.setMatrixAt(i, new Matrix4());
  root.add(birds);

  // a fish in the pond, and its ripple
  const pondY = Land.mainHeight(POND.x + POND.r + 0.2, POND.z) - 0.14;
  const fishGeo = new BufferGeometry();
  fishGeo.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0.05, 0.14, 0.035, 0, 0, 0, -0.04, 0.1, 0, 0.05, 0.14, -0.035, 0, 0, 0, -0.04, 0.1,
    0.035, 0, 0, 0, 0, -0.12, 0, 0.05, 0.02, -0.035, 0, 0, 0, 0, -0.12, 0, 0.05, 0.02,
    0, 0, -0.1, 0, 0.07, -0.2, 0, -0.07, -0.2,
  ]), 3));
  const pondU = { value: new Vector3(POND.x, pondY, POND.z) };
  const fish = new Mesh(fishGeo, new ShaderMaterial({ uniforms: { uTime: time, uPond: pondU }, vertexShader: fishVertex, fragmentShader: fishFragment, side: DoubleSide }));
  fish.name = 'world:fish';
  fish.frustumCulled = false;
  const ringGeo = new RingGeometry(0.85, 1.0, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ripple = new Mesh(ringGeo, new ShaderMaterial({ uniforms: { uTime: time, uPond: pondU }, vertexShader: rippleVertex, fragmentShader: rippleFragment, transparent: true, depthWrite: false }));
  ripple.name = 'world:ripple';
  ripple.frustumCulled = false;
  root.add(fish, ripple);

  // chimney smoke leaning with the wind
  const smokeSrc = Array.from({ length: 16 }, () => new Vector3(0, -100, 0));
  const nSmoke = 160;
  const sp = new Float32Array(nSmoke * 3);
  const sd = new Float32Array(nSmoke * 3);
  for (let i = 0; i < nSmoke; i++) sd.set([(i % 16) / 16 + 0.001, r(), r()], i * 3);
  const smokeGeo = new BufferGeometry();
  smokeGeo.setAttribute('position', new BufferAttribute(sp, 3));
  smokeGeo.setAttribute('aSeedV', new BufferAttribute(sd, 3));
  const smokeMat = new ShaderMaterial({
    uniforms: { uTime: time, uSources: { value: smokeSrc }, uCount: { value: 0 }, uColor: { value: new Color('#e9e4dc') }, ...wind.uniforms },
    vertexShader: smokeVertex,
    fragmentShader: smokeFragment,
    transparent: true,
    depthWrite: false,
  });
  const smoke = new Points(smokeGeo, smokeMat);
  smoke.name = 'world:smoke';
  smoke.frustumCulled = false;
  smoke.raycast = () => {};
  smoke.visible = false;
  root.add(smoke);

  return {
    setSmoke(tops) {
      tops.slice(0, 16).forEach((t, i) => smokeSrc[i].copy(t));
      smokeMat.uniforms.uCount.value = Math.min(16, tops.length);
      smoke.visible = tops.length > 0;
    },
    update() {
      // everything moves in shaders from the shared time uniform
    },
    setDaylight(night, glow) {
      const day = 1 - Math.min(1, night * 1.5 + glow * 0.5);
      flyMat.uniforms.uShow.value = day;
      flyers.visible = day > 0.02;
      (fireflies.material as ShaderMaterial).uniforms.uShow.value = Math.max(0, glow - 0.2) / 0.8;
      fireflies.visible = glow > 0.25;
      (seeds.material as ShaderMaterial).uniforms.uShow.value = 0.35 + 0.65 * day;
      birdMat.uniforms.uColor.value.set(night > 0.5 ? '#1a2033' : '#3b3a46');
      smokeMat.uniforms.uColor.value.set(night > 0.5 ? '#5d6678' : '#ebe5dc');
    },
    triangles: () => n * 5 + 16 * 2 + 5 + 48,
  };
}
