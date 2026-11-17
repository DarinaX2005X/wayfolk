/**
 * One wind for the whole island, the same on the CPU and on the GPU.
 *
 * The wind blows along `dir` (unit vector on the ground plane, slowly turning) with a base
 * `strength`; gusts are bands that travel across the island in the wind direction (about
 * 6 m/s, 18 m apart, bent by a slow cross-wave), so grass waves visibly roll past instead of
 * swaying in step. `sample()` in JS and `windVec()` in GLSL use the same formula, so a
 * scarf animated by the life module leans with the grass beside it.
 *
 *   import { wind } from '../world/wind';
 *   wind.sample(pos, t, out)   → Vector3 in m/s (y carries a little lift in gusts)
 *   wind.gust(x, z, t)         → 0..1 how strong the gust is here and now
 *   wind.uniforms              → { uWindDir, uWindStrength, uWindTime } for ShaderMaterials
 *   WIND_GLSL                  → GLSL with windGust(vec2 xz) and windVec(vec3 p) using them
 *
 * Time `t` is in seconds; the world advances `wind.time` every frame (wind.update), and
 * shaders read the same value from uWindTime.
 */
import { Vector2, Vector3 } from '@iwsdk/core';

export interface WindUniforms {
  uWindDir: { value: Vector2 };
  uWindStrength: { value: number };
  uWindTime: { value: number };
}

export interface Wind {
  /** Direction the wind blows toward, unit length on xz (x, z). */
  readonly dir: Vector2;
  /** Base strength, 0 calm .. 1 breezy (2 stormy). */
  strength: number;
  /** Seconds, advanced by update(). */
  readonly time: number;
  uniforms: WindUniforms;
  /** 0..1 gust intensity at (x, z) at time t (default now). */
  gust(x: number, z: number, t?: number): number;
  /** Wind velocity at a point, in m/s. */
  sample(pos: { x: number; y: number; z: number }, t?: number, out?: Vector3): Vector3;
  /** Advance the clock (seconds since start) and let the direction drift. */
  update(t: number): void;
}

const GUST_K = 0.35; // wave number along the wind: 18 m between gusts
const GUST_W = 2.2; // angular speed: 2.2 / 0.35 ≈ 6.3 m/s
const BASE_SPEED = 3.2; // m/s at strength 1 between gusts
const GUST_SPEED = 5.5; // extra m/s in a full gust

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function gustAt(dx: number, dz: number, x: number, z: number, t: number): number {
  const qx = x * dx + z * dz;
  const qy = -x * dz + z * dx;
  const wave = Math.sin(qx * GUST_K - t * GUST_W + Math.sin(qy * 0.21 + t * 0.13) * 1.7);
  const wave2 = Math.sin(qx * 0.13 - t * 0.9 + qy * 0.07);
  return smoothstep(0.2, 1.0, wave * 0.6 + wave2 * 0.5 + 0.1);
}

export const WIND_GLSL = /* glsl */ `
uniform vec2 uWindDir;
uniform float uWindStrength;
uniform float uWindTime;
float windGust(vec2 p) {
  vec2 d = uWindDir;
  float qx = dot(p, d);
  float qy = dot(p, vec2(-d.y, d.x));
  float wave = sin(qx * ${GUST_K.toFixed(3)} - uWindTime * ${GUST_W.toFixed(3)} + sin(qy * 0.21 + uWindTime * 0.13) * 1.7);
  float wave2 = sin(qx * 0.13 - uWindTime * 0.9 + qy * 0.07);
  return smoothstep(0.2, 1.0, wave * 0.6 + wave2 * 0.5 + 0.1);
}
vec3 windVec(vec3 p) {
  float g = windGust(p.xz);
  float s = uWindStrength * (${BASE_SPEED.toFixed(2)} + ${GUST_SPEED.toFixed(2)} * g);
  return vec3(uWindDir.x * s, g * uWindStrength * 0.4, uWindDir.y * s);
}
`;

function createWind(): Wind {
  const dir = new Vector2(0.86, -0.5).normalize();
  const uniforms: WindUniforms = {
    uWindDir: { value: dir },
    uWindStrength: { value: 1 },
    uWindTime: { value: 0 },
  };
  let time = 0;
  let eff = 1;
  const w: Wind = {
    dir,
    strength: 1,
    get time() {
      return time;
    },
    uniforms,
    gust(x, z, t = time) {
      return gustAt(dir.x, dir.y, x, z, t);
    },
    sample(pos, t = time, out = new Vector3()) {
      const g = gustAt(dir.x, dir.y, pos.x, pos.z, t);
      const s = eff * (BASE_SPEED + GUST_SPEED * g);
      return out.set(dir.x * s, g * eff * 0.4, dir.y * s);
    },
    update(t) {
      time = t;
      // the wind turns a few degrees over minutes and breathes in strength
      const a = Math.atan2(-0.5, 0.86) + Math.sin(t * 0.004) * 0.25;
      dir.set(Math.cos(a), Math.sin(a));
      eff = w.strength * (0.85 + 0.15 * Math.sin(t * 0.05));
      uniforms.uWindStrength.value = eff;
      uniforms.uWindTime.value = t;
    },
  };
  return w;
}

/** The island's wind (one per page). */
export const wind: Wind = createWind();
