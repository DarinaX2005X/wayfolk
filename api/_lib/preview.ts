/**
 * Previews of live code projects (a site or web app the agents built for a person):
 *
 *   POST /api/r                 { title, files: [{ path, text }] }  ->  { code, url }
 *   GET  /api/r/<code>/<path>   one file of the project, with its content type
 *
 * The files are stored as one JSON object through the Blob file API
 * (`p/<code>-<16 random>.site.json`, private), and the code points at it in the store of
 * small records for 30 days. Without a Blob token (the dev server, tests) a small project
 * is kept in the record itself.
 *
 * A preview runs code no person wrote, so it is served with a strict policy: the page is
 * sandboxed into an origin of its own (no cookies, no storage of the app, no requests to
 * anywhere), may run its own inline and same-path scripts and styles, and nothing else.
 * Its localStorage is a stand-in kept in memory for the life of the page (a sandboxed page
 * has none); a small script added at the top of each HTML page provides it.
 *
 * Limits: 12 files, 1.5 MB in all, plain relative paths with known extensions; 30
 * uploads per address per day.
 */
import { randomBytes } from 'node:crypto';
import type { Env } from './env';
import { getFiles, type Files } from './files';
import { fail, hashAddress, isRecord, json, readJson } from './http';
import { getKv, type KV } from './kv';
import { storageFailure } from './storage-errors';

export type SiteRecord = { title: string; createdAt: string; blob?: string; files?: { path: string; text: string }[] };

const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE = /^[A-Z2-9]{6}$/;
const PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
const EXT: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  md: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};
export const MAX_FILES = 12;
export const MAX_BYTES = 1_500_000;
const TTL = 30 * 24 * 3600;
const DAILY = 30;

export const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  'sandbox allow-scripts allow-forms allow-modals allow-popups',
].join('; ');

/** First script of every page: a memory localStorage and sessionStorage when the sandbox gives none. */
export const STORAGE_SHIM =
  '<script>(function(){function m(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}}' +
  "['localStorage','sessionStorage'].forEach(function(n){try{window[n].getItem('x')}catch(e){try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(_){}}})})();</script>";

export const mimeFor = (path: string): string | null => EXT[path.toLowerCase().split('.').pop() ?? ''] ?? null;

export function withShim(html: string): string {
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + STORAGE_SHIM + html.slice(head.index + head[0].length);
  return STORAGE_SHIM + html;
}

export function newCode(): string {
  const bytes = randomBytes(6);
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** The files of a request, or the reason they are refused. */
export function readSiteFiles(value: unknown): { ok: true; title: string; files: { path: string; text: string }[] } | { ok: false; problem: string } {
  if (!isRecord(value) || !Array.isArray(value.files)) return { ok: false, problem: 'files' };
  const title = typeof value.title === 'string' ? value.title.slice(0, 80) : 'Project';
  if (value.files.length === 0 || value.files.length > MAX_FILES) return { ok: false, problem: 'file count' };
  const files: { path: string; text: string }[] = [];
  let bytes = 0;
  for (const f of value.files) {
    if (!isRecord(f) || typeof f.path !== 'string' || typeof f.text !== 'string') return { ok: false, problem: 'file shape' };
    if (!PATH.test(f.path) || f.path.length > 120 || f.path.split('/').some((p) => p === '..') || !mimeFor(f.path)) return { ok: false, problem: `path ${f.path}` };
    if (files.some((x) => x.path === f.path)) return { ok: false, problem: `twice ${f.path}` };
    bytes += f.text.length;
    files.push({ path: f.path, text: f.text });
  }
  if (bytes > MAX_BYTES) return { ok: false, problem: 'too big' };
  if (!files.some((f) => f.path === 'index.html')) return { ok: false, problem: 'no index.html' };
  return { ok: true, title, files };
}

export type PreviewDeps = { env?: () => Env; kv?: () => KV; files?: () => Files | null; fetch?: typeof fetch; now?: () => number };

export function createPreviewRoutes(deps: PreviewDeps = {}) {
  const env = deps.env ?? (() => process.env);
  const kvOf = deps.kv ?? (() => getKv(env()));
  const filesOf =
    deps.files ??
    (() => {
      try {
        return getFiles(env());
      } catch {
        return null;
      }
    });
  const doFetch = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  /** Sites already read by this instance, by code. */
  const cache = new Map<string, { path: string; text: string }[]>();

  async function POST(request: Request): Promise<Response> {
    const body = await readJson(request, MAX_BYTES + 64_000);
    if (!body.ok) return body.response;
    const site = readSiteFiles(body.value);
    if (!site.ok) return fail(400, 'bad-request', { problem: site.problem });
    try {
      const kv = kvOf();
      const day = new Date(now()).toISOString().slice(0, 10);
      const tries = await kv.incr(`tries:r:${hashAddress(request, 'groundwork-preview')}:${day}`, 1, { ex: 2 * 24 * 3600 });
      if (tries > DAILY) return fail(429, 'too-many');
      let code = newCode();
      for (let i = 0; i < 4 && (await kv.get(`site:${code}`)) !== null; i++) code = newCode();
      const record: SiteRecord = { title: site.title, createdAt: new Date(now()).toISOString() };
      const files = filesOf();
      if (files) {
        const path = `p/${code}-${randomBytes(8).toString('hex')}.site.json`;
        await files.putFile(path, JSON.stringify({ title: site.title, files: site.files }), 'application/json', { purpose: 'export' });
        record.blob = path;
      } else {
        record.files = site.files;
      }
      await kv.set(`site:${code}`, record, { ex: TTL, nx: true });
      cache.set(code, site.files);
      return json(200, { code, url: `/api/r/${code}/` });
    } catch (err) {
      return storageFailure(err) ?? fail(500, 'server');
    }
  }

  async function load(code: string): Promise<{ path: string; text: string }[] | null> {
    const hit = cache.get(code);
    if (hit) return hit;
    const record = await kvOf().get<SiteRecord>(`site:${code}`);
    if (!record) return null;
    let files = record.files ?? null;
    if (!files && record.blob) {
      const store = filesOf();
      if (!store) return null;
      const url = await store.fileUrl(record.blob, { purpose: 'export' });
      const res = await doFetch(url);
      if (!res.ok) return null;
      const value = (await res.json()) as { files?: { path: string; text: string }[] };
      files = Array.isArray(value.files) ? value.files : null;
    }
    if (files) cache.set(code, files);
    return files;
  }

  async function GET(request: Request): Promise<Response> {
    const url = new URL(request.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // api, r, CODE, ...path
    const code = (parts[2] ?? '').toUpperCase();
    if (!CODE.test(code)) return fail(404, 'not-found');
    if (parts.length === 3 && !url.pathname.endsWith('/')) {
      return new Response(null, { status: 308, headers: { location: `/api/r/${code}/` } });
    }
    const path = parts.slice(3).map(decodeURIComponent).join('/') || 'index.html';
    if (!PATH.test(path)) return fail(404, 'not-found');
    try {
      const files = await load(code);
      if (!files) return fail(404, 'not-found');
      const file = files.find((f) => f.path === path) ?? (path.endsWith('/') ? files.find((f) => f.path === path + 'index.html') : undefined);
      if (!file) return new Response('Not in this project.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': PREVIEW_CSP } });
      const type = mimeFor(file.path) ?? 'text/plain; charset=utf-8';
      const text = type.startsWith('text/html') ? withShim(file.text) : file.text;
      return new Response(text, {
        status: 200,
        headers: {
          'content-type': type,
          'content-security-policy': PREVIEW_CSP,
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'cross-origin-opener-policy': 'same-origin',
          // The sandboxed page has an origin of its own: its module scripts and fetches are cross-origin.
          'access-control-allow-origin': '*',
          'cache-control': 'public, max-age=300',
        },
      });
    } catch (err) {
      return storageFailure(err) ?? fail(500, 'server');
    }
  }

  return { GET, POST };
}
