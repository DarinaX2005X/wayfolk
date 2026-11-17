/**
 * Public islands: `/api/islands` and its subpaths. Records go through the store of small
 * records (./kv.ts: Redis, or JSON files in Vercel Blob, or memory on the dev server).
 *
 *   GET    /api/islands                 the horizon: demo islands first, then published ones
 *   POST   /api/islands                 publish { island } -> 201 { id, ownerKey, rev }
 *   GET    /api/islands/:id             { island, guests, updatedAt, demo? }
 *   PUT    /api/islands/:id             republish { island } with x-owner-key -> { rev }
 *   DELETE /api/islands/:id             unpublish with x-owner-key
 *   POST   /api/islands/:id/mail        leave a gift or note -> 201 { id }
 *   GET    /api/islands/:id/mail        the mailbox, x-owner-key only
 *   POST   /api/islands/:id/guests      deliver a visiting resident -> 201 { leavesAt }
 *   GET    /api/islands/:id/guests      residents of other islands staying here now
 *
 * The same addresses work as `/api/islands?id=<id>&part=mail` for a deployment whose
 * rewrite of subpaths is missing.
 *
 * Keys: `isl:<id>` { rev, ownerHash, island, publishedAt, updatedAt }; `isl-mail:<id>`
 * (newest 40); `isl-guests:<id>` (at most 6, expired ones dropped); `isl-index` (newest
 * 100 summaries). Rate limits per address and UTC day under `tries:` (on blob-json they
 * stay in the memory of the instance and cost no Blob writes). Ids are 10 characters of
 * a 32-letter alphabet (50 bits), owner keys 32 characters of base64url; only the
 * owner key's hash is stored.
 */
import { randomBytes } from 'node:crypto';
import { cleanPublicIsland, cleanPublicResident, ISLAND_ID, summaryOf } from '../../src/mind/check';
import { DEMO_ISLANDS } from '../../src/mind/demo';
import { GIFT_KINDS, type IslandSummary, type MailItem } from '../../src/mind/types';
import type { Guest, PublicIsland } from './contracts';
import type { Env } from './env';
import { describeError, fail, hashAddress, isRecord, json, readJson, sameHash, sha256 } from './http';
import { getKv, type KV } from './kv';
import { storageFailure } from './storage-errors';

export type IslandRecord = { rev: number; ownerHash: string; island: PublicIsland; publishedAt: number; updatedAt: number };

export type IslandsDeps = {
  env?: () => Env;
  kv?: () => KV;
  now?: () => number;
  random?: (bytes: number) => Uint8Array;
  log?: (line: Record<string, unknown>) => void;
};

export const ISLAND_BODY_LIMIT = 96 * 1024;
const SMALL_BODY_LIMIT = 8 * 1024;
const MAIL_KEEP = 40;
const GUESTS_MAX = 6;
const INDEX_KEEP = 100;
const LIST_MAX = 30;
const DAY_TTL = 2 * 24 * 3600;
const MIN_STAY = 60_000;
const MAX_STAY = 48 * 3600_000;

/** Per address and UTC day. */
export const RATE = { publish: 6, update: 80, mail: 40, guests: 30, remove: 10 } as const;

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const keys = {
  island: (id: string) => `isl:${id}`,
  mail: (id: string) => `isl-mail:${id}`,
  guests: (id: string) => `isl-guests:${id}`,
  index: 'isl-index',
  tries: (op: string, day: string, address: string) => `tries:isl:${op}:${day}:${address}`,
};

const demoById = new Map(DEMO_ISLANDS.map((d) => [d.id, d]));

type Address = { id: string | null; part: string | null };

/** `/api/islands/abc/mail` -> { id: 'abc', part: 'mail' }; query form as fallback. */
export function addressOf(url: URL): Address {
  const parts = url.pathname.split('/').filter((p) => p !== '');
  const id = parts[2] ?? url.searchParams.get('id');
  const part = parts[3] ?? url.searchParams.get('part');
  return { id: id ?? null, part: part ?? null };
}

export function createIslandRoutes(deps: IslandsDeps = {}) {
  const env = deps.env ?? (() => process.env);
  const now = deps.now ?? Date.now;
  const random = deps.random ?? ((n: number) => new Uint8Array(randomBytes(n)));
  const log = deps.log ?? ((line: Record<string, unknown>) => console.log(JSON.stringify(line)));
  const kvOf = deps.kv ?? (() => getKv(env()));

  const newId = (): string => [...random(10)].map((b) => ALPHABET[b % 32]).join('');
  const newKey = (): string => Buffer.from(random(24)).toString('base64url');
  const day = (): string => new Date(now()).toISOString().slice(0, 10);
  const address = (request: Request): string => hashAddress(request, 'wayfolk-islands');

  /** Counts one try; a refusal when the address used up today's allowance. */
  async function limited(kv: KV, request: Request, op: keyof typeof RATE): Promise<Response | null> {
    const count = await kv.incr(keys.tries(op, day(), address(request)), 1, { ex: DAY_TTL });
    return count > RATE[op] ? fail(429, 'too-many') : null;
  }

  async function owned(kv: KV, request: Request, id: string): Promise<IslandRecord | Response> {
    const record = await kv.get<IslandRecord>(keys.island(id));
    if (!record) return fail(404, 'not-found');
    const key = request.headers.get('x-owner-key') ?? '';
    if (!key || !sameHash(sha256(key), record.ownerHash)) return fail(403, 'forbidden');
    return record;
  }

  async function exists(kv: KV, id: string): Promise<boolean> {
    return demoById.has(id) || (await kv.get(keys.island(id))) !== null;
  }

  async function updateIndex(kv: KV, change: (list: IslandSummary[]) => IslandSummary[]): Promise<void> {
    const list = (await kv.get<IslandSummary[]>(keys.index)) ?? [];
    const next = change(list.filter((s) => isRecord(s)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, INDEX_KEEP);
    await kv.set(keys.index, next);
  }

  async function guestsOf(kv: KV, id: string): Promise<Guest[]> {
    const list = (await kv.get<Guest[]>(keys.guests(id))) ?? [];
    return list.filter((g) => isRecord(g) && g.leavesAt > now());
  }

  // ---------------------------------------------------------------- handlers

  async function list(): Promise<Response> {
    const demos = DEMO_ISLANDS.map((d) => summaryOf(d.island, d.island.createdAt, true));
    let published: IslandSummary[] = [];
    try {
      published = ((await kvOf().get<IslandSummary[]>(keys.index)) ?? []).filter((s) => !demoById.has(s.id));
    } catch (err) {
      log({ at: 'islands', route: 'list', problem: describeError(err) });
    }
    return json(200, { islands: [...demos, ...published].slice(0, LIST_MAX) }, { 'cache-control': 'public, s-maxage=20' });
  }

  async function read(id: string): Promise<Response> {
    const demo = demoById.get(id);
    let guests: Guest[] = [];
    try {
      const kv = kvOf();
      guests = await guestsOf(kv, id);
      if (!demo) {
        const record = await kv.get<IslandRecord>(keys.island(id));
        if (!record) return fail(404, 'not-found');
        return json(200, { island: record.island, guests, updatedAt: record.updatedAt });
      }
    } catch (err) {
      if (!demo) throw err;
      log({ at: 'islands', route: 'read', problem: describeError(err) });
    }
    return json(200, { island: demo!.island, guests, updatedAt: demo!.island.createdAt, demo: true });
  }

  async function publish(request: Request): Promise<Response> {
    const body = await readJson(request, ISLAND_BODY_LIMIT);
    if (!body.ok) return body.response;
    const island = isRecord(body.value) ? cleanPublicIsland(body.value.island) : 'body: expected { island }';
    if (typeof island === 'string') return fail(400, 'bad-request', { problem: island });
    const kv = kvOf();
    const refused = await limited(kv, request, 'publish');
    if (refused) return refused;
    const ownerKey = newKey();
    const at = now();
    for (let tries = 0; tries < 3; tries += 1) {
      const id = newId();
      const record: IslandRecord = { rev: 1, ownerHash: sha256(ownerKey), island: { ...island, id }, publishedAt: at, updatedAt: at };
      if (!(await kv.set(keys.island(id), record, { nx: true }))) continue;
      await updateIndex(kv, (list) => [summaryOf(record.island, at), ...list.filter((s) => s.id !== id)]);
      log({ at: 'islands', route: 'publish', residents: island.residents.length });
      return json(201, { id, ownerKey, rev: 1 });
    }
    return fail(503, 'storage-busy');
  }

  async function update(request: Request, id: string): Promise<Response> {
    const body = await readJson(request, ISLAND_BODY_LIMIT);
    if (!body.ok) return body.response;
    const island = isRecord(body.value) ? cleanPublicIsland(body.value.island) : 'body: expected { island }';
    if (typeof island === 'string') return fail(400, 'bad-request', { problem: island });
    const kv = kvOf();
    const refused = await limited(kv, request, 'update');
    if (refused) return refused;
    const record = await owned(kv, request, id);
    if (record instanceof Response) return record;
    const at = now();
    const next: IslandRecord = { ...record, rev: record.rev + 1, island: { ...island, id }, updatedAt: at };
    if (!(await kv.set(keys.island(id), next, { ifRev: record.rev }))) {
      const current = await kv.get<IslandRecord>(keys.island(id));
      return fail(409, 'conflict', { current: current?.rev ?? 0 });
    }
    await updateIndex(kv, (list) => [summaryOf(next.island, at), ...list.filter((s) => s.id !== id)]);
    return json(200, { rev: next.rev });
  }

  async function remove(request: Request, id: string): Promise<Response> {
    const kv = kvOf();
    const refused = await limited(kv, request, 'remove');
    if (refused) return refused;
    const record = await owned(kv, request, id);
    if (record instanceof Response) return record;
    await kv.del(keys.island(id));
    await kv.del(keys.mail(id));
    await kv.del(keys.guests(id));
    await updateIndex(kv, (list) => list.filter((s) => s.id !== id));
    return json(200, { ok: true });
  }

  async function postMail(request: Request, id: string): Promise<Response> {
    const body = await readJson(request, SMALL_BODY_LIMIT);
    if (!body.ok) return body.response;
    const v = body.value;
    if (!isRecord(v)) return fail(400, 'bad-request');
    const from = typeof v.from === 'string' ? v.from.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
    const text = typeof v.text === 'string' ? v.text.replace(/\s+/g, ' ').trim() : '';
    const kind = v.kind === 'gift' || v.kind === 'note' ? v.kind : null;
    if (!from || !kind || text.length > 140 || (kind === 'note' && !text)) return fail(400, 'bad-request', { problem: 'from, kind, text' });
    if (kind === 'gift' && !(GIFT_KINDS as unknown[]).includes(v.item)) return fail(400, 'bad-request', { problem: 'item' });
    if (v.fromIsland !== undefined && (typeof v.fromIsland !== 'string' || !ISLAND_ID.test(v.fromIsland))) return fail(400, 'bad-request', { problem: 'fromIsland' });
    const kv = kvOf();
    if (!(await exists(kv, id))) return fail(404, 'not-found');
    const refused = await limited(kv, request, 'mail');
    if (refused) return refused;
    const item: MailItem = { id: newId(), at: now(), from, kind, text };
    if (kind === 'gift') item.item = v.item as MailItem['item'];
    if (typeof v.fromIsland === 'string') item.fromIsland = v.fromIsland;
    const mail = (await kv.get<MailItem[]>(keys.mail(id))) ?? [];
    await kv.set(keys.mail(id), [...mail, item].slice(-MAIL_KEEP));
    return json(201, { id: item.id });
  }

  async function getMail(request: Request, id: string): Promise<Response> {
    const kv = kvOf();
    const record = await owned(kv, request, id);
    if (record instanceof Response) return record;
    return json(200, { mail: (await kv.get<MailItem[]>(keys.mail(id))) ?? [] });
  }

  async function postGuest(request: Request, id: string): Promise<Response> {
    const body = await readJson(request, SMALL_BODY_LIMIT * 2);
    if (!body.ok) return body.response;
    const v = body.value;
    if (!isRecord(v)) return fail(400, 'bad-request');
    const resident = cleanPublicResident(v.resident);
    if (typeof resident === 'string') return fail(400, 'bad-request', { problem: resident });
    const fromName = typeof v.fromName === 'string' ? v.fromName.replace(/\s+/g, ' ').trim().slice(0, 32) : '';
    const fromId = typeof v.fromId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v.fromId) ? v.fromId : '';
    const stayMs = typeof v.stayMs === 'number' && Number.isFinite(v.stayMs) ? Math.min(MAX_STAY, Math.max(MIN_STAY, v.stayMs)) : 0;
    if (!fromName || !fromId || !stayMs) return fail(400, 'bad-request', { problem: 'fromId, fromName, stayMs' });
    const kv = kvOf();
    if (!(await exists(kv, id))) return fail(404, 'not-found');
    const refused = await limited(kv, request, 'guests');
    if (refused) return refused;
    const at = now();
    const guest: Guest = { resident, fromId, fromName, arrivedAt: at, leavesAt: at + stayMs };
    const current = (await guestsOf(kv, id)).filter((g) => !(g.resident.id === resident.id && g.fromId === fromId));
    await kv.set(keys.guests(id), [...current, guest].slice(-GUESTS_MAX), { ex: Math.ceil(MAX_STAY / 1000) });
    return json(201, { leavesAt: guest.leavesAt });
  }

  async function getGuests(id: string): Promise<Response> {
    const kv = kvOf();
    if (!(await exists(kv, id))) return fail(404, 'not-found');
    return json(200, { guests: await guestsOf(kv, id) });
  }

  // ---------------------------------------------------------------- routing

  const route =
    (method: 'GET' | 'POST' | 'PUT' | 'DELETE') =>
    async (request: Request): Promise<Response> => {
      const started = now();
      const { id, part } = addressOf(new URL(request.url, 'http://localhost'));
      let response: Response;
      try {
        response = await dispatch(method, request, id, part);
      } catch (err) {
        response = storageFailure(err) ?? fail(500, 'server');
        if (response.status === 500) log({ at: 'islands', problem: describeError(err) });
      }
      if (method !== 'GET') log({ at: 'islands', method, part: part ?? (id ? 'island' : 'list'), status: response.status, ms: now() - started });
      return response;
    };

  async function dispatch(method: string, request: Request, id: string | null, part: string | null): Promise<Response> {
    if (id !== null && !ISLAND_ID.test(id)) return fail(404, 'not-found');
    if (part !== null && part !== 'mail' && part !== 'guests') return fail(404, 'not-found');
    if (id === null) {
      if (method === 'GET') return list();
      if (method === 'POST') return publish(request);
      return fail(405, 'method');
    }
    if (part === null) {
      if (method === 'GET') return read(id);
      if (method === 'PUT') return demoById.has(id) ? fail(403, 'forbidden') : update(request, id);
      if (method === 'DELETE') return demoById.has(id) ? fail(403, 'forbidden') : remove(request, id);
      return fail(405, 'method');
    }
    if (part === 'mail') {
      if (method === 'POST') return postMail(request, id);
      if (method === 'GET') return demoById.has(id) ? fail(403, 'forbidden') : getMail(request, id);
      return fail(405, 'method');
    }
    if (method === 'POST') return postGuest(request, id);
    if (method === 'GET') return getGuests(id);
    return fail(405, 'method');
  }

  return { GET: route('GET'), POST: route('POST'), PUT: route('PUT'), DELETE: route('DELETE') };
}
