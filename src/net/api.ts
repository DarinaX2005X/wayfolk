/**
 * Typed calls of the other routes (PLAN "API": /api/code and /api/worlds). Each resolves
 * with a result instead of throwing, so a view always has something to show:
 *
 *   { ok: true, value }                     the answer
 *   { ok: false, error: { code, ... } }     a refusal the interface can name
 *
 * `server-off` covers every way the server cannot be used: no network, no answer in
 * time, an answer that is not ours (the platform's error page, a function that does not
 * exist yet) and storage that is not configured. `storage-busy` and `storage-readonly`
 * arrive as one `storage-busy`, because the interface says the same for both. Owner
 * routes send `x-owner-key` from `gw.ownerKey` on this device.
 */
import type {
  CloseCodeBody,
  CodeRecord,
  CreateCodeAnswer,
  CreateCodeBody,
  CreateWorldAnswer,
  CreateWorldBody,
  IceAnswer,
  OkAnswer,
  PublicProject,
  PublicWorld,
  RevAnswer,
} from '../../api/_lib/contracts';
import { NetError, type Net, type RequestOptions } from './client';

export type ApiFailureCode =
  | 'server-off'
  | 'storage-busy'
  | 'bad-request'
  | 'too-big'
  | 'too-many'
  | 'too-many-tries'
  | 'too-many-polls'
  | 'not-found'
  | 'private'
  | 'expired'
  | 'type'
  | 'forbidden'
  | 'conflict';

export type ApiFailure = { code: ApiFailureCode; status: number; current?: number; retryAfter?: number };
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiFailure };

const PASSED: readonly string[] = [
  'bad-request',
  'too-big',
  'too-many',
  'too-many-tries',
  'too-many-polls',
  'not-found',
  'private',
  'expired',
  'type',
  'forbidden',
  'conflict',
];

/** One public STUN server, for when /api/code/ice cannot be reached (same as the server's). */
export const FALLBACK_ICE: IceAnswer = { iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }], relay: false };

export function toFailure(err: unknown): ApiFailure {
  if (!(err instanceof NetError) || err.kind !== 'http') return { code: 'server-off', status: err instanceof NetError ? err.status : 0 };
  const body = err.body ?? {};
  const failure = (code: ApiFailureCode): ApiFailure => {
    const out: ApiFailure = { code, status: err.status };
    if (typeof body.current === 'number') out.current = body.current;
    if (typeof body.retryAfter === 'number') out.retryAfter = body.retryAfter;
    return out;
  };
  if (err.code === 'storage-busy' || err.code === 'storage-readonly') return failure('storage-busy');
  if (err.code === 'not-found' && body.route === false) return failure('server-off');
  if (err.code && PASSED.includes(err.code)) return failure(err.code as ApiFailureCode);
  if (err.status === 404) return failure('not-found');
  if (err.status === 410) return failure('expired');
  if (err.status === 403) return failure('forbidden');
  return failure('server-off');
}

export type ApiDeps = {
  net: Net;
  /** The owner key of this device's world, or null before the first share. */
  ownerKey(): string | null;
};

/** Requests bounded at 10 s; uploads of an export body get 30 s. */
const TIMEOUT_MS = 10_000;
const LONG_TIMEOUT_MS = 30_000;

const code = (value: string): string => encodeURIComponent(value.trim().toUpperCase());
const seg = (value: string): string => encodeURIComponent(value);

export function createApi(deps: ApiDeps) {
  async function call<T>(path: string, options: RequestOptions & { owner?: boolean } = {}): Promise<ApiResult<T>> {
    const headers: Record<string, string> = { ...options.headers };
    if (options.owner) {
      const key = deps.ownerKey();
      if (!key) return { ok: false, error: { code: 'forbidden', status: 0 } };
      headers['x-owner-key'] = key;
    }
    try {
      const value = await deps.net.request<T>(path, { timeoutMs: TIMEOUT_MS, ...options, headers });
      return { ok: true, value };
    } catch (err) {
      if (options.signal?.aborted) throw err;
      return { ok: false, error: toFailure(err) };
    }
  }

  return {
    /** POST /api/code. `files` and `visit` need the owner key. */
    createCode(body: CreateCodeBody, signal?: AbortSignal) {
      const owner = body.kind === 'files' || body.kind === 'visit';
      const timeoutMs = body.kind === 'export' ? LONG_TIMEOUT_MS : TIMEOUT_MS;
      return call<CreateCodeAnswer>('/api/code', { body, owner, timeoutMs, signal });
    },
    /** GET /api/code/ice. Use FALLBACK_ICE when it fails. */
    ice(signal?: AbortSignal) {
      return call<IceAnswer>('/api/code/ice', { signal });
    },
    readCode(value: string, signal?: AbortSignal) {
      return call<CodeRecord>(`/api/code/${code(value)}`, { signal });
    },
    closeCode(value: string, body: CloseCodeBody, signal?: AbortSignal) {
      return call<OkAnswer>(`/api/code/${code(value)}/close`, { body, signal });
    },
    doneCode(value: string, signal?: AbortSignal) {
      return call<OkAnswer>(`/api/code/${code(value)}/done`, { method: 'POST', signal });
    },
    /** Where `upload()` of @vercel/blob/client asks for its token. */
    uploadUrl(value: string): string {
      return `/api/code/${code(value)}/upload`;
    },
    createWorld(body: CreateWorldBody = {}, signal?: AbortSignal) {
      return call<CreateWorldAnswer>('/api/worlds', { body, signal });
    },
    readWorld(name: string, signal?: AbortSignal) {
      return call<PublicWorld>(`/api/worlds/${seg(name)}`, { signal });
    },
    /** PUT with if-match; a conflict carries the server's `current` rev. */
    putWorld(world: PublicWorld, rev: number, signal?: AbortSignal) {
      return call<RevAnswer>(`/api/worlds/${seg(world.name)}`, {
        method: 'PUT',
        body: world,
        owner: true,
        headers: { 'if-match': String(rev) },
        signal,
      });
    },
    readPublished(world: string, slug: string, signal?: AbortSignal) {
      return call<PublicProject>(`/api/worlds/${seg(world)}/p/${seg(slug)}`, { signal });
    },
    putPublished(project: PublicProject, signal?: AbortSignal) {
      return call<RevAnswer>(`/api/worlds/${seg(project.world)}/p/${seg(project.slug)}`, {
        method: 'PUT',
        body: project,
        owner: true,
        timeoutMs: LONG_TIMEOUT_MS,
        signal,
      });
    },
    deletePublished(world: string, slug: string, signal?: AbortSignal) {
      return call<OkAnswer>(`/api/worlds/${seg(world)}/p/${seg(slug)}`, { method: 'DELETE', owner: true, signal });
    },
  };
}

export type Api = ReturnType<typeof createApi>;
