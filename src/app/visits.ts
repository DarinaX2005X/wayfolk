/**
 * Going places: a resident's trip to another island, the person's own visit to an
 * island on the horizon (meet its folk, leave a note in its mailbox), and a peek through
 * a neighbour's window.
 *
 *   trip    a resident picks up a bag, walks down to the pier and is gone a while; they
 *           come back with a story and a souvenir (mind.tick tells it, src/app/flow.ts);
 *   visit   the view closes, the island on the horizon is here instead of yours, its
 *           folk stand about; Pip offers to say hello, to leave a note, to go home;
 *   peek    lean to a window (or click "Peek inside"): the room glows, and what they
 *           keep there says something of their secret; some of it shows only at night.
 *
 * All choices are the reply bubbles (by the hand in the headset, beside the speaker in a
 * page), so every part works with hands and with a mouse.
 */
import { Vector3 } from '@iwsdk/core';
import { say as caption } from '../feel/captions';
import type { HouseSpec, IslandState, Resident } from '../mind/types';
import type { App } from './boot/world';
import { registerDebug, registerTest } from './debug';
import type { Guide } from './desk/guide';
import type { Glide } from './hands/glide';
import type { Replies } from './hands/replies';
import type { Modules } from './modules';
import type { Rig } from './rig';

export type Visits = {
  trip(id: string): Promise<void>;
  /** The person visits an island on the horizon (chosen in the bubbles when no id). */
  visit(islandId?: string): Promise<void>;
  peek(id: string): Promise<void>;
  /** Somewhere else right now (the island being visited). */
  readonly away: IslandState | null;
  /** A resident came back from a trip: they appear by their house again. */
  returned(id: string): void;
};

export const VISIT_LINES = {
  where: (name: string) => `Where should ${name} go?`,
  bye: (island: string) => `I will bring you something from ${island}. Keep my chair warm.`,
  gone: (name: string) => `${name} will be back in a little while with a story.`,
  noIslands: 'The sky is empty of islands just now. Maybe later.',
  pickIsland: 'Which island shall we fly to?',
  arrived: (island: string, folk: string) => `This is ${island}. ${folk || 'Nobody is home just now'}.`,
  noteChoices: ['Your island is lovely', 'Come and visit us', 'We waved from over there'],
  noteSent: 'I put it in their mailbox. They will find it when they come home.',
  home: 'Home again. It smells like our island.',
  peekNight: 'Shh. The lamp is lit. Look what is on the shelf.',
  peekDay: 'The curtains are half open.',
  peekShut: 'The curtains are drawn. Maybe come back at night.',
  menuAway: ['Say hello', 'Leave a note', 'Go home'],
} as const;

/** Night as the person sees it: the hour of the island's sky, not the clock on the wall. */
let skyHour: () => number = () => new Date().getHours();
const isNight = (): boolean => {
  const h = skyHour();
  return h >= 19 || h < 6;
};

export function createVisits(
  app: App,
  mods: Modules,
  parts: { replies: Replies; guide: Guide; glide: Glide; rig: Rig; say(id: string, name: string, text: string): Promise<void>; pipSay(text: string): Promise<void> },
): Visits {
  skyHour = () => (mods.world as { sky?: { hour?: number } }).sky?.hour ?? new Date().getHours();
  const { world, life, mind } = mods;
  const { replies, guide, glide, rig } = parts;
  const desk = (): boolean => app.store.mode.peek() === 'desk';
  const pace = (): number => Math.max(0.05, app.store.pace.peek());
  const wait = (ms: number): Promise<void> => new Promise((r) => app.clock.timers.set(r, ms * pace()));
  const within = <T>(p: Promise<T> | T, ms: number, fallback: T): Promise<T> => Promise.race([Promise.resolve(p), wait(ms).then(() => fallback)]).catch(() => fallback);
  const L = life as typeof life & { despawn?: (id: string) => void };
  let away: IslandState | null = null;

  const fade = (to: number, ms: number): Promise<void> =>
    new Promise((resolve) => {
      const from = glide.vignette.amount;
      const t0 = app.clock.now();
      const off = app.everyFrame((_dt, now) => {
        const k = Math.min(1, (now - t0) / (ms * pace()));
        glide.vignette.amount = from + (to - from) * k * k * (3 - 2 * k);
        if (k >= 1) {
          off();
          resolve();
        }
      });
    });

  const islands = async (): Promise<{ id: string; name: string }[]> => {
    try {
      return (await within(Promise.resolve(mind.publicIslands?.() ?? []), 5000, [])).slice(0, 3);
    } catch {
      return [];
    }
  };

  const housePoint = (h: HouseSpec | undefined): { x: number; z: number } | undefined => (h ? { x: h.pos.x + Math.sin(h.rotY) * 2, z: h.pos.z + Math.cos(h.rotY) * 2 } : undefined);

  /** Puts an island's houses and folk into the world. */
  const show = (state: IslandState): void => {
    for (const h of state.houses) {
      try {
        world.addHouse(h);
        world.finishHouse?.(h.id);
      } catch (error) {
        console.warn('[wf] a house of the visited island could not be placed', error);
      }
    }
    for (const r of state.residents) life.spawn(r, housePoint(state.houses.find((h) => h.id === r.houseId)));
  };
  const hide = (state: IslandState): void => {
    for (const h of state.houses) (world as { removeHouse?: (id: string) => void }).removeHouse?.(h.id);
    for (const r of state.residents) L.despawn?.(r.id);
  };

  const visits: Visits = {
    get away() {
      return away;
    },
    returned(id) {
      const r = mind.state?.residents.find((x) => x.id === id);
      if (!r || away) return;
      life.spawn(r, housePoint(mind.state.houses.find((h) => h.id === r.houseId)));
      life.emote(id, 'happy');
    },
    async trip(id) {
      const r = mind.state?.residents.find((x) => x.id === id);
      if (!r || !mind.sendTrip) return;
      const list = await islands();
      if (!list.length) {
        await parts.pipSay(VISIT_LINES.noIslands);
        return;
      }
      app.store.speaker.value = 'pip';
      void parts.pipSay(VISIT_LINES.where(r.name));
      const pick = await replies.show([...list.map((i) => i.name), 'Not today'].slice(0, 4));
      const to = list.find((i) => i.name === pick);
      if (!to) return;
      await within(Promise.resolve(mind.sendTrip(id, to.id)), 6000, undefined);
      await parts.say(id, r.name, VISIT_LINES.bye(to.name));
      life.emote(id, 'wave');
      // Down to the pier, and off.
      const pier = world.root.localToWorld(((world.pier as { step?: Vector3 }).step ?? new Vector3(10, 0, -12)).clone());
      if (desk()) guide.frame(guide.of(() => life.objectOf?.(id), 0.4));
      await within(Promise.resolve(life.walkTo(id, { x: pier.x, z: pier.z }, { speed: 2 })), 14000, undefined);
      L.despawn?.(id);
      if (desk()) guide.frame(null);
      await parts.pipSay(VISIT_LINES.gone(r.name));
    },
    async visit(islandId) {
      if (away || !mind.visit) return;
      let id = islandId;
      if (!id) {
        const list = await islands();
        if (!list.length) {
          await parts.pipSay(VISIT_LINES.noIslands);
          return;
        }
        app.store.speaker.value = 'pip';
        void parts.pipSay(VISIT_LINES.pickIsland);
        const pick = await replies.show([...list.map((i) => i.name), 'Not today'].slice(0, 4));
        id = list.find((i) => i.name === pick)?.id;
        if (!id) return;
      }
      let there: IslandState;
      try {
        there = await within(mind.visit(id), 10000, null as unknown as IslandState);
      } catch {
        there = null as unknown as IslandState;
      }
      if (!there) {
        await parts.pipSay('The wind is wrong for that island today. Another time.');
        return;
      }
      const home = mind.state;
      await fade(1, 600);
      hide(home);
      away = there;
      show(there);
      rig.placeAt(world.seat);
      await fade(0, 700);
      const folk = there.residents.slice(0, 3).map((r) => r.name);
      await parts.pipSay(VISIT_LINES.arrived(there.name, folk.length ? `${folk.join(' and ')} ${folk.length > 1 ? 'live' : 'lives'} here` : ''));
      // While away: say hello, leave a note, go home.
      for (;;) {
        app.store.speaker.value = 'pip';
        const pick = await replies.show([...VISIT_LINES.menuAway]);
        if (pick === VISIT_LINES.menuAway[0]) {
          const r = there.residents[0];
          if (!r) continue;
          const g = mind.greet?.(r.id);
          if (desk()) guide.frame(guide.of(() => life.objectOf?.(r.id), 0.45), { lift: -0.15 });
          life.face?.(r.id);
          life.emote(r.id, 'wave');
          await parts.say(r.id, r.name, g?.text ?? `Oh, a visitor from ${home.name}. Welcome.`);
        } else if (pick === VISIT_LINES.menuAway[1]) {
          app.store.speaker.value = 'pip';
          const text = await replies.show([...VISIT_LINES.noteChoices]);
          if (text) {
            await within(Promise.resolve((mind as { leaveMail?: (id: string, m: { kind: 'note'; text: string }) => Promise<boolean> }).leaveMail?.(id, { kind: 'note', text })), 6000, false);
            caption({ source: 'You', text });
            await parts.pipSay(VISIT_LINES.noteSent);
          }
        } else break;
      }
      await fade(1, 600);
      hide(there);
      away = null;
      show(home);
      rig.placeAt(world.seat);
      await fade(0, 700);
      if (desk()) guide.frame(null);
      await parts.pipSay(VISIT_LINES.home);
    },
    async peek(id) {
      const r = mind.state?.residents.find((x) => x.id === id);
      const house = r && (world as { house?: (id: string) => { window?: Vector3 } | undefined }).house?.(r.houseId ?? '');
      if (!r || !house?.window) return;
      const win = world.root.localToWorld(house.window.clone());
      if (desk()) guide.frame(() => win, { lift: 0 });
      (world as { lightHouse?: (id: string, on?: boolean) => void }).lightHouse?.(r.houseId ?? '', true);
      await wait(600);
      const night = isNight();
      const known = r.secretKnown || night || (r.visits ?? 0) >= 2;
      if (!known) {
        await parts.pipSay(VISIT_LINES.peekShut);
      } else {
        await parts.pipSay(night ? VISIT_LINES.peekNight : VISIT_LINES.peekDay);
        // What the room shows is their secret, in Pip's whisper.
        await parts.pipSay(r.story.secret);
        if (!r.secretKnown) {
          r.secretKnown = true;
          await within(Promise.resolve(mind.save()), 3000, undefined);
        }
      }
      if (desk()) guide.frame(null);
    },
  };

  // Leaning to a window in the headset peeks in (once a minute per house).
  const seen = new Map<string, number>();
  const headAt = new Vector3();
  let busy = false;
  app.clock.timers.set(function lean() {
    app.clock.timers.set(lean, 400);
    if (desk() || busy || away || app.store.phase.peek() !== 'free' || replies.open) return;
    app.world.camera.getWorldPosition(headAt);
    for (const r of mind.state?.residents ?? []) {
      const h = (world as { house?: (id: string) => { window?: Vector3 } | undefined }).house?.(r.houseId ?? '');
      if (!h?.window) continue;
      const w = world.root.localToWorld(h.window.clone());
      if (w.distanceTo(headAt) < 0.9 && app.clock.now() - (seen.get(r.id) ?? -1e9) > 60000) {
        seen.set(r.id, app.clock.now());
        busy = true;
        void visits.peek(r.id).finally(() => (busy = false));
        return;
      }
    }
  }, 400);

  registerTest('trip', (id: string) => visits.trip(id));
  registerTest('visit', (id?: string) => visits.visit(id));
  registerTest('peek', (id: string) => visits.peek(id));
  registerDebug('visits', visits);
  return visits;
}

export type { Resident };
