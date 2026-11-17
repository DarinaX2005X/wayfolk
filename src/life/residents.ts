// A resident in the world: walking with weight along paths, posture, gestures, blinking
// and glancing, looking at the person, idle habits of its own, ears, tail, hat, scarf and
// apron on springs that answer movement and the island's wind. Two levels of detail.
import { Group, Vector3, type Object3D } from '@iwsdk/core';
import type { Resident } from '../mind/types';
import { createResidentModel, P, POSE_SIZE, residentColors, type ResidentModel } from './resident';
import { gearFor, TRADE_WORK } from './species';
import type { Emote } from './types';

const tA = new Vector3();
const tB = new Vector3();
const tW = new Vector3();

export type Base = 'idle' | 'sit' | 'work' | 'sleep' | 'hang';
type Idle = 'none' | 'look' | 'shift' | 'scratch' | 'stretch' | 'bounce' | 'tilt';
const IDLES: Idle[] = ['look', 'shift', 'scratch', 'stretch', 'bounce', 'tilt', 'look', 'shift'];

/** Damped spring for secondary motion. */
class Spring {
  x = 0;
  v = 0;
  constructor(private omega: number, private zeta: number) {}
  step(target: number, dt: number): number {
    const a = this.omega * this.omega * (target - this.x) - 2 * this.zeta * this.omega * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

export type WindFn = (pos: Vector3, out: Vector3) => Vector3;

export class ResidentAgent {
  readonly model: ResidentModel;
  private far: ResidentModel;
  private useFar = false;
  /** Placed in the world: position at the feet, rotation.y is the facing. */
  readonly group = new Group();
  readonly pos = new Vector3();
  yaw = 0;
  private yawGoal: number | null = null;
  private yawRate = 0;
  base: Base = 'idle';
  gesture: Emote | 'hold-hat' | null = null;
  gestureUntil = 0;
  look: Vector3 | null = null;
  lookPerson = true;
  mouth = 0;
  talking = false;
  private path: Vector3[] = [];
  private onArrive: (() => void) | null = null;
  speed = 0.75;
  private pose = new Float32Array(POSE_SIZE);
  private from = new Float32Array(POSE_SIZE);
  private next = new Float32Array(POSE_SIZE);
  private blend = 1;
  private shown = 'idle';
  private walkPhase = 0;
  private blinkAt = 0;
  private blinkEnd = 0;
  private doubleBlink = false;
  private headYaw = 0;
  private headPitch = 0;
  private personal: number;
  private tempo: number;
  private twitchAt = 0;
  private eyeX = 0;
  private eyeY = 0;
  private eyeGoalX = 0;
  private eyeGoalY = 0;
  private eyeAt = 0;
  private idle: Idle = 'none';
  private idleStart = 0;
  private idleAt = 0;
  private antic = 0;
  private dip = 0;
  private prevBob = 0;
  private bobVel = 0;
  private ear = new Spring(13, 0.32);
  private tail = new Spring(9, 0.3);
  private hatX = new Spring(14, 0.35);
  private hatZ = new Spring(14, 0.35);
  private scarfX = new Spring(7, 0.25);
  private scarfZ = new Spring(7, 0.25);
  private apron = new Spring(9, 0.3);
  private rnd: () => number;
  private readonly hasHat: boolean;
  private gustHeld = 0;
  readonly accent: string;
  hidden = false;
  riding = false;

  constructor(readonly res: Resident) {
    this.model = createResidentModel(res, 1);
    this.far = createResidentModel(res, 0.5);
    this.far.mesh.visible = false;
    this.group.add(this.model.mesh, this.far.mesh);
    this.group.name = `resident:${res.id}`;
    let h = 2166136261;
    for (const c of res.id + res.name) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    let seed = (h >>> 0) % 2147483646 || 7;
    this.rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    this.personal = this.rnd() * 10;
    this.tempo = 0.85 + this.rnd() * 0.3;
    this.idleAt = 2 + this.rnd() * 5;
    this.accent = residentColors(res).accent;
    this.hasHat = gearFor(res.trade).some((g) => /hat|beret|cap|headscarf/.test(g));
    this.pose[P.SQUASH] = 1;
  }

  get walking(): boolean {
    return this.path.length > 0;
  }

  /** The model currently drawn (near or far detail). */
  get active(): ResidentModel {
    return this.useFar ? this.far : this.model;
  }

  walk(points: Vector3[], onArrive?: () => void): void {
    const prev = this.onArrive;
    this.onArrive = null;
    prev?.();
    const wasStill = this.path.length === 0;
    this.path = points.map((p) => p.clone());
    this.onArrive = onArrive ?? null;
    if (this.path.length === 0) this.arrive();
    else {
      if (this.base === 'sit' || this.base === 'sleep' || this.base === 'work') this.base = 'idle';
      if (wasStill) this.antic = 0.24; // a small gather before the first step
    }
  }

  stop(): void {
    this.path = [];
    this.arrive();
  }

  /** Ends a walk at once, standing at its last point (a pinch or a click hurries it). */
  finishWalk(): boolean {
    const last = this.path[this.path.length - 1];
    if (!last || this.riding) return false;
    this.pos.x = last.x;
    this.pos.z = last.z;
    this.path = [];
    this.antic = 0;
    this.arrive();
    return true;
  }

  private arrive(): void {
    const cb = this.onArrive;
    this.onArrive = null;
    cb?.();
  }

  emote(kind: Emote, now: number, seconds?: number): void {
    if (kind === 'idle' || kind === 'sit' || kind === 'work' || kind === 'sleep') {
      this.base = kind;
      this.gesture = null;
      return;
    }
    if (kind === 'walk') return;
    this.gesture = kind;
    this.gestureUntil = now + (seconds ?? DURATION[kind] ?? 2);
    this.dip = 0.16; // anticipation before the gesture
  }

  faceToward(p: Vector3): void {
    this.yawGoal = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
  }

  update(dt: number, t: number, head: Vector3, groundAt: (x: number, z: number, fallback: number) => number, wind?: WindFn): void {
    if (this.hidden) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    // Level of detail with a little hysteresis.
    this.group.getWorldPosition(tA);
    const dHead = tA.distanceTo(head);
    if (!this.useFar && dHead > 6.5) this.useFar = true;
    else if (this.useFar && dHead < 5.5) this.useFar = false;
    this.model.mesh.visible = !this.useFar;
    this.far.mesh.visible = this.useFar;

    // Walking, after a short anticipation.
    let moving = false;
    if (this.antic > 0) this.antic = Math.max(0, this.antic - dt);
    if (this.path.length > 0 && !this.riding && this.antic <= 0) {
      const target = this.path[0];
      tA.set(target.x - this.pos.x, 0, target.z - this.pos.z);
      const d = tA.length();
      const step = this.speed * dt;
      if (d <= step + 0.01) {
        this.pos.x = target.x;
        this.pos.z = target.z;
        this.path.shift();
        if (this.path.length === 0) this.arrive();
      } else {
        tA.multiplyScalar(1 / d);
        const ease = Math.min(1, 0.45 + d * 1.2);
        this.pos.x += tA.x * step * ease;
        this.pos.z += tA.z * step * ease;
        this.yawGoal = Math.atan2(tA.x, tA.z);
        moving = true;
      }
      this.pos.y = groundAt(this.pos.x, this.pos.z, this.pos.y);
    } else if (this.path.length > 0 && this.antic > 0) {
      this.yawGoal = Math.atan2(this.path[0].x - this.pos.x, this.path[0].z - this.pos.z);
    }
    const yawBefore = this.yaw;
    if (this.yawGoal !== null) {
      let dy = this.yawGoal - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * (1 - Math.exp(-dt * (moving ? 7 : 5)));
      if (Math.abs(dy) < 0.002) this.yawGoal = null;
    }
    this.yawRate = dt > 0 ? (this.yaw - yawBefore) / dt : 0;
    if (!this.riding) {
      this.group.position.copy(this.pos);
      this.group.rotation.set(0, this.yaw, 0);
    }

    // Wind in the resident's own frame.
    let wx = 0;
    let wz = 0;
    let gust = 0;
    if (wind) {
      this.group.getWorldPosition(tB);
      wind(tB, tW);
      const c = Math.cos(this.yaw);
      const s = Math.sin(this.yaw);
      // local x = right, z = forward
      wx = tW.x * c - tW.z * s;
      wz = tW.x * s + tW.z * c;
      gust = Math.hypot(tW.x, tW.z);
    }
    // A strong gust: hold on to the hat.
    if (gust > 6.8 && this.hasHat && !moving && !this.gesture && this.base === 'idle' && !this.talking && this.gustHeld < t) {
      this.gesture = 'hold-hat';
      this.gestureUntil = t + 1.6;
      this.gustHeld = t + 6;
    }

    if (this.gesture && t > this.gestureUntil) this.gesture = null;
    const state: string = moving ? 'walk' : this.gesture ?? (this.talking && this.base === 'idle' ? 'talk' : this.base);
    if (state !== this.shown) {
      this.from.set(this.pose);
      this.blend = 0;
      this.shown = state;
    }
    this.blend = Math.min(1, this.blend + dt / 0.3);
    this.writePose(this.next, state, t, dt);
    const w = this.blend * this.blend * (3 - 2 * this.blend);
    const o = this.pose;
    for (let i = 0; i < POSE_SIZE; i++) o[i] = this.from[i] + (this.next[i] - this.from[i]) * w;

    // Anticipation: a quick gather before a step or a gesture.
    const gather = Math.max(this.antic > 0 ? Math.sin((1 - this.antic / 0.24) * Math.PI) : 0, this.dip > 0 ? Math.sin((1 - this.dip / 0.16) * Math.PI) : 0);
    if (this.dip > 0) this.dip = Math.max(0, this.dip - dt);
    o[P.SQUASH] -= gather * 0.07;
    o[P.BOB] -= gather * 0.012;
    o[P.LEAN] -= gather * 0.08;

    // Overlays: mouth, blink, glance.
    o[P.JAW] = Math.max(o[P.JAW], this.mouth);
    if (this.talking) {
      o[P.HX] += this.mouth * 0.08 - 0.02;
      o[P.HZ] += Math.sin(t * 2.3 + this.personal) * 0.06;
      o[P.SQUASH] += this.mouth * 0.012;
    }
    if (t > this.blinkAt) {
      this.blinkEnd = t + 0.12;
      this.doubleBlink = this.rnd() < 0.2;
      this.blinkAt = t + 1.8 + this.rnd() * 3.8;
    }
    if (t < this.blinkEnd || (this.doubleBlink && t > this.blinkEnd + 0.08 && t < this.blinkEnd + 0.2)) o[P.BLINK] = 1;
    if (t > this.eyeAt) {
      // Saccades: quick glances, mostly back to the middle.
      const center = this.rnd() < 0.55;
      this.eyeGoalX = center ? 0 : (this.rnd() - 0.5) * 2;
      this.eyeGoalY = center ? 0 : (this.rnd() - 0.5) * 1.2;
      this.eyeAt = t + 0.6 + this.rnd() * 2.2;
    }
    this.eyeX += (this.eyeGoalX - this.eyeX) * (1 - Math.exp(-dt * 28));
    this.eyeY += (this.eyeGoalY - this.eyeY) * (1 - Math.exp(-dt * 28));
    o[P.EYEX] += this.eyeX;
    o[P.EYEY] += this.eyeY;
    if (t > this.twitchAt) this.twitchAt = t + 3 + this.rnd() * 5;
    if (this.twitchAt - t > 2.85) o[P.EARTWITCH] = Math.sin((this.twitchAt - t - 2.85) * 40) * 0.25;

    // Secondary motion: springs driven by vertical speed, turning, walking and wind.
    const bobV = dt > 0 ? (o[P.BOB] - this.prevBob) / dt : 0;
    this.prevBob = o[P.BOB];
    this.bobVel += (bobV - this.bobVel) * Math.min(1, dt * 20);
    const fwd = moving ? this.speed : 0;
    o[P.EARS] += this.ear.step(clamp(-this.bobVel * 2.2 + wz * -0.03 + Math.abs(wx) * 0.02, -0.5, 0.9), dt);
    o[P.TAILW] += this.tail.step(clamp(-this.yawRate * 0.35 + wx * 0.05, -0.9, 0.9), dt);
    o[P.HATX] += this.hatX.step(clamp(-this.bobVel * 0.6 - wz * 0.012 - fwd * 0.05, -0.3, 0.3), dt);
    o[P.HATZ] += this.hatZ.step(clamp(this.yawRate * 0.05 + wx * 0.012, -0.3, 0.3), dt);
    const flutter = Math.sin(t * (9 + gust) + this.personal) * Math.min(0.12, gust * 0.012);
    o[P.SCARF] += this.scarfX.step(clamp(-wz * 0.07 - fwd * 0.45 - this.bobVel * 0.8, -1.3, 0.6), dt) + flutter;
    o[P.SCARFZ] += this.scarfZ.step(clamp(wx * 0.07 - this.yawRate * 0.25, -1.0, 1.0), dt) + flutter * 0.6;
    o[P.APRON] += this.apron.step(clamp(-wz * 0.035 - fwd * 0.12 + this.bobVel * 0.5, -0.5, 0.5), dt) + flutter * 0.4;

    // Look at the person or a target, eyes lead and the head follows.
    const lookAt = this.look ?? (this.lookPerson ? head : null);
    let yaw = 0;
    let pitch = 0;
    if (lookAt && state !== 'sleep') {
      this.group.updateWorldMatrix(true, false);
      tB.copy(lookAt);
      this.group.worldToLocal(tB);
      tB.y -= this.model.eyeHeight;
      const raw = Math.atan2(tB.x, tB.z);
      yaw = clamp(raw, -1.05, 1.05);
      pitch = clamp(-Math.atan2(tB.y, Math.hypot(tB.x, tB.z)), -0.45, 0.35);
      if (Math.abs(raw) > 1.9) {
        yaw = 0;
        pitch = 0;
      }
    }
    this.headYaw += (yaw - this.headYaw) * (1 - Math.exp(-dt * 4.5));
    this.headPitch += (pitch - this.headPitch) * (1 - Math.exp(-dt * 4.5));
    o[P.HY] += this.headYaw;
    o[P.HX] += this.headPitch;
    o[P.EYEX] += clamp((yaw - this.headYaw) * 1.5, -1, 1);
    this.active.apply(o);
  }

  anchor(out: Vector3): Vector3 {
    this.group.updateWorldMatrix(true, false);
    out.set(0, this.model.height + 0.14, 0).applyMatrix4(this.group.matrixWorld);
    return out;
  }

  voicePos(out: Vector3): Vector3 {
    this.group.updateWorldMatrix(true, false);
    out.set(0, this.model.eyeHeight - 0.05, 0.12).applyMatrix4(this.group.matrixWorld);
    return out;
  }

  get object(): Object3D {
    return this.group;
  }

  triangles(): number {
    return this.active.rig.triangles;
  }

  dispose(): void {
    this.model.mesh.geometry.dispose();
    this.far.mesh.geometry.dispose();
  }

  private writePose(o: Float32Array, state: string, t: number, dt: number): void {
    o.fill(0);
    const ph = this.personal;
    const tt = t * this.tempo;
    const gait = this.model.plan.gait;
    const breathe = Math.sin(tt * 2.1 + ph);
    o[P.SQUASH] = 1 + breathe * 0.016;
    o[P.SWAY] = Math.sin(tt * 0.9 + ph) * 0.035;
    o[P.ALX] = Math.sin(tt * 1.1 + ph) * 0.04;
    o[P.ARX] = Math.sin(tt * 1.1 + ph + 1) * 0.04;
    o[P.TAILW] = Math.sin(tt * 1.6 + ph) * 0.25;
    o[P.HZ] = Math.sin(tt * 0.5 + ph) * 0.05;
    o[P.ALZ] = breathe * 0.02;
    o[P.ARZ] = -breathe * 0.02;
    switch (state) {
      case 'idle':
        this.idleHabit(o, t);
        break;
      case 'walk': {
        const stride = gait === 'scurry' ? 0.14 : gait === 'waddle' ? 0.18 : 0.22;
        this.walkPhase += dt * (this.speed / stride) * Math.PI;
        const w = this.walkPhase;
        const s = Math.sin(w);
        const contact = Math.abs(Math.cos(w)); // 1 when a foot plants
        const amp = gait === 'waddle' ? 0.45 : 0.6;
        o[P.LL] = s * amp;
        o[P.LR] = -s * amp;
        o[P.ALX] = -s * 0.55;
        o[P.ARX] = s * 0.55;
        o[P.LEAN] = 0.09;
        if (gait === 'hop') {
          const hop = Math.abs(Math.sin(w));
          o[P.BOB] = hop * 0.07;
          o[P.SQUASH] = 0.9 + hop * 0.17;
          o[P.LL] = o[P.LR] = -hop * 0.35;
          o[P.ALZ] = 0.25 + hop * 0.3;
          o[P.ARZ] = -0.25 - hop * 0.3;
        } else {
          // Weight: lowest and a little squashed as each foot plants, up on the pass.
          o[P.BOB] = (1 - contact) * 0.022;
          o[P.SQUASH] = 1 - contact * 0.035 + (1 - contact) * 0.015;
          o[P.HX] = contact * 0.035;
        }
        o[P.SWAY] = s * (gait === 'waddle' ? 0.15 : 0.05);
        o[P.TWIST] = s * 0.12;
        o[P.TAILW] = s * 0.5;
        o[P.EARS] = -0.05;
        break;
      }
      case 'talk':
        o[P.ARX] = -0.45 + Math.sin(tt * 2.6 + ph) * 0.25;
        o[P.ARZ] = -0.15;
        o[P.ALX] = -0.1 + Math.sin(tt * 1.3 + ph) * 0.1;
        o[P.LEAN] = 0.03;
        break;
      case 'wave': {
        o[P.ARZ] = -2.45 + Math.sin(t * 9) * 0.32;
        o[P.ARX] = -0.25;
        o[P.HZ] = 0.16;
        o[P.SWAY] = Math.sin(t * 4.5) * 0.06;
        o[P.BOB] = Math.abs(Math.sin(t * 4.5)) * 0.012;
        o[P.EARS] = -0.15;
        o[P.TAILW] = Math.sin(t * 7) * 0.6;
        o[P.JAW] = 0.25;
        break;
      }
      case 'dance': {
        // To the island's beat: a sway on every beat, a bob on every step, arms up on the bar.
        const b = beatPhase(t);
        const step = Math.abs(Math.sin(b * Math.PI));
        o[P.SWAY] = Math.sin(b * Math.PI) * 0.16;
        o[P.BOB] = step * 0.05;
        o[P.SQUASH] = 0.94 + step * 0.1;
        o[P.HZ] = Math.sin(b * Math.PI) * 0.18;
        o[P.ALZ] = 1.0 + Math.sin(b * Math.PI * 0.5) * 0.5;
        o[P.ARZ] = -1.0 - Math.cos(b * Math.PI * 0.5) * 0.5;
        o[P.ALX] = -0.4;
        o[P.ARX] = -0.4;
        o[P.LL] = -step * 0.25 * (Math.floor(b) % 2 ? 1 : 0);
        o[P.LR] = -step * 0.25 * (Math.floor(b) % 2 ? 0 : 1);
        o[P.EARS] = -0.15;
        o[P.TAILW] = Math.sin(b * Math.PI * 2) * 0.9;
        o[P.JAW] = 0.2;
        break;
      }
      case 'play': {
        // Playing an instrument held in front: one arm bows or strums to the beat.
        const b = beatPhase(t);
        o[P.ALX] = -1.15;
        o[P.ALZ] = -0.35;
        o[P.ARX] = -0.85 + Math.sin(b * Math.PI * 2) * 0.32;
        o[P.ARZ] = 0.25;
        o[P.HZ] = 0.12 + Math.sin(b * Math.PI) * 0.1;
        o[P.HX] = 0.1;
        o[P.SWAY] = Math.sin(b * Math.PI) * 0.09;
        o[P.BOB] = Math.abs(Math.sin(b * Math.PI)) * 0.018;
        o[P.BLINK] = 0.5;
        o[P.TAILW] = Math.sin(b * Math.PI) * 0.5;
        break;
      }
      case 'hold-hat':
        o[P.ARX] = -2.6;
        o[P.ARZ] = 0.35;
        o[P.HX] = 0.15;
        o[P.HZ] = -0.12;
        o[P.LEAN] = 0.1;
        o[P.BLINK] = 0.6;
        break;
      case 'happy':
      case 'excited': {
        const f = state === 'excited' ? 8.5 : 6.2;
        const hop = Math.abs(Math.sin(t * f));
        o[P.BOB] = hop * (state === 'excited' ? 0.08 : 0.055);
        o[P.SQUASH] = 0.88 + hop * 0.2;
        o[P.ALZ] = 1.2 + Math.sin(t * f * 2) * 0.2;
        o[P.ARZ] = -1.2 - Math.sin(t * f * 2) * 0.2;
        o[P.ALX] = -0.3;
        o[P.ARX] = -0.3;
        o[P.LL] = -hop * 0.3;
        o[P.LR] = -hop * 0.3;
        o[P.HX] = -0.12;
        o[P.EARS] = -0.2;
        o[P.TAILW] = Math.sin(t * 12) * 0.8;
        o[P.JAW] = 0.4;
        break;
      }
      case 'sad':
        o[P.HX] = 0.38;
        o[P.LEAN] = 0.12;
        o[P.ALX] = -0.15;
        o[P.ARX] = -0.15;
        o[P.ALZ] = -0.08;
        o[P.ARZ] = 0.08;
        o[P.EARS] = 0.85;
        o[P.SQUASH] = 0.95 + breathe * 0.01;
        o[P.TAILW] = 0;
        o[P.TAILX] = 0.4;
        o[P.SWAY] = Math.sin(tt * 0.6 + ph) * 0.04;
        o[P.EYEY] = -0.6;
        break;
      case 'shy':
        o[P.HX] = 0.25;
        o[P.HZ] = 0.22;
        o[P.ALX] = -0.6;
        o[P.ARX] = -0.6;
        o[P.ALZ] = -0.35;
        o[P.ARZ] = 0.35;
        o[P.TWIST] = Math.sin(t * 1.6) * 0.18;
        o[P.EARS] = 0.4;
        o[P.EYEX] = Math.sin(t * 0.8) > 0 ? 0.7 : -0.7;
        break;
      case 'curious':
        o[P.HZ] = 0.32;
        o[P.LEAN] = 0.1;
        o[P.HX] = -0.05;
        o[P.EARS] = -0.25;
        o[P.TAILW] = Math.sin(t * 3) * 0.4;
        break;
      case 'think':
        o[P.ARX] = -1.75;
        o[P.ARZ] = 0.55;
        o[P.HZ] = -0.18;
        o[P.HX] = -0.18;
        o[P.TAILW] = Math.sin(t * 1.2) * 0.3;
        o[P.EYEY] = 0.8;
        o[P.EYEX] = 0.5;
        break;
      case 'hang':
        o[P.ALZ] = 2.75 + Math.sin(t * 2) * 0.05;
        o[P.ARZ] = -2.75 - Math.sin(t * 2) * 0.05;
        o[P.LL] = Math.sin(t * 2.2 + ph) * 0.3;
        o[P.LR] = -Math.sin(t * 2.2 + ph) * 0.3;
        o[P.HX] = -0.1;
        o[P.EARS] = -0.3;
        o[P.TAILW] = Math.sin(t * 3) * 0.5;
        o[P.SQUASH] = 1.04;
        break;
      case 'sit':
      case 'sleep':
        o[P.SIT] = 1;
        o[P.ALX] = -0.5;
        o[P.ARX] = -0.5;
        o[P.ALZ] = -0.12;
        o[P.ARZ] = 0.12;
        o[P.LL] = Math.sin(tt * 1.4 + ph) * 0.07;
        o[P.LR] = -Math.sin(tt * 1.4 + ph + 0.6) * 0.07;
        if (state === 'sleep') {
          o[P.HX] = 0.42;
          o[P.HZ] = 0.15;
          o[P.BLINK] = 1;
          o[P.SQUASH] = 1 + Math.sin(t * 1.1) * 0.03;
          o[P.EARS] = 0.5;
        }
        break;
      case 'work': {
        const kind = TRADE_WORK[this.res.trade] ?? 'stir';
        const k = Math.sin(tt * 5 + ph);
        switch (kind) {
          case 'hammer': {
            // Wind up slowly, strike fast.
            const c = (tt * 1.4 + ph) % 1;
            const swing = c < 0.7 ? c / 0.7 : 1 - (c - 0.7) / 0.3;
            o[P.ARX] = -0.7 - swing * 1.4;
            o[P.ALX] = -0.7;
            o[P.HX] = 0.25;
            o[P.SQUASH] = c > 0.95 ? 0.95 : 1;
            o[P.BOB] = swing * 0.006;
            break;
          }
          case 'water':
          case 'sweep':
            o[P.ALX] = -0.8 + Math.sin(tt * 1.4) * 0.2;
            o[P.ARX] = -0.8 + Math.sin(tt * 1.4) * 0.2;
            o[P.TWIST] = Math.sin(tt * 1.4) * 0.35;
            o[P.HX] = 0.25;
            break;
          case 'paint':
            o[P.ARX] = -1.3 + Math.sin(tt * 3) * 0.25;
            o[P.ARZ] = -0.3 + Math.cos(tt * 3) * 0.2;
            o[P.HZ] = 0.15 + Math.sin(tt * 0.4) * 0.1;
            break;
          case 'read':
            o[P.ALX] = -1.0;
            o[P.ARX] = -1.0;
            o[P.ALZ] = -0.25;
            o[P.ARZ] = 0.25;
            o[P.HX] = 0.32;
            o[P.EYEX] = Math.sin(tt * 1.7) * 0.8;
            o[P.EYEY] = -0.5;
            break;
          case 'play':
            o[P.ALX] = -1.1;
            o[P.ARX] = -0.9 + Math.sin(tt * 6) * 0.2;
            o[P.ALZ] = -0.4;
            o[P.HZ] = Math.sin(tt * 2) * 0.2;
            o[P.SWAY] = Math.sin(tt * 2) * 0.08;
            o[P.BOB] = Math.abs(Math.sin(tt * 2)) * 0.012;
            break;
          case 'look-up':
            o[P.HX] = -0.45;
            o[P.ARX] = -1.3;
            o[P.ARZ] = 0.2;
            o[P.EYEY] = 0.7;
            break;
          case 'fish':
            o[P.SIT] = 1;
            o[P.ALX] = -0.9;
            o[P.ARX] = -0.9;
            o[P.HX] = 0.15;
            o[P.LL] = Math.sin(tt * 1.1) * 0.15;
            o[P.LR] = -Math.sin(tt * 1.1) * 0.15;
            break;
          default:
            o[P.ALX] = -1.0 + k * 0.15;
            o[P.ARX] = -1.0 + Math.cos(tt * 5 + ph) * 0.15;
            o[P.ALZ] = -0.3 + k * 0.1;
            o[P.HX] = 0.28;
        }
        break;
      }
      default:
        break;
    }
  }

  /** Little habits while standing: never two residents in step. */
  private idleHabit(o: Float32Array, t: number): void {
    if (t > this.idleAt) {
      this.idle = IDLES[Math.floor(this.rnd() * IDLES.length)];
      this.idleStart = t;
      this.idleAt = t + 4 + this.rnd() * 6;
    }
    const u = t - this.idleStart;
    const len = this.idle === 'stretch' ? 2.2 : this.idle === 'look' ? 3 : 1.8;
    if (this.idle === 'none' || u > len) return;
    const env = Math.sin(Math.min(1, u / len) * Math.PI); // in and out
    switch (this.idle) {
      case 'look':
        o[P.HY] += Math.sin(u * 2.1) * 0.7 * env;
        o[P.EYEX] += Math.sin(u * 2.1 + 0.4) * env;
        break;
      case 'shift':
        o[P.SWAY] += 0.09 * env;
        o[P.TWIST] += 0.12 * env;
        o[P.LL] -= 0.12 * env;
        break;
      case 'scratch':
        o[P.ALX] += -2.2 * env;
        o[P.ALZ] += -0.3 * env;
        o[P.HZ] += 0.2 * env;
        o[P.ALY] += Math.sin(u * 22) * 0.12 * env;
        o[P.BLINK] = Math.max(o[P.BLINK], 0.5 * env);
        break;
      case 'stretch':
        o[P.ALZ] += 2.5 * env;
        o[P.ARZ] -= 2.5 * env;
        o[P.SQUASH] += 0.07 * env;
        o[P.HX] -= 0.25 * env;
        o[P.JAW] = Math.max(o[P.JAW], 0.8 * env);
        o[P.BLINK] = Math.max(o[P.BLINK], env > 0.6 ? 1 : 0);
        break;
      case 'bounce': {
        const b = Math.abs(Math.sin(u * 7)) * env;
        o[P.BOB] += b * 0.03;
        o[P.SQUASH] += (b - 0.4) * 0.06;
        break;
      }
      case 'tilt':
        o[P.HZ] += 0.3 * env;
        o[P.EARS] -= 0.15 * env;
        break;
    }
  }
}

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);

/** The island's shared beat (a concert sets it); without one, a calm 96 per minute. */
let beatBpm = 96;
export function setBeat(bpm: number): void {
  beatBpm = Math.max(40, Math.min(180, bpm));
}
function beatPhase(t: number): number {
  return (t * beatBpm) / 60;
}

const DURATION: Partial<Record<Emote, number>> = {
  dance: 2.4,
  play: 2.8,
  wave: 1.9,
  happy: 1.8,
  excited: 1.6,
  sad: 3,
  shy: 2.5,
  curious: 2.2,
  think: 2.5,
  talk: 2,
};
