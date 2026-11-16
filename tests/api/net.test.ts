import { describe, expect, it, vi } from 'vitest';
import { NetError, createNet } from '../../src/net/client';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('the API client', () => {
  it('sends JSON and resolves with the answer', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, { code: 'X4KM7' }));
    const net = createNet({ fetch });
    expect(await net.request('/api/code', { body: { kind: 'drop' } })).toEqual({ code: 'X4KM7' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/code');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe('{"kind":"drop"}');
  });

  it('turns an error answer into NetError with its code and body', async () => {
    const net = createNet({ fetch: async () => jsonResponse(429, { error: 'rate-limited', retryAfter: 4 }) });
    const error = await net.request('/api/llm').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetError);
    expect(error).toMatchObject({ kind: 'http', status: 429, code: 'rate-limited', body: { retryAfter: 4 } });
  });

  it('reports no network as offline and no answer in time as timeout', async () => {
    const offline = createNet({ fetch: async () => Promise.reject(new TypeError('Failed to fetch')) });
    await expect(offline.request('/api/llm')).rejects.toMatchObject({ kind: 'offline' });
    const hanging = createNet({
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        ),
    });
    await expect(hanging.request('/api/llm', { timeoutMs: 30 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('refuses a 2xx that is not JSON', async () => {
    const net = createNet({ fetch: async () => new Response('<html>', { status: 200 }) });
    await expect(net.request('/api/llm')).rejects.toMatchObject({ kind: 'bad-answer' });
  });

  it('carries the test failure header until it is switched off', async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse(200, {}));
    const net = createNet({ fetch });
    net.setTestFailure('offline');
    await net.request('/api/llm');
    net.setTestFailure(null);
    await net.request('/api/llm');
    expect(new Headers(fetch.mock.calls[0][1]?.headers).get('x-test-fail')).toBe('offline');
    expect(new Headers(fetch.mock.calls[1][1]?.headers).get('x-test-fail')).toBeNull();
  });

  it('only talks to /api/ addresses', async () => {
    const net = createNet({ fetch: async () => jsonResponse(200, {}) });
    await expect(net.request('https://elsewhere.example/x')).rejects.toThrow('not an /api/ address');
  });
});
