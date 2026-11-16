/**
 * Monthly allowances of the free plans (PLAN "Хранилище", "Бюджеты"). Exceeding one
 * refuses the operation with KvError('storage-busy'), which routes answer as 503
 * `storage-busy`.
 *
 *   ops:<year-month>:kv       Redis commands; refused from KV_MONTHLY_COMMANDS (400 000)
 *   ops:<year-month>:blob:w   Blob writes; refused from BLOB_MONTHLY_WRITES (1 950) for
 *                             exports and from 250 less (1 700) for everything else, so
 *                             a judge can still send a result to the phone near the end
 *   ops:<year-month>:blob:r   Blob reads; refused from BLOB_MONTHLY_READS (8 000). A file
 *                             is read past the function, so a read is counted when a
 *                             function hands out its address.
 *   ops:<day>:upload-bytes    bytes of uploads per UTC day; refused from UPLOAD_DAILY_BYTES
 *
 * Redis commands are tallied in the instance and added to the shared counter in one
 * INCRBY whenever ten have gathered; that INCRBY and its EXPIRE are counted too. An
 * instance that stops loses at most nine commands of the tally.
 *
 * On blob-json and memory the counters are those of the instance (kv.ts says why).
 */
import { num, type Env } from './env';
import { KvError, getStorage, type KV } from './kv';

export type OpsStore = 'kv' | 'blob';
export type OpsKind = 'read' | 'write';
/** What an operation is for; exports keep 250 Blob writes of their own. */
export type OpsPurpose = 'export' | 'upload' | 'record' | 'llm' | 'code' | 'world' | 'files';

export type Budget = {
  /** Redis commands just sent (the driver calls this). */
  commands(count: number): void;
  /** Refuses when the month's Redis commands are spent; adds the tally when ten have gathered. */
  checkCommands(): Promise<void>;
  /** Counts `n` Blob operations, refusing when the month's allowance for the purpose is spent. */
  blob(kind: OpsKind, purpose: OpsPurpose, n?: number): Promise<void>;
  /** Counts upload bytes of today, refusing past the daily limit. */
  uploadBytes(bytes: number): Promise<void>;
};

const MONTH_TTL = 40 * 24 * 3600;
const DAY_TTL = 2 * 24 * 3600;
const FLUSH_EVERY = 10;
const EXPORT_RESERVE = 250;

export const month = (ms: number): string => new Date(ms).toISOString().slice(0, 7);
export const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function limits(env: Env) {
  const writes = num(env, 'BLOB_MONTHLY_WRITES', 1950);
  return {
    kvCommands: num(env, 'KV_MONTHLY_COMMANDS', 400_000),
    blobWritesExport: writes,
    blobWrites: Math.max(0, writes - EXPORT_RESERVE),
    blobReads: num(env, 'BLOB_MONTHLY_READS', 8000),
    uploadBytes: num(env, 'UPLOAD_DAILY_BYTES', 200 * 1024 * 1024),
  };
}

export function createBudget(options: { counters: KV; env: Env; now?: () => number; countsCommands: boolean }): Budget {
  const { counters } = options;
  const now = options.now ?? Date.now;
  const caps = limits(options.env);
  let pending = 0;
  /** Commands of our own flush that must not be tallied again. */
  let skip = 0;
  let known: number | null = null;

  const flush = async (): Promise<void> => {
    const count = pending + 2;
    pending = 0;
    skip += 2;
    known = await counters.incr(`ops:${month(now())}:kv`, count, { ex: MONTH_TTL });
  };

  return {
    commands(count) {
      if (!options.countsCommands) return;
      const own = Math.min(skip, count);
      skip -= own;
      pending += count - own;
    },
    async checkCommands() {
      if (!options.countsCommands) return;
      if (known === null) {
        // This read is a command too; the driver tallies it like any other.
        known = Number((await counters.get<number>(`ops:${month(now())}:kv`)) ?? 0);
      }
      if (pending >= FLUSH_EVERY) await flush();
      if (known + pending >= caps.kvCommands) throw new KvError('storage-busy', 'monthly commands');
    },
    async blob(kind, purpose, n = 1) {
      const key = `ops:${month(now())}:blob:${kind === 'write' ? 'w' : 'r'}`;
      const cap = kind === 'read' ? caps.blobReads : purpose === 'export' ? caps.blobWritesExport : caps.blobWrites;
      const value = await counters.incr(key, n, { ex: MONTH_TTL });
      if (value > cap) throw new KvError('storage-busy', `monthly blob ${kind}s`);
    },
    async uploadBytes(bytes) {
      const value = await counters.incr(`ops:${day(now())}:upload-bytes`, Math.ceil(bytes), { ex: DAY_TTL });
      if (value > caps.uploadBytes) throw new KvError('storage-busy', 'daily upload bytes');
    },
  };
}

/**
 * `opsBudget(store, kind, purpose)` of PLAN, on the storage of this process: Redis
 * commands are counted by the driver itself, so for `kv` this only checks the allowance;
 * for `blob` it counts `n` operations and refuses past the allowance.
 */
export async function opsBudget(store: OpsStore, kind: OpsKind, purpose: OpsPurpose, n = 1): Promise<void> {
  const { budget } = getStorage();
  if (store === 'kv') return budget.checkCommands();
  return budget.blob(kind, purpose, n);
}
