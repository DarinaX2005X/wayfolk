/**
 * The live scenario against the deployed relay on Cloudflare. It goes over the internet,
 * so it runs only on request:
 *
 *   LIVE_E2E=1 npx vitest run tests/live/e2e.test.ts
 */
import { describe, it } from 'vitest';
import { LIVE_RELAY } from '../../src/live/config';
import { liveSuite } from './suite';

if (process.env.LIVE_E2E === '1') {
  liveSuite(`live client against ${LIVE_RELAY}`, () => LIVE_RELAY, { timeout: 45_000 });
} else {
  describe('live client against the deployed relay', () => {
    it.skip('runs with LIVE_E2E=1', () => {});
  });
}
