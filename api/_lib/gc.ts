/**
 * Clean-up of files whose code has expired (PLAN "Уборка файлов"). When a code gets files
 * (uploads, the export bundle), each file path goes into the sorted set `gc:files` with
 * the expiry time as its score. Every `POST /api/code` calls `sweep()`, which takes up to
 * five expired paths and deletes their files, so documents of a private case do not stay
 * in Blob after the code is gone. No cron.
 *
 * A path is taken out of the queue before its file is deleted, so two instances never
 * delete the same file twice; when the deletion fails the paths go back with a score an
 * hour later and the next sweep tries again.
 */
import type { Files } from './files';
import type { KV } from './kv';

export const GC_KEY = 'gc:files';
const RETRY_MS = 3600_000;

/** Puts files on the queue to be deleted after `expiresAt` (ms since epoch). */
export async function scheduleFiles(kv: KV, paths: string[], expiresAt: number): Promise<void> {
  for (const path of paths) await kv.zadd(GC_KEY, expiresAt, path);
}

/** Deletes up to `max` expired files. Resolves with the paths deleted. */
export async function sweep(deps: { kv: KV; files: Files; now?: () => number }, max = 5): Promise<string[]> {
  const now = (deps.now ?? Date.now)();
  const due = await deps.kv.zdue(GC_KEY, now, max);
  if (due.length === 0) return [];
  try {
    await deps.files.deleteFiles(due);
    return due;
  } catch (err) {
    for (const path of due) await deps.kv.zadd(GC_KEY, now + RETRY_MS, path).catch(() => undefined);
    throw err;
  }
}
