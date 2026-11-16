/**
 * The model proxy function: GET /api/llm (status) and POST /api/llm (one model call).
 * The handlers live in api/_lib/llm/route.ts and reach Vercel through the bundle
 * (tools/dev-api/bundle.mjs says why); maxDuration 60 s is set in vercel.json.
 */
import { FUNCTIONS } from './_bundle.js';

const routes = FUNCTIONS.llm!;

export function GET(request: Request): Promise<Response> {
  return routes.GET!(request);
}

export function POST(request: Request): Promise<Response> {
  return routes.POST!(request);
}
