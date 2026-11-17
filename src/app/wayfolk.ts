/**
 * Puts Wayfolk together on a booted App: the modules (world, life, mind, live), the
 * person's rig, the hands, the reply bubbles, placement, glide, gifts, voice, the
 * postcard, the desk controls, the entry through the clouds and the first-minute flow.
 *
 * Start: `startWayfolk(app)` boots everything and seats the person; `begin()` runs the
 * flow (called when the person enters, or at once at the desk).
 */
import { Box3, Object3D, Vector3, type Mesh } from '@iwsdk/core';
import { effect } from '@preact/signals-core';
import { bindFeel } from '../feel/bind';
import type { App } from './boot/world';
import { registerDebug, registerTest } from './debug';
import { bindDesk } from './desk';
import { createEntry, type Entry } from './entry/entry';
import { createFlow, type Flow } from './flow';
import { createGifts, registerGiftTest } from './hands/gifts';
import { createGlide } from './hands/glide';
import { createHands, type Hands } from './hands/hands';
import { createPlacement } from './hands/place';
import { createReplies, type Replies } from './hands/replies';
import { createVoice } from './hands/voice';
import { createModules, type Modules } from './modules';
import type { IslandState } from '../mind/types';
import { anchorPoint, type AppHandle } from './ports';
import { createPostcard, type Postcard } from './postcard';
import { createRig, type Rig } from './rig';

export type Wayfolk = {
  mods: Modules;
  rig: Rig;
  hands: Hands;
  entry: Entry;
  flow: Flow;
  postcard: Postcard;
  replies: Replies;
  /** Runs the first minute (or the later visit); safe to call once. */
  begin(): Promise<void>;
  /** The landing's key-art view: the camera drifts around the island at a distance. */
  showcase(on: boolean): void;
  /** Invites a friend: a link and QR for a live visit. */
  invite(): Promise<{ code: string; link: string } | null>;
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
  const placement = createPlacement(app, hands, mods.world, replies);
  let flow: Flow | null = null;
  const glide = createGlide(app, hands, mods.world, rig, replies, () => (flow?.busy() ?? true) || placement.active);
  const residents = (): { id: string; object: Object3D; name: string }[] =>
    (mods.mind.state?.residents ?? [])
      .map((r) => ({ id: r.id, name: r.name, object: mods.life.objectOf?.(r.id) as Object3D }))
      .filter((r) => r.object);
  const gifts = createGifts(app, hands, mods.life, mods.mind, replies, residents);
  registerGiftTest(gifts);
  const voice = createVoice(app, hands, replies, () => flow?.pipSide() ?? null);
  const postcard = createPostcard(app, hands, mods.mind);
  const extras = (): Object3D[] => {
    const pip = mods.life.pip.object;
    return pip ? [pip, ...[]] : [];
  };
  const entry = createEntry(app, mods.world, rig, extras);
  flow = createFlow(app, mods, { entry, hands, replies, placement, glide, gifts, voice, postcard });
  bindDesk(app, rig, replies, placement, glide);

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
    const phase = app.store.phase.peek();
    if (phase === 'arrive' || phase === 'build' || phase === 'greet' || phase === 'goodnight') mods.life.skip?.();
  });
  // Life's sounds start with the first gesture, like the rest.
  const resume = (): void => {
    void (mods.life as { audio?: AudioContext | null }).audio?.resume?.();
  };
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
    const a = 2.6 + (now / 1000) * 0.02;
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
    async invite() {
      try {
        const out = await Promise.resolve(mods.live.host(mods.mind.state.id));
        postcard.showCard('Come sit on my island', out.link);
        app.store.invite.value = out.link;
        return out;
      } catch (error) {
        console.warn('[wf] no invite link', error);
        return null;
      }
    },
  };
  registerDebug('wf', wf);
  registerTest('begin', () => wf.begin());
  registerTest('leave', () => entry.leave());
  registerTest('back', () => entry.back());
  registerTest('menu', () => flow!.pipMenu());
  app.ready.value = true;
  return wf;
}
