/**
 * The API on the Vite dev server: every /api/* request goes to `handle` of
 * api/_routes.ts, the same handlers the deployed functions run. The storage driver is
 * `memory` unless STORAGE_DRIVER says otherwise, so records live until the server stops.
 * The model provider is `fixtures` unless LLM_PROVIDER says otherwise, so the key in
 * .env.local is not spent by opening the app; its answer sets are the JSON files of
 * content/answers/ (and of LLM_FIXTURE_DIRS, comma separated), read on each request.
 *
 *   vite.config.ts:  plugins: [iwsdkDev(), devApi()]
 *
 * `npm run xr:prod` serves the production build through the same server (GW_SERVE_DIST=1
 * in vite.config.ts), so hand scenarios on dist/ reach the same /api/* routes.
 *
 * A request may ask for a failure with the header `x-test-fail`, so scenarios and manual
 * checks can see what the product does when the server misbehaves. Two failures are of
 * the transport and are made here:
 *
 *   offline   the connection is dropped without an answer
 *   slow      the answer comes after 12 s, later than a client is willing to wait
 *
 * The others (429, 503, 401, 404, bad-output, daily-cap, storage-busy) are answers of a
 * route and are made by the routes themselves (package 01.5), which see the header.
 */
import { readFile, readdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import type { AnswerSet } from '../../src/agents/types';

type FixtureSource = (example: string, scope: 'full' | 'late') => Promise<AnswerSet | null>;

/** What the plugin needs from api/_routes.ts. */
export type RoutesModule = {
  handle(request: Request): Promise<Response>;
  setFixtureSource?(source: FixtureSource): void;
};

const isAnswerSet = (value: unknown): value is AnswerSet => {
  const v = value as Partial<AnswerSet> | null;
  return typeof v === 'object' && v !== null && typeof v.example === 'string' && (v.scope === 'full' || v.scope === 'late') && Array.isArray(v.calls);
};

/**
 * Answer sets from JSON files in `dirs`, read when asked. A recording of the real model
 * wins over a scripted set of the same example and scope, as in content/answers/index.ts.
 * Files that are not answer sets (expected numbers, notes) are skipped.
 */
export function diskFixtures(dirs: string[]): FixtureSource {
  return async (example, scope) => {
    const found: AnswerSet[] = [];
    for (const dir of dirs) {
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const name of names.filter((n) => n.endsWith('.json'))) {
        try {
          const value: unknown = JSON.parse(await readFile(path.join(dir, name), 'utf8'));
          if (isAnswerSet(value) && value.example === example && value.scope === scope) found.push(value);
        } catch {
          // not a readable answer set
        }
      }
    }
    return found.find((set) => set.answers === 'recorded') ?? found[0] ?? null;
  };
}

export type DevApi = {
  middleware(req: IncomingMessage, res: ServerResponse, next: () => void): void;
};

const SLOW_MS = 12_000;
/** Bodies are cut here; the routes refuse anything over their own 4 MB limit as too big. */
const KEEP_BYTES = 4 * 1024 * 1024 + 1;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function originOf(req: IncomingMessage): string {
  const secure = (req.socket as { encrypted?: boolean }).encrypted === true;
  return `${secure ? 'https' : 'http'}://${req.headers.host ?? 'localhost'}`;
}

/**
 * Reads the whole request body but keeps at most `keep` bytes of it. The rest is read
 * and thrown away, so the connection stays usable after an oversized upload is refused.
 */
function collectBody(req: IncomingMessage, keep: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let kept = 0;
    req.on('data', (chunk: Buffer) => {
      if (kept >= keep) return;
      const part = kept + chunk.length > keep ? chunk.subarray(0, keep - kept) : chunk;
      chunks.push(part);
      kept += part.length;
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toRequest(req: IncomingMessage, body: Buffer): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  // The address the routes count by comes from the socket, as on Vercel it comes from the platform.
  headers.set('x-real-ip', req.socket.remoteAddress ?? 'unknown');
  headers.delete('transfer-encoding');
  headers.set('content-length', String(body.length));
  const method = req.method ?? 'GET';
  const init: RequestInit = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = new Uint8Array(body);
  return new Request(originOf(req) + (req.url ?? '/'), init);
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function createDevApi(options: { load(): Promise<RoutesModule>; slowMs?: number }): DevApi {
  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const { pathname } = new URL(req.url ?? '/', 'http://dev.local');
    if (pathname !== '/api' && !pathname.startsWith('/api/')) return next();

    const wanted = req.headers['x-test-fail'];
    if (wanted === 'offline') {
      req.socket.destroy();
      return;
    }
    const body = await collectBody(req, KEEP_BYTES);
    if (wanted === 'slow') {
      await new Promise((resolve) => setTimeout(resolve, options.slowMs ?? SLOW_MS));
      if (res.destroyed || req.socket.destroyed) return;
    }
    const routes = await options.load();
    return send(res, await routes.handle(toRequest(req, body)));
  };

  return {
    middleware(req, res, next) {
      handle(req, res, next).catch((err: unknown) => {
        console.warn('[dev-api]', err instanceof Error ? err.message : err);
        if (res.headersSent || res.destroyed) return;
        void send(res, jsonResponse(500, { error: 'server' }));
      });
    },
  };
}

/**
 * Vite plugin: serves /api/* on the dev server. Server-side variables from `.env.local`
 * (names without the VITE_ prefix) are put into process.env for the routes when they are
 * not set already; they never reach the client bundle.
 */
export function devApi(): Plugin {
  return {
    name: 'groundwork:dev-api',
    apply: 'serve',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '');
      for (const [name, value] of Object.entries(env)) {
        if (!name.startsWith('VITE_') && process.env[name] === undefined) process.env[name] = value;
      }
      process.env.STORAGE_DRIVER ??= 'memory';
      process.env.LLM_PROVIDER ??= 'fixtures';
      // Routes honour x-test-fail only where this is set: here, never on a deployment.
      process.env.API_TEST_FAIL = '1';
      const root = server.config.root;
      const dirs = [path.join(root, 'content', 'answers'), ...(process.env.LLM_FIXTURE_DIRS ?? '').split(',').filter(Boolean).map((d) => path.resolve(root, d.trim()))];
      const fixtures = diskFixtures(dirs);
      const api = createDevApi({
        load: async () => {
          const routes = (await server.ssrLoadModule('/api/_routes.ts')) as RoutesModule;
          routes.setFixtureSource?.(fixtures);
          return routes;
        },
      });
      server.middlewares.use(api.middleware);
    },
  };
}
