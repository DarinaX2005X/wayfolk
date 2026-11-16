/**
 * What every provider adapter returns: an answer with its cost, or one of a few kinds of
 * refusal that the route maps to the error table of PLAN "API". Adapters do one HTTP call
 * and never retry; the route retries once with the next model on a model refusal.
 */
import type { LlmCallBody } from '../contracts';

export type Usage = {
  /** USD reported by the provider (OpenRouter `usage.cost`). */
  costUsd?: number;
  inTokens?: number;
  outTokens?: number;
};

export type Outcome =
  /** `text`: the model's raw answer; `json`: an answer that is already a value (fixtures). */
  | { ok: true; text?: string; json?: unknown; model: string; usage: Usage; ms?: number }
  | { ok: false; kind: 'rate-limited'; retryAfter: number; usage?: Usage }
  /** Overloaded, 5xx, network trouble on the way to the provider: worth a later retry. */
  | { ok: false; kind: 'busy'; usage?: Usage }
  /** Needs a person: a key, credit, or a recorded answer. */
  | { ok: false; kind: 'offline'; need: 'key' | 'credit' | 'fixture'; usage?: Usage }
  /** The model is unknown or no provider serves it with these parameters. */
  | { ok: false; kind: 'model'; usage?: Usage }
  /** The provider refused this request for another reason (moderation, bad parameters). */
  | { ok: false; kind: 'error'; usage?: Usage }
  /** A recorded answer that was itself a failed call. */
  | { ok: false; kind: 'bad-output'; usage?: Usage }
  | { ok: false; kind: 'timeout'; usage?: Usage };

export type ProviderCall = {
  body: LlmCallBody;
  /** The model to ask now. */
  model: string;
  /** The rest of the list, in order, for providers with their own fallback (OpenRouter `models`). */
  fallbacks: string[];
  signal: AbortSignal;
};

export type ProviderAdapter = (call: ProviderCall) => Promise<Outcome>;

/** Seconds from a Retry-After header (seconds or an HTTP date), or `fallback`. */
export function retryAfterSeconds(header: string | null, fallback: number, now = Date.now()): number {
  if (!header) return fallback;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120, Math.ceil(seconds));
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(120, Math.max(1, Math.ceil((at - now) / 1000)));
  return fallback;
}

/** The outcome of a fetch that threw: our deadline, or the network. */
export function thrownOutcome(signal: AbortSignal): Outcome {
  return signal.aborted ? { ok: false, kind: 'timeout' } : { ok: false, kind: 'busy' };
}
