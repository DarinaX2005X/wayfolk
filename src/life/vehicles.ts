// What travelers come in on, built in code and coloured from the traveler: balloon,
// paper boat, kite, cloud whale, umbrella, lantern. One skinned mesh each.
import { Color, LatheGeometry, Vector2, Vector3, type SkinnedMesh } from '@iwsdk/core';
import type { Vehicle } from '../mind/types';
import { Rig, lifeMaterial, resetPose, turn } from './rig';
import { cone, cylinder, disc, egg, ellipsoid, feather, sphere, torus } from './shapes';

export interface VehicleModel {
  mesh: SkinnedMesh;
  kind: Vehicle;
  /** Where the traveler is, in the vehicle's local space (feet). */
  seat: Vector3;
  seatPose: 'stand' | 'sit' | 'hang';
  /** Rough size for puffs and glow, metres. */
  size: number;
  glow: boolean;
  /** Animate parts: t seconds, motion 0 (docked) .. 1 (travelling). */
  animate(t: number, motion: number): void;
}

function stripes(profile: [number, number][], n: number, a: string, b: string, r: Rig, bone: string, glow = 0): void {
  const pts = profile.map(([x, y]) => new Vector2(Math.max(x, 0.0001), y));
  for (let i = 0; i < n; i++) {
    const g = new LatheGeometry(pts, 4, (i / n) * Math.PI * 2, (Math.PI * 2) / n);
    r.part(bone, g, i % 2 === 0 ? a : b, { shade: 0.25, glow });
  }
}

export function createVehicle(kind: Vehicle, main: string, accent: string): VehicleModel {
  const r = new Rig();
  r.bone('root', null);
  const cream = '#fff3df';
  const wood = '#b97f4c';
  let seat = new Vector3();
  let seatPose: VehicleModel['seatPose'] = 'stand';
  let size = 2;
  let glow = false;
  switch (kind) {
    case 'balloon': {
      r.bone('basket', 'root');
      r.bone('env', 'root', 0, 1.25, 0);
      r.part('basket', cylinder(0.44, 0.36, 0.4, 18), '#c58b50', { pos: [0, 0.2, 0], shade: 0.35 });
      r.part('basket', torus(0.44, 0.045, 6, 22), '#9d6a3b', { pos: [0, 0.4, 0], rot: [Math.PI / 2, 0, 0], shade: 0 });
      r.part('basket', torus(0.4, 0.03, 5, 22), '#9d6a3b', { pos: [0, 0.16, 0], rot: [Math.PI / 2, 0, 0], shade: 0 });
      for (const [x, z] of [[0.36, 0.36], [-0.36, 0.36], [0.36, -0.36], [-0.36, -0.36]]) {
        r.part('basket', cylinder(0.008, 0.008, 1.0, 4), '#7a5a3a', { pos: [x * 0.85, 0.88, z * 0.85], rot: [z * 0.25, 0, -x * 0.25], shade: 0 });
      }
      stripes([[0.2, 0], [0.32, 0.12], [0.62, 0.42], [0.95, 0.85], [1.08, 1.25], [1.05, 1.62], [0.88, 1.95], [0.55, 2.18], [0.0001, 2.28]], 12, accent, cream, r, 'env');
      r.part('env', cylinder(0.22, 0.2, 0.08, 14), '#9d6a3b', { pos: [0, 0.0, 0], shade: 0 });
      r.part('env', sphere(0.1, 10, 8), accent, { pos: [0, 2.28, 0], shade: 0.1 });
      seat = new Vector3(0, 0.06, 0);
      size = 2.6;
      break;
    }
    case 'paper-boat': {
      r.bone('hull', 'root');
      const hull = cylinder(0.85, 0.5, 0.36, 4);
      hull.rotateY(Math.PI / 4);
      hull.scale(1.25, 1, 0.55);
      r.part('hull', hull, '#f6f0e4', { pos: [0, 0.18, 0], shade: 0.35 });
      const sail = cone(0.62, 0.72, 4);
      sail.rotateY(Math.PI / 4);
      sail.scale(1.0, 1, 0.12);
      r.part('hull', sail, '#fbf7ee', { pos: [0.18, 0.34, 0], shade: 0.3, top: '#ffffff' });
      r.part('hull', disc(0.08, 0.2, 10), accent, { pos: [0.18, 0.62, 0.06], shade: 0 });
      seat = new Vector3(-0.42, 0.24, 0);
      size = 1.8;
      break;
    }
    case 'kite': {
      r.bone('kite', 'root', 0, 1.25, 0);
      r.bone('t1', 'kite', 0, -0.8, -0.05);
      r.bone('t2', 't1', 0, -0.25, 0);
      r.bone('t3', 't2', 0, -0.25, 0);
      r.bone('t4', 't3', 0, -0.25, 0);
      const diamond = sphere(1, 4, 2);
      diamond.scale(0.62, 0.85, 0.04);
      r.part('kite', diamond, accent, { shade: 0.2, top: new Color(accent).lerp(new Color('#ffffff'), 0.35).getStyle() });
      const inner = sphere(1, 4, 2);
      inner.scale(0.3, 0.42, 0.045);
      r.part('kite', inner, cream, { pos: [0, 0.15, 0.002], shade: 0.1 });
      r.part('kite', cylinder(0.012, 0.012, 1.7, 5), '#8a5a35', { shade: 0 });
      r.part('kite', cylinder(0.012, 0.012, 1.24, 5), '#8a5a35', { rot: [0, 0, Math.PI / 2], pos: [0, 0.12, 0], shade: 0 });
      // The bar the traveler holds and the strings to it.
      r.part('kite', cylinder(0.015, 0.015, 0.5, 6), wood, { pos: [0, -1.2, 0.05], rot: [0, 0, Math.PI / 2], shade: 0 });
      r.part('kite', cylinder(0.005, 0.005, 1.15, 3), '#efe6d6', { pos: [0.13, -0.66, 0.03], rot: [0, 0, 0.22], shade: 0 });
      r.part('kite', cylinder(0.005, 0.005, 1.15, 3), '#efe6d6', { pos: [-0.13, -0.66, 0.03], rot: [0, 0, -0.22], shade: 0 });
      for (const [i, b] of ['t1', 't2', 't3', 't4'].entries()) {
        r.part(b, cylinder(0.004, 0.004, 0.25, 3), '#efe6d6', { pos: [0, -0.125, 0], shade: 0 });
        r.part(b, cone(0.05, 0.08, 4), i % 2 ? accent : main, { pos: [0.045, -0.2, 0], rot: [0, 0, -Math.PI / 2], scale: [1, 1, 0.3], shade: 0 });
        r.part(b, cone(0.05, 0.08, 4), i % 2 ? accent : main, { pos: [-0.045, -0.2, 0], rot: [0, 0, Math.PI / 2], scale: [1, 1, 0.3], shade: 0 });
      }
      seat = new Vector3(0, -0.06 - 0.62, 0.05);
      seatPose = 'hang';
      size = 2;
      break;
    }
    case 'cloud-whale': {
      r.bone('body', 'root', 0, 0.75, 0);
      r.bone('tail', 'body', 0, 0.1, -1.45);
      r.bone('finL', 'body', 0.75, -0.25, 0.35);
      r.bone('finR', 'body', -0.75, -0.25, 0.35);
      r.part('body', egg(0.85, 0.72, 1.65, -0.25, 26, 18), '#dfe8f6', { top: '#f7fbff', shade: 0.4 });
      r.part('body', ellipsoid(0.7, 0.4, 1.3, 20, 12), '#fff6f0', { pos: [0, -0.32, 0.2], shade: 0.2 });
      // Puffy cloud tufts along the back so it reads as made of cloud.
      for (const [x, y, z, s] of [[0, 0.62, 0.5, 0.32], [0.25, 0.58, 0.0, 0.28], [-0.22, 0.6, -0.35, 0.3], [0.05, 0.5, -0.8, 0.26], [-0.3, 0.45, 0.55, 0.22], [0.32, 0.42, 0.75, 0.2]]) {
        r.part('body', sphere(s, 12, 9), '#ffffff', { pos: [x, y, z], shade: 0.2 });
      }
      for (const side of [1, -1]) {
        r.part('body', ellipsoid(0.07, 0.085, 0.04, 12, 10), '#2a2430', { pos: [side * 0.62, 0.08, 1.15], rot: [0, side * 0.9, 0], shade: 0 });
        r.part('body', sphere(0.026, 8, 6), '#ffffff', { pos: [side * 0.65, 0.12, 1.19], glow: 1, shade: 0 });
        r.part('body', disc(0.09, 0.3, 12), '#ffb1b1', { pos: [side * 0.66, -0.1, 1.1], rot: [0, side * 1.0, 0], shade: 0 });
      }
      r.part('body', torus(0.28, 0.022, 5, 16, Math.PI), '#6a7a96', { pos: [0, -0.08, 1.52], rot: [Math.PI / 2 + 0.1, 0, Math.PI], scale: [1, 1, 0.6], shade: 0 });
      r.part('tail', feather(0.42, 0.55, 0.06, 12), '#d4e0f2', { rot: [-Math.PI / 2, 0, 0.9], pos: [0.05, 0, 0], shade: 0.2 });
      r.part('tail', feather(0.42, 0.55, 0.06, 12), '#d4e0f2', { rot: [-Math.PI / 2, 0, -0.9], pos: [-0.05, 0, 0], shade: 0.2 });
      r.part('finL', feather(0.28, 0.5, 0.05, 10), '#d4e0f2', { rot: [-1.2, 0, -1.0], shade: 0.2 });
      r.part('finR', feather(0.28, 0.5, 0.05, 10), '#d4e0f2', { rot: [-1.2, 0, 1.0], shade: 0.2 });
      // A little saddle in the traveler's colour.
      r.part('body', ellipsoid(0.32, 0.06, 0.34, 14, 8), accent, { pos: [0, 0.71, 0.1], shade: 0.1 });
      seat = new Vector3(0, 1.5, 0.1);
      seatPose = 'sit';
      size = 3.4;
      break;
    }
    case 'umbrella': {
      r.bone('canopy', 'root', 0, 1.35, 0);
      stripes([[0.0001, 0.42], [0.35, 0.36], [0.62, 0.2], [0.8, 0.02], [0.78, -0.02]], 8, accent, cream, r, 'canopy');
      r.part('canopy', sphere(0.04, 8, 6), wood, { pos: [0, 0.45, 0], shade: 0 });
      r.part('canopy', cylinder(0.014, 0.014, 1.15, 6), wood, { pos: [0, -0.15, 0], shade: 0 });
      r.part('canopy', torus(0.07, 0.016, 5, 12, Math.PI), wood, { pos: [0.07, -0.72, 0], rot: [0, 0, Math.PI], shade: 0 });
      seat = new Vector3(0, -0.06 + 0.0, 0);
      seatPose = 'hang';
      size = 1.6;
      break;
    }
    case 'lantern': {
      r.bone('lantern', 'root', 0, 1.05, 0);
      r.bone('swing', 'root', 0, 1.05, 0);
      const prof: [number, number][] = [[0.18, 0], [0.42, 0.1], [0.55, 0.35], [0.55, 0.55], [0.42, 0.8], [0.18, 0.9]];
      r.part('lantern', new LatheGeometry(prof.map(([x, y]) => new Vector2(x, y)), 20), '#ffc56b', { glow: 0.85, shade: 0.1 });
      for (const y of [0.1, 0.35, 0.55, 0.8]) {
        const rr = y < 0.2 || y > 0.7 ? 0.42 : 0.55;
        r.part('lantern', torus(rr, 0.012, 4, 24), '#b5492e', { pos: [0, y, 0], rot: [Math.PI / 2, 0, 0], shade: 0 });
      }
      r.part('lantern', cylinder(0.2, 0.2, 0.06, 16), '#7a3b26', { pos: [0, 0.92, 0], shade: 0 });
      r.part('lantern', cylinder(0.2, 0.2, 0.05, 16), '#7a3b26', { pos: [0, -0.01, 0], shade: 0 });
      r.part('lantern', cylinder(0.008, 0.008, 0.25, 4), '#b5492e', { pos: [0, -0.15, 0], shade: 0 });
      r.part('lantern', sphere(0.03, 6, 4), '#b5492e', { pos: [0, -0.29, 0], shade: 0 });
      // Swing seat under it.
      r.part('swing', cylinder(0.006, 0.006, 0.9, 3), '#7a5a3a', { pos: [0.2, -0.45, 0], shade: 0 });
      r.part('swing', cylinder(0.006, 0.006, 0.9, 3), '#7a5a3a', { pos: [-0.2, -0.45, 0], shade: 0 });
      r.part('swing', cylinder(0.24, 0.24, 0.04, 14), wood, { pos: [0, -0.92, 0], scale: [1, 1, 0.6], shade: 0.1 });
      seat = new Vector3(0, 1.05 - 0.92 + 0.02, 0);
      seatPose = 'sit';
      size = 1.6;
      glow = true;
      break;
    }
  }
  const rig = r.build(lifeMaterial());
  const b = rig.bones;
  const animate = (t: number, motion: number): void => {
    resetPose(rig);
    switch (kind) {
      case 'balloon':
        turn(b.env, Math.sin(t * 0.9) * 0.03, t * 0.05, Math.sin(t * 0.7) * 0.03);
        turn(b.basket, Math.sin(t * 1.1 + 1) * 0.04, 0, Math.sin(t * 0.8) * 0.05);
        break;
      case 'paper-boat':
        turn(b.hull, Math.sin(t * 1.3) * 0.05, 0, Math.sin(t * 0.9) * 0.08);
        break;
      case 'kite': {
        turn(b.kite, -0.35 + Math.sin(t * 1.7) * 0.06 * (0.5 + motion), 0, Math.sin(t * 1.2) * 0.12);
        const tails = [b.t1, b.t2, b.t3, b.t4];
        tails.forEach((tb, i) => turn(tb, 0.25 * motion, 0, Math.sin(t * 4 - i * 0.9) * 0.35));
        break;
      }
      case 'cloud-whale':
        turn(b.tail, Math.sin(t * 1.6) * 0.3 * (0.4 + motion), 0, 0);
        turn(b.finL, 0, 0, Math.sin(t * 1.6 + 1) * 0.3);
        turn(b.finR, 0, 0, -Math.sin(t * 1.6 + 1) * 0.3);
        turn(b.body, Math.sin(t * 0.8) * 0.04, 0, Math.sin(t * 0.6) * 0.03);
        break;
      case 'umbrella':
        turn(b.canopy, Math.sin(t * 1.3) * 0.08, t * 0.4, Math.sin(t * 1.1) * 0.08);
        break;
      case 'lantern':
        turn(b.lantern, 0, t * 0.2, Math.sin(t * 0.9) * 0.04);
        turn(b.swing, Math.sin(t * 1.2) * 0.06, 0, Math.sin(t * 0.9) * 0.05);
        break;
    }
  };
  rig.mesh.name = `vehicle-${kind}`;
  return { mesh: rig.mesh, kind, seat, seatPose, size, glow, animate };
}
