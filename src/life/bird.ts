// A round little bird built in code: body, head, big glossy eyes with two highlights,
// two-part beak, cheeks, crest, wings, tail fan and feet, each on its own bone.
import type { SkinnedMesh } from '@iwsdk/core';
import { Rig, lifeMaterial, resetPose, turn, type RigMesh } from './rig';
import { cylinder, disc, egg, ellipsoid, feather, softCone, sphere, withDetail } from './shapes';

export interface BirdColors {
  main: string;
  top: string;
  belly: string;
  wing: string;
  crest: string;
  beak: string;
  cheek: string;
  feet: string;
}

export const PIP_COLORS: BirdColors = {
  main: '#ffbf2e',
  top: '#ffd75e',
  belly: '#fff3d2',
  wing: '#f29a1f',
  crest: '#ff6f3c',
  beak: '#ff8a3a',
  cheek: '#ff8f8f',
  feet: '#f0883a',
};

/** The flock, warm and distinct from Pip's yellow. */
export const FLOCK_COLORS: BirdColors[] = [
  { main: '#39b4a5', top: '#5fd0c0', belly: '#e6fbf3', wing: '#24877f', crest: '#1f6f69', beak: '#ffb347', cheek: '#ff9d9d', feet: '#e8913f' },
  { main: '#f07a62', top: '#ff9a80', belly: '#ffe9de', wing: '#cf5a47', crest: '#b8473a', beak: '#ffc04d', cheek: '#ffb0a0', feet: '#e8913f' },
  { main: '#58a6e2', top: '#7cc0f2', belly: '#eaf6ff', wing: '#3a80bd', crest: '#2f6aa3', beak: '#ffb347', cheek: '#ff9db0', feet: '#e8913f' },
  { main: '#86c759', top: '#a6dc78', belly: '#f3ffe2', wing: '#5c9f3d', crest: '#4b8a31', beak: '#ffaa3b', cheek: '#ff9d9d', feet: '#e8913f' },
  { main: '#f497b2', top: '#ffb4c8', belly: '#fff0f4', wing: '#d66f91', crest: '#c45a7e', beak: '#ffb347', cheek: '#ff7f9f', feet: '#e8913f' },
  { main: '#e6b167', top: '#f4c985', belly: '#fff6e5', wing: '#c48b45', crest: '#a87236', beak: '#ff9e3d', cheek: '#ff9d9d', feet: '#e0853a' },
  { main: '#6f93c4', top: '#8eaedb', belly: '#eef3fb', wing: '#4f71a1', crest: '#40618f', beak: '#ffb347', cheek: '#ff9db0', feet: '#e8913f' },
  { main: '#f3ece0', top: '#fffaf1', belly: '#ffffff', wing: '#8d7766', crest: '#6f5a4b', beak: '#ff9e3d', cheek: '#ffa3a3', feet: '#e0853a' },
];

export interface BirdPose {
  /** 0 folded, 1 full flight flapping. */
  fly: number;
  /** Wing beat phase, radians. */
  phase: number;
  /** Extra beat amplitude (take-off, carrying), 0..1. */
  effort: number;
  beak: number;
  blink: number;
  headYaw: number;
  headPitch: number;
  headRoll: number;
  bodyPitch: number;
  bodyRoll: number;
  /** Squash and stretch of the body: 1 rest, <1 squashed. */
  squash: number;
  tail: number;
  /** Preening: head tucked toward a wing, 0..1, sign picks the side. */
  preen: number;
  /** Feathers puffed up (cold gust, happy), 0..1. */
  fluff: number;
  /** Wind in the bird's own frame (x right, z forward), m/s. */
  windX: number;
  windZ: number;
  /** Look direction offset of the eyes, -1..1. */
  eyeX: number;
  /** Legs reaching forward for a landing, 0..1. */
  reach: number;
}

export function restBirdPose(): BirdPose {
  return { fly: 0, phase: 0, effort: 0, beak: 0, blink: 0, headYaw: 0, headPitch: 0, headRoll: 0, bodyPitch: 0, bodyRoll: 0, squash: 1, tail: 0, preen: 0, fluff: 0, windX: 0, windZ: 0, eyeX: 0, reach: 0 };
}

export interface BirdModel {
  mesh: SkinnedMesh;
  rig: RigMesh;
  /** Height of the eyes above the feet, metres (scaled). */
  eyeHeight: number;
  apply(p: BirdPose): void;
}

export function createBirdModel(c: BirdColors, scale = 1, lead = false, detail = 1): BirdModel {
  return withDetail(detail, () => buildBird(c, scale, lead));
}

function buildBird(c: BirdColors, scale: number, lead: boolean): BirdModel {
  const r = new Rig();
  r.bone('root', null, 0, 0, 0);
  r.bone('body', 'root', 0, 0.05, 0);
  r.bone('head', 'body', 0, 0.042, 0.01);
  r.bone('eyeL', 'head', 0.0195, 0.028, 0.035);
  r.bone('eyeR', 'head', -0.0195, 0.028, 0.035);
  r.bone('beak', 'head', 0, 0.017, 0.041);
  r.bone('crest', 'head', 0, 0.058, 0.006);
  r.bone('jaw', 'head', 0, 0.011, 0.038);
  r.bone('wingL', 'body', 0.039, 0.03, 0.0);
  r.bone('wingR', 'body', -0.039, 0.03, 0.0);
  r.bone('tail', 'body', 0, 0.006, -0.044);
  r.bone('footL', 'root', 0.017, 0.012, 0.004);
  r.bone('footR', 'root', -0.017, 0.012, 0.004);

  // Body and belly: one chubby mass, lighter on the chest.
  r.part('body', egg(0.049, 0.047, 0.052, 0.18, 30, 22), c.main, { top: c.top, shade: 0.3 });
  r.part('body', ellipsoid(0.033, 0.032, 0.021, 22, 14), c.belly, { pos: [0, -0.011, 0.034], rot: [0.2, 0, 0], shade: 0.25 });
  // Head
  r.part('head', sphere(0.043, 30, 22), c.main, { pos: [0, 0.022, 0.004], top: c.top, shade: 0.1 });
  // Eyes: glossy dark ovals with two highlights; on bones so they can blink.
  for (const side of [1, -1]) {
    const bone = side > 0 ? 'eyeL' : 'eyeR';
    r.part(bone, ellipsoid(0.0135, 0.0165, 0.009, 18, 14), '#22181f', { rot: [0, side * 0.42, 0], shade: 0, fur: 0, gloss: 1 });
    r.part(bone, sphere(0.0047, 10, 8), '#ffffff', { pos: [side * 0.0052, 0.0062, 0.0072], glow: 1, shade: 0 });
    r.part(bone, sphere(0.0022, 8, 6), '#ffffff', { pos: [-side * 0.0018, -0.0058, 0.0084], glow: 1, shade: 0 });
  }
  // Cheeks
  r.part('head', disc(0.009, 0.3), c.cheek, { pos: [0.03, 0.009, 0.029], rot: [0, 0.85, 0], shade: 0 });
  r.part('head', disc(0.009, 0.3), c.cheek, { pos: [-0.03, 0.009, 0.029], rot: [0, -0.85, 0], shade: 0 });
  // Beak: upper on 'beak', lower on 'jaw' so it opens.
  r.part('beak', softCone(0.0125, 0.024, 14, 0.2), c.beak, { rot: [Math.PI / 2, 0, 0], scale: [1.15, 1, 0.72], shade: 0.15, fur: 0, gloss: 0.5 });
  r.part('jaw', softCone(0.0095, 0.017, 12, 0.2), c.beak, { rot: [Math.PI / 2 + 0.05, 0, 0], scale: [1.05, 1, 0.55], shade: 0.35, fur: 0, gloss: 0.4 });
  // Crest: a tuft of feathers, bigger and curlier on Pip.
  const crestN = lead ? 4 : 3;
  for (let i = 0; i < crestN; i++) {
    const t = i / (crestN - 1) - 0.5;
    const len = (lead ? 0.034 : 0.024) * (1 - Math.abs(t) * 0.5);
    r.part('crest', feather(0.007, len, 0.004, 8), c.crest, {
      pos: [t * 0.012, 0.002, 0.002 - Math.abs(t) * 0.006],
      rot: [-0.55 - (lead ? 0.25 : 0), 0, -t * 0.9],
      shade: 0.1,
    });
  }
  // Wings: paddles hanging along the sides, pivoting at the shoulder.
  r.part('wingL', feather(0.009, 0.056, 0.03, 10), c.wing, { pos: [0.007, -0.022, 0.004], rot: [-1.95, 0, 0.05], top: c.main, shade: 0.12 });
  r.part('wingR', feather(0.009, 0.056, 0.03, 10), c.wing, { pos: [-0.007, -0.022, 0.004], rot: [-1.95, 0, -0.05], top: c.main, shade: 0.12 });
  // Tail fan
  for (const t of [-1, 0, 1]) {
    r.part('tail', feather(0.013, 0.042 - Math.abs(t) * 0.006, 0.0045, 8), c.wing, { rot: [-1.0, 0, t * 0.42], shade: 0.15 });
  }
  // Feet: short legs and round toes.
  for (const side of [1, -1]) {
    const bone = side > 0 ? 'footL' : 'footR';
    r.part(bone, cylinder(0.003, 0.0035, 0.016, 6), c.feet, { pos: [0, 0.0, 0], shade: 0, fur: 0 });
    r.part(bone, ellipsoid(0.008, 0.0035, 0.011, 10, 6), c.feet, { pos: [0, -0.009, 0.006], shade: 0.1, fur: 0 });
  }

  const rig = r.build(lifeMaterial());
  rig.mesh.scale.setScalar(scale);
  rig.mesh.name = lead ? 'pip' : 'bird';
  const b = rig.bones;

  const TAU = Math.PI * 2;
  const apply = (p: BirdPose): void => {
    resetPose(rig);
    const fly = p.fly;
    // Wing beat with a quick downstroke (40% of the cycle) and a slower recovery.
    const ph = ((p.phase % TAU) + TAU) % TAU;
    const warped = ph < TAU * 0.4 ? (ph / (TAU * 0.4)) * Math.PI : Math.PI + ((ph - TAU * 0.4) / (TAU * 0.6)) * Math.PI;
    const beat = Math.cos(warped); // +1 wings up, -1 wings down
    // Body: squash keeps the volume, rises a little on each downstroke, fluffs in gusts.
    const fl = 1 + p.fluff * 0.09;
    const sq = p.squash;
    b.body.scale.set(fl / Math.sqrt(sq), sq * (1 + p.fluff * 0.05), fl / Math.sqrt(sq));
    b.body.position.y += fly * -beat * 0.0035;
    turn(b.body, p.bodyPitch + fly * 0.35, 0, p.bodyRoll);
    // Head stays steady against the body bob, looks where it is told.
    b.head.position.y += fly * beat * 0.0025;
    turn(b.head, p.headPitch - fly * 0.25 + p.preen * 0.5, p.headYaw + Math.sign(p.preen) * Math.abs(p.preen) * 1.1, p.headRoll + p.preen * 0.35, 'YXZ');
    // Eyes blink by squashing on y and glance by sliding a little.
    const open = Math.max(0.08, 1 - p.blink);
    b.eyeL.scale.y = open;
    b.eyeR.scale.y = open;
    b.eyeL.position.x += p.eyeX * 0.0025;
    b.eyeR.position.x += p.eyeX * 0.0025;
    // Beak
    turn(b.jaw, p.beak * 0.55, 0, 0);
    turn(b.beak, -p.beak * 0.12, 0, 0);
    // Crest bends with the wind and the flight.
    turn(b.crest, -Math.min(0.9, Math.max(-0.6, p.windZ * 0.06 + fly * 0.35)), 0, Math.max(-0.6, Math.min(0.6, -p.windX * 0.06)));
    // Wings: folded hug the body; in flight spread and beat; puffed slightly in a fluff.
    const amp = 0.62 + 0.38 * p.effort;
    const spread = fly * (1.2 + beat * amp);
    const fold = (1 - fly) * (0.06 + p.fluff * 0.12) + Math.max(0, p.preen) * 0.5;
    turn(b.wingL, fly * (0.25 - beat * 0.12), 0, spread + fold);
    turn(b.wingR, fly * (0.25 - beat * 0.12), 0, -spread - fold - Math.max(0, -p.preen) * 0.5);
    // Tail steers and catches the wind.
    turn(b.tail, -fly * 0.35 + p.tail * 0.2 - p.windZ * 0.02, p.tail * 0.35 + p.windX * 0.03, 0);
    // Feet tuck back in flight, reach forward to land.
    const legX = -fly * 1.1 * (1 - p.reach) + p.reach * 0.6;
    turn(b.footL, legX, 0, 0);
    turn(b.footR, legX, 0, 0);
    const tuck = 1 - fly * 0.5 * (1 - p.reach);
    b.footL.scale.setScalar(tuck);
    b.footR.scale.setScalar(tuck);
  };
  apply(restBirdPose());
  return { mesh: rig.mesh, rig, eyeHeight: 0.077 * scale, apply };
}
