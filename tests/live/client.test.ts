import { afterAll, beforeAll } from 'vitest';
import { startFakeRelay, type FakeRelay } from './fake-relay';
import { liveSuite } from './suite';

let relay: FakeRelay;
beforeAll(async () => {
  relay = await startFakeRelay();
});
afterAll(async () => {
  await relay.close();
});

liveSuite('live client against the local relay', () => relay.url);
