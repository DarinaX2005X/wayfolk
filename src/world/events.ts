/**
 * Weather and sky events, each cheap and self-contained, ticked by the world:
 *
 *   rain      streaks round the viewer, rings on the pond, wet darker light; a rainbow after
 *   whale     a big soft cloud whale gliding past the island
 *   star      a shooting star at night that lands glowing within reach of the seat
 *   campfire  flames, sparks and flickering warm light by the fire-pit benches
 *
 * The world blends the sky toward a grey palette while it rains (see index.ts).
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineSegments,
  Mesh,
  Object3D,
  Points,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { blob, cone, join, paint, place, rng } from './geo';
import { CENTER } from './land';
import { U } from './materials';
import { WIND_GLSL, wind } from './wind';
import { whaleGeometry, whaleMaterial } from './whale';

export type WeatherKind = 'clear' | 'rain' | 'drizzle';

// ---------- rain ----------

const rainVertex = /* glsl */ `
${WIND_GLSL}
uniform float uTime;
uniform vec3 uEye;
uniform float uSpeed;
attribute float aEnd;
varying float vEnd;
void main() {
  vec3 p = position;
  float span = 10.0;
  float y = mod(p.y - uTime * uSpeed, span);
  vec2 slant = uWindDir * uWindStrength * 0.18;
  vec3 w = vec3(uEye.x + p.x, uEye.y - 3.0 + y, uEye.z + p.z);
  w.xz += slant * (y - 5.0) * 0.4;
  // the streak's tail trails up and against the wind
  w += aEnd * vec3(-slant.x, 0.55, -slant.y) * 0.9;
  vEnd = aEnd;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;

const rainFragment = /* glsl */ `
uniform float uAmount;
uniform vec3 uColor;
varying float vEnd;
void main() {
  float a = uAmount * (1.0 - vEnd) * 0.45;
  gl_FragColor = vec4(uColor * a, a);
}`;

const bowVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const bowFragment = /* glsl */ `
uniform float uShow;
varying vec2 vUv;
vec3 spectrum(float t) {
  return clamp(vec3(abs(t * 6.0 - 3.0) - 1.0, 2.0 - abs(t * 6.0 - 2.0), 2.0 - abs(t * 6.0 - 4.0)), 0.0, 1.0);
}
void main() {
  // RingGeometry: u runs across the band (inner to outer), v round the arc
  float across = vUv.x;
  vec3 c = spectrum(1.0 - across) * 0.85 + 0.15;
  float edge = smoothstep(0.0, 0.2, across) * smoothstep(1.0, 0.8, across);
  float foot = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.82, vUv.y);
  float a = edge * foot * uShow * 0.32;
  gl_FragColor = vec4(c * a, a);
}`;

const flameVertex = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying float vH;
void main() {
  vUv = uv;
  vec3 p = position;
  float k = uv.y;
  p.x += sin(uTime * 7.0 + position.y * 9.0 + position.z * 5.0) * 0.05 * k;
  p.z += cos(uTime * 6.0 + position.y * 7.0) * 0.04 * k;
  p.y *= 0.85 + 0.2 * sin(uTime * 11.0 + position.x * 13.0);
  vH = k;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const flameFragment = /* glsl */ `
uniform float uOn;
varying vec2 vUv;
varying float vH;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = smoothstep(0.0, 0.6, across) * (1.0 - vH) * uOn;
  vec3 c = mix(vec3(1.0, 0.85, 0.45), vec3(1.0, 0.38, 0.08), vH);
  if (a < 0.01) discard;
  gl_FragColor = vec4(c * a * 1.4, a);
}`;

const sparkVertex = /* glsl */ `
${WIND_GLSL}
uniform float uTime;
uniform vec3 uOrigin;
uniform float uOn;
attribute vec3 aSeed;
varying float vA;
void main() {
  float life = fract(uTime * (0.35 + aSeed.y * 0.3) + aSeed.x);
  vec3 p = uOrigin + vec3((aSeed.z - 0.5) * 0.3, life * 2.4, (aSeed.x - 0.5) * 0.3);
  p.x += sin(uTime * 3.0 + aSeed.x * 20.0) * 0.12 * life + uWindDir.x * life * life * 0.6;
  p.z += cos(uTime * 2.6 + aSeed.y * 20.0) * 0.12 * life + uWindDir.y * life * life * 0.6;
  vA = (1.0 - life) * uOn;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 0.03 * (1.0 / max(0.3, -mv.z)) * 300.0;
  gl_Position = projectionMatrix * mv;
}`;

const sparkFragment = /* glsl */ `
varying float vA;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(d)) * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(1.0, 0.7, 0.3) * a, a);
}`;

const starFragment = /* glsl */ `
uniform float uShow;
uniform float uTime;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d);
  float ang = atan(d.y, d.x);
  float rays = pow(abs(cos(ang * 2.0 + uTime * 0.6)), 24.0) * smoothstep(0.5, 0.0, r) * 0.7;
  float core = smoothstep(0.16, 0.0, r) + smoothstep(0.5, 0.0, r) * 0.35;
  float a = (core + rays) * uShow;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.7) * a, a);
}`;

const billboardVertex = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += (uv - 0.5) * uSize;
  gl_Position = projectionMatrix * mv;
}`;

function quad(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export interface Events {
  root: Object3D;
  setWeather(kind: WeatherKind): void;
  readonly weather: WeatherKind;
  /** 0..1 how much it is raining now (eased). */
  readonly rain: number;
  skyWhale(): Promise<void>;
  shootingStar(target: Vector3): Promise<{ pos: Vector3; star: Object3D; release(): void }>;
  setCampfire(on: boolean): void;
  readonly fireOn: boolean;
  /** Per-frame: time in seconds, frame delta, viewer position in world.root space. */
  update(t: number, dt: number, eye: Vector3, sunDir: Vector3): void;
}

export function createEvents(parent: Object3D, opts: { firePos: Vector3; cloudMaterial: () => ShaderMaterial }): Events {
  const root = new Group();
  root.name = 'world:events';
  parent.add(root);
  const r = rng(321);

  // rain: line segments round the viewer, falling and wrapping
  const nRain = 700;
  const rp = new Float32Array(nRain * 6);
  const re = new Float32Array(nRain * 2);
  for (let i = 0; i < nRain; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.6 + Math.sqrt(r()) * 11;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const y = r() * 10;
    rp.set([x, y, z, x, y, z], i * 6);
    re.set([0, 1], i * 2);
  }
  const rainGeo = new BufferGeometry();
  rainGeo.setAttribute('position', new BufferAttribute(rp, 3));
  rainGeo.setAttribute('aEnd', new BufferAttribute(re, 1));
  const rainU = { uTime: U.time, uEye: { value: new Vector3() }, uSpeed: { value: 9 }, uAmount: { value: 0 }, uColor: { value: new Color('#dfe8f2') }, ...wind.uniforms };
  const rainMat = new ShaderMaterial({ uniforms: rainU, vertexShader: rainVertex, fragmentShader: rainFragment, transparent: true, depthWrite: false, blending: AdditiveBlending });
  rainMat.name = 'world:rain';
  const rainLines = new LineSegments(rainGeo, rainMat);
  rainLines.name = 'world:rain';
  rainLines.frustumCulled = false;
  rainLines.visible = false;
  rainLines.raycast = () => {};
  root.add(rainLines);

  // rainbow: a wide soft arc opposite the sun, after rain
  const bowGeo = new RingGeometry(150, 172, 64, 1, 0, Math.PI);
  const bowU = { uShow: { value: 0 } };
  const bowMat = new ShaderMaterial({ uniforms: bowU, vertexShader: bowVertex, fragmentShader: bowFragment, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false });
  bowMat.name = 'world:rainbow';
  // RingGeometry uv is planar; give it band coordinates instead
  {
    const pos = bowGeo.getAttribute('position');
    const uv = bowGeo.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      uv.setXY(i, (Math.hypot(x, y) - 150) / 22, Math.atan2(y, x) / Math.PI);
    }
  }
  const bow = new Mesh(bowGeo, bowMat);
  bow.name = 'world:rainbow';
  bow.visible = false;
  bow.frustumCulled = false;
  bow.renderOrder = -700;
  bow.raycast = () => {};
  root.add(bow);

  // campfire: crossed flame cards, sparks
  const flameU = { uTime: U.time, uOn: { value: 0 } };
  const flameMat = new ShaderMaterial({ uniforms: flameU, vertexShader: flameVertex, fragmentShader: flameFragment, transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide });
  flameMat.name = 'world:flame';
  const flameGeo = (() => {
    const pos: number[] = [];
    const uv: number[] = [];
    const cards: [number, number, number][] = [[0, 0.55, 0.32], [Math.PI / 3, 0.45, 0.26], [(2 * Math.PI) / 3, 0.5, 0.28], [0.4, 0.32, 0.18]];
    for (const [a, h, w] of cards) {
      const c = Math.cos(a) * w;
      const s = Math.sin(a) * w;
      const v = [[-c, 0, -s, 0, 0], [c, 0, s, 1, 0], [c * 0.2, h, s * 0.2, 1, 1], [-c * 0.2, h, -s * 0.2, 0, 1]];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        pos.push(v[k][0], v[k][1], v[k][2]);
        uv.push(v[k][3], v[k][4]);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    return g;
  })();
  const flame = new Mesh(flameGeo, flameMat);
  flame.name = 'world:flame';
  flame.position.copy(opts.firePos).add(new Vector3(0, 0.12, 0));
  flame.visible = false;
  flame.raycast = () => {};
  flame.renderOrder = 6;
  root.add(flame);
  const nSpark = 40;
  const sp = new Float32Array(nSpark * 3);
  const ss = new Float32Array(nSpark * 3);
  for (let i = 0; i < nSpark; i++) ss.set([r(), r(), r()], i * 3);
  const sparkGeo = new BufferGeometry();
  sparkGeo.setAttribute('position', new BufferAttribute(sp, 3));
  sparkGeo.setAttribute('aSeed', new BufferAttribute(ss, 3));
  const sparkU = { uTime: U.time, uOrigin: { value: opts.firePos.clone().add(new Vector3(0, 0.3, 0)) }, uOn: { value: 0 }, ...wind.uniforms };
  const sparks = new Points(sparkGeo, new ShaderMaterial({ uniforms: sparkU, vertexShader: sparkVertex, fragmentShader: sparkFragment, transparent: true, depthWrite: false, blending: AdditiveBlending }));
  sparks.name = 'world:sparks';
  sparks.frustumCulled = false;
  sparks.visible = false;
  sparks.raycast = () => {};
  root.add(sparks);
  U.firePos.value.copy(opts.firePos).add(new Vector3(0, 0.45, 0));

  let whaleGeo: BufferGeometry | null = null;
  let calfGeo: BufferGeometry | null = null;
  let kind: WeatherKind = 'clear';
  let rainK = 0;
  let bowT = -1;
  let fireOn = false;
  let fireK = 0;
  type Tween = { update(t: number, dt: number): boolean };
  const tweens = new Set<Tween>();

  const events: Events = {
    root,
    get weather() {
      return kind;
    },
    get rain() {
      return rainK;
    },
    get fireOn() {
      return fireOn;
    },
    setWeather(k) {
      if (kind !== 'clear' && k === 'clear') bowT = 0;
      if (k !== 'clear') bowT = -1;
      kind = k;
    },
    skyWhale() {
      const cloud = opts.cloudMaterial();
      whaleGeo ??= whaleGeometry();
      calfGeo ??= whaleGeometry(0.6);
      // a mother and her calf swim an arc round the front of the island, left to right
      const mother = new Mesh(whaleGeo, whaleMaterial(cloud, 1.25, 0, 1.15));
      const calf = new Mesh(calfGeo, whaleMaterial(cloud, 1.7, 1.9, 1.0));
      calf.scale.setScalar(0.4);
      mother.add(calf);
      // the calf swims under its mother's fin, a little toward the island
      calf.position.set(1.5, -8.5, 4.5);
      for (const m of [mother, calf]) {
        m.name = 'world:sky-whale';
        m.frustumCulled = false;
        m.raycast = () => {};
      }
      mother.rotation.order = 'YZX';
      mother.scale.setScalar(1.3);
      root.add(mother);
      const dur = 75;
      const R = 54;
      const a0 = -1.85;
      const a1 = 1.85;
      let t0 = -1;
      const at = (k: number, out: Vector3): Vector3 => {
        const a = a0 + (a1 - a0) * k;
        return out.set(CENTER.x + Math.sin(a) * R, 24 + Math.sin(k * Math.PI) * 2.5, CENTER.z - Math.cos(a) * R);
      };
      const p = new Vector3();
      const q = new Vector3();
      return new Promise<void>((resolve) => {
        tweens.add({
          update(t) {
            if (t0 < 0) t0 = t;
            const k = (t - t0) / dur;
            if (k >= 1) {
              root.remove(mother);
              resolve();
              return false;
            }
            at(k, p);
            at(Math.min(1, k + 0.002), q);
            // rises a little on each down-stroke of the tail
            mother.position.copy(p);
            mother.position.y += Math.sin((t - t0) * 1.25 - 0.6) * 0.45;
            const dir = q.sub(p).normalize();
            // turned a little onto its side toward the island, as if to look
            const roll = -0.1 - 0.08 * Math.sin(k * Math.PI);
            mother.rotation.set(roll + Math.sin((t - t0) * 0.31) * 0.05, Math.atan2(-dir.z, dir.x), Math.cos((t - t0) * 1.25 - 0.6) * 0.035);
            calf.rotation.set(Math.sin((t - t0) * 0.5) * 0.12, 0.06, Math.sin((t - t0) * 1.7 + 1.9) * 0.05);
            const fade = Math.min(1, (t - t0) / 6, (dur - (t - t0)) / 6);
            for (const m of [mother, calf]) {
              const u = (m.material as ShaderMaterial).uniforms;
              u.uFade.value = fade;
            }
            return true;
          },
        });
      });
    },
    shootingStar(target) {
      const star = new Group();
      star.name = 'world:star';
      const starU = { uShow: { value: 1 }, uTime: U.time, uSize: { value: 0.32 } };
      const glow = new Mesh(quad(), new ShaderMaterial({ uniforms: starU, vertexShader: billboardVertex, fragmentShader: starFragment, transparent: true, depthWrite: false, blending: AdditiveBlending }));
      glow.frustumCulled = false;
      glow.renderOrder = 8;
      const core = new Mesh(
        join([paint(place(cone(0.05, 0.05, 5), [0, -0.025, 0]), '#ffe9a8', { glow: true, shade: 0, wobble: 0 }), paint(place(cone(0.05, 0.05, 5), [0, 0.025, 0], [Math.PI, 0, 0]), '#ffe9a8', { glow: true, shade: 0, wobble: 0 })]),
        new ShaderMaterial({ vertexShader: 'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}', fragmentShader: 'void main(){gl_FragColor=vec4(1.0,0.95,0.75,1.0);}' }),
      );
      core.scale.set(1, 1, 0.5);
      star.add(glow, core);
      // the trail: a fading line of points behind the head
      const trailN = 24;
      const trail = new Float32Array(trailN * 3);
      const trailA = new Float32Array(trailN);
      for (let i = 0; i < trailN; i++) trailA[i] = 1 - i / trailN;
      const tg = new BufferGeometry();
      tg.setAttribute('position', new BufferAttribute(trail, 3));
      tg.setAttribute('aA', new BufferAttribute(trailA, 1));
      const trailMat = new ShaderMaterial({
        uniforms: { uShow: { value: 1 } },
        vertexShader: 'attribute float aA; varying float vA; void main(){ vA=aA; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=(0.06+aA*0.25)*(300.0/max(0.5,-mv.z)); gl_Position=projectionMatrix*mv; }',
        fragmentShader: 'uniform float uShow; varying float vA; void main(){ float a=smoothstep(0.5,0.0,length(gl_PointCoord-0.5))*vA*uShow; if(a<0.01) discard; gl_FragColor=vec4(vec3(1.0,0.9,0.65)*a,a); }',
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const trailPts = new Points(tg, trailMat);
      trailPts.frustumCulled = false;
      root.add(star, trailPts);
      const start = target.clone().add(new Vector3(-60, 70, -90));
      const mid = target.clone().add(new Vector3(-6, 9, -12));
      const hist: Vector3[] = [];
      const dur = 3.2;
      let t0 = -1;
      let landed = false;
      let released = false;
      const release = (): void => {
        released = true;
        root.remove(star, trailPts);
      };
      return new Promise((resolve) => {
        tweens.add({
          update(t) {
            if (released) return false;
            if (t0 < 0) t0 = t;
            const k = Math.min(1, (t - t0) / dur);
            if (!landed) {
              // a falling arc that slows into a hover in front of the seat
              const e = 1 - Math.pow(1 - k, 3);
              const a = start.clone().lerp(mid, Math.min(1, e * 1.25));
              star.position.copy(a.lerp(target, Math.max(0, (e - 0.8) / 0.2)));
              hist.unshift(star.position.clone());
              if (hist.length > trailN) hist.pop();
              hist.forEach((h, i) => trail.set([h.x, h.y, h.z], i * 3));
              tg.getAttribute('position').needsUpdate = true;
              starU.uSize.value = 0.32 + (1 - k) * 2.5;
              if (k >= 1) {
                landed = true;
                star.userData.landedAt = t;
                resolve({ pos: target.clone(), star, release });
              }
            } else {
              const since = t - (star.userData.landedAt as number);
              trailMat.uniforms.uShow.value = Math.max(0, 1 - since * 1.5);
              if (star.parent === root) star.position.set(target.x, target.y + Math.sin(t * 1.6) * 0.03, target.z);
              core.rotation.y = t * 0.8;
              starU.uSize.value = 0.32 + Math.sin(t * 3) * 0.03;
            }
            return true;
          },
        });
      });
    },
    setCampfire(on) {
      fireOn = on;
    },
    update(t, dt, eye, sunDir) {
      // rain eases in and out
      const want = kind === 'rain' ? 1 : kind === 'drizzle' ? 0.45 : 0;
      rainK += (want - rainK) * Math.min(1, dt * 0.35);
      if (Math.abs(rainK - want) < 0.002) rainK = want;
      rainLines.visible = rainK > 0.01;
      rainU.uAmount.value = rainK;
      rainU.uSpeed.value = kind === 'drizzle' ? 6 : 10;
      rainU.uEye.value.copy(eye);
      rainGeo.setDrawRange(0, Math.round(nRain * 2 * Math.min(1, rainK * 1.2)) & ~1);
      U.rain.value = rainK;
      U.wet.value = Math.min(1, rainK * 1.4);
      // a rainbow for a minute and a half after rain, opposite the sun
      if (bowT >= 0) {
        bowT += dt;
        const show = Math.min(1, bowT / 6) * Math.min(1, Math.max(0, (95 - bowT) / 20)) * (sunDir.y > 0.02 ? 1 : 0);
        bowU.uShow.value = show;
        bow.visible = show > 0.01;
        if (bow.visible) {
          const away = new Vector3(-sunDir.x, 0, -sunDir.z).normalize();
          bow.position.set(eye.x + away.x * 260, -40, eye.z + away.z * 260);
          bow.lookAt(eye.x, -40, eye.z);
        }
        if (bowT > 95) bowT = -1;
      } else bow.visible = false;
      // the campfire flickers
      fireK += ((fireOn ? 1 : 0) - fireK) * Math.min(1, dt * 1.5);
      const flick = 0.8 + Math.sin(t * 13.0) * 0.08 + Math.sin(t * 7.3 + 1.0) * 0.08 + Math.sin(t * 23.0) * 0.05;
      U.fire.value = fireK * flick * 1.6;
      flameU.uOn.value = fireK;
      sparkU.uOn.value = fireK;
      flame.visible = sparks.visible = fireK > 0.01;
      for (const tw of [...tweens]) if (!tw.update(t, dt)) tweens.delete(tw);
    },
  };
  return events;
}

/** A fire pit: a ring of stones, charred logs, and two log benches facing the seat. */
export function firePitGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const r = rng(77);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const g = blob(0.14 + r() * 0.04, 1, 90 + i, 0.2, 0.7);
    parts.push(paint(g.translate(Math.cos(a) * 0.48, 0.05, Math.sin(a) * 0.48), i % 2 ? '#9c958b' : '#aaa296', { smooth: true, shade: 0.3, mat: 4 }));
  }
  parts.push(paint(new SphereGeometry(0.42, 12, 3, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.12, 1), '#3a2f2a', { shade: 0, mat: 2 }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    const log = place(cone(0.06, 0.6, 6), [0, 0, 0], [0, 0, 0]);
    log.translate(0, -0.3, 0);
    place(log, [Math.cos(a) * 0.12, 0.12, Math.sin(a) * 0.12], [Math.cos(a) * 1.1, 0, -Math.sin(a) * 1.1]);
    parts.push(paint(log, '#5a3b28', { shade: 0.4, mat: 6 }));
  }
  return join(parts);
}
