/**
 * How the engine reads a failed model call. The network client of 01.5 throws its
 * NetError ({ kind, status, code, body }); recordedLlm and tests throw LlmError. Both
 * are read by shape, so the engine does not import the network layer.
 *
 *   rate-limited, provider-busy   wait (retryAfter or 2, 4, 8 s ±20%) and try again
 *   offline                       wait 2, 4, 8 s, then every 8 s for two minutes
 *   timeout                       one more try after 2 s
 *   bad-output                    the job asks again once, then splits the batch
 *   agents-offline, daily-cap,
 *   provider-error, budget        not repeated: the run falls back to recorded answers
 *                                 when it has them, otherwise stops with what is done
 */
import type { RunErrorCode } from './types';

export type LlmErrorCode = RunErrorCode | 'rate-limited' | 'provider-busy';

export class LlmError extends Error {
  constructor(
    public code: LlmErrorCode,
    public retryAfterMs: number | null = null,
    public need: string | null = null,
  ) {
    super(`llm: ${code}${need ? ` (${need})` : ''}`);
    this.name = 'LlmError';
  }
}

/** Thrown into job code when the run is cancelled: never shown as a failure. */
export class CancelledError extends Error {
  constructor() {
    super('run cancelled');
    this.name = 'CancelledError';
  }
}

/** startRun or resumeRun found the job running in another tab. */
export class RunLockedError extends Error {
  readonly code = 'locked';
  constructor(public projectId: string) {
    super('This job is already running in another tab.');
    this.name = 'RunLockedError';
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const HTTP_CODES: Record<string, LlmErrorCode> = {
  'rate-limited': 'rate-limited',
  'daily-cap': 'daily-cap',
  'provider-busy': 'provider-busy',
  'agents-offline': 'agents-offline',
  'bad-output': 'bad-output',
  'provider-error': 'provider-error',
  timeout: 'timeout',
  offline: 'offline',
  budget: 'budget',
};

/** The engine's reading of any error a client threw. */
export function classifyError(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  if (error instanceof CancelledError) throw error;
  if (isRecord(error)) {
    const kind = error.kind;
    const body = isRecord(error.body) ? error.body : null;
    if (kind === 'offline') return new LlmError('offline');
    if (kind === 'timeout') return new LlmError('timeout');
    if (kind === 'bad-answer') return new LlmError('bad-output');
    const code = typeof error.code === 'string' ? error.code : null;
    if (code && HTTP_CODES[code]) {
      const retry = body && typeof body.retryAfter === 'number' ? body.retryAfter * 1000 : null;
      const need = body && typeof body.need === 'string' ? body.need : null;
      return new LlmError(HTTP_CODES[code], retry, need);
    }
    if (error.name === 'AbortError') return new LlmError('timeout');
    if (typeof error.status === 'number') {
      if (error.status === 429) return new LlmError('rate-limited');
      if (error.status === 503) return new LlmError('provider-busy');
      if (error.status === 504) return new LlmError('timeout');
      if (error.status === 422) return new LlmError('bad-output');
    }
  }
  if (error instanceof TypeError) return new LlmError('offline');
  return new LlmError('provider-error');
}

export const RETRYABLE: ReadonlySet<LlmErrorCode> = new Set(['rate-limited', 'provider-busy', 'offline', 'timeout']);
