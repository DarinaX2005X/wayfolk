/**
 * Google Gemini `generateContent`, the spare adapter. Written from the API reference and
 * checked on a stubbed fetch only; the live check belongs to OpenRouter.
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
 *   header x-goog-api-key
 *   generationConfig: { responseMimeType: 'application/json', responseSchema }
 *
 * System messages become `systemInstruction`, user messages `contents`; audio goes as
 * `inlineData` with `audio/wav`. `responseSchema` is the OpenAPI subset of Gemini: type
 * names in upper case, `format: 'enum'` with `enum`, no `additionalProperties`.
 * Cost comes from `usageMetadata` tokens and LLM_PRICE_IN / LLM_PRICE_OUT.
 *
 * Statuses: 400 with API_KEY_INVALID, 401 and 403 are a key problem; 404 and a 400 naming
 * the model are a model refusal; 429 a rate limit (RetryInfo `retryDelay` or
 * Retry-After); 5xx busy.
 */
import type { ChatMessage, JsonSchema } from '../contracts';
import { withAudio } from './request';
import { retryAfterSeconds, thrownOutcome, type Outcome, type ProviderAdapter } from './provider';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

type GeminiSchema = Record<string, unknown>;

export function geminiSchema(schema: JsonSchema): GeminiSchema {
  const out: GeminiSchema = { type: schema.type.toUpperCase() };
  if (schema.description) out.description = schema.description;
  if (schema.enum) {
    out.enum = schema.enum;
    out.format = 'enum';
  }
  if (schema.properties) {
    out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, geminiSchema(v)]));
  }
  if (schema.required) out.required = schema.required;
  if (schema.items) out.items = geminiSchema(schema.items);
  if (schema.minItems !== undefined) out.minItems = schema.minItems;
  if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
  return out;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

function partsOf(message: ChatMessage): Part[] {
  if (typeof message.content === 'string') return [{ text: message.content }];
  return message.content.map((part) =>
    part.type === 'text' ? { text: part.text } : { inlineData: { mimeType: 'audio/wav', data: part.input_audio.data } },
  );
}

function retryDelay(body: unknown): string | null {
  const details = (body as { error?: { details?: { retryDelay?: unknown }[] } } | null)?.error?.details;
  const found = Array.isArray(details) ? details.find((d) => typeof d?.retryDelay === 'string') : undefined;
  const match = typeof found?.retryDelay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(found.retryDelay) : null;
  return match ? match[1] : null;
}

export function createGemini(options: { key: string; fetch?: typeof fetch; base?: string }): ProviderAdapter {
  const doFetch = options.fetch ?? fetch;
  return async ({ body, model, signal }) => {
    const messages = withAudio(body);
    const system = messages.filter((m) => m.role === 'system').flatMap(partsOf);
    const request: Record<string, unknown> = {
      contents: messages.filter((m) => m.role === 'user').map((m) => ({ role: 'user', parts: partsOf(m) })),
      generationConfig: { responseMimeType: 'application/json', responseSchema: geminiSchema(body.schema) },
    };
    if (system.length > 0) request.systemInstruction = { parts: system };
    const id = model.replace(/^models\//, '');
    let response: Response;
    try {
      response = await doFetch(`${options.base ?? GEMINI_BASE}/models/${encodeURIComponent(id)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': options.key, 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
    } catch {
      return thrownOutcome(signal);
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      if (signal.aborted) return { ok: false, kind: 'timeout' };
    }
    if (!response.ok) {
      const raw = JSON.stringify(parsed ?? '');
      const status = response.status;
      if (status === 401 || status === 403 || (status === 400 && raw.includes('API_KEY_INVALID'))) {
        return { ok: false, kind: 'offline', need: 'key' };
      }
      if (status === 404 || (status === 400 && (raw.includes(id) || (/model/i.test(raw) && /not found|unsupported|invalid/i.test(raw))))) {
        return { ok: false, kind: 'model' };
      }
      if (status === 429) {
        return { ok: false, kind: 'rate-limited', retryAfter: retryAfterSeconds(response.headers.get('retry-after') ?? retryDelay(parsed), 5) };
      }
      if (status >= 500) return { ok: false, kind: 'busy' };
      return { ok: false, kind: 'error' } satisfies Outcome;
    }
    const data = parsed as {
      candidates?: { content?: { parts?: { text?: unknown }[] } }[];
      usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
      modelVersion?: unknown;
    } | null;
    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('');
    const meta = data?.usageMetadata;
    return {
      ok: true,
      text,
      model: typeof data?.modelVersion === 'string' ? data.modelVersion : id,
      usage: {
        inTokens: typeof meta?.promptTokenCount === 'number' ? meta.promptTokenCount : undefined,
        outTokens: typeof meta?.candidatesTokenCount === 'number' ? meta.candidatesTokenCount : undefined,
      },
    };
  };
}
