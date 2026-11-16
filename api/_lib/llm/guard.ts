/**
 * Spending protection of the model proxy (stage 01.5.1, PLAN "Записанные ответы, ключ
 * ИИ, прокси и живой прогон"). Counters live in the store of small records (./../kv.ts)
 * through `incr` with an expiry, so every instance of the function sees the same
 * numbers. Money is counted in whole micro-dollars because counters are integers.
 *
 *   llm:total                       all spending of the deployment
 *   llm:<UTC date>:usd              spending of the day;  llm:<date>:calls  paid calls of the day
 *   llm:<date>:runs:<address hash>  live runs started from an address today
 *   llm:<date>:voice:<address hash> voice requests from an address today
 *   llm:run:<runId>:calls           calls of one run;  llm:run:<runId>:ok  the run was admitted
 *   llm:dev:<item>:usd, :calls      development spending by budget item
 *
 * Before a paid call of a visitor: (1) total under LLM_TOTAL_USD; (2) the day under
 * LLM_DAILY_USD; (3) the first call of a run needs at least LLM_RUN_RESERVE_USD left of
 * both, and the address under LLM_DAILY_RUNS_PER_ADDRESS runs today; (4) the run under
 * LLM_RUN_CALLS calls; (5) a voice request (`intent`) under LLM_VOICE_CALLS_PER_ADDRESS
 * from the address today. Any of them answers 429 `daily-cap` and the provider is not
 * called. Calls of a run must carry its `runId`, so the per-run and per-address limits
 * cannot be skipped by leaving it out.
 *
 * A later call of a run is accepted only after its first call was admitted (the `ok`
 * mark), so two requests racing on a new run id cannot slip one past the checks; the
 * loser is told to retry in two seconds. A call that got no answer from the provider
 * (rate limit, overload, network) gives its run slot back, so waiting out a rate limit
 * does not eat the run's allowance.
 *
 * Development calls (a correct x-dev-token) are counted apart by their budget item and do
 * not touch the judging limits; the run-calls limit still applies. Without the token the
 * item header means nothing. The `fixtures` provider spends nothing but checks the
 * run-calls limit, so that limit can be tried without credit.
 *
 * Without shared counters (blob-json, or memory on a deployment) paid calls of visitors
 * are refused with 503 `agents-offline`, `need: 'credit'`: without a counter nothing may
 * be spent. The same happens when the store fails.
 */
import type { ApiErrorCode, LlmStatus, LlmTask, Provider } from '../contracts';
import type { KV } from '../kv';
import { paid, type LlmConfig } from './config';
import type { Usage } from './provider';

export type Caller = { kind: 'visitor'; address: string } | { kind: 'dev'; item: string };

export type Refusal = { status: number; error: ApiErrorCode; extra?: Record<string, unknown> };
export type Ticket = { provider: Provider; caller: Caller; day: string; runKey: string | null };
export type Admission = { ok: true; ticket: Ticket } | { ok: false; refusal: Refusal };

const DAY_TTL = 2 * 24 * 3600;
const RUN_TTL = 2 * 24 * 3600;

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const keys = {
  total: 'llm:total',
  dayUsd: (day: string) => `llm:${day}:usd`,
  dayCalls: (day: string) => `llm:${day}:calls`,
  runs: (day: string, address: string) => `llm:${day}:runs:${address}`,
  voice: (day: string, address: string) => `llm:${day}:voice:${address}`,
  runCalls: (runId: string) => `llm:run:${runId}:calls`,
  runOk: (runId: string) => `llm:run:${runId}:ok`,
  devUsd: (item: string) => `llm:dev:${item}:usd`,
  devCalls: (item: string) => `llm:dev:${item}:calls`,
};

const cap = (): Admission => ({ ok: false, refusal: { status: 429, error: 'daily-cap' } });
const asNumber = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? 0) || 0);

export async function admit(
  kv: KV,
  cfg: LlmConfig,
  input: { caller: Caller; task: LlmTask; runId?: string; provider: Provider; now: number },
): Promise<Admission> {
  const day = utcDay(input.now);
  const ticket: Ticket = { provider: input.provider, caller: input.caller, day, runKey: null };

  // Calls that spend nothing of the judging budget: only the per-run limit.
  if (!paid(input.provider) || input.caller.kind === 'dev') {
    if (input.runId) {
      ticket.runKey = keys.runCalls(input.runId);
      const calls = await kv.incr(ticket.runKey, 1, { ex: RUN_TTL });
      if (calls > cfg.runCalls) return cap();
    }
    return { ok: true, ticket };
  }

  if (!kv.sharedCounters) return { ok: false, refusal: { status: 503, error: 'agents-offline', extra: { need: 'credit' } } };
  const address = input.caller.address;
  const [total, spent] = (await Promise.all([kv.get(keys.total), kv.get(keys.dayUsd(day))])).map(asNumber);
  if (total >= cfg.totalMicros || spent >= cfg.dailyMicros) return cap();

  if (input.task === 'intent') {
    const voice = await kv.incr(keys.voice(day, address), 1, { ex: DAY_TTL });
    if (voice > cfg.voicePerAddress) return cap();
    return { ok: true, ticket };
  }

  if (!input.runId) return { ok: false, refusal: { status: 400, error: 'bad-request', extra: { need: 'runId' } } };
  const runKey = keys.runCalls(input.runId);
  const calls = await kv.incr(runKey, 1, { ex: RUN_TTL });
  if (calls > cfg.runCalls) return cap();
  if (calls === 1) {
    const left = Math.min(cfg.dailyMicros - spent, cfg.totalMicros - total);
    if (left < cfg.reserveMicros) {
      await kv.del(runKey);
      return cap();
    }
    const runs = await kv.incr(keys.runs(day, address), 1, { ex: DAY_TTL });
    if (runs > cfg.runsPerAddress) {
      await kv.del(runKey);
      return cap();
    }
    await kv.set(keys.runOk(input.runId), 1, { ex: RUN_TTL });
  } else if ((await kv.get(keys.runOk(input.runId))) === null) {
    await kv.incr(runKey, -1);
    return { ok: false, refusal: { status: 429, error: 'rate-limited', extra: { retryAfter: 2 } } };
  }
  ticket.runKey = runKey;
  return { ok: true, ticket };
}

/** The call got no answer from the provider: its run slot is given back. */
export async function refund(kv: KV, ticket: Ticket): Promise<void> {
  if (ticket.runKey) await kv.incr(ticket.runKey, -1);
}

/** Micro-dollars of one answer: the provider's cost, else tokens at the configured prices, else the estimate. */
export function costMicros(usage: Usage | undefined, cfg: LlmConfig): number {
  if (usage?.costUsd !== undefined) return Math.ceil(usage.costUsd * 1_000_000);
  const tokens = (usage?.inTokens ?? 0) + (usage?.outTokens ?? 0);
  if (tokens > 0 && (cfg.priceIn > 0 || cfg.priceOut > 0)) {
    // USD per million tokens times tokens is exactly micro-dollars.
    return Math.ceil((usage?.inTokens ?? 0) * cfg.priceIn + (usage?.outTokens ?? 0) * cfg.priceOut);
  }
  return cfg.estCallMicros;
}

/** Adds what a call cost to the day, the total and the call count, or to the development item. */
export async function settle(kv: KV, ticket: Ticket, microsSpent: number): Promise<void> {
  if (!paid(ticket.provider) || microsSpent <= 0) return;
  if (ticket.caller.kind === 'dev') {
    await kv.incr(keys.devUsd(ticket.caller.item), microsSpent);
    await kv.incr(keys.devCalls(ticket.caller.item), 1);
    return;
  }
  await kv.incr(keys.dayUsd(ticket.day), microsSpent, { ex: DAY_TTL });
  await kv.incr(keys.total, microsSpent);
  await kv.incr(keys.dayCalls(ticket.day), 1, { ex: DAY_TTL });
}

/**
 * `LlmStatus` numbers. `callsLeftToday`: what is left of today's limit (and of the total)
 * divided by today's average call price, or by LLM_EST_CALL_USD before the first call.
 * `runsLeftToday`: the same left divided by LLM_RUN_RESERVE_USD, and no more than this
 * address may still start today.
 */
export async function budgetStatus(
  kv: KV,
  cfg: LlmConfig,
  address: string,
  now: number,
): Promise<Pick<LlmStatus, 'live' | 'callsLeftToday' | 'runsLeftToday'>> {
  const day = utcDay(now);
  const [total, spent, calls, runs] = (
    await Promise.all([kv.get(keys.total), kv.get(keys.dayUsd(day)), kv.get(keys.dayCalls(day)), kv.get(keys.runs(day, address))])
  ).map(asNumber);
  const left = Math.max(0, Math.min(cfg.dailyMicros - spent, cfg.totalMicros - total));
  const average = calls > 0 && spent > 0 ? spent / calls : cfg.estCallMicros;
  const byMoney = cfg.reserveMicros > 0 ? Math.floor(left / cfg.reserveMicros) : 0;
  return {
    live: left > 0,
    callsLeftToday: Math.floor(left / Math.max(1, average)),
    runsLeftToday: Math.max(0, Math.min(byMoney, cfg.runsPerAddress - runs)),
  };
}
