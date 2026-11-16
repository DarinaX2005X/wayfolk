/**
 * The store of small records (api/_lib/kv.ts): one suite of the `KV` interface run on
 * all three drivers (Redis against a stand-in with the reply forms of Upstash REST,
 * blob-json against a stand-in Blob), then the driver choice, the readonly switch, the
 * monthly allowances (api/_lib/budget.ts) and the file clean-up queue (api/_lib/gc.ts).
 * A stand-in shows the adapters handle the service's answers; whether the real Upstash
 * answers that way is checked after MAIN connects it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createBudget } from '../../api/_lib/budget';
import { sweep, scheduleFiles, GC_KEY } from '../../api/_lib/gc';
import {
  KvError,
  MAX_VALUE_BYTES,
  buildStorage,
  chooseDriver,
  createBlobJsonKv,
  createMemoryKv,
  createRedisKv,
  getStorage,
  guardKv,
  keyPath,
  resetKv,
  type KV,
} from '../../api/_lib/kv';
import type { Files } from '../../api/_lib/files';
import { storageFailure } from '../../api/_lib/storage-errors';
import { clock, fakeBlobJson, fakeUpstash, type Clock } from './helpers';

type Made = { kv: KV; time: Clock };

const drivers: Record<string, () => Made> = {
  memory: () => {
    const time = clock();
    return { kv: createMemoryKv({ now: time.now }), time };
  },
  redis: () => {
    const time = clock();
    const upstash = fakeUpstash(time);
    return { kv: createRedisKv({ url: 'https://eu1-fake.upstash.io', token: 'upstash-test-token', fetch: upstash.fetch }), time };
  },
  'blob-json': () => {
    const time = clock();
    return { kv: createBlobJsonKv({ store: fakeBlobJson(), now: time.now }), time };
  },
};

for (const [name, make] of Object.entries(drivers)) {
  describe(`KV on ${name}`, () => {
    it('stores, reads and deletes JSON records', async () => {
      const { kv } = make();
      expect(await kv.get('code:X4KM7')).toBeNull();
      expect(await kv.set('code:X4KM7', { code: 'X4KM7', files: [], closed: false })).toBe(true);
      expect(await kv.get('code:X4KM7')).toEqual({ code: 'X4KM7', files: [], closed: false });
      await kv.del('code:X4KM7');
      expect(await kv.get('code:X4KM7')).toBeNull();
      await kv.del('code:X4KM7');
    });

    it('lets a record expire', async () => {
      const { kv, time } = make();
      await kv.set('code:D2345', { closed: false }, { ex: 60 });
      time.advance(59_000);
      expect(await kv.get('code:D2345')).not.toBeNull();
      time.advance(2_000);
      expect(await kv.get('code:D2345')).toBeNull();
    });

    it('writes with nx only once, and again after expiry', async () => {
      const { kv, time } = make();
      expect(await kv.set('world:quiet-meadow-27', { rev: 1 }, { nx: true, ex: 10 })).toBe(true);
      expect(await kv.set('world:quiet-meadow-27', { rev: 9 }, { nx: true })).toBe(false);
      expect(await kv.get('world:quiet-meadow-27')).toEqual({ rev: 1 });
      time.advance(11_000);
      expect(await kv.set('world:quiet-meadow-27', { rev: 2 }, { nx: true })).toBe(true);
    });

    it('writes with ifRev only over the expected rev, so a stale edit is refused', async () => {
      const { kv } = make();
      expect(await kv.set('world:w', { rev: 1, title: 'a' }, { ifRev: 1 })).toBe(false);
      await kv.set('world:w', { rev: 1, title: 'a' });
      expect(await kv.set('world:w', { rev: 2, title: 'b' }, { ifRev: 1 })).toBe(true);
      // A second tab still holding rev 1 loses, and the first edit stays.
      expect(await kv.set('world:w', { rev: 2, title: 'stale' }, { ifRev: 1 })).toBe(false);
      expect(await kv.get('world:w')).toEqual({ rev: 2, title: 'b' });
    });

    it('counts with incr, sets the expiry once and lets the counter expire', async () => {
      const { kv, time } = make();
      expect(await kv.incr('llm:2026-11-16:usd', 1500, { ex: 100 })).toBe(1500);
      time.advance(60_000);
      expect(await kv.incr('llm:2026-11-16:usd', 500, { ex: 100 })).toBe(2000);
      expect(await kv.get('llm:2026-11-16:usd')).toBe(2000);
      expect(await kv.incr('llm:2026-11-16:usd', -2000)).toBe(0);
      // The expiry was not pushed back by the second increment.
      time.advance(41_000);
      expect(await kv.get('llm:2026-11-16:usd')).toBeNull();
    });

    it('takes due members of a queue lowest first, at most max, and removes them', async () => {
      const { kv } = make();
      await kv.zadd(GC_KEY, 300, 'up/F1/3-c.pdf');
      await kv.zadd(GC_KEY, 100, 'up/F1/1-a.pdf');
      await kv.zadd(GC_KEY, 200, 'up/F1/2-b.pdf');
      await kv.zadd(GC_KEY, 900, 'x/X1-later.bundle.json');
      expect(await kv.zdue(GC_KEY, 250, 1)).toEqual(['up/F1/1-a.pdf']);
      expect(await kv.zdue(GC_KEY, 250, 5)).toEqual(['up/F1/2-b.pdf']);
      expect(await kv.zdue(GC_KEY, 250, 5)).toEqual([]);
      expect(await kv.zdue(GC_KEY, 1000, 5)).toEqual(['up/F1/3-c.pdf', 'x/X1-later.bundle.json']);
    });

    it('refuses a record over 900 KB', async () => {
      const { kv } = make();
      const big = 'x'.repeat(MAX_VALUE_BYTES);
      await expect(kv.set('pub:w:s', { big })).rejects.toMatchObject({ reason: 'too-big' });
    });
  });
}

describe('the Redis driver', () => {
  it('sends one command per request and incr with expiry as one pipeline of INCRBY and EXPIRE NX', async () => {
    const time = clock();
    const upstash = fakeUpstash(time);
    let counted = 0;
    const kv = createRedisKv({ url: 'https://x.upstash.io/', token: 'upstash-test-token', fetch: upstash.fetch, onCommands: (n) => (counted += n) });
    await kv.incr('llm:run:r1:calls', 1, { ex: 60 });
    expect(upstash.calls.at(-1)).toEqual({ path: '/pipeline', commands: [['INCRBY', 'llm:run:r1:calls', '1'], ['EXPIRE', 'llm:run:r1:calls', '60', 'NX']] });
    await kv.set('code:X1', { a: 1 }, { ex: 30, nx: true });
    expect(upstash.calls.at(-1)?.commands[0]).toEqual(['SET', 'code:X1', '{"a":1}', 'EX', '30', 'NX']);
    expect(counted).toBe(3);
  });

  it('turns a dead service, a wrong token and the plan limit into storage errors', async () => {
    const time = clock();
    const upstash = fakeUpstash(time);
    const wrong = createRedisKv({ url: 'https://x.upstash.io', token: 'nope', fetch: upstash.fetch });
    await expect(wrong.get('a')).rejects.toMatchObject({ reason: 'unavailable' });
    const dead = createRedisKv({ url: 'https://x.upstash.io', token: 't', fetch: async () => Promise.reject(new TypeError('fetch failed')) });
    await expect(dead.get('a')).rejects.toMatchObject({ reason: 'unavailable' });
    const kv = createRedisKv({ url: 'https://x.upstash.io', token: 'upstash-test-token', fetch: upstash.fetch });
    upstash.failWith(400, { error: 'ERR max requests limit exceeded. Limit: 500000, Usage: 500000' });
    await expect(kv.get('a')).rejects.toMatchObject({ reason: 'storage-busy' });
  });

  it('gives up on a request after its timeout', async () => {
    const kv = createRedisKv({
      url: 'https://x.upstash.io',
      token: 't',
      timeoutMs: 30,
      fetch: (_url, init) => new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('t', 'TimeoutError')))),
    });
    await expect(kv.get('a')).rejects.toMatchObject({ reason: 'unavailable' });
  });
});

describe('the blob-json driver', () => {
  it('keeps counters in memory and never writes them to Blob', async () => {
    const store = fakeBlobJson();
    const kv = createBlobJsonKv({ store });
    for (let i = 0; i < 30; i += 1) await kv.incr('ops:2026-11:blob:w', 1, { ex: 3600 });
    expect(await kv.get('ops:2026-11:blob:w')).toBe(30);
    expect(store.ops).toEqual({ read: 0, write: 0 });
    expect(kv.sharedCounters).toBe(false);
  });

  it('maps keys to distinct lowercase paths', () => {
    expect(keyPath('code:X4KM7')).toBe('kv/code/_584_4b_4d7.json');
    expect(keyPath('code:x4km7')).not.toBe(keyPath('code:X4KM7'));
    expect(keyPath('pub:quiet-meadow-27:harbor-street')).toBe('kv/pub/quiet-meadow-27/harbor-street.json');
  });
});

describe('driver choice', () => {
  it('takes redis when its variables are set (either pair), then blob-json, else storage-off', () => {
    expect(chooseDriver({ KV_REST_API_URL: 'https://a', KV_REST_API_TOKEN: 't', BLOB_READ_WRITE_TOKEN: 'b' })).toMatchObject({ driver: 'redis' });
    expect(chooseDriver({ UPSTASH_REDIS_REST_URL: 'https://a', UPSTASH_REDIS_REST_TOKEN: 't' })).toMatchObject({ driver: 'redis' });
    expect(chooseDriver({ BLOB_READ_WRITE_TOKEN: 'b' })).toMatchObject({ driver: 'blob-json' });
    expect(chooseDriver({})).toMatchObject({ driver: null });
    expect(chooseDriver({ STORAGE_DRIVER: 'memory' })).toMatchObject({ driver: 'memory' });
    // Named but not configured fails clearly instead of falling back to another store.
    expect(chooseDriver({ STORAGE_DRIVER: 'redis', BLOB_READ_WRITE_TOKEN: 'b' })).toMatchObject({ driver: null });
  });

  afterEach(() => resetKv());

  it('throws storage-off, which routes answer as 503', () => {
    let error: unknown;
    try {
      getStorage({});
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(KvError);
    expect(storageFailure(error)?.status).toBe(503);
  });

  it('memory counters are shared on this host but not on a Vercel instance', () => {
    expect(getStorage({ STORAGE_DRIVER: 'memory' }).kv.sharedCounters).toBe(true);
    resetKv();
    expect(getStorage({ STORAGE_DRIVER: 'memory', VERCEL: '1' }).kv.sharedCounters).toBe(false);
  });
});

describe('the readonly switch', () => {
  it('refuses writes with storage-readonly, keeps reads, deletion and clean-up working', async () => {
    const inner = createMemoryKv();
    await inner.set('code:X1', { a: 1 });
    await inner.zadd(GC_KEY, 1, 'up/X1/1-a.pdf');
    const kv = guardKv(inner, { readonly: () => true });
    await expect(kv.set('code:X2', {})).rejects.toMatchObject({ reason: 'storage-readonly' });
    await expect(kv.incr('llm:total', 1)).rejects.toMatchObject({ reason: 'storage-readonly' });
    await expect(kv.zadd(GC_KEY, 1, 'x')).rejects.toMatchObject({ reason: 'storage-readonly' });
    expect(await kv.get('code:X1')).toEqual({ a: 1 });
    expect(await kv.zdue(GC_KEY, 10, 5)).toEqual(['up/X1/1-a.pdf']);
    await kv.del('code:X1');
    expect(await kv.get('code:X1')).toBeNull();
    const answer = storageFailure(new KvError('storage-readonly'));
    expect(answer?.status).toBe(503);
    expect(await answer?.json()).toEqual({ error: 'storage-readonly' });
  });

  it('is read from STORAGE_READONLY=1', async () => {
    const storage = buildStorage({ driver: 'memory' }, { STORAGE_READONLY: '1' });
    await expect(storage.kv.set('code:X3', {})).rejects.toMatchObject({ reason: 'storage-readonly' });
    resetKv();
  });
});

describe('monthly allowances', () => {
  const env = { KV_MONTHLY_COMMANDS: '25', BLOB_MONTHLY_WRITES: '260', BLOB_MONTHLY_READS: '3', UPLOAD_DAILY_BYTES: '1000' };

  it('refuses Redis commands once the month is spent, counting its own flushes', async () => {
    const time = clock();
    const upstash = fakeUpstash(time);
    const storage = buildStorage({ driver: 'redis', url: 'https://x.upstash.io', token: 'upstash-test-token' }, env, { fetch: upstash.fetch, now: time.now });
    let refused: unknown = null;
    let done = 0;
    for (let i = 0; i < 40 && !refused; i += 1) {
      try {
        await storage.kv.get(`code:X${i}`);
        done += 1;
      } catch (err) {
        refused = err;
      }
    }
    expect(refused).toMatchObject({ reason: 'storage-busy' });
    // Every command sent, including the counter's own, is in the count at the refusal.
    const counted = Number(upstash.cells.get('ops:2026-11:kv')?.value ?? 0);
    expect(upstash.commandCount()).toBeLessThanOrEqual(25 + 1);
    expect(counted + 10).toBeGreaterThanOrEqual(upstash.commandCount() - 1);
    expect(done).toBeGreaterThan(15);
  });

  it('keeps 250 Blob writes for exports, refuses reads and upload bytes past their limits', async () => {
    const budget = createBudget({ counters: createMemoryKv(), env, countsCommands: false });
    for (let i = 0; i < 10; i += 1) await budget.blob('write', 'upload');
    await expect(budget.blob('write', 'upload')).rejects.toMatchObject({ reason: 'storage-busy' });
    await expect(budget.blob('write', 'export')).resolves.toBeUndefined();
    for (let i = 0; i < 3; i += 1) await budget.blob('read', 'files');
    await expect(budget.blob('read', 'files')).rejects.toMatchObject({ reason: 'storage-busy' });
    await budget.uploadBytes(900);
    await expect(budget.uploadBytes(200)).rejects.toMatchObject({ reason: 'storage-busy' });
  });

  it('counts the record files of blob-json as Blob operations', async () => {
    const blob = fakeBlobJson();
    const storage = buildStorage({ driver: 'blob-json', token: 't' }, { BLOB_MONTHLY_WRITES: '252' }, { blob });
    await storage.kv.set('code:X1', { a: 1 });
    await storage.kv.set('code:X2', { a: 1 });
    await expect(storage.kv.set('code:X3', { a: 1 })).rejects.toMatchObject({ reason: 'storage-busy' });
    expect(blob.ops.write).toBe(2);
  });
});

describe('the file clean-up queue', () => {
  function fakeFiles() {
    const deleted: string[][] = [];
    let failing = false;
    const files: Pick<Files, 'deleteFiles'> = {
      async deleteFiles(paths) {
        if (failing) throw new Error('blob down');
        deleted.push(paths);
      },
    };
    return { files: files as Files, deleted, fail: (on: boolean) => (failing = on) };
  }

  it('deletes five expired files per sweep and leaves the rest', async () => {
    const time = clock();
    const kv = createMemoryKv({ now: time.now });
    await scheduleFiles(kv, ['up/F1/1-a.pdf', 'up/F1/2-b.pdf', 'up/F1/3-c.pdf', 'up/F1/4-d.pdf'], time.now() - 10);
    await scheduleFiles(kv, ['x/X1-abc.bundle.json', 'up/F2/1-e.pdf', 'up/F2/2-f.pdf'], time.now() - 5);
    await scheduleFiles(kv, ['up/F3/1-later.pdf'], time.now() + 60_000);
    const { files, deleted } = fakeFiles();
    expect(await sweep({ kv, files, now: time.now })).toHaveLength(5);
    expect(deleted[0]).toEqual(['up/F1/1-a.pdf', 'up/F1/2-b.pdf', 'up/F1/3-c.pdf', 'up/F1/4-d.pdf', 'up/F2/1-e.pdf']);
    expect(await sweep({ kv, files, now: time.now })).toEqual(['up/F2/2-f.pdf', 'x/X1-abc.bundle.json']);
    expect(await sweep({ kv, files, now: time.now })).toEqual([]);
  });

  it('puts files back an hour later when deleting fails', async () => {
    const time = clock();
    const kv = createMemoryKv({ now: time.now });
    await scheduleFiles(kv, ['up/F1/1-a.pdf'], time.now() - 1);
    const { files, fail } = fakeFiles();
    fail(true);
    await expect(sweep({ kv, files, now: time.now })).rejects.toThrow('blob down');
    fail(false);
    expect(await sweep({ kv, files, now: time.now })).toEqual([]);
    time.advance(3600_000);
    expect(await sweep({ kv, files, now: time.now })).toEqual(['up/F1/1-a.pdf']);
  });
});
