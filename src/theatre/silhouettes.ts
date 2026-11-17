/**
 * The cut-out silhouettes of the evening theatre, drawn with canvas paths: folk in
 * profile with a cut eye, places with lit windows cut through, things with the details a
 * pair of scissors would leave. Every shape is drawn white on transparent; the stage tints
 * it by depth (far hazy and warm, near dark), so one drawing serves every layer and mood.
 *
 * Each kind draws in a box `aspect` wide and 1 high, y down, standing on y = 1. Folk and
 * vehicles face right; the stage flips them.
 */
import type { SilhouetteKind } from '../mind/types';

type C = CanvasRenderingContext2D;

export type KindInfo = {
  /** Width over height of the drawing box. */
  aspect: number;
  /** Height on the near layer, metres. */
  height: number;
  /** Lives in the sky (default place, flying moves). */
  sky?: boolean;
  /** Keeps its own colours (moon, sun, rainbow); the stage does not tint it dark. */
  light?: boolean;
  /** Folk: walk with a puppet's rocking hop. */
  folk?: boolean;
  /** Wide strip that spans the stage (sea, hills). */
  strip?: boolean;
  /** Weather that fills the stage (rain, snow, stars, wind). */
  weather?: boolean;
};

export const KINDS: Record<SilhouetteKind, KindInfo> = {
  fox: { aspect: 1, height: 0.95, folk: true },
  rabbit: { aspect: 1, height: 1.0, folk: true },
  cat: { aspect: 1, height: 0.9, folk: true },
  bear: { aspect: 1, height: 1.1, folk: true },
  frog: { aspect: 1, height: 0.8, folk: true },
  owl: { aspect: 1, height: 0.9, folk: true },
  deer: { aspect: 1, height: 1.15, folk: true },
  hedgehog: { aspect: 1, height: 0.8, folk: true },
  raccoon: { aspect: 1, height: 0.9, folk: true },
  penguin: { aspect: 1, height: 0.9, folk: true },
  mouse: { aspect: 1, height: 0.8, folk: true },
  otter: { aspect: 1, height: 0.9, folk: true },
  bird: { aspect: 1.2, height: 0.35, sky: true },
  birds: { aspect: 2, height: 0.5, sky: true },
  gull: { aspect: 1.8, height: 0.35, sky: true },
  fish: { aspect: 1.8, height: 0.32 },
  whale: { aspect: 2, height: 1.1, sky: true },
  bee: { aspect: 1.2, height: 0.25, sky: true },
  goat: { aspect: 1.2, height: 0.9, folk: true },
  balloon: { aspect: 0.75, height: 1.5, sky: true },
  'paper-boat': { aspect: 1.6, height: 0.6 },
  boat: { aspect: 1.4, height: 1.1 },
  kite: { aspect: 0.8, height: 1.3, sky: true },
  umbrella: { aspect: 1, height: 0.9, sky: true },
  lantern: { aspect: 0.6, height: 0.55, sky: true, light: true },
  house: { aspect: 1, height: 1.3 },
  town: { aspect: 2.4, height: 1.2 },
  tower: { aspect: 0.5, height: 2.0 },
  lighthouse: { aspect: 0.55, height: 2.2 },
  windmill: { aspect: 0.9, height: 1.9 },
  bridge: { aspect: 2.6, height: 0.6 },
  island: { aspect: 1.6, height: 1.2, sky: true },
  hill: { aspect: 3, height: 0.8, strip: true },
  tree: { aspect: 0.9, height: 1.7 },
  pine: { aspect: 0.6, height: 1.8 },
  rock: { aspect: 1.5, height: 0.5 },
  tent: { aspect: 1.2, height: 1.0 },
  oven: { aspect: 0.9, height: 0.9 },
  teapot: { aspect: 1.3, height: 0.5 },
  cup: { aspect: 1.2, height: 0.3 },
  bread: { aspect: 1.6, height: 0.35 },
  book: { aspect: 1.4, height: 0.4 },
  map: { aspect: 1.4, height: 0.6 },
  telescope: { aspect: 1.1, height: 1.0 },
  fiddle: { aspect: 0.5, height: 0.7 },
  easel: { aspect: 0.8, height: 1.2 },
  hive: { aspect: 0.9, height: 0.7 },
  pumpkin: { aspect: 1.3, height: 0.5 },
  clock: { aspect: 0.8, height: 0.7 },
  key: { aspect: 2, height: 0.25 },
  letter: { aspect: 1.5, height: 0.3, sky: true },
  ladder: { aspect: 0.45, height: 1.5 },
  chair: { aspect: 0.8, height: 0.8 },
  net: { aspect: 1, height: 0.9 },
  flower: { aspect: 0.6, height: 0.6 },
  basket: { aspect: 1.3, height: 0.45 },
  notes: { aspect: 1.2, height: 0.6, sky: true },
  bell: { aspect: 0.9, height: 0.5 },
  boot: { aspect: 1.1, height: 0.5 },
  moon: { aspect: 1, height: 0.75, sky: true, light: true },
  sun: { aspect: 1, height: 0.9, sky: true, light: true },
  cloud: { aspect: 2, height: 0.6, sky: true },
  stars: { aspect: 2.4, height: 1.4, sky: true, light: true, weather: true },
  star: { aspect: 1, height: 0.35, sky: true, light: true },
  rain: { aspect: 2, height: 2, weather: true },
  snow: { aspect: 2, height: 2, weather: true, light: true },
  wind: { aspect: 2.4, height: 0.8, sky: true, weather: true },
  rainbow: { aspect: 2, height: 1.2, sky: true, light: true },
  sea: { aspect: 4, height: 0.5, strip: true },
};

// ---------------------------------------------------------------- path helpers

const TAU = Math.PI * 2;

function ell(c: C, x: number, y: number, rx: number, ry: number, rot = 0): void {
  c.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  c.ellipse(x, y, rx, ry, rot, 0, TAU);
}

function poly(c: C, pts: number[]): void {
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
}

/** A closed smooth curve through the points (quadratic through midpoints). */
function blob(c: C, pts: number[]): void {
  const n = pts.length / 2;
  const mx = (i: number) => (pts[(i % n) * 2] + pts[((i + 1) % n) * 2]) / 2;
  const my = (i: number) => (pts[(i % n) * 2 + 1] + pts[((i + 1) % n) * 2 + 1]) / 2;
  c.moveTo(mx(0), my(0));
  for (let i = 1; i <= n; i += 1) c.quadraticCurveTo(pts[(i % n) * 2], pts[(i % n) * 2 + 1], mx(i), my(i));
  c.closePath();
}

function rr(c: C, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  c.moveTo(x + k, y);
  c.arcTo(x + w, y, x + w, y + h, k);
  c.arcTo(x + w, y + h, x, y + h, k);
  c.arcTo(x, y + h, x, y, k);
  c.arcTo(x, y, x + w, y, k);
  c.closePath();
}

/** Fills what `draw` adds as one shape. */
function solid(c: C, draw: () => void): void {
  c.beginPath();
  draw();
  c.fill();
}

/** Cuts what `draw` adds out of the shape (light shines through). */
function cut(c: C, draw: () => void): void {
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  draw();
  c.fill();
  c.restore();
}

function line(c: C, w: number, pts: number[], round = true): void {
  c.save();
  c.lineWidth = w;
  c.lineCap = round ? 'round' : 'butt';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
  c.restore();
}

function curve(c: C, w: number, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number): void {
  c.save();
  c.lineWidth = w;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x0, y0);
  c.quadraticCurveTo(cx, cy, x1, y1);
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------- folk

type Ears = 'pointy' | 'long' | 'cat' | 'round' | 'big' | 'tufts' | 'none' | 'antlers' | 'small' | 'horns';
type Snout = 'long' | 'short' | 'round' | 'beak' | 'hook' | 'flat' | 'mouse' | 'muzzle';
type Tail = 'bushy' | 'pom' | 'curl' | 'stub' | 'none' | 'thin' | 'thick' | 'ringed' | 'spikes' | 'feathers';
type Animal = { ears: Ears; snout: Snout; tail: Tail; body: [number, number]; head: number; legs: number; wings?: boolean; scarf?: boolean };

const ANIMALS: Record<string, Animal> = {
  fox: { ears: 'pointy', snout: 'long', tail: 'bushy', body: [0.15, 0.19], head: 0.13, legs: 0.09, scarf: true },
  rabbit: { ears: 'long', snout: 'short', tail: 'pom', body: [0.15, 0.18], head: 0.12, legs: 0.07 },
  cat: { ears: 'cat', snout: 'short', tail: 'curl', body: [0.14, 0.18], head: 0.125, legs: 0.08, scarf: true },
  bear: { ears: 'round', snout: 'round', tail: 'stub', body: [0.2, 0.22], head: 0.14, legs: 0.08 },
  frog: { ears: 'none', snout: 'flat', tail: 'none', body: [0.17, 0.17], head: 0.14, legs: 0.07 },
  owl: { ears: 'tufts', snout: 'hook', tail: 'feathers', body: [0.17, 0.22], head: 0.14, legs: 0.04, wings: true },
  deer: { ears: 'antlers', snout: 'muzzle', tail: 'stub', body: [0.13, 0.17], head: 0.11, legs: 0.17, scarf: true },
  hedgehog: { ears: 'small', snout: 'mouse', tail: 'spikes', body: [0.18, 0.18], head: 0.12, legs: 0.06 },
  raccoon: { ears: 'cat', snout: 'short', tail: 'ringed', body: [0.16, 0.19], head: 0.13, legs: 0.08 },
  penguin: { ears: 'none', snout: 'beak', tail: 'none', body: [0.16, 0.26], head: 0.12, legs: 0.03, wings: true, scarf: true },
  mouse: { ears: 'big', snout: 'mouse', tail: 'thin', body: [0.13, 0.17], head: 0.11, legs: 0.06 },
  otter: { ears: 'small', snout: 'round', tail: 'thick', body: [0.14, 0.21], head: 0.115, legs: 0.06 },
  goat: { ears: 'horns', snout: 'muzzle', tail: 'stub', body: [0.17, 0.18], head: 0.11, legs: 0.14 },
};

function animal(c: C, a: Animal): void {
  const [brx, bry] = a.body;
  const feet = 0.97;
  const bx = 0.46;
  const by = feet - a.legs - bry * 0.92;
  const r = a.head;
  const hx = bx + 0.07;
  const hy = by - bry * 0.82 - r * 0.45;
  solid(c, () => {
    // Legs and feet.
    if (a.legs > 0.02) {
      rr(c, bx - 0.07, by + bry * 0.5, 0.06, feet - (by + bry * 0.5), 0.03);
      rr(c, bx + 0.04, by + bry * 0.5, 0.06, feet - (by + bry * 0.5), 0.03);
      ell(c, bx - 0.03, feet - 0.015, 0.05, 0.022);
      ell(c, bx + 0.08, feet - 0.015, 0.05, 0.022);
    } else {
      ell(c, bx - 0.03, feet - 0.02, 0.055, 0.025);
      ell(c, bx + 0.08, feet - 0.02, 0.055, 0.025);
    }
    // Body, a pear: wider below.
    blob(c, [bx - brx * 0.7, by - bry, bx + brx * 0.75, by - bry * 0.95, bx + brx * 1.05, by + bry * 0.3, bx + brx * 0.7, by + bry * 1.0, bx - brx * 0.8, by + bry * 1.0, bx - brx * 1.05, by + bry * 0.25]);
    // Neck and head.
    ell(c, (bx + hx) / 2, by - bry * 0.85, r * 0.7, r * 0.6);
    if (a.snout === 'flat') ell(c, hx, hy + r * 0.1, r * 1.25, r * 0.85);
    else ell(c, hx, hy, r, r * 0.95);
    // Arm, a little forward.
    ell(c, bx + brx * 0.55, by + bry * 0.05, 0.035, bry * 0.55, -0.5);
    ell(c, bx + brx * 0.9, by + bry * 0.45, 0.04, 0.035);
  });
  // Snout.
  solid(c, () => {
    switch (a.snout) {
      case 'long':
        blob(c, [hx + r * 0.3, hy - r * 0.5, hx + r * 1.85, hy + r * 0.22, hx + r * 1.7, hy + r * 0.42, hx + r * 0.4, hy + r * 0.75]);
        ell(c, hx + r * 1.8, hy + r * 0.25, r * 0.16, r * 0.14);
        break;
      case 'short':
        ell(c, hx + r * 0.85, hy + r * 0.28, r * 0.48, r * 0.36);
        ell(c, hx + r * 1.28, hy + r * 0.18, r * 0.12, r * 0.1);
        break;
      case 'round':
        ell(c, hx + r * 0.8, hy + r * 0.3, r * 0.55, r * 0.42);
        ell(c, hx + r * 1.3, hy + r * 0.16, r * 0.15, r * 0.12);
        break;
      case 'muzzle':
        blob(c, [hx + r * 0.2, hy - r * 0.2, hx + r * 1.35, hy + r * 0.15, hx + r * 1.45, hy + r * 0.55, hx + r * 0.9, hy + r * 0.8, hx + r * 0.2, hy + r * 0.7]);
        break;
      case 'mouse':
        blob(c, [hx + r * 0.3, hy - r * 0.35, hx + r * 1.6, hy + r * 0.25, hx + r * 1.5, hy + r * 0.45, hx + r * 0.3, hy + r * 0.7]);
        ell(c, hx + r * 1.6, hy + r * 0.32, r * 0.13, r * 0.12);
        break;
      case 'beak':
        poly(c, [hx + r * 0.6, hy - r * 0.15, hx + r * 1.65, hy + r * 0.25, hx + r * 0.6, hy + r * 0.45]);
        break;
      case 'hook':
        blob(c, [hx + r * 0.7, hy - r * 0.05, hx + r * 1.25, hy + r * 0.1, hx + r * 1.15, hy + r * 0.6, hx + r * 0.75, hy + r * 0.45]);
        break;
      case 'flat':
        break;
    }
  });
  // Ears, horns and the like.
  solid(c, () => {
    switch (a.ears) {
      case 'pointy':
        poly(c, [hx - r * 0.75, hy - r * 0.45, hx - r * 0.55, hy - r * 1.75, hx - r * 0.05, hy - r * 0.8]);
        poly(c, [hx - r * 0.15, hy - r * 0.7, hx + r * 0.2, hy - r * 1.85, hx + r * 0.55, hy - r * 0.65]);
        break;
      case 'long':
        ell(c, hx - r * 0.55, hy - r * 1.5, r * 0.26, r * 1.05, -0.35);
        ell(c, hx - r * 0.05, hy - r * 1.6, r * 0.27, r * 1.1, -0.12);
        break;
      case 'cat':
        poly(c, [hx - r * 0.85, hy - r * 0.35, hx - r * 0.65, hy - r * 1.35, hx - r * 0.1, hy - r * 0.8]);
        poly(c, [hx - r * 0.1, hy - r * 0.75, hx + r * 0.25, hy - r * 1.4, hx + r * 0.6, hy - r * 0.6]);
        break;
      case 'round':
        ell(c, hx - r * 0.6, hy - r * 0.8, r * 0.33, r * 0.33);
        ell(c, hx + r * 0.25, hy - r * 0.92, r * 0.33, r * 0.33);
        break;
      case 'big':
        ell(c, hx - r * 0.6, hy - r * 0.95, r * 0.55, r * 0.55);
        ell(c, hx + r * 0.25, hy - r * 1.05, r * 0.5, r * 0.5);
        break;
      case 'small':
        ell(c, hx - r * 0.55, hy - r * 0.8, r * 0.24, r * 0.26);
        ell(c, hx + r * 0.15, hy - r * 0.9, r * 0.24, r * 0.26);
        break;
      case 'tufts':
        poly(c, [hx - r * 0.95, hy - r * 0.45, hx - r * 1.0, hy - r * 1.3, hx - r * 0.45, hy - r * 0.8]);
        poly(c, [hx + r * 0.35, hy - r * 0.85, hx + r * 0.75, hy - r * 1.4, hx + r * 0.85, hy - r * 0.5]);
        break;
      case 'antlers':
        ell(c, hx - r * 0.75, hy - r * 0.7, r * 0.42, r * 0.18, -0.5);
        break;
      case 'horns':
        break;
      case 'none':
        if (a.snout === 'flat') {
          ell(c, hx - r * 0.45, hy - r * 0.62, r * 0.32, r * 0.3);
          ell(c, hx + r * 0.45, hy - r * 0.62, r * 0.32, r * 0.3);
        }
        break;
    }
  });
  if (a.ears === 'antlers') {
    line(c, 0.022, [hx - r * 0.2, hy - r * 0.8, hx - r * 0.45, hy - r * 1.8, hx - r * 0.9, hy - r * 2.5]);
    line(c, 0.018, [hx - r * 0.42, hy - r * 1.7, hx + r * 0.15, hy - r * 2.3]);
    line(c, 0.016, [hx - r * 0.62, hy - r * 2.1, hx - r * 1.3, hy - r * 2.2]);
    line(c, 0.02, [hx + r * 0.1, hy - r * 0.85, hx + r * 0.25, hy - r * 1.6, hx + r * 0.05, hy - r * 2.2]);
    line(c, 0.016, [hx + r * 0.22, hy - r * 1.45, hx + r * 0.7, hy - r * 1.85]);
  }
  if (a.ears === 'horns') {
    curve(c, 0.035, hx - r * 0.1, hy - r * 0.7, hx - r * 0.5, hy - r * 1.9, hx - r * 1.2, hy - r * 1.3);
    solid(c, () => ell(c, hx - r * 0.7, hy - r * 0.55, r * 0.4, r * 0.15, 0.4));
  }
  // Tails.
  const tx = bx - brx * 0.9;
  const ty = by + bry * 0.55;
  solid(c, () => {
    switch (a.tail) {
      case 'bushy':
        blob(c, [tx + 0.03, ty - 0.02, tx - 0.12, ty - 0.02, tx - 0.25, ty - 0.18, tx - 0.24, ty - 0.33, tx - 0.17, ty - 0.24, tx - 0.06, ty + 0.06]);
        break;
      case 'ringed':
        blob(c, [tx + 0.03, ty - 0.02, tx - 0.14, ty + 0.0, tx - 0.25, ty - 0.14, tx - 0.27, ty - 0.29, tx - 0.18, ty - 0.2, tx - 0.06, ty + 0.07]);
        break;
      case 'pom':
        ell(c, tx + 0.01, ty, 0.055, 0.055);
        break;
      case 'stub':
        ell(c, tx + 0.02, ty - 0.03, 0.04, 0.03, -0.5);
        break;
      case 'thick':
        blob(c, [tx + 0.03, ty - 0.03, tx - 0.1, ty + 0.12, tx - 0.24, ty + 0.27, tx - 0.18, ty + 0.27, tx - 0.05, ty + 0.18, tx + 0.04, ty + 0.08]);
        break;
      case 'feathers':
        poly(c, [tx + 0.02, ty, tx - 0.07, ty + 0.14, tx + 0.06, ty + 0.12]);
        break;
      case 'spikes': {
        // Spines over the back, from the head round to the hips.
        const pts: number[] = [];
        const cx = bx - 0.01;
        const cy = by - 0.02;
        for (let i = 0; i <= 16; i += 1) {
          const ang = Math.PI * (0.62 + (i / 16) * 0.95);
          const rad = (i % 2 === 0 ? 1.0 : 1.38) * (brx + 0.02);
          pts.push(cx + Math.cos(ang) * rad * 1.05, cy - Math.sin(ang) * rad * 1.15);
        }
        pts.push(cx - 0.02, cy + 0.05);
        poly(c, pts);
        break;
      }
      default:
        break;
    }
  });
  if (a.tail === 'curl') curve(c, 0.035, tx + 0.02, ty, tx - 0.22, ty - 0.02, tx - 0.17, ty - 0.27);
  if (a.tail === 'thin') curve(c, 0.016, tx + 0.02, ty + 0.02, tx - 0.25, ty + 0.2, tx - 0.33, ty + 0.03);
  if (a.wings) {
    solid(c, () => {
      blob(c, [bx - brx * 0.4, by - bry * 0.6, bx + brx * 0.35, by - bry * 0.45, bx + brx * 0.1, by + bry * 0.55, bx - brx * 0.95, by + bry * 0.75]);
    });
  }
  if (a.scarf) {
    // A scarf end blowing back, the one bit of costume that reads in silhouette.
    solid(c, () => {
      blob(c, [bx - brx * 0.3, by - bry * 0.95, bx - brx * 1.15, by - bry * 0.7, bx - brx * 1.65, by - bry * 0.6, bx - brx * 1.25, by - bry * 0.45, bx - brx * 0.35, by - bry * 0.5]);
    });
  }
  // Cut-outs: the eye, the ringed tail, the gap between arm and body.
  cut(c, () => {
    const eyeX = a.snout === 'flat' ? hx + r * 0.45 : hx + r * 0.32;
    const eyeY = a.snout === 'flat' ? hy - r * 0.62 : hy - r * 0.12;
    const er = a.ears === 'tufts' ? r * 0.2 : r * 0.12;
    ell(c, eyeX, eyeY, er, er * 1.1);
    if (a.snout === 'flat') ell(c, hx + r * 0.65, hy + r * 0.32, r * 0.55, r * 0.04);
  });
  if (a.tail === 'ringed') {
    cut(c, () => {
      for (let i = 0; i < 3; i += 1) ell(c, tx - 0.09 - i * 0.065, ty - 0.06 - i * 0.075, 0.014, 0.075, 0.9);
    });
  }
}

// ---------------------------------------------------------------- the rest of the cast

function bird(c: C, w: number): void {
  solid(c, () => {
    ell(c, w * 0.48, 0.58, 0.26, 0.22);
    ell(c, w * 0.7, 0.4, 0.16, 0.15);
    poly(c, [w * 0.82, 0.36, w * 0.98, 0.42, w * 0.82, 0.46]);
    poly(c, [w * 0.25, 0.56, w * 0.02, 0.48, w * 0.08, 0.66]);
    blob(c, [w * 0.35, 0.5, w * 0.55, 0.1, w * 0.62, 0.48]);
  });
  cut(c, () => ell(c, w * 0.74, 0.37, 0.025, 0.03));
}

function flyer(c: C, x: number, y: number, s: number): void {
  c.moveTo(x - s, y);
  c.quadraticCurveTo(x - s * 0.5, y - s * 0.55, x, y + s * 0.05);
  c.quadraticCurveTo(x + s * 0.5, y - s * 0.55, x + s, y);
  c.quadraticCurveTo(x + s * 0.5, y - s * 0.3, x, y + s * 0.25);
  c.quadraticCurveTo(x - s * 0.5, y - s * 0.3, x - s, y);
  c.closePath();
}

function house(c: C, w: number, x: number, base: number, hw: number, hh: number, roof: number, chimney: boolean, seed: number): void {
  const left = x - hw / 2;
  solid(c, () => {
    rr(c, left, base - hh, hw, hh, 0.005);
    poly(c, [left - hw * 0.12, base - hh + 0.005, x, base - hh - roof, left + hw * 1.12, base - hh + 0.005]);
    if (chimney) rr(c, x + hw * 0.18, base - hh - roof * 0.85, hw * 0.13, roof * 0.6, 0.004);
  });
  if (chimney) {
    // A curl of smoke in three puffs.
    solid(c, () => {
      const sx = x + hw * 0.245;
      const sy = base - hh - roof * 0.95;
      ell(c, sx + 0.01, sy - 0.03, 0.022, 0.018);
      ell(c, sx + 0.04, sy - 0.08, 0.028, 0.022);
      ell(c, sx + 0.02, sy - 0.14, 0.034, 0.026);
    });
  }
  cut(c, () => {
    rr(c, x - hw * 0.12, base - hh * 0.55, hw * 0.24, hh * 0.55, hw * 0.12);
    const wy = base - hh * 0.8;
    rr(c, left + hw * 0.1, wy, hw * 0.2, hh * 0.24, 0.005);
    if (seed % 2 === 0) rr(c, left + hw * 0.7, wy, hw * 0.2, hh * 0.24, 0.005);
    ell(c, x, base - hh - roof * 0.42, hw * 0.07, hw * 0.07);
  });
  void w;
}

function tree(c: C, w: number): void {
  solid(c, () => {
    poly(c, [w * 0.44, 1, w * 0.47, 0.55, w * 0.38, 0.45, w * 0.48, 0.5, w * 0.5, 0.38, w * 0.53, 0.5, w * 0.62, 0.42, w * 0.54, 0.56, w * 0.57, 1]);
    ell(c, w * 0.5, 0.3, w * 0.32, 0.2);
    ell(c, w * 0.28, 0.42, w * 0.22, 0.14);
    ell(c, w * 0.72, 0.4, w * 0.24, 0.15);
    ell(c, w * 0.5, 0.16, w * 0.22, 0.13);
  });
  cut(c, () => {
    ell(c, w * 0.36, 0.33, 0.02, 0.025);
    ell(c, w * 0.66, 0.27, 0.025, 0.02);
    ell(c, w * 0.55, 0.45, 0.018, 0.02);
  });
}

function pine(c: C, w: number): void {
  solid(c, () => {
    rr(c, w * 0.45, 0.82, w * 0.1, 0.18, 0.01);
    poly(c, [w * 0.05, 0.86, w * 0.5, 0.45, w * 0.95, 0.86]);
    poly(c, [w * 0.13, 0.62, w * 0.5, 0.22, w * 0.87, 0.62]);
    poly(c, [w * 0.22, 0.4, w * 0.5, 0.02, w * 0.78, 0.4]);
  });
}

function waves(c: C, w: number, y: number, amp: number, n: number): void {
  c.moveTo(0, 1);
  c.lineTo(0, y);
  for (let i = 0; i < n; i += 1) {
    const x0 = (i / n) * w;
    const x1 = ((i + 1) / n) * w;
    c.bezierCurveTo(x0 + (x1 - x0) * 0.3, y - amp * 1.6, x0 + (x1 - x0) * 0.6, y - amp * 1.2, x0 + (x1 - x0) * 0.72, y - amp * 0.2);
    c.quadraticCurveTo(x0 + (x1 - x0) * 0.66, y + amp * 0.4, x1, y);
  }
  c.lineTo(w, 1);
  c.closePath();
}

function star4(c: C, x: number, y: number, s: number): void {
  c.moveTo(x, y - s);
  c.quadraticCurveTo(x + s * 0.12, y - s * 0.12, x + s, y);
  c.quadraticCurveTo(x + s * 0.12, y + s * 0.12, x, y + s);
  c.quadraticCurveTo(x - s * 0.12, y + s * 0.12, x - s, y);
  c.quadraticCurveTo(x - s * 0.12, y - s * 0.12, x, y - s);
  c.closePath();
}

/** A small seeded random, so the same kind draws the same way every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const DRAW: Record<SilhouetteKind, (c: C, w: number) => void> = {
  fox: (c) => animal(c, ANIMALS.fox),
  rabbit: (c) => animal(c, ANIMALS.rabbit),
  cat: (c) => animal(c, ANIMALS.cat),
  bear: (c) => animal(c, ANIMALS.bear),
  frog: (c) => animal(c, ANIMALS.frog),
  owl: (c) => animal(c, ANIMALS.owl),
  deer: (c) => animal(c, ANIMALS.deer),
  hedgehog: (c) => animal(c, ANIMALS.hedgehog),
  raccoon: (c) => animal(c, ANIMALS.raccoon),
  penguin: (c) => animal(c, ANIMALS.penguin),
  mouse: (c) => animal(c, ANIMALS.mouse),
  otter: (c) => animal(c, ANIMALS.otter),
  goat: (c) => animal(c, ANIMALS.goat),
  bird: (c, w) => bird(c, w),
  birds: (c, w) =>
    solid(c, () => {
      const r = rng(7);
      for (let i = 0; i < 7; i += 1) flyer(c, w * (0.1 + i * 0.13 + r() * 0.04), 0.3 + Math.abs(i - 3) * 0.1 + r() * 0.06, 0.06 + r() * 0.03);
    }),
  gull: (c, w) =>
    solid(c, () => {
      flyer(c, w * 0.5, 0.5, w * 0.48);
      ell(c, w * 0.5, 0.52, 0.12, 0.07);
    }),
  fish: (c, w) => {
    solid(c, () => {
      blob(c, [w * 0.12, 0.5, w * 0.4, 0.15, w * 0.85, 0.32, w * 0.95, 0.5, w * 0.85, 0.7, w * 0.4, 0.85]);
      poly(c, [w * 0.2, 0.5, w * 0.02, 0.15, w * 0.02, 0.85]);
    });
    cut(c, () => {
      ell(c, w * 0.8, 0.43, 0.04, 0.045);
      ell(c, w * 0.62, 0.52, 0.012, 0.18, 0.15);
    });
  },
  whale: (c, w) => {
    solid(c, () => {
      // A round cloud whale: big head to the right, the body narrowing to flukes that lift.
      blob(c, [w * 0.2, 0.62, w * 0.32, 0.36, w * 0.6, 0.18, w * 0.88, 0.26, w * 0.99, 0.55, w * 0.9, 0.84, w * 0.6, 0.95, w * 0.34, 0.86]);
      poly(c, [w * 0.24, 0.7, w * 0.08, 0.62, w * 0.0, 0.32, w * 0.1, 0.45, w * 0.14, 0.4, w * 0.18, 0.56]);
      blob(c, [w * 0.52, 0.84, w * 0.56, 1.0, w * 0.68, 0.86]);
      // Cloud puffs riding on its back.
      ell(c, w * 0.42, 0.3, 0.09, 0.08);
      ell(c, w * 0.52, 0.22, 0.11, 0.1);
      ell(c, w * 0.64, 0.19, 0.09, 0.08);
      // The spout.
      ell(c, w * 0.8, 0.06, 0.045, 0.035);
      ell(c, w * 0.75, 0.03, 0.035, 0.028);
      ell(c, w * 0.85, 0.03, 0.035, 0.028);
    });
    line(c, 0.02, [w * 0.8, 0.22, w * 0.8, 0.08]);
    cut(c, () => {
      ell(c, w * 0.86, 0.5, 0.035, 0.04);
      c.moveTo(w * 0.66, 0.7);
      c.quadraticCurveTo(w * 0.84, 0.77, w * 0.97, 0.66);
      c.quadraticCurveTo(w * 0.84, 0.73, w * 0.66, 0.7);
      for (let i = 0; i < 4; i += 1) ell(c, w * (0.4 + i * 0.07), 0.8 - i * 0.005, 0.012, 0.06, 0.2);
    });
  },
  bee: (c, w) => {
    solid(c, () => {
      ell(c, w * 0.5, 0.6, 0.3, 0.22);
      poly(c, [w * 0.2, 0.6, w * 0.06, 0.62, w * 0.2, 0.66]);
      ell(c, w * 0.45, 0.25, 0.13, 0.2, -0.4);
      ell(c, w * 0.62, 0.25, 0.11, 0.17, 0.3);
    });
    cut(c, () => {
      ell(c, w * 0.42, 0.6, 0.03, 0.2);
      ell(c, w * 0.56, 0.6, 0.03, 0.21);
      ell(c, w * 0.45, 0.27, 0.07, 0.12, -0.4);
    });
  },
  balloon: (c, w) => {
    solid(c, () => {
      blob(c, [w * 0.5, 0.02, w * 0.95, 0.22, w * 0.88, 0.5, w * 0.6, 0.68, w * 0.4, 0.68, w * 0.12, 0.5, w * 0.05, 0.22]);
      rr(c, w * 0.32, 0.82, w * 0.36, 0.16, 0.02);
    });
    line(c, 0.012, [w * 0.4, 0.66, w * 0.35, 0.82]);
    line(c, 0.012, [w * 0.6, 0.66, w * 0.65, 0.82]);
    line(c, 0.012, [w * 0.5, 0.68, w * 0.5, 0.82]);
    cut(c, () => {
      ell(c, w * 0.3, 0.33, 0.02, 0.2, 0.15);
      ell(c, w * 0.7, 0.33, 0.02, 0.2, -0.15);
      rr(c, w * 0.36, 0.86, w * 0.28, 0.025, 0.01);
    });
  },
  'paper-boat': (c, w) => {
    solid(c, () => {
      poly(c, [w * 0.02, 0.55, w * 0.98, 0.55, w * 0.8, 0.95, w * 0.2, 0.95]);
      poly(c, [w * 0.22, 0.56, w * 0.5, 0.05, w * 0.78, 0.56]);
    });
    cut(c, () => poly(c, [w * 0.5, 0.18, w * 0.5, 0.52, w * 0.62, 0.52]));
  },
  boat: (c, w) => {
    solid(c, () => {
      blob(c, [w * 0.02, 0.72, w * 0.98, 0.72, w * 0.82, 0.97, w * 0.18, 0.97]);
      rr(c, w * 0.48, 0.05, 0.02, 0.7, 0.01);
      poly(c, [w * 0.52, 0.08, w * 0.9, 0.62, w * 0.52, 0.64]);
      poly(c, [w * 0.47, 0.18, w * 0.15, 0.62, w * 0.47, 0.62]);
      poly(c, [w * 0.5, 0.05, w * 0.64, 0.09, w * 0.5, 0.13]);
    });
    cut(c, () => {
      ell(c, w * 0.3, 0.84, 0.025, 0.025);
      ell(c, w * 0.5, 0.84, 0.025, 0.025);
      ell(c, w * 0.7, 0.84, 0.025, 0.025);
    });
  },
  kite: (c, w) => {
    solid(c, () => {
      poly(c, [w * 0.5, 0.02, w * 0.9, 0.24, w * 0.5, 0.56, w * 0.1, 0.24]);
      const r = rng(3);
      for (let i = 0; i < 4; i += 1) {
        const y = 0.64 + i * 0.09;
        const x = w * (0.52 + Math.sin(i * 1.4) * 0.12);
        poly(c, [x - 0.04, y - 0.025, x + 0.04, y + 0.025, x + 0.04, y - 0.025, x - 0.04, y + 0.025]);
        void r;
      }
    });
    c.save();
    c.lineWidth = 0.012;
    c.beginPath();
    c.moveTo(w * 0.5, 0.56);
    c.bezierCurveTo(w * 0.7, 0.7, w * 0.3, 0.85, w * 0.55, 0.99);
    c.stroke();
    c.restore();
    cut(c, () => {
      poly(c, [w * 0.5, 0.06, w * 0.52, 0.24, w * 0.5, 0.52, w * 0.48, 0.24]);
      poly(c, [w * 0.16, 0.24, w * 0.5, 0.22, w * 0.84, 0.24, w * 0.5, 0.26]);
    });
  },
  umbrella: (c, w) => {
    solid(c, () => {
      c.moveTo(w * 0.04, 0.42);
      c.quadraticCurveTo(w * 0.1, 0.02, w * 0.5, 0.04);
      c.quadraticCurveTo(w * 0.9, 0.02, w * 0.96, 0.42);
      for (let i = 4; i > 0; i -= 1) c.quadraticCurveTo(w * (0.04 + (i - 0.5) * 0.23), 0.33, w * (0.04 + (i - 1) * 0.23), 0.42);
      c.closePath();
      poly(c, [w * 0.49, 0.0, w * 0.51, 0.0, w * 0.51, 0.04, w * 0.49, 0.04]);
    });
    line(c, 0.025, [w * 0.5, 0.36, w * 0.5, 0.88]);
    curve(c, 0.025, w * 0.5, 0.88, w * 0.5, 0.98, w * 0.38, 0.92);
  },
  lantern: (c, w) => {
    // Paper lantern: keeps its glow (drawn in colour).
    const g = c.createRadialGradient(w * 0.5, 0.55, 0.02, w * 0.5, 0.55, 0.42);
    g.addColorStop(0, '#fff2c4');
    g.addColorStop(0.55, '#ffb35c');
    g.addColorStop(1, 'rgba(255,140,60,0)');
    c.fillStyle = g;
    c.fillRect(0, 0.1, w, 0.9);
    c.fillStyle = '#ffcf7a';
    solid(c, () => blob(c, [w * 0.5, 0.22, w * 0.86, 0.38, w * 0.86, 0.72, w * 0.5, 0.88, w * 0.14, 0.72, w * 0.14, 0.38]));
    c.fillStyle = '#8a4325';
    solid(c, () => {
      rr(c, w * 0.32, 0.17, w * 0.36, 0.06, 0.01);
      rr(c, w * 0.32, 0.86, w * 0.36, 0.05, 0.01);
    });
    c.strokeStyle = 'rgba(160,80,40,0.45)';
    for (const k of [0.32, 0.5, 0.68]) curve(c, 0.008, w * k, 0.24, w * (k + (k - 0.5) * 0.8), 0.55, w * k, 0.86);
    c.fillStyle = '#fff';
    c.strokeStyle = '#fff';
  },
  house: (c, w) => house(c, w, w * 0.5, 1, w * 0.62, 0.48, 0.34, true, 2),
  town: (c, w) => {
    const r = rng(11);
    const xs = [0.12, 0.3, 0.5, 0.68, 0.87];
    xs.forEach((k, i) => {
      const hh = 0.3 + r() * 0.25;
      house(c, w, w * k, 1, w * (0.15 + r() * 0.05), hh, 0.15 + r() * 0.1, i % 2 === 1, i);
    });
    solid(c, () => {
      rr(c, w * 0.585, 0.15, w * 0.05, 0.55, 0.005);
      poly(c, [w * 0.57, 0.16, w * 0.61, 0.0, w * 0.65, 0.16]);
    });
    cut(c, () => ell(c, w * 0.61, 0.3, 0.025, 0.025));
  },
  tower: (c, w) => {
    solid(c, () => {
      poly(c, [w * 0.18, 1, w * 0.26, 0.3, w * 0.74, 0.3, w * 0.82, 1]);
      rr(c, w * 0.12, 0.24, w * 0.76, 0.07, 0.01);
      poly(c, [w * 0.14, 0.25, w * 0.5, 0.02, w * 0.86, 0.25]);
      poly(c, [w * 0.49, 0.03, w * 0.49, -0.04, w * 0.7, 0.0, w * 0.51, 0.03]);
    });
    cut(c, () => {
      for (const y of [0.42, 0.6, 0.78]) rr(c, w * 0.43, y, w * 0.14, 0.07, w * 0.07);
      rr(c, w * 0.4, 0.9, w * 0.2, 0.1, w * 0.1);
    });
  },
  lighthouse: (c, w) => {
    solid(c, () => {
      poly(c, [w * 0.2, 1, w * 0.32, 0.32, w * 0.68, 0.32, w * 0.8, 1]);
      rr(c, w * 0.24, 0.28, w * 0.52, 0.05, 0.01);
      rr(c, w * 0.33, 0.16, w * 0.34, 0.12, 0.01);
      poly(c, [w * 0.28, 0.17, w * 0.5, 0.03, w * 0.72, 0.17]);
      rr(c, w * 0.1, 0.97, w * 0.8, 0.03, 0.01);
    });
    cut(c, () => {
      rr(c, w * 0.38, 0.18, w * 0.24, 0.085, 0.01);
      for (const y of [0.45, 0.66]) {
        const k = (y - 0.32) / 0.68;
        poly(c, [w * (0.32 - k * 0.12), y, w * (0.68 + k * 0.12), y, w * (0.68 + (k + 0.05) * 0.12), y + 0.035, w * (0.32 - (k + 0.05) * 0.12), y + 0.035]);
      }
      rr(c, w * 0.44, 0.86, w * 0.12, 0.11, w * 0.06);
    });
  },
  windmill: (c, w) => {
    solid(c, () => {
      poly(c, [w * 0.3, 1, w * 0.37, 0.4, w * 0.63, 0.4, w * 0.7, 1]);
      poly(c, [w * 0.33, 0.41, w * 0.5, 0.28, w * 0.67, 0.41]);
    });
    const cx = w * 0.5;
    const cy = 0.36;
    for (let i = 0; i < 4; i += 1) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      c.save();
      c.translate(cx, cy);
      c.rotate(a);
      solid(c, () => rr(c, 0.03, -0.035, 0.32, 0.07, 0.005));
      line(c, 0.012, [0, 0, 0.36, 0]);
      cut(c, () => {
        for (let k = 0; k < 4; k += 1) rr(c, 0.07 + k * 0.065, -0.026, 0.05, 0.018, 0.002);
      });
      c.restore();
    }
    solid(c, () => ell(c, cx, cy, 0.03, 0.03));
    cut(c, () => rr(c, w * 0.44, 0.85, w * 0.12, 0.15, w * 0.06));
  },
  bridge: (c, w) => {
    solid(c, () => {
      c.moveTo(0, 0.45);
      c.quadraticCurveTo(w * 0.5, 0.05, w, 0.45);
      c.lineTo(w, 1);
      c.lineTo(w * 0.86, 1);
      c.quadraticCurveTo(w * 0.5, 0.25, w * 0.14, 1);
      c.lineTo(0, 1);
      c.closePath();
    });
    line(c, 0.015, [0, 0.3, w * 0.25, 0.12, w * 0.5, 0.06, w * 0.75, 0.12, w, 0.3]);
    for (let i = 1; i < 8; i += 1) {
      const x = (i / 8) * w;
      const top = 0.3 - Math.sin((i / 8) * Math.PI) * 0.24;
      const deck = 0.45 - Math.sin((i / 8) * Math.PI) * 0.2;
      line(c, 0.012, [x, top, x, deck]);
    }
  },
  island: (c, w) => {
    solid(c, () => {
      blob(c, [w * 0.05, 0.62, w * 0.3, 0.55, w * 0.7, 0.55, w * 0.95, 0.62, w * 0.75, 0.78, w * 0.55, 0.98, w * 0.42, 0.85, w * 0.25, 0.75]);
      // A tree and a little house on top.
      ell(c, w * 0.3, 0.38, 0.12, 0.1);
      ell(c, w * 0.24, 0.45, 0.09, 0.07);
      rr(c, w * 0.29, 0.42, 0.025, 0.16, 0.01);
    });
    house(c, w, w * 0.62, 0.6, w * 0.16, 0.13, 0.1, true, 1);
  },
  hill: (c, w) =>
    solid(c, () => {
      c.moveTo(0, 1);
      c.lineTo(0, 0.55);
      c.bezierCurveTo(w * 0.15, 0.2, w * 0.35, 0.15, w * 0.5, 0.45);
      c.bezierCurveTo(w * 0.62, 0.65, w * 0.78, 0.1, w, 0.4);
      c.lineTo(w, 1);
      c.closePath();
    }),
  tree: (c, w) => tree(c, w),
  pine: (c, w) => pine(c, w),
  rock: (c, w) =>
    solid(c, () => {
      blob(c, [w * 0.05, 1, w * 0.1, 0.55, w * 0.35, 0.2, w * 0.62, 0.3, w * 0.85, 0.5, w * 0.98, 1]);
      ell(c, w * 0.75, 0.88, 0.25, 0.14);
    }),
  tent: (c, w) => {
    solid(c, () => {
      poly(c, [w * 0.02, 1, w * 0.5, 0.08, w * 0.98, 1]);
      poly(c, [w * 0.49, 0.1, w * 0.49, 0.0, w * 0.62, 0.03, w * 0.51, 0.06]);
    });
    cut(c, () => poly(c, [w * 0.38, 1, w * 0.5, 0.5, w * 0.62, 1]));
  },
  oven: (c, w) => {
    solid(c, () => {
      c.moveTo(w * 0.05, 1);
      c.lineTo(w * 0.05, 0.5);
      c.quadraticCurveTo(w * 0.1, 0.12, w * 0.5, 0.12);
      c.quadraticCurveTo(w * 0.9, 0.12, w * 0.95, 0.5);
      c.lineTo(w * 0.95, 1);
      c.closePath();
      rr(c, w * 0.62, 0.0, w * 0.12, 0.2, 0.01);
    });
    cut(c, () => {
      c.moveTo(w * 0.28, 0.82);
      c.lineTo(w * 0.28, 0.6);
      c.quadraticCurveTo(w * 0.5, 0.36, w * 0.72, 0.6);
      c.lineTo(w * 0.72, 0.82);
      c.closePath();
      for (let i = 0; i < 4; i += 1) rr(c, w * (0.12 + i * 0.2), 0.9, w * 0.14, 0.04, 0.01);
    });
  },
  teapot: (c, w) => {
    solid(c, () => {
      ell(c, w * 0.48, 0.62, w * 0.28, 0.34);
      poly(c, [w * 0.7, 0.62, w * 0.98, 0.25, w * 0.95, 0.22, w * 0.7, 0.45]);
      ell(c, w * 0.48, 0.25, 0.1, 0.05);
      ell(c, w * 0.48, 0.18, 0.04, 0.04);
    });
    c.save();
    c.lineWidth = 0.05;
    c.beginPath();
    c.ellipse(w * 0.18, 0.6, 0.1, 0.17, 0, Math.PI * 0.5, Math.PI * 1.5);
    c.stroke();
    c.restore();
    cut(c, () => rr(c, w * 0.3, 0.55, w * 0.36, 0.035, 0.01));
  },
  cup: (c, w) => {
    solid(c, () => {
      poly(c, [w * 0.15, 0.3, w * 0.75, 0.3, w * 0.68, 0.92, w * 0.22, 0.92]);
      ell(c, w * 0.45, 0.95, w * 0.4, 0.05);
    });
    c.save();
    c.lineWidth = 0.06;
    c.beginPath();
    c.ellipse(w * 0.78, 0.55, 0.1, 0.16, 0, -Math.PI / 2, Math.PI / 2);
    c.stroke();
    c.restore();
    curve(c, 0.035, w * 0.38, 0.22, w * 0.3, 0.1, w * 0.42, 0.0);
  },
  bread: (c, w) => {
    solid(c, () => blob(c, [w * 0.05, 0.95, w * 0.03, 0.55, w * 0.25, 0.1, w * 0.75, 0.1, w * 0.97, 0.55, w * 0.95, 0.95]));
    cut(c, () => {
      for (let i = 0; i < 3; i += 1) ell(c, w * (0.3 + i * 0.2), 0.4, 0.025, 0.13, 0.5);
    });
  },
  book: (c, w) => {
    solid(c, () => {
      c.moveTo(w * 0.5, 0.95);
      c.quadraticCurveTo(w * 0.28, 0.75, w * 0.02, 0.85);
      c.lineTo(w * 0.04, 0.15);
      c.quadraticCurveTo(w * 0.3, 0.05, w * 0.5, 0.25);
      c.quadraticCurveTo(w * 0.7, 0.05, w * 0.96, 0.15);
      c.lineTo(w * 0.98, 0.85);
      c.quadraticCurveTo(w * 0.72, 0.75, w * 0.5, 0.95);
      c.closePath();
    });
    cut(c, () => {
      for (let i = 0; i < 3; i += 1) {
        rr(c, w * 0.12, 0.35 + i * 0.15, w * 0.28, 0.035, 0.01);
        rr(c, w * 0.6, 0.35 + i * 0.15, w * 0.28, 0.035, 0.01);
      }
    });
  },
  map: (c, w) => {
    solid(c, () => poly(c, [w * 0.02, 0.1, w * 0.34, 0.0, w * 0.66, 0.12, w * 0.98, 0.02, w * 0.98, 0.9, w * 0.66, 1, w * 0.34, 0.88, w * 0.02, 0.98]));
    cut(c, () => {
      const r = rng(5);
      let x = w * 0.1;
      let y = 0.75;
      for (let i = 0; i < 9; i += 1) {
        ell(c, x, y, 0.018, 0.018);
        x += w * 0.07;
        y += (r() - 0.62) * 0.12;
      }
      poly(c, [w * 0.78, 0.3, w * 0.84, 0.36, w * 0.9, 0.3, w * 0.84, 0.24]);
      poly(c, [w * 0.8, 0.22, w * 0.88, 0.38, w * 0.86, 0.4, w * 0.78, 0.24]);
    });
  },
  telescope: (c, w) => {
    solid(c, () => {
      c.save();
      c.translate(w * 0.45, 0.45);
      c.rotate(-0.55);
      rr(c, -0.3, -0.05, 0.25, 0.1, 0.02);
      rr(c, -0.07, -0.065, 0.25, 0.13, 0.02);
      rr(c, 0.16, -0.08, 0.2, 0.16, 0.02);
      c.restore();
    });
    line(c, 0.03, [w * 0.45, 0.5, w * 0.2, 1]);
    line(c, 0.03, [w * 0.45, 0.5, w * 0.72, 1]);
    line(c, 0.03, [w * 0.45, 0.5, w * 0.48, 1]);
  },
  fiddle: (c, w) => {
    solid(c, () => {
      blob(c, [w * 0.5, 0.3, w * 0.9, 0.35, w * 0.72, 0.55, w * 0.95, 0.75, w * 0.5, 0.98, w * 0.05, 0.75, w * 0.28, 0.55, w * 0.1, 0.35]);
      rr(c, w * 0.44, 0.04, w * 0.12, 0.3, 0.01);
      ell(c, w * 0.5, 0.04, 0.04, 0.04);
    });
    cut(c, () => {
      ell(c, w * 0.3, 0.68, 0.012, 0.08, 0.3);
      ell(c, w * 0.7, 0.68, 0.012, 0.08, -0.3);
    });
    line(c, 0.012, [w * 0.95, 0.08, w * 0.05, 0.9]);
  },
  easel: (c, w) => {
    line(c, 0.03, [w * 0.2, 1, w * 0.5, 0.05, w * 0.8, 1]);
    line(c, 0.03, [w * 0.5, 0.05, w * 0.55, 1]);
    solid(c, () => rr(c, w * 0.12, 0.18, w * 0.76, 0.5, 0.01));
    cut(c, () => {
      c.moveTo(w * 0.2, 0.62);
      c.lineTo(w * 0.38, 0.4);
      c.lineTo(w * 0.5, 0.52);
      c.lineTo(w * 0.62, 0.34);
      c.lineTo(w * 0.8, 0.62);
      c.closePath();
      ell(c, w * 0.7, 0.28, 0.035, 0.035);
    });
  },
  hive: (c, w) => {
    solid(c, () => {
      for (let i = 0; i < 4; i += 1) ell(c, w * 0.5, 0.82 - i * 0.17, w * (0.42 - i * 0.07), 0.11);
      ell(c, w * 0.5, 0.18, 0.08, 0.06);
    });
    cut(c, () => ell(c, w * 0.5, 0.85, 0.06, 0.05));
    solid(c, () => {
      flyer(c, w * 0.9, 0.1, 0.05);
      flyer(c, w * 0.15, 0.25, 0.04);
    });
  },
  pumpkin: (c, w) => {
    solid(c, () => {
      ell(c, w * 0.5, 0.6, w * 0.25, 0.36);
      ell(c, w * 0.3, 0.6, w * 0.2, 0.34);
      ell(c, w * 0.7, 0.6, w * 0.2, 0.34);
    });
    curve(c, 0.06, w * 0.5, 0.3, w * 0.52, 0.1, w * 0.62, 0.05);
    cut(c, () => {
      ell(c, w * 0.4, 0.62, 0.012, 0.25);
      ell(c, w * 0.6, 0.62, 0.012, 0.25);
    });
  },
  clock: (c, w) => {
    solid(c, () => {
      ell(c, w * 0.5, 0.58, w * 0.42, w * 0.42 * 1.0);
      ell(c, w * 0.22, 0.14, 0.09, 0.07);
      ell(c, w * 0.78, 0.14, 0.09, 0.07);
    });
    line(c, 0.04, [w * 0.25, 0.92, w * 0.18, 1]);
    line(c, 0.04, [w * 0.75, 0.92, w * 0.82, 1]);
    cut(c, () => {
      ell(c, w * 0.5, 0.58, w * 0.32, w * 0.32);
    });
    solid(c, () => {
      for (let i = 0; i < 12; i += 1) {
        const a = (i / 12) * TAU;
        ell(c, w * 0.5 + Math.cos(a) * w * 0.26, 0.58 + Math.sin(a) * w * 0.26, 0.012, 0.012);
      }
    });
    line(c, 0.025, [w * 0.5, 0.58, w * 0.5, 0.4]);
    line(c, 0.025, [w * 0.5, 0.58, w * 0.64, 0.64]);
  },
  key: (c, w) => {
    solid(c, () => {
      ell(c, w * 0.18, 0.5, 0.17, 0.17);
      rr(c, w * 0.3, 0.42, w * 0.65, 0.16, 0.02);
      rr(c, w * 0.75, 0.55, 0.08, 0.3, 0.01);
      rr(c, w * 0.86, 0.55, 0.08, 0.22, 0.01);
    });
    cut(c, () => ell(c, w * 0.18, 0.5, 0.08, 0.08));
  },
  letter: (c, w) => {
    solid(c, () => rr(c, w * 0.04, 0.08, w * 0.92, 0.84, 0.03));
    cut(c, () => {
      c.moveTo(w * 0.08, 0.15);
      c.lineTo(w * 0.5, 0.55);
      c.lineTo(w * 0.92, 0.15);
      c.lineTo(w * 0.92, 0.2);
      c.lineTo(w * 0.5, 0.62);
      c.lineTo(w * 0.08, 0.2);
      c.closePath();
    });
  },
  ladder: (c, w) => {
    line(c, 0.04, [w * 0.18, 1, w * 0.28, 0.0]);
    line(c, 0.04, [w * 0.82, 1, w * 0.72, 0.0]);
    for (let i = 0; i < 7; i += 1) {
      const y = 0.1 + i * 0.13;
      const k = y;
      line(c, 0.03, [w * (0.28 - k * 0.1), y, w * (0.72 + k * 0.1), y]);
    }
  },
  chair: (c, w) => {
    solid(c, () => {
      rr(c, w * 0.1, 0.0, w * 0.12, 1, 0.01);
      rr(c, w * 0.1, 0.52, w * 0.8, 0.08, 0.01);
      rr(c, w * 0.78, 0.52, w * 0.1, 0.48, 0.01);
      rr(c, w * 0.1, 0.05, w * 0.06, 0.5, 0.01);
    });
    cut(c, () => {
      for (let i = 0; i < 3; i += 1) rr(c, w * 0.12, 0.12 + i * 0.12, w * 0.08, 0.05, 0.01);
    });
    line(c, 0.025, [w * 0.16, 0.12, w * 0.16, 0.5]);
  },
  net: (c, w) => {
    line(c, 0.035, [w * 0.15, 1, w * 0.45, 0.35]);
    c.save();
    c.lineWidth = 0.02;
    c.beginPath();
    c.ellipse(w * 0.6, 0.25, 0.22, 0.17, 0.3, 0, TAU);
    c.stroke();
    c.restore();
    c.save();
    c.lineWidth = 0.008;
    for (let i = -3; i <= 3; i += 1) {
      c.beginPath();
      c.moveTo(w * 0.6 + i * 0.05, 0.12);
      c.quadraticCurveTo(w * 0.62 + i * 0.03, 0.55, w * 0.66, 0.72);
      c.stroke();
    }
    for (let k = 0; k < 4; k += 1) {
      c.beginPath();
      c.ellipse(w * 0.62, 0.3 + k * 0.1, 0.18 - k * 0.04, 0.03, 0.2, 0, Math.PI);
      c.stroke();
    }
    c.restore();
  },
  flower: (c, w) => {
    curve(c, 0.03, w * 0.5, 1, w * 0.42, 0.6, w * 0.5, 0.32);
    solid(c, () => {
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * TAU;
        ell(c, w * 0.5 + Math.cos(a) * 0.1, 0.25 + Math.sin(a) * 0.1, 0.075, 0.05, a);
      }
      ell(c, w * 0.38, 0.72, 0.09, 0.035, -0.6);
      ell(c, w * 0.6, 0.6, 0.09, 0.035, 0.5);
    });
    cut(c, () => ell(c, w * 0.5, 0.25, 0.035, 0.035));
  },
  basket: (c, w) => {
    solid(c, () => {
      poly(c, [w * 0.05, 0.45, w * 0.95, 0.45, w * 0.82, 1, w * 0.18, 1]);
      ell(c, w * 0.3, 0.42, 0.1, 0.08);
      ell(c, w * 0.48, 0.38, 0.11, 0.09);
      ell(c, w * 0.66, 0.42, 0.1, 0.08);
    });
    c.save();
    c.lineWidth = 0.04;
    c.beginPath();
    c.ellipse(w * 0.5, 0.45, w * 0.36, 0.42, 0, Math.PI, TAU);
    c.stroke();
    c.restore();
    cut(c, () => {
      for (let i = 0; i < 3; i += 1) rr(c, w * 0.15, 0.58 + i * 0.13, w * 0.7, 0.03, 0.01);
    });
  },
  notes: (c, w) => {
    const note = (x: number, y: number, s: number): void => {
      solid(c, () => ell(c, x, y, s * 0.55, s * 0.4, -0.4));
      line(c, s * 0.18, [x + s * 0.45, y - s * 0.1, x + s * 0.45, y - s * 1.6]);
      curve(c, s * 0.18, x + s * 0.45, y - s * 1.6, x + s * 1.0, y - s * 1.3, x + s * 0.9, y - s * 0.8);
    };
    note(w * 0.22, 0.8, 0.18);
    note(w * 0.55, 0.55, 0.15);
    note(w * 0.82, 0.75, 0.13);
  },
  bell: (c, w) => {
    solid(c, () => {
      c.moveTo(w * 0.05, 0.85);
      c.quadraticCurveTo(w * 0.22, 0.75, w * 0.25, 0.45);
      c.quadraticCurveTo(w * 0.3, 0.12, w * 0.5, 0.12);
      c.quadraticCurveTo(w * 0.7, 0.12, w * 0.75, 0.45);
      c.quadraticCurveTo(w * 0.78, 0.75, w * 0.95, 0.85);
      c.closePath();
      ell(c, w * 0.5, 0.92, 0.07, 0.07);
      ell(c, w * 0.5, 0.08, 0.06, 0.06);
    });
    cut(c, () => ell(c, w * 0.5, 0.08, 0.03, 0.03));
  },
  boot: (c, w) =>
    solid(c, () => {
      c.moveTo(w * 0.15, 0.0);
      c.lineTo(w * 0.5, 0.0);
      c.lineTo(w * 0.52, 0.55);
      c.quadraticCurveTo(w * 0.98, 0.6, w * 0.96, 0.9);
      c.lineTo(w * 0.96, 1);
      c.lineTo(w * 0.1, 1);
      c.closePath();
    }),
  moon: (c, w) => {
    const g = c.createRadialGradient(w * 0.5, 0.5, 0.2, w * 0.5, 0.5, 0.5);
    g.addColorStop(0, 'rgba(255,240,200,0.55)');
    g.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, 1);
    c.fillStyle = '#fff4d6';
    solid(c, () => ell(c, w * 0.5, 0.5, 0.3, 0.3));
    cut(c, () => ell(c, w * 0.63, 0.43, 0.25, 0.25));
    c.fillStyle = '#fff';
  },
  sun: (c, w) => {
    const g = c.createRadialGradient(w * 0.5, 0.5, 0.15, w * 0.5, 0.5, 0.5);
    g.addColorStop(0, 'rgba(255,214,140,0.7)');
    g.addColorStop(1, 'rgba(255,190,120,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, 1);
    c.fillStyle = '#ffe2a8';
    solid(c, () => {
      ell(c, w * 0.5, 0.5, 0.24, 0.24);
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * TAU;
        poly(c, [w * 0.5 + Math.cos(a - 0.12) * 0.27, 0.5 + Math.sin(a - 0.12) * 0.27, w * 0.5 + Math.cos(a) * 0.4, 0.5 + Math.sin(a) * 0.4, w * 0.5 + Math.cos(a + 0.12) * 0.27, 0.5 + Math.sin(a + 0.12) * 0.27]);
      }
    });
    c.fillStyle = '#fff';
  },
  cloud: (c, w) =>
    solid(c, () => {
      ell(c, w * 0.3, 0.62, 0.22, 0.2);
      ell(c, w * 0.52, 0.45, 0.3, 0.3);
      ell(c, w * 0.75, 0.6, 0.24, 0.22);
      rr(c, w * 0.12, 0.6, w * 0.78, 0.22, 0.11);
    }),
  stars: (c, w) => {
    c.fillStyle = '#fff6dc';
    const r = rng(23);
    solid(c, () => {
      for (let i = 0; i < 26; i += 1) star4(c, r() * w, r() * 0.95 + 0.02, 0.012 + r() * 0.03);
    });
    c.fillStyle = '#fff';
  },
  star: (c, w) => {
    const g = c.createRadialGradient(w * 0.5, 0.5, 0.05, w * 0.5, 0.5, 0.5);
    g.addColorStop(0, 'rgba(255,240,190,0.8)');
    g.addColorStop(1, 'rgba(255,240,190,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, 1);
    c.fillStyle = '#fffbe8';
    solid(c, () => star4(c, w * 0.5, 0.5, 0.42));
    c.fillStyle = '#fff';
  },
  rain: (c, w) => {
    const r = rng(31);
    c.save();
    c.lineWidth = 0.008;
    c.lineCap = 'round';
    c.globalAlpha = 0.75;
    c.beginPath();
    for (let i = 0; i < 90; i += 1) {
      const x = r() * w;
      const y = r();
      c.moveTo(x, y);
      c.lineTo(x - 0.02, y + 0.07);
    }
    c.stroke();
    c.restore();
  },
  snow: (c, w) => {
    const r = rng(37);
    c.fillStyle = '#fffaf0';
    solid(c, () => {
      for (let i = 0; i < 70; i += 1) ell(c, r() * w, r(), 0.006 + r() * 0.01, 0.006 + r() * 0.01);
    });
    c.fillStyle = '#fff';
  },
  wind: (c, w) => {
    c.save();
    c.lineWidth = 0.025;
    c.lineCap = 'round';
    for (let i = 0; i < 4; i += 1) {
      const y = 0.2 + i * 0.2;
      const x0 = w * (0.05 + (i % 2) * 0.12);
      c.beginPath();
      c.moveTo(x0, y);
      c.bezierCurveTo(x0 + w * 0.3, y - 0.05, x0 + w * 0.5, y + 0.05, x0 + w * 0.7, y);
      c.arc(x0 + w * 0.7, y - 0.06, 0.06, Math.PI / 2, -Math.PI * 0.9, true);
      c.stroke();
    }
    c.restore();
    solid(c, () => {
      ell(c, w * 0.88, 0.3, 0.04, 0.018, 0.6);
      ell(c, w * 0.8, 0.62, 0.035, 0.016, -0.4);
    });
  },
  rainbow: (c, w) => {
    const bands = ['#f2a0a0', '#f5c48e', '#f3e39c', '#b7dca0', '#9cc6e0', '#c2a8dc'];
    c.save();
    c.globalAlpha = 0.75;
    bands.forEach((col, i) => {
      c.strokeStyle = col;
      c.lineWidth = 0.055;
      c.beginPath();
      c.arc(w * 0.5, 1.02, 0.9 - i * 0.055, Math.PI, TAU);
      c.stroke();
    });
    c.restore();
    c.strokeStyle = '#fff';
  },
  sea: (c, w) =>
    solid(c, () => {
      waves(c, w, 0.35, 0.18, 9);
    }),
};

/**
 * Draws one kind into a box of `pxH` pixels high at (x, y) of the context. White shapes
 * (or the kind's own light colours) on transparent.
 */
export function drawKind(ctx: C, kind: SilhouetteKind, x: number, y: number, pxH: number): void {
  const info = KINDS[kind];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(pxH, pxH);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  DRAW[kind](ctx, info.aspect);
  ctx.restore();
}
