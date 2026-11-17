import { describe, expect, it } from 'vitest';
import { RoomCore, newAtt, type Meta, type Sock } from '../../relay/src/room-core';
import { CLOSE, LIMITS, ROOM_TIMES, encodePresence, encodeVoice, type RelayMsg } from '../../src/live/protocol';

class FakeSock implements Sock {
  att = newAtt(0);
  sent: (string | Uint8Array)[] = [];
  closedWith: number | null = null;
  ping = 0;
  open = true;
  save(): void {}
  send(d: string | Uint8Array): void {
    if (this.open) this.sent.push(typeof d === 'string' ? d : d.slice());
  }
  close(code: number): void {
    this.closedWith = code;
    this.open = false;
  }
  lastPing(): number {
    return this.ping;
  }
  msgs(): RelayMsg[] {
    return this.sent.filter((s): s is string => typeof s === 'string' && s !== 'pong').map((s) => JSON.parse(s) as RelayMsg);
  }
  last(): RelayMsg | undefined {
    return this.msgs().at(-1);
  }
}

function room() {
  const socks: FakeSock[] = [];
  const saved: (Meta | null)[] = [];
  let alarm = 0;
  const core = new RoomCore(null, {
    sockets: () => socks.filter((s) => s.open),
    saveMeta: (m) => saved.push(m ? { ...m } : null),
    setAlarm: (at) => {
      alarm = at;
    },
  });
  core.init({ code: 'ABCDEF', island: 'isl1', key: 'secret-key', hostName: 'Mira' }, 0);
  const connect = (now = 0) => {
    const s = new FakeSock();
    socks.push(s);
    core.open(s, now);
    return s;
  };
  const hello = (s: FakeSock, pid: string, extra: Record<string, unknown> = {}, now = 0) =>
    core.message(s, JSON.stringify({ t: 'hi', v: 1, pid, psk: `${pid}psk`, name: pid, ...extra }), now);
  return { core, socks, saved, connect, hello, alarm: () => alarm };
}

describe('room admission', () => {
  it('makes the key holder the host and others guests', () => {
    const r = room();
    const h = r.connect();
    r.hello(h, 'hostpeer1', { key: 'secret-key', color: '#3f9e98' });
    expect(h.last()).toMatchObject({ t: 'welcome', you: { role: 'host', slot: 1, color: '#3f9e98' }, room: { island: 'isl1', hostName: 'hostpeer1' } });
    const g = r.connect();
    r.hello(g, 'guestpeer1', { color: '#3f9e98' });
    const w = g.last();
    expect(w).toMatchObject({ t: 'welcome', you: { role: 'guest', slot: 2 }, peers: [{ id: 'hostpeer1' }] });
    // The colour was taken: the guest gets another one.
    expect(w && w.t === 'welcome' && w.you.color).not.toBe('#3f9e98');
    expect(h.last()).toMatchObject({ t: 'join', p: { id: 'guestpeer1' } });
  });

  it('refuses a wrong key, a missing hello and a stolen id', () => {
    const r = room();
    const a = r.connect();
    r.hello(a, 'peerpeer1', { key: 'nope' });
    expect(a.closedWith).toBe(CLOSE.badKey);
    const b = r.connect();
    r.core.message(b, encodePresence({ seq: 1, time: 1, slot: 0, talking: false, immersive: false, head: { pos: [0, 0, 0], quat: [0, 0, 0, 1] } }), 0);
    expect(b.closedWith).toBe(CLOSE.badRequest);
    const c = r.connect();
    r.hello(c, 'peerpeer2');
    const d = r.connect();
    r.core.message(d, JSON.stringify({ t: 'hi', v: 1, pid: 'peerpeer2', psk: 'otherpsk11', name: 'x' }), 0);
    expect(d.closedWith).toBe(CLOSE.badRequest);
    expect(c.open).toBe(true);
  });

  it('keeps a place for the host when guests fill the room', () => {
    const r = room();
    const guests = ['guest0001', 'guest0002', 'guest0003'].map((id) => {
      const s = r.connect();
      r.hello(s, id);
      return s;
    });
    expect(guests.every((g) => g.open)).toBe(true);
    const fourth = r.connect();
    r.hello(fourth, 'guest0004');
    expect(fourth.closedWith).toBe(CLOSE.full);
    const h = r.connect();
    r.hello(h, 'hostpeer1', { key: 'secret-key' });
    expect(h.last()).toMatchObject({ t: 'welcome', you: { role: 'host', slot: 4 } });
  });

  it('resumes the same peer in the same slot and drops the old socket quietly', () => {
    const r = room();
    const h = r.connect();
    r.hello(h, 'hostpeer1', { key: 'secret-key' });
    const g1 = r.connect();
    r.hello(g1, 'guestpeer1');
    const slot = (g1.last() as Extract<RelayMsg, { t: 'welcome' }>).you.slot;
    h.sent.length = 0;
    const g2 = r.connect();
    r.hello(g2, 'guestpeer1');
    expect(g1.closedWith).toBe(CLOSE.replaced);
    expect(g2.last()).toMatchObject({ t: 'welcome', you: { slot }, resumed: true });
    expect(h.msgs().map((m) => m.t)).toEqual(['join']);
  });
});

describe('room traffic', () => {
  function pair() {
    const r = room();
    const h = r.connect();
    r.hello(h, 'hostpeer1', { key: 'secret-key' });
    const g = r.connect();
    r.hello(g, 'guestpeer1');
    h.sent.length = 0;
    g.sent.length = 0;
    return { r, h, g };
  }

  it('stamps the sender slot on presence and voice', () => {
    const { r, h, g } = pair();
    r.core.message(h, encodePresence({ seq: 1, time: 1, slot: 0, talking: false, immersive: false, head: { pos: [0, 1, 0], quat: [0, 0, 0, 1] } }), 10);
    const frame = g.sent[0] as Uint8Array;
    expect(frame[0]).toBe(1);
    expect(frame[1]).toBe(1);
    r.core.message(g, encodeVoice(1, 900, 'audio/webm', new Uint8Array(100)), 20);
    expect((h.sent[0] as Uint8Array)[1]).toBe(2);
    expect(g.sent).toHaveLength(1);
  });

  it('lets only the host change the island and send snapshots', () => {
    const { r, h, g } = pair();
    r.core.message(g, JSON.stringify({ t: 'ev', k: 'house-placed', d: {} }), 0);
    expect(h.sent).toHaveLength(0);
    expect(g.last()).toMatchObject({ t: 'err', code: 'not-host' });
    r.core.message(g, JSON.stringify({ t: 'snap', d: {}, to: '*' }), 0);
    expect(h.sent).toHaveLength(0);
    r.core.message(h, JSON.stringify({ t: 'snap', d: { id: 'isl1' }, to: 'guestpeer1' }), 0);
    expect(g.last()).toEqual({ t: 'snap', d: { id: 'isl1' }, f: 'hostpeer1' });
    r.core.message(g, JSON.stringify({ t: 'ev', k: 'say', d: { text: 'hi' }, to: 'hostpeer1' }), 0);
    expect(h.last()).toEqual({ t: 'ev', k: 'say', d: { text: 'hi' }, f: 'guestpeer1' });
  });

  it('drops floods and closes a socket that keeps flooding', () => {
    const { r, h, g } = pair();
    const ev = JSON.stringify({ t: 'ev', k: 'say', d: { text: 'x' } });
    for (let i = 0; i < 40; i++) r.core.message(g, ev, 1000);
    expect(h.sent.length).toBe(LIMITS.rates.text.burst);
    expect(g.msgs().filter((m) => m.t === 'err').length).toBe(40 - LIMITS.rates.text.burst);
    for (let i = 0; i < LIMITS.strikes + 5 && g.open; i++) r.core.message(g, ev, 1000);
    expect(g.closedWith).toBe(CLOSE.abuse);
    expect(h.last()).toEqual({ t: 'left', id: 'guestpeer1', why: 'lost' });
  });

  it('refuses oversized text', () => {
    const { r, g } = pair();
    r.core.message(g, JSON.stringify({ t: 'ev', k: 'say', d: { text: 'x'.repeat(LIMITS.textBytes) } }), 0);
    expect(g.last()).toMatchObject({ t: 'err', code: 'too-big' });
    r.core.message(g, 'x'.repeat(LIMITS.snapshotBytes + 1), 0);
    expect(g.closedWith).toBe(CLOSE.abuse);
  });

  it('ends the room for everyone when the host says bye', () => {
    const { r, h, g } = pair();
    r.core.message(h, JSON.stringify({ t: 'bye' }), 0);
    expect(g.last()).toEqual({ t: 'ended', why: 'host-left' });
    expect(g.closedWith).toBe(CLOSE.ended);
    expect(h.closedWith).toBe(CLOSE.normal);
    expect(r.core.meta).toBeNull();
    expect(r.saved.at(-1)).toBeNull();
  });
});

describe('room lifetime', () => {
  it('forgets a room nobody entered', () => {
    const r = room();
    r.core.alarm(ROOM_TIMES.unclaimed + 1);
    expect(r.core.meta).toBeNull();
  });

  it('closes silent sockets and sends guests home when the host stays away', () => {
    const r = room();
    const h = r.connect();
    r.hello(h, 'hostpeer1', { key: 'secret-key' });
    const g = r.connect();
    r.hello(g, 'guestpeer1');
    let now = 60_000;
    g.ping = now;
    r.core.alarm(now);
    expect(h.open && g.open).toBe(true);
    now = ROOM_TIMES.silent + 70_000;
    g.ping = now;
    r.core.alarm(now);
    expect(h.closedWith).toBe(CLOSE.timeout);
    expect(g.last()).toEqual({ t: 'left', id: 'hostpeer1', why: 'lost' });
    expect(r.core.meta?.hostAwaySince).toBe(now);
    now += ROOM_TIMES.hostAway + 1;
    g.ping = now;
    g.att.seen = now;
    r.core.alarm(now);
    expect(g.last()).toEqual({ t: 'ended', why: 'host-gone' });
    expect(g.closedWith).toBe(CLOSE.hostGone);
    expect(r.core.meta).toBeNull();
  });

  it('keeps an empty room for the host to come back, then forgets it', () => {
    const r = room();
    const h = r.connect();
    r.hello(h, 'hostpeer1', { key: 'secret-key' });
    h.open = false;
    r.core.closed(h, 1000);
    expect(r.core.meta?.emptySince).toBe(1000);
    r.core.alarm(1000 + ROOM_TIMES.empty - 1);
    expect(r.core.meta).not.toBeNull();
    const back = r.connect(1000 + ROOM_TIMES.empty - 1);
    r.hello(back, 'hostpeer1', { key: 'secret-key' }, 1000 + ROOM_TIMES.empty - 1);
    expect(back.last()).toMatchObject({ t: 'welcome', you: { role: 'host' } });
    expect(r.core.meta?.emptySince).toBeUndefined();
    back.open = false;
    r.core.closed(back, 5_000_000);
    r.core.alarm(5_000_000 + ROOM_TIMES.empty + 1);
    expect(r.core.meta).toBeNull();
  });

  it('closes a socket that never says hello', () => {
    const r = room();
    const s = r.connect(0);
    r.core.alarm(ROOM_TIMES.hello + 1);
    expect(s.closedWith).toBe(CLOSE.timeout);
  });
});
