/**
 * The one check of residents and islands that come from outside the device: a model's
 * traveler, a published island arriving at the server, a guest from another island, a
 * snapshot read back from the server. Each `clean*` returns a fresh copy with only the
 * known fields, or a string naming the first problem. Pure functions: the server
 * (api/_lib/islands.ts) and the client share them.
 */
import type { Guest, PublicIsland, PublicResident } from '../../api/_lib/contracts';
import {
  GIFT_KINDS,
  SPECIES,
  TRADES,
  VEHICLES,
  type GiftKind,
  type HousePlan,
  type HouseSpec,
  type IslandState,
  type IslandSummary,
  type PlacedProp,
  type Resident,
  type Voice,
} from './types';

export const LIMITS = {
  name: 24,
  islandName: 32,
  personality: 320,
  line: 320,
  beatsMin: 4,
  beatsMax: 6,
  likesMax: 3,
  tagline: 60,
  sign: 24,
  props: 8,
  residents: 24,
  houses: 24,
  paths: 64,
  islandProps: 80,
  id: 32,
} as const;

export const ISLAND_ID = /^[a-z0-9-]{3,32}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_-]{1,32}$/;
const TIMBRES: Voice['timbre'][] = ['soft', 'bright', 'croaky', 'warm'];

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

class Problem extends Error {}
const no = (path: string, why: string): never => {
  throw new Problem(`${path}: ${why}`);
};

function str(v: unknown, path: string, max: number, min = 1): string {
  if (typeof v !== 'string') return no(path, 'expected text');
  const t = v.replace(/\s+/g, ' ').trim();
  if (t.length < min) return no(path, 'empty');
  if (t.length > max) return no(path, `longer than ${max}`);
  return t;
}
function num(v: unknown, path: string, lo: number, hi: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return no(path, 'expected number');
  if (v < lo || v > hi) return no(path, `outside ${lo}..${hi}`);
  return v;
}
function oneOf<T extends string>(v: unknown, path: string, list: readonly T[]): T {
  if (typeof v !== 'string' || !(list as readonly string[]).includes(v)) return no(path, 'not an allowed value');
  return v as T;
}
function hex(v: unknown, path: string): string {
  if (typeof v !== 'string' || !HEX.test(v.trim())) return no(path, 'expected #rrggbb');
  return v.trim().toLowerCase();
}
function id(v: unknown, path: string): string {
  if (typeof v !== 'string' || !ID.test(v)) return no(path, 'bad id');
  return v;
}
function arr(v: unknown, path: string, max: number, min = 0): unknown[] {
  if (!Array.isArray(v)) return no(path, 'expected list');
  if (v.length < min) return no(path, `fewer than ${min}`);
  if (v.length > max) return no(path, `more than ${max}`);
  return v;
}
function p2(v: unknown, path: string): { x: number; z: number } {
  if (!isRec(v)) return no(path, 'expected position');
  return { x: num(v.x, `${path}.x`, -200, 200), z: num(v.z, `${path}.z`, -200, 200) };
}

function housePlan(v: unknown, path: string): HousePlan {
  if (!isRec(v)) return no(path, 'expected object');
  const c = isRec(v.colors) ? v.colors : no(`${path}.colors`, 'expected object');
  return {
    colors: { wall: hex(c.wall, `${path}.colors.wall`), roof: hex(c.roof, `${path}.colors.roof`), trim: hex(c.trim, `${path}.colors.trim`) },
    sign: str(v.sign, `${path}.sign`, LIMITS.sign),
    props: arr(v.props ?? [], `${path}.props`, LIMITS.props).map((p, i) => str(p, `${path}.props[${i}]`, 24)),
  };
}

/**
 * A resident from outside. `memory`, `trip` and `from` are kept only when `own` is set
 * (the person's own island); a public copy never carries them.
 */
function resident(v: unknown, path: string, own: boolean): Resident {
  if (!isRec(v)) return no(path, 'expected object');
  const voice = isRec(v.voice) ? v.voice : no(`${path}.voice`, 'expected object');
  const colors = isRec(v.colors) ? v.colors : no(`${path}.colors`, 'expected object');
  const story = isRec(v.story) ? v.story : no(`${path}.story`, 'expected object');
  const beats = arr(story.beats, `${path}.story.beats`, LIMITS.beatsMax, 1).map((b, i) => str(b, `${path}.story.beats[${i}]`, LIMITS.line));
  const likes = arr(v.likes ?? [], `${path}.likes`, LIMITS.likesMax).map((l, i) => oneOf<GiftKind>(l, `${path}.likes[${i}]`, GIFT_KINDS));
  const out: Resident = {
    id: id(v.id, `${path}.id`),
    name: str(v.name, `${path}.name`, LIMITS.name),
    species: oneOf(v.species, `${path}.species`, SPECIES),
    trade: oneOf(v.trade, `${path}.trade`, TRADES),
    vehicle: oneOf(v.vehicle, `${path}.vehicle`, VEHICLES),
    personality: str(v.personality, `${path}.personality`, LIMITS.personality),
    voice: {
      pitch: num(voice.pitch, `${path}.voice.pitch`, 0.5, 2),
      rate: num(voice.rate, `${path}.voice.rate`, 0.5, 2),
      timbre: oneOf(voice.timbre, `${path}.voice.timbre`, TIMBRES),
    },
    colors: { main: hex(colors.main, `${path}.colors.main`), accent: hex(colors.accent, `${path}.colors.accent`) },
    story: {
      intro: str(story.intro, `${path}.story.intro`, LIMITS.line),
      beats,
      secret: str(story.secret, `${path}.story.secret`, LIMITS.line),
      revealed: Math.min(beats.length, Math.floor(num(story.revealed ?? 0, `${path}.story.revealed`, 0, 99))),
    },
    likes: [...new Set(likes)],
    memory: [],
    arrivedAt: num(v.arrivedAt ?? 0, `${path}.arrivedAt`, 0, 1e14),
  };
  if (v.houseId !== undefined) out.houseId = id(v.houseId, `${path}.houseId`);
  if (v.prepared === true) out.prepared = true;
  if (v.tagline !== undefined) out.tagline = str(v.tagline, `${path}.tagline`, LIMITS.tagline);
  if (v.house !== undefined) out.house = housePlan(v.house, `${path}.house`);
  if (v.visits !== undefined) out.visits = Math.floor(num(v.visits, `${path}.visits`, 0, 1e6));
  if (v.secretKnown === true) out.secretKnown = true;
  if (own) {
    if (v.lastTalkAt !== undefined) out.lastTalkAt = num(v.lastTalkAt, `${path}.lastTalkAt`, 0, 1e14);
    if (Array.isArray(v.memory)) {
      out.memory = v.memory
        .slice(-24)
        .filter(isRec)
        .map((m, i) => ({ at: num(m.at, `${path}.memory[${i}].at`, 0, 1e14), text: str(m.text, `${path}.memory[${i}].text`, 200) }));
    }
  }
  return out;
}

function house(v: unknown, path: string): HouseSpec {
  if (!isRec(v)) return no(path, 'expected object');
  const c = isRec(v.colors) ? v.colors : no(`${path}.colors`, 'expected object');
  const out: HouseSpec = {
    id: id(v.id, `${path}.id`),
    residentId: id(v.residentId, `${path}.residentId`),
    recipe: oneOf(v.recipe, `${path}.recipe`, TRADES),
    pos: p2(v.pos, `${path}.pos`),
    rotY: num(v.rotY, `${path}.rotY`, -100, 100),
    colors: { wall: hex(c.wall, `${path}.colors.wall`), roof: hex(c.roof, `${path}.colors.roof`), trim: hex(c.trim, `${path}.colors.trim`) },
    props: arr(v.props ?? [], `${path}.props`, 16).map((p, i) => str(p, `${path}.props[${i}]`, 24)),
    builtAt: num(v.builtAt ?? 0, `${path}.builtAt`, 0, 1e14),
  };
  if (v.sign !== undefined) out.sign = str(v.sign, `${path}.sign`, LIMITS.sign);
  return out;
}

function placed(v: unknown, path: string): PlacedProp {
  if (!isRec(v)) return no(path, 'expected object');
  const out: PlacedProp = { id: id(v.id, `${path}.id`), kind: str(v.kind, `${path}.kind`, 24), pos: p2(v.pos, `${path}.pos`) };
  if (v.rotY !== undefined) out.rotY = num(v.rotY, `${path}.rotY`, -100, 100);
  if (v.from !== undefined) out.from = str(v.from, `${path}.from`, 40);
  return out;
}

const attempt = <T>(fn: () => T): T | string => {
  try {
    return fn();
  } catch (err) {
    if (err instanceof Problem) return err.message;
    throw err;
  }
};

/** A resident as other people see it, checked. */
export function cleanPublicResident(v: unknown): PublicResident | string {
  return attempt(() => {
    const r = resident(v, 'resident', false);
    const { memory: _m, trip: _t, from: _f, ...rest } = r;
    return rest;
  });
}

/** A resident of the person's own island (kept on the device), checked. */
export function cleanResident(v: unknown): Resident | string {
  return attempt(() => resident(v, 'resident', true));
}

/** A published island, checked and copied with known fields only. */
export function cleanPublicIsland(v: unknown): PublicIsland | string {
  return attempt(() => {
    if (!isRec(v)) return no('island', 'expected object');
    const residents = arr(v.residents, 'island.residents', LIMITS.residents).map((r, i) => {
      const { memory: _m, trip: _t, from: _f, ...rest } = resident(r, `island.residents[${i}]`, false);
      return rest;
    });
    const houses = arr(v.houses, 'island.houses', LIMITS.houses).map((h, i) => house(h, `island.houses[${i}]`));
    const paths = arr(v.paths ?? [], 'island.paths', LIMITS.paths).map((p, i) => {
      const pair = arr(p, `island.paths[${i}]`, 2, 2);
      return [str(pair[0], `island.paths[${i}][0]`, LIMITS.id), str(pair[1], `island.paths[${i}][1]`, LIMITS.id)] as [string, string];
    });
    const props = arr(v.props ?? [], 'island.props', LIMITS.islandProps).map((p, i) => placed(p, `island.props[${i}]`));
    const idValue = typeof v.id === 'string' && ISLAND_ID.test(v.id) ? v.id : 'new';
    return {
      id: idValue,
      name: str(v.name, 'island.name', LIMITS.islandName),
      seed: Math.floor(num(v.seed, 'island.seed', 0, 2 ** 32)),
      radius: num(v.radius, 'island.radius', 2, 60),
      residents,
      houses,
      paths,
      props,
      createdAt: num(v.createdAt ?? 0, 'island.createdAt', 0, 1e14),
    };
  });
}

/** A guest record from the server or another island. */
export function cleanGuest(v: unknown): Guest | string {
  return attempt(() => {
    if (!isRec(v)) return no('guest', 'expected object');
    const r = cleanPublicResident(v.resident);
    if (typeof r === 'string') return no('guest', r);
    return {
      resident: r,
      fromId: str(v.fromId, 'guest.fromId', 40),
      fromName: str(v.fromName, 'guest.fromName', LIMITS.islandName),
      arrivedAt: num(v.arrivedAt, 'guest.arrivedAt', 0, 1e14),
      leavesAt: num(v.leavesAt, 'guest.leavesAt', 0, 1e14),
    };
  });
}

/** What the person's island publishes: no memories of them, no events, no mail, no keys. */
export function publicSnapshot(state: IslandState): PublicIsland {
  return {
    id: state.published?.id ?? state.id,
    name: state.name,
    seed: state.seed,
    radius: state.radius,
    residents: state.residents.map(({ memory: _m, trip: _t, from: _f, lastTalkAt: _l, ...rest }) => structuredClone(rest)),
    houses: structuredClone(state.houses),
    paths: structuredClone(state.paths),
    props: structuredClone(state.props),
    createdAt: state.createdAt,
  };
}

export function summaryOf(island: PublicIsland, updatedAt: number, demo = false): IslandSummary {
  const out: IslandSummary = {
    id: island.id,
    name: island.name,
    residents: island.residents.length,
    houses: island.houses.length,
    updatedAt,
    faces: island.residents.slice(0, 6).map((r) => ({ name: r.name, species: r.species, trade: r.trade, main: r.colors.main })),
  };
  if (demo) out.demo = true;
  return out;
}

/** An island someone else owns, as the app renders it when the person flies there. */
export function islandFromPublic(island: PublicIsland, guests: Guest[] = []): IslandState {
  return {
    id: island.id,
    name: island.name,
    seed: island.seed,
    visibility: 'public',
    radius: island.radius,
    residents: island.residents.map((r) => ({ ...structuredClone(r), memory: [] })),
    houses: structuredClone(island.houses),
    paths: structuredClone(island.paths),
    props: structuredClone(island.props),
    events: [],
    createdAt: island.createdAt,
    lastVisit: 0,
    visitors: guests.map((g) => ({ ...structuredClone(g.resident), memory: [], from: { islandId: g.fromId, islandName: g.fromName, returnsAt: g.leavesAt } })),
  };
}
