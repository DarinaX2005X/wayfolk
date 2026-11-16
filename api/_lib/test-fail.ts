/**
 * The header `x-test-fail` (PLAN "API"): a request may ask a route to fail in a given way,
 * so scenarios see what the product does when the server misbehaves. Honoured only where
 * API_TEST_FAIL=1 is set, which the dev server (tools/dev-api/plugin.ts) does; on a
 * deployment the header means nothing. `offline` and `slow` are made by the dev server
 * itself; the rest by the routes.
 */
import type { TestFail } from './contracts';
import { flag, type Env } from './env';

const MODES: readonly TestFail[] = ['offline', '429', 'slow', '503', '401', '404', 'bad-output', 'daily-cap', 'storage-busy'];

export function testFailure(request: Request, env: Env = process.env): TestFail | null {
  if (!flag(env, 'API_TEST_FAIL')) return null;
  const wanted = request.headers.get('x-test-fail')?.trim() ?? '';
  return (MODES as readonly string[]).includes(wanted) ? (wanted as TestFail) : null;
}
