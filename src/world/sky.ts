/**
 * The sky dome and the light. The dome follows the viewer (no parallax), is drawn first
 * without depth, and paints a gradient from the horizon to the zenith with a soft glow
 * around the sun, the sun disc, a pale band on the side opposite the sun at dusk, stars and
 * a moon at night. One sun (or moon) light and one hemisphere light, no shadow maps.
 */
import {
  BackSide,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  Object3D,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { SkyState } from './daylight';
import { U } from './materials';

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99995, p.w);
}`;

const fragment = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uFog;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  float up = clamp(el, 0.0, 1.0);
  vec3 c = up < 0.12 ? mix(uHorizon, uMid, smoothstep(0.0, 0.12, up)) : mix(uMid, uZenith, pow(smoothstep(0.12, 1.0, up), 0.55));
  // below the horizon the sky meets the haze over the cloud sea
  c = mix(c, uFog, smoothstep(0.02, -0.12, el));

  float sunUp = smoothstep(-0.16, 0.04, uSunDir.y);
  float sd = max(dot(d, uSunDir), 0.0);
  float nearHorizon = 1.0 - smoothstep(0.0, 0.55, abs(el));
  c += uSun * (pow(sd, 5.0) * 0.32 * (0.35 + 0.65 * nearHorizon) + pow(sd, 48.0) * 0.45) * sunUp;
  // warm band all round the horizon while the sun is low
  float low = 1.0 - smoothstep(0.05, 0.45, abs(uSunDir.y));
  c = mix(c, mix(c, uSun, 0.35), low * nearHorizon * nearHorizon * 0.55 * (0.4 + 0.6 * sd));
  // sun disc
  float disc = smoothstep(0.9994, 0.9997, dot(d, uSunDir));
  c = mix(c, vec3(1.0, 0.95, 0.82), disc * smoothstep(-0.03, 0.02, uSunDir.y));

  // stars
  if (uStars > 0.01 && el > 0.0) {
    vec3 p = d * 160.0;
    vec3 cell = floor(p);
    float h = hash(cell);
    if (h > 0.965) {
      vec3 jitter = vec3(hash(cell + 1.3), hash(cell + 2.7), hash(cell + 4.1)) - 0.5;
      float dist = length(fract(p) - 0.5 - jitter * 0.6);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
      float s = smoothstep(0.16, 0.0, dist) * tw * smoothstep(0.0, 0.25, el);
      c += vec3(1.0, 0.96, 0.88) * s * uStars * (h > 0.993 ? 1.4 : 0.8);
    }
    // a faint band of the milky way
    float band = exp(-pow(dot(d, normalize(vec3(0.3, 0.2, 1.0))) / 0.22, 2.0));
    c += vec3(0.35, 0.42, 0.6) * band * 0.08 * uStars * smoothstep(0.0, 0.3, el);
  }
  // moon
  if (uNight > 0.01) {
    float md = dot(d, uMoonDir);
    float moon = smoothstep(0.99955, 0.99975, md);
    float halo = pow(max(md, 0.0), 220.0) * 0.25 + pow(max(md, 0.0), 24.0) * 0.06;
    c += (vec3(0.98, 0.95, 0.86) * moon + vec3(0.6, 0.7, 0.9) * halo) * uNight;
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

export interface SkyRig {
  dome: Mesh;
  sun: DirectionalLight;
  hemi: HemisphereLight;
  apply(s: SkyState): void;
  follow(eye: Vector3): void;
}

export function createSky(root: Object3D): SkyRig {
  const material = new ShaderMaterial({
    uniforms: {
      uZenith: { value: new Color() },
      uMid: { value: new Color() },
      uHorizon: { value: new Color() },
      uFog: { value: new Color() },
      uSun: { value: new Color() },
      uSunDir: { value: new Vector3(0, 1, 0) },
      uMoonDir: { value: new Vector3(0, 1, 0) },
      uStars: { value: 0 },
      uNight: { value: 0 },
      uTime: U.time,
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  material.name = 'world:sky';
  const dome = new Mesh(new SphereGeometry(100, 32, 18), material);
  dome.name = 'world:sky';
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  dome.raycast = () => {};
  root.add(dome);

  const sun = new DirectionalLight('#fff4e2', 2.5);
  sun.name = 'world:sun';
  sun.castShadow = false;
  root.add(sun, sun.target);
  const hemi = new HemisphereLight('#c6ddf2', '#9d906b', 1.3);
  hemi.name = 'world:hemi';
  root.add(hemi);

  const u = material.uniforms;
  return {
    dome,
    sun,
    hemi,
    apply(s) {
      (u.uZenith.value as Color).copy(s.zenith);
      (u.uMid.value as Color).copy(s.mid);
      (u.uHorizon.value as Color).copy(s.horizon);
      (u.uFog.value as Color).copy(s.fog);
      (u.uSun.value as Color).copy(s.sun);
      (u.uSunDir.value as Vector3).copy(s.sunDir);
      (u.uMoonDir.value as Vector3).copy(s.moonDir);
      u.uStars.value = s.stars;
      u.uNight.value = s.night;
      sun.color.copy(s.sun);
      sun.intensity = s.sunI;
      sun.position.copy(s.lightDir).multiplyScalar(30);
      sun.target.position.set(0, 0, 0);
      hemi.color.copy(s.hemiSky);
      hemi.groundColor.copy(s.hemiGround);
      hemi.intensity = s.hemiI;
    },
    follow(eye) {
      dome.position.copy(eye);
    },
  };
}
