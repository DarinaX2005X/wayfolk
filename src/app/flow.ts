/**
 * The first minute (packet 01.4 step 5), and every later visit.
 *
 *   enter through the clouds -> Pip greets and asks for a palm -> lands on it -> a
 *   prepared traveler arrives -> a short conversation (touch or voice) -> "stay" ->
 *   point and pinch a spot -> the flock builds the house -> the window light comes on ->
 *   Pip says someone else will find the island tomorrow.
 *
 *   later visit: the island as it was -> Pip lands -> what happened while you were away.
 *
 * Every wait has a way forward without the headset (a timeout, the desk buttons), so the
 * flow finishes on any device, and never depends on a model answer: if a call fails or
 * takes too long, a prepared line takes its place.
 */
import type { HouseSpec, IslandState, Reply, Resident, WorldEvent } from '../mind/types';
import { say as caption } from '../feel/captions';
import { sound } from '../feel/sound';
import type { App } from './boot/world';
import { registerDebug } from './debug';
import type { Entry } from './entry/entry';
import type { Gifts } from './hands/gifts';
import type { Glide } from './hands/glide';
import type { Hands, Side } from './hands/hands';
import type { Placement } from './hands/place';
import type { Replies } from './hands/replies';
import { clipToWav16k, type Voice } from './hands/voice';
import type { Modules } from './modules';
import type { Postcard } from './postcard';

export type Flow = {
  run(): Promise<void>;
  /** Pip's little menu (palm up when nothing else is going on). */
  pipMenu(): Promise<void>;
  /** The side Pip sits on, if any. */
  pipSide(): Side | null;
  /** True while a scene of the flow is playing (other inputs wait). */
  busy(): boolean;
  /** A friend's island, as a guest of a live visit (or from its saved copy). */
  visit(state: IslandState): Promise<void>;
};

export const LINES = {
  hello: "Oh, you're here. I'm Pip. Hold out your hand, palm up, and I'll come down.",
  helloDesk: "Oh, you're here. I'm Pip. This is your island.",
  landed: 'There. Warm hands. Look, someone is drifting this way.',
  welcomeChoices: ['Hello there', 'Where are you headed?', 'Would you like to stay?'],
  stayNudge: 'Would you like to stay?',
  place: 'Point where their house should go, and pinch. Turn your wrist to turn it.',
  placeDesk: 'Click where their house should go.',
  built: 'The light is on. They live here now.',
  tomorrow: 'Someone else will find the island tomorrow. Come back and see who it is.',
  back: 'You came back. Let me tell you what happened.',
  quiet: 'It was quiet while you were away. Everyone slept well.',
  menu: ['Who lives here?', 'Take a postcard', 'Invite a friend', 'Head home'],
  guest: (name: string) => `This is ${name}. Your friend's folk live here. Wave, or look around.`,
  invited: 'Show this to a friend. When they open it, they will sit here with you.',
  farewell: 'Sleep well. The island will keep your seat warm.',
  leftEarly: 'They waved and drifted on. Someone else will come.',
} as const;

const HOUSE_COLORS: Record<string, { wall: string; roof: string; trim: string }> = {
  baker: { wall: '#f3dcb4', roof: '#c8553d', trim: '#8a5a3b' },
  default: { wall: '#efe2c8', roof: '#4f7cac', trim: '#8a5a3b' },
};

export function createFlow(
  app: App,
  mods: Modules,
  parts: { entry: Entry; hands: Hands; replies: Replies; placement: Placement; glide: Glide; gifts: Gifts; voice: Voice; postcard: Postcard },
): Flow {
  const { world, life, mind } = mods;
  const { entry, hands, replies, placement, glide, gifts, voice, postcard } = parts;
  const store = app.store;
  let pipOn: Side | null = null;
  let playing = false;

  const pace = (): number => Math.max(0.05, store.pace.peek());
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      app.clock.timers.set(resolve, ms * pace());
    });
  const desk = (): boolean => store.mode.peek() === 'desk';
  /** Resolves with the value, or with `fallback` after `ms` (scaled by pace). */
  const within = <T>(p: Promise<T> | T, ms: number, fallback: T): Promise<T> =>
    Promise.race([Promise.resolve(p), wait(ms).then(() => fallback)]).catch(() => fallback);

  const pipSay = async (text: string): Promise<void> => {
    try {
      await within(Promise.resolve(life.pip.say(text)), 2500 + text.length * 70, undefined);
    } catch {
      caption({ source: 'Pip', text });
    }
  };

  /** Waits for an open palm; lands Pip on it. Gives up after `ms` (Pip then hovers by the person). */
  const palm = async (ms: number): Promise<Side | null> => {
    if (desk()) return null;
    const t0 = app.clock.now();
    for (;;) {
      for (const s of ['right', 'left'] as const) {
        const h = hands.get(s);
        if (h.tracked && h.palmUp) {
          pipOn = s;
          void life.pip.landOn(hands.perch(s));
          sound.play('bloom', { at: h.palm });
          return s;
        }
      }
      if (app.clock.now() - t0 > ms * pace()) return null;
      await wait(100);
    }
  };

  const residentName = (id: string): string => mind.state?.residents?.find((r) => r.id === id)?.name ?? mind.state?.pending?.name ?? '';

  const talk = async (r: Resident, first?: string[]): Promise<boolean> => {
    store.phase.value = 'talk';
    store.talkingTo.value = r.id;
    let choices: string[] = first?.length ? first.slice(0, 3) : [...LINES.welcomeChoices];
    let turns = 0;
    voice.armed = true;
    try {
      while (turns < 5) {
        turns += 1;
        if (turns >= 3 && !choices.some((c) => /stay/i.test(c))) choices = [LINES.stayNudge, ...choices.slice(0, 2)];
        // Touch a bubble, or speak with Pip near the mouth.
        let clip: Blob | null = null;
        const spoken = new Promise<string>((resolve) => {
          const off = voice.onClip((c) => {
            clip = c;
            off();
            resolve('');
          });
        });
        const picked = await Promise.race([replies.show(choices, { side: pipOn ?? undefined }), spoken]);
        if (clip) replies.hide();
        if (picked === null && !clip) return false;
        let audio: string | undefined;
        if (clip) {
          try {
            audio = await clipToWav16k(clip);
          } catch (error) {
            console.warn('[wf] the clip could not be read', error);
          }
        }
        const input = audio ? { audio } : { text: (picked as string) || 'Hello' };
        if (input.text) caption({ source: 'You', text: input.text });
        const fallback: Reply = /stay/i.test(input.text ?? '')
          ? { text: "I'd like that very much. Show me where.", choices: [], intent: 'stay' }
          : { text: 'It is lovely up here. The clouds look like bread rising.', choices: [LINES.stayNudge, 'Tell me more', 'Safe travels'], intent: 'chat' };
        life.emote(r.id, 'talk');
        const reply = await within(mind.talk(r.id, input), 12000, { ...fallback, prepared: true });
        if (reply.heard) caption({ source: 'You', text: reply.heard });
        store.prepared.value = Boolean(r.prepared || reply.prepared);
        await within(life.say(r.id, reply.text, { name: r.name, voice: r.voice }), 2500 + reply.text.length * 70, undefined);
        if (reply.intent === 'stay') return true;
        if (reply.intent === 'leave') return false;
        choices = reply.choices?.length ? reply.choices.slice(0, 3) : [LINES.stayNudge, 'Tell me more', 'Safe travels'];
        if (/safe travels|goodbye/i.test(input.text ?? '')) return false;
      }
      return false;
    } finally {
      voice.armed = false;
      store.talkingTo.value = null;
      void within(mind.endTalk?.(r.id), 5000, undefined);
    }
  };

  const build = async (r: Resident): Promise<void> => {
    store.phase.value = 'place';
    await pipSay(desk() ? LINES.placeDesk : LINES.place);
    const spot = await placement.choose();
    store.phase.value = 'build';
    const colors = r.house?.colors ?? HOUSE_COLORS[r.trade] ?? { ...HOUSE_COLORS.default, roof: r.colors.accent };
    const spec: HouseSpec = {
      id: `h-${r.id}`,
      residentId: r.id,
      recipe: r.trade,
      pos: { x: spot.x, z: spot.z },
      rotY: spot.rotY,
      colors,
      props: r.house?.props ?? [],
      sign: r.house?.sign ?? r.name,
      builtAt: Date.now(),
    };
    tell('house-placed', { spec });
    tell('build-started', { spec });
    built.add(spec.id);
    const steps = world.buildPlan(spec);
    for (const s of steps) s.object3d.visible = false;
    await life.build(steps);
    for (const s of steps) {
      s.object3d.visible = true;
      s.object3d.position.copy(s.target.pos);
      s.object3d.quaternion.copy(s.target.quat);
      s.object3d.scale.copy(s.target.scale);
    }
    if (world.finishHouse) world.finishHouse(spec.id);
    else world.lightHouse?.(spec.id, true);
    sound.play('bloom');
    try {
      await mind.settle(r, spec);
    } catch (error) {
      console.error('[wf] the island could not remember the new house', error);
    }
    // To the door, a step aside, so the person sees both the resident and the lit window.
    const sx = Math.cos(spot.rotY);
    const sz = -Math.sin(spot.rotY);
    void Promise.resolve(life.walkTo(r.id, { x: spot.x + Math.sin(spot.rotY) * 1.8 + sx * 1.4, z: spot.z + Math.cos(spot.rotY) * 1.8 + sz * 1.4 })).catch(() => undefined);
    life.emote(r.id, 'happy');
  };

  const arrival = async (): Promise<{ traveler: Resident; choices?: string[] } | null> => {
    store.phase.value = 'arrive';
    const traveler = await within(Promise.resolve(mind.nextTraveler()), 15000, null as unknown as Resident);
    if (!traveler) return null;
    store.prepared.value = Boolean(traveler.prepared);
    tell('traveler-arrived', { resident: traveler });
    await life.arrive(traveler, traveler.vehicle);
    // The first words come at once, without a model call.
    let intro = traveler.story.intro;
    let choices: string[] | undefined;
    try {
      const g = mind.greet?.(traveler.id);
      if (g?.text) intro = g.text;
      choices = g?.choices;
    } catch {
      // The intro of the card stays.
    }
    await within(life.say(traveler.id, intro, { name: traveler.name, voice: traveler.voice }), 3000 + intro.length * 70, undefined);
    return { traveler, choices };
  };

  let ticking = false;
  const goFree = (): void => {
    store.phase.value = 'free';
    store.prepared.value = false;
    // News during the visit: trips that came back, mail, guests.
    if (!ticking && mind.tick) {
      ticking = true;
      app.clock.timers.set(function next() {
        void within(mind.tick!(Date.now()), 8000, [] as WorldEvent[]).then(async (events) => {
          if (store.phase.peek() === 'free' && !playing) for (const e of events.slice(0, 2)) await pipSay(e.text);
          if (events.length) void within(mind.seen?.(events), 4000, undefined);
          app.clock.timers.set(next, 60_000);
        });
      }, 60_000);
    }
    glide.enable(true);
    gifts.setUp();
    gifts.enable(true);
    postcard.enable(true);
    try {
      life.startDaily();
    } catch (error) {
      console.error('[wf] daily life did not start', error);
    }
  };

  const loadIsland = (state: IslandState = mind.state): void => {
    for (const h of state?.houses ?? []) {
      try {
        world.addHouse(h);
      } catch (error) {
        console.error('[wf] a saved house could not be placed', error);
      }
    }
    for (const r of state?.residents ?? []) {
      const h = state.houses.find((x) => x.id === r.houseId);
      life.spawn(r, h ? { x: h.pos.x + Math.sin(h.rotY) * 2, z: h.pos.z + Math.cos(h.rotY) * 2 } : undefined);
    }
  };

  // ---- live visits: the host tells the room what happens; a guest sees it happen.
  const live = mods.live;
  const hosting = (): boolean => live.role === 'host';
  const tell = (kind: string, data: unknown): void => {
    if (!hosting()) return;
    try {
      live.send(kind, data);
    } catch (error) {
      console.warn('[wf] live event not sent', error);
    }
  };
  const built = new Set<string>();
  const guestBuild = async (spec: HouseSpec): Promise<void> => {
    if (built.has(spec.id)) return;
    built.add(spec.id);
    tell('house-placed', { spec });
    tell('build-started', { spec });
    built.add(spec.id);
    const steps = world.buildPlan(spec);
    for (const s of steps) s.object3d.visible = false;
    await life.build(steps);
    for (const s of steps) {
      s.object3d.visible = true;
      s.object3d.position.copy(s.target.pos);
      s.object3d.quaternion.copy(s.target.quat);
      s.object3d.scale.copy(s.target.scale);
    }
    world.finishHouse?.(spec.id);
  };
  const guestOnly = <T,>(fn: (data: T) => void) => (data: T) => {
    if (live.role === 'guest') fn(data);
  };
  live.on('build-started', guestOnly<{ spec: HouseSpec }>((d) => void guestBuild(d.spec)));
  live.on('house-placed', guestOnly<{ spec: HouseSpec }>((d) => void guestBuild(d.spec)));
  live.on('traveler-arrived', guestOnly<{ resident: Resident }>((d) => void life.arrive(d.resident, d.resident.vehicle)));
  live.on('say', guestOnly<{ text: string; residentId?: string }>((d) => {
    if (d.residentId) void life.say(d.residentId, d.text);
    else caption({ source: 'Friend', text: d.text });
  }));
  live.on('state', ((_s: unknown, _r: unknown, message: string | null) => {
    if (message) void pipSay(message);
  }) as never);

  const flow: Flow = {
    pipSide: () => pipOn,
    async visit(state) {
      playing = true;
      try {
        loadIsland(state);
        for (const h of state.houses) built.add(h.id);
        store.phase.value = 'clouds';
        world.setTime(app.clock.wall());
        const spots = world.spots();
        await entry.enter(spots[1] ?? spots[0] ?? world.seat);
        store.phase.value = 'greet';
        life.pip.hover();
        await pipSay(LINES.guest(state.name || "a friend's island"));
        goFree();
      } finally {
        playing = false;
      }
    },
    busy: () => playing,
    async run() {
      playing = true;
      try {
        await within(mind.load(), 4000, null);
        if (app.params.fresh) await within(mind.reset?.(), 4000, null);
        const later = (mind.state?.residents?.length ?? 0) > 0 || app.params.later;
        if (later) loadIsland();
        store.phase.value = 'clouds';
        world.setTime(app.clock.wall());
        await entry.enter();
        store.phase.value = 'greet';
        life.pip.hover();
        if (later) {
          const side = await palm(5000);
          void side;
          store.phase.value = 'news';
          await pipSay(LINES.back);
          const events = await within(Promise.resolve(mind.whileAway(Date.now())), 8000, []);
          if (!events.length) await pipSay(LINES.quiet);
          for (const e of events.slice(0, 3)) {
            await pipSay(e.text);
            if (e.effect?.prop && e.effect.at) world.addProp(e.effect.prop, e.effect.at);
          }
          void within(mind.seen?.(events.slice(0, 3)), 4000, undefined);
          goFree();
          return;
        }
        await pipSay(desk() ? LINES.helloDesk : LINES.hello);
        store.phase.value = 'palm';
        await palm(9000);
        await pipSay(LINES.landed);
        const came = await arrival();
        const traveler = came?.traveler;
        if (traveler) {
          const stays = await talk(traveler, came.choices);
          if (stays) {
            await build(traveler);
            store.phase.value = 'goodnight';
            await pipSay(LINES.built);
          } else {
            void within(mind.dismiss?.(traveler.id), 4000, undefined);
            await pipSay(LINES.leftEarly);
          }
        }
        store.phase.value = 'goodnight';
        await pipSay(LINES.tomorrow);
        try {
          await mind.save();
        } catch (error) {
          console.error('[wf] the island could not be saved', error);
        }
        goFree();
      } finally {
        playing = false;
      }
    },
    async pipMenu() {
      if (playing || replies.open || store.phase.peek() !== 'free') return;
      playing = true;
      try {
        const pick = await replies.show([...LINES.menu], { side: pipOn ?? undefined });
        if (pick === LINES.menu[1]) await postcard.take();
        else if (pick === LINES.menu[2]) {
          try {
            const out = await Promise.resolve(mods.live.host(mind.state.id));
            postcard.showCard('Come sit on my island', out.link);
            app.store.invite.value = out.link;
            await pipSay(LINES.invited);
          } catch (error) {
            console.warn('[wf] no invite link', error);
            await pipSay(mods.live.message ?? 'The invite did not work just now. Try again in a moment.');
          }
        } else if (pick === LINES.menu[3]) {
          store.phase.value = 'farewell';
          await pipSay(LINES.farewell);
          await entry.leave();
        } else if (pick === LINES.menu[0]) {
          const names = (mind.state?.residents ?? []).map((r) => r.name);
          await pipSay(names.length ? `${names.join(' and ')} ${names.length > 1 ? 'live' : 'lives'} here. More will come.` : 'Only us birds, for now.');
        }
      } finally {
        playing = false;
      }
    },
  };

  // Palm up with nothing else going on: Pip comes to the hand and offers the little menu.
  // The palm has to go down once before the menu opens again.
  let palmDown = true;
  app.everyFrame(() => {
    if (store.phase.peek() !== 'free' || desk()) return;
    const up = (['right', 'left'] as const).find((s) => hands.get(s).tracked && hands.get(s).palmUp);
    if (!up) {
      palmDown = true;
      return;
    }
    if (playing || !palmDown) return;
    palmDown = false;
    if (pipOn !== up) {
      pipOn = up;
      void life.pip.landOn(hands.perch(up));
    }
    void flow.pipMenu();
  });

  registerDebug('flow', { phase: () => store.phase.peek(), pipSide: () => pipOn, name: residentName });
  return flow;
}
