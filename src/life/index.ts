// createLife(app, world): Pip and the flock, residents, speech, arrivals, building, the
// island's daily life and the sounds of places. See src/life/types.ts for the contract.
import { Color, Object3D, Vector3, createSystem, type Camera } from '@iwsdk/core';
import type { HouseSpec, P2, Resident, Vehicle } from '../mind/types';
import { LifeAudio } from './audio';
import { loadBubbleFonts } from './bubble';
import { Daily } from './daily';
import { BirdAgent, readHand, type FlockEnv } from './flock';
import { Fx } from './fx';
import { ResidentAgent, setBeat } from './residents';
import { setRim } from './rig';
import { Arrival, Build, type Scene } from './scenes';
import { Speech, type Speaker } from './speech';
import type { BuildStep, Emote, HandLike, Life, LifeApp, LifeWorld, PointLike, SayOptions, SoundHandle, SoundKind } from './types';
import { PIP_VOICE, voiceProfile } from './voice';
import { wind } from '../world/wind';

export type * from './types';
export { SPECIES_PLAN, TRADE_GEAR, planFor } from './species';
export { voiceProfile, syllablePlan } from './voice';
export { planBuild } from './build-plan';

const FLOCK_SIZE = 7;
const tA = new Vector3();
const tB = new Vector3();
const UP_Y = new Vector3(0, 1, 0);

interface WorldLike {
  scene?: Object3D;
  camera?: Camera;
  sceneEntity?: unknown;
  createTransformEntity?: (o: Object3D, opts: { parent?: unknown; persistent?: boolean }) => unknown;
  registerSystem?: (cls: unknown) => unknown;
}

/** Read any point-ish thing into a world Vector3; y from the ground when missing. */
function readPoint(p: PointLike | undefined | null, out: Vector3, ground: (x: number, z: number) => number): Vector3 | null {
  if (!p) return null;
  const o = p as Object3D;
  if (o.isObject3D) return o.getWorldPosition(out);
  const any = p as { pos?: { x: number; y?: number; z: number }; position?: { x: number; y: number; z: number }; x?: number; y?: number; z?: number };
  const src = any.pos ?? any.position ?? (any as { x: number; y?: number; z: number });
  if (!Number.isFinite(src.x) || !Number.isFinite(src.z)) return null;
  out.set(src.x, Number.isFinite(src.y) ? (src.y as number) : ground(src.x, src.z), src.z);
  return out;
}

export function createLife(app: LifeApp, world: LifeWorld): Life {
  const host = ((app.world as WorldLike | undefined) ?? (app as unknown as WorldLike)) as WorldLike;
  const scene = (app.scene ?? host.scene) as Object3D | undefined;
  const camera = (app.camera ?? host.camera) as Camera | undefined;

  const root = new Object3D();
  root.name = 'life';
  if (host.createTransformEntity && host.sceneEntity) host.createTransformEntity(root, { parent: host.sceneEntity, persistent: true });
  else if (scene) scene.add(root);
  else world.root.add(root);

  const audio = new LifeAudio(app.audio);
  const fx = new Fx();
  root.add(fx.puffs.mesh, fx.glows.mesh);
  const speech = new Speech(audio, root);
  void loadBubbleFonts();

  // The real world (src/world) answers groundY(x, z) in its root space; stand-ins may give heightAt.
  const W = world as LifeWorld & {
    groundY?: (x: number, z: number) => number;
    house?: (id: string) => { door: Vector3; top: Vector3; window: Vector3 } | undefined;
    seat?: { perch?: Vector3; meet?: Vector3 };
    pier?: { dock?: Vector3; step?: Vector3; rotY?: number; walk?: Vector3[] };
  };
  const heightAt = (x: number, z: number): number | undefined => (world.heightAt ? world.heightAt(x, z) : W.groundY ? W.groundY(x, z) : undefined);
  const toWorld = (v: Vector3): Vector3 => world.root.localToWorld(v);
  const ground = (x: number, z: number, fallback = 0): number => {
    const h = heightAt(x, z);
    return Number.isFinite(h) ? (h as number) : fallback;
  };
  // Walking ground: follows the island, but never drops a resident off a pier or bridge
  // the height field does not know about.
  const walkGround = (x: number, z: number, prev: number): number => {
    const h = heightAt(x, z);
    if (!Number.isFinite(h)) return prev;
    return prev - (h as number) > 0.5 ? prev : (h as number);
  };
  const center = new Vector3();
  const head = new Vector3(0, 1.2, 2);
  const headFwd = new Vector3(0, 0, -1);
  const updateHead = (): void => {
    if (!camera) return;
    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(head);
    camera.getWorldDirection(headFwd);
  };

  // --- birds -----------------------------------------------------------------
  const pipAgent = new BirdAgent(true, 0, 1.0);
  pipAgent.mode = 'hover';
  const flock: BirdAgent[] = [];
  for (let i = 0; i < FLOCK_SIZE; i++) flock.push(new BirdAgent(false, i, 2.0, 0.75));
  const allBirds = [pipAgent, ...flock];
  for (const b of allBirds) root.add(b.object);
  const perches: Vector3[] = [];
  const houseIds = new Set<string>();
  const refreshPerches = (): void => {
    perches.length = 0;
    const list = world.perches?.() ?? [];
    for (const p of list) {
      const v = readPoint(p, new Vector3(), ground);
      if (v) perches.push(v);
    }
    // The real world: Pip's lamp post by the seat and the tops of the houses.
    if (W.seat?.perch) perches.push(toWorld(W.seat.perch.clone()));
    for (const id of houseIds) {
      const h = W.house?.(id);
      if (h?.top) perches.push(toWorld(h.top.clone()).add(new Vector3(0, 0.05, 0)));
    }
  };
  // The island's shared wind (src/world/wind.ts). The world advances its clock; if nothing
  // does (a preview without the world), life keeps it moving.
  let windSeen = -1;
  let windStill = 0;
  const windAt = (pos: Vector3, out: Vector3): Vector3 => wind.sample(pos, undefined, out);
  const flockEnv: FlockEnv = { head, headFwd, center, radius: world.radius ?? 12, time: 0, night: 0, perches, wind: windAt };

  // Start the flock spread over the island.
  const startFlock = (): void => {
    world.root.getWorldPosition(center);
    refreshPerches();
    flock.forEach((b, i) => {
      const a = (i / flock.length) * Math.PI * 2;
      b.pos.set(center.x + Math.cos(a) * 4, center.y + 4 + (i % 3) * 0.4, center.z + Math.sin(a) * 4);
      b.vel.set(-Math.sin(a) * 2, 0, Math.cos(a) * 2);
    });
    updateHead();
    pipAgent.pos.copy(head).addScaledVector(headFwd, 0.9).add(tA.set(0.3, 0.1, 0));
  };
  startFlock();

  let pipMode: string = 'hover';
  const pipSpeaker: Speaker = {
    id: 'pip',
    name: 'Pip',
    accent: '#d9822b',
    profile: voiceProfile(PIP_VOICE, { bird: true }),
    anchor: (out) => out.copy(pipAgent.pos).add(tB.set(0, 0.16, 0)),
    voicePos: (out) => out.copy(pipAgent.pos).add(tB.set(0, 0.08, 0)),
    setMouth: (v) => (pipAgent.mouth = v),
    setTalking: () => undefined,
  };

  const handGoal = (hand: HandLike) => (out: Vector3, up: Vector3): boolean => readHand(hand, out, up);

  const pip = {
    get object(): Object3D {
      return pipAgent.object;
    },
    get mode(): string {
      return pipMode;
    },
    landOn(hand: HandLike): Promise<void> {
      pipMode = 'palm';
      pipAgent.mode = 'palm';
      pipAgent.landed = false;
      pipAgent.goalFn = handGoal(hand);
      return new Promise<void>((resolve) => {
        pipAgent.onLanded = () => {
          audio.chirp(pipAgent.pos, 1.15);
          resolve();
        };
      });
    },
    follow(hand: HandLike): void {
      pipMode = 'follow';
      pipAgent.takeOff();
      pipAgent.mode = 'follow';
      pipAgent.goalFn = handGoal(hand);
    },
    hover(): void {
      pipMode = 'hover';
      pipAgent.takeOff();
      pipAgent.mode = 'hover';
      pipAgent.goalFn = null;
    },
    /** Puts Pip at a point at once (stills for the cover, where he must already be there). */
    place(p: Vector3): void {
      pipAgent.pos.copy(p);
      pipAgent.vel.set(0, 0, 0);
    },
    /** Where Pip hovers from the head (metres ahead, right, below); the page keeps him further off than a headset. */
    setHover(o: { ahead: number; side: number; drop: number }): void {
      flockEnv.hover = o;
    },
    say(text: string, opts?: SayOptions): Promise<void> {
      // Pip talks right by the ear: his voice stays soft.
      return speech.say(pipSpeaker, text, { volume: 0.32, ...opts });
    },
    emote(kind: Emote): void {
      if (kind === 'happy' || kind === 'excited') audio.chirp(pipAgent.pos, 1.25);
    },
  };

  // --- residents ---------------------------------------------------------------
  const agents = new Map<string, ResidentAgent>();
  const homes = new Map<string, Vector3>();
  const speakers = new Map<string, Speaker>();
  const residentSpeaker = (a: ResidentAgent): Speaker => ({
    id: a.res.id,
    name: a.res.name,
    accent: a.accent,
    profile: voiceProfile(a.res.voice),
    anchor: (out) => a.anchor(out),
    voicePos: (out) => a.voicePos(out),
    setMouth: (v) => (a.mouth = v),
    setTalking: (on) => (a.talking = on),
  });

  const doorOf = (spec: HouseSpec | P2 | undefined): Vector3 | null => {
    if (!spec) return null;
    const s = spec as HouseSpec;
    if (s.id) {
      houseIds.add(s.id);
      const h = W.house?.(s.id);
      if (h?.door) return toWorld(h.door.clone());
    }
    if (s.pos && Number.isFinite(s.pos.x)) {
      const rot = s.rotY ?? 0;
      const x = s.pos.x + Math.sin(rot) * 1.9;
      const z = s.pos.z + Math.cos(rot) * 1.9;
      return new Vector3(x, ground(x, z), z);
    }
    const p = spec as P2;
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) return new Vector3(p.x, ground(p.x, p.z), p.z);
    return null;
  };

  const ensureAgent = (res: Resident): ResidentAgent => {
    let a = agents.get(res.id);
    if (!a) {
      a = new ResidentAgent(res);
      agents.set(res.id, a);
      speakers.set(res.id, residentSpeaker(a));
      root.add(a.group);
    }
    return a;
  };

  const route = (from: Vector3, to: Vector3): Vector3[] => {
    const pts = world.route?.({ x: from.x, z: from.z }, { x: to.x, z: to.z });
    if (pts && pts.length) return pts.map((p) => new Vector3(p.x, ground(p.x, p.z, to.y), p.z));
    return [to.clone()];
  };

  // --- time of day ---------------------------------------------------------------
  let night = 0;
  const setTime = (date: Date): void => {
    const h = date.getHours() + date.getMinutes() / 60;
    // 0 by day, 1 from 22:00 to 05:00, soft edges at dusk and dawn.
    const dusk = Math.min(1, Math.max(0, (h - 20) / 2));
    const dawn = Math.min(1, Math.max(0, (7 - h) / 2));
    night = h >= 12 ? dusk : dawn;
    flockEnv.night = night;
    audio.setNight(night);
    const rim = new Color(0.6, 0.45, 0.33).lerp(new Color(0.28, 0.36, 0.55), night);
    const fill = new Color(0.1, 0.075, 0.06).lerp(new Color(0.05, 0.06, 0.1), night);
    setRim(rim, fill);
  };
  setTime(new Date());

  // --- scenes ------------------------------------------------------------------
  const scenes: Scene[] = [];
  let clock = 0;

  const daily = new Daily({
    agents: () => [...agents.values()],
    door: (a) => homes.get(a.res.id) ?? null,
    benches: () => (world.benches?.() ?? []).map((p) => readPoint(p, new Vector3(), ground)).filter((v): v is Vector3 => !!v),
    pier: () => readPoint(world.pier, new Vector3(), ground),
    pierOut: () => pierOut(new Vector3()),
    seat: () => readPoint(world.seat, new Vector3(), ground),
    spots: () => (world.spots?.() ?? []).map((p) => readPoint(p, new Vector3(), ground)).filter((v): v is Vector3 => !!v),
    route,
    time: () => clock,
    night: () => night,
    chatter: (a, text) => {
      const s = speakers.get(a.res.id);
      if (s) void speech.say(s, text, { bubble: false, volume: 0.28 });
    },
  });

  function pierOut(out: Vector3): Vector3 {
    if (Number.isFinite(W.pier?.rotY) && W.pier?.dock) {
      // rotY 0 faces -z; the pier anchor faces outward along the pier.
      const r = W.pier.rotY as number;
      return out.set(-Math.sin(r), 0, -Math.cos(r)).transformDirection(world.root.matrixWorld).setY(0).normalize();
    }
    const dock = readPoint(world.pier, tA, ground);
    if (!dock) return out.set(0, 0, -1);
    out.copy(dock).sub(center).setY(0);
    if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
    return out.normalize();
  }

  const cloudY = (): number => {
    const c = (world as { cloudY?: number }).cloudY;
    // Pieces and travelers rise from a few metres under the rim, not from the far cloud floor.
    return Number.isFinite(c) ? Math.max(c as number, center.y - 4) : center.y - 3;
  };

  const manual = (id: string, seconds = 30): void => {
    daily.manualUntil.set(id, clock + seconds);
  };

  let lastTime = -1;
  const update = (dtIn: number, time: number): void => {
    if (time === lastTime) return;
    lastTime = time;
    const dt = Math.min(0.05, Math.max(0, dtIn > 1 ? dtIn / 1000 : dtIn));
    clock += dt;
    updateHead();
    if (camera) audio.listen(camera);
    flockEnv.time = clock;
    if (wind.time === windSeen) windStill++;
    else windStill = 0;
    if (windStill > 3) wind.update(clock);
    windSeen = wind.time;
    world.root.getWorldPosition(center);
    for (const b of allBirds) b.update(dt, flockEnv, flock);
    for (const s of [...scenes]) if (!s.update(dt)) scenes.splice(scenes.indexOf(s), 1);
    daily.update(dt);
    for (const a of agents.values()) {
      a.update(dt, clock, head, walkGround, windAt);
      // A little room round the person: nobody walks right up into their face.
      if (!a.hidden && !a.riding) {
        const dx = a.pos.x - head.x;
        const dz = a.pos.z - head.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.35 && d > 1e-3) {
          a.pos.x = head.x + (dx / d) * 1.35;
          a.pos.z = head.z + (dz / d) * 1.35;
          a.group.position.x = a.pos.x;
          a.group.position.z = a.pos.z;
        }
      }
    }
    speech.update(dt, head, (id) => (id === 'pip' ? pipSpeaker : speakers.get(id)));
    fx.update(dt);
  };

  // Drive ourselves when the host is an IWSDK world.
  if (host.registerSystem) {
    try {
      class LifeSystem extends createSystem({}) {
        update(delta: number, time: number): void {
          update(delta, time);
        }
      }
      host.registerSystem(LifeSystem);
    } catch (error) {
      console.warn('[life] could not register the life system; call life.update(dt, time) each frame', error);
    }
  }

  const ready = Promise.resolve(world.ready)
    .catch(() => undefined)
    .then(() => {
      world.root.getWorldPosition(center);
      refreshPerches();
    });

  const life: Life = {
    root,
    pip,
    ready,
    build(steps: BuildStep[]): Promise<void> {
      if (!steps.length) return Promise.resolve();
      for (const st of steps) {
        const id = (st as { houseId?: string }).houseId;
        if (id) houseIds.add(id);
      }
      const b = new Build(
        { root, worldRoot: world.root, audio, fx, birds: flock, center, radius: world.radius ?? 12, cloudY: cloudY(), seat: readPoint(world.seat, new Vector3(), ground) ?? head.clone() },
        steps,
      );
      scenes.push(b);
      return b.done;
    },
    arrive(resident: Resident, vehicle?: Vehicle): Promise<void> {
      const a = ensureAgent(resident);
      manual(resident.id, 40);
      const out = pierOut(new Vector3());
      let dock: Vector3;
      let landing: Vector3;
      let hang: Vector3 | undefined;
      if (W.pier?.step && W.pier.dock) {
        // The real pier: the traveler steps onto `step`; the vehicle hangs beside it at `dock`.
        dock = toWorld(W.pier.step.clone());
        hang = toWorld(W.pier.dock.clone());
        const meet = W.seat?.meet ? toWorld(W.seat.meet.clone()) : center.clone();
        landing = dock.clone().add(meet.sub(dock).setY(0).normalize().multiplyScalar(1.0));
        landing.y = dock.y;
      } else {
        dock = readPoint(world.pier, new Vector3(), ground) ?? center.clone().add(new Vector3(0, 0, -6));
        landing = dock.clone().addScaledVector(out, -1.0);
        landing.y = ground(landing.x, landing.z, dock.y);
      }
      const arrival = new Arrival(
        { root, audio, fx, dock, out, landing, hang, head: () => head, greeters: flock.slice(0, 3), cloudY: cloudY() },
        a,
        vehicle ?? resident.vehicle ?? 'balloon',
      );
      scenes.push(arrival);
      return arrival.done;
    },
    spawn(resident: Resident, home?: HouseSpec | P2): Object3D {
      const a = ensureAgent(resident);
      const door = doorOf(home);
      if (door) homes.set(resident.id, door);
      const at = door ?? readPoint(world.spots?.()[0], new Vector3(), ground) ?? center.clone();
      a.pos.copy(at);
      a.pos.y = ground(at.x, at.z, at.y);
      a.hidden = false;
      a.riding = false;
      a.group.position.copy(a.pos);
      if (a.group.parent !== root) root.add(a.group);
      return a.group;
    },
    despawn(id: string): void {
      const a = agents.get(id);
      if (!a) return;
      speech.silence(id);
      a.group.removeFromParent();
      a.dispose();
      agents.delete(id);
      speakers.delete(id);
      homes.delete(id);
    },
    walkTo(id: string, p: PointLike, opts?: { speed?: number }): Promise<void> {
      const a = agents.get(id);
      const to = readPoint(p, new Vector3(), ground);
      if (!a || !to) return Promise.resolve();
      manual(id, 60);
      const normal = a.speed;
      if (opts?.speed) a.speed = opts.speed;
      return new Promise<void>((resolve) =>
        a.walk(route(a.pos, to), () => {
          a.speed = normal;
          resolve();
        }),
      );
    },
    say(id: string, text: string, opts?: SayOptions): Promise<void> {
      if (id === 'pip') return pip.say(text, opts);
      const s = speakers.get(id);
      const a = agents.get(id);
      if (!s || !a) return Promise.resolve();
      manual(id, 30);
      if (opts?.mood) a.emote(opts.mood, clock, 2.2);
      return speech.say(s, text, opts);
    },
    emote(id: string, kind: Emote): void {
      if (id === 'pip') return pip.emote(kind);
      const a = agents.get(id);
      if (!a) return;
      manual(id, 20);
      a.emote(kind, clock);
    },
    face(id: string, p?: PointLike): void {
      const a = agents.get(id);
      if (!a) return;
      const to = p ? readPoint(p, new Vector3(), ground) : head;
      if (to) a.faceToward(to);
      a.lookPerson = !p;
    },
    startDaily(): void {
      daily.start();
    },
    feed(at: () => Vector3 | null, opts: { count?: number; seconds?: number; spread?: number; scale?: number; up?: () => Vector3 } = {}): Promise<void> {
      // A few of the flock come down round the crumbs, peck for a while, then fly off.
      const free = flock.filter((b) => !b.carrying && (b.mode === 'flock' || b.mode === 'perch'));
      const birds = free.slice(0, Math.max(1, Math.min(free.length, opts.count ?? 4)));
      const spread = opts.spread ?? 0.4;
      const scale = opts.scale ?? 1;
      birds.forEach((b, i) => {
        const a = (i / birds.length) * Math.PI * 2 + 0.6;
        const r = spread * (0.55 + (i % 2) * 0.45);
        const off = new Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
        b.perchIdx = -1;
        b.takeOff();
        b.mode = 'palm';
        b.landed = false;
        b.look = null;
        b.model.mesh.scale.setScalar(scale);
        b.goalFn = (out, up) => {
          const c = at();
          if (!c) return false;
          out.copy(c).add(off);
          up.copy(opts.up?.() ?? UP_Y);
          return true;
        };
        b.onLanded = () => {
          b.pecking = true;
          audio.chirp(b.pos, 1.4 + i * 0.07);
        };
      });
      const seconds = opts.seconds ?? 9;
      return new Promise<void>((resolve) => {
        const t0 = clock;
        const check = (): void => {
          if (clock - t0 < seconds) {
            setTimeout(check, 250);
            return;
          }
          for (const b of birds) {
            b.pecking = false;
            b.goalFn = null;
            b.onLanded = null;
            b.takeOff();
            b.mode = 'flock';
            b.model.mesh.scale.setScalar(1);
          }
          resolve();
        };
        setTimeout(check, 250);
      });
    },
    flockCircle(at: Vector3 | null, radius = 3): void {
      for (const b of flock) {
        if (at) {
          b.mode = 'circle';
          b.circleCenter.copy(at);
          b.circleRadius = radius;
        } else if (b.mode === 'circle') b.mode = 'flock';
      }
    },
    setBeat(bpm: number): void {
      setBeat(bpm);
    },
    stopDaily(): void {
      daily.stop();
    },
    soundAt(pos: PointLike, kind: SoundKind, volume = 1): SoundHandle {
      const v = readPoint(pos, new Vector3(), ground);
      if (!v) return { stop() {}, setVolume() {} };
      return audio.loop(kind, v, volume);
    },
    skip(): void {
      speech.skip();
      for (const s of scenes) s.skip();
    },
    quiet(id: string): void {
      speech.silence(id);
    },
    hurry(id: string): void {
      // A walker told to hurry steps out of a puff of dust where they were going.
      const a = agents.get(id);
      if (!a || !a.walking) return;
      const from = a.pos.clone();
      if (a.finishWalk()) {
        a.pos.y = ground(a.pos.x, a.pos.z, a.pos.y);
        a.group.position.copy(a.pos);
        fx.dust(from, 0.35, '#efe1c8');
        fx.dust(a.pos.clone(), 0.45, '#efe1c8');
        a.faceToward(head);
      }
    },
    setTime,
    update,
    flockObjects(): Object3D[] {
      return flock.map((b) => b.object);
    },
    objectOf(id: string): Object3D | undefined {
      if (id === 'pip') return pipAgent.object;
      return agents.get(id)?.group;
    },
    get audio(): AudioContext | null {
      return audio.ensure();
    },
    stats() {
      let drawCalls = 0;
      let triangles = 0;
      for (const b of allBirds) {
        drawCalls++;
        triangles += b.model.rig.triangles;
      }
      for (const a of agents.values()) {
        if (a.hidden) continue;
        drawCalls++;
        triangles += a.triangles();
      }
      for (const s of scenes) if (s instanceof Arrival) drawCalls++;
      root.traverse((o) => {
        if (o.name === 'life-bubble' && o.visible) drawCalls++;
      });
      drawCalls += fx.drawCalls();
      return { drawCalls, triangles };
    },
    dispose(): void {
      speech.dispose();
      daily.stop();
      root.removeFromParent();
    },
  };
  return life;
}
