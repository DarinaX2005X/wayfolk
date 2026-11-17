/**
 * Puts Wayfolk together on a booted App: the modules (world, life, mind, live), the
 * person's rig, the hands, the reply bubbles, placement, glide, gifts, voice, the
 * postcard, the desk controls, the entry through the clouds and the first-minute flow.
 *
 * Start: `startWayfolk(app)` boots everything and seats the person; `begin()` runs the
 * flow (called when the person enters, or at once at the desk).
 */
import { Box3, Object3D, Ray, Raycaster, Vector3, type Mesh } from '@iwsdk/core';
import { createTogether, type Together as TogetherModule } from '../together/index';
import { effect } from '@preact/signals-core';
import { bindFeel } from '../feel/bind';
import type { App } from './boot/world';
import { debugEnabled, registerDebug, registerTest } from './debug';
import { bindDesk } from './desk/input';
import { createGuide, type Guide } from './desk/guide';
import { createDelights, type Delights } from './delights';
import { createEvening, type Evening } from './evening';
import { createVisits } from './visits';
import { createPainter } from './painter';
import { createKeyArt } from './keyart';
import { createEntry, type Entry } from './entry/entry';
import { createFlow, type Flow, type Together } from './flow';
import { createGifts, registerGiftTest } from './hands/gifts';
import { createGlide } from './hands/glide';
import { createMove } from './hands/move';
import { createHands, type Hands } from './hands/hands';
import { createPlacement } from './hands/place';
import { createReplies, type Replies } from './hands/replies';
import { createVoice, type Voice } from './hands/voice';
import { createModules, type Modules } from './modules';
import { bubbleView } from '../life/bubble';
import { inviteLink } from './name';
import { createMusic, songFor, type MusicRun } from '../feel/music';
import type { IslandState } from '../mind/types';
import { anchorPoint, type AppHandle } from './ports';
import { createPostcard, islandLink, type Postcard } from './postcard';
import { createRig, type Rig } from './rig';

export type Wayfolk = {
  mods: Modules;
  rig: Rig;
  hands: Hands;
  entry: Entry;
  flow: Flow;
  postcard: Postcard;
  replies: Replies;
  voice: Voice;
  guide: Guide;
  evening: Evening;
  delights: Delights;
  /** Runs the first minute (or the later visit); safe to call once. */
  begin(): Promise<void>;
  /** Loads the fonts and compiles every material of the scene, so the reveal does not stutter. */
  warm(): Promise<void>;
  /** The landing's key-art view: the camera drifts around the island at a distance. */
  showcase(on: boolean): void;
  /** Invites a friend: a link and QR for a live visit. */
  invite(): Promise<{ code: string; link: string } | null>;
  /** Plugs in the things two people do together (src/together/); see Flow.setTogether. */
  setTogether(t: Together | null): void;
};

export async function startWayfolk(app: App): Promise<Wayfolk> {
  const { world } = app;
  const handle: AppHandle = {
    world,
    scene: world.scene,
    camera: world.camera,
    renderer: world.renderer,
    root: app.roots.island,
    now: () => app.clock.now(),
    everyFrame: (fn) => app.everyFrame(fn),
    head: () => world.camera,
    pace: () => app.store.pace.peek(),
  };
  bindFeel(app);

  const mods = await createModules(handle);
  try {
    await Promise.race([mods.world.ready, new Promise((r) => setTimeout(r, 15000))]);
  } catch (error) {
    console.error('[wf] the world did not finish loading', error);
  }
  try {
    mods.world.setTime(app.clock.wall());
    const islands = await Promise.resolve(mods.mind.publicIslands?.() ?? []);
    mods.world.setHorizon(islands);
  } catch (error) {
    console.warn('[wf] the horizon stays empty for now', error);
  }

  const rig = createRig(app);
  rig.placeAt(mods.world.seat);

  const hands = createHands(world, () => app.clock.now());
  world.onXRFrame((frame) => {
    hands.update(frame, app.clock.now(), 1 / 72);
  });
  // Hand anchors live in the scene so Pip can sit on them.
  for (const h of [hands.left, hands.right]) app.roots.fx.add(h.anchor);

  const replies = createReplies(app, hands);
  // Typing or speaking keeps the quick-reply clouds away.
  app.store.listening.subscribe((on) => {
    if (on) replies.hold();
  });
  const placement = createPlacement(app, hands, mods.world, replies);
  let flow: Flow | null = null;
  const glide = createGlide(app, hands, mods.world, rig, replies, () => (flow?.busy() ?? true) || placement.active);
  const residents = (): { id: string; object: Object3D; name: string }[] =>
    (mods.mind.state?.residents ?? [])
      .map((r) => ({ id: r.id, name: r.name, object: mods.life.objectOf?.(r.id) as Object3D }))
      .filter((r) => r.object);
  const gifts = createGifts(app, hands, mods.life, mods.mind, replies, residents, mods.world);
  registerGiftTest(gifts);
  const voice = createVoice(app, hands, replies, () => flow?.pipSide() ?? null);
  const postcard = createPostcard(app, hands, mods.mind);
  const extras = (): Object3D[] => {
    const pip = mods.life.pip.object;
    return pip ? [pip, ...[]] : [];
  };
  const entry = createEntry(app, mods.world, rig, extras);
  const guide = createGuide(app, rig, mods.world, () => (mods.mind.state?.houses ?? []).map((h) => ({ x: h.pos.x, z: h.pos.z, r: 2.1 })));
  {
    const at = new Vector3();
    const speakerAt = (id: string): Vector3 | null => {
      const o = id === 'pip' ? mods.life.pip.object : (mods.life.objectOf?.(id) as Object3D | undefined);
      if (!o) return null;
      o.updateWorldMatrix(true, false);
      return o.getWorldPosition(at).add(new Vector3(0, id === 'pip' ? 0.05 : 0.5, 0));
    };
    (guide as unknown as { speakerAt(fn: (id: string) => Vector3 | null): void }).speakerAt(speakerAt);
    // In a page the word clouds float beside whoever is speaking.
    replies.anchorAt(() => {
      const id = app.store.speaker.peek();
      return id ? speakerAt(id) : null;
    });
  }
  const evening = createEvening(app, mods, guide, hands);
  const painter = createPainter(app, mods, guide);
  const delights = createDelights(app, mods, hands, guide, () => (flow?.busy() ?? true) || evening.playing !== null || replies.open);
  // Things two people do together while a friend is here (src/together/), made below.
  let together: TogetherModule | null = null;
  const handRay = new Ray();
  // Moving in a headset: real steps, a hop to any spot of grass, pulling yourself along.
  // Never while holding the bridge rope, at the chimes, or when the pinch is for them.
  createMove(app, hands, mods.world, glide, guide.walkable, (side) => {
    if (replies.open || replies.consumed(side) || placement.active || gifts.holding() || (flow?.busy() ?? true) || evening.playing !== null) return true;
    if (!together) return false;
    const h = hands.get(side);
    handRay.origin.copy(h.rayOrigin);
    handRay.direction.copy(h.rayDir).normalize();
    return together.wants(handRay, h.indexTip);
  });
  flow = createFlow(app, mods, {
    entry,
    hands,
    replies,
    placement,
    glide,
    gifts,
    voice,
    postcard,
    guide,
    shows: { story: (id) => evening.story(id), concert: (id) => evening.concert(id), lantern: () => delights.lantern(), paint: () => painter.paint(), dusk: () => evening.dusk(), feed: () => delights.feed() },
    readNote: () => delights.readNote(),
    star: () => delights.star(),
    visits: {
      trip: (id) => visits.trip(id),
      visit: (id) => visits.visit(id),
      peek: (id) => visits.peek(id),
      returned: (id) => visits.returned(id),
    },
  });
  const talker = flow as Flow & { say(id: string, name: string, text: string): Promise<void>; pipSay(text: string): Promise<void> };
  const visits = createVisits(app, mods, { replies, guide, glide, rig, say: (id, name, text) => talker.say(id, name, text), pipSay: (text) => talker.pipSay(text) });
  // Once the friend is here, the invite card has done its job.
  app.everyFrame(() => {
    if (app.store.invite.peek() && together?.friend) app.store.invite.value = null;
  });
  try {
    together = createTogether({
      world: mods.world as never,
      life: mods.life as never,
      mind: mods.mind as never,
      live: mods.live as never,
      app: {
        camera: world.camera,
        everyFrame: (fn) => app.everyFrame((dt, now) => fn(dt > 1 ? dt / 1000 : dt, now)),
        canvas: world.renderer.domElement,
        hands,
        glide: (p, yaw) => glide.toPoint(p, yaw),
        pipSay: (t) => talker.pipSay(t),
        choose: (o) => replies.show(o),
        postcard,
        link: () => islandLink(mods.mind.state.id),
        renderer: world.renderer,
        scene: world.scene,
        immersive: () => world.renderer.xr.isPresenting,
      },
    });
    flow.setTogether(together);
    registerDebug('together', together);
  } catch (error) {
    console.warn('[wf] the things to do together are not here', error);
  }
  bindDesk(app, rig, replies, placement, glide, guide, voice, [
    {
      objects: () => (mods.life.pip.object ? [mods.life.pip.object] : []),
      pick: () => {
        app.store.pipUsed.value = true;
        guide.cue(null);
        void flow?.pokePip();
      },
      radius: 70,
    },
    {
      objects: () => residents().map((r) => r.object),
      pick: (object) => {
        const r = residents().find((x) => x.object === object);
        if (r) void flow?.meet(r.id);
      },
    },
  ], () => flow?.hurry() ?? false);

  // Where Pip hovers: close by the hand in a headset; in a page further off and low to the
  // right, so he never fills an edge of the view (the page's width decides how far right).
  let hoverKey = '';
  app.everyFrame(() => {
    const setHover = mods.life.pip.setHover;
    if (!setHover) return;
    const cam = world.camera as unknown as { aspect?: number; fov?: number };
    const desk = app.store.mode.peek() === 'desk';
    const aspect = cam.aspect || 1.6;
    // The page's lens narrows on a far speaker, so the fov is part of the key.
    const key = desk ? `d${aspect.toFixed(2)}:${Math.round(cam.fov ?? 60)}` : 'xr';
    if (key === hoverKey) return;
    hoverKey = key;
    if (!desk) {
      setHover.call(mods.life.pip, { ahead: 0.7, side: 0.34, drop: 0.2 });
      return;
    }
    const halfV = ((cam.fov ?? 60) * Math.PI) / 360;
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const ahead = 1.55;
    setHover.call(mods.life.pip, { ahead, side: ahead * Math.tan(Math.min(0.46, halfH * 0.62)), drop: ahead * Math.tan(halfV) * 0.42 });
  });

  // Speech clouds in a page: larger, and kept inside the view.
  app.everyFrame(() => {
    bubbleView.page = app.store.mode.peek() === 'desk';
    bubbleView.camera = world.camera;
  });
  // While the page suggests Pip, a glowing arrow hangs over him.
  {
    let arrowed = false;
    app.everyFrame(() => {
      const want = app.store.mode.peek() === 'desk' && app.store.phase.peek() === 'free' && !app.store.pipUsed.peek() && !app.store.show.peek() && app.store.choices.peek().length === 0 && !(flow?.busy() ?? true);
      if (want === arrowed) return;
      arrowed = want;
      guide.cue(want ? guide.of(() => mods.life.pip.object, 0.16) : null);
    });
  }

  // In a page a story moves on with a click anywhere, and Esc ends a story or a song.
  {
    const canvas = world.renderer.domElement;
    let downAt: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      downAt = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', (e) => {
      if (app.store.mode.peek() !== 'desk' || !downAt) return;
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
      downAt = null;
      if (moved < 6 && evening.playing === 'story') evening.next();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && app.store.mode.peek() === 'desk' && evening.playing) evening.stop();
    });
  }

  // Re-seat when a session starts or ends (the head pose changes frame).
  let lastMode = app.store.mode.peek();
  effect(() => {
    const mode = app.store.mode.value;
    if (mode !== lastMode) {
      lastMode = mode;
      setTimeout(() => {
        if (app.store.look.peek() === 'island') rig.placeAt(rig.spot.lengthSq() ? { x: rig.spot.x, y: rig.spot.y, z: rig.spot.z, rotY: rig.spotYaw } : mods.world.seat);
      }, 200);
    }
  });
  app.recenter = () => rig.placeAt(mods.world.seat);

  // In the headset: point at a neighbour and pinch to meet them (talk, a gift, a trip, a peek).
  const pointer = new Raycaster();
  hands.onPinch((side, down, h) => {
    if (!down || app.store.mode.peek() === 'desk' || replies.open || placement.active || replies.consumed(side)) return;
    if (app.store.phase.peek() !== 'free' || flow?.busy() || evening.playing) return;
    pointer.set(h.rayOrigin, h.rayDir);
    pointer.far = 14;
    let best: { d: number; id: string } | null = null;
    for (const r of residents()) {
      const hit = pointer.intersectObject(r.object, true)[0];
      if (hit && (!best || hit.distance < best.d)) best = { d: hit.distance, id: r.id };
    }
    if (best) void flow?.meet(best.id);
  });

  // From the table: a pinch near the small island goes back in.
  const near = new Vector3();
  hands.onPinch((_s, down, h) => {
    if (!down || app.store.look.peek() !== 'table') return;
    mods.world.root.getWorldPosition(near);
    if (near.distanceTo(h.indexTip) < 0.5) void entry.back();
  });

  // Live visits: join from ?live=<code>&island=<id> once inside.
  const query = new URLSearchParams(location.search);
  const liveCode = query.get('live');
  const liveIsland = query.get('island');
  // Voice notes to friends: the talk gesture works outside conversations while live.
  app.everyFrame(() => {
    if (app.store.talkingTo.peek()) return;
    const liveState = (mods.live as { state?: unknown }).state;
    voice.armed = app.store.phase.peek() === 'free' && liveState === 'live';
  });
  // A pinch hurries a long line, an arrival or a build (DESIGN «Движение»).
  hands.onPinch((side, down) => {
    if (!down || replies.consumed(side) || placement.active || replies.open) return;
    flow?.hurry();
  });
  // Life's sounds and the wind in the grass start with the first gesture, like the rest.
  // The island's ambience (wind, sea, birds, the fire; src/world/) follows the head.
  type Ambience = { update(x: number, z: number, yaw?: number): void; setVolume?(v: number): void };
  const ambienceMods = import.meta.glob('../world/index.ts') as Record<string, () => Promise<{ createAmbience?: (ctx: AudioContext, dest: AudioNode) => Ambience }>>;
  let ambience: Ambience | null = null;
  let bedStarted = false;
  const resume = (): void => {
    const ctx = (mods.life as { audio?: AudioContext | null }).audio;
    void ctx?.resume?.();
    const load = Object.values(ambienceMods)[0];
    if (ctx && load && !ambience) {
      void load()
        .then((m) => {
          ambience ??= m.createAmbience?.(ctx, ctx.destination) ?? null;
          // The island's bed sits under everything else.
          ambience?.setVolume?.(0.6);
        })
        .catch(() => undefined);
    }
    if (ctx && !bedStarted) {
      bedStarted = true;
      startBed(ctx);
    }
  };
  // A soft musical bed by the hour: a short tune now and then, with long quiet between,
  // never while someone talks, a story plays or a song is on.
  const startBed = (ctx: AudioContext): void => {
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(ctx.destination);
    let run: MusicRun | null = null;
    const next = (ms: number): void => {
      app.clock.timers.set(() => {
        const quiet = !app.store.show.peek() && !app.store.talkingTo.peek() && app.store.phase.peek() === 'free';
        if (!quiet || !app.store.settings.peek().sound) {
          next(20000);
          return;
        }
        const hour = (mods.world as { sky?: { hour?: number } }).sky?.hour ?? app.clock.wall().getHours();
        const trade = hour < 9 ? 'gardener' : hour < 17 ? 'baker' : hour < 21 ? 'storyteller' : 'stargazer';
        run = createMusic(ctx, bus).play(songFor(Math.floor(Math.random() * 100000), trade, 'story'), { volume: 0.06 });
        void run.done.then(() => {
          run = null;
          next(50000 + Math.random() * 60000);
        });
      }, ms);
    };
    // Hush the bed the moment a scene with its own music begins.
    app.store.show.subscribe((s) => {
      if (s && run) run.stop();
    });
    next(25000);
  };
  const ear = new Vector3();
  const look = new Vector3();
  app.clock.timers.set(function listen() {
    if (ambience) {
      world.camera.getWorldPosition(ear);
      world.camera.getWorldDirection(look);
      ambience.update(ear.x, ear.z, Math.atan2(-look.x, -look.z));
    }
    app.clock.timers.set(listen, 250);
  }, 250);
  window.addEventListener('pointerup', resume, { once: true });
  app.store.mode.subscribe((m) => {
    if (m !== 'desk') resume();
  });
  voice.onClip((clip) => {
    if (!app.store.talkingTo.peek()) {
      try {
        mods.live.sendVoice?.(clip);
      } catch (error) {
        console.warn('[wf] the voice note did not go', error);
      }
    }
  });

  // The landing view: a slow drift around the island, a little above it.
  let showing = false;
  const centre = new Vector3();
  let span = 0;
  const measureIsland = (): void => {
    const box = new Box3();
    mods.world.root.updateMatrixWorld(true);
    // The world's ground mesh is the island itself; without it, every mesh smaller than the sky.
    const ground = (mods.world as { ground?: Mesh }).ground;
    if (ground?.isMesh) box.setFromObject(ground);
    else mods.world.root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || !m.visible) return;
      m.geometry.computeBoundingSphere?.();
      const r = (m.geometry.boundingSphere?.radius ?? 0) * o.getWorldScale(new Vector3()).x;
      if (r < 40) box.expandByObject(m);
    });
    if (box.isEmpty()) {
      centre.set(0, 0, 0);
      span = 30;
    } else {
      box.getCenter(centre);
      span = Math.max(14, Math.min(60, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z)));
    }
  };
  // While the landing shows the island, Pip waits on the pier.
  const perch = new Object3D();
  perch.name = 'perch:pier';
  app.roots.fx.add(perch);
  app.everyFrame((_dt, now) => {
    if (!showing || app.store.mode.peek() !== 'desk') return;
    if (!span) {
      measureIsland();
      anchorPoint(mods.world.pier, perch.position);
      perch.position.y += 0.9;
      void mods.life.pip.landOn({ object: perch, palmNormal: { x: 0, y: 1, z: 0 }, tracked: () => true });
    }
    // The drift stands still for people who asked for less motion.
    const a = 2.6 + (app.store.settings.peek().lessMotion ? 0 : (now / 1000) * 0.02);
    const cam = world.camera;
    world.player.position.set(0, 0, 0);
    world.player.rotation.set(0, 0, 0);
    // The island sits low and a little right of the middle; the sky above holds the title.
    cam.position.set(centre.x + Math.sin(a) * span * 0.72, centre.y + span * 0.16, centre.z + Math.cos(a) * span * 0.72);
    cam.lookAt(centre.x - Math.cos(a) * span * 0.08, centre.y + span * 0.13, centre.z + Math.sin(a) * span * 0.08);
  });

  let begun: Promise<void> | null = null;
  const wf: Wayfolk = {
    mods,
    rig,
    hands,
    entry,
    flow,
    postcard,
    replies,
    voice,
    guide,
    evening,
    delights,
    async warm() {
      try {
        await Promise.all([document.fonts?.load('400 32px "Atkinson Hyperlegible Next"'), document.fonts?.load('700 32px "Atkinson Hyperlegible Next"')]);
      } catch {
        // The fallback face keeps the lines.
      }
      const r = world.renderer as unknown as { compileAsync?: (s: unknown, c: unknown) => Promise<unknown>; compile: (s: unknown, c: unknown) => unknown };
      try {
        if (r.compileAsync) await r.compileAsync(world.scene, world.camera);
        else r.compile(world.scene, world.camera);
      } catch (error) {
        console.warn('[wf] shaders were not warmed', error);
      }
    },
    showcase(on) {
      showing = on;
      if (!on) rig.placeAt(mods.world.seat);
    },
    begin() {
      showing = false;
      mods.life.pip.hover();
      begun ??= (async () => {
        if (liveCode) {
          // A guest: the host's island arrives as a snapshot; without live, its saved copy.
          let state: IslandState | null = null;
          const snapshot = new Promise<IslandState | null>((resolve) => {
            const off = mods.live.on('snapshot', ((s: IslandState) => {
              if (typeof off === 'function') off();
              resolve(s);
            }) as never);
            setTimeout(() => resolve(null), 12000);
          });
          try {
            await Promise.resolve(mods.live.join(liveCode));
            state = await snapshot;
          } catch (error) {
            console.warn('[wf] could not join the live visit', error);
          }
          if (!state && liveIsland && mods.mind.visit) {
            try {
              state = await mods.mind.visit(liveIsland);
            } catch (error) {
              console.warn("[wf] the friend's island could not be read", error);
            }
          }
          if (state) {
            await flow!.visit(state);
            return;
          }
        }
        await flow!.run();
      })().catch((error: unknown) => {
        console.error('[wf] the first minute stopped', error);
      });
      return begun;
    },
    setTogether(t) {
      flow?.setTogether(t);
    },
    async invite() {
      try {
        const out = await Promise.resolve(mods.live.host(mods.mind.state.id));
        const link = inviteLink(out.link, mods.mind.state?.name);
        if (app.store.mode.peek() !== 'desk') postcard.showCard('Come sit on my island', link);
        app.store.invite.value = link;
        return out;
      } catch (error) {
        console.warn('[wf] no invite link', error);
        return null;
      }
    },
  };
  registerDebug('wf', wf);
  // When each phase began, seconds since the page started (first-minute timing in scenarios).
  const phases: { phase: string; at: number }[] = [];
  app.store.phase.subscribe((phase) => phases.push({ phase, at: Math.round(performance.now() / 100) / 10 }));
  registerDebug('phases', phases);
  if (debugEnabled()) createKeyArt(app, mods, { rig, guide, evening, showcase: (on) => wf.showcase(on) });
  registerTest('begin', () => wf.begin());
  registerTest('leave', () => entry.leave());
  registerTest('back', () => entry.back());
  registerTest('menu', () => flow!.pipMenu());
  // Scenarios: an island that already has neighbours (prepared travelers in real houses),
  // so the evening and the later visit can be checked without the first minute.
  registerTest('seed', async (count = 2, ids?: string[]) => {
    const { PREPARED } = await import('../mind/prepared');
    const picks = ids?.length ? PREPARED.filter((p) => ids.includes(p.id)) : PREPARED.filter((p) => ['p-musician-fox', 'p-tea-maker-hedgehog', 'p-fisher-otter'].includes(p.id));
    let i = 0;
    for (const p of picks.slice(0, count)) {
      const spot = mods.world.suggestSpot?.();
      if (!spot?.ok) break;
      const r = { ...structuredClone(p), arrivedAt: Date.now(), prepared: true };
      const spec = { id: `h-${r.id}`, residentId: r.id, recipe: r.trade, pos: { x: spot.snapped.x, z: spot.snapped.z }, rotY: spot.rotY, colors: r.house?.colors ?? { wall: '#efe2c8', roof: r.colors.accent, trim: '#8a5a3b' }, props: r.house?.props ?? [], sign: r.house?.sign ?? r.name, builtAt: Date.now() };
      // Placed for a moment so the next suggestion keeps its distance; the visit loads them for real.
      mods.world.addHouse(spec);
      await mods.mind.settle(r, spec);
      i += 1;
    }
    for (const h of mods.mind.state.houses) (mods.world as { removeHouse?: (id: string) => void }).removeHouse?.(h.id);
    await mods.mind.save();
    return i;
  });
  app.ready.value = true;
  return wf;
}
