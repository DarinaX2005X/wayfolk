/**
 * The model proxy (api/_lib/llm/) on stubbed fetch: both provider adapters, the error
 * table, the model fallback, the spending guard with each of its five conditions, cost
 * accounting, development budgets, the status and the `fixtures` provider. No request
 * leaves the process and no key is used.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMemoryKv, KvError, type KV } from '../../api/_lib/kv';
import { fixtureList } from '../../api/_lib/llm/fixtures';
import { createFixtures } from '../../api/_lib/llm/fixtures';
import { geminiSchema } from '../../api/_lib/llm/gemini';
import { keys, utcDay } from '../../api/_lib/llm/guard';
import { createLlmRoutes, type LlmDeps } from '../../api/_lib/llm/route';
import { parseModelJson, strictSchema, validate } from '../../api/_lib/llm/schema';
import type { AnswerSet, JsonSchema, LlmStatus } from '../../src/agents/types';
import { jsonResponse } from './helpers';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYNTHETIC = JSON.parse(readFileSync(path.join(HERE, 'fixtures/synthetic.answers.json'), 'utf8')) as AnswerSet;

const NOW = Date.UTC(2026, 10, 16, 12, 0, 0);
const DAY = utcDay(NOW);
const KEY = 'sk-or-v1-test0000000000000000';

const SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      maxItems: 5,
      items: { type: 'object', properties: { quote: { type: 'string' }, page: { type: 'integer' } }, required: ['quote', 'page'] },
    },
    kind: { type: 'string', enum: ['lease', 'email'] },
  },
  required: ['claims', 'kind'],
};
const GOOD = { claims: [{ quote: 'the key was returned on 3 March', page: 2 }], kind: 'lease' };

const BASE_ENV = {
  LLM_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: KEY,
  LLM_MODEL: 'cheap/flash-a,cheap/flash-b',
  LLM_DAILY_USD: '0.20',
  LLM_TOTAL_USD: '6.00',
  LLM_RUN_RESERVE_USD: '0.08',
  LLM_RUN_CALLS: '32',
  LLM_DAILY_RUNS_PER_ADDRESS: '2',
  LLM_VOICE_CALLS_PER_ADDRESS: '40',
};

type Sent = { url: string; body: Record<string, unknown>; headers: Headers };

/** A provider that answers from a queue (the last answer repeats). */
function provider(...answers: (Response | (() => Promise<Response>))[]) {
  const sent: Sent[] = [];
  const fetch = (async (url: string, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) });
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    return typeof next === 'function' ? next() : next.clone();
  }) as typeof globalThis.fetch;
  return { fetch, sent };
}

const orAnswer = (content: unknown, usage: Record<string, unknown> = { cost: 0.0021, prompt_tokens: 3000, completion_tokens: 900 }, model = 'cheap/flash-a') =>
  jsonResponse(200, { id: 'gen-1', model, choices: [{ message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content) } }], usage });

function setup(options: { env?: Record<string, string>; fetch?: typeof globalThis.fetch; kv?: KV | (() => KV); deadlineMs?: number; adapters?: LlmDeps['adapters'] } = {}) {
  const env = { ...BASE_ENV, ...options.env };
  const kv = options.kv ?? createMemoryKv({ now: () => NOW });
  const logs: Record<string, unknown>[] = [];
  const routes = createLlmRoutes({
    env: () => env,
    kv: typeof kv === 'function' ? kv : () => kv,
    fetch: options.fetch,
    now: () => NOW,
    log: (line) => logs.push(line),
    deadlineMs: options.deadlineMs,
    adapters: options.adapters,
  });
  const store = typeof kv === 'function' ? null : kv;
  return { routes, kv: store, logs, env };
}

let runSeq = 0;
const call = (overrides: Record<string, unknown> = {}) => ({
  task: 'extract',
  index: 0,
  attempt: 1,
  messages: [
    { role: 'system', content: 'Extract dated claims.' },
    { role: 'user', content: 'Page 2: the key was returned on 3 March.' },
  ],
  schema: SCHEMA,
  runId: `run-${++runSeq}`,
  ...overrides,
});

function post(body: unknown, headers: Record<string, string> = {}, ip = '203.0.113.7'): Request {
  return new Request('https://site.example/api/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': ip, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const get = (ip = '203.0.113.7') => new Request('https://site.example/api/llm', { headers: { 'x-real-ip': ip } });

async function answer(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('POST /api/llm on OpenRouter', () => {
  it('answers with the checked JSON and sends a strict schema, the model list, usage and the headers', async () => {
    const p = provider(orAnswer(GOOD));
    const { routes, kv } = setup({ fetch: p.fetch });
    const res = await answer(await routes.POST(post(call({ payload: { secret: 'stays on the client' } }))));
    expect(res).toMatchObject({ status: 200, body: { json: GOOD, provider: 'openrouter', model: 'cheap/flash-a' } });
    expect(typeof res.body.ms).toBe('number');

    const [sent] = p.sent;
    expect(sent.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(sent.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(sent.headers.get('x-title')).toBe('Groundwork');
    expect(sent.body.model).toBe('cheap/flash-a');
    expect(sent.body.models).toEqual(['cheap/flash-a', 'cheap/flash-b']);
    expect(sent.body.usage).toEqual({ include: true });
    expect(JSON.stringify(sent.body)).not.toContain('stays on the client');
    const format = sent.body.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: JsonSchema } };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.name).toBe('extract');
    const schema = format.json_schema.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties!.claims.items!.additionalProperties).toBe(false);
    expect(schema.properties!.kind.additionalProperties).toBeUndefined();

    // usage.cost 0.0021 USD -> 2100 micro-dollars on the day and the total.
    expect(await kv!.get(keys.dayUsd(DAY))).toBe(2100);
    expect(await kv!.get(keys.total)).toBe(2100);
    expect(await kv!.get(keys.dayCalls(DAY))).toBe(1);
  });

  it('sends audio as an input_audio part of the last user message, to the audio model', async () => {
    const p = provider(orAnswer({ heard: 'show contradictions', kind: 'lease', claims: [] }));
    const { routes } = setup({ fetch: p.fetch, env: { LLM_AUDIO_MODEL: 'cheap/audio-a' } });
    const res = await routes.POST(post(call({ task: 'intent', runId: undefined, audio: 'UklGRiQAAABXQVZF' })));
    expect(res.status).toBe(200);
    const messages = p.sent[0].body.messages as { role: string; content: unknown }[];
    expect(messages.at(-1)!.content).toEqual([
      { type: 'text', text: 'Page 2: the key was returned on 3 March.' },
      { type: 'input_audio', input_audio: { data: 'UklGRiQAAABXQVZF', format: 'wav' } },
    ]);
    expect(p.sent[0].body.model).toBe('cheap/audio-a');
    expect(p.sent[0].body.models).toBeUndefined();
  });

  it('maps a provider 429 to rate-limited with Retry-After, or 5 s, and gives the run slot back', async () => {
    const p = provider(jsonResponse(429, { error: { code: 429, message: 'Rate limit exceeded' } }, { 'retry-after': '7' }));
    const { routes, kv } = setup({ fetch: p.fetch });
    const body = call();
    expect(await answer(await routes.POST(post(body)))).toEqual({ status: 429, body: { error: 'rate-limited', retryAfter: 7 } });
    expect(await kv!.get(keys.runCalls(body.runId as string))).toBe(0);
    const q = provider(jsonResponse(429, { error: { code: 429, message: 'slow down' } }));
    const second = setup({ fetch: q.fetch });
    expect((await answer(await second.routes.POST(post(call())))).body).toEqual({ error: 'rate-limited', retryAfter: 5 });
  });

  it('maps 5xx and overload to provider-busy, 401 and 402 to agents-offline with need', async () => {
    for (const status of [500, 502, 503]) {
      const { routes } = setup({ fetch: provider(jsonResponse(status, { error: { code: status, message: 'down' } })).fetch });
      expect(await answer(await routes.POST(post(call())))).toEqual({ status: 503, body: { error: 'provider-busy' } });
    }
    const unauthorized = setup({ fetch: provider(jsonResponse(401, { error: { code: 401, message: 'No auth credentials found' } })).fetch });
    expect(await answer(await unauthorized.routes.POST(post(call())))).toEqual({ status: 503, body: { error: 'agents-offline', need: 'key' } });
    const broke = setup({ fetch: provider(jsonResponse(402, { error: { code: 402, message: 'Insufficient credits' } })).fetch });
    expect(await answer(await broke.routes.POST(post(call())))).toEqual({ status: 503, body: { error: 'agents-offline', need: 'credit' } });
  });

  it('reads an error inside a 200 the same way', async () => {
    const { routes } = setup({ fetch: provider(jsonResponse(200, { error: { code: 502, message: 'Provider returned error' } })).fetch });
    expect((await routes.POST(post(call()))).status).toBe(503);
  });

  it('answers 422 bad-output for text that is not JSON and for JSON that misses the schema, without a second call, and still counts the cost', async () => {
    const notJson = provider(orAnswer('Sure! Here are the claims: none'));
    const a = setup({ fetch: notJson.fetch });
    expect(await answer(await a.routes.POST(post(call())))).toEqual({ status: 422, body: { error: 'bad-output' } });
    expect(notJson.sent).toHaveLength(1);
    expect(await a.kv!.get(keys.dayUsd(DAY))).toBe(2100);

    const misfit = provider(orAnswer({ claims: [{ quote: 'x', page: 'two' }], kind: 'lease' }));
    const b = setup({ fetch: misfit.fetch });
    expect((await b.routes.POST(post(call()))).status).toBe(422);
    expect(b.logs.at(-1)).toMatchObject({ problem: '$.claims[0].page: expected integer' });

    const fenced = setup({ fetch: provider(orAnswer('```json\n' + JSON.stringify(GOOD) + '\n```')).fetch });
    expect((await fenced.routes.POST(post(call()))).status).toBe(200);
  });

  it('answers 504 when the provider does not answer in time', async () => {
    const hanging = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError'))))) as typeof fetch;
    const { routes } = setup({ fetch: hanging, deadlineMs: 40 });
    expect(await answer(await routes.POST(post(call())))).toEqual({ status: 504, body: { error: 'timeout' } });
  });

  it('answers 503 need key without a key, and never calls the provider', async () => {
    const p = provider(orAnswer(GOOD));
    const { routes } = setup({ fetch: p.fetch, env: { OPENROUTER_API_KEY: '' } });
    expect(await answer(await routes.POST(post(call())))).toEqual({ status: 503, body: { error: 'agents-offline', need: 'key' } });
    expect(p.sent).toHaveLength(0);
  });

  it('retries once with the next model when the first is refused (404), and gives need: model when both are', async () => {
    const p = provider(jsonResponse(404, { error: { code: 404, message: 'No endpoints found that support the requested parameters' } }), orAnswer(GOOD, undefined, 'cheap/flash-b'));
    const { routes } = setup({ fetch: p.fetch });
    const res = await answer(await routes.POST(post(call())));
    expect(res).toMatchObject({ status: 200, body: { model: 'cheap/flash-b' } });
    expect(p.sent.map((s) => s.body.model)).toEqual(['cheap/flash-a', 'cheap/flash-b']);
    expect(p.sent[1].body.models).toBeUndefined();

    const all = provider(jsonResponse(404, { error: { code: 404, message: 'No endpoints found' } }));
    const second = setup({ fetch: all.fetch, env: { LLM_MODEL: 'a/one,b/two,c/three' } });
    expect(await answer(await second.routes.POST(post(call())))).toEqual({ status: 503, body: { error: 'agents-offline', need: 'model' } });
    expect(all.sent).toHaveLength(2);

    const named = provider(jsonResponse(400, { error: { code: 400, message: 'cheap/flash-a is not a valid model ID' } }), orAnswer(GOOD));
    const third = setup({ fetch: named.fetch });
    expect((await third.routes.POST(post(call()))).status).toBe(200);
    expect(named.sent).toHaveLength(2);

    const plainBad = provider(jsonResponse(400, { error: { code: 400, message: 'messages: invalid content' } }));
    const fourth = setup({ fetch: plainBad.fetch });
    expect(await answer(await fourth.routes.POST(post(call())))).toEqual({ status: 502, body: { error: 'provider-error' } });
    expect(plainBad.sent).toHaveLength(1);
  });
});

describe('the spending guard', () => {
  it('(1) refuses every call once the total is spent, without calling the provider', async () => {
    const p = provider(orAnswer(GOOD));
    const { routes, kv } = setup({ fetch: p.fetch });
    await kv!.incr(keys.total, 6_000_000);
    expect(await answer(await routes.POST(post(call())))).toEqual({ status: 429, body: { error: 'daily-cap' } });
    expect(p.sent).toHaveLength(0);
  });

  it('(2) refuses every call once the day is spent', async () => {
    const p = provider(orAnswer(GOOD));
    const { routes, kv } = setup({ fetch: p.fetch });
    await kv!.incr(keys.dayUsd(DAY), 200_000);
    expect((await routes.POST(post(call()))).status).toBe(429);
    expect(p.sent).toHaveLength(0);
  });

  it('(3) starts a new run only with the reserve left, and the run stays new after a refusal', async () => {
    const p = provider(orAnswer(GOOD));
    const { routes, kv } = setup({ fetch: p.fetch });
    await kv!.incr(keys.dayUsd(DAY), 130_000); // 0.07 left of 0.20, the reserve is 0.08
    const body = call();
    expect((await answer(await routes.POST(post(body)))).body).toEqual({ error: 'daily-cap' });
    expect(await kv!.get(keys.runCalls(body.runId as string))).toBeNull();
    await kv!.incr(keys.dayUsd(DAY), -10_000); // 0.08 left now
    expect((await routes.POST(post(body))).status).toBe(200);
    expect(p.sent).toHaveLength(1);
  });

  it('(3) lets an address start two runs a day, and a third only from another address', async () => {
    const { routes } = setup({ fetch: provider(orAnswer(GOOD)).fetch });
    expect((await routes.POST(post(call()))).status).toBe(200);
    expect((await routes.POST(post(call()))).status).toBe(200);
    expect((await answer(await routes.POST(post(call())))).body).toEqual({ error: 'daily-cap' });
    expect((await routes.POST(post(call(), {}, '198.51.100.4'))).status).toBe(200);
  });

  it('(4) refuses the 33rd call of one run', async () => {
    const { routes } = setup({ fetch: provider(orAnswer(GOOD, { cost: 0.0001 })).fetch });
    const body = call();
    for (let i = 1; i <= 32; i += 1) expect((await routes.POST(post({ ...body, index: i }))).status).toBe(200);
    expect((await answer(await routes.POST(post({ ...body, index: 33 })))).body).toEqual({ error: 'daily-cap' });
  });

  it('(5) refuses the 41st voice request of an address today', async () => {
    const { routes } = setup({ fetch: provider(orAnswer(GOOD, { cost: 0.0001 })).fetch });
    for (let i = 0; i < 40; i += 1) expect((await routes.POST(post(call({ task: 'intent', runId: undefined, index: i })))).status).toBe(200);
    expect((await routes.POST(post(call({ task: 'intent', runId: undefined, index: 40 })))).status).toBe(429);
    expect((await routes.POST(post(call({ task: 'intent', runId: undefined }), {}, '198.51.100.4'))).status).toBe(200);
  });

  it('needs the run id on calls of a run, so the run limits cannot be skipped', async () => {
    const { routes } = setup({ fetch: provider(orAnswer(GOOD)).fetch });
    expect(await answer(await routes.POST(post(call({ runId: undefined }))))).toEqual({ status: 400, body: { error: 'bad-request', need: 'runId' } });
  });

  it('turns a racing second call of a run that is not admitted yet into a short wait', async () => {
    const { routes, kv } = setup({ fetch: provider(orAnswer(GOOD)).fetch });
    const body = call();
    await kv!.incr(keys.runCalls(body.runId as string), 1); // the first call is still being checked
    expect(await answer(await routes.POST(post(body)))).toEqual({ status: 429, body: { error: 'rate-limited', retryAfter: 2 } });
  });

  it('counts cost from tokens and prices when the provider gives none, and the estimate without prices', async () => {
    const tokens = setup({ fetch: provider(orAnswer(GOOD, { prompt_tokens: 3000, completion_tokens: 900 })).fetch, env: { LLM_PRICE_IN: '0.10', LLM_PRICE_OUT: '0.40' } });
    await tokens.routes.POST(post(call()));
    expect(await tokens.kv!.get(keys.dayUsd(DAY))).toBe(3000 * 0.1 + 900 * 0.4);
    const estimate = setup({ fetch: provider(orAnswer(GOOD, {})).fetch, env: { LLM_EST_CALL_USD: '0.005' } });
    await estimate.routes.POST(post(call()));
    expect(await estimate.kv!.get(keys.dayUsd(DAY))).toBe(5000);
  });

  it('counts development calls apart with the right token, and ignores the budget header without it', async () => {
    const env = { LLM_DEV_TOKEN: 'dev-secret-123' };
    const { routes, kv } = setup({ fetch: provider(orAnswer(GOOD)).fetch, env });
    await kv!.incr(keys.dayUsd(DAY), 200_000); // the judging day is spent
    const dev = { 'x-dev-token': 'dev-secret-123', 'x-dev-budget': 'live-tests' };
    expect((await routes.POST(post(call(), dev))).status).toBe(200);
    expect(await kv!.get(keys.devUsd('live-tests'))).toBe(2100);
    expect(await kv!.get(keys.devCalls('live-tests'))).toBe(1);
    expect(await kv!.get(keys.dayUsd(DAY))).toBe(200_000);
    expect(await kv!.get(keys.total)).toBeNull();
    // A visitor naming a budget item, or guessing the token, is still a visitor.
    expect((await routes.POST(post(call(), { 'x-dev-budget': 'live-tests' }))).status).toBe(429);
    expect((await routes.POST(post(call(), { 'x-dev-token': 'dev-secret-124', 'x-dev-budget': 'live-tests' }))).status).toBe(429);
  });

  it('refuses paid calls of visitors without shared counters (blob-json) and when the store fails, but lets development through', async () => {
    const unshared = createMemoryKv({ now: () => NOW, shared: false });
    const a = setup({ fetch: provider(orAnswer(GOOD)).fetch, kv: unshared, env: { LLM_DEV_TOKEN: 'dev-secret-123' } });
    expect(await answer(await a.routes.POST(post(call())))).toEqual({ status: 503, body: { error: 'agents-offline', need: 'credit' } });
    expect((await a.routes.POST(post(call(), { 'x-dev-token': 'dev-secret-123' }))).status).toBe(200);
    expect((await answer(await a.routes.GET(get()))).body.live).toBe(false);

    const broken = setup({ fetch: provider(orAnswer(GOOD)).fetch, kv: () => { throw new KvError('storage-off'); } });
    expect(await answer(await broken.routes.POST(post(call())))).toEqual({ status: 503, body: { error: 'agents-offline', need: 'credit' } });
    expect(await answer(await broken.routes.GET(get()))).toMatchObject({ status: 200, body: { live: false } });
  });
});

describe('GET /api/llm', () => {
  it('says live: false without a key and does not fail', async () => {
    const { routes } = setup({ env: { OPENROUTER_API_KEY: '' } });
    expect(await answer(await routes.GET(get()))).toEqual({
      status: 200,
      body: { live: false, provider: 'openrouter', model: 'cheap/flash-a', audio: false, callsLeftToday: 0, runsLeftToday: 0 },
    });
  });

  it('counts calls and runs left from what is left today and the average call', async () => {
    const { routes, kv } = setup({ env: { LLM_AUDIO_MODEL: 'cheap/audio-a' } });
    let status = (await answer(await routes.GET(get()))).body as LlmStatus;
    // 0.20 left, estimate 0.004 a call -> 50 calls; 0.20 / 0.08 -> 2 runs, the address may start 2.
    expect(status).toMatchObject({ live: true, audio: true, callsLeftToday: 50, runsLeftToday: 2 });
    await kv!.incr(keys.dayUsd(DAY), 60_000);
    await kv!.incr(keys.dayCalls(DAY), 20);
    await kv!.incr(keys.runs(DAY, 'whatever'), 1);
    status = (await answer(await routes.GET(get()))).body as LlmStatus;
    // 0.14 left at 0.003 a call -> 46 calls; 0.14 / 0.08 -> 1 run.
    expect(status).toMatchObject({ live: true, callsLeftToday: 46, runsLeftToday: 1 });
    await kv!.incr(keys.dayUsd(DAY), 140_000);
    expect((await answer(await routes.GET(get()))).body).toMatchObject({ live: false, callsLeftToday: 0, runsLeftToday: 0, audio: false });
  });

  it('defaults to the fixtures provider, which is never live', async () => {
    const { routes } = setup({ env: { LLM_PROVIDER: '' } });
    expect((await answer(await routes.GET(get()))).body).toMatchObject({ live: false, provider: 'fixtures', model: 'recorded', audio: false });
  });
});

describe('request checks', () => {
  it('refuses a wrong task, a schema outside the subset, and a body over 4 MB', async () => {
    const { routes } = setup({ fetch: provider(orAnswer(GOOD)).fetch });
    expect((await routes.POST(post(call({ task: 'chat' })))).status).toBe(400);
    expect((await routes.POST(post(call({ schema: { type: 'object', anyOf: [] } })))).status).toBe(400);
    expect((await routes.POST(post('{not json'))).status).toBe(400);
    const huge = call({ messages: [{ role: 'user', content: 'x'.repeat(4 * 1024 * 1024 + 10) }] });
    expect((await routes.POST(post(huge))).status).toBe(413);
  });

  it('logs the task, provider, model, time, size, cost and status, and nothing of the material or key', async () => {
    const { routes, logs } = setup({ fetch: provider(orAnswer(GOOD)).fetch });
    await routes.POST(post(call()));
    const line = logs.at(-1)!;
    expect(line).toMatchObject({ at: 'llm', task: 'extract', provider: 'openrouter', model: 'cheap/flash-a', status: 200, usd: 0.0021 });
    expect(typeof line.bytes).toBe('number');
    expect(JSON.stringify(logs)).not.toMatch(/3 March|sk-or-|Extract dated/);
  });
});

describe('the Gemini adapter', () => {
  const gemEnv = { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'AIza-test', GEMINI_MODEL: 'gemini-flash-x', LLM_PRICE_IN: '0.1', LLM_PRICE_OUT: '0.4' };
  const gemAnswer = (value: unknown) =>
    jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: typeof value === 'string' ? value : JSON.stringify(value) }] } }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 500 },
      modelVersion: 'gemini-flash-x-001',
    });

  it('sends system instruction, contents with inline audio and a response schema, and counts tokens', async () => {
    const p = provider(gemAnswer(GOOD));
    const { routes, kv } = setup({ fetch: p.fetch, env: gemEnv });
    const res = await answer(await routes.POST(post(call({ audio: 'UklGRg==' }))));
    expect(res).toMatchObject({ status: 200, body: { json: GOOD, provider: 'gemini', model: 'gemini-flash-x-001' } });
    const sent = p.sent[0];
    expect(sent.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-x:generateContent');
    expect(sent.headers.get('x-goog-api-key')).toBe('AIza-test');
    expect(sent.body.systemInstruction).toEqual({ parts: [{ text: 'Extract dated claims.' }] });
    expect(sent.body.contents).toEqual([
      { role: 'user', parts: [{ text: 'Page 2: the key was returned on 3 March.' }, { inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } }] },
    ]);
    const config = sent.body.generationConfig as { responseMimeType: string; responseSchema: Record<string, unknown> };
    expect(config.responseMimeType).toBe('application/json');
    expect(config.responseSchema).toEqual(geminiSchema(SCHEMA));
    expect(JSON.stringify(config.responseSchema)).not.toContain('additionalProperties');
    expect(await kv!.get(keys.dayUsd(DAY))).toBe(1000 * 0.1 + 500 * 0.4);
  });

  it('maps its refusals', async () => {
    const cases: [Response, number, Record<string, unknown>][] = [
      [jsonResponse(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '13s' }] } }), 429, { error: 'rate-limited', retryAfter: 13 }],
      [jsonResponse(400, { error: { code: 400, message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }), 503, { error: 'agents-offline', need: 'key' }],
      [jsonResponse(403, { error: { code: 403, status: 'PERMISSION_DENIED' } }), 503, { error: 'agents-offline', need: 'key' }],
      [jsonResponse(404, { error: { code: 404, message: 'models/gemini-flash-x is not found' } }), 503, { error: 'agents-offline', need: 'model' }],
      [jsonResponse(500, { error: { code: 500 } }), 503, { error: 'provider-busy' }],
      [gemAnswer('not json at all'), 422, { error: 'bad-output' }],
    ];
    for (const [response, status, body] of cases) {
      const { routes } = setup({ fetch: provider(response).fetch, env: gemEnv });
      expect(await answer(await routes.POST(post(call())))).toEqual({ status, body });
    }
  });

  it('answers 504 when Gemini does not answer in time', async () => {
    const hanging = (async (_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('t', 'TimeoutError'))))) as typeof fetch;
    const { routes } = setup({ fetch: hanging, env: gemEnv, deadlineMs: 30 });
    expect((await routes.POST(post(call()))).status).toBe(504);
  });
});

describe('the fixtures provider', () => {
  const fxEnv = { LLM_PROVIDER: 'fixtures', OPENROUTER_API_KEY: '', LLM_MODEL: '' };
  const fxSetup = (env: Record<string, string> = {}) =>
    setup({ env: { ...fxEnv, ...env }, adapters: { fixtures: () => createFixtures(fixtureList([SYNTHETIC])) } });
  const fx = (key: string | undefined, overrides: Record<string, unknown> = {}) => call({ schema: { type: 'object' }, fixture: key, ...overrides });

  it('answers the recorded call of the key at once, with its recorded time', async () => {
    const { routes } = fxSetup();
    const res = await answer(await routes.POST(post(fx('synthetic/full/extract/0/1'))));
    expect(res).toEqual({
      status: 200,
      body: { json: { claims: [{ quote: 'the key was returned on 3 March', page: 2 }] }, provider: 'fixtures', model: 'recorded', ms: 6200 },
    });
    // reconcile: the whole verdict dictionary goes back; the client picks its pairs.
    const verdicts = await answer(await routes.POST(post(fx('synthetic/full/reconcile/0/1', { task: 'reconcile' }))));
    expect(verdicts.body.json).toEqual({ verdicts: { 'pair-a': 'contradiction', 'pair-b': 'explained' } });
  });

  it('answers 503 need fixture without a key or a record, and 422 for a recorded failure', async () => {
    const { routes } = fxSetup();
    expect(await answer(await routes.POST(post(fx(undefined))))).toEqual({ status: 503, body: { error: 'agents-offline', need: 'fixture' } });
    expect((await answer(await routes.POST(post(fx('synthetic/full/extract/9/1'))))).body).toEqual({ error: 'agents-offline', need: 'fixture' });
    expect((await answer(await routes.POST(post(fx('synthetic/late/extract/0/1'))))).body).toEqual({ error: 'agents-offline', need: 'fixture' });
    expect((await routes.POST(post(fx('synthetic/full/extract/1/1')))).status).toBe(422);
  });

  it('spends nothing but refuses the 33rd call of a run', async () => {
    const { routes, kv } = fxSetup();
    const body = fx('synthetic/full/plan/0/1');
    for (let i = 0; i < 32; i += 1) expect((await routes.POST(post(body))).status).toBe(200);
    expect((await answer(await routes.POST(post(body)))).body).toEqual({ error: 'daily-cap' });
    expect(await kv!.get(keys.total)).toBeNull();
  });

  it('fails on purpose with x-test-fail where API_TEST_FAIL is on, and ignores the header elsewhere', async () => {
    const on = fxSetup({ API_TEST_FAIL: '1' });
    const key = 'synthetic/full/plan/0/1';
    expect(await answer(await on.routes.POST(post(fx(key), { 'x-test-fail': '429' })))).toEqual({ status: 429, body: { error: 'rate-limited', retryAfter: 2 } });
    expect((await on.routes.POST(post(fx(key)))).status).toBe(200);
    expect(await answer(await on.routes.POST(post(fx(key), { 'x-test-fail': '401' })))).toEqual({ status: 503, body: { error: 'agents-offline', need: 'key' } });
    expect(await answer(await on.routes.POST(post(fx(key), { 'x-test-fail': 'daily-cap' })))).toEqual({ status: 429, body: { error: 'daily-cap' } });
    expect((await on.routes.POST(post(fx(key), { 'x-test-fail': 'bad-output' }))).status).toBe(422);
    expect(await answer(await on.routes.POST(post(fx(key), { 'x-test-fail': '503' })))).toEqual({ status: 503, body: { error: 'provider-busy' } });
    expect((await answer(await on.routes.POST(post(fx(key), { 'x-test-fail': '404' })))).body).toEqual({ error: 'agents-offline', need: 'model' });

    const off = fxSetup();
    expect((await off.routes.POST(post(fx(key), { 'x-test-fail': '429' }))).status).toBe(200);
  });
});

describe('the answer schema', () => {
  it('validates the contract subset', () => {
    expect(validate(GOOD, SCHEMA)).toBeNull();
    expect(validate({ claims: [] }, SCHEMA)).toBe('$.kind: missing');
    expect(validate({ ...GOOD, kind: 'memo' }, SCHEMA)).toBe('$.kind: not one of the allowed values');
    expect(validate({ ...GOOD, claims: Array(6).fill(GOOD.claims[0]) }, SCHEMA)).toBe('$.claims: more than 5');
    expect(validate({ ...GOOD, extra: 1 }, strictSchema(SCHEMA))).toBe('$.extra: not allowed');
    expect(validate(1.5, { type: 'integer' })).toBe('$: expected integer');
    expect(validate(true, { type: 'boolean' })).toBeNull();
  });

  it('reads JSON out of model text', () => {
    expect(parseModelJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseModelJson('Here you go: {"a":[1]}')).toEqual({ a: [1] });
    expect(parseModelJson('nothing')).toBeUndefined();
  });
});
