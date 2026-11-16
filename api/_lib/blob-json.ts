/**
 * Small JSON records in Vercel Blob: read, write once, overwrite, remove, each bounded by
 * the request's deadline. This is the storage driver `blob-json` (PLAN "Хранилище"):
 * without Redis, codes and the world live here as JSON files. Package 01.5 builds the
 * `KV` interface on top of it; files of uploads and exports go through api/_lib/files.ts.
 *
 * The SDK is passed in (the functions pass the real `@vercel/blob`), so tests run this
 * file against a fake with the same four calls. Checked against @vercel/blob 2.9.0:
 * `put` refuses an existing pathname unless `allowOverwrite` is set; `get` returns null
 * for a missing blob; `head` throws for one; `del` does not fail on a missing one; an
 * explicit `token` wins over any other credentials. The store of this project is
 * private, so every call says `access: 'private'` unless told otherwise.
 *
 * Writes are counted against a monthly allowance (2 000 on the free plan), so a caller
 * that keeps a counter here batches its writes; this module never writes on its own.
 */

export type BlobAccess = 'public' | 'private';
type ReadOptions = { access: BlobAccess; token: string; abortSignal?: AbortSignal; useCache?: boolean };
type WriteOptions = {
  access: BlobAccess;
  token: string;
  abortSignal?: AbortSignal;
  addRandomSuffix: false;
  allowOverwrite: boolean;
  contentType: string;
  cacheControlMaxAge?: number;
};

/** The part of `@vercel/blob` this file uses. */
export type BlobSdk = {
  put(pathname: string, body: string | Buffer, options: WriteOptions): Promise<{ url: string }>;
  get(
    pathname: string,
    options: ReadOptions,
  ): Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null } | null>;
  head(pathname: string, options: { token: string; abortSignal?: AbortSignal }): Promise<unknown>;
  del(pathname: string, options: { token: string; abortSignal?: AbortSignal }): Promise<void>;
};

export class BlobJsonError extends Error {
  constructor(public reason: 'timeout' | 'corrupt-record' | 'bad-key') {
    super(`blob-json: ${reason}`);
    this.name = 'BlobJsonError';
  }
}

/** Settles with `work`, or rejects with a timeout as soon as the deadline passes. */
export function within<T>(signal: AbortSignal | undefined, work: Promise<T>): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new BlobJsonError('timeout'));
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/**
 * Pathnames become part of a URL and of a file name in the store: lowercase letters,
 * digits, `-`, `_`, `.` and `/` between segments, no empty or dot segments, ending in
 * `.json`, at most 200 characters.
 */
const PATH_SHAPE = /^(?:[a-z0-9_-][a-z0-9_.-]*\/)*[a-z0-9_-][a-z0-9_.-]*\.json$/;

export function assertPath(pathname: string): void {
  if (pathname.length > 200 || !PATH_SHAPE.test(pathname) || pathname.split('/').some((s) => s === '.' || s === '..')) {
    throw new BlobJsonError('bad-key');
  }
}

export type BlobJson = {
  /** The stored value, or null when nothing is stored there. Rejects on a record that is not JSON. */
  read<T = unknown>(pathname: string, signal?: AbortSignal): Promise<T | null>;
  /** Writes a record that must not exist yet. Resolves false when the pathname is taken. */
  create(pathname: string, value: unknown, signal?: AbortSignal): Promise<boolean>;
  /** Writes a record, replacing what is there. */
  write(pathname: string, value: unknown, signal?: AbortSignal): Promise<void>;
  /** Removes a record; removing a missing one is not an error. */
  remove(pathname: string, signal?: AbortSignal): Promise<void>;
};

export function createBlobJson(
  sdk: BlobSdk,
  token: string,
  options: { access?: BlobAccess; maxAge?: number } = {},
): BlobJson {
  const access = options.access ?? 'private';
  // Records change, so they get the shortest cache the service allows.
  const maxAge = options.maxAge ?? 60;

  const put = (pathname: string, value: unknown, allowOverwrite: boolean, signal?: AbortSignal) =>
    within(
      signal,
      sdk.put(pathname, JSON.stringify(value), {
        access,
        token,
        addRandomSuffix: false,
        allowOverwrite,
        contentType: 'application/json',
        cacheControlMaxAge: maxAge,
        abortSignal: signal,
      }),
    );

  const exists = async (pathname: string, signal?: AbortSignal): Promise<boolean> => {
    try {
      await within(signal, sdk.head(pathname, { token, abortSignal: signal }));
      return true;
    } catch {
      return false;
    }
  };

  return {
    async read<T>(pathname: string, signal?: AbortSignal): Promise<T | null> {
      assertPath(pathname);
      const found = await within(signal, sdk.get(pathname, { access, token, abortSignal: signal, useCache: false }));
      if (!found || found.statusCode !== 200 || !found.stream) return null;
      const text = await within(signal, new Response(found.stream).text());
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new BlobJsonError('corrupt-record');
      }
    },

    async create(pathname, value, signal) {
      assertPath(pathname);
      try {
        await put(pathname, value, false, signal);
        return true;
      } catch (err) {
        // The refusal itself comes from the service (`allowOverwrite: false`), so two
        // requests cannot both win; `head` only tells that refusal from a real failure.
        if (signal?.aborted || err instanceof BlobJsonError) throw err;
        if (await exists(pathname, signal)) return false;
        throw err;
      }
    },

    async write(pathname, value, signal) {
      assertPath(pathname);
      await put(pathname, value, true, signal);
    },

    async remove(pathname, signal) {
      assertPath(pathname);
      await within(signal, sdk.del(pathname, { token, abortSignal: signal }));
    },
  };
}
