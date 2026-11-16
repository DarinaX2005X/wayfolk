/**
 * Files in Vercel Blob (PLAN "Хранилище"): uploads from the phone (`up/<code>/<n>-<name>`)
 * and export bundles (`x/<code>-<16 random>.bundle.json`). Only files: small records go
 * through ./kv.ts. The store is private, so a file is handed out as a short-lived signed
 * address (`fileUrl`), and the phone uploads straight to Blob with a client token that
 * allows exactly one path (`handleClientUpload`). One `put` per file, no multipart, and
 * no `list` or `copy` anywhere.
 *
 * Every write is counted against the monthly allowance before it happens (./budget.ts)
 * and refused under STORAGE_READONLY. Deleting is allowed under the switch: it is how
 * private documents leave the server.
 */
import * as blobSdk from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import type { OpsPurpose } from './budget';
import { text, type Env } from './env';
import { KvError, getStorage, type Storage } from './kv';

/** The part of `@vercel/blob` (and its client helper) this file uses. */
export type FilesSdk = {
  put(pathname: string, body: string | Buffer | Uint8Array, options: Record<string, unknown>): Promise<{ url: string; pathname: string }>;
  del(pathnames: string[], options: { token: string }): Promise<void>;
  issueSignedToken(options: Record<string, unknown>): Promise<{ delegationToken: string; clientSigningToken: string; validUntil: number }>;
  presignUrl(
    token: { delegationToken: string; clientSigningToken: string },
    options: Record<string, unknown>,
  ): Promise<{ presignedUrl: string }>;
  handleUpload(options: Record<string, unknown>): Promise<unknown>;
};

const realSdk: FilesSdk = {
  put: (pathname, body, options) => blobSdk.put(pathname, body as Buffer, options as never),
  del: (pathnames, options) => blobSdk.del(pathnames, options),
  issueSignedToken: (options) => blobSdk.issueSignedToken(options as never),
  presignUrl: (token, options) => blobSdk.presignUrl(token, options as never),
  handleUpload: (options) => handleUpload(options as never),
};

/** File paths: segments of letters, digits, '.', '_' and '-', separated by '/'. */
const FILE_PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export class FilesError extends Error {
  constructor(public reason: 'bad-path' | 'storage-off' | 'refused') {
    super(`files: ${reason}`);
    this.name = 'FilesError';
  }
}

export function assertFilePath(path: string): void {
  if (path.length > 240 || !FILE_PATH.test(path) || path.split('/').some((s) => s === '.' || s === '..')) {
    throw new FilesError('bad-path');
  }
}

export type UploadPolicy = {
  /** The only path the token may write, for example `up/F4KM7/1-lease.pdf`. */
  pathname: string;
  allowedContentTypes: string[];
  maximumSizeInBytes: number;
  /** Absolute expiry of the token, ms since epoch. */
  validUntil: number;
};

export type Files = {
  /** Writes one file; refuses an existing path. Resolves with the stored path. */
  putFile(path: string, body: string | Buffer | Uint8Array, mime: string, options?: { purpose?: OpsPurpose }): Promise<{ path: string }>;
  /**
   * A signed address that reads the file until `validForMs` from now (default one hour).
   * Counted as one Blob read, because the read itself goes past the function.
   */
  fileUrl(path: string, options?: { validForMs?: number; purpose?: OpsPurpose }): Promise<string>;
  /** Deletes files; missing ones are not an error. */
  deleteFiles(paths: string[]): Promise<void>;
  /**
   * The `handleUpload` protocol of `@vercel/blob/client` for one file: the client asks
   * for a token, the token allows only `policy.pathname`, its types and size.
   */
  handleClientUpload(request: Request, body: unknown, policy: UploadPolicy): Promise<unknown>;
};

export function createFiles(options: { token: string; sdk?: FilesSdk; storage: () => Storage; now?: () => number }): Files {
  const sdk = options.sdk ?? realSdk;
  const { token } = options;
  const now = options.now ?? Date.now;

  return {
    async putFile(path, body, mime, opts = {}) {
      assertFilePath(path);
      const storage = options.storage();
      if (storage.readonly) throw new KvError('storage-readonly');
      await storage.budget.blob('write', opts.purpose ?? 'upload');
      await sdk.put(path, body, {
        access: 'private',
        token,
        contentType: mime,
        addRandomSuffix: false,
        allowOverwrite: false,
        multipart: false,
      });
      return { path };
    },

    async fileUrl(path, opts = {}) {
      assertFilePath(path);
      await options.storage().budget.blob('read', opts.purpose ?? 'files');
      const validUntil = now() + (opts.validForMs ?? 3600_000);
      const signed = await sdk.issueSignedToken({ token, pathname: path, operations: ['get'], validUntil });
      const { presignedUrl } = await sdk.presignUrl(signed, { operation: 'get', pathname: path, access: 'private', validUntil });
      return presignedUrl;
    },

    async deleteFiles(paths) {
      if (paths.length === 0) return;
      for (const path of paths) assertFilePath(path);
      await sdk.del(paths, { token });
    },

    async handleClientUpload(request, body, policy) {
      assertFilePath(policy.pathname);
      const storage = options.storage();
      if (storage.readonly) throw new KvError('storage-readonly');
      return sdk.handleUpload({
        token,
        request,
        body: body as HandleUploadBody,
        onBeforeGenerateToken: async (pathname: string, _payload: string | null, multipart: boolean) => {
          if (multipart || pathname !== policy.pathname) throw new FilesError('refused');
          await storage.budget.blob('write', 'upload');
          return {
            allowedContentTypes: policy.allowedContentTypes,
            maximumSizeInBytes: policy.maximumSizeInBytes,
            validUntil: policy.validUntil,
            addRandomSuffix: false,
            allowOverwrite: false,
          };
        },
      });
    },
  };
}

/** Files of this deployment. Throws FilesError('storage-off') without a Blob token. */
export function getFiles(env: Env = process.env): Files {
  const token = text(env, 'BLOB_READ_WRITE_TOKEN');
  if (!token) throw new FilesError('storage-off');
  return createFiles({ token, storage: () => getStorage(env) });
}
