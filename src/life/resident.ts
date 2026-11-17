// A resident built in code from its species plan, tinted with Resident.colors and dressed
// for its trade. One skinned mesh, one draw call; every part has a bone so the procedural
// animations (idle, walk, talk, wave, happy, sad, sit, work...) can move it.
import { Color, Euler, Quaternion, Vector3, type ColorRepresentation, type SkinnedMesh } from '@iwsdk/core';
import type { Resident } from '../mind/types';
import { Rig, lifeMaterial, resetPose, turn, type PartOptions, type RigMesh } from './rig';
import { capsule, cone, cylinder, disc, egg, ellipsoid, feather, lathe, limb, softCone, sphere, torus, withDetail } from './shapes';
import { gearFor, planFor, type BodyPlan, type Gear } from './species';

/** Pose channels, a flat array so blending two poses never allocates. */
export const P = {
  BOB: 0, LEAN: 1, TWIST: 2, SWAY: 3,
  HX: 4, HY: 5, HZ: 6,
  ALX: 7, ALY: 8, ALZ: 9, ARX: 10, ARY: 11, ARZ: 12,
  LL: 13, LR: 14, SIT: 15, EARS: 16, TAILW: 17, TAILX: 18,
  JAW: 19, BLINK: 20, SQUASH: 21, EARTWITCH: 22,
  HATX: 23, HATZ: 24, EYEX: 25, EYEY: 26, SCARF: 27, SCARFZ: 28, APRON: 29,
} as const;
export const POSE_SIZE = 30;

export interface ResidentModel {
  mesh: SkinnedMesh;
  rig: RigMesh;
  plan: BodyPlan;
  /** Height of the top of the head (without ears) above the feet, metres. */
  height: number;
  /** Eye height, for look-at and bubble placement. */
  eyeHeight: number;
  apply(pose: Float32Array): void;
}

const v = new Vector3();
const q = new Quaternion();
const e = new Euler();
const UP = new Vector3(0, 1, 0);

/** Euler angles that turn +y toward direction d. */
function aim(dx: number, dy: number, dz: number): [number, number, number] {
  v.set(dx, dy, dz).normalize();
  q.setFromUnitVectors(UP, v);
  e.setFromQuaternion(q, 'XYZ');
  return [e.x, e.y, e.z];
}

function hex(c: Color): string {
  return `#${c.getHexString()}`;
}

export function residentColors(res: Pick<Resident, 'species' | 'colors'>): { main: string; accent: string; light: string; dark: string; blush: string } {
  const plan = planFor(res.species);
  const main = new Color(res.colors?.main || plan.colors.main);
  const accent = res.colors?.accent || plan.colors.accent;
  const same = !res.colors?.main || res.colors.main.toLowerCase() === plan.colors.main.toLowerCase();
  const light = same ? plan.colors.light : hex(main.clone().lerp(new Color('#fff6e8'), 0.72));
  const dark = same ? plan.colors.dark : hex(main.clone().lerp(new Color('#22160f'), 0.62));
  return { main: hex(main), accent, light, dark, blush: '#ff9393' };
}

/** detail scales every segment count: 1 for close up, about 0.5 for far away. */
export function createResidentModel(res: Pick<Resident, 'species' | 'colors' | 'trade'>, detail = 1): ResidentModel {
  return withDetail(detail, () => buildResident(res));
}

function buildResident(res: Pick<Resident, 'species' | 'colors' | 'trade'>): ResidentModel {
  const plan = planFor(res.species);
  const col = residentColors(res);
  const H = plan.head;
  const B = plan.body;
  const r = new Rig();

  r.bone('root', null, 0, 0, 0);
  r.bone('hips', 'root', 0, 0.13, 0);
  r.bone('legL', 'hips', 0.05 * B, 0, 0);
  r.bone('legR', 'hips', -0.05 * B, 0, 0);
  r.bone('torso', 'hips', 0, 0, 0);
  r.bone('tail', 'torso', 0, 0.05, -0.095 * B);
  r.bone('armL', 'torso', 0.112 * B, 0.178, 0);
  r.bone('armR', 'torso', -0.112 * B, 0.178, 0);
  r.bone('neck', 'torso', 0, 0.2, 0);
  r.bone('head', 'neck', 0, 0.015, 0);
  const eyeY = plan.eyes === 'bulge' ? 0.245 : 0.14;
  const eyeZ = plan.eyes === 'bulge' ? 0.06 : plan.marks.includes('mask') ? 0.147 : 0.141;
  const eyeX = plan.eyes === 'bulge' ? 0.078 : plan.eyes === 'owl' ? 0.062 : 0.056;
  r.bone('eyeL', 'head', eyeX * H, eyeY * H, eyeZ * H);
  r.bone('eyeR', 'head', -eyeX * H, eyeY * H, eyeZ * H);
  const mouthAt: [number, number, number] =
    plan.snout === 'pointy' ? [0, 0.052, 0.163] : plan.snout === 'wide' ? [0, 0.068, 0.142] : plan.snout === 'beak' ? [0, 0.074, 0.15] : [0, 0.05, 0.158];
  r.bone('jaw', 'head', mouthAt[0], mouthAt[1] * H, mouthAt[2] * H);
  r.bone('earL', 'head', 0.088 * H, 0.232 * H, -0.01 * H);
  r.bone('earR', 'head', -0.088 * H, 0.232 * H, -0.01 * H);
  r.bone('hat', 'head', 0, 0.272 * H, 0.005);
  r.bone('scarf', 'neck', 0.05, -0.035, 0.088 * B);
  r.bone('apron', 'torso', 0, 0.17, 0.095 * B);

  const socks = plan.marks.includes('socks');
  const footCol = plan.feet === 'webbed' || plan.feet === 'talons' ? (plan.model === 'frog' ? col.main : '#f1a33c') : socks ? col.dark : col.main;

  // Legs and feet
  for (const side of [1, -1]) {
    const bone = side > 0 ? 'legL' : 'legR';
    r.part(bone, limb(0.036 * B, 0.035, 14), plan.feet === 'talons' ? '#f1a33c' : col.main, { shade: 0.15 });
    if (plan.feet === 'webbed') r.part(bone, ellipsoid(0.05, 0.022, 0.066, 12, 8), footCol, { pos: [side * 0.006, -0.1, 0.028], shade: 0.1 });
    else r.part(bone, ellipsoid(0.042, 0.027, 0.058, 16, 10), footCol, { pos: [0, -0.098, 0.018], shade: 0.15 });
  }
  // Body
  r.part('torso', egg(0.118 * B, 0.127, 0.106 * B, 0.3, 30, 22), col.main, { pos: [0, 0.104, 0], shade: 0.3 });
  if (plan.marks.includes('tuxedo')) {
    r.part('torso', ellipsoid(0.094 * B, 0.112, 0.06, 18, 12), col.light, { pos: [0, 0.096, 0.058 * B], rot: [0.1, 0, 0], shade: 0.15 });
  } else if (plan.marks.includes('belly')) {
    r.part('torso', ellipsoid(0.08 * B, 0.09, 0.05, 22, 16), col.light, { pos: [0, 0.088, 0.066 * B], rot: [0.12, 0, 0], shade: 0.18 });
  }
  if (plan.marks.includes('spots')) {
    const spots: [number, number, number][] = [[0.07, 0.18, -0.06], [-0.06, 0.15, -0.075], [0.03, 0.12, -0.095], [-0.085, 0.09, -0.04], [0.09, 0.1, -0.04]];
    for (const [x, y, z] of spots) {
      r.part('torso', disc(0.016, 0.35, 8), col.light, { pos: [x * B, y, z * B], rot: aim(x, 0.2, z).map((a, i) => (i === 0 ? a + Math.PI / 2 : a)) as [number, number, number], shade: 0 });
    }
  }

  // Arms
  for (const side of [1, -1]) {
    const bone = side > 0 ? 'armL' : 'armR';
    if (plan.arms === 'wings') {
      r.part(bone, feather(0.022, 0.15, 0.06, 10), col.main, { rot: [Math.PI, 0, 0], pos: [side * 0.006, 0.01, -0.005], top: col.dark, shade: 0.2 });
    } else if (plan.arms === 'flippers') {
      r.part(bone, feather(0.016, 0.14, 0.045, 10), col.main, { rot: [Math.PI, 0, side * -0.1], pos: [side * 0.004, 0.012, 0], shade: 0.2 });
    } else {
      r.part(bone, limb(0.029 * B, 0.06, 14), col.main, { shade: 0.1 });
      r.part(bone, sphere(0.035 * B, 16, 12), socks ? col.dark : col.main, { pos: [0, -0.118, 0.006], shade: 0.15 });
    }
  }

  // Head
  r.part('head', sphere(0.152 * H, 34, 26), col.main, { pos: [0, 0.125 * H, 0.004], shade: 0.18 });
  if (plan.model === 'frog') {
    // Wide flat frog head
    r.part('head', ellipsoid(0.165 * H, 0.1 * H, 0.14 * H, 22, 14), col.main, { pos: [0, 0.1 * H, 0.02], shade: 0.12 });
    r.part('head', ellipsoid(0.15 * H, 0.06 * H, 0.12 * H, 18, 10), col.light, { pos: [0, 0.06 * H, 0.04], shade: 0.05 });
  }
  if (plan.marks.includes('face-disc')) {
    r.part('head', disc(0.125 * H, 0.38, 20), col.light, { pos: [0, 0.122 * H, 0.098 * H], shade: 0.05 });
  }
  if (plan.marks.includes('tuxedo')) {
    r.part('head', ellipsoid(0.11 * H, 0.1 * H, 0.07 * H, 18, 12), col.light, { pos: [0, 0.1 * H, 0.098 * H], shade: 0.04 });
  }
  if (plan.marks.includes('mask')) {
    r.part('head', ellipsoid(0.13 * H, 0.05 * H, 0.08 * H, 18, 10), col.dark, { pos: [0, 0.14 * H, 0.083 * H], shade: 0.05 });
  }
  if (plan.marks.includes('brow')) {
    r.part('head', ellipsoid(0.075 * H, 0.032 * H, 0.06 * H, 14, 8), col.light, { pos: [0, 0.198 * H, 0.105 * H], shade: 0 });
  }
  if (plan.marks.includes('spines')) {
    let i = 0;
    for (let ring = 0; ring < 4; ring++) {
      const pitch = -0.1 + ring * 0.42;
      const n = 7 - ring;
      for (let k = 0; k < n; k++) {
        const yaw = Math.PI + (k / (n - 1) - 0.5) * (2.6 - ring * 0.35);
        const dx = Math.sin(yaw) * Math.cos(pitch);
        const dz = Math.cos(yaw) * Math.cos(pitch);
        const dy = Math.sin(pitch);
        const onHead = ring >= 2;
        const bone = onHead ? 'head' : 'torso';
        const cx = 0;
        const cy = onHead ? 0.125 * H : 0.11;
        const rad = onHead ? 0.13 * H : 0.1 * B;
        r.part(bone, cone(0.03, 0.085 + ((i * 37) % 5) * 0.004, 6), col.dark, {
          pos: [cx + dx * rad, cy + dy * rad, dz * rad],
          rot: aim(dx, dy + 0.35, dz),
          top: col.light,
          shade: 0.1,
        });
        i++;
      }
    }
  }

  // Eyes
  for (const side of [1, -1]) {
    const bone = side > 0 ? 'eyeL' : 'eyeR';
    if (plan.eyes === 'bulge') {
      r.part(bone, sphere(0.052 * H, 16, 12), col.main, { shade: 0.1 });
      r.part(bone, ellipsoid(0.026, 0.03, 0.014, 16, 12), '#20181d', { pos: [0, 0.006, 0.046 * H], shade: 0, fur: 0, gloss: 1 });
      r.part(bone, sphere(0.009, 8, 6), '#ffffff', { pos: [side * 0.008, 0.018, 0.058 * H], glow: 1, shade: 0 });
      continue;
    }
    if (plan.eyes === 'owl') {
      r.part(bone, disc(0.047 * H, 0.3, 18), '#f4b83f', { pos: [0, 0, -0.004], shade: 0 });
    }
    const big = plan.eyes === 'big' || plan.eyes === 'owl';
    const ex = big ? 0.029 : 0.024;
    const ey = big ? 0.036 : 0.031;
    r.part(bone, ellipsoid(ex, ey, 0.015, 18, 14), '#20181d', { rot: [0, side * 0.32, 0], shade: 0, fur: 0, gloss: 1 });
    r.part(bone, sphere(ex * 0.36, 10, 8), '#ffffff', { pos: [side * ex * 0.38, ey * 0.38, 0.012], glow: 1, shade: 0 });
    r.part(bone, sphere(ex * 0.16, 8, 6), '#ffffff', { pos: [-side * ex * 0.15, -ey * 0.38, 0.014], glow: 1, shade: 0 });
  }
  // Cheeks
  if (plan.eyes !== 'bulge') {
    r.part('head', disc(0.025 * H, 0.3), col.blush, { pos: [0.094 * H, 0.083 * H, 0.112 * H], rot: [0, 0.72, 0], shade: 0 });
    r.part('head', disc(0.025 * H, 0.3), col.blush, { pos: [-0.094 * H, 0.083 * H, 0.112 * H], rot: [0, -0.72, 0], shade: 0 });
  }

  // Snout, nose, mouth
  const mouthCol = '#5c2b30';
  switch (plan.snout) {
    case 'pointy': {
      r.part('head', softCone(0.064 * H, 0.1 * H, 14, 0.35), col.light, { pos: [0, 0.074 * H, 0.105 * H], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.78], top: col.main, shade: 0.05 });
      r.part('head', sphere(0.019 * H, 12, 10), col.dark, { pos: [0, 0.083 * H, 0.2 * H], shade: 0, fur: 0, gloss: 0.8 });
      break;
    }
    case 'button': {
      r.part('head', sphere(0.034 * H, 12, 9), col.light, { pos: [0.023 * H, 0.068 * H, 0.134 * H], shade: 0.05 });
      r.part('head', sphere(0.034 * H, 12, 9), col.light, { pos: [-0.023 * H, 0.068 * H, 0.134 * H], shade: 0.05 });
      r.part('head', ellipsoid(0.016 * H, 0.011 * H, 0.01 * H, 10, 8), '#e98593', { pos: [0, 0.094 * H, 0.161 * H], shade: 0, fur: 0, gloss: 0.7 });
      break;
    }
    case 'round': {
      r.part('head', ellipsoid(0.07 * H, 0.052 * H, 0.05 * H, 16, 10), col.light, { pos: [0, 0.07 * H, 0.128 * H], shade: 0.05 });
      r.part('head', ellipsoid(0.025 * H, 0.017 * H, 0.014 * H, 10, 8), col.dark, { pos: [0, 0.097 * H, 0.172 * H], shade: 0, fur: 0, gloss: 0.8 });
      break;
    }
    case 'beak': {
      r.part('head', softCone(0.032 * H, 0.052 * H, 10, 0.2), '#f2a23a', { pos: [0, 0.092 * H, 0.138 * H], rot: [Math.PI / 2 + 0.25, 0, 0], scale: [1, 1, 0.75], shade: 0.1, fur: 0, gloss: 0.4 });
      break;
    }
    case 'wide': {
      r.part('head', sphere(0.007, 6, 4), col.dark, { pos: [0.02, 0.115 * H, 0.155 * H], shade: 0 });
      r.part('head', sphere(0.007, 6, 4), col.dark, { pos: [-0.02, 0.115 * H, 0.155 * H], shade: 0 });
      break;
    }
  }
  if (plan.snout === 'wide') r.part('jaw', ellipsoid(0.075 * H, 0.02, 0.016, 18, 8), mouthCol, { shade: 0, fur: 0 });
  else if (plan.snout === 'beak') r.part('jaw', softCone(0.024 * H, 0.03 * H, 10, 0.2), '#d9862c', { rot: [Math.PI / 2 + 0.5, 0, 0], scale: [1, 1, 0.6], shade: 0.1, fur: 0, gloss: 0.4 });
  else r.part('jaw', ellipsoid(0.024, 0.017, 0.012, 12, 8), mouthCol, { shade: 0, fur: 0 });
  if (plan.whiskers) {
    for (const side of [1, -1]) {
      for (const k of [-1, 0, 1]) {
        r.part('head', cylinder(0.0022, 0.0022, 0.07, 4), '#f6efe6', {
          pos: [side * 0.07 * H, (0.074 + k * 0.012) * H, 0.15 * H],
          rot: [0, 0, side * (Math.PI / 2 + k * 0.16)],
          shade: 0,
          fur: 0,
        });
      }
    }
  }

  // Ears
  const innerCol = plan.model === 'rabbit' || plan.model === 'mouse' || plan.model === 'cat' ? '#f3a6b0' : col.light;
  for (const side of [1, -1]) {
    const bone = side > 0 ? 'earL' : 'earR';
    const tilt = side * -1;
    switch (plan.ears) {
      case 'pointy':
        r.part(bone, softCone(0.06 * H, 0.13 * H, 16, 0.2), col.main, { rot: [-0.08, 0, tilt * 0.28], scale: [1, 1, 0.48], top: col.dark, shade: 0 });
        r.part(bone, softCone(0.034 * H, 0.08 * H, 8, 0.2), col.light, { pos: [tilt * 0.006, 0.01, 0.014], rot: [-0.08, 0, tilt * 0.28], scale: [1, 1, 0.35], shade: 0 });
        break;
      case 'cat':
        r.part(bone, softCone(0.052 * H, 0.09 * H, 16, 0.2), col.main, { rot: [-0.05, 0, tilt * 0.3], scale: [1, 1, 0.5], shade: 0 });
        r.part(bone, softCone(0.03 * H, 0.055 * H, 8, 0.2), innerCol, { pos: [tilt * 0.004, 0.008, 0.013], rot: [-0.05, 0, tilt * 0.3], scale: [1, 1, 0.35], shade: 0 });
        break;
      case 'long':
        r.part(bone, feather(0.042 * H, 0.23 * H, 0.022 * H, 16), col.main, { rot: [-0.12, 0, tilt * 0.16], shade: 0.05 });
        r.part(bone, feather(0.026 * H, 0.18 * H, 0.012 * H, 10), innerCol, { pos: [tilt * 0.003, 0.02, 0.014], rot: [-0.12, 0, tilt * 0.16], shade: 0 });
        break;
      case 'round':
        r.part(bone, sphere(0.05 * H, 18, 12), col.main, { pos: [0, 0.02, 0], scale: [1, 1, 0.55], shade: 0 });
        r.part(bone, sphere(0.03 * H, 10, 8), plan.model === 'raccoon' ? col.light : col.dark, { pos: [0, 0.018, 0.018], scale: [1, 1, 0.35], shade: 0 });
        break;
      case 'mouse':
        r.part(bone, sphere(0.078 * H, 22, 14), col.main, { pos: [tilt * -0.02, 0.03, 0], rot: [-0.1, 0, 0], scale: [1, 1, 0.32], shade: 0 });
        r.part(bone, sphere(0.055 * H, 14, 10), innerCol, { pos: [tilt * -0.02, 0.03, 0.016], rot: [-0.1, 0, 0], scale: [1, 1, 0.2], shade: 0 });
        break;
      case 'small':
        r.part(bone, sphere(0.032 * H, 10, 8), col.main, { pos: [tilt * -0.012, -0.02, 0], scale: [1, 1, 0.6], shade: 0 });
        break;
      case 'tufts':
        r.part(bone, softCone(0.032 * H, 0.085 * H, 8, 0.2), col.dark, { rot: [-0.25, 0, tilt * 0.55], scale: [1, 1, 0.5], shade: 0 });
        break;
      case 'deer':
        r.part(bone, feather(0.036 * H, 0.1 * H, 0.016 * H, 10), col.main, { pos: [tilt * -0.01, -0.03, 0], rot: [0, 0, tilt * 1.2], shade: 0 });
        r.part(bone, feather(0.02 * H, 0.07 * H, 0.009 * H, 8), '#f3c7b4', { pos: [tilt * -0.012, -0.028, 0.009], rot: [0, 0, tilt * 1.2], shade: 0 });
        break;
      case 'none':
        break;
    }
    if (plan.antlers) {
      const beam: PartOptions = { pos: [tilt * -0.012, 0.0, -0.015], rot: [-0.25, 0, tilt * 0.35], shade: 0.1, top: '#f4e2c4' };
      r.part(bone, cylinder(0.0075, 0.011, 0.12, 6), '#c9a57a', { ...beam, pos: [tilt * -0.03, 0.06, -0.025] });
      r.part(bone, cylinder(0.006, 0.008, 0.06, 6), '#c9a57a', { pos: [tilt * -0.012, 0.085, -0.005], rot: [0.3, 0, tilt * -0.4], shade: 0.1, top: '#f4e2c4' });
      r.part(bone, sphere(0.009, 6, 4), '#f4e2c4', { pos: [tilt * -0.052, 0.12, -0.04], shade: 0 });
    }
  }

  // Tail
  switch (plan.tail) {
    case 'bushy':
      r.part('tail', feather(0.068 * B, 0.24, 0.06, 18), col.main, { rot: [-1.15, 0, 0], top: col.light, shade: 0.1 });
      break;
    case 'ringed': {
      for (let i = 0; i < 5; i++) {
        const t = i / 4;
        r.part('tail', sphere(0.05 * (1 - t * 0.25), 12, 9), i % 2 === 0 ? col.main : col.dark, {
          pos: [0, 0.03 + i * 0.038, -0.02 - i * 0.032],
          scale: [1, 0.9, 1.05],
          shade: 0.1,
        });
      }
      break;
    }
    case 'puff':
      r.part('tail', sphere(0.048, 12, 9), col.light, { pos: [0, 0.01, -0.01], shade: 0.1 });
      break;
    case 'curl': {
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        r.part('tail', sphere(0.024 * (1 - t * 0.25), 10, 8), col.main, {
          pos: [Math.sin(t * 2.4) * 0.03, 0.01 + t * 0.2, -0.04 - Math.sin(t * 2.8) * 0.06],
          shade: 0.1,
        });
      }
      break;
    }
    case 'thin':
      r.part('tail', capsule(0.011, 0.2, 6, 3), '#e9a7ae', { pos: [0, 0.0, -0.1], rot: [-1.35, 0, 0], shade: 0.1 });
      break;
    case 'flat':
      r.part('tail', feather(0.05, 0.22, 0.026, 12), col.main, { rot: [-1.95, 0, 0], shade: 0.15 });
      break;
    case 'stub':
      r.part('tail', sphere(0.034, 10, 8), col.main, { shade: 0.1 });
      break;
    case 'fan':
      for (const k of [-1, 0, 1]) r.part('tail', feather(0.032, 0.08, 0.012, 8), col.dark, { rot: [-1.9, 0, k * 0.4], shade: 0.1 });
      break;
    case 'none':
      break;
  }

  for (const g of gearFor(res.trade)) addGear(r, g, col, plan);

  const rig = r.build(lifeMaterial());
  const s = plan.height;
  rig.mesh.scale.setScalar(s);
  rig.mesh.name = `resident-${plan.model}`;
  const b = rig.bones;
  const hasEars = plan.ears !== 'none';

  const apply = (p: Float32Array): void => {
    resetPose(rig);
    const sit = p[P.SIT];
    b.hips.position.y += p[P.BOB] - sit * 0.088;
    turn(b.hips, 0, p[P.TWIST] * 0.4, 0);
    const sq = p[P.SQUASH];
    b.torso.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    turn(b.torso, p[P.LEAN] - sit * 0.08, p[P.TWIST] * 0.6, p[P.SWAY]);
    turn(b.neck, p[P.HX] * 0.4, p[P.HY] * 0.4, p[P.HZ] * 0.4, 'YXZ');
    turn(b.head, p[P.HX] * 0.6, p[P.HY] * 0.6, p[P.HZ] * 0.6, 'YXZ');
    b.head.scale.set(1, 1 / Math.max(0.6, sq), 1);
    turn(b.armL, p[P.ALX], p[P.ALY], 0.16 + p[P.ALZ]);
    turn(b.armR, p[P.ARX], p[P.ARY], -0.16 + p[P.ARZ]);
    turn(b.legL, p[P.LL] - sit * 1.45, 0, sit * 0.12);
    turn(b.legR, p[P.LR] - sit * 1.45, 0, -sit * 0.12);
    if (hasEars) {
      const droop = p[P.EARS];
      turn(b.earL, droop * 0.5, 0, -droop * 0.6 + p[P.EARTWITCH]);
      turn(b.earR, droop * 0.5, 0, droop * 0.6);
    }
    turn(b.tail, p[P.TAILX], p[P.TAILW], 0);
    turn(b.hat, p[P.HATX], 0, p[P.HATZ]);
    turn(b.scarf, p[P.SCARF], 0, p[P.SCARFZ]);
    turn(b.apron, -p[P.APRON], 0, 0);
    b.eyeL.position.x += p[P.EYEX] * 0.006 * H;
    b.eyeR.position.x += p[P.EYEX] * 0.006 * H;
    b.eyeL.position.y += p[P.EYEY] * 0.005 * H;
    b.eyeR.position.y += p[P.EYEY] * 0.005 * H;
    const jaw = Math.min(1, Math.max(0, p[P.JAW]));
    b.jaw.scale.set(1 + jaw * 0.1, 0.25 + jaw * 0.95, 1);
    if (plan.snout === 'beak') turn(b.jaw, jaw * 0.4, 0, 0);
    const open = Math.max(0.07, 1 - p[P.BLINK]);
    b.eyeL.scale.y = open;
    b.eyeR.scale.y = open;
  };
  const rest = new Float32Array(POSE_SIZE);
  rest[P.SQUASH] = 1;
  apply(rest);
  const top = 0.13 + 0.215 + (0.125 + 0.152) * H;
  return { mesh: rig.mesh, rig, plan, height: top * s, eyeHeight: (0.345 + eyeY * H) * s, apply };
}

function addGear(r: Rig, g: Gear, col: { main: string; accent: string; light: string; dark: string }, plan: BodyPlan): void {
  const H = plan.head;
  const B = plan.body;
  const acc: ColorRepresentation = col.accent;
  const part = (bone: string, geo: Parameters<Rig['part']>[1], color: ColorRepresentation, o: PartOptions = {}): void => {
    r.part(bone, geo, color, { fur: 0.35, ...o });
  };
  switch (g) {
    case 'chef-hat':
      part('hat', cylinder(0.072, 0.068, 0.07, 24), '#fbf7f0', { pos: [0, 0.02, 0], shade: 0.12 });
      part('hat', ellipsoid(0.1, 0.07, 0.1, 24, 14), '#ffffff', { pos: [0, 0.08, 0], shade: 0.18 });
      break;
    case 'apron':
    case 'paint-apron': {
      // Light cloth for a baker or tea-maker, tinted with the accent.
      const apronCol = g === 'apron' ? new Color(acc).lerp(new Color('#fff6e8'), 0.55).getStyle() : '#f2ead8';
      part('apron', ellipsoid(0.088 * B, 0.1, 0.02, 22, 14), apronCol, { pos: [0, -0.095, 0.005 * B], rot: [0.2, 0, 0], shade: 0.06 });
      part('apron', ellipsoid(0.03, 0.022, 0.008, 12, 8), g === 'apron' ? '#fff3e2' : '#e0d3b8', { pos: [0.025, -0.13, 0.027 * B], rot: [0.2, 0, 0], shade: 0 });
      part('torso', torus(0.112 * B, 0.006, 4, 22), g === 'apron' ? acc : '#e0d3b8', { pos: [0, 0.07, 0.0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.93, 1], shade: 0 });
      if (g === 'paint-apron') {
        const dots: [number, number, string][] = [[0.03, 0.11, '#e45b4f'], [-0.04, 0.07, '#4f8fe4'], [0.0, 0.04, '#f2c43b'], [-0.015, 0.13, '#57b36a'], [0.045, 0.06, acc as string]];
        for (const [x, y, c] of dots) part('apron', disc(0.012, 0.4, 8), c, { pos: [x, y - 0.17, 0.028 * B], rot: [0.14, 0, 0], shade: 0, fur: 0 });
      }
      break;
    }
    case 'pointed-hat':
      part('hat', torus(0.105, 0.016, 6, 22), acc, { pos: [0, -0.012, 0], rot: [Math.PI / 2, 0, 0], shade: 0 });
      part('hat', softCone(0.1, 0.24, 22, 0.15), acc, { pos: [0, -0.012, 0], rot: [-0.18, 0, 0.12], shade: 0.2 });
      part('hat', sphere(0.022, 8, 6), '#ffe27a', { pos: [0.028, 0.215, -0.04], glow: 0.7, shade: 0 });
      break;
    case 'rain-hat':
      part('hat', lathe([[0, 0.08], [0.06, 0.078], [0.09, 0.05], [0.1, 0.0], [0.165, -0.03], [0.17, -0.04], [0.0, -0.035]], 30), '#f5c242', { pos: [0, -0.02, -0.01], rot: [-0.12, 0, 0], shade: 0.12 });
      break;
    case 'straw-hat':
      part('hat', lathe([[0, 0.075], [0.07, 0.072], [0.085, 0.02], [0.095, 0.0], [0.19, -0.01], [0.195, -0.02], [0.0, -0.016]], 30), '#e8c97f', { pos: [0, -0.012, 0], rot: [-0.08, 0, 0.06], shade: 0.15 });
      part('hat', torus(0.089, 0.012, 5, 20), acc, { pos: [0, 0.006, 0], rot: [Math.PI / 2 - 0.08, 0.06, 0], shade: 0 });
      break;
    case 'wide-hat':
      part('hat', lathe([[0, 0.065], [0.075, 0.06], [0.088, 0.0], [0.2, -0.02], [0.205, -0.03], [0, -0.026]], 30), '#f1e6cf', { pos: [0, -0.01, 0], shade: 0.15 });
      part('hat', torus(0.09, 0.011, 5, 20), acc, { pos: [0, 0.008, 0], rot: [Math.PI / 2, 0, 0], shade: 0 });
      part('hat', torus(0.2, 0.006, 4, 26), '#c9b48c', { pos: [0, -0.024, 0], rot: [Math.PI / 2, 0, 0], shade: 0 });
      break;
    case 'goggles':
      part('hat', torus(0.142 * H, 0.012, 5, 26), '#5a4335', { pos: [0, -0.07 * H, 0], rot: [Math.PI / 2 + 0.25, 0, 0], shade: 0 });
      for (const side of [1, -1]) {
        part('hat', torus(0.034, 0.011, 6, 16), '#c99a4a', { pos: [side * 0.05, -0.05 * H, 0.122 * H], rot: [-0.45, side * 0.3, 0], shade: 0 });
        part('hat', disc(0.028, 0.3, 12), '#9fd3e6', { pos: [side * 0.05, -0.05 * H, 0.122 * H], rot: [-0.45, side * 0.3, 0], glow: 0.35, shade: 0 });
      }
      break;
    case 'glasses':
      for (const side of [1, -1]) {
        part('head', torus(0.036 * H, 0.0055, 5, 18), '#3b2d27', { pos: [side * 0.057 * H, 0.14 * H, 0.162 * H], rot: [0, side * 0.28, 0], shade: 0 });
      }
      part('head', cylinder(0.004, 0.004, 0.04, 4), '#3b2d27', { pos: [0, 0.145 * H, 0.168 * H], rot: [0, 0, Math.PI / 2], shade: 0 });
      break;
    case 'scarf':
      part('neck', torus(0.098 * B, 0.03, 8, 22), acc, { pos: [0, 0.0, 0.004], rot: [Math.PI / 2 + 0.1, 0, 0], scale: [1, 1.04, 1], shade: 0.15 });
      part('scarf', capsule(0.026, 0.09, 10, 3), acc, { pos: [0, -0.045, 0], rot: [0.25, 0, 0.18], scale: [1, 1, 0.5], shade: 0.15 });
      break;
    case 'headscarf':
      part('head', sphere(0.157 * H, 20, 12), acc, { pos: [0, 0.165 * H, -0.03 * H], scale: [1.0, 0.82, 0.96], shade: 0.15 });
      part('head', sphere(0.03, 10, 8), acc, { pos: [0.07, 0.1 * H, -0.135 * H], shade: 0.15 });
      part('head', feather(0.025, 0.07, 0.01, 8), acc, { pos: [0.07, 0.09 * H, -0.14 * H], rot: [2.6, 0, -0.4], shade: 0.1 });
      break;
    case 'beret':
      part('hat', ellipsoid(0.13, 0.045, 0.13, 18, 10), acc, { pos: [0.02, 0.0, -0.005], rot: [0.1, 0, -0.22], shade: 0.15 });
      part('hat', cylinder(0.006, 0.008, 0.025, 6), acc, { pos: [0.02, 0.05, 0], shade: 0 });
      break;
    case 'bow-tie':
      part('neck', softCone(0.03, 0.05, 8, 0.1), acc, { pos: [0.004, -0.012, 0.1 * B], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.6], shade: 0.1 });
      part('neck', softCone(0.03, 0.05, 8, 0.1), acc, { pos: [-0.004, -0.012, 0.1 * B], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.6], shade: 0.1 });
      part('neck', sphere(0.014, 8, 6), acc, { pos: [0, -0.012, 0.104 * B], shade: 0 });
      break;
    case 'top-hat':
      part('hat', cylinder(0.12, 0.12, 0.01, 18), '#2d2a33', { pos: [0, -0.005, 0], rot: [0, 0, -0.15], shade: 0 });
      part('hat', cylinder(0.07, 0.075, 0.11, 16), '#2d2a33', { pos: [-0.008, 0.05, 0], rot: [0, 0, -0.15], shade: 0.1 });
      part('hat', cylinder(0.077, 0.077, 0.022, 16), acc, { pos: [-0.004, 0.012, 0], rot: [0, 0, -0.15], shade: 0 });
      break;
    case 'cap':
      part('hat', lathe([[0, 0.06], [0.07, 0.058], [0.11, 0.035], [0.105, 0.0], [0.0, 0.0]], 30), '#2f3b52', { pos: [0, -0.015, 0], shade: 0.12 });
      part('hat', cylinder(0.108, 0.108, 0.02, 20), '#f4f1ea', { pos: [0, -0.008, 0], shade: 0 });
      part('hat', ellipsoid(0.085, 0.01, 0.06, 14, 6), '#1f2738', { pos: [0, -0.016, 0.1], rot: [0.2, 0, 0], shade: 0 });
      part('hat', sphere(0.012, 8, 6), '#e9c46a', { pos: [0, 0.01, 0.108], glow: 0.3, shade: 0 });
      break;
    case 'backpack':
      part('torso', ellipsoid(0.085 * B, 0.1, 0.055, 14, 10), acc, { pos: [0, 0.13, -0.115 * B], shade: 0.2 });
      part('torso', ellipsoid(0.06 * B, 0.04, 0.03, 12, 8), acc, { pos: [0, 0.08, -0.16 * B], shade: 0.15 });
      part('torso', cylinder(0.022, 0.022, 0.2, 10), '#f3e7c9', { pos: [0.04, 0.24, -0.12 * B], rot: [0.15, 0, -0.5], shade: 0.05 });
      part('torso', torus(0.11 * B, 0.008, 4, 18), '#5a4335', { pos: [0, 0.16, -0.01], rot: [Math.PI / 2 - 0.4, 0, 0], scale: [1, 0.8, 1], shade: 0 });
      break;
    case 'tool-belt':
      part('torso', torus(0.118 * B, 0.014, 6, 24), '#6b4a33', { pos: [0, 0.045, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.92, 1], shade: 0 });
      part('torso', ellipsoid(0.035, 0.035, 0.022, 10, 8), '#8a6142', { pos: [0.07 * B, 0.03, 0.08 * B], rot: [0, 0.6, 0], shade: 0.1 });
      part('torso', cylinder(0.006, 0.006, 0.06, 5), '#9aa3ad', { pos: [-0.08 * B, 0.05, 0.075 * B], shade: 0 });
      break;
  }
}
