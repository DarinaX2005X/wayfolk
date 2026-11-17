/**
 * tools/dev-api/plugin.ts on a real HTTP server: /api/* reaches the routes with the
 * request as sent (method, body, address), other addresses fall through to Vite, and
 * the transport failures asked for with x-test-fail happen.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevApi } from '../../tools/dev-api/plugin';

let server: Server;
let base = '';
const seen: { method: string; url: string; body: string; ip: string | null }[] = [];

beforeAll(async () => {
  const api = createDevApi({
    slowMs: 300,
    async load() {
      return {
        async handle(request: Request) {
          seen.push({ method: request.method, url: request.url, body: await request.text(), ip: request.headers.get('x-real-ip') });
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
        },
      };
    },
  });
  server = createServer((req, res) =>
    api.middleware(req, res, () => {
      res.statusCode = 299;
      res.end('vite');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe('the dev API', () => {
  it('hands /api/* to the routes with method, path, body and the socket address', async () => {
    const response = await fetch(`${base}/api/code/X4KM7/close?x=1`, { method: 'POST', body: '{"job":"case"}' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const last = seen.at(-1);
    expect(last).toMatchObject({ method: 'POST', body: '{"job":"case"}', ip: '127.0.0.1' });
    expect(new URL(last?.url ?? '').pathname).toBe('/api/code/X4KM7/close');
  });

  it('lets every other address through to Vite', async () => {
    const before = seen.length;
    expect((await fetch(`${base}/app?run=harbor-street`)).status).toBe(299);
    expect((await fetch(`${base}/apiary`)).status).toBe(299);
    expect(seen.length).toBe(before);
  });

  it('drops the connection for x-test-fail: offline', async () => {
    await expect(fetch(`${base}/api/llm`, { headers: { 'x-test-fail': 'offline' } })).rejects.toThrow();
  });

  it('answers late for x-test-fail: slow', async () => {
    const started = Date.now();
    const response = await fetch(`${base}/api/llm`, { headers: { 'x-test-fail': 'slow' } });
    expect(response.status).toBe(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
  });
});
