import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Scene, Vector3 } from '@iwsdk/core';
import { HOST_ONLY_EVENTS, LIMITS, validKind } from '../../src/live/protocol';
import { PREPARED } from '../../src/mind/prepared';
import type { IslandState, Resident } from '../../src/mind/types';
import { createTogether, type LiveLike, type Together } from '../../src/together/index';
import { TG, TG_KINDS, cleanPayload } from '../../src/together/events';
import {
  BridgeRun,
  SLOTS,
  SOLO_MAX,
  areTwins,
  chimeHz,
  constellation,
  duetPulse,
  isHighFive,
  palmFrom,
  plankCount,
  plankOrder,
  playingTogether,
} from '../../src/together/plan';
import { addBridge, addStar, cleanIsland, emptyRecord, freeSlot, loadRecord, saveRecord, stateRecord, summarize, writeStateRecord } from '../../src/together/records';
import { PIER, ISLETS } from '../../src/world/land';
import { createWorld, type World } from '../../src/world/index';

const island = (id: string, name: string, folk: string[]): IslandState => ({
  id,
  name,
  seed: 99,
  visibility: 'private',
  radius: 14,
  residents: folk.map((rid, i) => ({ ...structuredClone(PREPARED.find((p) => p.id === rid)!), arrivedAt: 1, houseId: `h-${i}` })) as Resident[],
  houses: folk.map((rid, i) => ({ id: `h-${i}`, residentId: rid, recipe: PREPARED.find((p) => p.id === rid)!.trade, pos: { x: 3 * i, z: -8 }, rotY: 0, colors: { wall: '#efe2c8', roof: '#c8553d', trim: '#7b4b2e' }, props: [], sign: 'Home', builtAt: 1 })),
  paths: [],
  props: [],
  events: [],
  createdAt: 1,
  lastVisit: 1,
});

describe('plan', () => {
  it('lays planks from both ends toward the middle', () => {
    expect(plankOrder(5)).toEqual([0, 4, 1, 3, 2]);
    expect(new Set(plankOrder(23)).size).toBe(23);
  });

  it('grows the bridge only while both hold', () => {
    const run = new BridgeRun(10);
    expect(run.step(5, true, false)).toEqual([]);
    expect(run.step(5, false, true)).toEqual([]);
    const got = run.step(1.3, true, true);
    expect(got.length).toBeGreaterThanOrEqual(2);
    const before = run.launched;
    expect(run.step(3, true, false)).toEqual([]);
    expect(run.launched).toBe(before);
    for (let i = 0; i < 100 && !run.done; i++) run.step(0.1, true, true);
    expect(run.done).toBe(true);
    expect(run.launched).toBe(10);
  });

  it('docks the friend\'s island clear of the pier and the islets', () => {
    for (const s of Object.values(SLOTS)) {
      const pierEnd = { x: PIER.base.x + PIER.dir.x * 10.6, z: PIER.base.z + PIER.dir.z * 10.6 };
      expect(Math.hypot(pierEnd.x - s.centre.x, pierEnd.z - s.centre.z)).toBeGreaterThan(s.radius * 1.2 + 1.5);
      for (const i of ISLETS) expect(Math.hypot(i.cx - s.centre.x, i.cz - s.centre.z)).toBeGreaterThan(i.r + s.radius * 1.2);
      expect(plankCount(s)).toBeGreaterThan(15);
    }
  });

  it('answers two players far more than one', () => {
    expect(duetPulse(1, 0)).toBeLessThanOrEqual(SOLO_MAX + 1e-9);
    expect(duetPulse(0, 1)).toBeLessThanOrEqual(SOLO_MAX + 1e-9);
    expect(duetPulse(1, 1)).toBeGreaterThan(3 * SOLO_MAX);
    expect(duetPulse(0.6, 0.6)).toBeGreaterThan(2 * duetPulse(0.6, 0));
    expect(playingTogether(1000, 2000, 2500)).toBe(true);
    expect(playingTogether(1000, 9000, 9500)).toBe(false);
    // the two parts share one scale, the friend's an octave and more above
    expect(chimeHz('high', 0)).toBeGreaterThan(chimeHz('low', 4));
  });

  it('knows twin lanterns, a constellation and a high five', () => {
    expect(areTwins(1000, 15000)).toBe(true);
    expect(areTwins(1000, 60000)).toBe(false);
    expect(areTwins(1000, null)).toBe(false);
    const a = constellation(['Mira', 'Tom'], 5);
    expect(a).toEqual(constellation(['Mira', 'Tom'], 5));
    expect(a.points.length).toBe(8);
    expect(a.lines).toContainEqual([0, 4]);
    expect(isHighFive(0.08, 0.6)).toBe(true);
    expect(isHighFive(0.08, 0.05)).toBe(false);
    expect(isHighFive(0.4, 2)).toBe(false);
    const palm = palmFrom([0, 0, 0], [0, 0, 0, 0, 0.18, 0, 0, 0.19, 0, 0, 0.18, 0, 0, 0.15, 0]);
    expect(palm[1]).toBeGreaterThan(0.05);
    expect(palm[1]).toBeLessThan(0.1);
  });
});

describe('records and events', () => {
  it('summarises an island well under the event limit', () => {
    const big = island('isle-a', 'Juniper Rock', ['p-baker-fox', 'p-stargazer-owl', 'p-gardener-bear', 'p-tinkerer-raccoon', 'p-storyteller-rabbit']);
    for (const r of big.residents) r.memory = Array.from({ length: 50 }, (_, i) => ({ at: i, text: 'x'.repeat(200) }));
    const s = summarize(big, 'Mira', '#e9825f');
    expect(s.residents.length).toBeLessThanOrEqual(3);
    expect(s.houses.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify({ t: 'ev', k: TG.hello, d: { island: s, built: [] } }).length).toBeLessThan(LIMITS.textBytes / 2);
    expect(cleanIsland(JSON.parse(JSON.stringify(s)))?.name).toBe('Juniper Rock');
    expect(cleanIsland({ id: '../../etc', name: 'x' })).toBeNull();
  });

  it('keeps one bridge per friend, two at most, and the stars', () => {
    const rec = emptyRecord();
    const a = summarize(island('isle-a', 'A', ['p-baker-fox']), 'Tom', '#3f9e98');
    const b = summarize(island('isle-b', 'B', ['p-baker-fox']), 'Ana', '#e2a93b');
    const c = summarize(island('isle-c', 'C', ['p-baker-fox']), 'Lu', '#7aa65a');
    expect(addBridge(rec, { island: a, slot: 'east', builtAt: 1, names: ['Mira', 'Tom'] })).toBe(true);
    expect(addBridge(rec, { island: a, slot: 'east', builtAt: 2, names: ['Mira', 'Tom'] })).toBe(false);
    expect(addBridge(rec, { island: b, slot: 'east', builtAt: 3, names: ['Mira', 'Ana'] })).toBe(true);
    expect(rec.bridges.map((x) => x.slot)).toEqual(['east', 'west']);
    expect(freeSlot(rec)).toBeNull();
    expect(addBridge(rec, { island: c, slot: 'east', builtAt: 4, names: ['Mira', 'Lu'] })).toBe(false);
    const star = { id: 'st1', names: ['Mira', 'Tom'] as [string, string], at: 1, seed: 3, dir: [0, 0.6, -0.8] as [number, number, number] };
    expect(addStar(rec, star)).toBe(true);
    expect(addStar(rec, star)).toBe(false);
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveRecord(storage, 'isle-m', rec);
    expect(loadRecord(storage, 'isle-m')).toEqual(rec);
    const state = island('isle-m', 'M', []);
    writeStateRecord(state, rec);
    expect(stateRecord(state).bridges.length).toBe(2);
  });

  it('uses plain relay events that both people may send', () => {
    for (const k of TG_KINDS) {
      expect(validKind(k)).toBe(true);
      expect(HOST_ONLY_EVENTS).not.toContain(k);
    }
    expect(cleanPayload(TG.hold, { on: true })).toEqual({ on: true });
    expect(cleanPayload(TG.hold, { on: 'yes' })).toBeNull();
    expect(cleanPayload(TG.plank, { i: 3, n: 23 })).toEqual({ i: 3, n: 23 });
    expect(cleanPayload(TG.plank, { i: 30, n: 23 })).toBeNull();
    expect(cleanPayload(TG.chime, { i: 2, v: 5 })).toEqual({ i: 2, v: 1 });
    expect(cleanPayload(TG.five, { at: [1, 2, 'x'] })).toBeNull();
    expect(cleanPayload(TG.lantern, { at: [1, 2, 3] })).toEqual({ at: [1, 2, 3] });
  });
});

// ---------------------------------------------------------------------------------------
// Two people, two pages, one in-memory relay

type Handler = (data: unknown, from: { id: string; name: string; color: string; role: 'host' | 'guest' }) => void;

function room(): { host: LiveLike & { fire(k: string, ...a: unknown[]): void }; guest: LiveLike & { fire(k: string, ...a: unknown[]): void } } {
  const people = {
    host: { id: 'hostaaaaaaaa', name: 'Mira', color: '#e9825f', role: 'host' as const },
    guest: { id: 'guestbbbbbbb', name: 'Tom', color: '#3f9e98', role: 'guest' as const },
  };
  const make = (me: 'host' | 'guest') => {
    const handlers = new Map<string, Set<Handler>>();
    const other = me === 'host' ? 'guest' : 'host';
    const side = {
      role: me,
      me: people[me],
      peers: [people[other]],
      state: 'live',
      send(kind: string, data?: unknown) {
        // the relay forwards to the others, never back
        const json = JSON.parse(JSON.stringify(data ?? null));
        for (const fn of sides[other].handlers.get(kind) ?? []) fn(json, people[me]);
        return true;
      },
      on(kind: string, fn: (...a: never[]) => void) {
        let set = handlers.get(kind);
        if (!set) handlers.set(kind, (set = new Set()));
        set.add(fn as unknown as Handler);
        return () => set.delete(fn as unknown as Handler);
      },
      avatarOf: () => null,
      fire(kind: string, ...args: unknown[]) {
        for (const fn of handlers.get(kind) ?? []) (fn as unknown as (...a: unknown[]) => void)(...args);
      },
      handlers,
    };
    return side;
  };
  const sides = { host: make('host'), guest: make('guest') };
  return sides;
}

async function person(live: LiveLike, own: IslandState): Promise<{ t: Together; world: World }> {
  const scene = new Scene();
  const world = createWorld({ scene }, { kitUrl: 'missing.glb' });
  await world.ready;
  const camera = new PerspectiveCamera();
  scene.add(camera);
  const mem = new Map<string, string>();
  const t = createTogether({
    world,
    life: null,
    mind: { state: own, save: async () => {}, load: async () => own },
    live,
    app: { camera, storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) } },
  });
  await world.ready;
  await new Promise((r) => setTimeout(r, 0));
  return { t, world };
}

describe('two people together', () => {
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 40; i++) await Promise.resolve();
  };

  it('build a bridge that only grows while both hold, and keep it', { timeout: 30000 }, async () => {
    const r = room();
    const host = await person(r.host, island('isle-mira', 'Juniper Rock', ['p-musician-fox']));
    const guest = await person(r.guest, island('isle-tom', 'Thistle Knoll', ['p-baker-rabbit', 'p-gardener-bear']));
    r.guest.fire('join', {});
    r.host.fire('join', {});
    await settle();
    // their island follows them a moment after they meet
    await new Promise((res) => setTimeout(res, 3300));
    await settle();
    expect(host.t.neighbours.length).toBe(1);
    expect(guest.t.neighbours.length).toBe(1);
    expect(host.t.neighbours[0].info.name).toBe('Thistle Knoll');
    expect(guest.t.neighbours[0].info.name).toBe('Thistle Knoll');
    // the island drifts in
    for (let i = 0; i < 180; i++) {
      host.t.update(0.1);
      guest.t.update(0.1);
    }
    const hn = host.t.neighbours[0];
    expect(hn.docked).toBe(true);
    expect(host.t.available()).toBe(true);
    // one end held: nothing happens
    await host.t.hold(true);
    for (let i = 0; i < 40; i++) host.t.update(0.1);
    expect(hn.laid.some(Boolean)).toBe(false);
    // both: planks fly and land on both sides
    await guest.t.hold(true);
    expect(hn.hold.far).toBe(true);
    for (let i = 0; i < 40; i++) {
      host.t.update(0.1);
      guest.t.update(0.1);
    }
    const mid = hn.laid.filter(Boolean).length;
    expect(mid).toBeGreaterThan(3);
    expect(guest.t.neighbours[0].laid.filter(Boolean).length).toBeGreaterThan(3);
    await guest.t.hold(false);
    for (let i = 0; i < 60; i++) host.t.update(0.1);
    const paused = hn.laid.filter(Boolean).length;
    for (let i = 0; i < 40; i++) host.t.update(0.1);
    expect(hn.laid.filter(Boolean).length).toBe(paused);
    expect(paused).toBeLessThan(hn.planksN);
    await guest.t.hold(true);
    for (let i = 0; i < 200 && !hn.complete; i++) {
      host.t.update(0.1);
      guest.t.update(0.1);
    }
    expect(hn.complete).toBe(true);
    for (let i = 0; i < 5; i++) guest.t.update(0.1);
    await settle();
    expect(guest.t.neighbours[0].complete).toBe(true);
    expect(host.t.record.bridges.map((b) => b.island.name)).toEqual(['Thistle Knoll']);
    expect(guest.t.record.bridges.map((b) => b.island.name)).toEqual(['Juniper Rock']);
    // the bridge is ground: folk can walk over it to the friend's island
    const w = host.world;
    const mid3 = hn.A.clone().lerp(hn.B, 0.5);
    expect(Math.abs(w.groundY(mid3.x, mid3.z) - hn.plankSlot(Math.floor(hn.planksN / 2)).y)).toBeLessThan(0.15);
    const there = hn.toIsland(new Vector3(0, 0, 0));
    const route = w.route({ x: 0, z: -2 }, { x: there.x, z: there.z });
    const crossing = route.filter((p) => Math.hypot(p.x - mid3.x, p.z - mid3.z) < 0.8);
    expect(crossing.length).toBeGreaterThan(0);
  });

  it('a duet, twin lanterns and a high five reach both sides', async () => {
    const r = room();
    const host = await person(r.host, island('isle-mira2', 'Juniper Rock', ['p-musician-fox']));
    const guest = await person(r.guest, island('isle-tom2', 'Thistle Knoll', ['p-baker-rabbit']));
    r.host.fire('join', {});
    await settle();
    expect(host.t.actions().map((a) => a.id)).toEqual(expect.arrayContaining(['duet', 'lanterns', 'five']));
    expect(host.t.label).toContain('Tom');
    // duet
    await host.t.duet(true);
    expect(guest.t.duetOpen).toBe(true);
    const duetOf = (t: Together) => (t as unknown as { debug: { duet: { pulse: number } } }).debug.duet;
    for (let i = 0; i < 6; i++) {
      host.t.chime(i % 5);
      host.t.update(0.3);
    }
    const solo = duetOf(host.t).pulse;
    for (let i = 0; i < 6; i++) {
      host.t.chime(i % 5);
      guest.t.chime((i + 2) % 5);
      host.t.update(0.3);
    }
    const both = duetOf(host.t).pulse;
    expect(solo).toBeLessThanOrEqual(SOLO_MAX + 0.01);
    expect(both).toBeGreaterThan(solo * 2);
    // lanterns: the guest first, the host a little later; they meet as stars on both islands
    guest.t.lantern();
    host.t.update(1);
    host.t.lantern();
    for (let i = 0; i < 120; i++) {
      host.t.update(0.1);
      guest.t.update(0.1);
    }
    await settle();
    expect(host.t.record.stars.map((s) => s.names.join(' and '))).toEqual(['Mira and Tom']);
    expect(guest.t.record.stars.length).toBe(1);
    // high five from a page: the guest raises a hand, the host meets it
    guest.t.highFive();
    host.t.highFive();
    const five = (t: Together) => (t as unknown as { debug: { five: { spiral: unknown } } }).debug.five;
    expect(five(host.t).spiral).not.toBeNull();
    expect(five(guest.t).spiral).not.toBeNull();
  });
});
