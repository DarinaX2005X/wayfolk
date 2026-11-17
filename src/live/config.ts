/**
 * Where the live relay lives. A public workers.dev address, not a secret. `VITE_LIVE_RELAY`
 * overrides it at build time (a local `npx wrangler dev` in relay/, for example).
 */
const fromEnv = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_LIVE_RELAY;

export const LIVE_RELAY = (fromEnv || 'https://wayfolk-relay.darinax2005x.workers.dev').replace(/\/+$/, '');

/** Presence rate while someone is watching and the person moves. */
export const PRESENCE_HZ = 15;

/** The link a friend opens: the island page with the join code (and the island, for the fallback). */
export const LINK_PATH = '/island';
