// Two authored moments, each a pure function of its own clock so a pinch can jump to the
// end: a traveler arriving out of the clouds, and the flock building a house.
import { Box3, Matrix4, Mesh, Object3D, Quaternion, Vector3, type BufferGeometry } from '@iwsdk/core';
import { MAT, build as buildParts, cbox, cyl, place } from '../world/geo';
import { mainMaterial } from '../world/materials';
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
  /**
   * Landing on the grass near the person instead of at the pier: the vehicle comes in high
   * over the island and settles just above the meadow beyond `dock`, and leaves upward.
   */
  meadow?: boolean;
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
    if (env.meadow) {
      // Beside the landing spot on the far side, floating just clear of the grass.
      this.vehicle.mesh.geometry.computeBoundingBox();
      const low = this.vehicle.mesh.geometry.boundingBox?.min.y ?? 0;
      this.end.copy(env.dock).addScaledVector(out, this.vehicle.size * 0.55 + 0.55);
      this.end.y = deckY + 0.22 - Math.min(low, seatY - 0.05);
    } else {
      if (env.hang) this.end.set(env.hang.x, 0, env.hang.z).addScaledVector(out, kind === 'cloud-whale' ? 0.8 : 0);
      else this.end.copy(env.dock).addScaledVector(out, kind === 'cloud-whale' ? 1.6 : 0.9);
      this.end.y = deckY - seatY + (this.vehicle.seatPose === 'sit' ? 0.05 : 0.02);
    }
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
      if (env.meadow) {
        // Over the island, high above the trees, then down onto the meadow.
        this.c1.y = Math.max(this.c1.y, this.end.y + 7);
        this.c2.y = this.end.y + 3.2;
      }
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
      this.holder.position.y += this.env.meadow || this.vehicle.kind === 'umbrella' || this.vehicle.kind === 'balloon' || this.vehicle.kind === 'lantern' || this.vehicle.kind === 'kite' ? k * 6 : -k * 4;
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
  /** A wall: it rises up out of the foundation inside the frame instead of flying in. */
  rises: boolean;
}

/**
 * The order a house goes up in: stone foundation, the timber frame, the walls rising inside
 * it, door and windows, the roof, then the details and the yard.
 */
function buildRank(step: BuildStep): number {
  const s = step as BuildStep & { name?: string; stage?: string };
  const name = (s.name ?? s.object3d.name ?? '').toLowerCase();
  const stage = s.stage ?? '';
  if (stage === 'foundation') return 0;
  if (stage === 'walls' && /beam|frame|post|stilt/.test(name)) return 1;
  // Gable ends go up with the roof; bands, ovens and trim boards with the details.
  if (stage === 'walls' && /gable/.test(name)) return 4;
  if (stage === 'walls' && /band|oven/.test(name)) return 5;
  if (stage === 'walls' && /plank/.test(name)) return 3;
  if (stage === 'walls') return 2;
  if (/door|window|porthole|shutter/.test(name)) return 3;
  if (stage === 'roof') return 4;
  if (stage === 'props') return 6;
  return 5;
}

/** A wall body (not its frame): these rise in place. */
function isWallBody(step: BuildStep): boolean {
  const s = step as BuildStep & { name?: string; stage?: string };
  return s.stage === 'walls' && buildRank(step) === 2;
}

/**
 * A light timber scaffold round a footprint (house frame, metres), one mesh. With `frame`
 * (the wall body's box) it also holds a timber frame: corner posts, sill and top plates
 * just inside the walls, so a house without beams of its own still goes up on a frame.
 */
function scaffoldGeometry(w: number, d: number, h: number, frame?: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }): BufferGeometry {
  const parts: [BufferGeometry, string][] = [];
  if (frame) {
    const t = 0.1;
    const fx0 = frame.x0 + t / 2 + 0.03;
    const fx1 = frame.x1 - t / 2 - 0.03;
    const fz0 = frame.z0 + t / 2 + 0.03;
    const fz1 = frame.z1 - t / 2 - 0.03;
    const fh = frame.y1 - frame.y0;
    const cx = (fx0 + fx1) / 2;
    const cz = (fz0 + fz1) / 2;
    for (const x of [fx0, fx1]) for (const z of [fz0, fz1]) parts.push([place(cbox(t, fh, t, 0.015), [x, frame.y0, z]), MAT.woodDark]);
    for (const y of [frame.y0, frame.y1 - t]) {
      for (const z of [fz0, fz1]) parts.push([place(cbox(fx1 - fx0 + t, t, t, 0.015), [cx, y, z]), MAT.woodDark]);
      for (const x of [fx0, fx1]) parts.push([place(cbox(t, t, fz1 - fz0 + t, 0.015), [x, y, cz]), MAT.woodDark]);
    }
    // A middle post on the long sides.
    for (const z of [fz0, fz1]) parts.push([place(cbox(t * 0.8, fh, t * 0.8, 0.015), [cx, frame.y0, z]), MAT.woodDark]);
  }
  const pole = MAT.woodLight;
  const plank = MAT.plank;
  const hw = w / 2;
  const hd = d / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push([place(cyl(0.035, 0.04, h, 6), [sx * hw, 0, sz * hd]), pole]);
  // Walkways along the front and one side, two levels, with ledgers under them.
  for (const y of [h * 0.42, h * 0.8]) {
    parts.push([place(cbox(w + 0.2, 0.05, 0.32, 0.01), [0, y, hd + 0.02]), plank]);
    parts.push([place(cbox(0.32, 0.05, d + 0.2, 0.01), [hw + 0.02, y, 0]), plank]);
    parts.push([place(cbox(w + 0.25, 0.04, 0.05, 0.01), [0, y - 0.05, hd - 0.14]), pole]);
    parts.push([place(cbox(0.05, 0.04, d + 0.25, 0.01), [hw - 0.14, y - 0.05, 0]), pole]);
  }
  // Two cross braces on the open sides.
  const brace = Math.hypot(w, h * 0.42);
  parts.push([place(cyl(0.022, 0.022, brace, 5), [-hw, 0.05, -hd], [0, 0, -Math.atan2(w, h * 0.42)]), pole]);
  parts.push([place(cyl(0.022, 0.022, Math.hypot(d, h * 0.42), 5), [-hw, 0.05, hd], [Math.atan2(d, h * 0.42), 0, 0]), pole]);
  return buildParts(parts);
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
  /** Yard props: they appear at the finish instead of being carried. */
  private extras: PieceState[] = [];
  /** The timber scaffold round the site, up while the house goes up. */
  private scaffold: Mesh | null = null;
  private scaffoldH = 3;

  constructor(private env: BuildEnv, stepsIn: BuildStep[]) {
    // Assembly order, keeping each kind's own order.
    const steps = stepsIn.map((s, i) => ({ s, i })).sort((a, b) => buildRank(a.s) - buildRank(b.s) || a.i - b.i).map((x) => x.s);
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
      this.pieces.push({ step, parent, pos, quat, scale, world, topOffset, bottom: Number.isFinite(bottom) ? bottom : 0, radius, source: new Vector3(), landed: false, appeared: false, rises: isWallBody(step) });
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
    // The yard's small things are not carried: they pop up round the house at the finish,
    // so the flock's time goes to the house itself.
    this.extras = this.pieces.filter((p) => buildRank(p.step) === 6);
    this.pieces = this.pieces.filter((p) => buildRank(p.step) !== 6);
    for (const p of this.extras) p.step.object3d.visible = false;
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
    this.raiseScaffold();
    for (const b of env.birds) {
      b.mode = 'circle';
      b.circleCenter.copy(this.site).setY(this.site.y + 4);
      b.circleRadius = 3;
      b.carrying = false;
    }
  }

  /** The scaffold: sized from the house in its own frame, standing round it from the start. */
  private raiseScaffold(): void {
    const first = this.pieces[0];
    if (!first) return;
    const q = first.quat;
    const inv = q.clone().invert();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let top = 0;
    const g = new Vector3();
    const wallBox = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity };
    const hasFrame = this.pieces.some((p) => buildRank(p.step) === 1);
    for (const p of this.pieces) {
      if (buildRank(p.step) > 2) continue;
      if (p.rises) {
        const geo = (p.step.object3d as Mesh).geometry as BufferGeometry | undefined;
        if (geo) {
          geo.computeBoundingBox();
          const bb = geo.boundingBox!;
          const c = p.world.clone().sub(this.site).applyQuaternion(inv);
          wallBox.x0 = Math.min(wallBox.x0, c.x + bb.min.x);
          wallBox.x1 = Math.max(wallBox.x1, c.x + bb.max.x);
          wallBox.z0 = Math.min(wallBox.z0, c.z + bb.min.z);
          wallBox.z1 = Math.max(wallBox.z1, c.z + bb.max.z);
          wallBox.y0 = Math.min(wallBox.y0, c.y + bb.min.y);
          wallBox.y1 = Math.max(wallBox.y1, c.y + bb.max.y);
        }
      }
      const geo = (p.step.object3d as Mesh).geometry as BufferGeometry | undefined;
      if (!geo) continue;
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      g.copy(p.world).sub(this.site).applyQuaternion(inv);
      minX = Math.min(minX, g.x + bb.min.x);
      maxX = Math.max(maxX, g.x + bb.max.x);
      minZ = Math.min(minZ, g.z + bb.min.z);
      maxZ = Math.max(maxZ, g.z + bb.max.z);
      top = Math.max(top, p.world.y + bb.max.y - this.site.y);
    }
    if (!Number.isFinite(minX)) return;
    const w = Math.min(6, maxX - minX + 0.7);
    const d = Math.min(6, maxZ - minZ + 0.7);
    const h = Math.max(1.8, Math.min(5, top + 0.35));
    this.scaffoldH = h;
    const mx = (minX + maxX) / 2;
    const mz = (minZ + maxZ) / 2;
    let ground = Infinity;
    for (const p of this.pieces) if (buildRank(p.step) === 0) ground = Math.min(ground, p.world.y + p.bottom);
    const gy = Number.isFinite(ground) ? ground : this.site.y;
    // The frame, in the scaffold's own frame (centred on the footprint, from the ground).
    const frame =
      !hasFrame && Number.isFinite(wallBox.x0) && wallBox.x1 - wallBox.x0 > 0.8
        ? { x0: wallBox.x0 - mx, x1: wallBox.x1 - mx, z0: wallBox.z0 - mz, z1: wallBox.z1 - mz, y0: wallBox.y0 + this.site.y - gy, y1: wallBox.y1 + this.site.y - gy }
        : undefined;
    const mesh = new Mesh(scaffoldGeometry(w, d, h, frame), mainMaterial());
    mesh.name = 'build:scaffold';
    const c = new Vector3(mx, 0, mz).applyQuaternion(q).add(this.site);
    c.y = gy;
    mesh.position.copy(c);
    mesh.quaternion.copy(q);
    mesh.scale.set(1, 0.001, 1);
    this.env.root.add(mesh);
    this.scaffold = mesh;
  }

  /** The scaffold pops up at the start and folds down into dust at the finish. */
  private scaffoldStep(prev: number, t: number): void {
    const s = this.scaffold;
    if (!s) return;
    const sch = this.schedule;
    const up = Math.min(1, t / 0.9);
    const down = t > sch.finish ? Math.min(1, (t - sch.finish) / 0.8) : 0;
    const k = smooth(up) * (1 - smooth(down));
    s.scale.set(1, Math.max(0.001, k), 1);
    s.visible = k > 0.01;
    if (prev < 0.05 && t >= 0.05) this.env.fx.dust(s.position.clone(), 1.2, '#e9d6b8');
    if (prev < sch.finish && t >= sch.finish) {
      for (const sx of [-1, 1]) this.env.fx.dust(s.position.clone().add(new Vector3(sx * 0.9, 0.1, 0)), 1.1, '#e9d6b8');
    }
    if (down >= 1) {
      s.removeFromParent();
      s.geometry.dispose();
      this.scaffold = null;
    }
  }

  /** World position of piece i's origin at time t (and whether it is visible). */
  private piecePos(p: PieceState, it: { pick: number; land: number; settle: number }, t: number, out: Vector3): number {
    if (p.rises) {
      // A wall rises out of the foundation between the frame's posts.
      if (t < it.pick - 1.0) return -1;
      out.copy(p.world);
      return 1;
    }
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
    this.scaffoldStep(prev, t);
    this.extras.forEach((p, i) => {
      const t0 = sch.finish + 0.4 + i * 0.18;
      const o = p.step.object3d;
      if (t < t0) {
        o.visible = false;
        return;
      }
      const k = Math.min(1, (t - t0) / 0.45);
      const pop = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.18 : 1;
      o.visible = true;
      o.position.copy(p.pos);
      o.quaternion.copy(p.quat);
      o.scale.copy(p.scale).multiplyScalar(Math.max(0.01, smooth(k) * pop));
      if (!p.landed) {
        p.landed = true;
        env.fx.dust(p.world.clone().setY(p.world.y + p.bottom + 0.03), Math.min(0.7, p.radius * 0.8));
      }
    });
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
          if (p.rises) env.fx.dust(p.world.clone().setY(p.world.y + p.bottom + 0.05), Math.min(1.6, p.radius * 0.9));
          else env.fx.cloud(p.source.clone().setY(env.cloudY + 0.4), Math.min(1.6, p.radius * 1.4));
        }
        o.visible = true;
        // Into parent space.
        tL.copy(tW);
        p.parent.updateWorldMatrix(true, false);
        p.parent.worldToLocal(tL);
        o.position.copy(tL);
        o.quaternion.copy(p.quat);
        o.scale.copy(p.scale).multiplyScalar(vis);
        if (p.rises) {
          // Grows from its bottom edge up to full height, a little wobble as it settles.
          const k = smooth((t - it.pick + 1.0) / Math.max(1.2, it.land - it.pick + 1.0));
          const settle = t > it.land ? Math.exp(-(t - it.land) * 6) * Math.sin((t - it.land) * 18) * 0.04 : 0;
          const sy = Math.max(0.02, k + settle);
          o.scale.set(p.scale.x, p.scale.y * sy, p.scale.z);
          o.position.y += p.bottom * (1 - sy);
        } else if (t < it.land) {
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
          const rr = p.rises ? Math.min(1.2, p.radius * 0.7) : it.birds.length > 1 ? Math.min(0.5, p.radius * 0.45) : 0;
          if (p.rises) {
            const k = smooth((t - it.pick + 1.0) / Math.max(1.2, it.land - it.pick + 1.0));
            b.goal.copy(p.world).add(p.topOffset);
            b.goal.y = p.world.y + p.bottom + (p.topOffset.y - p.bottom) * Math.max(0.1, k) + 0.25;
            b.carrying = t >= it.pick;
          } else if (t < it.pick) {
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
      for (const p of [...this.pieces, ...this.extras]) {
        const o = p.step.object3d;
        o.visible = true;
        o.position.copy(p.pos);
        o.quaternion.copy(p.quat);
        o.scale.copy(p.scale);
      }
      if (this.scaffold) {
        this.scaffold.removeFromParent();
        this.scaffold.geometry.dispose();
        this.scaffold = null;
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
    for (const p of [...this.pieces, ...this.extras]) p.landed = true;
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
