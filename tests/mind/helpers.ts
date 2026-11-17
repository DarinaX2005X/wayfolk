/**
 * Shared stand-ins for the mind tests: a clock, a seeded random, a fetch that serves
 * /api/islands from the real handlers over a memory store, and a model client that
 * answers from a script.
 */
import { createIslandRoutes } from '../../api/_lib/islands';
import { createMemoryKv, type KV } from '../../api/_lib/kv';
import type { ModelCall, ModelClient, ModelResult } from '../../src/mind/llm';

export function clock(start = new Date(2026, 10, 17, 14, 0, 0).getTime()) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms), set: (ms: number) => void (t = ms) };
}

/** Mulberry32: the same numbers every run. */
export function seeded(seed = 7): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fetch that serves /api/islands with the real handlers; anything else fails like a network error. */
export function islandsServer(now: () => number, kv: KV = createMemoryKv({ now })) {
  const routes = createIslandRoutes({ kv: () => kv, now, log: () => undefined });
  let seq = 0;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://test.local');
    if (!url.pathname.startsWith('/api/islands')) throw new TypeError('network');
    const headers = new Headers(init?.headers);
    headers.set('x-real-ip', `10.0.0.${1 + (seq++ % 3)}`);
    const request = new Request(url, { method: init?.method ?? 'GET', headers, body: init?.body });
    const method = request.method as 'GET' | 'POST' | 'PUT' | 'DELETE';
    return routes[method](request);
  }) as typeof fetch;
  return { fetch: fetchFn, kv, routes };
}

/** A model client that answers each call with the next scripted result for its task. */
export function scriptedModel(script: Partial<Record<ModelCall['task'], (call: ModelCall) => ModelResult>>, audio = true) {
  const calls: ModelCall[] = [];
  const client: ModelClient = {
    stats: { calls: 0, failures: 0, lastMs: 0 },
    async available() {
      return true;
    },
    async status() {
      return { live: true, audio };
    },
    async call(c) {
      calls.push(c);
      const answer = script[c.task];
      return answer ? answer(c) : { ok: false, reason: 'busy', ms: 1 };
    },
  };
  return { client, calls };
}
