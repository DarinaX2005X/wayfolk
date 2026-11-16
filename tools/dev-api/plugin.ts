/**
 * The API on the Vite dev server: every /api/* request goes to `handle` of
 * api/_routes.ts, the same handlers the deployed functions run. The storage driver is
 * `memory` unless STORAGE_DRIVER says otherwise, so records live until the server stops.
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
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadEnv, type Plugin } from 'vite';

/** What the plugin needs from api/_routes.ts. */
export type RoutesModule = { handle(request: Request): Promise<Response> };

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
      const api = createDevApi({
        load: () => server.ssrLoadModule('/api/_routes.ts') as Promise<RoutesModule>,
      });
      server.middlewares.use(api.middleware);
    },
  };
}
