/**
 * The prepared set: travelers recorded once from the model and edited by hand
 * (content/travelers.json, every one `prepared: true`), and short lines per trade for
 * talk, gifts, news and trips when no live model is available (content/lines.json).
 */
import linesJson from '../../content/lines.json';
import travelersJson from '../../content/travelers.json';
import { cleanResident } from './check';
import { TRADES, type Resident, type Trade } from './types';

export { DEMO_ISLANDS } from './demo';

export type TradeLines = {
  greet: string[];
  chat: string[];
  stay: string[];
  leave: string[];
  giftLove: string[];
  giftLike: string[];
  hint: string[];
  /** Third person, with {name}. */
  news: string[];
  /** First person, with {island}. */
  tripStory: string[];
};

const raw = travelersJson as { first: string[]; travelers: unknown[] };

export const PREPARED: Resident[] = raw.travelers.flatMap((t) => {
  const r = cleanResident(t);
  if (typeof r === 'string') {
    console.warn(`[mind] prepared traveler skipped: ${r}`);
    return [];
  }
  return [{ ...r, prepared: true, memory: [], arrivedAt: 0 }];
});

/** Strong travelers for the first minute of a new island. */
export const FIRST_IDS: string[] = raw.first.filter((id) => PREPARED.some((p) => p.id === id));

const lines = linesJson as unknown as Record<Trade, TradeLines>;

export const LINES: Record<Trade, TradeLines> = Object.fromEntries(TRADES.map((t) => [t, lines[t]])) as Record<Trade, TradeLines>;
