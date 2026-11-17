/**
 * A bridge between two islands. When a friend visits live, their own island drifts in
 * from the horizon and comes to rest beside this one (a slot of plan.ts). A rope runs
 * across the gap from a coil at each bridge head: the host holds the near end, the friend
 * the far end (pinch and hold in the headset, click and hold in a page). Only while both
 * hold is the rope taut, and only then do the birds of both islands lift planks out of the
 * clouds and lay them, from both ends toward the middle. Let go and the rope sags and the
 * birds wait, circling. When the last plank is down the rope becomes the two rails and
 * the islands are neighbours: the friend's island stays docked on later visits, its folk
 * walk over, and ours walk across to them.
 *
 * The host decides when each plank is lifted (tg-plank) and when the bridge is done
 * (tg-built); both sides fly the same planks from those events.
 */
import { AdditiveBlending, BufferGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry, Vector3, type Object3D } from '@iwsdk/core';
import type { Resident } from '../mind/types';
import { bridgePlank, bridgePost, mainMaterial, neighbourIsland, ropeCoil, ropeTube, type NeighbourShape } from '../world/index';
import { join, place } from '../world/geo';
import type { Ctx } from './context';
import { BridgeRun, SLOTS, bridgePoint, plankCount, plankSide, ropeTension, type Slot } from './plan';
import type { BridgeRecord, NeighbourIsland, SlotId } from './records';
import type { Worker, Workers } from './birds';

export const BRIDGE_LINES = {
  drifted: (owner: string) => `Look over there. ${owner}'s island has drifted over to be near us.`,
  hold: 'Each of you, hold an end of the rope. The birds only lay planks while both ends are held.',
  waitFriend: (friend: string) => `Keep holding. ${friend} needs to take the other end.`,
  waitYou: (friend: string) => `${friend} is holding the far end. Take yours.`,
  done: (other: string) => `There. You and ${other} are neighbours now.`,
} as const;

/** How long the friend's island takes to drift in, seconds. */
export const DRIFT_S = 16;
const RISE = 0.8;
const CARRY = 1.45;
const SETTLE = 0.25;
const FLIGHT = RISE + CARRY + SETTLE;
const SAG = 0.18;

const ease = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
const easeOut = (t: number): number => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

interface Flight {
  i: number;
  t: number;
  side: 'near' | 'far';
  worker: Worker | null;
  src: Vector3;
  slot: Vector3;
  mesh: Mesh;
  spin: number;
}

/** One friend's island beside ours, docking or docked, with its bridge. */
export class Neighbour {
  readonly group = new Group();
  readonly shape: NeighbourShape;
  readonly slot: Slot;
  readonly A = new Vector3();
  readonly B = new Vector3();
  readonly u = new Vector3();
  readonly n = new Vector3();
  /** Where each person stands at the bridge head, facing across. */
  readonly spots: { near: { pos: Vector3; rotY: number }; far: { pos: Vector3; rotY: number } };
  readonly coils: { near: Mesh; far: Mesh };
  readonly planksN: number;
  docked = false;
  complete = false;
  readonly hold = { near: false, far: false };
  run: BridgeRun | null = null;
  laid: boolean[];
  private readonly island: Mesh;
  private readonly bridge = new Group();
  private readonly posts: Mesh;
  private readonly planks: Mesh;
  private rope: Mesh | null = null;
  private rails: Mesh | null = null;
  private readonly glows: { near: Mesh; far: Mesh };
  private flights: Flight[] = [];
  private drift = -1;
  private tension = 0;
  private shownTension = -1;
  private ropeEnds: { near: Vector3 | null; far: Vector3 | null } = { near: null, far: null };
  private ropeShownEnds = '';
  private spawned: string[] = [];
  private nextWalk = 20;
  private walking = false;
  private t = 0;
  private pop = 1;

  constructor(
    private readonly ctx: Ctx,
    readonly info: NeighbourIsland,
    slotId: SlotId,
    private readonly workers: Workers,
  ) {
    this.slot = SLOTS[slotId];
    const s = this.slot;
    const ya = ctx.ground(s.a.x, s.a.z) + 0.02;
    this.A.set(s.a.x, ya, s.a.z);
    this.B.set(s.b.x, ya, s.b.z);
    this.u.copy(this.B).sub(this.A).setY(0).normalize();
    this.n.set(-this.u.z, 0, this.u.x);
    this.planksN = plankCount(s);
    // Room at our bridge head: where the person stands, the coil and the first steps.
    ctx.world.clearSpace?.(s.a.x - this.u.x * 1.1, s.a.z - this.u.z * 1.1, 2.4);
    this.laid = new Array(this.planksN).fill(false);
    this.shape = neighbourIsland({ seed: info.seed, radius: s.radius, houses: info.houses });
    this.island = new Mesh(this.shape.geometry, mainMaterial());
    this.island.name = `together:island:${info.id}`;
    this.group.name = `together:neighbour:${info.id}`;
    this.group.add(this.island);
    this.group.position.set(s.centre.x, ya, s.centre.z);
    this.group.rotation.y = s.yaw;
    ctx.root.add(this.group);

    const rotY = (f: Vector3): number => Math.atan2(-f.x, -f.z);
    const uNeg = this.u.clone().negate();
    this.spots = {
      near: { pos: this.A.clone().addScaledVector(this.u, -1.5), rotY: rotY(this.u) },
      far: { pos: this.B.clone().addScaledVector(this.u, 1.5), rotY: rotY(uNeg) },
    };
    this.spots.near.pos.y = ctx.ground(this.spots.near.pos.x, this.spots.near.pos.z);
    this.spots.far.pos.y = ya + this.shape.height(-(s.radius - 0.9) + 1.5, 0);

    // Posts at both heads, a coil of rope in front of each person.
    const postGeo = bridgePost();
    const postParts: BufferGeometry[] = [];
    for (const [p, y] of [[this.A, ya], [this.B, ya]] as const)
      for (const k of [-1, 1]) postParts.push(place(postGeo.clone(), [p.x + this.n.x * k * 0.72, y, p.z + this.n.z * k * 0.72]));
    this.posts = new Mesh(join(postParts), mainMaterial());
    this.posts.name = 'together:posts';
    this.bridge.add(this.posts);
    const coilGeo = ropeCoil();
    const mkCoil = (side: 'near' | 'far'): Mesh => {
      const sp = this.spots[side];
      const f = side === 'near' ? this.u : uNeg;
      const m = new Mesh(coilGeo, mainMaterial());
      m.position.copy(sp.pos).addScaledVector(f, 0.62);
      m.position.y = side === 'near' ? ctx.ground(m.position.x, m.position.z) : ya + this.localHeight(m.position);
      m.rotation.y = sp.rotY;
      m.name = `together:coil:${side}`;
      m.userData.together = { kind: 'coil', side, neighbour: info.id };
      this.bridge.add(m);
      return m;
    };
    this.coils = { near: mkCoil('near'), far: mkCoil('far') };
    const ring = new RingGeometry(0.32, 0.62, 40, 1).rotateX(-Math.PI / 2);
    const mkGlow = (side: 'near' | 'far'): Mesh => {
      const m = new Mesh(ring, new MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
      m.position.copy(this.coils[side].position).add(new Vector3(0, 0.03, 0));
      m.renderOrder = 3;
      m.name = `together:glow:${side}`;
      this.bridge.add(m);
      return m;
    };
    this.glows = { near: mkGlow('near'), far: mkGlow('far') };
    this.planks = new Mesh(new BufferGeometry(), mainMaterial());
    this.planks.name = 'together:planks';
    this.planks.visible = false;
    this.bridge.add(this.planks);
    this.bridge.name = `together:bridge:${info.id}`;
    this.bridge.visible = false;
    ctx.root.add(this.bridge);
  }

  /** Ground height of the friend's island at an island-frame point (local frame of the group). */
  private localHeight(p: Vector3): number {
    const l = this.toLocal(p.x, p.z);
    return this.shape.height(l.x, l.z);
  }

  private toLocal(x: number, z: number): { x: number; z: number } {
    const dx = x - this.group.position.x;
    const dz = z - this.group.position.z;
    const c = Math.cos(this.slot.yaw);
    const s = Math.sin(this.slot.yaw);
    return { x: dx * c - dz * s, z: dx * s + dz * c };
  }

  /** Whether an island-frame point is on the friend's island. */
  inside(x: number, z: number): boolean {
    const l = this.toLocal(x, z);
    return Math.hypot(l.x, l.z) < this.shape.radius * 0.93;
  }

  /** Island-frame point of a local point of the friend's island. */
  toIsland(local: Vector3, out = new Vector3()): Vector3 {
    this.group.updateMatrix();
    return out.copy(local).applyMatrix4(this.group.matrix);
  }

  /** Starts the drift in from the horizon (or docks at once). */
  arrive(drift: boolean): void {
    if (!drift) {
      this.drift = -1;
      this.dockNow();
      return;
    }
    this.drift = 0;
    this.docked = false;
    this.place(0);
  }

  private place(k: number): void {
    const s = this.slot;
    const e = easeOut(k);
    const rise = easeOut(Math.min(1, k * 1.6));
    const ya = this.A.y;
    this.group.position.set(s.far.x + (s.centre.x - s.far.x) * e, ya - 26 * (1 - rise) + Math.sin(k * 9) * 0.25 * (1 - k), s.far.z + (s.centre.z - s.far.z) * e);
    this.group.rotation.y = s.yaw + (1 - e) * 0.9;
    this.island.scale.setScalar(0.92 + 0.08 * e);
  }

  private dockNow(): void {
    this.place(1);
    this.group.position.set(this.slot.centre.x, this.A.y, this.slot.centre.z);
    this.group.rotation.y = this.slot.yaw;
    this.island.scale.setScalar(1);
    this.group.updateMatrix();
    this.docked = true;
    this.bridge.visible = true;
    this.pop = 0;
    const w = this.ctx.world;
    const id = `together:${this.info.id}`;
    w.addGround?.(`${id}:island`, (x, z) => (this.inside(x, z) ? this.A.y + this.localHeight(new Vector3(x, 0, z)) : null));
    if (this.complete) this.finishNow(false);
  }

  /** Lays every plank at once: a bridge built on an earlier visit. */
  finishNow(celebrate: boolean): void {
    this.complete = true;
    this.laid.fill(true);
    for (const f of this.flights) this.endFlight(f, false);
    this.flights = [];
    this.rebuildPlanks();
    this.coils.near.visible = false;
    this.coils.far.visible = false;
    this.glows.near.visible = false;
    this.glows.far.visible = false;
    this.rope?.removeFromParent();
    this.rope = null;
    if (!this.rails) {
      const parts: BufferGeometry[] = [];
      for (const k of [-1, 1]) {
        const pts: Vector3[] = [];
        for (let i = 0; i <= 16; i++) {
          const t = i / 16;
          const p = bridgePoint(this.slot, t, this.A.y, this.B.y, SAG);
          pts.push(new Vector3(p.x + this.n.x * k * 0.72, p.y + 0.82 + Math.sin(t * Math.PI) * 0.06, p.z + this.n.z * k * 0.72));
        }
        parts.push(ropeTube(pts, 0.026));
      }
      this.rails = new Mesh(join(parts), mainMaterial());
      this.rails.name = 'together:rails';
      this.bridge.add(this.rails);
    }
    if (this.docked) {
      const w = this.ctx.world;
      const id = `together:${this.info.id}`;
      w.addGround?.(`${id}:bridge`, (x, z) => this.onBridge(x, z));
      w.addCrossing?.(id, { x: this.A.x - this.u.x * 0.4, z: this.A.z - this.u.z * 0.4 }, { x: this.B.x + this.u.x * 0.6, z: this.B.z + this.u.z * 0.6 }, (x, z) => this.inside(x, z));
      this.spawnFolk();
    }
    if (celebrate) {
      const mid = this.A.clone().lerp(this.B, 0.5);
      this.ctx.sound.fiveChord(this.ctx.root.localToWorld(mid.clone()));
      this.ctx.life?.flockCircle?.(this.ctx.root.localToWorld(mid.clone().add(new Vector3(0, 3, 0))), 3);
      setTimeout(() => this.ctx.life?.flockCircle?.(null), 7000);
      this.workers.show(5);
      this.nextWalk = 6;
    }
  }

  private onBridge(x: number, z: number): number | null {
    const dx = x - this.A.x;
    const dz = z - this.A.z;
    const len = this.A.distanceTo(this.B);
    const t = (dx * this.u.x + dz * this.u.z) / len;
    const side = Math.abs(dx * this.n.x + dz * this.n.z);
    if (t < 0.02 || t > 0.98 || side > 0.75) return null;
    return bridgePoint(this.slot, t, this.A.y, this.B.y, SAG).y + 0.04;
  }

  private rebuildPlanks(): void {
    const parts: BufferGeometry[] = [];
    const yaw = Math.atan2(-this.n.z, this.n.x);
    for (let i = 0; i < this.planksN; i++) {
      if (!this.laid[i]) continue;
      const p = this.plankSlot(i);
      parts.push(place(bridgePlank(i), [p.x, p.y, p.z], [0, yaw + ((i % 3) - 1) * 0.035, 0]));
    }
    this.planks.geometry.dispose();
    this.planks.geometry = parts.length ? join(parts) : new BufferGeometry();
    this.planks.visible = parts.length > 0;
  }

  plankSlot(i: number, out = new Vector3()): Vector3 {
    const p = bridgePoint(this.slot, (i + 0.5) / this.planksN, this.A.y, this.B.y, SAG);
    return out.set(p.x, p.y, p.z);
  }

  /** Lifts plank i out of the clouds; a bird of its side carries it to its place. */
  launch(i: number): void {
    if (this.laid[i] || this.flights.some((f) => f.i === i)) return;
    const side = plankSide(i, this.planksN);
    const from = side === 'near' ? this.A : this.B;
    const dir = side === 'near' ? 1 : -1;
    const src = from.clone().addScaledVector(this.u, dir * (1.7 + Math.random() * 1.4)).addScaledVector(this.n, (Math.random() - 0.5) * 3.2);
    src.y = this.A.y - 3.2 - Math.random();
    const mesh = new Mesh(bridgePlank(i), mainMaterial());
    mesh.position.copy(src);
    mesh.scale.setScalar(0.01);
    mesh.name = `together:plank:${i}`;
    this.bridge.add(mesh);
    const flight: Flight = { i, t: 0, side, worker: null, src, slot: this.plankSlot(i), mesh, spin: (Math.random() - 0.5) * 2 };
    this.flights.push(flight);
    this.workers.show(FLIGHT + 6);
  }

  private take(f: Flight): void {
    if (f.worker) return;
    const w = this.workers.idle(f.side);
    if (!w) return;
    f.worker = w;
    w.busy = true;
    w.bird.mode = 'carry';
    w.bird.carrying = true;
    const off = new Vector3(0, 0.15, 0);
    w.bird.goalFn = (out) => {
      out.copy(f.mesh.position).add(off);
      return true;
    };
  }

  private endFlight(f: Flight, sound: boolean): void {
    f.mesh.removeFromParent();
    f.mesh.geometry.dispose();
    if (f.worker) this.workers.release(f.worker);
    f.worker = null;
    this.laid[f.i] = true;
    if (sound) {
      this.ctx.sound.knock(this.ctx.root.localToWorld(f.slot.clone()), 0.9 + Math.random() * 0.25);
      if (Math.random() < 0.3) this.ctx.sound.creak(this.ctx.root.localToWorld(f.slot.clone()), 0.6);
    }
  }

  /** The ends of the rope that people hold in their hands (island frame), or null. */
  setRopeEnds(near: Vector3 | null, far: Vector3 | null): void {
    this.ropeEnds.near = near;
    this.ropeEnds.far = far;
  }

  private ropePoints(): Vector3[] {
    const top = (side: 'near' | 'far'): Vector3 => {
      const hand = this.ropeEnds[side];
      if (hand) return hand.clone();
      const c = this.coils[side].position.clone();
      // A held coil in a page lifts its toggle a little.
      c.y += 0.8 + (this.hold[side] ? 0.22 : 0);
      return c;
    };
    const pts: Vector3[] = [top('near')];
    const sagAcross = 1.7 + (0.12 - 1.7) * this.tension;
    const a = this.A.clone().setY(this.A.y + 0.92);
    const b = this.B.clone().setY(this.B.y + 0.92);
    pts.push(a);
    for (let i = 1; i < 14; i++) {
      const t = i / 14;
      pts.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sagAcross));
    }
    pts.push(b, top('far'));
    // A soft curve between the coil and the bridge head too.
    const out: Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      out.push(pts[i]);
      if (i === 0 || i === pts.length - 2) {
        const m = pts[i].clone().lerp(pts[i + 1], 0.5);
        m.y -= 0.12 * (1 - this.tension);
        out.push(m);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  private redrawRope(): void {
    const key = `${this.ropeEnds.near?.toArray().map((v) => v.toFixed(2)).join() ?? ''}|${this.ropeEnds.far?.toArray().map((v) => v.toFixed(2)).join() ?? ''}|${this.hold.near}|${this.hold.far}`;
    if (Math.abs(this.tension - this.shownTension) < 0.01 && key === this.ropeShownEnds && this.rope) return;
    this.shownTension = this.tension;
    this.ropeShownEnds = key;
    const g = ropeTube(this.ropePoints(), 0.03);
    if (!this.rope) {
      this.rope = new Mesh(g, mainMaterial());
      this.rope.name = 'together:rope';
      this.bridge.add(this.rope);
    } else {
      this.rope.geometry.dispose();
      this.rope.geometry = g;
    }
  }

  /** Planks laid or in the air, 0..1. */
  get progress(): number {
    return this.laid.filter(Boolean).length / this.planksN;
  }

  update(dt: number, mine: 'near' | 'far' | null, friendColor: string): void {
    this.t += dt;
    if (this.drift >= 0) {
      this.drift += dt / DRIFT_S;
      if (this.drift >= 1) {
        this.drift = -1;
        this.dockNow();
      } else this.place(this.drift);
    }
    if (!this.docked) return;
    if (this.pop < 1) {
      this.pop = Math.min(1, this.pop + dt / 0.6);
      const k = this.pop;
      const s = k < 1 ? 1 + Math.sin(k * Math.PI) * 0.15 : 1;
      this.posts.scale.set(1, ease(k) * s, 1);
    }
    if (!this.complete) {
      const target = ropeTension(this.hold.near, this.hold.far);
      this.tension += (target - this.tension) * (1 - Math.exp(-dt * 5));
      this.redrawRope();
      // Glow under the coils: mine invites, a held one shines in its holder's colour.
      for (const side of ['near', 'far'] as const) {
        const m = this.glows[side].material as MeshBasicMaterial;
        const held = this.hold[side];
        const invite = side === mine && !held;
        m.color.set(held ? (side === mine ? '#ffd38a' : friendColor) : '#ffd38a');
        m.opacity = held ? 0.55 + Math.sin(this.t * 6) * 0.08 : invite ? 0.22 + Math.sin(this.t * 2.6) * 0.14 : 0;
        this.glows[side].scale.setScalar(held ? 1.05 : 1 + Math.sin(this.t * 2.6) * 0.05);
      }
    }
    // Planks in the air.
    for (const f of this.flights) {
      if (!f.worker) this.take(f);
      // A plank that has nobody to carry it waits just under the edge.
      const tNext = f.t + dt;
      f.t = f.worker || tNext < RISE ? tNext : Math.min(tNext, RISE);
      const m = f.mesh;
      if (f.t < RISE) {
        const k = ease(f.t / RISE);
        m.position.copy(f.src).setY(f.src.y - 2 + 2 * k);
        m.scale.setScalar(0.4 + 0.6 * k);
        m.rotation.set(Math.sin(f.t * 3) * 0.3, f.spin * f.t, 0.2);
      } else if (f.t < RISE + CARRY) {
        const k = ease((f.t - RISE) / CARRY);
        const p0 = f.src;
        const p3 = f.slot.clone().setY(f.slot.y + 0.45);
        const p1 = p0.clone().setY(p0.y + 2.2);
        const p2 = p3.clone().setY(p3.y + 1.6);
        const a = 1 - k;
        m.position.set(0, 0, 0).addScaledVector(p0, a * a * a).addScaledVector(p1, 3 * a * a * k).addScaledVector(p2, 3 * a * k * k).addScaledVector(p3, k * k * k);
        m.scale.setScalar(1);
        const yaw = Math.atan2(-this.n.z, this.n.x);
        m.rotation.set(Math.sin(f.t * 2.4) * 0.25 * a, yaw + f.spin * a * 1.5, 0.2 * a);
      } else {
        const k = Math.min(1, (f.t - RISE - CARRY) / SETTLE);
        m.position.copy(f.slot).setY(f.slot.y + 0.45 * (1 - k * k));
        m.rotation.set(0, Math.atan2(-this.n.z, this.n.x) + ((f.i % 3) - 1) * 0.035, 0);
      }
    }
    const landed = this.flights.filter((f) => f.t >= FLIGHT);
    if (landed.length) {
      for (const f of landed) this.endFlight(f, true);
      this.flights = this.flights.filter((f) => f.t < FLIGHT);
      this.rebuildPlanks();
    }
    if (this.complete) this.walkAbout(dt);
  }

  /** Both done laying (host): every plank is down. */
  get allLaid(): boolean {
    return this.laid.every(Boolean) && this.flights.length === 0;
  }

  // ---- folk walking over

  private spawnFolk(): void {
    const life = this.ctx.life;
    if (!life?.spawn || this.spawned.length) return;
    this.info.residents.slice(0, 2).forEach((r, i) => {
      const stand = this.shape.stands[i % this.shape.stands.length];
      if (!stand) return;
      const at = this.toIsland(stand);
      const id = `nb-${this.info.id}-${r.id}`.slice(0, 64);
      try {
        life.spawn?.({ ...r, id, houseId: undefined }, { x: at.x, z: at.z });
        this.spawned.push(id);
      } catch {
        // A resident that life cannot show stays at home.
      }
    });
  }

  private walkAbout(dt: number): void {
    const life = this.ctx.life;
    if (!life?.walkTo || this.walking) return;
    this.nextWalk -= dt;
    if (this.nextWalk > 0) return;
    this.nextWalk = 35 + Math.random() * 30;
    const ours = this.ctx.shown()?.residents?.filter((r: Resident) => !r.trip && life.objectOf?.(r.id)) ?? [];
    const theirs = this.spawned;
    const visitor = Math.random() < 0.5 && theirs.length ? { id: theirs[Math.floor(Math.random() * theirs.length)], home: 'there' as const } : ours.length ? { id: ours[Math.floor(Math.random() * ours.length)].id, home: 'here' as const } : theirs.length ? { id: theirs[0], home: 'there' as const } : null;
    if (!visitor) return;
    const obj = life.objectOf?.(visitor.id);
    if (!obj) return;
    const back = obj.position.clone();
    // Over the bridge to the other side, a look round, and home again.
    const there = visitor.home === 'here' ? this.toIsland(this.shape.stands[Math.floor(Math.random() * this.shape.stands.length)] ?? this.shape.head) : this.A.clone().addScaledVector(this.u, -3.2).addScaledVector(this.n, (Math.random() - 0.5) * 2.5);
    this.walking = true;
    void (async () => {
      try {
        await Promise.resolve(life.walkTo?.(visitor.id, { x: there.x, z: there.z }, { speed: 0.9 }));
        life.emote?.(visitor.id, Math.random() < 0.5 ? 'wave' : 'curious');
        await new Promise((r) => setTimeout(r, 7000));
        await Promise.resolve(life.walkTo?.(visitor.id, { x: back.x, z: back.z }, { speed: 0.9 }));
      } catch {
        // a walk that cannot finish just ends
      } finally {
        this.walking = false;
      }
    })();
  }

  record(names: [string, string]): BridgeRecord {
    return { island: this.info, slot: this.slot.id, builtAt: Date.now(), names };
  }

  dispose(): void {
    const w = this.ctx.world;
    const id = `together:${this.info.id}`;
    w.removeGround?.(`${id}:island`);
    w.removeGround?.(`${id}:bridge`);
    w.removeCrossing?.(id);
    for (const sid of this.spawned) this.ctx.life?.despawn?.(sid);
    this.group.removeFromParent();
    this.bridge.removeFromParent();
  }

  /** The objects a person can hold: the coils. */
  targets(): Object3D[] {
    return this.complete || !this.docked ? [] : [this.coils.near, this.coils.far];
  }
}

