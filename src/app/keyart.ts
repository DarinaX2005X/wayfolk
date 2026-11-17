/**
 * Key art: still frames for the cover and the gallery, rendered from the live scene with no
 * page UI (the shot is the canvas alone, tests/keyart/shoot.mjs). Each frame sets the hour,
 * the neighbours, what happens and where the camera stands, then holds the camera there.
 *
 *   a  the island from above at golden hour, a balloon drifting in, the flock in the air
 *   b  the seated view at sunset: a neighbour talking in a paper bubble, Pip on an open palm
 *   c  the paper theatre at night beyond the campfire, the neighbours round the fire
 *   d  the flock building a house: pieces in the air, dust where they land
 *   e  the concert at sunset: rings of light, motes over the island, glowing windows
 *
 * Only on pages with debug hooks (`?keyart=1` also turns off the theatre's page overlay so
 * the neighbours by the fire stand in front of it).
 */
import { CapsuleGeometry, Group, Mesh, MeshLambertMaterial, Object3D, SphereGeometry, Vector3 } from '@iwsdk/core';
import type { HouseSpec, Resident } from '../mind/types';
import type { App } from './boot/world';
import { registerTest } from './debug';
import type { Guide } from './desk/guide';
import type { Evening } from './evening';
import type { Modules } from './modules';
import { EYE_HEIGHT, type Rig } from './rig';
import { createVehicle } from '../life/vehicles';

export type KeyArt = (kind: string) => Promise<boolean>;

type Cam = { from: Vector3; to: Vector3; fov?: number };

/** A soft cartoon hand, palm up: a rounded palm, four slightly curled fingers and a thumb. */
function makeHand(): Group {
  const skin = new MeshLambertMaterial({ color: '#f2c29c', emissive: '#4a2616' });
  const hand = new Group();
  hand.name = 'keyart:hand';
  const palm = new Mesh(new SphereGeometry(0.05, 24, 16), skin);
  palm.scale.set(0.95, 0.42, 1.12);
  hand.add(palm);
  const wrist = new Mesh(new CapsuleGeometry(0.036, 0.12, 8, 16), skin);
  wrist.rotation.x = Math.PI / 2;
  wrist.position.set(0, -0.004, 0.1);
  wrist.scale.set(1.05, 1, 0.78);
  hand.add(wrist);
  const fingers: [number, number][] = [
    [-0.03, 0.068],
    [-0.01, 0.078],
    [0.011, 0.074],
    [0.03, 0.062],
  ];
  for (const [x, len] of fingers) {
    const base = new Group();
    base.position.set(x, 0.004, -0.05);
    base.rotation.x = -0.18;
    const a = new Mesh(new CapsuleGeometry(0.0105, len * 0.5, 6, 12), skin);
    a.rotation.x = Math.PI / 2;
    a.position.z = -len * 0.28;
    base.add(a);
    const tip = new Group();
    tip.position.z = -len * 0.52;
    tip.rotation.x = 0.42;
    const b = new Mesh(new CapsuleGeometry(0.0098, len * 0.38, 6, 12), skin);
    b.rotation.x = Math.PI / 2;
    b.position.z = -len * 0.22;
    tip.add(b);
    base.add(tip);
    hand.add(base);
  }
  const thumb = new Mesh(new CapsuleGeometry(0.0125, 0.045, 6, 12), skin);
  thumb.rotation.set(Math.PI / 2, 0, 0);
  thumb.position.set(-0.058, 0.006, -0.012);
  thumb.rotation.y = 0.75;
  thumb.rotateX(-0.3);
  hand.add(thumb);
  return hand;
}

export function createKeyArt(app: App, mods: Modules, parts: { rig: Rig; guide: Guide; evening: Evening; showcase(on: boolean): void }): KeyArt {
  const { world, life, mind } = mods;
  const W = world as typeof world & {
    campfire?: (on: boolean) => void;
    fire?: Vector3;
    root: Object3D;
    house?: (id: string) => { door: Vector3; top: Vector3 } | undefined;
    seat: { pos?: Vector3; meet?: Vector3 };
    pier: { dock?: Vector3; pos?: Vector3 };
  };
  const L = life as typeof life & {
    arrive(r: Resident, v?: string): Promise<void>;
    flockObjects?: () => Object3D[];
  };
  let cam: Cam | null = null;
  // The camera stays where the frame wants it (after everything else moved it this frame).
  app.everyFrame(() => {
    if (!cam) return;
    const c = app.world.camera as unknown as { position: Vector3; lookAt(v: Vector3): void; fov: number; updateProjectionMatrix(): void; updateMatrixWorld(): void };
    app.world.player.position.set(0, 0, 0);
    app.world.player.rotation.set(0, 0, 0);
    app.world.player.updateMatrixWorld(true);
    c.position.copy(cam.from);
    c.lookAt(cam.to);
    if (cam.fov && Math.abs(c.fov - cam.fov) > 0.01) {
      c.fov = cam.fov;
      c.updateProjectionMatrix();
    }
    c.updateMatrixWorld();
  });

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const at = (h: number): Date => {
    const d = new Date(app.clock.wall());
    d.setHours(Math.floor(h), Math.round((h % 1) * 60), 0, 0);
    return d;
  };
  const local = (v: Vector3): Vector3 => W.root.localToWorld(v.clone());
  const groundAt = (x: number, z: number): number => world.groundY?.(x, z) ?? 0;

  /** A way to look at `target` from `dist` metres with no house standing between. */
  const openSide = (target: Vector3, dist: number, prefer: Vector3, skip?: string): Vector3 => {
    const homes = mind.state.houses.filter((h) => h.id !== skip).map((h) => new Vector3(h.pos.x, 0, h.pos.z));
    let best = prefer.clone().setY(0).normalize();
    let bestScore = -Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 24) {
      const dir = new Vector3(Math.sin(a), 0, Math.cos(a));
      const cam = target.clone().setY(0).addScaledVector(dir, dist);
      let clear = Infinity;
      for (const h of homes) {
        // Distance of the house from the line of sight, along the part between camera and target.
        const t0 = target.clone().setY(0);
        const seg = cam.clone().sub(t0);
        const k = Math.max(0, Math.min(1, h.clone().sub(t0).dot(seg) / seg.lengthSq()));
        clear = Math.min(clear, h.distanceTo(t0.clone().addScaledVector(seg, k)));
      }
      const score = Math.min(clear, 6) * 2 + dir.dot(best) * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = dir;
      }
    }
    return best;
  };

  const settled = new Set<string>();
  /** Neighbours with finished houses, as if they had lived here a while. */
  const neighbours = async (ids: string[], houses = true): Promise<Resident[]> => {
    const { PREPARED } = await import('../mind/prepared');
    const out: Resident[] = [];
    for (const id of ids) {
      const p = PREPARED.find((x) => x.id === id);
      if (!p) continue;
      if (settled.has(id)) {
        out.push(mind.state.residents.find((r) => r.id === id) ?? p);
        continue;
      }
      const spot = world.suggestSpot?.();
      if (!spot?.ok) break;
      const r: Resident = { ...structuredClone(p), arrivedAt: Date.now(), prepared: true };
      const spec: HouseSpec = {
        id: `h-${r.id}`,
        residentId: r.id,
        recipe: r.trade,
        pos: { x: spot.snapped.x, z: spot.snapped.z },
        rotY: spot.rotY,
        colors: r.house?.colors ?? { wall: '#efe2c8', roof: r.colors.accent, trim: '#8a5a3b' },
        props: r.house?.props ?? [],
        sign: r.house?.sign ?? r.name,
        builtAt: Date.now(),
      };
      if (houses) world.addHouse(spec);
      await mind.settle(r, spec);
      life.spawn(r, { x: spec.pos.x + Math.sin(spec.rotY) * 2, z: spec.pos.z + Math.cos(spec.rotY) * 2 });
      settled.add(id);
      out.push(r);
    }
    return out;
  };

  const prepare = (hour: number): void => {
    parts.showcase(false);
    parts.guide.manual(600000);
    parts.guide.frame(null);
    world.setTime(at(hour));
    (life as { setTime?: (d: Date) => void }).setTime?.(at(Math.min(hour, 17)));
  };

  /**
   * The covers: the person's open hand low at the right with Pip on it, the island at
   * golden hour beyond, nothing written anywhere. 1: from the porch toward the pier, two
   * neighbours waving and a balloon over the cloud sea; 2: the same, the fox in the top hat
   * close, looking up at Pip; 3: from off the island, the hand close, the island floating
   * against the low sun.
   */
  const coverScene = async (which: 1 | 2 | 3): Promise<void> => {
    prepare(18.35);
    // Their houses stay out of the cover: grass, sky and the cloud sea round the folk.
    const folk = await neighbours(['p-musician-fox', 'p-tea-maker-hedgehog', 'p-painter-frog'], false);
    (life as { stopDaily?: () => void }).stopDaily?.();
    const seat = W.seat.pos ? local(W.seat.pos) : new Vector3();
    const dock = W.pier.dock ? local(W.pier.dock) : new Vector3(24, 1, -13);
    const centre = new Vector3(1, 0, -7);
    const out = dock.clone().sub(centre).setY(0).normalize();
    const side = new Vector3(-out.z, 0, out.x);
    let from: Vector3;
    let to: Vector3;
    let fov = 52;
    if (which === 3) {
      // Off the island over the clouds, the island between the eye and the low sun.
      const sun = ((world as { sky?: { sunDir?: Vector3 } }).sky?.sunDir ?? new Vector3(0.6, 0.1, -0.8)).clone().setY(0).normalize();
      from = centre.clone().addScaledVector(sun, -30).add(new Vector3(0, 4.2, 0));
      to = centre.clone().add(new Vector3(0, 2.6, 0));
      fov = 50;
    } else {
      // A few steps down the grass from the porch, looking toward the pier and the cloud sea.
      const v = dock.clone().sub(seat).setY(0).normalize();
      const l = new Vector3(-v.z, 0, v.x);
      const stand = seat.clone().addScaledVector(v, 3.2).addScaledVector(l, -0.6);
      stand.y = groundAt(stand.x, stand.z);
      from = stand.clone().add(new Vector3(0, EYE_HEIGHT, 0));
      to = from.clone().addScaledVector(v, 10).add(new Vector3(0, -0.85, 0));
      fov = 54;
    }
    cam = { from, to, fov };
    // Camera axes, for the hand.
    const fwd = to.clone().sub(from).normalize();
    const right = new Vector3().crossVectors(fwd, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, fwd).normalize();
    const hand = makeHand();
    const near = which === 3 ? 0.4 : 0.45;
    hand.position.copy(from).addScaledVector(fwd, near).addScaledVector(right, which === 3 ? 0.15 : 0.15).addScaledVector(up, which === 3 ? -0.13 : -0.14);
    // Palm up, the fingers reaching in from the right toward the middle of the view, tilted
    // so the palm shows.
    hand.lookAt(hand.position.clone().sub(fwd).addScaledVector(right, 0.9));
    hand.rotateX(0.32);
    app.roots.fx.add(hand);
    const perch = new Object3D();
    perch.position.set(0, 0.022, 0.005);
    hand.add(perch);
    void life.pip.landOn({ object: perch, palmNormal: { x: 0, y: 1, z: 0 }, tracked: () => true });
    // Neighbours on the grass, turned to the person, waving now and then.
    const view = dock.clone().sub(seat).setY(0).normalize();
    const lat = new Vector3(-view.z, 0, view.x);
    const ahead = (k: number, s: number): Vector3 => from.clone().setY(0).addScaledVector(view, k).addScaledVector(lat, s);
    const spots: Vector3[] = which === 2 ? [ahead(1.7, -0.45), ahead(5.8, -1.5), ahead(6.8, 0.9)] : which === 1 ? [ahead(4.4, -1.1), ahead(5.6, 0.7), ahead(40, 40)] : [ahead(60, 60), ahead(61, 60), ahead(62, 60)];
    folk.forEach((r, i) => {
      const p = spots[i];
      life.spawn(r, { x: p.x, z: p.z });
    });
    // A balloon traveler drifting in over the cloud sea, in the middle band of the view.
    const balloon = createVehicle('balloon', '#e9813f', '#f3e3c3');
    if (which !== 3) {
      balloon.mesh.position.copy(dock).addScaledVector(out, 14).addScaledVector(side, 4).add(new Vector3(0, 1.8, 0));
    } else {
      balloon.mesh.position.copy(centre).addScaledVector(side, 13).add(new Vector3(0, 3.6, 0)).addScaledVector(out, 6);
    }
    balloon.mesh.rotation.y = Math.atan2(-out.x, -out.z);
    app.roots.fx.add(balloon.mesh);
    const t0 = performance.now();
    app.everyFrame(() => balloon.animate((performance.now() - t0) / 1000, 1));
    // Pip flies in from wherever he was; from off the island that takes a while.
    await wait(which === 3 ? 7000 : 2800);
    const handAt = hand.getWorldPosition(new Vector3());
    folk.forEach((r, i) => {
      if (which === 2 && i === 0) {
        // The fox looks up at Pip on the hand, quiet.
        life.face?.(r.id, handAt);
      } else {
        life.face?.(r.id);
        life.emote(r.id, 'wave');
      }
    });
    await wait(900);
  };

  const frames: Record<string, () => Promise<void>> = {
    // The island from above at golden hour, a balloon drifting in, the flock in the air.
    async a() {
      prepare(18.25);
      await neighbours(['p-tea-maker-hedgehog', 'p-painter-frog', 'p-musician-fox']);
      life.startDaily();
      const { PREPARED } = await import('../mind/prepared');
      const traveler = { ...structuredClone(PREPARED.find((p) => p.id === 'p-gardener-bear')!), arrivedAt: Date.now(), prepared: true } as Resident;
      void L.arrive(traveler, 'balloon');
      const dock = W.pier.dock ? local(W.pier.dock) : new Vector3(24, 1, -13);
      const centre = new Vector3(1, 0, -7);
      const out = dock.clone().sub(centre).setY(0).normalize();
      const side = new Vector3(-out.z, 0, out.x);
      cam = { from: dock.clone().addScaledVector(out, 15).addScaledVector(side, -7).add(new Vector3(0, 5.5, 0)), to: centre.clone().lerp(dock, 0.55).add(new Vector3(0, 1.2, 0)), fov: 50 };
      await wait(4100);
    },
    // Seated at sunset: a neighbour talks in a paper bubble, Pip sits on the open palm.
    async b() {
      prepare(19.05);
      const [r] = await neighbours(['p-musician-fox', 'p-tea-maker-hedgehog']);
      (life as { stopDaily?: () => void }).stopDaily?.();
      const seat = W.seat.pos ? local(W.seat.pos) : new Vector3();
      const eye = seat.clone().add(new Vector3(0, EYE_HEIGHT, 0));
      const meet = local(new Vector3(-0.35, 0, -1.8));
      life.spawn(r, { x: meet.x, z: meet.z });
      await wait(400);
      life.face?.(r.id, eye);
      // The hand, low at the right of the view, and Pip on it.
      const hand = makeHand();
      hand.position.copy(eye).add(new Vector3(0.15, -0.31, -0.46));
      hand.rotation.set(0.25, 0.55, 0.1);
      app.roots.fx.add(hand);
      const perch = new Object3D();
      perch.position.set(0, 0.022, 0.005);
      hand.add(perch);
      void life.pip.landOn({ object: perch, palmNormal: { x: 0, y: 1, z: 0 }, tracked: () => true });
      cam = { from: eye, to: eye.clone().add(new Vector3(-0.08, -0.24, -1.6)), fov: 60 };
      await wait(2600);
      life.emote(r.id, 'talk');
      void life.say(r.id, 'I play for the sunset most evenings. Tonight it is for you.', { name: r.name, voice: r.voice });
      await wait(2600);
    },
    // The paper theatre at night beyond the campfire, the neighbours round the fire.
    async c() {
      prepare(21.2);
      // Their houses stay out of this frame: the fire, the folk and the stage alone.
      const folk = await neighbours(['p-tea-maker-hedgehog', 'p-musician-fox', 'p-fisher-otter', 'p-painter-frog'], false);
      W.campfire?.(true);
      const fire = W.fire?.isVector3 ? local(W.fire) : new Vector3(-2.5, 0, -3.7);
      fire.y = groundAt(fire.x, fire.z);
      // From the island side of the fire, looking back over the porch to the cloud sea.
      const seat = W.seat.pos ? local(W.seat.pos) : new Vector3();
      const dir = seat.clone().sub(fire).setY(0).normalize();
      const from = fire.clone().addScaledVector(dir, -4.8).add(new Vector3(0, 2.0, 0));
      cam = { from, to: seat.clone().add(new Vector3(0, 2.6, 0)), fov: 62 };
      // The neighbours sit round the fire facing the stage.
      folk.forEach((r, i) => {
        const a = Math.atan2(dir.x, dir.z) + Math.PI + (i - (folk.length - 1) / 2) * 0.8;
        const p = fire.clone().add(new Vector3(Math.sin(a) * 1.3, 0, Math.cos(a) * 1.3));
        life.spawn(r, { x: p.x, z: p.z });
      });
      await wait(300);
      void parts.evening.story('p-tea-maker-hedgehog');
      await wait(9000);
      const g = parts.evening.stage.group;
      g.position.copy(seat).addScaledVector(dir, 5.5).setY(seat.y + 2.2);
      g.scale.setScalar(1.35);
      g.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
      for (const r of folk) life.face?.(r.id, g.position);
      cam = { from, to: g.position.clone().add(new Vector3(0, 0.6, 0)).lerp(fire, 0.36), fov: 62 };
      await wait(5200);
    },
    // The flock building a house: pieces in the air, dust where they land.
    async d() {
      prepare(16.6);
      const spot = world.suggestSpot?.();
      if (!spot?.ok) return;
      const { PREPARED } = await import('../mind/prepared');
      const r = PREPARED.find((p) => p.id === 'p-baker-fox')!;
      const spec: HouseSpec = {
        id: 'h-keyart',
        residentId: r.id,
        recipe: r.trade,
        pos: { x: spot.snapped.x, z: spot.snapped.z },
        rotY: spot.rotY,
        colors: r.house?.colors ?? { wall: '#f3dcb4', roof: '#c8553d', trim: '#8a5a3b' },
        props: r.house?.props ?? [],
        sign: r.name,
        builtAt: Date.now(),
      };
      const site = new Vector3(spec.pos.x, groundAt(spec.pos.x, spec.pos.z), spec.pos.z);
      const seat = W.seat.pos ? local(W.seat.pos) : new Vector3();
      const toSeat = seat.clone().sub(site).setY(0).normalize();
      const side = new Vector3(-toSeat.z, 0, toSeat.x);
      cam = { from: site.clone().addScaledVector(toSeat, 9).addScaledVector(side, -1.4).add(new Vector3(0, 3.8, 0)), to: site.clone().addScaledVector(toSeat, -2).add(new Vector3(0, 2.6, 0)), fov: 58 };
      const steps = world.buildPlan(spec);
      for (const s of steps) s.object3d.visible = false;
      void life.build(steps);
      await wait(2900);
    },
    // The concert at sunset: the island glows with the tune.
    async e() {
      prepare(19.15);
      await neighbours(['p-musician-fox', 'p-tea-maker-hedgehog', 'p-painter-frog', 'p-fisher-otter']);
      W.campfire?.(true);
      const fire = W.fire?.isVector3 ? local(W.fire) : new Vector3(-2.5, 0, -3.7);
      fire.y = groundAt(fire.x, fire.z);
      cam = { from: fire.clone().add(new Vector3(7.2, 3.3, 3.4)), to: fire.clone().add(new Vector3(-1.6, 1.0, -2.2)), fov: 55 };
      void parts.evening.concert('p-musician-fox');
      await wait(11000);
    },
    // ---------------------------------------------------------------- covers
    // No words anywhere: Pip on an open palm in the right foreground, golden hour, clear sky
    // in the top third for the wordmark.
    async cover1() {
      await coverScene(1);
    },
    async cover2() {
      await coverScene(2);
    },
    async cover3() {
      await coverScene(3);
    },
  };

  const keyart: KeyArt = async (kind) => {
    const run = frames[kind];
    if (!run) return false;
    await run();
    return true;
  };
  registerTest('keyart', (kind: string) => keyart(kind));
  registerTest('keyartCamera', (from: number[], to: number[], fov?: number) => {
    cam = { from: new Vector3(...from), to: new Vector3(...to), fov };
    return true;
  });
  return keyart;
}
