/**
 * The queue of model calls of one run (PLAN "Записанные ответы, ключ ИИ, прокси и
 * живой прогон"):
 *   - up to four calls at once; after the first 429 the queue works in two streams to
 *     the end of the run;
 *   - 429 rate-limited and 503 provider-busy wait retryAfter, or 2, 4, 8 s with ±20%
 *     spread, and report it (`onWaiting`); after three waits the call fails;
 *   - without network the call is tried again after 2, 4, 8 s and then every 8 s for
 *     two minutes;
 *   - a timeout is tried once more after 2 s;
 *   - everything else (agents-offline, daily-cap, provider-error, bad-output) goes back
 *     to the caller at once: bad-output is asked again by the job, the rest ends in
 *     recorded answers or a stop.
 * Waiting calls are taken by priority (a second look goes before batches not yet
 * started), then in the order they came. All waits go through the given timers.
 */
import { CancelledError, classifyError, LlmError } from './llm-error';
import type { LlmClient, LlmRequest, LlmResponse } from './types';

export type Timers = { set(fn: () => void, ms: number): number; clear(id: number): void };

export type WaitInfo<T> = { tag: T; reason: 'rate-limited' | 'provider-busy' | 'offline'; retryInMs: number };

export type QueueDeps<T> = {
  client(): LlmClient;
  timers: Timers;
  rng?: () => number;
  onWaiting?(info: WaitInfo<T>): void;
  /** Called once, when the first 429 turns the queue to two streams. */
  onTwoStreams?(): void;
};

export type CallOptions<T> = { priority?: number; tag: T; onStart?(): void; signal?: AbortSignal };

export type LlmQueue<T> = {
  call(req: LlmRequest, opts: CallOptions<T>): Promise<LlmResponse>;
  readonly concurrency: number;
  readonly active: number;
  readonly waiting: number;
  cancel(): void;
};

export const MAX_STREAMS = 4;
export const SLOW_STREAMS = 2;
export const BACKOFF_MS = [2000, 4000, 8000];
export const OFFLINE_FOR_MS = 120_000;

type Job<T> = {
  req: LlmRequest;
  opts: CallOptions<T>;
  order: number;
  resolve(r: LlmResponse): void;
  reject(e: unknown): void;
};

export function createLlmQueue<T>(deps: QueueDeps<T>): LlmQueue<T> {
  const rng = deps.rng ?? Math.random;
  let concurrency = MAX_STREAMS;
  let active = 0;
  let order = 0;
  let cancelled = false;
  const waiting: Job<T>[] = [];
  const sleeping = new Map<number, () => void>();

  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve, reject) => {
      if (cancelled) return reject(new CancelledError());
      const id = deps.timers.set(() => {
        sleeping.delete(id);
        resolve();
      }, ms);
      sleeping.set(id, () => reject(new CancelledError()));
    });

  const spread = (ms: number) => Math.round(ms * (0.8 + 0.4 * rng()));

  async function attempt(job: Job<T>): Promise<LlmResponse> {
    let busyWaits = 0;
    let offlineSince = -1;
    let offlineTries = 0;
    let timeouts = 0;
    for (;;) {
      if (cancelled) throw new CancelledError();
      try {
        return await deps.client().call(job.req, { signal: job.opts.signal });
      } catch (raw) {
        if (cancelled) throw new CancelledError();
        const error = classifyError(raw);
        if (error.code === 'rate-limited' || error.code === 'provider-busy') {
          if (error.code === 'rate-limited' && concurrency !== SLOW_STREAMS) {
            concurrency = SLOW_STREAMS;
            deps.onTwoStreams?.();
          }
          if (busyWaits >= BACKOFF_MS.length) throw error;
          const ms = error.retryAfterMs ?? spread(BACKOFF_MS[busyWaits]);
          busyWaits++;
          deps.onWaiting?.({ tag: job.opts.tag, reason: error.code, retryInMs: ms });
          await sleep(ms);
          continue;
        }
        if (error.code === 'offline') {
          if (offlineSince < 0) offlineSince = 0;
          const ms = BACKOFF_MS[Math.min(offlineTries, BACKOFF_MS.length - 1)];
          if (offlineSince + ms > OFFLINE_FOR_MS) throw error;
          offlineSince += ms;
          offlineTries++;
          deps.onWaiting?.({ tag: job.opts.tag, reason: 'offline', retryInMs: ms });
          await sleep(ms);
          continue;
        }
        if (error.code === 'timeout' && timeouts === 0) {
          timeouts++;
          await sleep(BACKOFF_MS[0]);
          continue;
        }
        throw error;
      }
    }
  }

  function pump(): void {
    while (!cancelled && active < concurrency && waiting.length) {
      waiting.sort((a, b) => (b.opts.priority ?? 0) - (a.opts.priority ?? 0) || a.order - b.order);
      const job = waiting.shift()!;
      active++;
      job.opts.onStart?.();
      attempt(job).then(
        (r) => {
          active--;
          job.resolve(r);
          pump();
        },
        (e) => {
          active--;
          job.reject(e instanceof LlmError || e instanceof CancelledError ? e : classifyError(e));
          pump();
        },
      );
    }
  }

  return {
    call(req, opts) {
      return new Promise<LlmResponse>((resolve, reject) => {
        if (cancelled) return reject(new CancelledError());
        waiting.push({ req, opts, order: order++, resolve, reject });
        pump();
      });
    },
    get concurrency() {
      return concurrency;
    },
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
    cancel() {
      cancelled = true;
      for (const job of waiting.splice(0)) job.reject(new CancelledError());
      for (const [id, stop] of sleeping) {
        deps.timers.clear(id);
        stop();
      }
      sleeping.clear();
    },
  };
}
