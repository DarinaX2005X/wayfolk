// Two authored moments, each a pure function of its own clock so a pinch can jump to the
// end: a traveler arriving out of the clouds, and the flock building a house.
import { Box3, Matrix4, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import type { Resident, Vehicle } from '../mind/types';
import type { LifeAudio } from './audio';
import { planBuild, type BuildSchedule } from './build-plan';
import type { BirdAgent } from './flock';
import type { Fx } from './fx';
import type { ResidentAgent } from './residents';
import type { BuildStep } from './types';
import { createVehicle, type VehicleModel } from './vehicles';

export interface Scene {
  update(dt: number): boolean;
  skip(): void;
}

const tA = new Vector3();
const tB = new Vector3();
const tQ = new Quaternion();

const smooth = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const easeInOut = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function bezier(out: Vector3, a: Vector3, b: Vector3, c: Vector3, d: Vector3, t: number): Vector3 {
  const u = 1 - t;
  return out
    .copy(a)
    .multiplyScalar(u * u * u)
    .addScaledVector(b, 3 * u * u * t)
    .addScaledVector(c, 3 * u * t * t)
    .addScaledVector(d, t * t * t);
}

export interface ArrivalEnv {
  root: Object3D;
  audio: LifeAudio;
  fx: Fx;
  dock: Vector3;
  /** Unit vector from the island toward the open clouds, through the pier. */
  out: Vector3;
  /** Where the traveler walks to after stepping off. */
  landing: Vector3;
  /** Where the vehicle waits beside the landing, when the pier says so. */
  hang?: Vector3;
  head: () => Vector3;
  greeters: BirdAgent[];
  /** Cloud-sea level, below the island. */
  cloudY: number;
}

/** A traveler arriving: out of the clouds, along a soft curve, docking, stepping off, waving. */
export class Arrival implements Scene {
  private t = 0;
  readonly vehicle: VehicleModel;
  private holder = new Object3D();
  private start = new Vector3();
  private c1 = new Vector3();
  private c2 = new Vector3();
  private end = new Vector3();
  private stage = 0;
  private yaw: number;
  // Brisk: out of the clouds to the pier in about five seconds, waving by eight.
  private readonly T_TRAVEL = 5.4;
  private readonly T_DOCK = 6.0;
  private readonly T_HOP = 6.5;
  private readonly T_WALK = 7.4;
  readonly T_END = 8.2;
  private readonly T_GONE = 12;
  private resolveFn: (() => void) | null = null;
  readonly done: Promise<void>;
  private hopFrom = new Vector3();

  constructor(private env: ArrivalEnv, private agent: ResidentAgent, kind: Vehicle) {
    const colors = agent.res.colors;
    this.vehicle = createVehicle(kind, colors?.main ?? '#e9813f', colors?.accent ?? '#3f6e8c');
    this.holder.add(this.vehicle.mesh);
    this.holder.name = `arrival:${agent.res.id}`;
    env.root.add(this.holder);
    // Path: far out and below the cloud tops → rising → a gentle arc → beside the dock.
    const out = env.out;
    const side = tA.set(-out.z, 0, out.x);
    const deckY = env.dock.y;
    const seatY = this.vehicle.seat.y;
    if (env.hang) this.end.set(env.hang.x, 0, env.hang.z).addScaledVector(out, kind === 'cloud-whale' ? 0.8 : 0);
    else this.end.copy(env.dock).addScaledVector(out, kind === 'cloud-whale' ? 1.6 : 0.9);
    this.end.y = deckY - seatY + (this.vehicle.seatPose === 'sit' ? 0.05 : 0.02);
    if (kind === 'umbrella') {
      this.start.copy(this.end).addScaledVector(out, 10).addScaledVector(side, -5);
      this.start.y = deckY + 14;
      this.c1.copy(this.start).addScaledVector(side, 6);
      this.c1.y -= 4;
      this.c2.copy(this.end).addScaledVector(out, 3).addScaledVector(side, -2);
      this.c2.y = deckY + 3;
    } else {
      this.start.copy(this.end).addScaledVector(out, 26).addScaledVector(side, 9);
      this.start.y = env.cloudY - 3;
      this.c1.copy(this.end).addScaledVector(out, 15).addScaledVector(side, 8);
      this.c1.y = env.cloudY + (kind === 'paper-boat' ? 0.6 : 3.5);
      this.c2.copy(this.end).addScaledVector(out, 5).addScaledVector(side, -2.5);
      this.c2.y = this.end.y + (kind === 'paper-boat' ? 0.2 : 1.2);
    }
    // The vehicle faces along its travel; docked it turns its side to the pier.
    this.yaw = Math.atan2(-out.x, -out.z);
    agent.riding = true;
    agent.hidden = false;
    agent.lookPerson = true;
    agent.base = this.vehicle.seatPose === 'hang' ? 'hang' : this.vehicle.seatPose === 'sit' ? 'sit' : 'idle';
    this.holder.add(agent.group);
    agent.group.position.copy(this.vehicle.seat);
    agent.group.rotation.set(0, 0, 0);
    this.done = new Promise((r) => (this.resolveFn = r));
    this.place();
  }

  private place(): void {
    const t = this.t;
    const u = easeInOut(Math.min(1, t / this.T_TRAVEL));
    bezier(this.holder.position, this.start, this.c1, this.c2, this.end, u);
    const motion = 1 - smooth((t - this.T_TRAVEL + 1.2) / 1.2);
    // Bob, damped once docked.
    const bob = Math.sin(t * 1.6) * (0.08 * motion + 0.025);
    this.holder.position.y += bob;
    // Heading along the path while travelling.
    bezier(tB, this.start, this.c1, this.c2, this.end, Math.min(1, u + 0.02));
    tB.sub(this.holder.position);
    const travelYaw = tB.lengthSq() > 1e-6 ? Math.atan2(tB.x, tB.z) : this.yaw;
    const yaw = lerpAngle(travelYaw, this.yaw, smooth((t - this.T_TRAVEL + 2) / 2));
    this.holder.rotation.set(0, yaw, 0);
    this.vehicle.animate(t, motion);
    if (t > this.T_GONE - 4) {
      // Leaving: drift back out and sink into the clouds.
      const k = smooth((t - (this.T_GONE - 4)) / 4);
      this.holder.position.addScaledVector(this.env.out, k * 9);
      this.holder.position.y += this.vehicle.kind === 'umbrella' || this.vehicle.kind === 'balloon' || this.vehicle.kind === 'lantern' || this.vehicle.kind === 'kite' ? k * 6 : -k * 4;
    }
  }

  update(dt: number): boolean {
    const prev = this.t;
    this.t += dt;
    const t = this.t;
    this.place();
    const env = this.env;
    if (prev < 0.3 && t >= 0.3) {
      env.fx.cloud(this.holder.position.clone().setY(env.cloudY + 0.5), this.vehicle.size * 1.2);
    }
    if (prev < 1.4 && t >= 1.4) env.audio.sting(this.holder.position, 'arrive');
    if (this.vehicle.glow && prev < 0.1) env.fx.halo(() => (this.t < this.T_GONE ? tHalo.set(0, 1.5, 0).applyMatrix4(this.holder.matrixWorld) : null), 1.6, this.T_GONE, '#ffc57a', 0.55);
    // Warm motes trail the traveler on the way in.
    if (t < this.T_DOCK && Math.floor(t * 4) !== Math.floor(prev * 4)) env.fx.motes(this.holder.position.clone().setY(this.holder.position.y + this.vehicle.size * 0.4), this.vehicle.size * 0.8, '#ffd9a0', 3);
    // Greeting birds circle the traveler on the last stretch.
    if (prev < this.T_TRAVEL - 3 && t >= this.T_TRAVEL - 3) {
      for (const b of env.greeters) {
        b.mode = 'circle';
        b.circleRadius = 1.6;
      }
    }
    for (const b of env.greeters) if (b.mode === 'circle' && t < this.T_HOP + 1) b.circleCenter.copy(this.holder.position).setY(this.holder.position.y + this.vehicle.size * 0.8);
    if (prev < this.T_HOP + 1.2 && t >= this.T_HOP + 1.2) for (const b of env.greeters) if (b.mode === 'circle') b.mode = 'flock';

    const a = this.agent;
    if (prev < this.T_DOCK && t >= this.T_DOCK) {
      // Step off: from the seat to the deck in a little hop.
      this.holder.updateWorldMatrix(true, true);
      a.group.getWorldPosition(this.hopFrom);
      env.root.add(a.group);
      a.riding = false;
      a.base = 'idle';
      a.emote('happy', 0, 0.01);
      a.pos.copy(this.hopFrom);
      a.yaw = Math.atan2(env.landing.x - env.dock.x, env.landing.z - env.dock.z);
      a.group.position.copy(a.pos);
      a.group.rotation.set(0, a.yaw, 0);
    }
    if (t >= this.T_DOCK && t < this.T_HOP) {
      const u = (t - this.T_DOCK) / (this.T_HOP - this.T_DOCK);
      a.pos.lerpVectors(this.hopFrom, env.dock, smooth(u));
      a.pos.y = this.hopFrom.y + (env.dock.y - this.hopFrom.y) * u + Math.sin(u * Math.PI) * 0.28;
    }
    if (prev < this.T_HOP && t >= this.T_HOP) {
      a.pos.copy(env.dock);
      env.fx.dust(env.dock, 0.25, '#efe1c8');
      a.walk([env.landing.clone()]);
    }
    if (prev < this.T_WALK && t >= this.T_WALK) {
      a.stop();
      a.faceToward(env.head());
      a.emote('wave', 0, 1.8);
      a.gestureUntil = Number.POSITIVE_INFINITY;
    }
    if (prev < this.T_END && t >= this.T_END) {
      a.gesture = null;
      this.resolveFn?.();
      this.resolveFn = null;
    }
    if (t >= this.T_GONE) {
      this.holder.removeFromParent();
      this.vehicle.mesh.geometry.dispose();
      return false;
    }
    return true;
  }

  /** Jump to the traveler standing on the pier, waving done. */
  skip(): void {
    if (this.t >= this.T_END) {
      this.t = Math.max(this.t, this.T_GONE - 0.01);
      return;
    }
    const steps = [this.T_DOCK, this.T_HOP, this.T_WALK, this.T_END];
    for (const s of steps) if (this.t < s) this.update(s - this.t + 0.001);
    const a = this.agent;
    a.stop();
    a.pos.copy(this.env.landing);
    a.faceToward(this.env.head());
  }
}

const tHalo = new Vector3();

function lerpAngle(a: number, b: number, t: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

interface PieceState {
  step: BuildStep;
  parent: Object3D;
  /** Target in parent space. */
  pos: Vector3;
  quat: Quaternion;
  scale: Vector3;
  /** Target world position and the offset from the piece origin to its top centre. */
  world: Vector3;
  topOffset: Vector3;
  bottom: number;
  radius: number;
  source: Vector3;
  landed: boolean;
  appeared: boolean;
}

export interface BuildEnv {
  root: Object3D;
  worldRoot: Object3D;
  audio: LifeAudio;
  fx: Fx;
  birds: BirdAgent[];
  center: Vector3;
  radius: number;
  cloudY: number;
  seat: Vector3;
}

/** The flock carries the pieces in from the cloud edge and sets them down in order. */
export class Build implements Scene {
  private t = 0;
  private pieces: PieceState[] = [];
  readonly schedule: BuildSchedule;
  private resolveFn: (() => void) | null = null;
  readonly done: Promise<void>;
  private site = new Vector3();
  private finished = false;
  private smokeFrom: Object3D[] = [];
  private windows: Object3D[] = [];

  constructor(private env: BuildEnv, steps: BuildStep[]) {
    const box = new Box3();
    const m = new Matrix4();
    let n = 0;
    for (const step of steps) {
      const o = step.object3d;
      if (!o.parent) env.worldRoot.add(o);
      const parent = o.parent!;
      const s = step.target.scale;
      const scale = typeof s === 'number' ? new Vector3(s, s, s) : new Vector3(s.x, s.y, s.z);
      const pos = new Vector3(step.target.pos.x, step.target.pos.y, step.target.pos.z);
      const q = step.target.quat;
      const quat = new Quaternion(q.x, q.y, q.z, q.w);
      // Measure the piece at its target.
      o.position.copy(pos);
      o.quaternion.copy(quat);
      o.scale.copy(scale);
      const wasVisible = o.visible;
      o.visible = true;
      parent.updateWorldMatrix(true, false);
      o.updateMatrixWorld(true);
      box.setFromObject(o);
      o.visible = wasVisible;
      const world = new Vector3().setFromMatrixPosition(m.copy(o.matrixWorld));
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const topOffset = new Vector3(center.x - world.x, box.max.y - world.y, center.z - world.z);
      const bottom = box.min.y - world.y;
      const radius = Number.isFinite(size.x) ? Math.max(0.15, size.length() / 2) : 0.4;
      this.site.add(world);
      n++;
      this.pieces.push({ step, parent, pos, quat, scale, world, topOffset, bottom: Number.isFinite(bottom) ? bottom : 0, radius, source: new Vector3(), landed: false, appeared: false });
      o.visible = false;
    }
    if (n) this.site.divideScalar(n);
    // The cloud edge the pieces come from: past the house as seen from the seat, turned
    // a little aside so the house never hides them, at the rim where the clouds meet it.
    const dir = tA.copy(this.site).sub(env.seat).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, -1);
    dir.normalize();
    const turnA = 0.55 * (this.site.x - env.center.x >= 0 ? 1 : -1);
    dir.set(dir.x * Math.cos(turnA) - dir.z * Math.sin(turnA), 0, dir.x * Math.sin(turnA) + dir.z * Math.cos(turnA));
    const side = tB.set(-dir.z, 0, dir.x);
    const edge = env.center.clone().addScaledVector(dir, env.radius + 1.2);
    this.pieces.forEach((p, i) => {
      p.source.copy(edge).addScaledVector(side, ((i * 0.618) % 1 - 0.5) * 3.2);
      p.source.y = env.center.y + 0.4;
    });
    const sizes = this.pieces.map((p) => p.radius);
    this.schedule = planBuild(sizes, env.birds.length);
    this.done = new Promise((r) => (this.resolveFn = r));
    for (const p of this.pieces) {
      const name = p.step.object3d.name.toLowerCase();
      if (/chimney|smoke|oven/.test(name)) this.smokeFrom.push(p.step.object3d);
      p.step.object3d.traverse((c) => {
        if (/window|glass|lamp|light/i.test(c.name)) this.windows.push(c);
      });
    }
    for (const b of env.birds) {
      b.mode = 'circle';
      b.circleCenter.copy(this.site).setY(this.site.y + 4);
      b.circleRadius = 3;
      b.carrying = false;
    }
  }

  /** World position of piece i's origin at time t (and whether it is visible). */
  private piecePos(p: PieceState, it: { pick: number; land: number; settle: number }, t: number, out: Vector3): number {
    const rise0 = it.pick - 0.9;
    if (t < rise0) return -1;
    if (t < it.pick) {
      const u = smooth((t - rise0) / 0.9);
      // Rising out of the clouds below the rim.
      out.copy(p.source);
      out.y = this.env.cloudY + (p.source.y - this.env.cloudY) * u;
      return 0.5 + 0.5 * u;
    }
    const drop = it.land - 0.22;
    if (t < drop) {
      const u = easeInOut((t - it.pick) / (drop - it.pick));
      const lift = Math.max(2.4, p.world.y - p.source.y + 2.2);
      tC1.copy(p.source);
      tC1.y += lift;
      tC2.copy(p.world);
      tC2.y = Math.max(p.world.y + 2.6, tC1.y);
      tC3.copy(p.world);
      tC3.y += 0.55;
      bezier(out, p.source, tC1, tC2, tC3, u);
      return 1;
    }
    if (t < it.land) {
      const u = (t - drop) / 0.22;
      out.copy(p.world);
      out.y += 0.55 * (1 - u * u);
      return 1;
    }
    out.copy(p.world);
    return 1;
  }

  update(dt: number): boolean {
    const prev = this.t;
    this.t += dt;
    this.apply(prev, this.t);
    return !this.finished;
  }

  private apply(prev: number, t: number): void {
    const env = this.env;
    const sch = this.schedule;
    const busy = new Set<number>();
    for (const it of sch.items) {
      const p = this.pieces[it.index];
      const o = p.step.object3d;
      const vis = this.piecePos(p, it, t, tW);
      if (vis < 0) {
        o.visible = false;
      } else {
        if (!p.appeared) {
          p.appeared = true;
          env.fx.cloud(p.source.clone().setY(env.cloudY + 0.4), Math.min(1.6, p.radius * 1.4));
        }
        o.visible = true;
        // Into parent space.
        tL.copy(tW);
        p.parent.updateWorldMatrix(true, false);
        p.parent.worldToLocal(tL);
        o.position.copy(tL);
        o.quaternion.copy(p.quat);
        o.scale.copy(p.scale).multiplyScalar(vis);
        if (t < it.land) {
          // Gentle swing while carried.
          const sw = Math.sin(t * 3.1 + it.index) * 0.06 * (t > it.pick ? 1 : 0);
          tQ.setFromAxisAngle(AXIS_Z, sw);
          o.quaternion.multiply(tQ);
        } else {
          // Squash and settle.
          const tau = t - it.land;
          const k = Math.exp(-tau * 7) * Math.cos(tau * 20);
          o.scale.set(p.scale.x * (1 + 0.08 * k), p.scale.y * (1 - 0.16 * k), p.scale.z * (1 + 0.08 * k));
          if (tau > 0.8) o.scale.copy(p.scale);
        }
        if (!p.landed && t >= it.land) {
          p.landed = true;
          env.fx.dust(p.world.clone().setY(p.world.y + p.bottom + 0.04), Math.min(1.4, p.radius * 0.8));
          env.audio.knock(p.world, Math.min(3, p.radius * 1.6));
        }
      }
      // Birds carrying this piece.
      if (t >= it.pick - 1.5 && t < it.land) {
        it.birds.forEach((bi, k) => {
          const b = env.birds[bi];
          if (!b) return;
          busy.add(bi);
          b.mode = 'carry';
          b.carrying = t >= it.pick;
          const ang = (k / it.birds.length) * Math.PI * 2 + 0.6;
          const rr = it.birds.length > 1 ? Math.min(0.5, p.radius * 0.45) : 0;
          if (t < it.pick) {
            b.goal.copy(p.source).add(p.topOffset).setY(p.source.y + p.topOffset.y + 0.15);
          } else {
            b.goal.copy(tW).add(p.topOffset);
            b.goal.y += 0.12;
          }
          b.goal.x += Math.cos(ang) * rr;
          b.goal.z += Math.sin(ang) * rr;
        });
      }
      if (prev < it.pick && t >= it.pick) {
        const lead = env.birds[it.birds[0]];
        if (lead) env.audio.chirp(lead.pos, 0.9 + (it.index % 3) * 0.1);
      }
    }
    for (let i = 0; i < env.birds.length; i++) {
      const b = env.birds[i];
      if (busy.has(i) || t >= sch.total) continue;
      if (b.mode === 'carry') {
        b.carrying = false;
        b.mode = 'circle';
        b.circleCenter.copy(this.site).setY(this.site.y + 4);
      }
    }
    if (prev < sch.finish && t >= sch.finish) {
      env.audio.sting(this.site.clone().setY(this.site.y + 2), 'finish');
      for (const w of this.windows) {
        env.fx.halo(() => (w.parent ? w.getWorldPosition(tH) : null), 0.9, 4.5, '#ffd28a', 0.85);
      }
      env.fx.motes(this.site.clone().setY(this.site.y + 2), 3, '#ffe0a8', 16);
      for (const b of env.birds) {
        b.mode = 'circle';
        b.circleRadius = 2.2;
        b.circleCenter.copy(this.site).setY(this.site.y + 3.8);
      }
    }
    if (t >= sch.finish && t < sch.finish + 8 && this.smokeFrom.length && Math.floor(t * 3) !== Math.floor(prev * 3)) {
      for (const s of this.smokeFrom) env.fx.smoke(s.getWorldPosition(tH).setY(tH.y + 0.5));
    }
    if (t >= sch.total && !this.finished) {
      this.finished = true;
      for (const b of env.birds) {
        b.mode = 'flock';
        b.carrying = false;
      }
      for (const p of this.pieces) {
        const o = p.step.object3d;
        o.visible = true;
        o.position.copy(p.pos);
        o.quaternion.copy(p.quat);
        o.scale.copy(p.scale);
      }
      this.resolveFn?.();
      this.resolveFn = null;
    }
  }

  skip(): void {
    if (this.finished) return;
    const prev = this.t;
    this.t = this.schedule.total + 0.01;
    // Land everything without a storm of effects.
    for (const p of this.pieces) p.landed = true;
    for (const p of this.pieces) p.appeared = true;
    this.apply(Math.max(prev, this.schedule.finish - 0.001), this.t);
  }
}

const AXIS_Z = new Vector3(0, 0, 1);
const tW = new Vector3();
const tL = new Vector3();
const tH = new Vector3();
const tC1 = new Vector3();
const tC2 = new Vector3();
const tC3 = new Vector3();
export type { Resident };
