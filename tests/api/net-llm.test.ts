/**
 * The client side of the API (src/net/llm.ts and src/net/api.ts) against the real route
 * handlers or a stub fetch: what goes on the wire, how refusals arrive as typed errors,
 * the kept status, recorded answers through `forceLive`, and the failures on purpose.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { iceServers } from '../../api/_lib/ice';
import { createMemoryKv } from '../../api/_lib/kv';
import { createFixtures, fixtureList } from '../../api/_lib/llm/fixtures';
import { createLlmRoutes } from '../../api/_lib/llm/route';
import type { AnswerSet, LlmRequest, LlmStatus } from '../../src/agents/types';
import { FALLBACK_ICE, createApi } from '../../src/net/api';
import { createNet } from '../../src/net/client';
import { LlmError, createNetLlm, watchStatus } from '../../src/net/llm';
import { jsonResponse } from './helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYNTHETIC = JSON.parse(readFileSync(path.join(HERE, 'fixtures/synthetic.answers.json'), 'utf8')) as AnswerSet;

const req = (overrides: Partial<LlmRequest> = {}): LlmRequest => ({
  task: 'extract',
  index: 0,
  attempt: 1,
  payload: { pairKeys: ['pair-a'] },
  messages: [{ role: 'user', content: 'Page 2.' }],
  schema: { type: 'object' },
  runId: 'run-1',
  ...overrides,
});

/** The real /api/llm handlers on the fixtures provider, as fetch. */
function fixturesServer(env: Record<string, string> = {}) {
  const routes = createLlmRoutes({
    env: () => ({ LLM_PROVIDER: 'fixtures', API_TEST_FAIL: '1', ...env }),
    kv: () => kv,
    adapters: { fixtures: () => createFixtures(fixtureList([SYNTHETIC])) },
    log: () => undefined,
  });
  const kv = createMemoryKv();
  const seen: { body: Record<string, unknown> | null; headers: Headers }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const request = new Request(new URL(url, 'https://site.example'), init);
    seen.push({ body: init?.body ? JSON.parse(String(init.body)) : null, headers: new Headers(init?.headers) });
    return request.method === 'GET' ? routes.GET(request) : routes.POST(request);
  };
  return { fetch, seen };
}

describe('the network LlmClient', () => {
  it('sends everything but the payload and returns the answer', async () => {
    const server = fixturesServer();
    const llm = createNetLlm({ fetch: server.fetch });
    const res = await llm.call(req({ fixture: 'synthetic/full/extract/0/1' }));
    expect(res).toMatchObject({ provider: 'fixtures', model: 'recorded', ms: 6200 });
    expect(server.seen[0].body).not.toHaveProperty('payload');
    expect(server.seen[0].body).toMatchObject({ task: 'extract', index: 0, attempt: 1, runId: 'run-1' });
  });

  it('turns refusals into LlmError with code, need and retryAfter', async () => {
    const llm = createNetLlm({ fetch: fixturesServer().fetch });
    const missing = await llm.call(req({ fixture: 'synthetic/full/extract/7/1' })).catch((e: unknown) => e);
    expect(missing).toBeInstanceOf(LlmError);
    expect(missing).toMatchObject({ code: 'agents-offline', need: 'fixture', status: 503 });

    llm.failNext('429');
    const limited = await llm.call(req({ fixture: 'synthetic/full/plan/0/1' })).catch((e: unknown) => e);
    expect(limited).toMatchObject({ code: 'rate-limited', retryAfter: 2 });
    // failNext is one call only: the queue's retry goes through.
    await expect(llm.call(req({ fixture: 'synthetic/full/plan/0/1' }))).resolves.toMatchObject({ provider: 'fixtures' });

    const offline = createNetLlm({ fetch: async () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(offline.call(req())).rejects.toMatchObject({ code: 'offline' });
    const html = createNetLlm({ fetch: async () => new Response('<html>502</html>', { status: 502 }) });
    await expect(html.call(req())).rejects.toMatchObject({ code: 'provider-error', status: 502 });
  });

  it('rejects with the abort itself when the caller cancels', async () => {
    const llm = createNetLlm({
      fetch: (_u, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    });
    const controller = new AbortController();
    const pending = llm.call(req(), { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(LlmError);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('fails the n-th call of a run with failAt', async () => {
    const server = fixturesServer();
    const llm = createNetLlm({ fetch: server.fetch });
    llm.failAt(3, '401');
    const key = { fixture: 'synthetic/full/plan/0/1' };
    await llm.call(req(key));
    await llm.call(req(key));
    await expect(llm.call(req(key))).rejects.toMatchObject({ code: 'agents-offline', need: 'key' });
    await expect(llm.call(req(key))).resolves.toBeTruthy();
    expect(server.seen.map((s) => s.headers.get('x-test-fail'))).toEqual([null, null, '401', null]);
  });

  it('runs the live path on recorded answers with forceLive, and picks reconcile verdicts on the client', async () => {
    const server = fixturesServer();
    const pick = vi.fn((request: LlmRequest, json: unknown) => {
      const wanted = (request.payload as { pairKeys: string[] }).pairKeys;
      const all = (json as { verdicts: Record<string, string> }).verdicts;
      return { verdicts: Object.fromEntries(wanted.map((k) => [k, all[k] ?? 'unjudged'])) };
    });
    const llm = createNetLlm({ fetch: server.fetch, pickRecorded: pick });
    expect((await llm.status()).live).toBe(false);
    llm.forceLive('fixtures', { example: 'synthetic', scope: 'full' });
    expect(await llm.status()).toMatchObject({ live: true, provider: 'fixtures' });
    const res = await llm.call(req({ task: 'reconcile' }));
    expect(server.seen.at(-1)!.body!.fixture).toBe('synthetic/full/reconcile/0/1');
    expect(res.json).toEqual({ verdicts: { 'pair-a': 'contradiction' } });
    llm.forceLive(null);
    expect((await llm.status()).live).toBe(false);
  });

  it('keeps the status five minutes, asks once for parallel looks, and says live: false when unreachable', async () => {
    let t = 0;
    const status: LlmStatus = { live: true, provider: 'openrouter', model: 'cheap/flash-a', audio: false, callsLeftToday: 50, runsLeftToday: 2 };
    const fetch = vi.fn(async () => jsonResponse(200, status));
    const llm = createNetLlm({ fetch, now: () => t });
    const [a, b] = await Promise.all([llm.status(), llm.status()]);
    expect(a).toEqual(status);
    expect(b).toEqual(status);
    t = 299_000;
    await llm.status();
    expect(fetch).toHaveBeenCalledTimes(1);
    t = 301_000;
    await llm.status();
    expect(fetch).toHaveBeenCalledTimes(2);

    const down = createNetLlm({ fetch: async () => Promise.reject(new TypeError('Failed to fetch')) });
    expect(await down.status()).toMatchObject({ live: false, callsLeftToday: 0, runsLeftToday: 0 });
  });

  it('looks again after a daily-cap refusal', async () => {
    const status: LlmStatus = { live: true, provider: 'openrouter', model: 'm', audio: false, callsLeftToday: 5, runsLeftToday: 1 };
    let calls = 0;
    const llm = createNetLlm({
      fetch: async (_u, init) => {
        if (init?.method === 'POST') return jsonResponse(429, { error: 'daily-cap' });
        calls += 1;
        return jsonResponse(200, status);
      },
    });
    await llm.status();
    await expect(llm.call(req())).rejects.toMatchObject({ code: 'daily-cap' });
    await llm.status();
    expect(calls).toBe(2);
  });

  it('carries the development headers of Node scripts', async () => {
    const server = fixturesServer();
    const llm = createNetLlm({ fetch: server.fetch, devToken: 'dev-secret', devBudget: 'records' });
    await llm.call(req({ fixture: 'synthetic/full/plan/0/1' }));
    expect(server.seen[0].headers.get('x-dev-token')).toBe('dev-secret');
    expect(server.seen[0].headers.get('x-dev-budget')).toBe('records');
  });

  it('watches the status now and every five minutes until stopped', async () => {
    const seen: LlmStatus[] = [];
    let tick: (() => void) | null = null;
    const status: LlmStatus = { live: false, provider: 'fixtures', model: 'recorded', audio: false, callsLeftToday: 0, runsLeftToday: 0 };
    const stop = watchStatus({ status: async () => status }, (s) => seen.push(s), { set: (fn) => (tick = fn), clear: () => (tick = null) });
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    tick!();
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    stop();
    expect(tick).toBeNull();
  });
});

describe('the typed API client', () => {
  const make = (fetch: (url: string, init?: RequestInit) => Promise<Response>, ownerKey: string | null = 'owner-key-1') =>
    createApi({ net: createNet({ fetch }), ownerKey: () => ownerKey });

  it('returns server-off instead of throwing when the server is away or not ours', async () => {
    const away = make(async () => Promise.reject(new TypeError('Failed to fetch')));
    expect(await away.readCode('x4km7')).toEqual({ ok: false, error: { code: 'server-off', status: 0 } });
    const platform = make(async () => new Response('<html>The page could not be found</html>', { status: 404 }));
    expect((await platform.readWorld('quiet-meadow-27')).ok).toBe(false);
    const noFunction = make(async () => jsonResponse(404, { error: 'not-found', route: false }));
    expect(await noFunction.ice()).toMatchObject({ ok: false, error: { code: 'server-off' } });
    const unconfigured = make(async () => jsonResponse(503, { error: 'storage-off' }));
    expect(await unconfigured.createCode({ kind: 'drop' })).toMatchObject({ ok: false, error: { code: 'server-off' } });
  });

  it('gives storage-busy for both busy and readonly, and passes other refusals with their fields', async () => {
    const readonly = make(async () => jsonResponse(503, { error: 'storage-readonly' }));
    expect(await readonly.createCode({ kind: 'drop' })).toEqual({ ok: false, error: { code: 'storage-busy', status: 503 } });
    const busy = make(async () => jsonResponse(503, { error: 'storage-busy' }));
    expect(await busy.createCode({ kind: 'drop' })).toEqual({ ok: false, error: { code: 'storage-busy', status: 503 } });
    const conflict = make(async () => jsonResponse(409, { error: 'conflict', current: 7 }));
    const world = { name: 'quiet-meadow-27', title: 'Mine', rev: 6, plots: [] };
    expect(await conflict.putWorld(world, 6)).toEqual({ ok: false, error: { code: 'conflict', status: 409, current: 7 } });
    const missing = make(async () => jsonResponse(404, { error: 'not-found' }));
    expect(await missing.readCode('X0000')).toEqual({ ok: false, error: { code: 'not-found', status: 404 } });
  });

  it('sends the owner key and if-match, and refuses owner routes without a key on this device', async () => {
    const fetch = vi.fn(async (_u: string, _i?: RequestInit) => jsonResponse(200, { rev: 7 }));
    const api = make(fetch);
    const world = { name: 'quiet-meadow-27', title: 'Mine', rev: 6, plots: [] };
    expect(await api.putWorld(world, 6)).toEqual({ ok: true, value: { rev: 7 } });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/worlds/quiet-meadow-27');
    expect(init?.method).toBe('PUT');
    const headers = new Headers(init?.headers);
    expect(headers.get('x-owner-key')).toBe('owner-key-1');
    expect(headers.get('if-match')).toBe('6');
    const keyless = make(fetch, null);
    expect(await keyless.createCode({ kind: 'visit', target: 'quiet-meadow-27' })).toEqual({ ok: false, error: { code: 'forbidden', status: 0 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('ICE servers', () => {
  it('gives public STUN only, and relay: false, without TURN variables or with half of them', () => {
    expect(iceServers({})).toEqual({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }], relay: false });
    expect(iceServers({ TURN_URLS: 'turn:relay.example:3478' }).relay).toBe(false);
    expect(iceServers({ TURN_CREDENTIAL: 'name:pass' }).relay).toBe(false);
    expect(FALLBACK_ICE.relay).toBe(false);
  });

  it('adds TURN with its credential when both variables are set', () => {
    const answer = iceServers({ TURN_URLS: 'turn:relay.example:3478, turns:relay.example:443?transport=tcp', TURN_CREDENTIAL: 'user:pa:ss' });
    expect(answer.relay).toBe(true);
    expect(answer.iceServers[1]).toEqual({ urls: ['turn:relay.example:3478', 'turns:relay.example:443?transport=tcp'], username: 'user', credential: 'pa:ss' });
  });
});
