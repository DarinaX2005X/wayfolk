/**
 * The live events of doing things together. Every kind is a plain relay event
 * (`live.send(kind, data)`); none is in HOST_ONLY_EVENTS, so both people may send them.
 * Where one decision is needed (when a plank is laid, when the lanterns met) the host
 * decides and the guest follows. Every payload is cleaned on arrival.
 */
import { cleanBridge, cleanIsland, cleanStar, type BridgeRecord, type NeighbourIsland, type SlotId, type StarRecord } from './records';

export const TG = {
  /** Each side, on meeting: its own island (small summary) and the islands it is bridged to. */
  hello: 'tg-hello',
  /** Host: the guest's island drifts in and docks in this slot now. */
  dock: 'tg-dock',
  /** Either: I hold (or let go of) my end of the bridge rope. */
  hold: 'tg-hold',
  /** Host: the birds lifted plank i of n. */
  plank: 'tg-plank',
  /** Host: the bridge is finished; both keep it. */
  built: 'tg-built',
  /** Either: the duet by the fire opens or closes. */
  duet: 'tg-duet',
  /** Either: I struck chime i of my set. */
  chime: 'tg-chime',
  /** Either: I let my lantern go from here. */
  lantern: 'tg-lantern',
  /** Host: the two lanterns met and became this constellation. */
  stars: 'tg-stars',
  /** Either: a high five happened here (island frame). */
  five: 'tg-five',
  /** Either (a page without hands): my hand is up for a high five, or down. */
  offer: 'tg-offer',
} as const;

export type TgKind = (typeof TG)[keyof typeof TG];
export const TG_KINDS: readonly string[] = Object.values(TG);

export type V3 = [number, number, number];

export interface TgPayloads {
  'tg-hello': { island: NeighbourIsland; built: string[] };
  'tg-dock': { island: NeighbourIsland; slot: SlotId };
  'tg-hold': { on: boolean };
  'tg-plank': { i: number; n: number };
  'tg-built': { bridge: BridgeRecord };
  'tg-duet': { on: boolean };
  'tg-chime': { i: number; v: number };
  'tg-lantern': { at: V3 };
  'tg-stars': { star: StarRecord };
  'tg-five': { at: V3 };
  'tg-offer': { on: boolean };
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec = (v: unknown, limit = 400): V3 | null => {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) return null;
  return [Math.max(-limit, Math.min(limit, v[0])), Math.max(-limit, Math.min(limit, v[1])), Math.max(-limit, Math.min(limit, v[2]))];
};

/** Cleans the data of a together event; null when it is not well formed. */
export function cleanPayload<K extends TgKind>(kind: K, d: unknown): TgPayloads[K] | null {
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  switch (kind) {
    case TG.hello: {
      const island = cleanIsland(o.island);
      if (!island) return null;
      const built = Array.isArray(o.built) ? o.built.filter((x): x is string => typeof x === 'string').slice(0, 4) : [];
      return { island, built } as TgPayloads[K];
    }
    case TG.dock: {
      const island = cleanIsland(o.island);
      return island ? ({ island, slot: o.slot === 'west' ? 'west' : 'east' } as TgPayloads[K]) : null;
    }
    case TG.hold:
    case TG.duet:
    case TG.offer:
      return typeof o.on === 'boolean' ? ({ on: o.on } as TgPayloads[K]) : null;
    case TG.plank:
      return finite(o.i) && finite(o.n) && o.n > 0 && o.n <= 64 && o.i >= 0 && o.i < o.n ? ({ i: Math.floor(o.i), n: Math.floor(o.n) } as TgPayloads[K]) : null;
    case TG.built: {
      const bridge = cleanBridge(o.bridge);
      return bridge ? ({ bridge } as TgPayloads[K]) : null;
    }
    case TG.chime:
      return finite(o.i) && o.i >= 0 && o.i < 8 ? ({ i: Math.floor(o.i), v: finite(o.v) ? Math.max(0.2, Math.min(1, o.v)) : 0.7 } as TgPayloads[K]) : null;
    case TG.lantern:
    case TG.five: {
      const at = vec(o.at);
      return at ? ({ at } as TgPayloads[K]) : null;
    }
    case TG.stars: {
      const star = cleanStar(o.star);
      return star ? ({ star } as TgPayloads[K]) : null;
    }
    default:
      return null;
  }
}
