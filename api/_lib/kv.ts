/**
 * The store of small records (PLAN "Хранилище"): codes, the world, public copies of
 * work, counters and the file clean-up queue. One interface, three drivers:
 *
 *   redis      Upstash Redis over its REST API (fetch, JSON bodies, `pipeline` for two or
 *              more commands, 4 s per request). The counters are shared by every
 *              instance of a function, so spending limits hold.
 *   blob-json  Records as JSON files in Vercel Blob (./blob-json.ts), the queue as one
 *              file. Counters do NOT go to Blob at all: every increment would cost a read
 *              and a write and a few hundred model calls would use the monthly write
 *              allowance. They live in the memory of the instance, so they are not shared
 *              (`sharedCounters: false`) and live model calls of visitors are off.
 *   memory     The dev server and tests. Exact within one process; on Vercel an
 *              instance is not the whole deployment, so there it is not shared either.
 *
 * Driver: STORAGE_DRIVER, otherwise `redis` when its variables are set, otherwise
 * `blob-json` when BLOB_READ_WRITE_TOKEN is set, otherwise the `storage-off` error. A
 * driver named but not configured is `storage-off` too: partial configuration fails
 * clearly instead of quietly writing somewhere else.
 *
 * `getKv()` wraps the driver with the switch STORAGE_READONLY=1 (writes refused with
 * `storage-readonly`; deletions and the clean-up queue keep working, so private files
 * still leave storage) and with the monthly command allowance of Redis (./budget.ts).
 */
import * as blobSdk from '@vercel/blob';
import { createBlobJson, type BlobJson, type BlobSdk } from './blob-json';
import { createBudget, type Budget } from './budget';
import { flag, onVercel, text, type Env } from './env';

// ------------------------------------------------------------------ interface

export type SetOptions = {
  /** Seconds until the record disappears by itself. */
  ex?: number;
  /** Write only when nothing is stored under the key. */
  nx?: boolean;
  /**
   * Write only when the stored record is an object whose `rev` equals this number
   * (`PUT /api/worlds/:name` with `if-match`). A missing record does not match.
   */
  ifRev?: number;
};

export type KvDriver = 'redis' | 'blob-json' | 'memory';

export type KV = {
  readonly driver: KvDriver;
  /** Whether counters are shared by every instance of the deployment (spending limits need it). */
  readonly sharedCounters: boolean;
  /** The stored value, or null. Counters read as numbers. */
  get<T = unknown>(key: string): Promise<T | null>;
  /** True when written; false when `nx` or `ifRev` did not allow it. */
  set(key: string, value: unknown, options?: SetOptions): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Integer increment (negative allowed); `ex` is applied only when the key has no expiry yet. */
  incr(key: string, by: number, options?: { ex?: number }): Promise<number>;
  /** Adds a member to a sorted set, or moves it to a new score. */
  zadd(key: string, score: number, member: string): Promise<void>;
  /** Takes and removes up to `max` members whose score is not above `now`, lowest first. */
  zdue(key: string, now: number, max: number): Promise<string[]>;
};

export type KvErrorReason =
  | 'storage-off'
  | 'storage-busy'
  | 'storage-readonly'
  | 'too-big'
  | 'unavailable'
  | 'bad-key'
  | 'bad-value';

export class KvError extends Error {
  constructor(
    public reason: KvErrorReason,
    detail = '',
  ) {
    super(`kv: ${reason}${detail ? ` (${detail})` : ''}`);
    this.name = 'KvError';
  }
}

/** A record value is at most 900 KB of JSON (PLAN "Хранилище"). */
export const MAX_VALUE_BYTES = 900 * 1024;
const KEY_SHAPE = /^[\x21-\x7e]{1,200}$/;

function assertKey(key: string): void {
  if (!KEY_SHAPE.test(key)) throw new KvError('bad-key', key.slice(0, 40));
}

function encodeValue(value: unknown): string {
  if (value === undefined) throw new KvError('bad-value', 'undefined');
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_VALUE_BYTES) throw new KvError('too-big');
  return json;
}

function assertSeconds(ex: number | undefined): void {
  if (ex !== undefined && (!Number.isInteger(ex) || ex < 1)) throw new KvError('bad-value', `ex ${ex}`);
}

function assertInteger(by: number): void {
  if (!Number.isSafeInteger(by)) throw new KvError('bad-value', `by ${by}`);
}

const revOf = (value: unknown): unknown =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as { rev?: unknown }).rev : undefined;

// ------------------------------------------------------------------ memory

type MemoryEntry = { json: string; exp: number | null };

/** Records in a Map. `now` is injectable so tests can move time past an expiry. */
export function createMemoryKv(options: { now?: () => number; shared?: boolean } = {}): KV {
  const now = options.now ?? Date.now;
  const records = new Map<string, MemoryEntry>();
  const sets = new Map<string, Map<string, number>>();

  const live = (key: string): MemoryEntry | null => {
    const entry = records.get(key);
    if (!entry) return null;
    if (entry.exp !== null && entry.exp <= now()) {
      records.delete(key);
      return null;
    }
    return entry;
  };

  return {
    driver: 'memory',
    sharedCounters: options.shared ?? true,
    async get<T>(key: string) {
      assertKey(key);
      const entry = live(key);
      return entry ? (JSON.parse(entry.json) as T) : null;
    },
    async set(key, value, opts = {}) {
      assertKey(key);
      assertSeconds(opts.ex);
      const json = encodeValue(value);
      const current = live(key);
      if (opts.nx && current) return false;
      if (opts.ifRev !== undefined && (!current || revOf(JSON.parse(current.json)) !== opts.ifRev)) return false;
      records.set(key, { json, exp: opts.ex ? now() + opts.ex * 1000 : null });
      return true;
    },
    async del(key) {
      assertKey(key);
      records.delete(key);
      sets.delete(key);
    },
    async incr(key, by, opts = {}) {
      assertKey(key);
      assertInteger(by);
      assertSeconds(opts.ex);
      const current = live(key);
      const before = current ? Number(JSON.parse(current.json)) : 0;
      if (!Number.isSafeInteger(before)) throw new KvError('bad-value', 'not an integer');
      const value = before + by;
      const exp = current?.exp ?? (opts.ex ? now() + opts.ex * 1000 : null);
      records.set(key, { json: String(value), exp });
      return value;
    },
    async zadd(key, score, member) {
      assertKey(key);
      if (!Number.isFinite(score)) throw new KvError('bad-value', 'score');
      let set = sets.get(key);
      if (!set) sets.set(key, (set = new Map()));
      set.set(member, score);
    },
    async zdue(key, at, max) {
      assertKey(key);
      const set = sets.get(key);
      if (!set || max < 1) return [];
      const due = [...set.entries()]
        .filter(([, score]) => score <= at)
        .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, max)
        .map(([member]) => member);
      for (const member of due) set.delete(member);
      return due;
    },
  };
}

// ------------------------------------------------------------------ redis (Upstash REST)

export type RedisOptions = {
  url: string;
  token: string;
  fetch?: typeof fetch;
  /** Every request is bounded; Upstash usually answers in tens of milliseconds. */
  timeoutMs?: number;
  /** Called with the number of commands of every request (for the monthly allowance). */
  onCommands?: (count: number) => void;
};

type RedisArg = string | number;
type RedisReply = { result?: unknown; error?: string };

/**
 * `zdue` and `ifRev` are Lua scripts: removing found members depends on the result of
 * finding them, and comparing `rev` must happen in the same step as the write, or two
 * instances could take the same file or lose an edit.
 */
const ZDUE_SCRIPT = [
  "local m = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, tonumber(ARGV[2]))",
  "if #m > 0 then redis.call('ZREM', KEYS[1], unpack(m)) end",
  'return m',
].join('\n');

const IF_REV_SCRIPT = [
  "local cur = redis.call('GET', KEYS[1])",
  'if not cur then return 0 end',
  'local ok, obj = pcall(cjson.decode, cur)',
  "if not ok or type(obj) ~= 'table' or obj['rev'] ~= tonumber(ARGV[2]) then return 0 end",
  "if ARGV[3] ~= '' then redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3]) else redis.call('SET', KEYS[1], ARGV[1]) end",
  'return 1',
].join('\n');

export function createRedisKv(options: RedisOptions): KV {
  const base = options.url.replace(/\/+$/, '');
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 4000;

  async function send(path: string, body: RedisArg[] | RedisArg[][], count: number): Promise<unknown> {
    options.onCommands?.(count);
    let response: Response;
    try {
      response = await doFetch(base + path, {
        method: 'POST',
        headers: { authorization: `Bearer ${options.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new KvError('unavailable', err instanceof Error ? err.name : 'network');
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const message = typeof (parsed as RedisReply | null)?.error === 'string' ? (parsed as RedisReply).error! : '';
    if (/limit exceeded|max requests|max daily|max monthly/i.test(message)) throw new KvError('storage-busy', 'upstash limit');
    if (!response.ok) throw new KvError('unavailable', `http ${response.status}`);
    return parsed;
  }

  async function command(...args: RedisArg[]): Promise<unknown> {
    const reply = (await send('', args.map(String), 1)) as RedisReply | null;
    if (!reply || typeof reply !== 'object' || 'error' in reply) throw new KvError('unavailable', reply?.error ?? 'no reply');
    return reply.result;
  }

  async function pipeline(commands: RedisArg[][]): Promise<unknown[]> {
    const replies = await send(
      '/pipeline',
      commands.map((c) => c.map(String)),
      commands.length,
    );
    if (!Array.isArray(replies) || replies.length !== commands.length) throw new KvError('unavailable', 'pipeline');
    return replies.map((reply: RedisReply) => {
      if (!reply || typeof reply !== 'object' || reply.error !== undefined) throw new KvError('unavailable', reply?.error ?? 'pipeline');
      return reply.result;
    });
  }

  return {
    driver: 'redis',
    sharedCounters: true,
    async get<T>(key: string) {
      assertKey(key);
      const result = await command('GET', key);
      if (result === null || result === undefined) return null;
      try {
        return JSON.parse(String(result)) as T;
      } catch {
        throw new KvError('bad-value', 'stored value is not JSON');
      }
    },
    async set(key, value, opts = {}) {
      assertKey(key);
      assertSeconds(opts.ex);
      const json = encodeValue(value);
      if (opts.ifRev !== undefined) {
        if (!Number.isFinite(opts.ifRev)) throw new KvError('bad-value', 'ifRev');
        const result = await command('EVAL', IF_REV_SCRIPT, 1, key, json, opts.ifRev, opts.ex ?? '');
        return Number(result) === 1;
      }
      const args: RedisArg[] = ['SET', key, json];
      if (opts.ex) args.push('EX', opts.ex);
      if (opts.nx) args.push('NX');
      return (await command(...args)) === 'OK';
    },
    async del(key) {
      assertKey(key);
      await command('DEL', key);
    },
    async incr(key, by, opts = {}) {
      assertKey(key);
      assertInteger(by);
      assertSeconds(opts.ex);
      if (!opts.ex) return Number(await command('INCRBY', key, by));
      const [value] = await pipeline([
        ['INCRBY', key, by],
        ['EXPIRE', key, opts.ex, 'NX'],
      ]);
      return Number(value);
    },
    async zadd(key, score, member) {
      assertKey(key);
      if (!Number.isFinite(score)) throw new KvError('bad-value', 'score');
      await command('ZADD', key, score, member);
    },
    async zdue(key, at, max) {
      assertKey(key);
      if (max < 1) return [];
      const result = await command('EVAL', ZDUE_SCRIPT, 1, key, at, Math.floor(max));
      return Array.isArray(result) ? result.map(String) : [];
    },
  };
}

// ------------------------------------------------------------------ blob-json

/**
 * Keys under these prefixes are counters (llm spending, operation allowances, tries).
 * On blob-json they live in memory only; see the head of this file.
 */
export const COUNTER_PREFIXES = ['llm:', 'ops:', 'tries:'] as const;
const isCounter = (key: string): boolean => COUNTER_PREFIXES.some((prefix) => key.startsWith(prefix));

type Envelope = { v: unknown; exp: number | null };

/**
 * A key as a Blob pathname: `code:X4KM7` -> `kv/code/_58_4b_4d7.json`. Segments split at
 * ':'; anything but lowercase letters, digits and '-' becomes `_` and two hex digits, so
 * different keys never share a file and upper case survives a lowercase-only store.
 */
export function keyPath(key: string): string {
  assertKey(key);
  const segments = key.split(':').map((segment) => {
    if (segment === '') return '_';
    let out = '';
    for (const ch of segment) {
      out += /[a-z0-9-]/.test(ch) ? ch : `_${ch.charCodeAt(0).toString(16).padStart(2, '0')}`;
    }
    return out;
  });
  const path = `kv/${segments.join('/')}.json`;
  if (path.length > 200) throw new KvError('bad-key', 'too long');
  return path;
}

export type BlobJsonKvOptions = {
  store: BlobJson;
  now?: () => number;
  /** Called before each Blob operation, so the monthly allowance can refuse it. */
  beforeOp?: (kind: 'read' | 'write') => Promise<void>;
  /** Where counters live; memory of the instance by default. */
  counters?: KV;
};

/**
 * Not atomic across instances where Blob gives no help: `ifRev` reads then writes, and
 * the queue file is read, changed and written. `nx` is atomic (Blob refuses to replace
 * an existing pathname). An expired record is treated as absent and replaced.
 */
export function createBlobJsonKv(options: BlobJsonKvOptions): KV {
  const { store } = options;
  const now = options.now ?? Date.now;
  const counters = options.counters ?? createMemoryKv({ now, shared: false });
  const before = options.beforeOp ?? (async () => undefined);

  const read = async (key: string): Promise<Envelope | null> => {
    await before('read');
    const found = await store.read<Envelope>(keyPath(key));
    if (!found || typeof found !== 'object' || !('v' in found)) return null;
    if (found.exp !== null && typeof found.exp === 'number' && found.exp <= now()) return null;
    return found;
  };
  const write = async (key: string, value: unknown, ex?: number): Promise<void> => {
    await before('write');
    await store.write(keyPath(key), { v: value, exp: ex ? now() + ex * 1000 : null } satisfies Envelope);
  };

  return {
    driver: 'blob-json',
    sharedCounters: false,
    async get<T>(key: string) {
      if (isCounter(key)) return counters.get<T>(key);
      const found = await read(key);
      return found ? (found.v as T) : null;
    },
    async set(key, value, opts = {}) {
      if (isCounter(key)) return counters.set(key, value, opts);
      assertSeconds(opts.ex);
      encodeValue(value);
      if (opts.ifRev !== undefined) {
        const current = await read(key);
        if (!current || revOf(current.v) !== opts.ifRev) return false;
        await write(key, value, opts.ex);
        return true;
      }
      if (opts.nx) {
        await before('write');
        const created = await store.create(keyPath(key), { v: value, exp: opts.ex ? now() + opts.ex * 1000 : null });
        if (created) return true;
        if (await read(key)) return false;
        await write(key, value, opts.ex);
        return true;
      }
      await write(key, value, opts.ex);
      return true;
    },
    async del(key) {
      if (isCounter(key)) return counters.del(key);
      await store.remove(keyPath(key));
    },
    async incr(key, by, opts) {
      return counters.incr(key, by, opts);
    },
    async zadd(key, score, member) {
      if (!Number.isFinite(score)) throw new KvError('bad-value', 'score');
      const queue = ((await read(key))?.v ?? {}) as Record<string, number>;
      queue[member] = score;
      await write(key, queue);
    },
    async zdue(key, at, max) {
      if (max < 1) return [];
      const found = await read(key);
      const queue = (found?.v ?? {}) as Record<string, number>;
      const due = Object.entries(queue)
        .filter(([, score]) => score <= at)
        .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
        .slice(0, max)
        .map(([member]) => member);
      if (due.length === 0) return [];
      for (const member of due) delete queue[member];
      await write(key, queue);
      return due;
    },
  };
}

// ------------------------------------------------------------------ selection and wrapping

export type DriverChoice =
  | { driver: 'redis'; url: string; token: string }
  | { driver: 'blob-json'; token: string }
  | { driver: 'memory' }
  | { driver: null; problem: string };

export function chooseDriver(env: Env): DriverChoice {
  const url = text(env, 'KV_REST_API_URL') || text(env, 'UPSTASH_REDIS_REST_URL');
  const token = text(env, 'KV_REST_API_TOKEN') || text(env, 'UPSTASH_REDIS_REST_TOKEN');
  const blobToken = text(env, 'BLOB_READ_WRITE_TOKEN');
  const named = text(env, 'STORAGE_DRIVER').toLowerCase();
  const redis = (): DriverChoice =>
    url && token ? { driver: 'redis', url, token } : { driver: null, problem: 'redis variables are not set' };
  const blob = (): DriverChoice =>
    blobToken ? { driver: 'blob-json', token: blobToken } : { driver: null, problem: 'BLOB_READ_WRITE_TOKEN is not set' };
  if (named === 'redis') return redis();
  if (named === 'blob-json') return blob();
  if (named === 'memory') return { driver: 'memory' };
  if (named !== '') return { driver: null, problem: `unknown STORAGE_DRIVER ${named}` };
  if (url && token) return redis();
  if (blobToken) return blob();
  return { driver: null, problem: 'no storage is configured' };
}

/**
 * The switch STORAGE_READONLY and the allowance check around a driver. `check` runs
 * before every operation and throws `storage-busy` when the monthly allowance is spent.
 * Deletion and taking from the clean-up queue stay allowed under the switch: they are
 * how private files leave storage.
 */
export function guardKv(inner: KV, options: { readonly: () => boolean; check?: () => Promise<void> }): KV {
  const check = options.check ?? (async () => undefined);
  const writable = async (): Promise<void> => {
    if (options.readonly()) throw new KvError('storage-readonly');
    await check();
  };
  return {
    driver: inner.driver,
    sharedCounters: inner.sharedCounters,
    async get(key) {
      await check();
      return inner.get(key);
    },
    async set(key, value, opts) {
      await writable();
      return inner.set(key, value, opts);
    },
    async del(key) {
      await check();
      return inner.del(key);
    },
    async incr(key, by, opts) {
      await writable();
      return inner.incr(key, by, opts);
    },
    async zadd(key, score, member) {
      await writable();
      return inner.zadd(key, score, member);
    },
    async zdue(key, at, max) {
      await check();
      return inner.zdue(key, at, max);
    },
  };
}

/**
 * Everything one process uses for storage:
 *   kv        the store routes use (readonly switch and allowance applied)
 *   counters  where the allowance and spending counters are kept (Redis itself, or memory
 *             of the instance on blob-json and memory)
 *   budget    the monthly allowances (./budget.ts)
 */
export type Storage = {
  kv: KV;
  counters: KV;
  budget: Budget;
  driver: KvDriver;
  readonly: boolean;
};

/** One memory store per process, so records survive a rebuilt wrapper on the dev server. */
let memoryStore: KV | null = null;
let cached: { signature: string; storage: Storage } | null = null;

/** Forgets the built store and the memory records (tests). */
export function resetKv(): void {
  cached = null;
  memoryStore = null;
}

/** Builds storage for a driver choice. `fetch` and `blob` are injectable for tests. */
export function buildStorage(
  choice: Exclude<DriverChoice, { driver: null }>,
  env: Env,
  deps: { fetch?: typeof fetch; blob?: BlobJson; now?: () => number } = {},
): Storage {
  const now = deps.now ?? Date.now;
  const readonly = flag(env, 'STORAGE_READONLY');
  let budget: Budget | null = null;
  let raw: KV;
  let counters: KV;
  if (choice.driver === 'redis') {
    raw = createRedisKv({ url: choice.url, token: choice.token, fetch: deps.fetch, onCommands: (n) => budget?.commands(n) });
    counters = raw;
  } else if (choice.driver === 'memory') {
    memoryStore ??= createMemoryKv({ now, shared: !onVercel(env) });
    raw = memoryStore;
    counters = raw;
  } else {
    counters = createMemoryKv({ now, shared: false });
    raw = createBlobJsonKv({
      store: deps.blob ?? createBlobJson(blobSdk as unknown as BlobSdk, choice.token),
      now,
      counters,
      beforeOp: (kind) => budget!.blob(kind, 'record'),
    });
  }
  budget = createBudget({ counters, env, now, countsCommands: choice.driver === 'redis' });
  const kv = guardKv(raw, { readonly: () => readonly, check: () => budget!.checkCommands() });
  return { kv, counters, budget, driver: choice.driver, readonly };
}

/**
 * The storage of this process for the current environment. Throws
 * KvError('storage-off') when nothing usable is configured.
 */
export function getStorage(env: Env = process.env): Storage {
  const choice = chooseDriver(env);
  if (choice.driver === null) throw new KvError('storage-off', choice.problem);
  const signature = JSON.stringify([
    choice,
    text(env, 'STORAGE_READONLY'),
    text(env, 'KV_MONTHLY_COMMANDS'),
    text(env, 'BLOB_MONTHLY_WRITES'),
    text(env, 'BLOB_MONTHLY_READS'),
    text(env, 'UPLOAD_DAILY_BYTES'),
  ]);
  if (cached?.signature === signature) return cached.storage;
  const storage = buildStorage(choice, env);
  cached = { signature, storage };
  return storage;
}

export function getKv(env: Env = process.env): KV {
  return getStorage(env).kv;
}
