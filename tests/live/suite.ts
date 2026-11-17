/**
 * The same live scenario against any relay: the local fake (client.test.ts) or the
 * deployed one (e2e.test.ts). Two or more Node WebSocket clients join one room and check
 * presence, events, the snapshot, a voice note, a reconnect, the room limit and the end.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { LiveClient, type ClientEvents } from '../../src/live/client';
import { decodePresence, encodePresence, type Presence } from '../../src/live/protocol';

export function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

export async function waitFor(check: () => boolean, ms = 8000, what = 'condition'): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

export function next<K extends keyof ClientEvents>(c: LiveClient, kind: K, ms = 8000): Promise<Parameters<ClientEvents[K]>> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      off();
      reject(new Error(`timed out waiting for ${kind}`));
    }, ms);
    const off = c.on(kind, ((...args: Parameters<ClientEvents[K]>) => {
      clearTimeout(t);
      off();
      resolve(args);
    }) as ClientEvents[K]);
  });
}

const samplePresence = (): Presence => ({
  seq: 7,
  time: 123456,
  slot: 0,
  talking: true,
  immersive: true,
  head: { pos: [0.4, 1.21, -2.5], quat: [0, 0.3826834, 0, 0.9238795] },
  right: {
    wrist: [0.6, 0.95, -2.8],
    quat: [0.1, 0.2, 0.3, 0.9273618],
    tips: [[0.62, 1, -2.9], [0.64, 1.02, -2.95], [0.65, 1.01, -2.96], [0.66, 1, -2.95], [0.67, 0.99, -2.93]],
  },
});

export function liveSuite(label: string, relay: () => string, opts: { timeout?: number } = {}): void {
  const timeout = opts.timeout ?? 20_000;
  describe(label, () => {
    const clients: LiveClient[] = [];
    const make = (name: string, storage = memoryStorage()) => {
      const c = new LiveClient({ relay: relay(), name, storage });
      clients.push(c);
      return c;
    };
    afterEach(() => {
      for (const c of clients.splice(0)) {
        try {
          c.leave();
        } catch {
          /* already off */
        }
        c.dispose();
      }
    });

    const island = () => `test-${Math.random().toString(36).slice(2, 10)}`;

    it('hosts, joins and sees each other', async () => {
      const host = make('Mira');
      const guest = make('Tom');
      const { code } = await host.host(island(), 'Mira');
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
      expect(host.state).toBe('live');
      expect(host.role).toBe('host');
      const seen = next(host, 'peer-join');
      await guest.join(code.toLowerCase().replace(/^(...)/, '$1-'));
      const [peer] = await seen;
      expect(peer.name).toBe('Tom');
      expect(peer.role).toBe('guest');
      expect(guest.role).toBe('guest');
      expect(guest.room?.hostName).toBe('Mira');
      expect([...guest.peers.values()].map((p) => p.name)).toEqual(['Mira']);
      expect(guest.me?.slot).not.toBe(host.me?.slot);
      expect(guest.me?.color).not.toBe(host.me?.color);
    }, timeout);

    it('carries presence, events, the snapshot and a voice note', async () => {
      const host = make('Mira');
      const guest = make('Tom');
      const { code } = await host.host(island());
      await guest.join(code);
      await waitFor(() => host.peers.size === 1, 5000, 'host sees guest');

      const gotPresence = next(guest, 'presence');
      expect(host.sendPresence(encodePresence(samplePresence()))).toBe(true);
      const [p, from] = await gotPresence;
      expect(from.id).toBe(host.id);
      expect(p.slot).toBe(host.me?.slot);
      expect(p.talking).toBe(true);
      expect(p.head.pos[2]).toBeCloseTo(-2.5, 2);
      expect(p.right?.tips?.[4][1]).toBeCloseTo(0.99, 3);
      expect(decodePresence(encodePresence(p))?.right?.wrist[0]).toBeCloseTo(0.6, 3);

      const gotSay = next(host, 'event');
      expect(guest.send('say', { text: 'What a view' })).toBe(true);
      const [kind, data, sayFrom] = await gotSay;
      expect(kind).toBe('say');
      expect(data).toEqual({ text: 'What a view' });
      expect(sayFrom.id).toBe(guest.id);

      // A guest cannot change the island.
      const refused = next(guest, 'error');
      guest.send('house-placed', { spec: { id: 'h1' } });
      expect((await refused)[0]).toBe('not-host');

      const gotHouse = next(guest, 'event');
      host.send('house-placed', { spec: { id: 'h2' } });
      expect((await gotHouse).slice(0, 2)).toEqual(['house-placed', { spec: { id: 'h2' } }]);

      const gotSnap = next(guest, 'snapshot');
      host.sendSnapshot({ id: 'isl', houses: [{ id: 'h2' }] }, guest.id);
      expect((await gotSnap)[0]).toEqual({ id: 'isl', houses: [{ id: 'h2' }] });

      const audio = new Uint8Array(20_000);
      for (let i = 0; i < audio.length; i++) audio[i] = (i * 31 + 7) & 0xff;
      const gotVoice = next(host, 'voice');
      expect(guest.sendVoice(audio, 2300, 'audio/webm;codecs=opus')).toBe(true);
      const [note, voiceFrom] = await gotVoice;
      expect(voiceFrom.id).toBe(guest.id);
      expect(note.durationMs).toBe(2300);
      expect(note.mime).toBe('audio/webm;codecs=opus');
      expect(note.audio.byteLength).toBe(audio.byteLength);
      expect(Buffer.from(note.audio).equals(Buffer.from(audio))).toBe(true);
    }, timeout);

    it('reconnects after a drop with the same place in the room', async () => {
      const host = make('Mira');
      const guest = make('Tom');
      const { code } = await host.host(island());
      await guest.join(code);
      const slot = guest.me?.slot;
      const states: string[] = [];
      guest.on('state', (s) => states.push(s));
      guest.debugDrop();
      expect(guest.state).toBe('connecting');
      await waitFor(() => guest.state === 'live', 15_000, 'guest back');
      expect(states).toEqual(['connecting', 'live']);
      expect(guest.me?.slot).toBe(slot);
      await waitFor(() => host.peers.size === 1, 5000, 'host still sees one guest');
      const gotSay = next(host, 'event');
      guest.send('say', { text: 'back' });
      expect((await gotSay)[1]).toEqual({ text: 'back' });
    }, timeout);

    it('keeps the room at four and ends it when the host leaves', async () => {
      const host = make('Mira');
      const { code } = await host.host(island());
      const guests = [make('A'), make('B'), make('C')];
      for (const g of guests) await g.join(code);
      const fifth = make('E');
      await expect(fifth.join(code)).rejects.toMatchObject({ reason: 'full' });
      expect(fifth.state).toBe('off');
      expect(fifth.reason).toBe('full');
      const ended = next(guests[0], 'ended');
      host.leave();
      expect((await ended)[0]).toBe('host-left');
      await waitFor(() => guests.every((g) => g.state === 'off'), 5000, 'guests off');
      expect(guests[0].reason).toBe('ended');
      // The room is gone with its code.
      const late = make('Late');
      await expect(late.join(code)).rejects.toMatchObject({ reason: 'no-room' });
    }, timeout);

    it('lets the host come back to the same room after a reload', async () => {
      const storage = memoryStorage();
      const name = island();
      const first = make('Mira', storage);
      const { code } = await first.host(name);
      const guest = make('Tom');
      await guest.join(code);
      first.debugDrop();
      first.dispose();
      const again = make('Mira', storage);
      const second = await again.host(name);
      expect(second.code).toBe(code);
      expect(again.role).toBe('host');
      await waitFor(() => again.peers.size === 1, 5000, 'host sees the guest again');
    }, timeout);

    it('refuses a wrong code', async () => {
      const c = make('Tom');
      await expect(c.join('ZZZZZZ')).rejects.toMatchObject({ reason: 'no-room' });
      await expect(c.join('not a code')).rejects.toMatchObject({ reason: 'bad-code' });
    }, timeout);
  });
}
