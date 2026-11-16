/**
 * Small HTTP helpers shared by the three functions (api/llm.ts, api/code.ts,
 * api/worlds.ts): JSON answers and refusals in the one shape of PLAN "API"
 * (`{ error: <code>, ... }`), a bounded body reader, the caller's address and its keyed
 * hash, constant-time comparison of owner key hashes and an error text safe for logs.
 * Plain Request and Response: the same code runs on Vercel, on the Vite dev server
 * (tools/dev-api/plugin.ts) and in tests. Owner from package 01.5 on.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ApiErrorCode } from './contracts';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const;
export const NO_STORE = { 'cache-control': 'no-store' } as const;
/** Public reads (worlds, published work, export and visit codes) sit in the CDN for a minute. */
export const PUBLIC_MINUTE = { 'cache-control': 'public, s-maxage=60' } as const;
/** Request bodies are at most 4 MB (PLAN "API"); Vercel itself stops at 4.5 MB. */
export const BODY_LIMIT = 4 * 1024 * 1024;

/** A JSON answer. Not cached unless headers say otherwise. */
export function json(status: number, body: unknown, headers: Record<string, string> = NO_STORE): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

/** A refusal: `{ error, ...extra }`. A 429 with `retryAfter` also gets the Retry-After header. */
export function fail(status: number, error: ApiErrorCode, extra: Record<string, unknown> = {}): Response {
  const headers: Record<string, string> = { ...NO_STORE };
  if (typeof extra.retryAfter === 'number' && Number.isFinite(extra.retryAfter)) {
    headers['retry-after'] = String(Math.max(0, Math.ceil(extra.retryAfter)));
  }
  return json(status, { error, ...extra }, headers);
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads the body but never more than `limit` bytes: a larger body is refused by its
 * declared length when there is one, and otherwise as soon as the limit is crossed.
 * Resolves null for a body over the limit.
 */
export async function readBody(request: Request, limit = BODY_LIMIT): Promise<Uint8Array | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * The body as JSON. `too-big` over the limit, `bad-request` when it is not JSON.
 * The caller validates the shape.
 */
export async function readJson(
  request: Request,
  limit = BODY_LIMIT,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const bytes = await readBody(request, limit);
  if (bytes === null) return { ok: false, response: fail(413, 'too-big') };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, response: fail(400, 'bad-request') };
  }
}

/** Address of the caller. Vercel sets both headers itself; a client cannot forge them there. */
export function clientAddress(request: Request): string {
  const real = request.headers.get('x-real-ip')?.trim();
  if (real) return real;
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || 'unknown';
}

/**
 * The caller's address as a keyed hash (32 hex characters), so counters can be kept per
 * address without storing an address that could be matched back to a person.
 */
export function hashAddress(request: Request, key: string): string {
  return createHmac('sha256', key || 'groundwork').update(clientAddress(request)).digest('hex').slice(0, 32);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Constant-time comparison of two hashes (owner keys are checked this way). */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Text of an error that is safe to log: no storage or provider secrets, bounded length. */
export function describeError(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text
    .replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, '[token]')
    .replace(/sk-or-[A-Za-z0-9_-]+/g, '[key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [key]')
    .slice(0, 300);
}
