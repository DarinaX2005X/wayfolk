/**
 * api/_lib/files.ts against a stand-in for @vercel/blob: one private put without
 * multipart and without overwriting, signed read addresses, deletion, the client upload
 * token bound to one path, and the monthly write allowance and readonly switch.
 * The real service is checked separately (see the package report).
 */
import { describe, expect, it } from 'vitest';
import { FilesError, createFiles, type FilesSdk } from '../../api/_lib/files';
import { buildStorage, resetKv } from '../../api/_lib/kv';

function fakeSdk() {
  const calls: { op: string; args: unknown[] }[] = [];
  let onBefore: ((p: string, payload: string | null, multipart: boolean) => Promise<Record<string, unknown>>) | null = null;
  const sdk: FilesSdk = {
    async put(pathname, _body, options) {
      calls.push({ op: 'put', args: [pathname, options] });
      return { url: `https://store.private.blob.vercel-storage.com/${pathname}`, pathname };
    },
    async del(pathnames) {
      calls.push({ op: 'del', args: [pathnames] });
    },
    async issueSignedToken(options) {
      calls.push({ op: 'issue', args: [options] });
      return { delegationToken: 'd', clientSigningToken: 'c', validUntil: Number(options.validUntil) };
    },
    async presignUrl(_token, options) {
      calls.push({ op: 'presign', args: [options] });
      return { presignedUrl: `https://store.private.blob.vercel-storage.com/${String(options.pathname)}?sig=1` };
    },
    async handleUpload(options) {
      onBefore = options.onBeforeGenerateToken as typeof onBefore;
      return { type: 'blob.generate-client-token', clientToken: 'client-token' };
    },
  };
  return { sdk, calls, before: () => onBefore! };
}

const make = (env: Record<string, string> = {}) => {
  resetKv();
  const storage = buildStorage({ driver: 'memory' }, env);
  const fake = fakeSdk();
  const files = createFiles({ token: 'vercel_blob_rw_test', sdk: fake.sdk, storage: () => storage, now: () => 1_000_000 });
  return { files, ...fake };
};

describe('files in Blob', () => {
  it('puts one private file without multipart, random suffix or overwrite', async () => {
    const { files, calls } = make();
    expect(await files.putFile('x/X4KM7-abcdefgh12345678.bundle.json', '[]', 'application/json', { purpose: 'export' })).toEqual({
      path: 'x/X4KM7-abcdefgh12345678.bundle.json',
    });
    expect(calls[0].args[1]).toMatchObject({ access: 'private', multipart: false, addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
  });

  it('refuses odd paths', async () => {
    const { files } = make();
    await expect(files.putFile('../etc/passwd', 'x', 'text/plain')).rejects.toBeInstanceOf(FilesError);
    await expect(files.putFile('up/X1/a b.pdf', 'x', 'application/pdf')).rejects.toBeInstanceOf(FilesError);
  });

  it('hands out a signed read address valid for the asked time, counted as a read', async () => {
    const { files, calls } = make({ BLOB_MONTHLY_READS: '1' });
    const url = await files.fileUrl('up/F4KM7/1-lease.pdf', { validForMs: 60_000 });
    expect(url).toContain('up/F4KM7/1-lease.pdf');
    expect(calls.find((c) => c.op === 'issue')!.args[0]).toMatchObject({ pathname: 'up/F4KM7/1-lease.pdf', operations: ['get'], validUntil: 1_060_000 });
    expect(calls.find((c) => c.op === 'presign')!.args[0]).toMatchObject({ operation: 'get', access: 'private', validUntil: 1_060_000 });
    await expect(files.fileUrl('up/F4KM7/1-lease.pdf')).rejects.toMatchObject({ reason: 'storage-busy' });
  });

  it('deletes files in one call and does nothing for none', async () => {
    const { files, calls } = make();
    await files.deleteFiles([]);
    await files.deleteFiles(['up/F1/1-a.pdf', 'up/F1/2-b.pdf']);
    expect(calls).toEqual([{ op: 'del', args: [['up/F1/1-a.pdf', 'up/F1/2-b.pdf']] }]);
  });

  it('gives an upload token only for the one path, its types and size, never multipart', async () => {
    const { files, before } = make();
    const policy = { pathname: 'up/F4KM7/1-lease.pdf', allowedContentTypes: ['application/pdf'], maximumSizeInBytes: 20 * 1024 * 1024, validUntil: 2_000_000 };
    await files.handleClientUpload(new Request('https://site/api/code/F4KM7/upload', { method: 'POST' }), {}, policy);
    await expect(before()('up/F4KM7/1-lease.pdf', null, false)).resolves.toMatchObject({
      allowedContentTypes: ['application/pdf'],
      maximumSizeInBytes: 20 * 1024 * 1024,
      addRandomSuffix: false,
      allowOverwrite: false,
    });
    await expect(before()('up/OTHER/1-x.pdf', null, false)).rejects.toBeInstanceOf(FilesError);
    await expect(before()('up/F4KM7/1-lease.pdf', null, true)).rejects.toBeInstanceOf(FilesError);
  });

  it('stops writes at the monthly allowance (keeping the export reserve) and under the readonly switch', async () => {
    const limited = make({ BLOB_MONTHLY_WRITES: '251' });
    await limited.files.putFile('up/F1/1-a.pdf', 'x', 'application/pdf');
    await expect(limited.files.putFile('up/F1/2-b.pdf', 'x', 'application/pdf')).rejects.toMatchObject({ reason: 'storage-busy' });
    await expect(limited.files.putFile('x/X1-a.bundle.json', '[]', 'application/json', { purpose: 'export' })).resolves.toBeTruthy();
    const readonly = make({ STORAGE_READONLY: '1' });
    await expect(readonly.files.putFile('up/F1/1-a.pdf', 'x', 'application/pdf')).rejects.toMatchObject({ reason: 'storage-readonly' });
    await expect(readonly.files.deleteFiles(['up/F1/1-a.pdf'])).resolves.toBeUndefined();
  });
});
