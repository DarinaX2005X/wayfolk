/**
 * A duet at sunset. Two sets of wind chimes hang by the campfire, one for each person,
 * within reach of where each sits across the fire. Touch a tube with a finger (or pinch
 * at it from afar, or click it in a page) and it swings and rings. The host's set sounds
 * low, the friend's an octave and a fifth above, both in one pentatonic scale, so any two
 * notes agree. The island answers through world.setPulse: one person alone can only make
 * it glow a little; when both play, the lanterns, windows, flowers and fireflies swell far
 * brighter, a drone rises under the notes, and the residents gather round the fire and
 * dance while the flock circles overhead.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import type { IslandState } from '../mind/types';
import { M, MAT, blob, build, cbox, cyl, place } from '../world/geo';
import { mainMaterial } from '../world/materials';
import type { Ctx } from './context';
import { Energy, chimeHz, duetPulse, playingTogether } from './plan';

export const DUET_LINES = {
  open: 'Two sets of chimes, one for each of you. Play yours and listen for theirs.',
  alone: (friend: string) => `It sounds lovely. It would sound even better with ${friend}.`,
  together: 'Listen to the island. It is singing back.',
} as const;

const TUBES = 5;
const LENGTHS = [0.44, 0.39, 0.35, 0.31, 0.27];
const TUBE_R = 0.017;
const STRING = 0.07;
const DISC_Y = 1.3;
const G = 9.8;

type Part = 'low' | 'high';

interface Tube {
  pivot: Vector3;
  len: number;
  /** Tilt angles (about the stand's x and z) and their speeds. */
  ax: number;
  az: number;
  vx: number;
  vz: number;
  flash: number;
  lastHit: number;
}

class ChimeSet {
  readonly group = new Group();
  readonly tubes: Tube[] = [];
  readonly mesh: InstancedMesh;
  private readonly strings: LineSegments;
  private readonly frame: Mesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly e = new Euler();
  private readonly c = new Color();
  private readonly top = new Vector3();
  private readonly mid = new Vector3();
  private readonly s = new Vector3();
  private readonly base: Color;

  constructor(readonly part: Part, pos: Vector3, facing: number, metal: string, sail: string) {
    this.group.position.copy(pos);
    this.group.rotation.y = facing;
    this.group.name = `together:chimes:${part}`;
    // A shepherd's crook of driftwood, a wooden disc, a sail in the player's colour.
    this.frame = new Mesh(
      build([
        [place(cbox(0.07, 1.62, 0.07, 0.02), [0, 0, 0]), MAT.woodDark, { mat: M.bark }],
        [place(cbox(0.42, 0.06, 0.06, 0.02), [0.19, 1.57, 0]), MAT.woodDark, { mat: M.bark }],
        [place(cbox(0.05, 0.12, 0.05, 0.015), [0.38, 1.47, 0]), MAT.woodDark, { mat: M.bark }],
        [place(cyl(0.13, 0.13, 0.035, 14), [0.38, DISC_Y + 0.12, 0]), MAT.woodLight, { mat: M.plank }],
        [place(cyl(0.004, 0.004, 0.14, 3), [0.38, DISC_Y + 0.14, 0]), MAT.rope],
        [place(blob(0.06, 1, part === 'low' ? 3 : 4, 0.08, 0.35), [0.38, 0.62, 0], [0, 0, 0], [1.2, 1, 0.25]), sail, { smooth: true, shade: 0.15, mat: M.cloth }],
        [place(cyl(0.003, 0.003, 0.52, 3), [0.38, 0.92, 0]), MAT.rope],
        [place(blob(0.16, 1, 9, 0.2, 0.4), [0, 0.02, 0]), MAT.stoneDark, { smooth: true, mat: M.rock }],
      ]),
      mainMaterial(),
    );
    this.group.add(this.frame);
    const geo = new CylinderGeometry(TUBE_R, TUBE_R, 1, 10, 1);
    this.base = new Color(metal);
    const mat = new MeshStandardMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.32 });
    this.mesh = new InstancedMesh(geo, mat, TUBES);
    this.mesh.name = `together:tubes:${part}`;
    this.mesh.userData.together = { kind: 'chime', part };
    this.mesh.frustumCulled = false;
    for (let i = 0; i < TUBES; i++) {
      const a = (i / TUBES) * Math.PI * 2;
      const pivot = new Vector3(0.38 + Math.cos(a) * 0.095, DISC_Y + 0.1, Math.sin(a) * 0.095);
      this.tubes.push({ pivot, len: LENGTHS[i], ax: 0, az: 0, vx: 0, vz: 0, flash: 0, lastHit: -1e9 });
      this.mesh.setColorAt(i, this.base);
    }
    this.group.add(this.mesh);
    const sp = new Float32Array(TUBES * 6);
    const sg = new BufferGeometry();
    sg.setAttribute('position', new BufferAttribute(sp, 3));
    this.strings = new LineSegments(sg, new LineBasicMaterial({ color: new Color('#5a4636') }));
    this.strings.frustumCulled = false;
    this.group.add(this.strings);
    this.apply();
  }

  /** Bottom and top of tube i in the island frame. */
  ends(i: number, a: Vector3, b: Vector3): void {
    const t = this.tubes[i];
    const dir = this.v.set(0, -1, 0).applyEuler(this.e.set(t.ax, 0, t.az));
    a.copy(t.pivot).addScaledVector(dir, STRING);
    b.copy(t.pivot).addScaledVector(dir, STRING + t.len);
    this.group.updateMatrix();
    a.applyMatrix4(this.group.matrix);
    b.applyMatrix4(this.group.matrix);
  }

  /** A strike: `push` is the direction of the blow in the island frame. */
  strike(i: number, v: number, push: Vector3 | null, now: number): void {
    const t = this.tubes[i];
    t.lastHit = now;
    t.flash = 1;
    // into the set's own frame
    const p = this.v.copy(push ?? new Vector3(Math.random() - 0.5, 0, Math.random() - 0.5)).applyAxisAngle(new Vector3(0, 1, 0), -this.group.rotation.y);
    p.y = 0;
    if (p.lengthSq() < 1e-6) p.set(1, 0, 0);
    p.normalize();
    const k = 2.2 + v * 2.4;
    t.vx += p.z * k;
    t.vz += -p.x * k;
  }

  update(dt: number): void {
    for (const t of this.tubes) {
      const L = STRING + t.len / 2;
      const w2 = G / L;
      const damp = Math.exp(-dt * 1.1);
      t.vx = (t.vx - w2 * Math.sin(t.ax) * dt) * damp;
      t.vz = (t.vz - w2 * Math.sin(t.az) * dt) * damp;
      t.ax = Math.max(-0.7, Math.min(0.7, t.ax + t.vx * dt));
      t.az = Math.max(-0.7, Math.min(0.7, t.az + t.vz * dt));
      t.flash = Math.max(0, t.flash - dt * 1.6);
    }
    this.apply();
  }

  private apply(): void {
    const pos = this.strings.geometry.getAttribute('position') as BufferAttribute;
    const c = this.c;
    this.tubes.forEach((t, i) => {
      this.q.setFromEuler(this.e.set(t.ax, 0, t.az));
      const dir = this.v.set(0, -1, 0).applyQuaternion(this.q);
      const top = this.top.copy(t.pivot).addScaledVector(dir, STRING);
      const mid = this.mid.copy(t.pivot).addScaledVector(dir, STRING + t.len / 2);
      this.m.compose(mid, this.q, this.s.set(1, t.len, 1));
      this.mesh.setMatrixAt(i, this.m);
      c.copy(this.base).multiplyScalar(1 + t.flash * 1.4);
      this.mesh.setColorAt(i, c);
      pos.setXYZ(i * 2, t.pivot.x, t.pivot.y, t.pivot.z);
      pos.setXYZ(i * 2 + 1, top.x, top.y, top.z);
    });
    pos.needsUpdate = true;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.strings.geometry.dispose();
  }
}

/** Little lights rising from a struck tube, in the player's colour. One draw call. */
export class Motes {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly life: Float32Array;
  private readonly vel: Float32Array;
  private next = 0;
  constructor(readonly max = 96) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos, 3));
    g.setAttribute('color', new BufferAttribute(this.col, 3));
    g.setAttribute('life', new BufferAttribute(this.life, 1));
    this.points = new Points(
      g,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexShader: 'attribute vec3 color; attribute float life; varying vec3 vC; varying float vL; void main(){ vC = color; vL = life; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = (14.0 + 10.0 * life) * (1.0 / -mv.z) * 6.0; gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying vec3 vC; varying float vL; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vC * a * a * vL, 1.0); }',
      }),
    );
    this.points.frustumCulled = false;
    this.points.name = 'together:motes';
  }
  emit(at: Vector3, color: Color, n = 4, spread = 0.1): void {
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos.set([at.x + (Math.random() - 0.5) * spread, at.y + (Math.random() - 0.5) * spread, at.z + (Math.random() - 0.5) * spread], i * 3);
      this.vel.set([(Math.random() - 0.5) * 0.25, 0.35 + Math.random() * 0.35, (Math.random() - 0.5) * 0.25], i * 3);
      this.col.set([color.r, color.g, color.b], i * 3);
      this.life[i] = 1;
    }
  }
  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] = Math.max(0, this.life[i] - dt / 2.2);
      this.pos[i * 3] += this.vel[i * 3] * dt + Math.sin(this.life[i] * 9 + i) * 0.002;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    const g = this.points.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('life') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }
}

export class Duet {
  readonly group = new Group();
  open = false;
  readonly sets: Record<Part, ChimeSet>;
  readonly spots: Record<'host' | 'guest', { pos: Vector3; rotY: number }>;
  private readonly energy: Record<Part, Energy> = { low: new Energy(), high: new Energy() };
  private readonly motes = new Motes();
  private gathered = false;
  private danceAt = 0;
  private quietSince = -1;
  private pulse = 0;
  private hue = 0.09;
  private toldTogether = false;
  private toldAlone = false;
  private aloneNotes = 0;
  private pop = 0;
  private readonly a = new Vector3();
  private readonly b = new Vector3();

  constructor(private readonly ctx: Ctx) {
    const F = ctx.world.fire?.clone() ?? new Vector3(-2.5, 0, -3.7);
    F.y = ctx.ground(F.x, F.z);
    // The host sits on the porch side of the fire, the friend on the log bench across it.
    const host = new Vector3(F.x + 0.98, 0, F.z + 1.15);
    const guest = new Vector3(F.x - 0.3, 0, F.z - 1.62);
    host.y = ctx.ground(host.x, host.z);
    guest.y = ctx.ground(guest.x, guest.z);
    const face = (from: Vector3): number => Math.atan2(-(F.x - from.x), -(F.z - from.z));
    this.spots = { host: { pos: host, rotY: face(host) }, guest: { pos: guest, rotY: face(guest) } };
    const standAt = (spot: { pos: Vector3; rotY: number }): { pos: Vector3; facing: number } => {
      const f = new Vector3(-Math.sin(spot.rotY), 0, -Math.cos(spot.rotY));
      const right = new Vector3(-f.z, 0, f.x);
      // A little ahead and to the right, the tubes at the height of a seated person's hands.
      const p = spot.pos.clone().addScaledVector(f, 0.5).addScaledVector(right, 0.05);
      p.y = ctx.ground(p.x, p.z) - 0.22;
      // The crook's arm reaches toward the person: local +x points back at them.
      return { pos: p.addScaledVector(right, 0.38), facing: spot.rotY + Math.PI / 2 };
    };
    const hs = standAt(this.spots.host);
    const gs = standAt(this.spots.guest);
    this.sets = {
      low: new ChimeSet('low', hs.pos, hs.facing, '#d9a441', '#e9825f'),
      high: new ChimeSet('high', gs.pos, gs.facing, '#c0d6dc', '#3f9e98'),
    };
    this.group.add(this.sets.low.group, this.sets.high.group, this.motes.points);
    this.group.name = 'together:duet';
    this.group.visible = false;
    ctx.root.add(this.group);
  }

  setOpen(on: boolean): void {
    if (on === this.open) return;
    this.open = on;
    this.group.visible = on;
    this.pop = 0;
    if (on) {
      this.ctx.world.campfire?.(true);
      this.gathered = false;
      this.toldTogether = false;
      this.toldAlone = false;
      this.aloneNotes = 0;
    } else {
      this.ctx.world.setPulse?.(0);
      this.ctx.sound.drone(0);
      this.ctx.life?.flockCircle?.(null);
    }
  }

  /** My part: the host plays the low set, the friend the high one. */
  mine(): Part {
    return this.ctx.role() === 'guest' ? 'high' : 'low';
  }

  /** A tube struck (by me or by the friend's event). */
  strike(part: Part, i: number, v: number, push: Vector3 | null): void {
    if (!this.open) return;
    const set = this.sets[part];
    const now = this.ctx.now();
    set.strike(i, v, push, now);
    this.energy[part].strike(v, now);
    set.ends(i, this.a, this.b);
    const at = this.a.lerp(this.b, 0.5);
    const world = this.ctx.root.localToWorld(at.clone());
    this.ctx.sound.chime(chimeHz(part, i), v, world, part === 'low' ? 0.9 : 1.1);
    this.motes.emit(at, new Color(part === 'low' ? '#ffd38a' : '#bfefff'), 4);
    if (part === this.mine() && this.ctx.friend() && !playingTogether(this.energy.low.lastAt, this.energy.high.lastAt, now)) {
      this.aloneNotes += 1;
      if (this.aloneNotes === 9 && !this.toldAlone) {
        this.toldAlone = true;
        this.ctx.say(DUET_LINES.alone(this.ctx.friend()?.name ?? 'your friend'));
      }
    }
  }

  /** Which tube of which set a ray or a fingertip is at: the nearest within reach. */
  tubeNear(p: Vector3, reach: number): { part: Part; i: number; d: number } | null {
    let best: { part: Part; i: number; d: number } | null = null;
    for (const part of ['low', 'high'] as Part[]) {
      for (let i = 0; i < TUBES; i++) {
        this.sets[part].ends(i, this.a, this.b);
        const d = segDist(p, this.a, this.b);
        if (d < reach && (!best || d < best.d)) best = { part, i, d };
      }
    }
    return best;
  }

  /** The tube a hit object and instance refer to. */
  fromHit(object: Object3D, instanceId: number | undefined): { part: Part; i: number } | null {
    const t = object.userData.together as { kind?: string; part?: Part } | undefined;
    if (t?.kind !== 'chime' || instanceId === undefined || !t.part) return null;
    return { part: t.part, i: instanceId };
  }

  targets(): Object3D[] {
    return this.open ? [this.sets.low.mesh, this.sets.high.mesh] : [];
  }

  update(dt: number, shown: IslandState | null): void {
    if (!this.open) return;
    this.pop = Math.min(1, this.pop + dt / 0.7);
    const s = this.pop < 1 ? 0.3 + 0.7 * this.pop + Math.sin(this.pop * Math.PI) * 0.1 : 1;
    this.sets.low.group.scale.setScalar(s);
    this.sets.high.group.scale.setScalar(s);
    this.sets.low.update(dt);
    this.sets.high.update(dt);
    this.motes.update(dt);
    const lo = this.energy.low;
    const hi = this.energy.high;
    lo.decay(dt);
    hi.decay(dt);
    const now = this.ctx.now();
    const together = playingTogether(lo.lastAt, hi.lastAt, now);
    const goal = duetPulse(lo.value, hi.value);
    this.pulse += (goal - this.pulse) * (1 - Math.exp(-dt * (goal > this.pulse ? 10 : 2.5)));
    this.hue += ((together ? 0.03 : 0.1) - this.hue) * (1 - Math.exp(-dt * 0.8));
    this.ctx.world.setPulse?.(this.pulse, this.hue);
    this.ctx.sound.drone(together ? Math.min(1, (lo.value + hi.value) * 0.8) : 0);
    if (together && lo.value + hi.value > 0.5) {
      this.quietSince = -1;
      if (!this.toldTogether) {
        this.toldTogether = true;
        this.ctx.say(DUET_LINES.together);
      }
      if (!this.gathered) this.gather(shown);
      if (now > this.danceAt) {
        this.danceAt = now + 3500;
        for (const r of shown?.residents ?? []) if (this.ctx.life?.objectOf?.(r.id)) this.ctx.life?.emote?.(r.id, 'dance');
      }
    } else if (this.gathered) {
      if (this.quietSince < 0) this.quietSince = now;
      if (now - this.quietSince > 7000) {
        this.gathered = false;
        this.ctx.life?.flockCircle?.(null);
        for (const r of shown?.residents ?? []) if (this.ctx.life?.objectOf?.(r.id)) this.ctx.life?.emote?.(r.id, 'happy');
      }
    }
  }

  /** The residents come to the fire in a ring and the flock circles overhead. */
  private gather(shown: IslandState | null): void {
    this.gathered = true;
    const life = this.ctx.life;
    const F = this.ctx.world.fire?.clone() ?? new Vector3(-2.5, 0, -3.7);
    life?.setBeat?.(96);
    life?.flockCircle?.(this.ctx.root.localToWorld(F.clone().add(new Vector3(0, 3.4, 0))), 3.2);
    const folk = (shown?.residents ?? []).filter((r) => life?.objectOf?.(r.id));
    const host = this.spots.host.pos;
    const guest = this.spots.guest.pos;
    const ha = Math.atan2(host.z - F.z, host.x - F.x);
    const ga = Math.atan2(guest.z - F.z, guest.x - F.x);
    folk.slice(0, 6).forEach((r, k) => {
      // Round the fire on the open sides, clear of the two players.
      let a = ha + Math.PI / 2 + (k / Math.max(1, folk.length - 1)) * Math.PI * 0.9;
      if (Math.abs(Math.atan2(Math.sin(a - ga), Math.cos(a - ga))) < 0.5) a += 0.6;
      const at = { x: F.x + Math.cos(a) * 2.3, z: F.z + Math.sin(a) * 2.3 };
      void Promise.resolve(life?.walkTo?.(r.id, at, { speed: 1.3 })).then(() => {
        life?.face?.(r.id, { x: F.x, z: F.z });
        life?.emote?.(r.id, 'dance');
      });
    });
  }

  dispose(): void {
    this.setOpen(false);
    this.sets.low.dispose();
    this.sets.high.dispose();
    this.group.removeFromParent();
  }
}

function segDist(p: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(1e-6, ab.lengthSq())));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

