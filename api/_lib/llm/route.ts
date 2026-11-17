/**
 * `GET /api/llm` and `POST /api/llm`: one model call for the mind module (travelers,
 * talk, events, gifts, trips).
 *
 * GET answers `LlmStatus` and never fails: without a key, a model, shared counters or a
 * reachable store it says `live: false` with zero counts.
 *
 * POST reads and checks the request (400, 413), picks the provider from LLM_PROVIDER and
 * the model from the task (config.ts `modelsFor`),
 * passes the spending guard (./guard.ts), makes one provider call (a second only when the
 * provider refused the model, with the next model of the list), reads JSON out of the
 * answer and checks it against the request's schema. A misfit is 422 `bad-output` and is
 * not retried here: the client's queue decides, and its retry is a counted call.
 *
 *   provider 429             429 rate-limited { retryAfter } (Retry-After, or 5)
 *   provider 5xx, overload   503 provider-busy
 *   provider 401 / 402       503 agents-offline { need: 'key' | 'credit' }
 *   model refused twice      503 agents-offline { need: 'model' }
 *   other provider refusal   502 provider-error
 *   no answer in 50 s        504 timeout   (the function may run 60 s on Hobby)
 *   no key                   503 agents-offline { need: 'key' }
 *
 * Each call writes one log line: task, provider, model, ms, request bytes, cost, status.
 * Never the material, the answer or a key.
 */
import type { LlmCallBody, LlmResponse, LlmStatus, Provider } from '../contracts';
import type { Env } from '../env';
import { describeError, fail, hashAddress, json, readBody, sameHash, sha256 } from '../http';
import { KvError, getKv, type KV } from '../kv';
import { testFailure } from '../test-fail';
import { modelsFor, paid, readLlmConfig, type LlmConfig } from './config';
import { createGemini } from './gemini';
import { admit, budgetStatus, costMicros, refund, settle, type Caller, type Ticket } from './guard';
import { createOpenRouter } from './openrouter';
import type { Outcome, ProviderAdapter } from './provider';
import { hasAudio, parseLlmRequest } from './request';
import { parseModelJson, validate } from './schema';

export type LlmDeps = {
  env?: () => Env;
  /** The store of counters; throws KvError when none is usable. */
  kv?: () => KV;
  fetch?: typeof fetch;
  now?: () => number;
  /** Adapters by provider, replacing the real ones (tests). */
  adapters?: Partial<Record<Provider, (cfg: LlmConfig) => ProviderAdapter>>;
  log?: (line: Record<string, unknown>) => void;
  /** How long a provider may take, ms. */
  deadlineMs?: number;
};

export const PROVIDER_DEADLINE_MS = 50_000;
const DEV_ITEM = /^[a-z0-9-]{1,32}$/;

const defaultLog = (line: Record<string, unknown>): void => console.log(JSON.stringify(line));

/** The answer a test failure stands for, as if the provider had given it. */
function injected(mode: string | null): Outcome | null {
  switch (mode) {
    case '429':
      return { ok: false, kind: 'rate-limited', retryAfter: 2 };
    case '503':
      return { ok: false, kind: 'busy' };
    case '401':
      return { ok: false, kind: 'offline', need: 'key' };
    case '404':
      return { ok: false, kind: 'model' };
    case 'bad-output':
      return { ok: true, text: 'This is not JSON.', model: 'test', usage: { costUsd: 0 } };
    default:
      return null;
  }
}

export function createLlmRoutes(deps: LlmDeps = {}) {
  const env = deps.env ?? (() => process.env);
  const now = deps.now ?? Date.now;
  const log = deps.log ?? defaultLog;
  const kvOf = deps.kv ?? (() => getKv(env()));

  const adapterFor = (cfg: LlmConfig): ProviderAdapter | null => {
    const custom = deps.adapters?.[cfg.provider];
    if (custom) return custom(cfg);
    if (cfg.provider === 'openrouter') return createOpenRouter({ key: cfg.key, siteUrl: cfg.siteUrl, fetch: deps.fetch, sort: cfg.sort });
    if (cfg.provider === 'gemini') return createGemini({ key: cfg.key, fetch: deps.fetch });
    return null;
  };

  const callerOf = (request: Request, cfg: LlmConfig): Caller => {
    const token = request.headers.get('x-dev-token') ?? '';
    if (cfg.devToken && token && sameHash(sha256(token), sha256(cfg.devToken))) {
      const item = (request.headers.get('x-dev-budget') ?? '').trim().toLowerCase();
      return { kind: 'dev', item: DEV_ITEM.test(item) ? item : 'unsorted' };
    }
    return { kind: 'visitor', address: hashAddress(request, cfg.addressSalt) };
  };

  async function GET(request: Request): Promise<Response> {
    const cfg = readLlmConfig(env());
    const status: LlmStatus = {
      live: false,
      provider: cfg.provider,
      model: cfg.models[0] ?? '',
      audio: false,
      callsLeftToday: 0,
      runsLeftToday: 0,
    };
    if (cfg.providerProblem) log({ at: 'llm', problem: cfg.providerProblem });
    if (!paid(cfg.provider) || !cfg.key || cfg.models.length === 0) return json(200, status);
    try {
      const kv = kvOf();
      if (!kv.sharedCounters && !cfg.instanceCounters) return json(200, status);
      const numbers = await budgetStatus(kv, cfg, hashAddress(request, cfg.addressSalt), now());
      return json(200, { ...status, ...numbers, audio: numbers.live && cfg.audioModels.length > 0 });
    } catch (err) {
      log({ at: 'llm', route: 'status', problem: describeError(err) });
      return json(200, status);
    }
  }

  async function POST(request: Request): Promise<Response> {
    const started = now();
    const environment = env();
    const cfg = readLlmConfig(environment);
    const mode = testFailure(request, environment);
    const line: Record<string, unknown> = { at: 'llm', provider: cfg.provider };
    const finish = (response: Response, extra: Record<string, unknown> = {}): Response => {
      log({ ...line, ...extra, ms: now() - started, status: response.status });
      return response;
    };

    const bytes = await readBody(request);
    if (bytes === null) return finish(fail(413, 'too-big'));
    line.bytes = bytes.byteLength;
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return finish(fail(400, 'bad-request'));
    }
    const parsed = parseLlmRequest(raw);
    if (!parsed.ok) return finish(fail(400, 'bad-request'), { problem: parsed.problem });
    const body: LlmCallBody = parsed.body;
    line.task = body.task;

    const adapter = adapterFor(cfg);
    if (!adapter || (paid(cfg.provider) && !cfg.key)) return finish(fail(503, 'agents-offline', { need: 'key' }));
    const audio = hasAudio(body);
    const models = modelsFor(cfg, body.task, audio);
    if (models.length === 0) return finish(fail(503, 'agents-offline', { need: 'model' }));
    if (mode === 'daily-cap') return finish(fail(429, 'daily-cap'));

    // Counters. Without them nothing may be spent; recorded answers cost nothing and go on.
    let kv: KV | null = null;
    let ticket: Ticket | null = null;
    try {
      if (mode === 'storage-busy') throw new KvError('storage-busy', 'test');
      kv = kvOf();
      const admission = await admit(kv, cfg, { caller: callerOf(request, cfg), task: body.task, audio, runId: body.runId, provider: cfg.provider, now: now() });
      if (!admission.ok) {
        const { status, error, extra } = admission.refusal;
        return finish(fail(status, error, extra));
      }
      ticket = admission.ticket;
    } catch (err) {
      line.storage = describeError(err);
      if (paid(cfg.provider)) return finish(fail(503, 'agents-offline', { need: 'credit' }));
      kv = null;
    }

    const signal = AbortSignal.timeout(deps.deadlineMs ?? PROVIDER_DEADLINE_MS);
    const callStarted = now();
    let list = models;
    let outcome: Outcome = { ok: false, kind: 'model' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      line.model = list[0];
      outcome = injected(mode) ?? (await adapter({ body, model: list[0], fallbacks: list.slice(1), signal }));
      if (outcome.ok || outcome.kind !== 'model' || list.length < 2) break;
      list = list.slice(1);
    }
    const callMs = now() - callStarted;

    const giveBack = async (): Promise<void> => {
      if (kv && ticket) await refund(kv, ticket).catch((err) => (line.refund = describeError(err)));
    };
    const charge = async (spent: number): Promise<void> => {
      line.usd = spent / 1_000_000;
      if (kv && ticket) await settle(kv, ticket, spent).catch((err) => (line.settle = describeError(err)));
    };

    if (outcome.ok) {
      line.model = outcome.model;
      await charge(paid(cfg.provider) ? costMicros(outcome.usage, cfg) : 0);
      const value = outcome.json !== undefined ? outcome.json : parseModelJson(outcome.text ?? '');
      const problem = value === undefined ? 'not JSON' : validate(value, body.schema);
      if (problem) return finish(fail(422, 'bad-output'), { problem });
      const answer: LlmResponse = { json: value, provider: cfg.provider, model: outcome.model, ms: outcome.ms ?? callMs };
      return finish(json(200, answer));
    }
    switch (outcome.kind) {
      case 'rate-limited':
        await giveBack();
        return finish(fail(429, 'rate-limited', { retryAfter: outcome.retryAfter }));
      case 'busy':
        await giveBack();
        return finish(fail(503, 'provider-busy'));
      case 'offline':
        await giveBack();
        return finish(fail(503, 'agents-offline', { need: outcome.need }));
      case 'model':
        await giveBack();
        return finish(fail(503, 'agents-offline', { need: 'model' }));
      case 'error':
        await giveBack();
        return finish(fail(502, 'provider-error'));
      case 'timeout':
        // The provider may still bill a call it did not finish: count the estimate.
        await charge(paid(cfg.provider) ? cfg.estCallMicros : 0);
        return finish(fail(504, 'timeout'));
    }
  }

  const guarded =
    (handler: (request: Request) => Promise<Response>) =>
    async (request: Request): Promise<Response> => {
      try {
        return await handler(request);
      } catch (err) {
        log({ at: 'llm', problem: describeError(err) });
        return fail(500, 'server');
      }
    };

  return { GET: guarded(GET), POST: guarded(POST) };
}
