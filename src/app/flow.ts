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
import { Vector3 } from '@iwsdk/core';
import type { HouseSpec, IslandState, Reply, Resident, WorldEvent } from '../mind/types';
import { say as caption } from '../feel/captions';
import { sound } from '../feel/sound';
import type { App } from './boot/world';
import { registerDebug } from './debug';
import type { Guide } from './desk/guide';
import type { Entry } from './entry/entry';
import type { Gifts } from './hands/gifts';
import type { Glide } from './hands/glide';
import type { Hands, Side } from './hands/hands';
import type { Placement } from './hands/place';
import type { Replies } from './hands/replies';
import { clipToWav16k, type Voice } from './hands/voice';
import type { Modules } from './modules';
import type { Postcard } from './postcard';
import { inviteLink } from './name';

export type Flow = {
  run(): Promise<void>;
  /** Pip's little menu (palm up when nothing else is going on). */
  pipMenu(): Promise<void>;
  /** The side Pip sits on, if any. */
  pipSide(): Side | null;
  /** True while a scene of the flow is playing (other inputs wait). */
  busy(): boolean;
  /** Someone touched or clicked Pip. */
  pokePip(): Promise<void>;
  /** Someone touched or clicked a resident: talk, or hand them a gift. */
  meet(id: string): Promise<void>;
  /** A friend's island, as a guest of a live visit (or from its saved copy). */
  visit(state: IslandState): Promise<void>;
  /** A pinch or a click in a long moment: the line, the arrival, the walk or the build hurries on. */
  hurry(): boolean;
  /**
   * Things two people do together while a friend is on the island (src/together/): when
   * `available()` says so, Pip's menu opens with `label` first, and a friend who joins
   * hears about it once.
   */
  setTogether(t: Together | null): void;
};

export type Together = { available(): boolean; label: string; open(): Promise<void>; joined?(): Promise<void>; visiting?(state: IslandState | null): void };

export const LINES = {
  hello: "Oh, you're here. I'm Pip. Hold out your hand, palm up, and I'll come down.",
  helloDesk: "Oh, you're here. I'm Pip. This is your island.",
  helloArrive: "Oh, you're here. I'm Pip. Look, someone is drifting this way.",
  landed: 'There. Warm hands. Look, someone is drifting this way.',
  landedDesk: 'Look over there. Someone is drifting this way.',
  welcomeChoices: ['Hello there', 'Where are you headed?', 'Would you like to stay?'],
  stayNudge: 'Would you like to stay?',
  place: 'Point where their house should go, and pinch. Turn your wrist to turn it.',
  placeDesk: 'Click the grass where their house should go.',
  built: 'The light is on. They live here now.',
  tomorrow: 'Someone else will find the island tomorrow. Come back and see who it is.',
  back: 'You came back. Let me tell you what happened.',
  quiet: 'It was quiet while you were away. Everyone slept well.',
  talkHint: 'Talk to them. Lift your hand to your mouth and speak.',
  newcomer: 'And look, someone new is drifting this way.',
  menu: ['Tell us a story', 'Play us a song', 'Feed the birds', 'More'],
  more: ['Send a lantern', 'Paint the island', 'Visit an island', 'More'],
  last: ['Take a postcard', 'Invite a friend', 'Who lives here?', 'Head home'],
  meet: ['Say hello', 'Give a fruit', 'Go on a trip', 'Peek inside'],
  pipBusy: {
    greet: 'Hello again. Hold on, I am still settling in.',
    palm: 'Here I am. Someone is on their way.',
    arrive: 'Look at the pier. Someone is coming.',
    talk: 'Pick what to say in the bubbles.',
    place: 'Click a free spot of grass for the house.',
    build: 'The flock is building. Watch.',
  } as Record<string, string>,
  guest: (name: string) => `This is ${name}. Your friend's folk live here. Wave, or look around.`,
  invited: 'Show this to a friend. When they open it, they will sit here with you.',
  farewell: 'Sleep well. The island will keep your seat warm.',
  leftEarly: 'They waved and drifted on. Someone else will come.',
  eveningOffer: 'The sun is going down. Shall we light the fire?',
  dayOffer: 'Everyone is home. Shall we have a story, or a song?',
  eveningChoices: ['A story by the fire', 'Some music', 'Not now'],
  whale: 'Look up. A whale is passing over the island.',
  rain: 'Here comes a little rain. Nobody minds.',
  rainStop: 'The rain has moved on. Everything smells green.',
} as const;

const HOUSE_COLORS: Record<string, { wall: string; roof: string; trim: string }> = {
  baker: { wall: '#f3dcb4', roof: '#c8553d', trim: '#8a5a3b' },
  default: { wall: '#efe2c8', roof: '#4f7cac', trim: '#8a5a3b' },
};

export function createFlow(
  app: App,
  mods: Modules,
  parts: {
    entry: Entry;
    hands: Hands;
    replies: Replies;
    placement: Placement;
    glide: Glide;
    gifts: Gifts;
    voice: Voice;
    postcard: Postcard;
    guide: Guide;
    /** The evening story and concert, and the small delights (lantern...), when present. */
    shows?: { story(id?: string): Promise<void>; concert(id?: string): Promise<void>; lantern(): Promise<void>; paint(): Promise<void>; dusk?(): void; feed?(): Promise<void> };
    /** A neighbour reads a note from the mailbox aloud; false when there is none. */
    readNote?(): Promise<boolean>;
    /** A shooting star falls by the seat (catch it, make a wish). */
    star?(): Promise<void>;
    /** Trips, visits to islands on the horizon, peeks through windows. */
    visits?: { trip(id: string): Promise<void>; visit(id?: string): Promise<void>; peek(id: string): Promise<void>; returned(id: string): void };
  },
): Flow {
  const { world, life, mind } = mods;
  const { entry, hands, replies, placement, glide, gifts, voice, postcard, guide } = parts;
  const store = app.store;
  let pipOn: Side | null = null;
  let together: Together | null = null;
  let talkHinted = false;
  let stayIndex = -1;
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

  // Every line also goes to the captions (the browser shows them; the headset has the bubbles).
  const stand = mods.report.life === 'standin';
  const pipObject = guide.of(() => life.pip.object, 0.1);
  const residentObject = (id: string) => guide.of(() => life.objectOf?.(id), 0.45);
  const pipSay = async (text: string): Promise<void> => {
    if (!stand) caption({ source: 'Pip', text });
    store.speaker.value = 'pip';
    // Hovering by the person he is always in view; turning to him would chase him round.
    if (desk() && !store.talkingTo.peek() && life.pip.mode !== 'hover') guide.frame(pipObject);
    try {
      await within(Promise.resolve(life.pip.say(text)), 2500 + text.length * 70, undefined);
    } catch {
      // The caption already carries the line.
    }
  };
  const say = (id: string, name: string, text: string, opts: Record<string, unknown> = {}): Promise<void> => {
    if (!stand) caption({ source: name || 'Traveler', text });
    // In a conversation the last line stays up while the person answers.
    if (store.talkingTo.peek() === id) opts = { hold: 90, ...opts };
    store.speaker.value = id;
    if (desk()) guide.frame(residentObject(id), { lift: -0.15, zoom: true });
    return within(life.say(id, text, { name, ...opts }), 3000 + text.length * 70, undefined);
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

  const talk = async (r: Resident, first?: string[], nudge = true, near?: Promise<void>): Promise<boolean> => {
    if (near) {
      // Still walking up the path: wait until they stand in front of the person.
      await within(near, desk() ? 5000 : 9000, undefined);
      // Still on the way: they step out of a puff right in front, so the talk is face to face.
      if (walker === r.id) life.hurry?.(r.id);
    }
    store.phase.value = 'talk';
    store.talkingTo.value = r.id;
    if (desk()) guide.frame(residentObject(r.id), { lift: -0.15, zoom: true });
    let choices: string[] = first?.length ? first.slice(0, 3) : [...LINES.welcomeChoices];
    let turns = 0;
    let intents: string[] = [];
    voice.armed = true;
    try {
      while (turns < 5) {
        turns += 1;
        // From the second turn on, a way to ask them to stay is always on offer.
        const hasStay = choices.some((c, i) => intents[i] === 'stay' || /stay/i.test(c));
        if (nudge && turns >= 2 && !hasStay) {
          choices = [LINES.stayNudge, ...choices.slice(0, 2)];
          intents = ['stay', ...intents.slice(0, 2)];
        }
        stayIndex = choices.findIndex((c, i) => intents[i] === 'stay' || /stay/i.test(c));
        store.speaker.value = r.id;
        // Touch a bubble, or speak with Pip near the mouth.
        let clip: Blob | null = null;
        const spoken = new Promise<string>((resolve) => {
          const off = voice.onClip((c) => {
            clip = c;
            off();
            resolve('');
          });
        });
        // Talking is by voice (or typing in a page); the word clouds drift in only after a
        // quiet while, for anyone who would rather poke one.
        if (turns === 1 && !desk() && !talkHinted) {
          talkHinted = true;
          void pipSay(LINES.talkHint);
        }
        const picked = await Promise.race([replies.show(choices, { side: pipOn ?? undefined, delay: turns === 1 ? 1500 : 6500 }), spoken]);
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
        store.heard.value = input.text ?? '…';
        const fallback: Reply = /stay/i.test(input.text ?? '')
          ? { text: "I'd like that very much. Show me where.", choices: [], intent: 'stay' }
          : { text: 'It is lovely up here. The clouds look like bread rising.', choices: [LINES.stayNudge, 'Tell me more', 'Safe travels'], intent: 'chat' };
        life.emote(r.id, 'talk');
        const reply = await within(mind.talk(r.id, input), 12000, { ...fallback, prepared: true });
        if (reply.heard) caption({ source: 'You', text: reply.heard });
        if (audio) store.heard.value = reply.heard || null;
        store.prepared.value = Boolean(r.prepared || reply.prepared);
        await say(r.id, r.name, reply.text, { voice: r.voice, mood: reply.mood });
        if (reply.intent === 'stay') return true;
        if (reply.intent === 'leave') return false;
        choices = reply.choices?.length ? reply.choices.slice(0, 3) : [LINES.stayNudge, 'Tell me more', 'Safe travels'];
        intents = reply.choices?.length ? (reply.choiceIntents ?? []).slice(0, 3) : ['stay', 'chat', 'leave'];
        if (/safe travels|goodbye/i.test(input.text ?? '')) return false;
      }
      return false;
    } finally {
      voice.armed = false;
      store.talkingTo.value = null;
      store.heard.value = null;
      // The line that stayed up for the answer goes now.
      app.clock.timers.set(() => life.quiet?.(r.id), 2500);
      void within(mind.endTalk?.(r.id), 5000, undefined);
    }
  };

  const build = async (r: Resident): Promise<void> => {
    store.phase.value = 'place';
    const suggested = guide.of(() => app.roots.fx.getObjectByName('spot:suggested'), 0.2);
    const choosing = placement.choose();
    const asking = pipSay(desk() ? LINES.placeDesk : LINES.place);
    {
      const s = placement.suggest();
      const seatAt = world.root.localToWorld(((world.seat as { pos?: Vector3 }).pos ?? new Vector3()).clone());
      if (s) {
        const dir = new Vector3(s.x - seatAt.x, 0, s.z - seatAt.z);
        if (dir.lengthSq() > 1) {
          dir.normalize();
          const aside = seatAt.clone().addScaledVector(dir, 3.0).add(new Vector3(-dir.z * 1.6, 0, dir.x * 1.6));
          if (guide.walkable.ok(aside.x, aside.z)) void Promise.resolve(life.walkTo(r.id, { x: aside.x, z: aside.z }, { speed: 2 })).then(() => life.face?.(r.id)).catch(() => undefined);
        }
      }
    }
    // Pip speaks, but the view goes to the free spot, with the one thing to do there.
    if (desk()) {
      guide.frame(suggested, { lift: -0.4 });
      guide.cue(suggested, 'Click here for their house');
    }
    await asking;
    const spot = await choosing;
    guide.cue(null);
    life.quiet?.('pip');
    store.phase.value = 'build';
    const site = new Vector3(spot.x, world.groundY?.(spot.x, spot.z) ?? 0, spot.z);
    {
      // The traveler goes to watch their house go up, from part of the way there.
      const seatAt = world.root.localToWorld(((world.seat as { pos?: Vector3 }).pos ?? new Vector3()).clone());
      const dir = site.clone().sub(seatAt).setY(0);
      const len = dir.length();
      if (len > 2) {
        dir.normalize();
        const fire = (world as { fire?: Vector3 }).fire;
        const firePos = fire?.isVector3 ? world.root.localToWorld(fire.clone()) : null;
        const along = Math.min(len - 3.2, Math.max(2.6, len * 0.45));
        // On the side away from the fire pit.
        let watch = seatAt.clone().addScaledVector(dir, along).add(new Vector3(-dir.z * 1.4, 0, dir.x * 1.4));
        if (firePos && watch.distanceTo(firePos.setY(watch.y)) < 2) watch = seatAt.clone().addScaledVector(dir, along).add(new Vector3(dir.z * 1.4, 0, -dir.x * 1.4));
        if (guide.walkable.ok(watch.x, watch.z) && !(firePos && Math.hypot(watch.x - firePos.x, watch.z - firePos.z) < 2)) void Promise.resolve(life.walkTo(r.id, { x: watch.x, z: watch.z }, { speed: 2.2 })).then(() => life.face?.(r.id, site)).catch(() => undefined);
      }
    }
    if (desk()) guide.frame(() => site, { lift: 0.9 });
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

  /** A free patch of meadow in front of the seat, a little to the right, for a landing. */
  const meadowLanding = (): { x: number; z: number } | null => {
    const seat = (world.seat as { pos?: Vector3 }).pos;
    if (!seat?.isVector3) return null;
    const s = world.root.localToWorld(seat.clone());
    const fire = (world as { fire?: Vector3 }).fire;
    const f = fire?.isVector3 ? world.root.localToWorld(fire.clone()) : null;
    const tries: [number, number][] = [
      [2.8, -5.4],
      [3.6, -4.6],
      [1.6, -6.2],
      [4.4, -6.0],
      [-0.2, -6.8],
    ];
    for (const [dx, dz] of tries) {
      const x = s.x + dx;
      const z = s.z + dz;
      if (f && Math.hypot(x - f.x, z - f.z) < 3.2) continue;
      if (!guide.walkable.ok(x, z)) continue;
      // Room for the vehicle beside it: no house within reach.
      const houses = mind.state?.houses ?? [];
      if (houses.some((h) => Math.hypot(h.pos.x - x, h.pos.z - z) < 5.5)) continue;
      const v = world.validSpot({ x, z });
      if (!v.ok || Math.hypot((v.snapped?.x ?? x) - x, (v.snapped?.z ?? z) - z) > 1.5) continue;
      return { x, z };
    }
    return null;
  };
  /** The traveler walking up from the pier, while they do (a pinch or a click brings them). */
  let walker: string | null = null;
  const arrival = async (): Promise<{ traveler: Resident; choices?: string[]; near?: Promise<void> } | null> => {
    store.phase.value = 'arrive';
    const traveler = await within(Promise.resolve(mind.nextTraveler()), 15000, null as unknown as Resident);
    if (!traveler) return null;
    store.prepared.value = Boolean(traveler.prepared);
    tell('traveler-arrived', { resident: traveler });
    if (desk()) guide.frame(residentObject(traveler.id), { lift: 0.3, zoom: true });
    // Travelers land on the meadow a few steps from the person when there is room (a short
    // walk), and at the pier otherwise.
    const landAt = meadowLanding();
    const landing = Promise.resolve(life.arrive(traveler, traveler.vehicle, landAt ? { near: landAt } : undefined));
    // On the meadow they speak as they step off; from the pier, once on the path.
    await within(landing, landAt ? 6000 : 60000, undefined);
    const meet = (world.seat as { meet?: Vector3 }).meet;
    let near: Promise<void> = Promise.resolve();
    if (meet?.isVector3) {
      const to = world.root.localToWorld(meet.clone());
      walker = traveler.id;
      near = landing
        .then(() => Promise.resolve(life.walkTo(traveler.id, { x: to.x, z: to.z }, { speed: 4 })))
        .then(() => life.face?.(traveler.id))
        .catch(() => undefined)
        .finally(() => {
          if (walker === traveler.id) walker = null;
        });
    }
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
    // They introduce themselves on the way up; the replies come once they stand in front of
    // the person and the first sentences are said (the rest of the line may run on).
    // The intro stays up while the person answers it.
    const introduced = say(traveler.id, traveler.name, intro, { voice: traveler.voice, hold: 90 });
    return { traveler, choices, near: Promise.all([near, within(introduced, 6000, undefined)]).then(() => undefined) };
  };

  /** A traveler drifts in, talks, and (if asked) stays: the house goes up. True when built. */
  const welcome = async (): Promise<boolean> => {
    const came = await arrival();
    const traveler = came?.traveler;
    let builtNow = false;
    if (traveler) {
      const stays = await talk(traveler, came.choices, true, came.near);
      if (stays) {
        await build(traveler);
        builtNow = true;
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
    return builtNow;
  };

  // Scenarios drive the evening themselves; a page under automation gets no surprises.
  const automated = (): boolean => typeof navigator !== 'undefined' && navigator.webdriver === true && !/[?&]sky=1/.test(location.search);
  // ---- the evening offer: once the island has a neighbour, Pip offers a story or a song
  // once a visit, whatever the hour; the light turns to dusk as he asks.
  let offered = false;
  const offerEvening = (soon = false): void => {
    if (offered || !parts.shows || automated()) return;
    if (!(mind.state?.residents?.length ?? 0)) return;
    offered = true;
    let tries = 0;
    const ask = async (): Promise<void> => {
      if (playing || replies.open || store.phase.peek() !== 'free' || store.show.peek()) {
        if ((tries += 1) < 12) app.clock.timers.set(() => void ask(), 5000 * pace());
        return;
      }
      playing = true;
      try {
        store.speaker.value = 'pip';
        parts.shows?.dusk?.();
        void pipSay(LINES.eveningOffer);
        const pick = await replies.show([...LINES.eveningChoices], { side: pipOn ?? undefined });
        if (pick === LINES.eveningChoices[0]) await parts.shows?.story();
        else if (pick === LINES.eveningChoices[1]) await parts.shows?.concert();
      } finally {
        playing = false;
      }
    };
    app.clock.timers.set(() => void ask(), (soon ? 2500 : 9000) * pace());
  };

  // ---- the sky: now and then a whale passes, a little rain falls, a star drops.
  let skyTimer = false;
  const scheduleSky = (): void => {
    if (skyTimer || automated()) return;
    skyTimer = true;
    const W = world as { skyWhale?: () => Promise<void>; weather?: { set(kind: string): void; readonly kind: string } };
    const next = (): void => {
      app.clock.timers.set(async () => {
        next();
        if (playing || replies.open || store.phase.peek() !== 'free' || store.show.peek()) return;
        const roll = Math.random();
        try {
          if (roll < 0.4 && W.skyWhale) {
            void pipSay(LINES.whale);
            await W.skyWhale();
          } else if (roll < 0.7 && W.weather) {
            void pipSay(LINES.rain);
            W.weather.set('drizzle');
            app.clock.timers.set(() => {
              W.weather?.set('clear');
              void pipSay(LINES.rainStop);
            }, 45000);
          } else await parts.star?.();
        } catch (error) {
          console.warn('[wf] the sky event did not happen', error);
        }
      }, (150000 + Math.random() * 90000) * Math.max(0.3, pace()));
    };
    next();
  };

  const startSpot = new Vector3();
  let rigMoved = (): boolean => false;
  const markStart = (): void => {
    app.world.player.getWorldPosition(startSpot);
    rigMoved = () => app.world.player.getWorldPosition(new Vector3()).distanceTo(startSpot) > 0.5;
  };
  let ticking = false;
  const goFree = (opts: { built?: boolean } = {}): void => {
    store.phase.value = 'free';
    store.prepared.value = false;
    // News during the visit: trips that came back, mail, guests.
    if (!ticking && mind.tick) {
      ticking = true;
      app.clock.timers.set(function next() {
        void within(mind.tick!(Date.now()), 8000, [] as WorldEvent[]).then(async (events) => {
          for (const e of events) if (e.kind === 'trip-return' && e.residentId) parts.visits?.returned(e.residentId);
          if (store.phase.peek() === 'free' && !playing) for (const e of events.slice(0, 2)) await pipSay(e.text);
          if (events.length) void within(mind.seen?.(events), 4000, undefined);
          app.clock.timers.set(next, 60_000);
        });
      }, 60_000);
    }
    markStart();
    scheduleSky();
    offerEvening(opts.built);
    glide.enable(true);
    store.speaker.value = null;
    if (desk()) guide.frame(null);
    void rigMoved;
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

  const flow: Flow & { say: typeof say; pipSay: typeof pipSay } = {
    say,
    pipSay,
    pipSide: () => pipOn,
    async pokePip() {
      life.pip.emote?.('happy');
      const phase = store.phase.peek();
      if (phase === 'free') {
        await flow.pipMenu();
        return;
      }
      const line = LINES.pipBusy[phase];
      if (line && !replies.open) await pipSay(line);
    },
    async meet(id) {
      if (playing || replies.open || store.phase.peek() !== 'free') return;
      const r = mind.state?.residents?.find((x) => x.id === id);
      if (!r) return;
      playing = true;
      try {
        life.face?.(id);
        store.speaker.value = id;
        if (desk()) guide.frame(residentObject(id), { lift: -0.15 });
        const pick = await replies.show([...LINES.meet]);
        if (pick === LINES.meet[0]) {
          let first: string[] | undefined;
          try {
            const g = mind.greet?.(id);
            if (g?.text) await say(id, r.name, g.text);
            first = g?.choices;
          } catch {
            first = undefined;
          }
          await talk(r, first, false);
          store.phase.value = 'free';
        } else if (pick === LINES.meet[1]) {
          await within(gifts.give(id, 'fruit'), 14000, undefined);
        } else if (pick === LINES.meet[2]) await parts.visits?.trip(id);
        else if (pick === LINES.meet[3]) await parts.visits?.peek(id);
      } finally {
        playing = false;
      }
    },
    async visit(state) {
      playing = true;
      try {
        loadIsland(state);
        together?.visiting?.(state);
        for (const h of state.houses) built.add(h.id);
        store.phase.value = 'clouds';
        world.setTime(app.clock.wall());
        const spots = world.spots();
        await entry.enter(spots[1] ?? spots[0] ?? world.seat);
        store.phase.value = 'greet';
        life.pip.hover();
        await pipSay(LINES.guest(state.name || "a friend's island"));
        goFree();
        if (together?.available()) await together.joined?.();
      } finally {
        playing = false;
      }
    },
    busy: () => playing,
    setTogether(t) {
      together = t;
    },
    hurry() {
      const phase = store.phase.peek();
      if (!['greet', 'palm', 'arrive', 'talk', 'build', 'goodnight', 'news'].includes(phase)) return false;
      life.skip?.();
      if (walker) life.hurry?.(walker);
      return true;
    },
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
          // The next traveler is fetched while Pip tells the news, so they come at once.
          const coming = within(Promise.resolve(mind.nextTraveler()), 15000, null as unknown as Resident);
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
          // Notes from guests: one is read aloud on the way in.
          await within(parts.readNote?.() ?? false, 30000, false);
          // As Pip promised: someone new drifts in on every visit.
          await coming;
          store.speaker.value = 'pip';
          await pipSay(LINES.newcomer);
          const builtNow = await welcome();
          goFree({ built: builtNow });
          return;
        }
        if (desk()) {
          // In a page, one line from Pip and the traveler is already on the way.
          store.phase.value = 'palm';
          void pipSay(LINES.helloArrive);
          await wait(1600);
        } else {
          await pipSay(LINES.hello);
          store.phase.value = 'palm';
          await palm(9000);
          await pipSay(LINES.landed);
        }
        const builtNow = await welcome();
        goFree({ built: builtNow });
      } finally {
        playing = false;
      }
    },
    async pipMenu() {
      if (playing || replies.open || store.phase.peek() !== 'free') return;
      const lastPage = async (): Promise<void> => {
        const pick = await replies.show([...LINES.last], { side: pipOn ?? undefined });
        if (pick === LINES.last[0]) await postcard.take();
        else if (pick === LINES.last[1]) {
          try {
            const out = await Promise.resolve(mods.live.host(mind.state.id));
            // The page shows its own card with the link; the headset gets the card in the air.
            const link = inviteLink(out.link, mind.state?.name);
            if (!desk()) postcard.showCard('Come sit on my island', link);
            app.store.invite.value = link;
            await pipSay(LINES.invited);
          } catch (error) {
            console.warn('[wf] no invite link', error);
            await pipSay(mods.live.message ?? 'The invite did not work just now. Try again in a moment.');
          }
        } else if (pick === LINES.last[3]) {
          store.phase.value = 'farewell';
          await pipSay(LINES.farewell);
          await entry.leave();
        } else if (pick === LINES.last[2]) {
          const names = (mind.state?.residents ?? []).map((r) => r.name);
          await pipSay(names.length ? `${names.join(' and ')} ${names.length > 1 ? 'live' : 'lives'} here. More will come.` : 'Only us birds, for now.');
        }
      };
      const morePage = async (): Promise<void> => {
        const pick = await replies.show([...LINES.more], { side: pipOn ?? undefined });
        if (pick === LINES.more[0]) await parts.shows?.lantern();
        else if (pick === LINES.more[1]) await parts.shows?.paint();
        else if (pick === LINES.more[2]) await parts.visits?.visit();
        else if (pick === LINES.more[3]) await lastPage();
      };
      playing = true;
      // The menu clouds gather by Pip.
      store.speaker.value = 'pip';
      try {
        // With a friend here, doing something together comes first.
        const both = together?.available() ? together : null;
        const page = both ? [both.label, LINES.menu[0], LINES.menu[1], LINES.menu[3]] : [...LINES.menu];
        const first = await replies.show(page, { side: pipOn ?? undefined });
        if (both && first === both.label) await both.open();
        else if (first === LINES.menu[0]) await parts.shows?.story();
        else if (first === LINES.menu[1]) await parts.shows?.concert();
        else if (first === LINES.menu[2]) await parts.shows?.feed?.();
        else if (first === LINES.menu[3]) await morePage();
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

  registerDebug('flow', { phase: () => store.phase.peek(), pipSide: () => pipOn, name: residentName, meet: (id: string) => flow.meet(id), pokePip: () => flow.pokePip(), stayIndex: () => (store.choices.peek().length ? stayIndex : -1) });
  return flow;
}
