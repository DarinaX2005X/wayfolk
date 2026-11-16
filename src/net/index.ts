/**
 * The wired clients of this page: `net` (raw /api/* requests), `llm` (the network
 * LlmClient) and `api` (typed code and world routes), over the page's fetch and origin.
 * See ./client.ts, ./llm.ts and ./api.ts for the rules.
 *
 * Scenario hooks (only where debug hooks are on, see src/app/debug.ts):
 *   window.__gw.net.fail('offline' | '429' | ... | null)   every following request
 *   window.__gw.test.failNext(code)                         the next model call
 *   window.__gw.test.failAt(n, code)                        the n-th model call of a run
 *   window.__gw.test.forceLive('fixtures' | null)           run the live path on recorded answers
 *
 * `startLlmStatus()` keeps `store.llm` current (at once and every five minutes); the app
 * calls it once at boot.
 */
import { registerDebug, registerTest } from '../app/debug';
import { load } from '../app/prefs';
import { KEYS, store } from '../app/store';
import type { TestFail } from '../../api/_lib/contracts';
import { createApi } from './api';
import { createNet } from './client';
import { createNetLlm, watchStatus, type FixtureScope } from './llm';

export { NetError } from './client';
export type { NetErrorKind, RequestOptions } from './client';
export { LlmError } from './llm';
export type { LlmErrorCode, LlmNeed } from './llm';
export { FALLBACK_ICE } from './api';
export type { ApiFailure, ApiFailureCode, ApiResult } from './api';

const pageFetch = (input: string, init?: RequestInit): Promise<Response> => fetch(input, init);

export const net = createNet({ fetch: pageFetch });
export const llm = createNetLlm({ fetch: pageFetch, net });
export const api = createApi({
  net,
  ownerKey: () => {
    const key = load<string | null>(KEYS.ownerKey, null);
    return typeof key === 'string' && key !== '' ? key : null;
  },
});

let stopStatus: (() => void) | null = null;

/** Starts keeping `store.llm` current; calling it again does nothing. */
export function startLlmStatus(): () => void {
  stopStatus ??= watchStatus(llm, (status) => {
    store.llm.value = status;
  });
  return stopStatus;
}

/** A fresh look at the status now (after a test switch or a refusal that changes it). */
export async function refreshLlmStatus(): Promise<void> {
  llm.forgetStatus();
  store.llm.value = await llm.status();
}

registerDebug('net', { fail: net.setTestFailure });
registerTest('failNext', (code: TestFail) => llm.failNext(code));
registerTest('failAt', (n: number, code: TestFail) => llm.failAt(n, code));
registerTest('forceLive', (mode: 'fixtures' | null, where?: FixtureScope) => {
  llm.forceLive(mode, where);
  return refreshLlmStatus();
});
