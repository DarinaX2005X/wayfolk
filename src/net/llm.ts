/**
 * The network `LlmClient` (PLAN "Контракты"): the engine calls the model only through an
 * `LlmClient`, and this one goes through `/api/llm`. No DOM: it runs in the browser and
 * in Node (development scripts pass `base`, `devToken` and `devBudget`).
 *
 *   status()  `LlmStatus`, kept for five minutes; one request at a time. When the server
 *             cannot be reached it answers `live: false` (and does not keep that answer,
 *             so the next look tries again).
 *   call()    one call, 58 s at most (the provider gets 50 s, the function 60 s). The
 *             `payload` stays here; everything else is sent. A refusal becomes `LlmError`
 *             with the server's code, `need` and `retryAfter`; the engine's queue decides
 *             what to do with it. A cancelled `signal` rejects with the abort itself:
 *             cancelling is not a failure of the model.
 *
 * Recorded answers through the server (`fixtures`). `forceLive('fixtures')` makes
 * `status()` say live and fills each call's `fixture` key from the call's task, index and
 * attempt, so a view runs the live path (queue, refusals, the switch to recorded answers)
 * on recorded answers without spending the key. For `reconcile` the server sends the
 * whole recorded verdict dictionary; `pickRecorded` (the selection `recordedLlm` uses)
 * cuts it to the pairs of the request, because only the client has the `payload`.
 *
 * Failures on purpose, for scenarios: `failNext(code)` sends `x-test-fail` on the next
 * call only; `failAt(n, code)` on the n-th call of a run (counted by `runId`, from 1).
 */
import type { LlmClient, LlmRequest, LlmResponse, LlmStatus, Provider } from '../agents/types';
import type { LlmCallBody, TestFail } from '../../api/_lib/contracts';
import { NetError, createNet, type Net } from './client';

/** Codes of /api/llm refusals, plus `offline` (no answer at all). */
export type LlmErrorCode =
  | 'rate-limited'
  | 'provider-busy'
  | 'agents-offline'
  | 'daily-cap'
  | 'bad-output'
  | 'provider-error'
  | 'timeout'
  | 'offline'
  | 'bad-request'
  | 'too-big';

export type LlmNeed = 'key' | 'credit' | 'model' | 'fixture';

export class LlmError extends Error {
  constructor(
    public code: LlmErrorCode,
    public options: { need?: LlmNeed; retryAfter?: number; status?: number } = {},
  ) {
    super(`llm: ${code}${options.need ? ` (${options.need})` : ''}`);
    this.name = 'LlmError';
  }
  get need(): LlmNeed | undefined {
    return this.options.need;
  }
  /** Seconds to wait before trying again, when the server said. */
  get retryAfter(): number | undefined {
    return this.options.retryAfter;
  }
  get status(): number {
    return this.options.status ?? 0;
  }
}

const KNOWN: readonly string[] = [
  'rate-limited',
  'provider-busy',
  'agents-offline',
  'daily-cap',
  'bad-output',
  'provider-error',
  'timeout',
  'bad-request',
  'too-big',
];
const NEEDS: readonly string[] = ['key', 'credit', 'model', 'fixture'];

export const CALL_TIMEOUT_MS = 58_000;
export const STATUS_TTL_MS = 5 * 60_000;

export type NetLlmOptions = {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Origin of the API; empty for the page's own origin. Node scripts pass the server. */
  base?: string;
  /** Development scripts only: the secret LLM_DEV_TOKEN and their budget item. */
  devToken?: string;
  devBudget?: string;
  now?: () => number;
  /** Cuts a recorded answer to what this request asked for (reconcile verdicts). */
  pickRecorded?: (req: LlmRequest, json: unknown) => unknown;
  /** Shared client of /api/* (tests and the page pass theirs; otherwise one is made). */
  net?: Net;
};

export type FixtureScope = { example: string; scope: 'full' | 'late' };

export type NetLlm = LlmClient & {
  /** Forget the kept status (after a refusal that changes it, or a test switch). */
  forgetStatus(): void;
  forceLive(mode: 'fixtures' | null, where?: FixtureScope): void;
  readonly forced: 'fixtures' | null;
  failNext(code: TestFail): void;
  failAt(n: number, code: TestFail): void;
};

const offlineStatus = (provider: Provider): LlmStatus => ({
  live: false,
  provider,
  model: '',
  audio: false,
  callsLeftToday: 0,
  runsLeftToday: 0,
});

function isStatus(value: unknown): value is LlmStatus {
  const v = value as Partial<LlmStatus> | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof v.live === 'boolean' &&
    typeof v.provider === 'string' &&
    typeof v.model === 'string' &&
    typeof v.audio === 'boolean' &&
    typeof v.callsLeftToday === 'number' &&
    typeof v.runsLeftToday === 'number'
  );
}

function isResponse(value: unknown): value is LlmResponse {
  const v = value as Partial<LlmResponse> | null;
  return typeof v === 'object' && v !== null && 'json' in v && typeof v.provider === 'string' && typeof v.model === 'string' && typeof v.ms === 'number';
}

/** A NetError of /api/llm as LlmError. */
export function toLlmError(err: NetError): LlmError {
  if (err.kind === 'offline') return new LlmError('offline');
  if (err.kind === 'timeout') return new LlmError('timeout');
  if (err.kind === 'bad-answer') return new LlmError('provider-error', { status: err.status });
  const body = err.body ?? {};
  const code = err.code && KNOWN.includes(err.code) ? (err.code as LlmErrorCode) : err.status === 404 ? 'agents-offline' : 'provider-error';
  const need = typeof body.need === 'string' && NEEDS.includes(body.need) ? (body.need as LlmNeed) : undefined;
  const retryAfter = typeof body.retryAfter === 'number' && Number.isFinite(body.retryAfter) ? body.retryAfter : undefined;
  return new LlmError(code, { need, retryAfter, status: err.status });
}

export function createNetLlm(options: NetLlmOptions): NetLlm {
  const net = options.net ?? createNet({ fetch: options.fetch, apiBase: options.base });
  const now = options.now ?? Date.now;
  let kept: { at: number; status: LlmStatus } | null = null;
  let inFlight: Promise<LlmStatus> | null = null;
  let lastProvider: Provider = 'fixtures';
  let forced: 'fixtures' | null = null;
  let where: FixtureScope = { example: 'harbor-street', scope: 'full' };
  let nextFail: TestFail | null = null;
  const failAtRun = new Map<number, TestFail>();
  const callsByRun = new Map<string, number>();

  const headers = (): Record<string, string> => {
    const out: Record<string, string> = {};
    if (options.devToken) out['x-dev-token'] = options.devToken;
    if (options.devBudget) out['x-dev-budget'] = options.devBudget;
    return out;
  };

  async function fetchStatus(): Promise<LlmStatus> {
    try {
      const value = await net.request<unknown>('/api/llm', { headers: headers() });
      if (!isStatus(value)) return offlineStatus(lastProvider);
      lastProvider = value.provider;
      kept = { at: now(), status: value };
      return value;
    } catch {
      return offlineStatus(lastProvider);
    }
  }

  const client: NetLlm = {
    async status() {
      let status: LlmStatus;
      if (kept && now() - kept.at < STATUS_TTL_MS) status = kept.status;
      else {
        inFlight ??= fetchStatus().finally(() => (inFlight = null));
        status = await inFlight;
      }
      return forced ? { ...status, live: true, provider: 'fixtures', model: status.model || 'recorded' } : status;
    },

    async call(req, opts = {}) {
      const { payload: _payload, ...rest } = req;
      const body: LlmCallBody = { ...rest };
      if (forced && !body.fixture) body.fixture = `${where.example}/${where.scope}/${req.task}/${req.index}/${req.attempt}`;
      const runKey = req.runId ?? '';
      const n = (callsByRun.get(runKey) ?? 0) + 1;
      callsByRun.set(runKey, n);
      const extra = headers();
      const failure = nextFail ?? failAtRun.get(n) ?? null;
      if (nextFail) nextFail = null;
      else if (failAtRun.has(n)) failAtRun.delete(n);
      if (failure) extra['x-test-fail'] = failure;

      let answer: unknown;
      try {
        answer = await net.request<unknown>('/api/llm', { body, headers: extra, timeoutMs: CALL_TIMEOUT_MS, signal: opts.signal });
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (!(err instanceof NetError)) throw err;
        const error = toLlmError(err);
        // These change what the status says: look again next time.
        if (error.code === 'daily-cap' || error.code === 'agents-offline') kept = null;
        throw error;
      }
      if (!isResponse(answer)) throw new LlmError('provider-error');
      if (answer.provider === 'fixtures' && options.pickRecorded) {
        return { ...answer, json: options.pickRecorded(req, answer.json) };
      }
      return answer;
    },

    forgetStatus() {
      kept = null;
    },
    forceLive(mode, scope) {
      forced = mode;
      if (scope) where = scope;
      callsByRun.clear();
    },
    get forced() {
      return forced;
    },
    failNext(code) {
      nextFail = code;
    },
    failAt(n, code) {
      callsByRun.clear();
      failAtRun.set(n, code);
    },
  };
  return client;
}

/**
 * Looks at the status now and every five minutes, giving each answer to `apply` (the page
 * puts it in `store.llm`). Returns a stop function.
 */
export function watchStatus(
  llm: Pick<LlmClient, 'status'>,
  apply: (status: LlmStatus) => void,
  timers: { set(fn: () => void, ms: number): unknown; clear(id: unknown): void } = {
    set: (fn, ms) => setInterval(fn, ms),
    clear: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  },
): () => void {
  let stopped = false;
  const look = (): void => {
    void llm.status().then((status) => {
      if (!stopped) apply(status);
    });
  };
  look();
  const id = timers.set(look, STATUS_TTL_MS);
  return () => {
    stopped = true;
    timers.clear(id);
  };
}
