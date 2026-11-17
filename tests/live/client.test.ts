import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LiveClient } from '../../src/live/client';
import { startFakeRelay, type FakeRelay } from './fake-relay';
import { liveSuite, memoryStorage, waitFor } from './suite';

let relay: FakeRelay;
beforeAll(async () => {
  relay = await startFakeRelay();
});
afterAll(async () => {
  await relay.close();
});

liveSuite('live client against the local relay', () => relay.url);

describe('live client when the relay goes away', () => {
  it('shows connecting, then lost while retrying, then gives up', async () => {
    const own = await startFakeRelay();
    const host = new LiveClient({ relay: own.url, storage: memoryStorage() });
    const guest = new LiveClient({ relay: own.url, storage: memoryStorage(), lostAfter: 400, giveUpAfter: 2500 });
    const states: string[] = [];
    try {
      const { code } = await host.host('outage-island');
      await guest.join(code);
      guest.on('state', (s, r) => states.push(`${s}:${r}`));
      await own.close();
      await waitFor(() => guest.reason === 'gone', 15_000, 'give up');
      expect(states[0]).toBe('connecting:dropped');
      expect(states).toContain('lost:dropped');
      expect(states.at(-1)).toBe('lost:gone');
      expect(guest.peers.size).toBe(0);
    } finally {
      host.dispose();
      guest.dispose();
    }
  }, 20_000);
});
