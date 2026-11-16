/**
 * The sky of the Void. IWSDK's DomeGradient has three colours, no sun patch and no
 * transparency, so the kit draws its own dome: an inside-out sphere of 40 m coloured
 * per fragment from the five stops of SKY by elevation, with a soft light patch of 16°
 * around the sun (no disc, no glow), drawn first and without depth. On the level root it
 * sets only the built-in IBLGradient with three sky colours, so ceramic and slate get a
 * soft upper highlight instead of looking like flat plastic.
 *
 * `setMode('room', ms)` dissolves the dome through its opacity in 0.8 s and halves the
 * environment intensity; `setMode('void')` brings both back.
 */
import { BackSide, Color, IBLGradient, Mesh, Object3D, ShaderMaterial, SphereGeometry, type World } from '@iwsdk/core';
import { LIGHT, SKY } from '../../tokens/tokens';
import { zone } from '../../app/perf/zone';
import { animate, easeInOut, installKit, now, progress, lessMotion } from './time';

export type Sky = {
  root: Object3D;
  setMode(mode: 'void' | 'room', ms?: number): void;
  readonly mode: 'void' | 'room';
  /** Opacity of the dome now (0 in Room). */
  opacity(): number;
  update(t: number): void;
};

const RADIUS = 40;
const IBL_INTENSITY = 1;

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragment = /* glsl */ `
uniform vec3 uStops[5];
uniform float uEl[5];
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uSunRadius;
uniform float uOpacity;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  vec3 c = uStops[4];
  for (int i = 0; i < 4; i++) {
    if (el <= uEl[i] && el >= uEl[i + 1]) {
      float k = (el - uEl[i + 1]) / (uEl[i] - uEl[i + 1]);
      // Above +12° the sky deepens quickly toward the dark zenith; elsewhere a smooth step.
      k = i == 0 ? pow(k, 0.45) : k * k * (3.0 - 2.0 * k);
      c = mix(uStops[i + 1], uStops[i], k);
    }
  }
  if (el > uEl[0]) c = uStops[0];
  float a = degrees(acos(clamp(dot(d, uSun), -1.0, 1.0)));
  float glow = exp(-(a * a) / (2.0 * pow(uSunRadius * 0.5, 2.0)));
  c = mix(c, uSunColor, glow * 0.55);
  gl_FragColor = vec4(c, uOpacity);
  #include <colorspace_fragment>
}`;

function dirFrom(azDeg: number, elDeg: number): [number, number, number] {
  const az = (azDeg * Math.PI) / 180;
  const el = (elDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** The dome as a mesh (also used by the gallery and the first-frame shot without a world). */
export function createDomeMesh(): Mesh {
  const stops = SKY.stops.map((s) => new Color(s.color));
  const material = new ShaderMaterial({
    uniforms: {
      uStops: { value: stops },
      uEl: { value: SKY.stops.map((s) => s.el) },
      uSun: { value: dirFrom(SKY.sun.az, SKY.sun.el) },
      uSunColor: { value: new Color(LIGHT.key.color) },
      uSunRadius: { value: SKY.sun.radiusDeg },
      uOpacity: { value: 1 },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: BackSide,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  const mesh = new Mesh(new SphereGeometry(RADIUS, 48, 32), material);
  mesh.name = 'kit:sky';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return mesh;
}

const linear = (hex: string): [number, number, number, number] => {
  const c = new Color(hex);
  return [c.r, c.g, c.b, 1];
};

/** The sky: own dome under the seated frame, IBLGradient on the level root. */
export function createSky(world: World | null): Sky {
  if (world) installKit(world);
  const root = new Object3D();
  root.name = 'kit:sky-root';
  zone(root, 'sky-bench');
  const dome = createDomeMesh();
  root.add(dome);
  const material = dome.material as ShaderMaterial;

  let mode: 'void' | 'room' = 'void';
  let from = 1;
  let to = 1;
  let start = -Infinity;
  let ms: number = SKY.modeMs;

  const setIbl = (k: number): void => {
    if (!world) return;
    const level = world.activeLevel?.value;
    if (!level) return;
    const intensity = IBL_INTENSITY * (SKY.roomEnvScale + (1 - SKY.roomEnvScale) * k);
    if (!level.hasComponent(IBLGradient)) {
      level.addComponent(IBLGradient, { sky: linear(SKY.ibl.sky), equator: linear(SKY.ibl.equator), ground: linear(SKY.ibl.ground), intensity });
    } else level.setValue(IBLGradient, 'intensity', intensity);
  };
  setIbl(1);
  world?.activeLevel?.subscribe(() => setIbl(sky.opacity()));

  let last = -1;
  const sky: Sky = {
    root,
    get mode() {
      return mode;
    },
    setMode(next, duration = SKY.modeMs) {
      if (next === mode) return;
      from = sky.opacity();
      to = next === 'void' ? 1 : 0;
      start = now();
      ms = lessMotion() ? Math.min(duration, 200) : duration;
      mode = next;
    },
    opacity() {
      return from + (to - from) * easeInOut(progress(now(), start, ms));
    },
    update(t) {
      const k = from + (to - from) * easeInOut(progress(t, start, ms));
      material.uniforms.uOpacity.value = k;
      dome.visible = k > 0.002;
      if (Math.abs(k - last) > 1e-4) {
        last = k;
        setIbl(k);
      }
    },
  };
  animate(sky);
  return sky;
}
