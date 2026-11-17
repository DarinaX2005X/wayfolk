/**
 * Demo islands on the horizon, so it is never empty: three or four public islands with
 * prepared residents (content/islands.json). The server lists and serves them like
 * published islands; the client falls back to them when the server cannot be reached.
 */
import islandsJson from '../../content/islands.json';
import type { PublicIsland } from '../../api/_lib/contracts';
import { cleanPublicIsland } from './check';

export type DemoIsland = { id: string; island: PublicIsland };

export const DEMO_ISLANDS: DemoIsland[] = (islandsJson as { islands: unknown[] }).islands.flatMap((raw) => {
  const island = cleanPublicIsland(raw);
  if (typeof island === 'string') {
    console.warn(`[mind] demo island skipped: ${island}`);
    return [];
  }
  return [{ id: island.id, island }];
});
