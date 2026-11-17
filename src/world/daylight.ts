/**
 * Time of day from the real clock. The sun rises in the east (left of the seat, −x), passes
 * high behind the person (south, +z) and sets in the west (right, +x), so the house fronts
 * that face the seat are lit by day and catch the low gold light at sunset. The moon stands
 * in front of the person at night.
 *
 * Colours are keyframes on the local clock (sRGB hex), blended smoothly between neighbours.
 */
import { Color, Vector3 } from '@iwsdk/core';

export interface SkyKey {
  zenith: string;
  /** Band between the horizon and the zenith; keeps dusk from mixing orange and blue into mauve. */
  mid: string;
  horizon: string;
  /** Colour of the haze and of the far cloud sea. */
  fog: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
  cloudLit: string;
  cloudShade: string;
  /** Warm tint on the undersides of clouds (lit from below at sunset). */
  cloudUnder: string;
  stars: number;
  /** Window and lantern glow, 0..1. */
  glow: number;
  water: string;
}

const NIGHT: SkyKey = {
  mid: '#132a4a', zenith: '#07142b', horizon: '#1d3557', fog: '#1a2c47', sun: '#a9c1e8', sunI: 0.55,
  hemiSky: '#4a6694', hemiGround: '#1c2433', hemiI: 1.0, cloudLit: '#4d6791', cloudShade: '#1b2a44', cloudUnder: '#26365a',
  stars: 1, glow: 1, water: '#2a4a6a',
};
const DAWN: SkyKey = {
  mid: '#e9c3a4', zenith: '#2c4d7c', horizon: '#eaa98a', fog: '#cfa293', sun: '#ffb58c', sunI: 0.9,
  hemiSky: '#9fb1cc', hemiGround: '#6e5d5a', hemiI: 1.2, cloudLit: '#f4bea6', cloudShade: '#7c8396', cloudUnder: '#e59d86',
  stars: 0.35, glow: 0.7, water: '#6d8fae',
};
const MORNING: SkyKey = {
  mid: '#cfe2ee', zenith: '#6fa8dc', horizon: '#f6dcc0', fog: '#ebdccb', sun: '#ffe3bc', sunI: 2.3,
  hemiSky: '#c4dbef', hemiGround: '#a8936f', hemiI: 1.35, cloudLit: '#fff4e8', cloudShade: '#b9c4d4', cloudUnder: '#f3d3bd',
  stars: 0, glow: 0, water: '#6fb1d0',
};
const DAY: SkyKey = {
  mid: '#9cc8ea', zenith: '#4f97de', horizon: '#cfe6f2', fog: '#d4e6ef', sun: '#fff4e2', sunI: 2.7,
  hemiSky: '#c6ddf2', hemiGround: '#9d906b', hemiI: 1.35, cloudLit: '#ffffff', cloudShade: '#c2cedd', cloudUnder: '#e6edf2',
  stars: 0, glow: 0, water: '#5fb0d6',
};
const GOLDEN: SkyKey = {
  mid: '#f6dfb2', zenith: '#5a8ec6', horizon: '#ffd49c', fog: '#f3d1aa', sun: '#ffc27a', sunI: 2.6,
  hemiSky: '#e7cfb0', hemiGround: '#a37b5a', hemiI: 1.3, cloudLit: '#ffe2bb', cloudShade: '#c7a59b', cloudUnder: '#ffc39a',
  stars: 0, glow: 0.15, water: '#7fb4c8',
};
const SUNSET: SkyKey = {
  mid: '#f7cf98', zenith: '#3f6a9c', horizon: '#ffa766', fog: '#eaa988', sun: '#ff9d5c', sunI: 2.0,
  hemiSky: '#d2aba0', hemiGround: '#8b5f55', hemiI: 1.25, cloudLit: '#ffbd8c', cloudShade: '#9e8180', cloudUnder: '#ff9b72',
  stars: 0.05, glow: 0.6, water: '#c08a7a',
};
const EVENING: SkyKey = {
  mid: '#2a5468', zenith: '#13304f', horizon: '#41707f', fog: '#30566a', sun: '#a9c3da', sunI: 0.75,
  hemiSky: '#567a96', hemiGround: '#2a3440', hemiI: 1.15, cloudLit: '#7495aa', cloudShade: '#2d4354', cloudUnder: '#4f6f86',
  stars: 0.55, glow: 1, water: '#3c6680',
};

/** Keyframes on the local clock, hours 0..24. */
const KEYS: [number, SkyKey][] = [
  [0, NIGHT], [4.6, NIGHT], [5.7, DAWN], [7.0, MORNING], [9.5, DAY], [16.2, DAY],
  [18.1, GOLDEN], [19.3, SUNSET], [20.1, EVENING], [21.2, NIGHT], [24, NIGHT],
];

const SUNRISE = 6.0;
const SUNSET_H = 19.5;

export interface SkyState {
  hour: number;
  /** Unit vector toward the sun (below the horizon at night). */
  sunDir: Vector3;
  /** Unit vector toward the moon (fixed in front of the seat, high). */
  moonDir: Vector3;
  /** Unit vector of the main light: the sun by day, the moon by night. */
  lightDir: Vector3;
  zenith: Color;
  horizon: Color;
  fog: Color;
  sun: Color;
  sunI: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiI: number;
  cloudLit: Color;
  cloudShade: Color;
  cloudUnder: Color;
  water: Color;
  stars: number;
  glow: number;
  /** 0 by day, 1 at full night. */
  night: number;
}

const ease = (t: number): number => t * t * (3 - 2 * t);

export function hourOf(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

/** Direction of the sun for a local hour. */
export function sunDirAt(hour: number, out = new Vector3()): Vector3 {
  const day = SUNSET_H - SUNRISE;
  const phi = (Math.PI * (hour - SUNRISE)) / day;
  let el: number;
  if (hour >= SUNRISE && hour <= SUNSET_H) el = Math.sin(phi) * (54 * Math.PI) / 180;
  else {
    // below the horizon at night: sink to −30° at midnight-ish
    const h = hour < SUNRISE ? hour + 24 : hour;
    const k = (h - SUNSET_H) / (24 - day);
    el = -Math.sin(Math.PI * k) * (30 * Math.PI) / 180 - 0.02;
  }
  const phiC = Math.max(-0.4, Math.min(Math.PI + 0.4, phi));
  const x = -Math.cos(phiC);
  const z = Math.sin(phiC) * 0.75 + 0.05;
  const h = Math.hypot(x, z) || 1;
  out.set((x / h) * Math.cos(el), Math.sin(el), (z / h) * Math.cos(el));
  return out.normalize();
}

const MOON = new Vector3(-0.42, 0.62, -0.66).normalize();

export function skyAt(date: Date | number): SkyState {
  const hour = typeof date === 'number' ? ((date % 24) + 24) % 24 : hourOf(date);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1][0] <= hour) i++;
  const [h0, a] = KEYS[i];
  const [h1, b] = KEYS[i + 1];
  const t = ease(Math.max(0, Math.min(1, (hour - h0) / Math.max(1e-6, h1 - h0))));
  const c = (k: keyof SkyKey): Color => new Color(a[k] as string).lerp(new Color(b[k] as string), t);
  const n = (k: keyof SkyKey): number => (a[k] as number) * (1 - t) + (b[k] as number) * t;
  const sunDir = sunDirAt(hour);
  const night = Math.max(0, Math.min(1, (-sunDir.y - 0.02) / 0.16));
  const lightDir = sunDir.y > -0.05 ? sunDir.clone() : MOON.clone();
  if (sunDir.y > -0.05 && sunDir.y < 0.06) {
    // keep the sun light a little above the horizon so surfaces still catch it
    lightDir.y = Math.max(lightDir.y, 0.06);
    lightDir.normalize();
  }
  return {
    hour,
    sunDir,
    moonDir: MOON.clone(),
    lightDir,
    zenith: c('zenith'),
    mid: c('mid'),
    horizon: c('horizon'),
    fog: c('fog'),
    sun: c('sun'),
    sunI: n('sunI'),
    hemiSky: c('hemiSky'),
    hemiGround: c('hemiGround'),
    hemiI: n('hemiI'),
    cloudLit: c('cloudLit'),
    cloudShade: c('cloudShade'),
    cloudUnder: c('cloudUnder'),
    water: c('water'),
    stars: n('stars'),
    glow: n('glow'),
    night,
  };
}

/** A date today at the given local hour (for previews and tests). */
export function atHour(hour: number): Date {
  const d = new Date();
  d.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return d;
}
