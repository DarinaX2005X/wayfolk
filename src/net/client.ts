/**
 * The one way the client talks to /api/*: JSON in and out, a finite deadline, the API's
 * error shape turned into a typed NetError, and the test failure header for scenarios.
 * Typed clients of the three functions (llm, code, worlds) are built on it by package
 * 01.5; no feature calls `fetch` for /api/* itself.
 *
 * Dependencies are injected so it is tested without a network; ./index.ts wires the
 * real fetch.
 */
import type { TestFail } from '../../api/_lib/contracts';

/**
 * offline: no answer at all (no network, connection dropped); timeout: no answer in
 * time; http: the server answered with an error status (`code` is its `error` field);
 * bad-answer: a 2xx whose body is not JSON.
 */
export type NetErrorKind = 'offline' | 'timeout' | 'http' | 'bad-answer';

export class NetError extends Error {
  constructor(
    public kind: NetErrorKind,
    public status = 0,
    public code: string | null = null,
    /** The whole error body, for fields like `retryAfter` and `need`. */
    public body: Record<string, unknown> | null = null,
  ) {
    super(`net: ${kind}${status ? ` ${status}` : ''}${code ? ` ${code}` : ''}`);
    this.name = 'NetError';
  }
}

export type NetDeps = {
  fetch(input: string, init?: RequestInit): Promise<Response>;
  /** Origin of the API; empty for the same origin as the page. */
  apiBase?: string;
};

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Whole request, ms. Default 10 s; the model proxy asks for 58 s. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type Net = {
  /** Sends a request to `/api/...` and resolves with the parsed JSON of a 2xx answer. */
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  /** Scenarios only: every following request carries `x-test-fail: <mode>` until set to null. */
  setTestFailure(mode: TestFail | null): void;
};

export const DEFAULT_TIMEOUT_MS = 10_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function createNet(deps: NetDeps): Net {
  let testFailure: TestFail | null = null;
  const base = (deps.apiBase ?? '').replace(/\/+$/, '');

  return {
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      if (!path.startsWith('/api/')) throw new Error(`net: ${path} is not an /api/ address`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const outer = options.signal;
      const onOuter = (): void => controller.abort();
      outer?.addEventListener('abort', onOuter, { once: true });
      const headers = new Headers(options.headers);
      if (options.body !== undefined) headers.set('content-type', 'application/json');
      if (testFailure) headers.set('x-test-fail', testFailure);

      let response: Response;
      try {
        response = await deps.fetch(base + path, {
          method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
      } catch (err) {
        if (outer?.aborted) throw err;
        throw new NetError(controller.signal.aborted ? 'timeout' : 'offline');
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener('abort', onOuter);
      }

      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      if (!response.ok) {
        const body = isRecord(parsed) ? parsed : null;
        throw new NetError('http', response.status, typeof body?.error === 'string' ? body.error : null, body);
      }
      if (parsed === null) throw new NetError('bad-answer', response.status);
      return parsed as T;
    },
    setTestFailure(mode) {
      testFailure = mode;
    },
  };
}
