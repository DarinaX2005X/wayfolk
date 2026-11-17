/**
 * /api/islands: publish, list, read, republish, mailbox, visiting residents, limits.
 */
import { describe, expect, it } from 'vitest';
import { createIslandRoutes, RATE } from '../../api/_lib/islands';
import { createMemoryKv } from '../../api/_lib/kv';
import { publicSnapshot } from '../../src/mind/check';
import { DEMO_ISLANDS } from '../../src/mind/demo';
import { newIsland } from '../../src/mind/index';
import { PREPARED } from '../../src/mind/prepared';
import { clock, seeded } from './helpers';

const BASE = 'https://w.test/api/islands';

function setup() {
  const time = clock();
  const kv = createMemoryKv({ now: time.now });
  const routes = createIslandRoutes({ kv: () => kv, now: time.now, log: () => undefined });
  const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path = '', body?: unknown, headers: Record<string, string> = {}, ip = '10.1.1.1') => {
    const request = new Request(BASE + path, {
      method,
      headers: { 'x-real-ip': ip, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const response = await routes[method](request);
    return { status: response.status, body: (await response.json()) as any, headers: response.headers };
  };
  return { time, kv, call };
}

function island() {
  const state = newIsland(Date.now(), seeded(3), 'Moss Hollow');
  const r = { ...structuredClone(PREPARED[0]), houseId: 'h-1', memory: [{ at: 1, text: 'The person likes rain.' }] };
  state.residents = [r];
  state.houses = [{ id: 'h-1', residentId: r.id, recipe: r.trade, pos: { x: 3, z: -2 }, rotY: 0.5, colors: { wall: '#ffffff', roof: '#aa3300', trim: '#222222' }, props: ['lantern'], builtAt: 1 }];
  state.paths = [['h-1', 'seat']];
  return publicSnapshot(state);
}

describe('/api/islands', () => {
  it('lists the demo islands even before anything is published', async () => {
    const { call } = setup();
    const list = await call('GET');
    expect(list.status).toBe(200);
    expect(list.body.islands.map((s: { id: string }) => s.id)).toEqual(DEMO_ISLANDS.map((d) => d.id));
    expect(list.body.islands[0]).toMatchObject({ demo: true, residents: 3, houses: 3 });
    const read = await call('GET', `/${DEMO_ISLANDS[0].id}`);
    expect(read.status).toBe(200);
    expect(read.body.island.residents.length).toBe(3);
    expect(read.body.demo).toBe(true);
  });

  it('publishes with an unguessable id and an owner key, strips private memory, and lists it', async () => {
    const { call, kv } = setup();
    const pub = await call('POST', '', { island: island() });
    expect(pub.status).toBe(201);
    expect(pub.body.id).toMatch(/^[a-z2-9]{10}$/);
    expect(pub.body.ownerKey.length).toBeGreaterThanOrEqual(30);
    const stored = (await kv.get<any>(`isl:${pub.body.id}`))!;
    expect(JSON.stringify(stored)).not.toContain(pub.body.ownerKey);
    const read = await call('GET', `/${pub.body.id}`);
    expect(read.body.island.name).toBe('Moss Hollow');
    expect(read.body.island.residents[0].memory).toBeUndefined();
    const list = await call('GET');
    expect(list.body.islands.some((s: { id: string }) => s.id === pub.body.id)).toBe(true);
  });

  it('lets only the owner republish or unpublish, and refuses demo islands', async () => {
    const { call } = setup();
    const pub = await call('POST', '', { island: island() });
    const changed = { ...island(), name: 'Moss Hollow Two' };
    expect((await call('PUT', `/${pub.body.id}`, { island: changed }, { 'x-owner-key': 'wrong' })).status).toBe(403);
    const ok = await call('PUT', `/${pub.body.id}`, { island: changed }, { 'x-owner-key': pub.body.ownerKey });
    expect(ok.body).toEqual({ rev: 2 });
    expect((await call('GET', `/${pub.body.id}`)).body.island.name).toBe('Moss Hollow Two');
    expect((await call('PUT', `/${DEMO_ISLANDS[0].id}`, { island: changed }, { 'x-owner-key': 'x' })).status).toBe(403);
    expect((await call('DELETE', `/${pub.body.id}`, undefined, { 'x-owner-key': pub.body.ownerKey })).status).toBe(200);
    expect((await call('GET', `/${pub.body.id}`)).status).toBe(404);
  });

  it('refuses a malformed or oversized island', async () => {
    const { call } = setup();
    expect((await call('POST', '', { island: { ...island(), residents: [{ name: 'x' }] } })).status).toBe(400);
    expect((await call('POST', '', { island: { ...island(), name: '' } })).status).toBe(400);
    expect((await call('POST', '', 'not json')).status).toBe(400);
    const big = island();
    big.name = 'x'.repeat(30);
    (big as any).padding = 'y'.repeat(100 * 1024);
    expect((await call('POST', '', { island: big })).status).toBe(413);
  });

  it('takes gifts and notes in the mailbox, readable only by the owner', async () => {
    const { call } = setup();
    const pub = await call('POST', '', { island: island() });
    const id = pub.body.id;
    expect((await call('POST', `/${id}/mail`, { from: 'Ada', kind: 'gift', item: 'star', text: 'For your lighthouse' })).status).toBe(201);
    expect((await call('POST', `/${id}/mail`, { from: 'Ada', kind: 'note', text: 'Lovely island' })).status).toBe(201);
    expect((await call('POST', `/${id}/mail`, { from: 'Ada', kind: 'gift', item: 'dragon', text: '' })).status).toBe(400);
    expect((await call('POST', `/${id}/mail`, { from: 'Ada', kind: 'note', text: 'z'.repeat(141) })).status).toBe(400);
    expect((await call('POST', `/nosuchisland/mail`, { from: 'Ada', kind: 'note', text: 'hi' })).status).toBe(404);
    expect((await call('GET', `/${id}/mail`)).status).toBe(403);
    const mail = await call('GET', `/${id}/mail`, undefined, { 'x-owner-key': pub.body.ownerKey });
    expect(mail.body.mail.map((m: { kind: string }) => m.kind)).toEqual(['gift', 'note']);
    expect(mail.body.mail[0]).toMatchObject({ from: 'Ada', item: 'star' });
    // A demo island takes mail too (the horizon is for visiting).
    expect((await call('POST', `/${DEMO_ISLANDS[1].id}/mail`, { from: 'Ada', kind: 'note', text: 'hello' })).status).toBe(201);
  });

  it('delivers visiting residents for a while, then lets them go home', async () => {
    const { call, time } = setup();
    const guest = { ...structuredClone(PREPARED[1]), memory: undefined };
    const sent = await call('POST', `/${DEMO_ISLANDS[0].id}/guests`, { resident: guest, fromId: 'abcdefghjk', fromName: 'Moss Hollow', stayMs: 5 * 60_000 });
    expect(sent.status).toBe(201);
    let read = await call('GET', `/${DEMO_ISLANDS[0].id}`);
    expect(read.body.guests.map((g: any) => g.resident.name)).toEqual([guest.name]);
    expect(read.body.guests[0].fromName).toBe('Moss Hollow');
    time.advance(6 * 60_000);
    read = await call('GET', `/${DEMO_ISLANDS[0].id}/guests`);
    expect(read.body.guests).toEqual([]);
    expect((await call('POST', `/${DEMO_ISLANDS[0].id}/guests`, { resident: { name: 'x' }, fromId: 'a', fromName: 'b', stayMs: 1 })).status).toBe(400);
  });

  it('limits publishing per address and day, and answers the query form of addresses', async () => {
    const { call } = setup();
    for (let i = 0; i < RATE.publish; i += 1) expect((await call('POST', '', { island: island() }, {}, '10.9.9.9')).status).toBe(201);
    expect((await call('POST', '', { island: island() }, {}, '10.9.9.9')).status).toBe(429);
    expect((await call('POST', '', { island: island() }, {}, '10.9.9.8')).status).toBe(201);
    const q = await call('GET', `?id=${DEMO_ISLANDS[2].id}&part=guests`);
    expect(q.status).toBe(200);
    expect(q.body.guests).toEqual([]);
    expect((await call('GET', '/UPPER-case')).status).toBe(404);
    expect((await call('GET', `/${DEMO_ISLANDS[0].id}/nothing`)).status).toBe(404);
  });
});
