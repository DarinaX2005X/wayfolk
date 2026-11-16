/**
 * Previews of live code projects: POST /api/r uploads the files, GET /api/r/<code>/<path>
 * serves one (api/_lib/preview.ts). Needs the rewrite { "source": "/api/r/:path*",
 * "destination": "/api/r" } in vercel.json.
 */
import { FUNCTIONS } from './_bundle.js';

const routes = FUNCTIONS.r!;

export function GET(request: Request): Promise<Response> {
  return routes.GET!(request);
}

export function POST(request: Request): Promise<Response> {
  return routes.POST!(request);
}
