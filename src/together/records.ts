/**
 * What stays after two people did something together: the bridges to friends' islands
 * (with a small copy of each friend's island to draw it docked) and the constellations
 * made from twin lanterns. Pure data and storage, no Three.js.
 *
 * The record lives in this module's own storage (`wf.together.v1:<island id>`) and is
 * mirrored into the optional field `IslandState.together`, so a friend who visits live
 * sees the bridges and stars in the host's snapshot and mind keeps them with the island.
 */
import type { HouseSpec, IslandState, Resident, Trade } from '../mind/types';

export type SlotId = 'east' | 'west';

/** A friend's island as much as is needed to draw it docked and to let its folk walk. */
export interface NeighbourIsland {
  id: string;
  name: string;
  /** The friend's name (their live tag). */
  owner: string;
  /** Their colour in live visits. */
  color: string;
  seed: number;
  houses: { id: string; recipe: Trade; colors: HouseSpec['colors']; sign?: string }[];
  residents: Resident[];
}

export interface BridgeRecord {
  island: NeighbourIsland;
  slot: SlotId;
  builtAt: number;
  /** Who held the two ends: [this island's person, the friend]. */
  names: [string, string];
}

export interface StarRecord {
  id: string;
  /** The two people whose lanterns met. */
  names: [string, string];
  at: number;
  seed: number;
  /** Where it hangs: unit direction from the viewer (island frame). */
  dir: [number, number, number];
}

export interface TogetherRecord {
  v: 1;
  bridges: BridgeRecord[];
  stars: StarRecord[];
}

export const MAX_BRIDGES = 2;
export const MAX_STARS = 12;
const MAX_RESIDENTS = 3;
const MAX_HOUSES = 2;

export function emptyRecord(): TogetherRecord {
  return { v: 1, bridges: [], stars: [] };
}

const str = (v: unknown, max: number, fallback = ''): string => (typeof v === 'string' ? v.slice(0, max) : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const HEX = /^#[0-9a-f]{6}$/i;
const hex = (v: unknown, fallback: string): string => (typeof v === 'string' && HEX.test(v) ? v : fallback);
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const TRADES: Trade[] = ['baker', 'stargazer', 'fisher', 'gardener', 'tinkerer', 'storyteller', 'tea-maker', 'musician', 'painter', 'beekeeper', 'lighthouse-keeper', 'cartographer'];

/** A resident small enough to travel in an event, with only what life needs to show them. */
export function trimResident(r: Resident): Resident {
  return {
    id: r.id,
    name: r.name,
    species: r.species,
    trade: r.trade,
    vehicle: r.vehicle,
    personality: str(r.personality, 160),
    voice: { pitch: num(r.voice?.pitch, 1), rate: num(r.voice?.rate, 1), timbre: r.voice?.timbre ?? 'warm' },
    colors: { main: hex(r.colors?.main, '#d9a066'), accent: hex(r.colors?.accent, '#8a5a3b') },
    story: { intro: str(r.story?.intro, 160), beats: [], secret: '', revealed: 0 },
    likes: Array.isArray(r.likes) ? r.likes.slice(0, 3).map((x) => str(x, 16)) : [],
    memory: [],
    arrivedAt: num(r.arrivedAt),
    houseId: r.houseId,
    tagline: r.tagline ? str(r.tagline, 60) : undefined,
  };
}

/** The friend's own island, summarised for the bridge (well under the 16 KB event limit). */
export function summarize(state: IslandState | null | undefined, owner: string, color: string): NeighbourIsland {
  const s = state ?? ({} as Partial<IslandState>);
  const houses = (s.houses ?? []).slice(-MAX_HOUSES).map((h) => ({ id: h.id, recipe: h.recipe, colors: h.colors, sign: h.sign }));
  const homed = new Set(houses.map((h) => h.id));
  const residents = (s.residents ?? [])
    .filter((r) => !r.trip)
    .sort((a, b) => Number(homed.has(b.houseId ?? '')) - Number(homed.has(a.houseId ?? '')))
    .slice(0, MAX_RESIDENTS)
    .map(trimResident);
  return {
    id: typeof s.id === 'string' && s.id ? s.id : `isle-${owner.toLowerCase().replace(/[^a-z0-9]/g, '') || 'friend'}`,
    name: str(s.name, 40) || `${owner}'s island`,
    owner: str(owner, 24, 'Friend'),
    color: hex(color, '#3f9e98'),
    seed: num(s.seed, 7) >>> 0,
    houses,
    residents,
  };
}

/** Checks a neighbour island that came over the wire; null when it is not one. */
export function cleanIsland(v: unknown): NeighbourIsland | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID.test(o.id)) return null;
  const houses = Array.isArray(o.houses)
    ? o.houses.slice(0, MAX_HOUSES).flatMap((h) => {
        const x = h as Record<string, unknown>;
        const colors = (x?.colors ?? {}) as Record<string, unknown>;
        if (typeof x?.id !== 'string' || !TRADES.includes(x.recipe as Trade)) return [];
        return [{ id: str(x.id, 64), recipe: x.recipe as Trade, colors: { wall: hex(colors.wall, '#efe2c8'), roof: hex(colors.roof, '#c8553d'), trim: hex(colors.trim, '#7b4b2e') }, sign: x.sign ? str(x.sign, 24) : undefined }];
      })
    : [];
  const residents = Array.isArray(o.residents)
    ? o.residents.slice(0, MAX_RESIDENTS).flatMap((r) => {
        const x = r as Resident;
        if (!x || typeof x.id !== 'string' || typeof x.name !== 'string' || typeof x.species !== 'string' || !TRADES.includes(x.trade)) return [];
        return [trimResident(x)];
      })
    : [];
  return {
    id: o.id,
    name: str(o.name, 40, 'a small island'),
    owner: str(o.owner, 24, 'Friend'),
    color: hex(o.color, '#3f9e98'),
    seed: num(o.seed, 7) >>> 0,
    houses,
    residents,
  };
}

export function cleanBridge(v: unknown): BridgeRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const island = cleanIsland(o.island);
  if (!island) return null;
  const names = Array.isArray(o.names) ? o.names : [];
  return {
    island,
    slot: o.slot === 'west' ? 'west' : 'east',
    builtAt: num(o.builtAt, Date.now()),
    names: [str(names[0], 24, 'You'), str(names[1], 24, 'Friend')],
  };
}

export function cleanStar(v: unknown): StarRecord | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || !ID.test(o.id)) return null;
  const names = Array.isArray(o.names) ? o.names : [];
  const d = Array.isArray(o.dir) ? o.dir.map((x) => num(x)) : [0, 0.6, -0.8];
  const len = Math.hypot(d[0] ?? 0, d[1] ?? 0, d[2] ?? 0) || 1;
  return {
    id: o.id,
    names: [str(names[0], 24, 'You'), str(names[1], 24, 'Friend')],
    at: num(o.at, Date.now()),
    seed: num(o.seed, 1) >>> 0,
    dir: [(d[0] ?? 0) / len, Math.max(0.25, (d[1] ?? 0.6) / len), (d[2] ?? -0.8) / len],
  };
}

export function cleanRecord(v: unknown): TogetherRecord {
  const out = emptyRecord();
  if (!v || typeof v !== 'object') return out;
  const o = v as Record<string, unknown>;
  if (Array.isArray(o.bridges)) for (const b of o.bridges) addBridge(out, cleanBridge(b));
  if (Array.isArray(o.stars)) for (const s of o.stars) addStar(out, cleanStar(s));
  return out;
}

/** Adds or refreshes a bridge (one per friend's island; the slot of an old one is kept). */
export function addBridge(rec: TogetherRecord, b: BridgeRecord | null): boolean {
  if (!b) return false;
  const old = rec.bridges.find((x) => x.island.id === b.island.id);
  if (old) {
    old.island = b.island;
    return false;
  }
  if (rec.bridges.length >= MAX_BRIDGES) return false;
  const taken = new Set(rec.bridges.map((x) => x.slot));
  const slot: SlotId = taken.has(b.slot) ? (b.slot === 'east' ? 'west' : 'east') : b.slot;
  rec.bridges.push({ ...b, slot });
  return true;
}

export function addStar(rec: TogetherRecord, s: StarRecord | null): boolean {
  if (!s || rec.stars.some((x) => x.id === s.id)) return false;
  rec.stars.push(s);
  if (rec.stars.length > MAX_STARS) rec.stars.splice(0, rec.stars.length - MAX_STARS);
  return true;
}

/** The free slot for a new neighbour, or null when both are taken. */
export function freeSlot(rec: TogetherRecord): SlotId | null {
  const taken = new Set(rec.bridges.map((b) => b.slot));
  return !taken.has('east') ? 'east' : !taken.has('west') ? 'west' : null;
}

export function mergeRecords(a: TogetherRecord, b: TogetherRecord): TogetherRecord {
  const out = cleanRecord(a);
  for (const x of b.bridges) addBridge(out, x);
  for (const s of b.stars) addStar(out, s);
  return out;
}

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void } | null | undefined;

export const storageKey = (islandId: string): string => `wf.together.v1:${islandId}`;

export function loadRecord(storage: StorageLike, islandId: string): TogetherRecord {
  try {
    const raw = storage?.getItem(storageKey(islandId));
    return raw ? cleanRecord(JSON.parse(raw)) : emptyRecord();
  } catch {
    return emptyRecord();
  }
}

export function saveRecord(storage: StorageLike, islandId: string, rec: TogetherRecord): void {
  try {
    storage?.setItem(storageKey(islandId), JSON.stringify(rec));
  } catch {
    // A full or blocked storage keeps the record for this session only.
  }
}

/** The record an island carries in its own state (mind keeps the optional field as is). */
export function stateRecord(state: IslandState | null | undefined): TogetherRecord {
  return cleanRecord((state as (IslandState & { together?: unknown }) | null | undefined)?.together);
}

export function writeStateRecord(state: IslandState | null | undefined, rec: TogetherRecord): void {
  if (state) (state as IslandState & { together?: TogetherRecord }).together = rec;
}
