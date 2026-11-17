/**
 * The public islands function: /api/islands and its subpaths (vercel.json rewrites
 * /api/islands/:path* here). The handlers live in api/_lib/islands.ts and reach Vercel
 * through the bundle (tools/dev-api/bundle.mjs says why).
 */
import { FUNCTIONS } from './_bundle.js';

const routes = FUNCTIONS.islands;

export function GET(request: Request): Promise<Response> {
  return routes.GET!(request);
}

export function POST(request: Request): Promise<Response> {
  return routes.POST!(request);
}

export function PUT(request: Request): Promise<Response> {
  return routes.PUT!(request);
}

export function DELETE(request: Request): Promise<Response> {
  return routes.DELETE!(request);
}
