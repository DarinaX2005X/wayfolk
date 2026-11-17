/**
 * The client of /api/islands (api/_lib/islands.ts). Every call has a deadline and
 * resolves with a plain result. Reading the horizon or a demo island falls back to the
 * demo islands bundled with the app, so the horizon is never empty offline.
 */
import type { Guest, GuestBody, MailBody, PublicIsland, PublishAnswer, ReadIslandAnswer } from '../../api/_lib/contracts';
import { cleanGuest, cleanPublicIsland, summaryOf } from './check';
import { DEMO_ISLANDS } from './demo';
import type { IslandSummary, MailItem } from './types';

export type NetResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

export type IslandsClient = ReturnType<typeof createIslandsClient>;

export function createIslandsClient(options: { api: string; fetch: typeof fetch }) {
  const base = `${options.api}/api/islands`;
  const doFetch = options.fetch;

  async function request<T>(path: string, init: RequestInit & { ownerKey?: string } = {}, timeoutMs = 8000): Promise<NetResult<T>> {
    const headers: Record<string, string> = { ...(init.body ? { 'content-type': 'application/json' } : {}) };
    if (init.ownerKey) headers['x-owner-key'] = init.ownerKey;
    try {
      const response = await doFetch(base + path, { ...init, headers, signal: AbortSignal.timeout(timeoutMs) });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || !body) return { ok: false, status: response.status, error: typeof body?.error === 'string' ? body.error : 'server-off' };
      return { ok: true, value: body as T };
    } catch {
      return { ok: false, status: 0, error: 'server-off' };
    }
  }

  const demoSummaries = (): IslandSummary[] => DEMO_ISLANDS.map((d) => summaryOf(d.island, d.island.createdAt, true));

  return {
    async list(): Promise<IslandSummary[]> {
      const r = await request<{ islands: IslandSummary[] }>('');
      if (!r.ok || !Array.isArray(r.value.islands)) return demoSummaries();
      return r.value.islands;
    },
    async read(id: string): Promise<NetResult<{ island: PublicIsland; guests: Guest[]; demo: boolean }>> {
      const r = await request<ReadIslandAnswer>(`/${encodeURIComponent(id)}`);
      if (!r.ok) {
        const demo = DEMO_ISLANDS.find((d) => d.id === id);
        return demo ? { ok: true, value: { island: demo.island, guests: [], demo: true } } : r;
      }
      const island = cleanPublicIsland(r.value.island);
      if (typeof island === 'string') return { ok: false, status: 502, error: 'bad-island' };
      const guests = (Array.isArray(r.value.guests) ? r.value.guests : []).map(cleanGuest).filter((g): g is Guest => typeof g !== 'string');
      return { ok: true, value: { island: { ...island, id }, guests, demo: r.value.demo === true } };
    },
    publish(island: PublicIsland): Promise<NetResult<PublishAnswer>> {
      return request<PublishAnswer>('', { method: 'POST', body: JSON.stringify({ island }) });
    },
    update(id: string, ownerKey: string, island: PublicIsland): Promise<NetResult<{ rev: number }>> {
      return request(`/${id}`, { method: 'PUT', body: JSON.stringify({ island }), ownerKey });
    },
    remove(id: string, ownerKey: string): Promise<NetResult<{ ok: true }>> {
      return request(`/${id}`, { method: 'DELETE', ownerKey });
    },
    sendMail(id: string, mail: MailBody): Promise<NetResult<{ id: string }>> {
      return request(`/${encodeURIComponent(id)}/mail`, { method: 'POST', body: JSON.stringify(mail) });
    },
    async readMail(id: string, ownerKey: string): Promise<MailItem[] | null> {
      const r = await request<{ mail: MailItem[] }>(`/${id}/mail`, { ownerKey }, 5000);
      return r.ok && Array.isArray(r.value.mail) ? r.value.mail : null;
    },
    sendGuest(id: string, guest: GuestBody): Promise<NetResult<{ leavesAt: number }>> {
      return request(`/${encodeURIComponent(id)}/guests`, { method: 'POST', body: JSON.stringify(guest) });
    },
    async guests(id: string): Promise<Guest[] | null> {
      const r = await request<{ guests: Guest[] }>(`/${encodeURIComponent(id)}/guests`, {}, 5000);
      if (!r.ok || !Array.isArray(r.value.guests)) return null;
      return r.value.guests.map(cleanGuest).filter((g): g is Guest => typeof g !== 'string');
    },
  };
}
