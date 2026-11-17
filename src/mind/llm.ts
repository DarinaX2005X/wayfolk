/**
 * The mind's way to the model: POST /api/llm (api/_lib/llm/route.ts) with the session's
 * run id, a deadline per call and a plain result instead of a thrown error, so every
 * caller falls back to prepared content on any failure. The proxy's status (GET
 * /api/llm) is read once and again after a minute; a refusal that means "no live model
 * today" (no key, no credit, the daily cap) switches live calls off for the session.
 */
import type { ChatMessage, JsonSchema, LlmResponse, LlmStatus, LlmTask } from '../../api/_lib/contracts';

export type ModelResult =
  | { ok: true; json: unknown; ms: number; model: string }
  | { ok: false; reason: 'off' | 'offline' | 'cap' | 'busy' | 'bad-output' | 'timeout' | 'network'; ms: number };

export type ModelCall = {
  task: LlmTask;
  messages: ChatMessage[];
  schema: JsonSchema;
  audio?: string;
  maxTokens?: number;
  timeoutMs: number;
  attempt?: number;
};

export type ModelClient = {
  /** Whether live calls can be made now (proxy live, not switched off). */
  available(): Promise<boolean>;
  status(): Promise<{ live: boolean; audio: boolean }>;
  call(c: ModelCall): Promise<ModelResult>;
  /** Spend, calls and time of this session (for the debug panel and reports). */
  readonly stats: { calls: number; failures: number; lastMs: number };
};

export function createModelClient(options: { api: string; runId: string; fetch: typeof fetch; now: () => number }): ModelClient {
  const { api, runId, now } = options;
  const doFetch = options.fetch;
  let status: { live: boolean; audio: boolean; at: number } | null = null;
  let switchedOff = false;
  let audioOff = false;
  let index = 0;
  const stats = { calls: 0, failures: 0, lastMs: 0 };

  async function readStatus(): Promise<{ live: boolean; audio: boolean }> {
    if (status && now() - status.at < 60_000) return status;
    try {
      const response = await doFetch(`${api}/api/llm`, { signal: AbortSignal.timeout(4000) });
      const body = (await response.json()) as Partial<LlmStatus>;
      status = { live: response.ok && body.live === true, audio: body.audio === true, at: now() };
    } catch {
      status = { live: false, audio: false, at: now() };
    }
    return status;
  }

  return {
    stats,
    async status() {
      const s = await readStatus();
      return { live: s.live && !switchedOff, audio: s.audio && !switchedOff && !audioOff };
    },
    async available() {
      if (switchedOff) return false;
      return (await readStatus()).live;
    },
    async call(c) {
      const started = now();
      const done = (r: Omit<Extract<ModelResult, { ok: false }>, 'ms'>): ModelResult => {
        stats.failures += 1;
        return { ...r, ms: now() - started };
      };
      if (switchedOff) return done({ ok: false, reason: 'off' });
      stats.calls += 1;
      const body = { task: c.task, index: index++, attempt: c.attempt ?? 0, messages: c.messages, schema: c.schema, runId, audio: c.audio, maxTokens: c.maxTokens };
      let response: Response;
      try {
        response = await doFetch(`${api}/api/llm`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(c.timeoutMs),
        });
      } catch (err) {
        return done({ ok: false, reason: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'network' });
      }
      let answer: unknown = null;
      try {
        answer = await response.json();
      } catch {
        return done({ ok: false, reason: 'network' });
      }
      if (response.ok) {
        const a = answer as LlmResponse;
        stats.lastMs = now() - started;
        return { ok: true, json: a.json, ms: stats.lastMs, model: a.model };
      }
      const refusal = answer as { error?: string; need?: string } | null;
      const error = refusal?.error;
      if (error === 'agents-offline' && refusal?.need === 'model') {
        // The model for this kind of call is missing; other calls may still work.
        if (c.audio) audioOff = true;
        return done({ ok: false, reason: 'offline' });
      }
      if (error === 'agents-offline' || error === 'daily-cap') {
        switchedOff = true;
        return done({ ok: false, reason: error === 'daily-cap' ? 'cap' : 'offline' });
      }
      if (error === 'bad-output') return done({ ok: false, reason: 'bad-output' });
      if (error === 'timeout') return done({ ok: false, reason: 'timeout' });
      return done({ ok: false, reason: 'busy' });
    },
  };
}

/** A client that never reaches a model (tests, `liveAI: false`). */
export const noModel: ModelClient = {
  stats: { calls: 0, failures: 0, lastMs: 0 },
  async available() {
    return false;
  },
  async status() {
    return { live: false, audio: false };
  },
  async call() {
    return { ok: false, reason: 'off', ms: 0 };
  },
};
