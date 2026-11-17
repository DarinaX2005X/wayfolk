/**
 * Things two people can do that one cannot. When a friend visits live (src/live/):
 *
 *   bridge    the friend's own island drifts in from the horizon and docks beside this
 *             one; each holds an end of a rope across the gap and the flocks of both
 *             islands lay planks only while both hold; then the islands are neighbours
 *             for good (bridge.ts);
 *   duet      two sets of wind chimes by the campfire, one each; notes agree, and the
 *             island answers both far more than either alone (duet.ts);
 *   lanterns  each lets a lantern go; twins meet in the sky and become a constellation
 *             with both names, kept in the night sky of both islands (lanterns.ts);
 *   five      palms meet: the birds burst into a spiral, a warm chord, and a postcard of
 *             the two of them (five.ts).
 *
 *   const together = createTogether({ world, life, mind, live, app });
 *   together.actions();          // what is possible now, as menu entries
 *   await together.act('duet');  // open the chimes, let a lantern go, …
 *
 * Everything works by hands in the headset and by mouse in a page: clicks on the canvas
 * (app.canvas) and the hands (app.hands) are read here. Live events are listed in
 * events.ts; the host decides what needs one decision. What stays (bridges, stars) is
 * kept in records.ts. Without a friend, the bridges and stars made before still show.
 */
import { Group, Raycaster, Vector2, Vector3, type Camera, type Object3D, type Ray, type WebGLRenderer, type Scene } from '@iwsdk/core';
import type { IslandState } from '../mind/types';
import { Workers } from './birds';
import { BRIDGE_LINES, DRIFT_S, Neighbour } from './bridge';
import type { Ctx, LifeLike, MindLike, Person, WorldLike } from './context';
import { DUET_LINES, Duet } from './duet';
import { TG, cleanPayload, type TgKind, type TgPayloads, type V3 } from './events';
import { Five } from './five';
import { LANTERN_LINES, Lanterns } from './lanterns';
import { BridgeRun } from './plan';
import { addBridge, addStar, emptyRecord, freeSlot, loadRecord, mergeRecords, saveRecord, stateRecord, summarize, writeStateRecord, type NeighbourIsland, type SlotId, type StarRecord, type StorageLike, type TogetherRecord } from './records';
import { createSound } from './sound';

export { TG, TG_KINDS, cleanPayload } from './events';
export type { TgKind, TgPayloads } from './events';
export * from './records';
export { SLOTS, BridgeRun, duetPulse, constellation, plankOrder, isHighFive } from './plan';
export { BRIDGE_LINES } from './bridge';
export { DUET_LINES } from './duet';
export { LANTERN_LINES } from './lanterns';
export { FIVE_LINES } from './five';

type Side = 'left' | 'right';

/** A tracked hand as the app reads it (src/app/hands/hands.ts HandState fits). World space. */
export interface TogetherHand {
  tracked: boolean;
  pinching: boolean;
  palm: Vector3;
  indexTip: Vector3;
  thumbTip?: Vector3;
  rayOrigin?: Vector3;
  rayDir?: Vector3;
}

/** What createTogether needs from the app. Only `camera` is required. */
export interface TogetherApp {
  camera: Camera;
  /** Per-frame hook (dt seconds); without it, call together.update(dt) every frame. */
  everyFrame?(fn: (dt: number, now: number) => void): () => void;
  /** The canvas: clicks and holds on the rope, the chimes and the friend are read from it. */
  canvas?: HTMLElement | null;
  /** The hands in the headset (src/app/hands/hands.ts fits). */
  hands?: { get(side: Side): TogetherHand };
  /** The app's glide to a world point facing `yaw` (src/app/hands/glide.ts `toPoint` fits). */
  glide?(p: Vector3, yaw: number): Promise<void> | void;
  /** Pip says a line, captioned. */
  pipSay?(text: string): Promise<void> | void;
  /** A card with a picture and a link (src/app/postcard.ts `showCard` fits). */
  postcard?: { showCard(title: string, url: string, image?: string): void };
  /** The link a postcard carries; default the page address. */
  link?(): string;
  /** For the high-five postcard: the renderer and the whole scene. */
  renderer?: WebGLRenderer | null;
  scene?: Scene | Object3D | null;
  storage?: StorageLike;
  /** Whether the person is in the headset now; default renderer.xr.isPresenting. */
  immersive?(): boolean;
  /** Offers choices as reply bubbles and resolves with the one picked (src/app replies.show fits). */
  choose?(options: string[]): Promise<string | null | undefined>;
}

/** The parts of src/live used here (createLive's Live fits). */
export interface LiveLike {
  readonly role?: 'host' | 'guest' | null;
  readonly me?: { id: string; name: string; color: string } | null;
  readonly peers?: readonly { id: string; name: string; color: string; role: 'host' | 'guest' }[] | unknown;
  readonly state?: unknown;
  send(kind: string, data?: unknown, opts?: { to?: string }): unknown;
  on(kind: string, fn: (...args: never[]) => void): (() => void) | void;
  avatarOf?(peerId: string): Object3D | null;
}

export type TogetherAction = 'bridge' | 'duet' | 'lanterns' | 'five';

export interface Together {
  /** The app's menu hook (src/app/flow.ts Together): a friend is here and something can be done. */
  available(): boolean;
  /** The one entry in Pip's menu while a friend is here. */
  readonly label: string;
  /** Picked from Pip's menu: offers what the two can do (app.choose) and does it. */
  open(): Promise<void>;
  /** A guest has just arrived on the friend's island (called once by the app). */
  joined(): Promise<void>;
  /** Everything of this module, a child of world.root. */
  readonly root: Group;
  /** The friend here live (the host for a guest, the first guest for a host). */
  readonly friend: (Person & { id: string }) | null;
  /** This person's own record: their island's bridges and stars. */
  readonly record: TogetherRecord;
  readonly neighbours: readonly Neighbour[];
  readonly duetOpen: boolean;
  /** True while my end of the bridge rope is held (the app keeps its own pinch moves away). */
  readonly holding: boolean;
  /**
   * Would a pinch or a click along this ray (or with a fingertip here) be taken by
   * something of ours: my rope end, a chime, the friend? The app asks before it uses the
   * pinch for moving about.
   */
  wants(ray: Ray | null, tip?: Vector3 | null): boolean;
  /** The last high-five postcard, a JPEG data URL. */
  readonly lastPostcard: string | null;
  /** What two people can do now, as menu entries (empty without a friend). */
  actions(): { id: TogetherAction; label: string }[];
  act(id: TogetherAction): Promise<void>;
  /** Holds (or lets go of) my end of the bridge rope. */
  hold(on: boolean): Promise<void>;
  /** Opens or closes the chimes by the fire (toggles without an argument). */
  duet(on?: boolean): Promise<void>;
  /** Strikes tube i (0..4, low to high) of my chimes (keys 1 to 5 do it in a page). */
  chime(i: number): void;
  /** Lets my lantern go. */
  lantern(): void;
  /** A page's high five: raise my hand, or meet the friend's. */
  highFive(): void;
  /** Guest: the host's island as it arrived (the app may call this from its visit flow). */
  visiting(state: IslandState | null): void;
  /** A click or a pinch along a ray (world space), for apps that forward input; true when used. */
  pointer(ray: Ray, down: boolean): boolean;
  update(dt: number): void;
  dispose(): void;
}

export interface TogetherModules {
  world: WorldLike & { ready?: Promise<unknown> };
  life?: LifeLike | null;
  mind?: MindLike | null;
  live?: LiveLike | null;
  app: TogetherApp;
}

const sideOf = (role: 'host' | 'guest' | null): 'near' | 'far' => (role === 'guest' ? 'far' : 'near');

export function createTogether(mods: TogetherModules): Together {
  const { world, app } = mods;
  const life = mods.life ?? null;
  const mind = mods.mind ?? null;
  const live = mods.live ?? null;
  const root = new Group();
  root.name = 'together';
  world.root.add(root);
  const storage: StorageLike = app.storage !== undefined ? app.storage : safeLocalStorage();
  const now = (): number => performance.now();
  const sound = createSound(() => life?.audio ?? null);

  let shownState: IslandState | null = null;
  let ownLoaded = false;
  let record: TogetherRecord = emptyRecord();
  let recordId = '';
  const said = new Map<string, number>();
  const tmp = new Vector3();

  const peers = (): { id: string; name: string; color: string; role: 'host' | 'guest' }[] => {
    const p = live?.peers;
    return Array.isArray(p) ? (p as { id: string; name: string; color: string; role: 'host' | 'guest' }[]) : [];
  };
  const role = (): 'host' | 'guest' | null => {
    const r = live?.role ?? null;
    return r && live?.state === 'live' ? r : r && peers().length ? r : null;
  };
  const friend = (): (Person & { id: string }) | null => {
    const r = live?.role;
    if (!r) return null;
    const f = peers().find((p) => p.role !== r) ?? (r === 'host' ? peers()[0] : undefined);
    return f ? { id: f.id, name: f.name, color: f.color } : null;
  };
  const me = (): Person => ({ name: live?.me?.name ?? 'You', color: live?.me?.color ?? '#e9825f' });

  const ctx: Ctx = {
    root,
    world,
    life,
    sound,
    camera: app.camera,
    role,
    me,
    friend,
    send(kind, data) {
      try {
        if (role()) live?.send(kind, data);
      } catch (error) {
        console.warn('[together] event not sent', kind, error);
      }
    },
    head(out) {
      app.camera.updateWorldMatrix(true, false);
      app.camera.getWorldPosition(out);
      return world.root.worldToLocal(out);
    },
    look(out) {
      app.camera.getWorldDirection(out);
      const q = world.root.getWorldQuaternion(new Group().quaternion).invert();
      return out.applyQuaternion(q).normalize();
    },
    say(text) {
      const last = said.get(text) ?? -1e9;
      if (now() - last < 15000) return;
      said.set(text, now());
      try {
        if (app.pipSay) void Promise.resolve(app.pipSay(text)).catch(() => undefined);
        else void Promise.resolve(life?.pip?.say?.(text)).catch(() => undefined);
      } catch {
        // Pip may be busy
      }
    },
    now,
    ground: (x, z) => world.groundY?.(x, z) ?? 0,
    async glide(to) {
      if (!app.glide) return;
      const p = world.root.localToWorld(to.pos.clone());
      await Promise.resolve(app.glide(p, to.rotY)).catch(() => undefined);
    },
    friendAvatar() {
      const f = friend();
      return f ? live?.avatarOf?.(f.id) ?? null : null;
    },
    immersive() {
      return app.immersive ? app.immersive() : Boolean(app.renderer?.xr?.isPresenting);
    },
    shown() {
      return role() === 'guest' ? shownState : (mind?.state ?? null);
    },
  };

  const workers = new Workers(ctx);
  const duet = new Duet(ctx);
  const lanterns = new Lanterns(ctx);
  const five = new Five(ctx, workers, { renderer: app.renderer, scene: app.scene });
  five.onPostcard = (image) => {
    const name = ctx.shown()?.name ?? 'the island';
    try {
      app.postcard?.showCard(`High five on ${name}`, app.link?.() ?? (typeof location !== 'undefined' ? location.href : ''), image);
    } catch (error) {
      console.warn('[together] no postcard card', error);
    }
  };
  const neighbours: Neighbour[] = [];
  let building: Neighbour | null = null;
  let run: BridgeRun | null = null;
  let friendIsland: NeighbourIsland | null = null;
  const helloTo = new Set<string>();
  let dockTold = false;
  let worldReady = false;

  // ---------------------------------------------------------------- the record

  const ownState = (): IslandState | null => mind?.state ?? null;
  const ensureOwn = async (): Promise<void> => {
    // A guest's page shows the host's island; its own island is still in mind (loaded once).
    if (ownLoaded || !mind) return;
    ownLoaded = true;
    const s = mind.state;
    if (role() === 'guest' && mind.load && (!s || ((s.residents?.length ?? 0) === 0 && (s.houses?.length ?? 0) === 0))) {
      try {
        await mind.load();
      } catch {
        // a fresh island is fine
      }
    }
    loadOwnRecord();
  };
  const loadOwnRecord = (): void => {
    const id = ownState()?.id ?? 'local';
    if (id === recordId) return;
    recordId = id;
    record = mergeRecords(loadRecord(storage, id), stateRecord(ownState()));
  };
  const persist = async (): Promise<void> => {
    await ensureOwn();
    loadOwnRecord();
    saveRecord(storage, recordId, record);
    writeStateRecord(ownState(), record);
    try {
      await Promise.resolve(mind?.save?.());
    } catch {
      // the local copy is enough for now
    }
  };

  // ---------------------------------------------------------------- what is shown

  const shownRecord = (): TogetherRecord => (role() === 'guest' ? stateRecord(shownState) : record);

  const refreshShown = (): void => {
    if (!worldReady) return;
    const rec = shownRecord();
    const want = new Set(rec.bridges.map((b) => b.island.id));
    for (const n of [...neighbours]) {
      if (n === building || want.has(n.info.id)) continue;
      n.dispose();
      neighbours.splice(neighbours.indexOf(n), 1);
    }
    for (const b of rec.bridges) {
      if (neighbours.some((n) => n.info.id === b.island.id)) continue;
      if (neighbours.some((n) => n.slot.id === b.slot)) continue;
      const n = new Neighbour(ctx, b.island, b.slot, workers);
      n.complete = true;
      n.arrive(false);
      neighbours.push(n);
    }
    lanterns.clearSky();
    for (const s of rec.stars) lanterns.show(s, false);
  };

  // ---------------------------------------------------------------- meeting a friend

  const myIsland = async (): Promise<NeighbourIsland> => {
    await ensureOwn();
    return summarize(ownState(), me().name, me().color);
  };

  const greet = async (): Promise<void> => {
    const f = friend();
    if (!f || helloTo.has(f.id)) return;
    helloTo.add(f.id);
    const island = await myIsland();
    ctx.send(TG.hello, { island, built: record.bridges.map((b) => b.island.id) });
  };

  const dock = (island: NeighbourIsland, slot: SlotId, drift: boolean): Neighbour => {
    const old = neighbours.find((n) => n.info.id === island.id);
    if (old) return old;
    const n = new Neighbour(ctx, island, slot, workers);
    n.arrive(drift);
    neighbours.push(n);
    building = n;
    run = null;
    dockTold = false;
    workers.setHomes(n.A.clone(), n.B.clone());
    setTimeout(() => ctx.say(role() === 'guest' ? BRIDGE_LINES.followed : BRIDGE_LINES.drifted(island.owner)), drift ? 4000 : 0);
    return n;
  };

  const onHello = (d: TgPayloads['tg-hello']): void => {
    friendIsland = d.island;
    void greet();
    if (role() !== 'host' || !worldReady) return;
    const known = record.bridges.find((b) => b.island.id === d.island.id);
    if (known) {
      // Already neighbours: keep their island as it is now.
      known.island = d.island;
      void persist();
      return;
    }
    if (neighbours.some((n) => n.info.id === d.island.id)) return;
    const slot = freeSlot(record);
    if (!slot) return;
    // A moment after they arrive, their island follows them.
    setTimeout(() => {
      if (!friend() || neighbours.some((n) => n.info.id === d.island.id)) return;
      dock(d.island, slot, true);
      ctx.send(TG.dock, { island: d.island, slot });
    }, 3000);
  };

  // ---------------------------------------------------------------- holding the rope

  let holding = false;
  const hold = async (on: boolean): Promise<void> => {
    const b = building;
    if (!b || !b.docked || b.complete || !role()) return;
    const side = sideOf(role());
    if (on === holding) return;
    holding = on;
    if (on) {
      const spot = b.spots[side];
      if (ctx.head(tmp).setY(spot.pos.y).distanceTo(spot.pos) > 2.2) await ctx.glide(spot);
      if (!holding) return;
    }
    b.hold[side] = on;
    ctx.send(TG.hold, { on });
    sound.creak(world.root.localToWorld(b.coils[side].position.clone()), on ? 0.8 : 0.4);
    const other = side === 'near' ? 'far' : 'near';
    if (on && !b.hold[other]) ctx.say(BRIDGE_LINES.waitFriend(friend()?.name ?? 'Your friend'));
  };

  const finishBridge = (b: Neighbour, names: [string, string], otherIsland: NeighbourIsland | null): void => {
    if (b.complete) return;
    b.finishNow(true);
    holding = false;
    b.hold.near = b.hold.far = false;
    if (building === b) building = null;
    run = null;
    const other = friend()?.name ?? b.info.owner;
    ctx.say(BRIDGE_LINES.done(other));
    // Each keeps the other's island: the host keeps the friend's, the friend the host's.
    const theirs = role() === 'guest' ? otherIsland : b.info;
    if (theirs) {
      void ensureOwn().then(() => {
        loadOwnRecord();
        addBridge(record, { island: theirs, slot: role() === 'guest' ? freeSlot(record) ?? 'east' : b.slot.id, builtAt: Date.now(), names });
        void persist();
      });
    }
  };

  // ---------------------------------------------------------------- live events

  const offs: (() => void)[] = [];
  const on = <K extends TgKind>(kind: K, fn: (d: TgPayloads[K], from: { id: string } | undefined) => void): void => {
    const off = live?.on(kind, ((data: unknown, from?: { id: string }) => {
      const d = cleanPayload(kind, data);
      if (d) fn(d, from);
    }) as never);
    if (typeof off === 'function') offs.push(off);
  };
  const signal = (kind: string, fn: (...a: never[]) => void): void => {
    const off = live?.on(kind, fn as never);
    if (typeof off === 'function') offs.push(off);
  };

  // The first hello heard from someone is answered with ours (they may have missed it).
  const heard = new Set<string>();
  on(TG.hello, (d, from) => {
    if (from && !heard.has(from.id)) {
      heard.add(from.id);
      helloTo.delete(from.id);
    }
    onHello(d);
  });
  on(TG.dock, (d) => {
    if (role() !== 'guest' || !worldReady) return;
    dock(d.island, d.slot, true);
  });
  on(TG.hold, (d) => {
    const b = building;
    if (!b) return;
    const other = sideOf(role()) === 'near' ? 'far' : 'near';
    b.hold[other] = d.on;
    if (d.on && !holding) ctx.say(BRIDGE_LINES.waitYou(friend()?.name ?? 'Your friend'));
  });
  on(TG.plank, (d) => {
    if (role() !== 'guest' || !building) return;
    if (d.n === building.planksN) building.launch(d.i);
  });
  on(TG.built, (d) => {
    const b = neighbours.find((n) => n.info.id === d.bridge.island.id) ?? building;
    if (!b || role() !== 'guest') return;
    finishBridge(b, [me().name, friend()?.name ?? d.bridge.names[0]], friendIsland ?? (shownState ? summarize(shownState, friend()?.name ?? 'Friend', friend()?.color ?? '#e9825f') : null));
  });
  on(TG.duet, (d) => {
    duet.setOpen(d.on);
    if (d.on) ctx.say(DUET_LINES.open);
  });
  on(TG.chime, (d) => {
    duet.strike(duet.mine() === 'low' ? 'high' : 'low', d.i, d.v, null);
  });
  on(TG.lantern, (d) => {
    lanterns.release(new Vector3(...d.at), false);
    if (!lanterns.rising(true)) ctx.say(LANTERN_LINES.first(friend()?.name ?? 'Your friend'));
  });
  let pendingStar: StarRecord | null = null;
  on(TG.stars, (d) => {
    if (role() !== 'guest') return;
    pendingStar = d.star;
    if (!lanterns.meet()) starsMet();
  });
  on(TG.five, (d) => {
    five.fire(new Vector3(...d.at));
  });
  on(TG.offer, (d) => {
    five.friendOffer(d.on, friend()?.color ?? '#3f9e98');
  });
  signal('join', () => void greet());
  signal('peers', () => void greet());
  signal('state', ((s: unknown) => {
    if (s === 'live') void greet();
  }) as never);
  signal('snapshot', ((state: IslandState) => {
    shownState = state;
    refreshShown();
  }) as never);
  signal('leave', ((p: { id: string }) => {
    helloTo.delete(p.id);
    heard.delete(p.id);
    const b = building;
    if (b && !b.complete) {
      ctx.say(`${b.info.owner}'s island drifted home. You can finish the bridge next time.`);
      b.dispose();
      neighbours.splice(neighbours.indexOf(b), 1);
      building = null;
      run = null;
      holding = false;
    }
    five.friendOffer(false, '#3f9e98');
  }) as never);

  const starsMet = (): void => {
    const s = pendingStar;
    pendingStar = null;
    if (!s) return;
    lanterns.show(s, true);
    const [a, b] = s.names;
    ctx.say(LANTERN_LINES.met(a, b));
    void ensureOwn().then(() => {
      loadOwnRecord();
      addStar(record, s);
      void persist();
    });
  };

  // ---------------------------------------------------------------- input

  const raycaster = new Raycaster();
  const ndc = new Vector2();
  const targets = (): Object3D[] => {
    const list: Object3D[] = [];
    if (building) list.push(...building.targets());
    list.push(...duet.targets(), ...five.targets());
    const fa = ctx.friendAvatar();
    if (fa?.visible) list.push(fa);
    return list;
  };
  /** What a ray hits: my coil, a chime tube, the friend. */
  const hitAlong = (ray: Ray): { kind: 'coil' | 'chime' | 'friend'; part?: 'low' | 'high'; i?: number; point: Vector3 } | null => {
    raycaster.ray.copy(ray);
    raycaster.far = 40;
    const hits = raycaster.intersectObjects(targets(), true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !o.userData.together && !o.userData.avatar) o = o.parent;
      if (!o) continue;
      if (o.userData.avatar) return { kind: 'friend', point: h.point };
      const t = o.userData.together as { kind: string; side?: string };
      if (t.kind === 'coil') {
        if (t.side === sideOf(role())) return { kind: 'coil', point: h.point };
        continue;
      }
      // the rope itself: anyone may take hold of it, at their own end
      if (t.kind === 'rope') return { kind: 'coil', point: h.point };
      if (t.kind === 'chime') {
        const c = duet.fromHit(o, h.instanceId);
        if (c) return { kind: 'chime', part: c.part, i: c.i, point: h.point };
      }
      if (t.kind === 'mitten') return { kind: 'friend', point: h.point };
    }
    return null;
  };
  const strikeMine = (part: 'low' | 'high', i: number, v: number, push: Vector3 | null): void => {
    if (part !== duet.mine()) {
      // the friend's set is theirs to play; a touch just sways it a little
      return;
    }
    duet.strike(part, i, v, push);
    ctx.send(TG.chime, { i, v });
  };
  let pointerHold = false;
  const pointer = (ray: Ray, down: boolean): boolean => {
    if (!down) {
      if (pointerHold) {
        pointerHold = false;
        void hold(false);
        return true;
      }
      return false;
    }
    let hit = hitAlong(ray);
    if (!hit && duet.open) {
      // thin tubes: a click a few centimetres off still rings the nearest one of mine
      const local = ray.clone().applyMatrix4(world.root.matrixWorld.clone().invert());
      const i = duet.tubeNearRay(local, duet.mine(), 0.07);
      if (i !== null) hit = { kind: 'chime', part: duet.mine(), i, point: local.origin };
    }
    if (!hit) return false;
    if (hit.kind === 'coil') {
      pointerHold = true;
      void hold(true);
    } else if (hit.kind === 'chime' && hit.part !== undefined && hit.i !== undefined) {
      const push = world.root.worldToLocal(ray.direction.clone().add(world.root.getWorldPosition(new Vector3()))).normalize();
      strikeMine(hit.part, hit.i, 0.75, push);
    } else if (hit.kind === 'friend') highFive();
    return true;
  };
  const onDown = (e: PointerEvent): void => {
    const el = app.canvas;
    if (!el || ctx.immersive() || e.button !== 0) return;
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, app.camera);
    if (pointer(raycaster.ray.clone(), true)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  const onUp = (): void => {
    if (pointerHold) {
      const r = raycaster.ray.clone();
      pointer(r, false);
    }
  };
  app.canvas?.addEventListener('pointerdown', onDown, { capture: true });
  // In a page, keys 1 to 5 play my chimes while they are out.
  const onKey = (e: KeyboardEvent): void => {
    if (!duet.open || ctx.immersive() || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const i = '12345'.indexOf(e.key);
    if (i >= 0) strikeMine(duet.mine(), i, 0.8, null);
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
  if (typeof window !== 'undefined') window.addEventListener('pointerup', onUp);

  // XR hands: fingertips ring the chimes, a pinch takes the rope, palms meet for a high five.
  const pinchWas: Record<Side, boolean> = { left: false, right: false };
  const heldBy: { side: Side | null } = { side: null };
  const tipPrev: Record<Side, Vector3 | null> = { left: null, right: null };
  const tubeHit = new Map<string, number>();
  const handStep = (dt: number): { id: string; p: Vector3 }[] => {
    const palms: { id: string; p: Vector3 }[] = [];
    const hands = app.hands;
    if (!hands || !ctx.immersive()) return palms;
    for (const side of ['left', 'right'] as Side[]) {
      const h = hands.get(side);
      if (!h?.tracked) {
        tipPrev[side] = null;
        if (pinchWas[side] && heldBy.side === side) {
          heldBy.side = null;
          void hold(false);
        }
        pinchWas[side] = false;
        continue;
      }
      const palm = world.root.worldToLocal(h.palm.clone());
      palms.push({ id: side, p: palm });
      const tip = world.root.worldToLocal(h.indexTip.clone());
      const prev = tipPrev[side];
      const vel = prev ? tip.clone().sub(prev).divideScalar(Math.max(1e-3, dt)) : new Vector3();
      tipPrev[side] = tip.clone();
      if (duet.open) {
        const t = duet.tubeNear(tip, 0.035);
        if (t) {
          const key = `${t.part}:${t.i}`;
          if (now() - (tubeHit.get(key) ?? -1e9) > 220 && vel.length() > 0.08) {
            tubeHit.set(key, now());
            strikeMine(t.part, t.i, Math.min(1, 0.3 + vel.length() * 0.5), vel.clone().normalize());
          }
        }
      }
      if (h.pinching !== pinchWas[side]) {
        pinchWas[side] = h.pinching;
        if (h.pinching) {
          const b = building;
          const coil = b && !b.complete && b.docked ? b.coils[sideOf(role())] : null;
          const near = coil && coil.position.clone().setY(coil.position.y + 0.8).distanceTo(tip) < 0.35;
          if (near) {
            heldBy.side = side;
            void hold(true);
          } else if (h.rayOrigin && h.rayDir) {
            const ray = raycaster.ray.clone();
            ray.origin.copy(h.rayOrigin);
            ray.direction.copy(h.rayDir).normalize();
            const hit = hitAlong(ray);
            if (hit?.kind === 'coil') {
              heldBy.side = side;
              void hold(true);
            } else if (hit?.kind === 'chime' && hit.part !== undefined && hit.i !== undefined) strikeMine(hit.part, hit.i, 0.7, null);
          }
        } else if (heldBy.side === side) {
          heldBy.side = null;
          void hold(false);
        }
      }
    }
    // The rope end sits in the holding hand.
    const b = building;
    if (b && heldBy.side && holding) {
      const h = hands.get(heldBy.side);
      const p = world.root.worldToLocal((h.thumbTip ? h.indexTip.clone().lerp(h.thumbTip, 0.5) : h.indexTip.clone()));
      if (sideOf(role()) === 'near') b.setRopeEnds(p, null);
      else b.setRopeEnds(null, p);
    } else b?.setRopeEnds(null, null);
    return palms;
  };

  // ---------------------------------------------------------------- the actions

  const releaseLantern = (): void => {
    const at = new Vector3();
    const hands = app.hands;
    const h = ctx.immersive() ? (['right', 'left'] as Side[]).map((s) => hands?.get(s)).find((x) => x?.tracked) : undefined;
    if (h) at.copy(world.root.worldToLocal(h.palm.clone())).add(new Vector3(0, 0.12, 0));
    else {
      ctx.head(at);
      const f = ctx.look(new Vector3()).setY(0).normalize();
      at.addScaledVector(f, 0.75).add(new Vector3(0, -0.2, 0));
    }
    lanterns.release(at, true);
    ctx.send(TG.lantern, { at: at.toArray() as V3 });
    if (role() && !lanterns.rising(false)) ctx.say(LANTERN_LINES.waiting(friend()?.name ?? 'your friend'));
  };

  const highFive = (): void => {
    if (!friend()) return;
    const at = five.offer();
    if (at) {
      if (five.fire(at)) ctx.send(TG.five, { at: at.toArray() as V3 });
    } else ctx.send(TG.offer, { on: true });
  };

  const openDuet = async (want?: boolean): Promise<void> => {
    const next = want ?? !duet.open;
    duet.setOpen(next);
    ctx.send(TG.duet, { on: next });
    if (next) {
      ctx.say(DUET_LINES.open);
      const spot = duet.spots[role() === 'guest' ? 'guest' : 'host'];
      // In the headset the chimes are within reach; in a page a step back keeps them in view.
      const back = ctx.immersive() ? 0 : 0.95;
      const pos = spot.pos.clone().add(new Vector3(Math.sin(spot.rotY) * back, 0, Math.cos(spot.rotY) * back));
      await ctx.glide({ pos, rotY: spot.rotY });
    }
  };

  // ---------------------------------------------------------------- every frame

  let wasDocked = false;
  const update = (dt: number): void => {
    const step = Math.min(0.1, Math.max(0, dt));
    const r = role();
    for (const n of neighbours) n.update(step, r ? sideOf(r) : null, friend()?.color ?? '#3f9e98');
    const b = building;
    if (b?.docked && !wasDocked) {
      wasDocked = true;
      if (!dockTold) {
        dockTold = true;
        ctx.say(BRIDGE_LINES.hold);
      }
      workers.setHomes(b.A.clone(), b.B.clone());
      workers.show(3);
    }
    if (!b) wasDocked = false;
    // The host lifts the planks while both hold.
    if (b && b.docked && !b.complete && r === 'host') {
      run ??= new BridgeRun(b.planksN, b.laid.filter(Boolean).length);
      for (const i of run.step(step, b.hold.near, b.hold.far)) {
        b.launch(i);
        ctx.send(TG.plank, { i, n: b.planksN });
      }
      if (run.done && b.allLaid) {
        const f = friend();
        const names: [string, string] = [me().name, f?.name ?? b.info.owner];
        ctx.send(TG.built, { bridge: b.record(names) });
        finishBridge(b, names, null);
      }
    }
    if (b && (b.hold.near || b.hold.far) && !b.complete) workers.show(4);
    workers.update(step);
    duet.update(step, ctx.shown());
    lanterns.update(step, () => starsMet());
    // The host sees both lanterns up: they are twins; it names the constellation.
    if (r === 'host' && lanterns.rising(true) && lanterns.rising(false) && !pendingStar) {
      const meet = lanterns.meetingPoint();
      const f = friend();
      if (lanterns.meet()) {
        pendingStar = { id: `st${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, names: [me().name, f?.name ?? 'Friend'], at: Date.now(), seed: Math.floor(Math.random() * 1e9), dir: lanterns.skyDir(meet) };
        ctx.send(TG.stars, { star: pendingStar });
      }
    }
    const palms = handStep(step);
    if (friend() && palms.length) {
      const hit = five.detect(step, palms);
      if (hit && five.fire(hit)) ctx.send(TG.five, { at: hit.toArray() as V3 });
    }
    five.update(step);
  };

  const offFrame = app.everyFrame?.((dt) => update(dt)) ?? null;

  // The island's own neighbours and stars appear once the world stands.
  void Promise.resolve(world.ready)
    .catch(() => undefined)
    .then(async () => {
      worldReady = true;
      if (role() !== 'guest') {
        loadOwnRecord();
        ownLoaded = role() === 'host' || !live?.role;
      }
      refreshShown();
      if (friendIsland && role() === 'host') onHello({ island: friendIsland, built: [] });
      void greet();
    });

  const together: Together = {
    available() {
      return worldReady && friend() !== null;
    },
    get label() {
      return `Do something with ${friend()?.name ?? 'your friend'}`;
    },
    async open() {
      const list = together.actions();
      if (!list.length) return;
      if (!app.choose) {
        await together.act(list[0].id);
        return;
      }
      const pick = await app.choose([...list.map((a) => a.label), 'Not now']);
      const a = list.find((x) => x.label === pick);
      if (a) await together.act(a.id);
    },
    async joined() {
      await greet();
      const b = building;
      if (b && !b.complete) ctx.say(b.docked ? BRIDGE_LINES.hold : BRIDGE_LINES.followed);
    },
    root,
    get friend() {
      return friend();
    },
    get record() {
      return record;
    },
    get neighbours() {
      return neighbours;
    },
    get duetOpen() {
      return duet.open;
    },
    get holding() {
      return holding;
    },
    wants(ray, tip) {
      if (holding || duet.open) return true;
      const b = building;
      if (tip && b && !b.complete && b.docked) {
        const coil = b.coils[sideOf(role())];
        const local = world.root.worldToLocal(tip.clone());
        if (coil && coil.position.clone().setY(coil.position.y + 0.8).distanceTo(local) < 0.35) return true;
      }
      return ray ? hitAlong(ray) !== null : false;
    },
    get lastPostcard() {
      return five.lastPostcard;
    },
    actions() {
      const f = friend();
      if (!f) return [];
      const out: { id: TogetherAction; label: string }[] = [];
      const docked = neighbours.some((n) => n.info.id === friendIsland?.id);
      if (role() === 'host' && friendIsland && !docked && freeSlot(record)) out.push({ id: 'bridge', label: `Bring ${f.name}'s island over` });
      out.push({ id: 'duet', label: duet.open ? 'Put the chimes away' : 'Play the chimes together' });
      out.push({ id: 'lanterns', label: 'Let lanterns go together' });
      if (!ctx.immersive()) out.push({ id: 'five', label: `High five ${f.name}` });
      return out;
    },
    async act(id) {
      if (id === 'duet') await openDuet();
      else if (id === 'lanterns') releaseLantern();
      else if (id === 'five') highFive();
      else if (id === 'bridge' && friendIsland && role() === 'host') {
        const slot = freeSlot(record);
        if (slot && !neighbours.some((n) => n.info.id === friendIsland!.id)) {
          dock(friendIsland, slot, true);
          ctx.send(TG.dock, { island: friendIsland, slot });
        }
      }
    },
    hold,
    duet: openDuet,
    chime(i) {
      if (!duet.open || i < 0 || i > 4) return;
      strikeMine(duet.mine(), Math.floor(i), 0.8, null);
    },
    lantern: releaseLantern,
    highFive,
    visiting(state) {
      shownState = state;
      refreshShown();
    },
    pointer,
    update,
    dispose() {
      offFrame?.();
      for (const o of offs) o();
      app.canvas?.removeEventListener('pointerdown', onDown, { capture: true });
      if (typeof window !== 'undefined') {
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
      }
      for (const n of neighbours) n.dispose();
      duet.dispose();
      five.dispose();
      workers.dispose();
      sound.dispose();
      root.removeFromParent();
    },
  };
  (together as Together & { debug: unknown }).debug = { ctx, workers, duet, lanterns, five, neighbours, get building() { return building; }, get run() { return run; }, DRIFT_S };
  return together;
}

function safeLocalStorage(): StorageLike {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
