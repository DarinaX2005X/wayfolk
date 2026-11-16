/**
 * Storage failures as answers of PLAN "API": every route that touches storage answers
 * them the same way.
 *
 *   storage-off        503  nothing is configured
 *   storage-busy       503  a monthly allowance is spent, or the store did not answer
 *   storage-readonly   503  the switch STORAGE_READONLY=1 is on
 *   too-big            413  a record over 900 KB
 */
import { FilesError } from './files';
import { describeError, fail } from './http';
import { KvError } from './kv';

/** The answer for a storage failure, or null when `err` is something else. */
export function storageFailure(err: unknown): Response | null {
  if (err instanceof KvError) {
    switch (err.reason) {
      case 'storage-off':
        return fail(503, 'storage-off');
      case 'storage-readonly':
        return fail(503, 'storage-readonly');
      case 'too-big':
        return fail(413, 'too-big');
      case 'bad-key':
      case 'bad-value':
        return fail(400, 'bad-request');
      default:
        console.warn(JSON.stringify({ at: 'storage', problem: describeError(err) }));
        return fail(503, 'storage-busy');
    }
  }
  if (err instanceof FilesError) {
    if (err.reason === 'storage-off') return fail(503, 'storage-off');
    return fail(400, 'bad-request');
  }
  return null;
}
