// createLife(app, world): Pip and the flock, residents, speech, arrivals, building, the
// island's daily life and the sounds of places. See src/life/types.ts for the contract.
import { Color, Object3D, Vector3, createSystem, type Camera } from '@iwsdk/core';
import type { HouseSpec, P2, Resident, Vehicle } from '../mind/types';
import { LifeAudio } from './audio';
import { loadBubbleFonts } from './bubble';
import { Daily } from './daily';
import { BirdAgent, readHand, type FlockEnv } from './flock';
import { Fx } from './fx';
import { ResidentAgent } from './residents';
import { setRim } from './rig';
import { Arrival, Build, type Scene } from './scenes';
import { Speech, type Speaker } from './speech';
import type { BuildStep, Emote, HandLike, Life, LifeApp, LifeWorld, PointLike, SayOptions, SoundHandle, SoundKind } from './types';
import { PIP_VOICE, voiceProfile } from './voice';

export type * from './types';
export { SPECIES_PLAN, TRADE_GEAR, planFor } from './species';
export { voiceProfile, syllablePlan } from './voice';
export { planBuild } from './build-plan';

const FLOCK_SIZE = 7;
const tA = new Vector3();
const tB = new Vector3();

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

  const ground = (x: number, z: number, fallback = 0): number => {
    const h = world.heightAt?.(x, z);
    return Number.isFinite(h) ? (h as number) : fallback;
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
  for (let i = 0; i < FLOCK_SIZE; i++) flock.push(new BirdAgent(false, i, 1.25));
  const allBirds = [pipAgent, ...flock];
  for (const b of allBirds) root.add(b.object);
  const perches: Vector3[] = [];
  const refreshPerches = (): void => {
    perches.length = 0;
    const list = world.perches?.() ?? [];
    for (const p of list) {
      const v = readPoint(p, new Vector3(), ground);
      if (v) perches.push(v);
    }
  };
  const flockEnv: FlockEnv = { head, headFwd, center, radius: world.radius ?? 12, time: 0, night: 0, perches };

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
    say(text: string, opts?: SayOptions): Promise<void> {
      return speech.say(pipSpeaker, text, opts);
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
    const dock = readPoint(world.pier, tA, ground);
    if (!dock) return out.set(0, 0, -1);
    out.copy(dock).sub(center).setY(0);
    if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
    return out.normalize();
  }

  const cloudY = (): number => {
    const c = (world as { cloudY?: number }).cloudY;
    return Number.isFinite(c) ? (c as number) : center.y - 3;
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
    world.root.getWorldPosition(center);
    for (const b of allBirds) b.update(dt, flockEnv, flock);
    for (const s of [...scenes]) if (!s.update(dt)) scenes.splice(scenes.indexOf(s), 1);
    daily.update(dt);
    for (const a of agents.values()) a.update(dt, clock, head, ground);
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
      const dock = readPoint(world.pier, new Vector3(), ground) ?? center.clone().add(new Vector3(0, 0, -6));
      const out = pierOut(new Vector3());
      const landing = dock.clone().addScaledVector(out, -1.0);
      landing.y = ground(landing.x, landing.z, dock.y);
      const arrival = new Arrival(
        { root, audio, fx, dock, out, landing, head: () => head, greeters: flock.slice(0, 3), cloudY: cloudY() },
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
      a.model.mesh.geometry.dispose();
      agents.delete(id);
      speakers.delete(id);
      homes.delete(id);
    },
    walkTo(id: string, p: PointLike): Promise<void> {
      const a = agents.get(id);
      const to = readPoint(p, new Vector3(), ground);
      if (!a || !to) return Promise.resolve();
      manual(id, 60);
      return new Promise<void>((resolve) => a.walk(route(a.pos, to), resolve));
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
    setTime,
    update,
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
        triangles += a.model.rig.triangles;
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
