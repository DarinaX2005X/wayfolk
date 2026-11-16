/**
 * The wired API client: `net.request(path, options)` over the page fetch and origin.
 * See ./client.ts for the rules. Scenarios switch server failures on and off through
 * `window.__gw.net.fail('offline' | '429' | ... | null)`.
 */
import { registerDebug } from '../app/debug';
import { createNet } from './client';

export { NetError } from './client';
export type { NetErrorKind, RequestOptions } from './client';

export const net = createNet({ fetch: (input, init) => fetch(input, init) });

registerDebug('net', { fail: net.setTestFailure });
