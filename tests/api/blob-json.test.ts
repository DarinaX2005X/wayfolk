/**
 * api/_lib/blob-json.ts against a stand-in for @vercel/blob with the behaviour read from
 * the installed SDK (2.9.0): `put` refuses an existing pathname unless allowOverwrite is
 * set, `get` gives null for a missing blob, `head` throws for one, `del` does not.
 * This shows the adapter handles those answers. Whether the real service gives them is
 * checked on a deployment with tools/dev-api/probe.mjs.
 */
import { describe, expect, it } from 'vitest';
import { BlobJsonError, assertPath, createBlobJson, type BlobSdk } from '../../api/_lib/blob-json';
import { clientAddress, describeError, fail, hashAddress, readJson, sameHash, sha256 } from '../../api/_lib/http';

const TOKEN = 'vercel_blob_rw_StoreId123_notARealSecret';

type Call = { op: 'put' | 'get' | 'head' | 'del'; pathname: string; options: Record<string, unknown> };

type FakeBlob = BlobSdk & {
  blobs: Map<string, string | Buffer>;
  calls: Call[];
  /** Per-operation failure, checked before the operation runs. */
  failOn?: (call: Call) => Error | null;
  /** What `get` serves instead of the current content: the CDN that has not caught up. */
  stale: Map<string, string>;
};

function fakeBlob(): FakeBlob {
  const blobs = new Map<string, string | Buffer>();
  const stale = new Map<string, string>();
  const calls: Call[] = [];
  const sdk: FakeBlob = {
    blobs,
    calls,
    stale,
    async put(pathname, body, options) {
      const call: Call = { op: 'put', pathname, options: { ...options } };
      calls.push(call);
      const failure = sdk.failOn?.(call);
      if (failure) throw failure;
      if (blobs.has(pathname) && !options.allowOverwrite) {
        throw new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true` if you want to overwrite it.');
      }
      blobs.set(pathname, body);
      return { url: `https://storeid123.private.blob.vercel-storage.com/${pathname}` };
    },
    async get(pathname, options) {
      const call: Call = { op: 'get', pathname, options: { ...options } };
      calls.push(call);
      const failure = sdk.failOn?.(call);
      if (failure) throw failure;
      const body = stale.get(pathname) ?? blobs.get(pathname);
      if (body === undefined) return null;
      return { statusCode: 200, stream: new Response(typeof body === 'string' ? body : new Uint8Array(body)).body };
    },
    async head(pathname, options) {
      const call: Call = { op: 'head', pathname, options: { ...options } };
      calls.push(call);
      const failure = sdk.failOn?.(call);
      if (failure) throw failure;
      if (!blobs.has(pathname)) throw new Error('Vercel Blob: The requested blob does not exist');
      return { pathname };
    },
    async del(pathname, options) {
      const call: Call = { op: 'del', pathname, options: { ...options } };
      calls.push(call);
      const failure = sdk.failOn?.(call);
      if (failure) throw failure;
      blobs.delete(pathname);
    },
  };
  return sdk;
}

const puts = (sdk: FakeBlob): Call[] => sdk.calls.filter((c) => c.op === 'put');

describe('JSON records in the blob store', () => {
  it('writes a record and reads the same value back, privately and without the CDN cache', async () => {
    const sdk = fakeBlob();
    const store = createBlobJson(sdk, TOKEN);
    expect(await store.create('code/x4km7.json', { code: 'X4KM7', files: [] })).toBe(true);
    expect(await store.read('code/x4km7.json')).toEqual({ code: 'X4KM7', files: [] });
    expect(puts(sdk)[0].options).toMatchObject({
      access: 'private',
      allowOverwrite: false,
      contentType: 'application/json',
      addRandomSuffix: false,
    });
    expect(sdk.calls.find((c) => c.op === 'get')?.options).toMatchObject({ access: 'private', useCache: false });
  });

  it('answers null for a record that was never written', async () => {
    const store = createBlobJson(fakeBlob(), TOKEN);
    expect(await store.read('world/quiet-meadow-27.json')).toBeNull();
  });

  it('reports a taken pathname on create and leaves the first record as it was', async () => {
    const sdk = fakeBlob();
    const store = createBlobJson(sdk, TOKEN);
    await store.create('code/x4km7.json', { n: 1 });
    expect(await store.create('code/x4km7.json', { n: 2 })).toBe(false);
    expect(await store.read('code/x4km7.json')).toEqual({ n: 1 });
  });

  it('rejects create when the write fails for another reason', async () => {
    const sdk = fakeBlob();
    sdk.failOn = (call) => (call.op === 'put' ? new Error('service down') : null);
    const store = createBlobJson(sdk, TOKEN);
    await expect(store.create('code/x4km7.json', {})).rejects.toThrow('service down');
  });

  it('overwrites with write and forgets with remove; removing twice is fine', async () => {
    const sdk = fakeBlob();
    const store = createBlobJson(sdk, TOKEN);
    await store.write('world/a.json', { rev: 1 });
    await store.write('world/a.json', { rev: 2 });
    expect(await store.read('world/a.json')).toEqual({ rev: 2 });
    await store.remove('world/a.json');
    await store.remove('world/a.json');
    expect(await store.read('world/a.json')).toBeNull();
  });

  it('refuses a pathname that could escape its folder before calling the service', async () => {
    const sdk = fakeBlob();
    const store = createBlobJson(sdk, TOKEN);
    const bad = ['../secret.json', 'code/../../x.json', 'Code/X.json', 'code/x', '', '/abs.json', 'a//b.json', 'x'.repeat(200) + '.json'];
    for (const pathname of bad) {
      await expect(store.read(pathname)).rejects.toMatchObject({ reason: 'bad-key' });
      await expect(store.write(pathname, {})).rejects.toMatchObject({ reason: 'bad-key' });
    }
    expect(() => assertPath('code/x4km7.json')).not.toThrow();
    expect(sdk.calls).toHaveLength(0);
  });

  it('rejects a stored record that is not JSON instead of passing it on', async () => {
    const sdk = fakeBlob();
    sdk.blobs.set('code/x4km7.json', 'not json');
    const store = createBlobJson(sdk, TOKEN);
    await expect(store.read('code/x4km7.json')).rejects.toBeInstanceOf(BlobJsonError);
  });

  it('gives up at the deadline of the request when the service does not answer', async () => {
    const sdk = fakeBlob();
    sdk.get = () => new Promise(() => undefined);
    sdk.put = () => new Promise(() => undefined);
    const store = createBlobJson(sdk, TOKEN);
    const started = Date.now();
    await expect(store.read('code/x4km7.json', AbortSignal.timeout(40))).rejects.toMatchObject({ reason: 'timeout' });
    await expect(store.write('code/x4km7.json', {}, AbortSignal.timeout(40))).rejects.toMatchObject({ reason: 'timeout' });
    await expect(store.create('code/x4km7.json', {}, AbortSignal.timeout(40))).rejects.toMatchObject({ reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('never puts the token into a pathname or a stored body', async () => {
    const sdk = fakeBlob();
    const store = createBlobJson(sdk, TOKEN);
    await store.write('code/x4km7.json', { a: 1 });
    const stored = [...sdk.blobs.entries()].map(([path, body]) => path + String(body)).join('\n');
    expect(stored).not.toContain('notARealSecret');
  });
});

describe('http helpers', () => {
  it('answers a refusal in the one JSON shape, with Retry-After for a wait', async () => {
    const response = fail(429, 'rate-limited', { retryAfter: 7.2 });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'rate-limited', retryAfter: 7.2 });
  });

  it('reads JSON bodies, refuses broken ones and ones over the limit', async () => {
    const ok = await readJson(new Request('https://x/api', { method: 'POST', body: '{"kind":"drop"}' }));
    expect(ok).toEqual({ ok: true, value: { kind: 'drop' } });
    const broken = await readJson(new Request('https://x/api', { method: 'POST', body: 'hello' }));
    expect(broken.ok ? null : await broken.response.json()).toEqual({ error: 'bad-request' });
    const big = await readJson(new Request('https://x/api', { method: 'POST', body: 'x'.repeat(2000) }), 1000);
    expect(big.ok ? null : big.response.status).toBe(413);
  });

  it('hashes the caller address with a key and never returns the address itself', () => {
    const a = new Request('https://x', { headers: { 'x-real-ip': '203.0.113.7' } });
    const b = new Request('https://x', { headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' } });
    expect(clientAddress(a)).toBe('203.0.113.7');
    expect(clientAddress(b)).toBe('198.51.100.2');
    expect(hashAddress(a, 'k1')).toMatch(/^[0-9a-f]{32}$/);
    expect(hashAddress(a, 'k1')).not.toBe(hashAddress(a, 'k2'));
  });

  it('compares hashes and hides secrets in log text', () => {
    expect(sameHash(sha256('owner'), sha256('owner'))).toBe(true);
    expect(sameHash(sha256('owner'), sha256('other'))).toBe(false);
    const text = describeError(new Error(`put failed for ${TOKEN} with Bearer abc.def and sk-or-v1-123`));
    expect(text).not.toMatch(/notARealSecret|abc\.def|sk-or-v1-123/);
  });
});
