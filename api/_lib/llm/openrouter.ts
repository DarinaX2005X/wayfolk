/**
 * OpenRouter chat completions (OpenAI format), the main provider.
 *
 *   POST https://openrouter.ai/api/v1/chat/completions
 *   response_format: { type: 'json_schema', json_schema: { name, schema, strict: true } }
 *   usage: { include: true }   (the answer carries `usage.cost` in USD; the docs now say
 *                               usage is always included, the flag is harmless)
 *   models: [...]              the whole remaining list, so OpenRouter falls back itself
 *   reasoning: { enabled: false }  no hidden thinking (it cost 1 000 tokens and 4 s a call)
 *   max_tokens                 from the request's `maxTokens`
 *   provider: { sort }         LLM_PROVIDER_SORT=latency asks for the fastest host of the model
 *
 * Every object of the schema gets `additionalProperties: false` (strict mode requires
 * it). Audio goes as an `input_audio` part with bare base64 and `format: 'wav'`.
 *
 * Statuses (openrouter.ai/docs/api-reference/errors): 401 bad key; 402 no credit; 403
 * moderation or guardrail; 404 no endpoint serves the model with these parameters; 400
 * bad request, which is a model refusal when its message names the model; 408 timeout;
 * 429 rate limit; 502 and 503 model down or no provider available. A 200 can still carry
 * an `error` object and no `choices`; it is read the same way.
 */
import { withAudio } from './request';
import { strictSchema } from './schema';
import { retryAfterSeconds, thrownOutcome, type Outcome, type ProviderAdapter, type Usage } from './provider';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

type ErrorBody = { error?: { code?: number | string; message?: string; metadata?: unknown } };

const isModelMessage = (message: string, model: string): boolean =>
  (model !== '' && message.includes(model)) ||
  /not a valid model|invalid model|model.{0,40}(not found|does not exist|is not available|unknown)|no such model|no endpoints found/i.test(message);

function usageOf(body: unknown): Usage {
  const usage = (body as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== 'object') return {};
  const out: Usage = {};
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0) out.costUsd = usage.cost;
  if (typeof usage.prompt_tokens === 'number') out.inTokens = usage.prompt_tokens;
  if (typeof usage.completion_tokens === 'number') out.outTokens = usage.completion_tokens;
  return out;
}

/** A refusal by status code, shared by HTTP errors and errors inside a 200. */
function refusal(status: number, message: string, model: string, retryHeader: string | null): Outcome {
  if (status === 401) return { ok: false, kind: 'offline', need: 'key' };
  if (status === 402) return { ok: false, kind: 'offline', need: 'credit' };
  if (status === 404) return { ok: false, kind: 'model' };
  if (status === 400) return isModelMessage(message, model) ? { ok: false, kind: 'model' } : { ok: false, kind: 'error' };
  if (status === 408) return { ok: false, kind: 'timeout' };
  if (status === 429) return { ok: false, kind: 'rate-limited', retryAfter: retryAfterSeconds(retryHeader, 5) };
  if (status >= 500) return { ok: false, kind: 'busy' };
  return { ok: false, kind: 'error' };
}

export function createOpenRouter(options: { key: string; siteUrl?: string; fetch?: typeof fetch; url?: string; sort?: 'latency' | 'throughput' | 'price' }): ProviderAdapter {
  const doFetch = options.fetch ?? fetch;
  return async ({ body, model, fallbacks, signal }) => {
    const request: Record<string, unknown> = {
      model,
      messages: withAudio(body),
      response_format: {
        type: 'json_schema',
        json_schema: { name: body.task, schema: strictSchema(body.schema), strict: true },
      },
      usage: { include: true },
    };
    if (body.maxTokens) request.max_tokens = body.maxTokens;
    // Our jobs are short replies; models that think by default (Claude Haiku 5.5) would
    // spend most of the budget and the time on hidden reasoning.
    request.reasoning = { enabled: false };
    if (options.sort) request.provider = { sort: options.sort };
    if (fallbacks.length > 0) request.models = [model, ...fallbacks];
    const headers: Record<string, string> = {
      authorization: `Bearer ${options.key}`,
      'content-type': 'application/json',
      'X-Title': 'Wayfolk',
    };
    if (options.siteUrl) headers['HTTP-Referer'] = options.siteUrl;

    let response: Response;
    try {
      response = await doFetch(options.url ?? OPENROUTER_URL, { method: 'POST', headers, body: JSON.stringify(request), signal });
    } catch {
      return thrownOutcome(signal);
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      if (signal.aborted) return { ok: false, kind: 'timeout' };
      parsed = null;
    }
    const error = (parsed as ErrorBody | null)?.error;
    const message = typeof error?.message === 'string' ? error.message : '';
    if (!response.ok) return refusal(response.status, message, model, response.headers.get('retry-after'));
    if (error) {
      const code = Number(error.code);
      return refusal(Number.isFinite(code) && code >= 400 ? code : 502, message, model, response.headers.get('retry-after'));
    }
    const choice = (parsed as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0];
    const content = choice?.message?.content;
    const answered = typeof (parsed as { model?: unknown } | null)?.model === 'string' ? (parsed as { model: string }).model : model;
    return { ok: true, text: typeof content === 'string' ? content : '', model: answered, usage: usageOf(parsed) };
  };
}
