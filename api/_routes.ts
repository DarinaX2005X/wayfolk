/**
 * The entry of the server bundle. Vercel does not bundle files in api/ (the reason is in
 * tools/dev-api/bundle.mjs), so `node tools/dev-api/bundle.mjs` bundles this file into
 * api/_bundle.js and each function file re-exports its handlers from there:
 *
 *   api/llm.ts      export { GET, POST } from './_bundle.js' (through FUNCTIONS.llm)
 *   api/code.ts     /api/code and its subpaths (vercel.json rewrites them here)
 *   api/worlds.ts   /api/worlds and its subpaths
 *
 * `handle(request)` serves any /api/* address by its first segment; the Vite dev server
 * (tools/dev-api/plugin.ts), `npm run xr:prod` and tests call it, so every environment
 * runs the same handlers.
 */
import { fail } from './_lib/http';
import { setFixtureSource } from './_lib/llm/fixtures';
import { createLlmRoutes } from './_lib/llm/route';

/** The dev server gives the `fixtures` provider the answer sets on disk (tools/dev-api/plugin.ts). */
export { setFixtureSource };

export type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type Handler = (request: Request) => Promise<Response>;
export type FunctionRoutes = Partial<Record<Method, Handler>>;
export type FunctionName = 'llm' | 'code' | 'worlds';

/** The deployed functions by name. `code` and `worlds` are added by 02.4 and 04.1. */
export const FUNCTIONS: Partial<Record<FunctionName, FunctionRoutes>> = {
  llm: createLlmRoutes(),
};

/** `/api/code/X4KM7/close` -> 'code'. Null for an address outside /api/. */
export function functionOf(pathname: string): string | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  if (parts[0] !== 'api' || parts.length < 2) return null;
  return parts[1];
}

/**
 * Serves one /api/* request: 404 for an unknown function (with `route: false`, so a
 * client can tell a missing function from a missing record), 405 for a method it lacks.
 */
export async function handle(request: Request): Promise<Response> {
  const name = functionOf(new URL(request.url, 'http://localhost').pathname);
  const routes = name !== null && Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name as FunctionName] : undefined;
  if (!routes) return fail(404, 'not-found', { route: false });
  const method = request.method.toUpperCase() as Method;
  const handler = routes[method];
  if (!handler) {
    const allow = Object.keys(routes).join(', ');
    const response = fail(405, 'method');
    response.headers.set('allow', allow);
    return response;
  }
  return handler(request);
}
