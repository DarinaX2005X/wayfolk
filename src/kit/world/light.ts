/**
 * One light (DESIGN "Геометрия, материалы и свет"): the key sun at azimuth −35° (front
 * left) and 24° high, #FFE8C6, 2.2 in the Void and 1.2 in Room, and a hemisphere fill
 * (sky #CFDCE0, ground #8C7B66, 0.9). No shadow map anywhere: shadows are patches
 * (./shadow.ts). Low quality turns the long shadows off.
 */
import { DirectionalLight, HemisphereLight, Object3D, type World } from '@iwsdk/core';
import { LIGHT } from '../../tokens/tokens';
import { animate, easeInOut, installKit, now, progress, setKitQuality, type KitQuality } from './time';

export type LightRig = {
  root: Object3D;
  key: DirectionalLight;
  fill: HemisphereLight;
  setMode(mode: 'void' | 'room', ms?: number): void;
  setQuality(level: KitQuality): void;
  readonly quality: KitQuality;
  update(t: number): void;
};

/** The sun's direction in the seated frame (unit vector towards the sun). */
export function sunDirection(): [number, number, number] {
  const az = (LIGHT.key.az * Math.PI) / 180;
  const el = (LIGHT.key.el * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

export function createLight(world: World | null): LightRig {
  if (world) installKit(world);
  const root = new Object3D();
  root.name = 'kit:light';
  const key = new DirectionalLight(LIGHT.key.color, LIGHT.key.void);
  const [x, y, z] = sunDirection();
  key.position.set(x * 10, y * 10, z * 10);
  key.castShadow = false;
  root.add(key, key.target);
  key.target.position.set(0, 0, 0);
  const fill = new HemisphereLight(LIGHT.fill.sky, LIGHT.fill.ground, LIGHT.fill.intensity);
  root.add(fill);

  let from: number = LIGHT.key.void;
  let to: number = LIGHT.key.void;
  let start = -Infinity;
  let ms = 800;
  let quality: KitQuality = 'high';
  const rig: LightRig = {
    root,
    key,
    fill,
    get quality() {
      return quality;
    },
    setMode(mode, duration = 800) {
      from = key.intensity;
      to = mode === 'room' ? LIGHT.key.room : LIGHT.key.void;
      start = now();
      ms = duration;
    },
    setQuality(level) {
      quality = level;
      setKitQuality(level);
    },
    update(t) {
      key.intensity = from + (to - from) * easeInOut(progress(t, start, ms));
    },
  };
  animate(rig);
  return rig;
}
