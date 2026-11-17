// Birds that live: boids with inertia over the island, perching with hops and preening,
// tasks for building, and Pip's palm landing that follows the hand softly.
import { Matrix4, Quaternion, Vector3, type Object3D } from '@iwsdk/core';
import { createBirdModel, FLOCK_COLORS, PIP_COLORS, restBirdPose, type BirdModel, type BirdPose } from './bird';
import type { HandLike, V3 } from './types';

export type BirdMode = 'flock' | 'perch' | 'goto' | 'carry' | 'palm' | 'hover' | 'follow' | 'circle';

const UP = new Vector3(0, 1, 0);
const tA = new Vector3();
const tB = new Vector3();
const tC = new Vector3();
const tM = new Matrix4();
const tQ = new Quaternion();

export interface FlockEnv {
  head: Vector3;
  headFwd: Vector3;
  center: Vector3;
  radius: number;
  time: number;
  night: number;
  perches: Vector3[];
}

let seed = 9;
const rnd = (): number => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

export class BirdAgent {
  readonly model: BirdModel;
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly quat = new Quaternion();
  readonly pose: BirdPose = restBirdPose();
  mode: BirdMode = 'flock';
  readonly goal = new Vector3();
  readonly goalUp = new Vector3(0, 1, 0);
  /** Optional per-frame goal (carry, palm). */
  goalFn: ((out: Vector3, up: Vector3) => boolean) | null = null;
  landed = false;
  look: Vector3 | null = null;
  perchIdx = -1;
  private perchUntil = 0;
  private nextPerch = 4 + rnd() * 12;
  private blinkAt = rnd() * 3;
  private hopT = -1;
  private blinkEnd = 0;
  private preen = 0;
  private preenUntil = 0;
  private tilt = 0;
  private tiltGoal = 0;
  private flySmooth = 1;
  private landSquash = 0;
  private glide = 0;
  private personal = rnd() * 100;
  circleCenter = new Vector3();
  circleRadius = 2.5;
  /** Mouth envelope while speaking (0..1), set by speech. */
  mouth = 0;
  carrying = false;
  onLanded: (() => void) | null = null;

  constructor(readonly lead: boolean, colorIndex: number, scale: number) {
    this.model = createBirdModel(lead ? PIP_COLORS : FLOCK_COLORS[colorIndex % FLOCK_COLORS.length], scale, lead);
    this.model.mesh.matrixAutoUpdate = true;
  }

  get object(): Object3D {
    return this.model.mesh;
  }

  update(dt: number, env: FlockEnv, flock: BirdAgent[]): void {
    const t = env.time;
    let flying = true;
    let landingPoint: Vector3 | null = null;
    let omega = 0;
    let maxSpeed = 3.2;

    if (this.mode === 'perch' && this.perchIdx >= 0 && env.perches[this.perchIdx]) {
      landingPoint = tC.copy(env.perches[this.perchIdx]);
      this.goalUp.copy(UP);
      if (env.night < 0.5 && t > this.perchUntil) this.leavePerch(env);
    } else if (this.mode === 'palm' && this.goalFn) {
      const ok = this.goalFn(this.goal, this.goalUp);
      if (ok) landingPoint = tC.copy(this.goal);
      else {
        // Hand lost: rise a little and wait where it was.
        if (this.landed) this.takeOff();
        tA.copy(this.goal).addScaledVector(UP, 0.12);
        this.seek(tA, 4.5, dt);
        omega = -1;
      }
    }

    if (landingPoint) {
      const d = this.pos.distanceTo(landingPoint);
      if (!this.landed) {
        // Approach from above, then settle down onto the point.
        tA.copy(landingPoint).addScaledVector(this.goalUp, d > 0.3 ? 0.22 : 0);
        this.seek(tA, d > 0.3 ? 2.6 : 7.5, dt, 3.5);
        if (d < 0.02 && this.vel.length() < 0.5) {
          this.landed = true;
          this.landSquash = 1;
          this.vel.set(0, 0, 0);
          this.onLanded?.();
          this.onLanded = null;
        }
      } else {
        // Soft follow: a stiff spring, never a snap.
        this.seek(landingPoint, 16, dt, 6);
        flying = false;
      }
    } else if (omega === 0) {
      this.landed = false;
      switch (this.mode) {
        case 'flock':
          this.boids(dt, env, flock);
          maxSpeed = 3.4;
          if (env.perches.length > 0 && (t > this.nextPerch || env.night > 0.5)) this.tryPerch(env, flock);
          break;
        case 'goto':
        case 'carry':
          if (this.goalFn) this.goalFn(this.goal, this.goalUp);
          this.seek(this.goal, this.mode === 'carry' ? 7 : 2.4, dt, this.mode === 'carry' ? 9 : 5);
          break;
        case 'hover': {
          // A slow figure-eight in front of the person.
          const fx = env.headFwd.x;
          const fz = env.headFwd.z;
          const fl = Math.hypot(fx, fz) || 1;
          const sx = -fz / fl;
          const sz = fx / fl;
          const w = Math.sin(t * 0.9 + this.personal) * 0.08;
          tA.set(env.head.x + (fx / fl) * 0.6 + sx * (0.16 + w), env.head.y - 0.12 + Math.sin(t * 1.8) * 0.04, env.head.z + (fz / fl) * 0.6 + sz * (0.16 + w));
          this.seek(tA, 3.2, dt, 3);
          this.look = env.head;
          break;
        }
        case 'follow':
          if (this.goalFn) this.goalFn(this.goal, this.goalUp);
          tA.copy(this.goal).addScaledVector(this.goalUp, 0.14).add(tB.set(Math.sin(t * 1.3) * 0.05, Math.sin(t * 2.1) * 0.03, 0));
          this.seek(tA, 4, dt, 3);
          this.look = env.head;
          break;
        case 'circle': {
          const a = t * 0.9 + this.personal;
          tA.set(this.circleCenter.x + Math.cos(a) * this.circleRadius, this.circleCenter.y + Math.sin(t * 1.3 + this.personal) * 0.4, this.circleCenter.z + Math.sin(a) * this.circleRadius);
          this.seek(tA, 2.2, dt, 4.5);
          break;
        }
        default:
          break;
      }
    }

    const speed = this.vel.length();
    if (speed > maxSpeed && flying && this.mode === 'flock') this.vel.multiplyScalar(maxSpeed / speed);
    this.pos.addScaledVector(this.vel, dt);
    this.orient(dt, env, flying);
    this.animate(dt, env, flying);
    this.model.mesh.position.copy(this.pos);
    this.model.mesh.quaternion.copy(this.quat);
  }

  /** Critically damped spring toward p. */
  private seek(p: Vector3, omega: number, dt: number, maxSpeed = 4): void {
    tB.copy(p).sub(this.pos).multiplyScalar(omega * omega);
    tB.addScaledVector(this.vel, -2 * omega);
    this.vel.addScaledVector(tB, Math.min(dt, 0.05));
    const s = this.vel.length();
    if (s > maxSpeed) this.vel.multiplyScalar(maxSpeed / s);
  }

  private boids(dt: number, env: FlockEnv, flock: BirdAgent[]): void {
    const acc = tA.set(0, 0, 0);
    let n = 0;
    const coh = tB.set(0, 0, 0);
    const ali = tC.set(0, 0, 0);
    for (const o of flock) {
      if (o === this || o.mode !== 'flock') continue;
      const d = this.pos.distanceTo(o.pos);
      if (d < 0.7 && d > 1e-4) acc.addScaledVector(tQv.copy(this.pos).sub(o.pos).normalize(), (0.7 - d) * 9);
      if (d < 4) {
        coh.add(o.pos);
        ali.add(o.vel);
        n++;
      }
    }
    if (n > 0) {
      coh.divideScalar(n).sub(this.pos).multiplyScalar(0.6);
      ali.divideScalar(n).sub(this.vel).multiplyScalar(0.9);
      acc.add(coh).add(ali);
    }
    // Seek the wandering flock centre above the island.
    const t = env.time;
    const r = Math.max(4, env.radius * 0.45);
    tQv.set(env.center.x + Math.sin(t * 0.11 + this.personal * 0.02) * r, env.center.y + 4.2 + Math.sin(t * 0.23) * 0.9, env.center.z + Math.cos(t * 0.083) * r * 0.8);
    tQv.sub(this.pos);
    const dist = tQv.length();
    acc.addScaledVector(tQv.normalize(), Math.min(4, 0.6 + dist * 0.25));
    // Keep away from the person's head.
    tQv.copy(this.pos).sub(env.head);
    const hd = tQv.length();
    if (hd < 1.6) acc.addScaledVector(tQv.normalize(), (1.6 - hd) * 12);
    // A little noise so the flock never looks scripted.
    acc.x += Math.sin(t * 1.7 + this.personal) * 0.8;
    acc.y += Math.sin(t * 1.3 + this.personal * 1.7) * 0.5;
    acc.z += Math.cos(t * 1.1 + this.personal * 0.7) * 0.8;
    this.vel.addScaledVector(acc, dt);
    const s = this.vel.length();
    if (s < 1.4) this.vel.multiplyScalar(1.4 / Math.max(s, 1e-3));
  }

  private tryPerch(env: FlockEnv, flock: BirdAgent[]): void {
    const taken = new Set(flock.filter((b) => b.mode === 'perch').map((b) => b.perchIdx));
    const free = env.perches.map((_, i) => i).filter((i) => !taken.has(i));
    if (free.length === 0) {
      this.nextPerch = env.time + 5;
      return;
    }
    this.perchIdx = free[Math.floor(rnd() * free.length)];
    this.mode = 'perch';
    this.landed = false;
    this.perchUntil = env.time + 7 + rnd() * 10;
  }

  leavePerch(env: FlockEnv): void {
    this.takeOff();
    this.mode = 'flock';
    this.perchIdx = -1;
    this.nextPerch = env.time + 10 + rnd() * 14;
  }

  takeOff(): void {
    if (this.landed) this.vel.set((rnd() - 0.5) * 0.6, 1.4, (rnd() - 0.5) * 0.6);
    this.landed = false;
  }

  private orient(dt: number, env: FlockEnv, flying: boolean): void {
    if (flying) {
      const s = this.vel.length();
      tA.copy(s > 0.25 ? this.vel : tB.copy(this.look ?? env.head).sub(this.pos));
      if (this.mode === 'hover' || this.mode === 'follow' || (this.mode === 'palm' && !this.landed && s < 1.2)) tA.copy(this.look ?? env.head).sub(this.pos);
      tA.y *= flying && s > 0.25 ? 0.6 : 0.2;
      if (tA.lengthSq() < 1e-6) return;
      tA.normalize();
      tM.lookAt(tB.set(0, 0, 0), tA.negate(), UP);
      tQ.setFromRotationMatrix(tM);
    } else {
      // Landed: up from the surface, face the person (or what it looks at).
      tA.copy(this.look ?? env.head).sub(this.pos);
      tA.addScaledVector(this.goalUp, -tA.dot(this.goalUp));
      if (tA.lengthSq() < 1e-6) tA.set(0, 0, 1);
      tA.normalize();
      tB.crossVectors(this.goalUp, tA).normalize(); // x = up × forward
      tC.crossVectors(tA, tB); // corrected up
      tM.makeBasis(tB, tC, tA);
      tQ.setFromRotationMatrix(tM);
    }
    this.quat.slerp(tQ, 1 - Math.exp(-dt * (flying ? 7 : 9)));
  }

  private animate(dt: number, env: FlockEnv, flying: boolean): void {
    const t = env.time;
    const p = this.pose;
    this.flySmooth += ((flying ? 1 : 0) - this.flySmooth) * (1 - Math.exp(-dt * 12));
    p.fly = this.flySmooth;
    const hovering = this.mode === 'hover' || this.mode === 'follow' || this.mode === 'carry' || (this.mode === 'palm' && !this.landed);
    // Glide now and then in open flight.
    if (this.mode === 'flock') this.glide = Math.max(0, Math.sin(t * 0.7 + this.personal) - 0.55) * 2.2;
    else this.glide = 0;
    const beatHz = hovering ? 11 : 7.5;
    p.phase += dt * Math.PI * 2 * beatHz * (1 - Math.min(1, this.glide));
    p.effort = this.carrying ? 1 : hovering ? 0.6 : 0.2;
    // Blink, and sleep on a perch at night.
    if (t > this.blinkAt) {
      this.blinkEnd = t + 0.12;
      this.blinkAt = t + 1.8 + rnd() * 3.5;
    }
    p.blink = (env.night > 0.6 && !flying && this.mode === 'perch') || t < this.blinkEnd ? 1 : 0;
    // Beak follows speech.
    p.beak += ((this.mouth > 0 ? this.mouth : 0) - p.beak) * (1 - Math.exp(-dt * 30));
    // Head looks at the target, with a curious tilt from time to time.
    const look = this.look ?? (flying ? null : env.head);
    let yaw = 0;
    let pitch = 0;
    if (look) {
      tA.copy(look).sub(this.pos);
      tQ.copy(this.quat).invert();
      tA.applyQuaternion(tQ);
      yaw = Math.max(-1.2, Math.min(1.2, Math.atan2(tA.x, tA.z)));
      pitch = Math.max(-0.6, Math.min(0.6, -Math.atan2(tA.y - 0.06, Math.hypot(tA.x, tA.z))));
    }
    if (rnd() < dt * 0.4) this.tiltGoal = (rnd() - 0.5) * 0.7;
    if (this.mouth > 0) this.tiltGoal = Math.sin(t * 2.2) * 0.25;
    this.tilt += (this.tiltGoal - this.tilt) * (1 - Math.exp(-dt * 6));
    p.headYaw += (yaw - p.headYaw) * (1 - Math.exp(-dt * 8));
    p.headPitch += (pitch - p.headPitch) * (1 - Math.exp(-dt * 8));
    p.headRoll = this.tilt;
    // Landed life: hops and preening.
    this.landSquash = Math.max(0, this.landSquash - dt * 3.5);
    let squash = 1 - Math.sin(this.landSquash * Math.PI) * 0.18 + Math.sin(t * 3 + this.personal) * 0.012;
    if (!flying) {
      if (this.hopT < 0 && rnd() < dt * (this.mode === 'perch' ? 0.25 : 0.06) && this.mouth === 0) {
        this.hopT = 0;
      }
      if (this.mode === 'perch' && t > this.preenUntil && rnd() < dt * 0.12) {
        this.preen = rnd() > 0.5 ? 1 : -1;
        this.preenUntil = t + 1.6;
      }
    }
    if (this.hopT >= 0) {
      this.hopT += dt;
      const u = this.hopT / 0.32;
      if (u >= 1) this.hopT = -1;
      else {
        const lift = Math.sin(u * Math.PI) * 0.025 * this.model.mesh.scale.x;
        this.model.mesh.position.y += lift;
        squash *= u < 0.15 ? 0.88 : u > 0.85 ? 0.9 : 1.06;
      }
    }
    const preenOn = t < this.preenUntil && !flying;
    p.preen += ((preenOn ? this.preen * (0.7 + Math.sin(t * 14) * 0.15) : 0) - p.preen) * (1 - Math.exp(-dt * 8));
    p.squash = squash;
    p.tail = Math.sin(t * (flying ? 3 : 1.5) + this.personal) * (flying ? 0.3 : 0.15) + (this.mouth > 0 ? Math.sin(t * 12) * 0.2 : 0);
    p.bodyPitch = flying ? Math.max(-0.4, Math.min(0.5, -this.vel.y * 0.15)) : 0;
    this.model.apply(p);
    // Hop offset must be applied after the pose so the mesh position is right.
    this.model.mesh.position.copy(this.pos);
    if (this.hopT >= 0) this.model.mesh.position.addScaledVector(this.goalUp, Math.sin((this.hopT / 0.32) * Math.PI) * 0.025 * this.model.mesh.scale.x);
  }
}

const tQv = new Vector3();

/** Read a hand: palm centre and palm normal in world space; false when not tracked. */
export function readHand(h: HandLike, outPos: Vector3, outUp: Vector3): boolean {
  const anchor = 'isObject3D' in h && (h as Object3D).isObject3D ? { object: h as Object3D } : (h as Exclude<HandLike, Object3D>);
  const obj = anchor.object;
  const tracked = anchor.tracked ? anchor.tracked() : obj.visible !== false;
  if (!tracked) return false;
  obj.updateWorldMatrix(true, false);
  const n: V3 = anchor.palmNormal ?? { x: 0, y: -1, z: 0 };
  const o: V3 = anchor.offset ?? { x: 0, y: 0, z: 0 };
  outPos.set(o.x, o.y, o.z).applyMatrix4(obj.matrixWorld);
  outUp.set(n.x, n.y, n.z).transformDirection(obj.matrixWorld);
  if (!Number.isFinite(outPos.x) || !Number.isFinite(outUp.x)) return false;
  // A palm turned down is not a place to sit.
  return outUp.y > 0.2;
}
