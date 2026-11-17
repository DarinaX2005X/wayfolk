/**
 * createMind end to end without a live model (prepared set), with a scripted model, and
 * against the real /api/islands handlers over a memory store.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createMind } from '../../src/mind/index';
import { noModel } from '../../src/mind/llm';
import { FIRST_IDS, PREPARED } from '../../src/mind/prepared';
import { deviceStore, memoryStore } from '../../src/mind/store';
import { DEMO_ISLANDS } from '../../src/mind/demo';
import type { HouseSpec, Resident } from '../../src/mind/types';
import { clock, islandsServer, scriptedModel, seeded } from './helpers';

const MIN = 60_000;
const HOUR = 60 * MIN;

function spec(r: Resident, i: number): HouseSpec {
  return { id: `h-${i}`, residentId: r.id, recipe: r.trade, pos: { x: 4 + i, z: -3 }, rotY: 0, colors: r.house!.colors, props: [...r.house!.props], sign: r.house!.sign, builtAt: 0 };
}

function offlineMind(time = clock(), extra: Partial<Parameters<typeof createMind>[0]> = {}) {
  const server = islandsServer(time.now);
  const mind = createMind({ now: time.now, random: seeded(11), store: memoryStore(), model: noModel, fetch: server.fetch, ...extra });
  return { mind, time, server };
}

describe('first minute without a model', () => {
  it('starts a new island with a strong prepared traveler and an instant greeting', async () => {
    const { mind } = offlineMind();
    await mind.load();
    const t = await mind.nextTraveler();
    expect(FIRST_IDS).toContain(t.id);
    expect(t.prepared).toBe(true);
    expect(mind.state.pending?.id).toBe(t.id);
    expect(await mind.nextTraveler()).toBe(t);
    const hello = mind.greet(t.id);
    expect(hello.text).toBe(t.story.intro);
    expect(hello.choices).toHaveLength(3);
    expect(hello.choiceIntents).toEqual(['chat', 'stay', 'leave']);
    expect(hello.prepared).toBe(true);
  });

  it('touching "stay" answers yes; settle makes a resident with a house and a path; the next traveler is new', async () => {
    const { mind } = offlineMind();
    await mind.load();
    const t = await mind.nextTraveler();
    const hello = mind.greet(t.id);
    const yes = await mind.talk(t.id, { text: hello.choices[1] });
    expect(yes.intent).toBe('stay');
    expect(yes.text.length).toBeGreaterThan(10);
    await mind.settle(t, spec(t, 1));
    expect(mind.state.pending).toBeUndefined();
    expect(mind.state.residents.map((r) => r.id)).toEqual([t.id]);
    expect(mind.state.residents[0].houseId).toBe('h-1');
    expect(mind.state.houses[0].residentId).toBe(t.id);
    expect(mind.state.paths).toEqual([['h-1', 'seat']]);
    expect(mind.state.residents[0].memory.at(-1)?.text).toMatch(/moved to/);
    const next = await mind.nextTraveler();
    expect(next.id).not.toBe(t.id);
    expect(next.trade).not.toBe(t.trade);
    expect(next.prepared).toBe(true);
  });

  it('tells one story beat per visit, keeps the secret on early daytime visits, and tells it later', async () => {
    const { mind, time } = offlineMind();
    await mind.load();
    const t = await mind.nextTraveler();
    await mind.settle(t, spec(t, 1));
    const r = mind.state.residents[0];
    time.advance(20 * MIN);
    mind.greet(r.id);
    const first = await mind.talk(r.id, { text: 'Tell me more' });
    expect(first.text).toBe(r.story.beats[0]);
    expect(r.story.revealed).toBe(1);
    const again = await mind.talk(r.id, { text: 'Tell me more' });
    expect(again.text).not.toBe(r.story.beats[1]);
    const asked = await mind.talk(r.id, { text: 'Do you have a secret?' });
    expect(asked.intent).toBe('secret');
    expect(asked.secret).toBeUndefined();
    await mind.endTalk(r.id);
    for (let visit = 0; visit < 3; visit += 1) {
      time.advance(30 * MIN);
      mind.greet(r.id);
      await mind.talk(r.id, { text: 'Tell me more' });
      await mind.endTalk(r.id);
    }
    time.advance(30 * MIN);
    const told = await mind.talk(r.id, { text: 'What is your secret?' });
    expect(told.secret).toBe(true);
    expect(told.text).toBe(r.story.secret);
    expect(r.secretKnown).toBe(true);
    expect(mind.state.events.some((e) => e.kind === 'secret' && e.residentId === r.id)).toBe(true);
  });

  it('answers a voice clip honestly when no model can hear it, and writes memory at the end', async () => {
    const { mind } = offlineMind();
    await mind.load();
    const t = await mind.nextTraveler();
    mind.greet(t.id);
    const r = await mind.talk(t.id, { audio: 'UklGRiQAAABXQVZF' });
    expect(r.text).toMatch(/wind took your words/);
    expect(r.prepared).toBe(true);
    await mind.talk(t.id, { text: 'I love the sound of rain on the roof' });
    await mind.settle(t, spec(t, 1));
    expect(mind.state.residents[0].memory.some((m) => m.text.includes('rain on the roof'))).toBe(true);
  });
});

describe('gifts', () => {
  it('a loved gift becomes a prop in the house; the favorite one tells the secret; others are thanked', async () => {
    const { mind } = offlineMind();
    await mind.load();
    const t = await mind.nextTraveler();
    await mind.settle(t, spec(t, 1));
    const r = mind.state.residents[0];
    const notLiked = (['pebble', 'mushroom', 'feather', 'shell', 'book'] as const).find((g) => !r.likes.includes(g))!;
    const meh = await mind.give(r.id, notLiked);
    expect(meh.loved).toBe(false);
    expect(meh.prop).toBeUndefined();
    expect(meh.text).not.toMatch(/\{/);
    const second = r.likes[1] as Parameters<typeof mind.give>[1];
    const loved = await mind.give(r.id, second);
    expect(loved.loved).toBe(true);
    expect(loved.prop).toBeTruthy();
    expect(mind.state.houses[0].props).toContain(loved.prop);
    expect(loved.secret).toBeUndefined();
    const fav = await mind.give(r.id, r.likes[0] as Parameters<typeof mind.give>[1]);
    expect(fav.secret).toBe(r.story.secret);
    expect(r.secretKnown).toBe(true);
    expect(r.memory.filter((m) => m.text.startsWith('They gave me')).length).toBe(3);
  });
});

describe('while away', () => {
  async function islandWithTwo() {
    const ctx = offlineMind();
    await ctx.mind.load();
    for (let i = 1; i <= 2; i += 1) {
      const t = await ctx.mind.nextTraveler();
      await ctx.mind.settle(t, spec(t, i));
    }
    await ctx.mind.whileAway(ctx.time.now());
    return ctx;
  }

  it('brings nothing after a minute, one piece of news after an hour, three after a night', async () => {
    const { mind, time } = await islandWithTwo();
    time.advance(MIN);
    expect(await mind.whileAway(time.now())).toEqual([]);
    time.advance(HOUR);
    const hour = await mind.whileAway(time.now());
    expect(hour).toHaveLength(2);
    time.advance(9 * HOUR);
    const night = await mind.whileAway(time.now());
    expect(night).toHaveLength(3);
    expect(new Set(night.map((e) => e.kind))).toEqual(new Set(['news', 'growth', 'gift']));
    for (const e of night) {
      expect(e.text).not.toMatch(/\{|\}/);
      expect(mind.state.residents.some((r) => r.id === e.residentId)).toBe(true);
    }
    const growth = night.find((e) => e.kind === 'growth')!;
    expect(growth.effect?.prop).toBeTruthy();
    expect(mind.state.props.some((p) => p.kind === growth.effect!.prop)).toBe(true);
    expect(mind.state.lastVisit).toBe(time.now());
    expect(mind.state.events.slice(-3)).toEqual(night);
  });

  it('sends a resident on a trip to a demo island, delivers them there, and brings them back with a story and a souvenir', async () => {
    const { mind, time } = await islandWithTwo();
    const r = mind.state.residents[0];
    const target = DEMO_ISLANDS[0];
    const trip = await mind.sendTrip(r.id, target.id);
    expect(trip).toMatchObject({ to: target.id, toName: target.island.name });
    expect(trip.returnsAt - trip.leftAt).toBe(2 * HOUR);
    expect(trip.met?.length).toBe(3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const there = await mind.visit(target.id);
    expect(there.visitors?.map((v) => v.name)).toContain(r.name);
    expect(there.residents.length).toBe(3);
    time.advance(HOUR);
    expect(await mind.tick(time.now())).toEqual([]);
    time.advance(HOUR + MIN);
    const back = await mind.tick(time.now());
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ kind: 'trip-return', residentId: r.id });
    expect(back[0].text).toContain(target.island.name);
    expect(r.trip).toBeUndefined();
    expect(mind.state.houses.find((h) => h.residentId === r.id)!.props).toContain(back[0].effect!.prop);
    expect(r.memory.at(-1)!.text).toContain(target.island.name);
  });

  it('demo mode makes trips short', async () => {
    const { mind } = offlineMind(clock(), { demo: true });
    await mind.load();
    const t = await mind.nextTraveler();
    await mind.settle(t, spec(t, 1));
    const trip = await mind.sendTrip(t.id, DEMO_ISLANDS[1].id);
    expect(trip.returnsAt - trip.leftAt).toBe(3 * MIN);
  });
});

describe('public islands', () => {
  it('lists the horizon, publishes, gets mail and guests from other islands, and unpublishes', async () => {
    const time = clock();
    const server = islandsServer(time.now);
    const mind = createMind({ now: time.now, random: seeded(5), store: memoryStore(), model: noModel, fetch: server.fetch });
    const friend = createMind({ now: time.now, random: seeded(6), store: memoryStore(), model: noModel, fetch: server.fetch });
    await mind.load();
    await friend.load();
    const horizon = await mind.publicIslands();
    expect(horizon.filter((h) => h.demo)).toHaveLength(DEMO_ISLANDS.length);
    const t = await mind.nextTraveler();
    await mind.settle(t, spec(t, 1));
    const { id } = await mind.publish();
    expect(mind.state.visibility).toBe('public');
    expect((await friend.publicIslands()).some((s) => s.id === id)).toBe(true);
    const seen = await friend.visit(id);
    expect(seen.residents[0].name).toBe(t.name);
    expect(seen.residents[0].memory).toEqual([]);
    expect(await friend.leaveMail(id, { kind: 'gift', item: 'star', text: 'For the night shift' })).toBe(true);
    const ft = await friend.nextTraveler();
    await friend.settle(ft, spec(ft, 1));
    await friend.sendTrip(ft.id, id);
    await new Promise((resolve) => setTimeout(resolve, 0));
    time.advance(2 * MIN);
    const events = await mind.tick(time.now());
    expect(events.map((e) => e.kind)).toEqual(['visitor', 'visitor']);
    expect(events[0].text).toContain('star');
    expect(mind.state.visitors?.map((v) => v.name)).toEqual([ft.name]);
    const hello = mind.greet(ft.id);
    expect(hello.text).toContain(friend.state.name);
    // Republishing keeps the id.
    expect((await mind.publish()).id).toBe(id);
    await mind.unpublish();
    expect(mind.state.visibility).toBe('private');
    await expect(friend.visit(id)).rejects.toThrow();
  });

  it('falls back to the demo islands when the server cannot be reached', async () => {
    const time = clock();
    const offline = (async () => {
      throw new TypeError('offline');
    }) as typeof fetch;
    const mind = createMind({ now: time.now, random: seeded(5), store: memoryStore(), model: noModel, fetch: offline });
    await mind.load();
    expect((await mind.publicIslands()).map((s) => s.id)).toEqual(DEMO_ISLANDS.map((d) => d.id));
    const demo = await mind.visit(DEMO_ISLANDS[2].id);
    expect(demo.residents.length).toBe(3);
    await expect(mind.publish()).rejects.toThrow(/publish failed/);
  });
});

describe('with a live model', () => {
  const travelerJson = (name: string) => (c: { messages: { content: unknown }[] }) => {
    const user = String(c.messages[1].content);
    const species = /a (\w+), a/.exec(user)![1];
    const tradeLine = /New traveler: a \w+, a ([\w ]+), arriving by ([\w ]+)\./.exec(user)!;
    const trades: Record<string, string> = { 'cloud fisher': 'fisher', 'tea maker': 'tea-maker', 'lighthouse keeper': 'lighthouse-keeper' };
    const trade = trades[tradeLine[1]] ?? tradeLine[1];
    const vehicle = tradeLine[2].replace(' ', '-');
    return {
      ok: true as const,
      ms: 900,
      model: 'test',
      json: {
        name,
        species,
        trade,
        vehicle,
        tagline: 'Small and certain',
        personality: 'Speaks in whispers. Collects buttons.',
        voice: { pitch: 1.1, rate: 1, timbre: 'soft' },
        colors: { main: '#aa8866', accent: '#335577' },
        likes: ['book', 'tea'],
        story: { intro: 'I came on the wind. It was very insistent.', beats: ['One.', 'Two.', 'Three.', 'Four.'], secret: 'I am afraid of buttons.' },
        house: { wall: '#ffffff', roof: '#884422', trim: '#112233', sign: 'Buttons', props: ['books'] },
      },
    };
  };

  it('the first traveler is still prepared; later ones are generated, checked and not prepared', async () => {
    const time = clock();
    const { client, calls } = scriptedModel({ traveler: travelerJson('Wisp Hollander') as never });
    const mind = createMind({ now: time.now, random: seeded(2), store: memoryStore(), model: client, fetch: islandsServer(time.now).fetch });
    await mind.load();
    const first = await mind.nextTraveler();
    expect(first.prepared).toBe(true);
    await mind.settle(first, spec(first, 1));
    const second = await mind.nextTraveler();
    expect(second.name).toBe('Wisp Hollander');
    expect(second.prepared).toBeUndefined();
    expect(second.trade).not.toBe(first.trade);
    expect(calls.filter((c) => c.task === 'traveler')).toHaveLength(1);
  });

  it('a generated traveler that repeats a name falls back to the prepared set after one retry', async () => {
    const time = clock();
    const { client, calls } = scriptedModel({ traveler: travelerJson(PREPARED[0].name) as never });
    const mind = createMind({ now: time.now, random: seeded(2), store: memoryStore(), model: client, fetch: islandsServer(time.now).fetch });
    await mind.load();
    const first = await mind.nextTraveler();
    await mind.settle(first, spec(first, 1));
    const second = await mind.nextTraveler();
    expect(second.prepared).toBe(true);
    expect(calls.filter((c) => c.task === 'traveler')).toHaveLength(2);
  });

  it('talk uses the model reply, sends audio, follows the touched choice, and remembers', async () => {
    const time = clock();
    const { client, calls } = scriptedModel({
      talk: (c) => ({
        ok: true,
        ms: 800,
        model: 'test',
        json: {
          heard: c.audio ? 'My name is Ada and I like rain' : 'Tell me more',
          text: 'Rain is my favorite sound. It knocks like a polite guest.',
          intent: 'chat',
          mood: 'happy',
          choices: ['Why polite?', 'Will you stay?', 'Goodbye'],
          choiceIntents: ['chat', 'stay', 'leave'],
          toldBeat: true,
          toldSecret: true,
          remember: 'Their name is Ada; they like rain',
        },
      }),
    });
    const mind = createMind({ now: time.now, random: seeded(2), store: memoryStore(), model: client, fetch: islandsServer(time.now).fetch });
    await mind.load();
    const t = await mind.nextTraveler();
    mind.greet(t.id);
    const r1 = await mind.talk(t.id, { audio: 'UklGRiQAAABXQVZF' });
    expect(r1).toMatchObject({ heard: 'My name is Ada and I like rain', intent: 'chat', choices: ['Why polite?', 'Will you stay?', 'Goodbye'] });
    expect(r1.prepared).toBeUndefined();
    expect(r1.secret).toBeUndefined();
    expect(t.story.revealed).toBe(1);
    expect(calls[0].audio).toBe('UklGRiQAAABXQVZF');
    const r2 = await mind.talk(t.id, { text: 'Will you stay?' });
    expect(r2.intent).toBe('stay');
    expect(t.story.revealed).toBe(1);
    await mind.settle(t, spec(t, 1));
    expect(mind.state.residents[0].memory.map((m) => m.text)).toContain('Their name is Ada; they like rain');
  });

  it('falls back to prepared lines when the model fails or answers badly', async () => {
    const time = clock();
    const { client } = scriptedModel({ talk: () => ({ ok: true, ms: 10, model: 'x', json: { text: '' } }), gift: () => ({ ok: false, reason: 'timeout', ms: 5000 }) });
    const mind = createMind({ now: time.now, random: seeded(2), store: memoryStore(), model: client, fetch: islandsServer(time.now).fetch });
    await mind.load();
    const t = await mind.nextTraveler();
    mind.greet(t.id);
    const r = await mind.talk(t.id, { text: 'Tell me more' });
    expect(r.prepared).toBe(true);
    const g = await mind.give(t.id, 'pebble');
    expect(g.prepared).toBe(true);
  });

  it('liveAI off means no model calls at all', async () => {
    const time = clock();
    const { client, calls } = scriptedModel({});
    const mind = createMind({ now: time.now, random: seeded(2), store: memoryStore(), model: client, fetch: islandsServer(time.now).fetch, liveAI: false });
    await mind.load();
    const t = await mind.nextTraveler();
    await mind.talk(t.id, { text: 'Hello' });
    await mind.settle(t, spec(t, 1));
    await mind.nextTraveler();
    expect(calls).toHaveLength(0);
    expect(await mind.aiStatus()).toEqual({ live: false, audio: false });
  });
});

describe('storage on the device', () => {
  it('keeps the island in IndexedDB between sessions', async () => {
    const time = clock();
    const store = await deviceStore();
    expect(store.persistent).toBe(true);
    const a = createMind({ now: time.now, random: seeded(9), store, model: noModel, fetch: islandsServer(time.now).fetch });
    await a.load();
    const t = await a.nextTraveler();
    await a.settle(t, spec(t, 1));
    const b = createMind({ now: time.now, random: seeded(10), store: await deviceStore(), model: noModel, fetch: islandsServer(time.now).fetch });
    const loaded = await b.load();
    expect(loaded.id).toBe(a.state.id);
    expect(loaded.residents.map((r) => r.name)).toEqual([t.name]);
    await store.clear();
  });
});
