/**
 * The logic of one live room, independent of the platform: the Durable Object in
 * worker.ts runs it on Cloudflare, tests/live/fake-relay.ts runs it on a Node WebSocket
 * server for offline tests. Everything about admission, roles, limits and forwarding
 * lives here; the host only adapts sockets, storage and alarms.
 *
 * A room belongs to one hosting of one island. The host holds the room key (given once
 * when the room is created); guests need only the code. The host is authoritative: it
 * sends the island snapshot to each guest that joins and is the only one who may send
 * events that change the island.
 */
import {
  CLOSE,
  HOST_ONLY_EVENTS,
  LIMITS,
  PEER_COLORS,
  PROTOCOL_VERSION,
  ROOM_SIZE,
  ROOM_TIMES,
  Bucket,
  frameKind,
  parseClientMsg,
  utf8Length,
  type PeerInfo,
  type RelayMsg,
  type Role,
} from '../../src/live/protocol';

/** What the room remembers about a socket; survives hibernation as its attachment. */
export interface Att {
  /** Peer id, '' until the socket says hello. */
  id: string;
  psk: string;
  slot: number;
  name: string;
  color: string;
  /** null until admitted, and again once replaced or gone. */
  role: Role | null;
  opened: number;
  /** Last real message, coarse (updated at most every 30 s). */
  seen: number;
}

export interface Sock {
  att: Att;
  /** Persists `att` (serializeAttachment on Cloudflare). */
  save(): void;
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
  /** ms of the last 'ping' the platform answered without waking the room, 0 if none. */
  lastPing(): number;
}

export interface Meta {
  code: string;
  island: string;
  key: string;
  hostName: string;
  createdAt: number;
  claimed: boolean;
  emptySince?: number;
  hostAwaySince?: number;
}

export interface RoomEnv {
  /** Every open socket of this room. */
  sockets(): Sock[];
  /** Stores the room record; null forgets the room entirely. */
  saveMeta(meta: Meta | null): void;
  setAlarm(at: number): void;
}

interface Limits {
  presence: Bucket;
  text: Bucket;
  voice: Bucket;
  snapshot: Bucket;
  strikes: number;
}

export function newAtt(now: number): Att {
  return { id: '', psk: '', slot: 0, name: '', color: '', role: null, opened: now, seen: now };
}

export function info(a: Att): PeerInfo {
  return { id: a.id, slot: a.slot, name: a.name, color: a.color, role: a.role ?? 'guest' };
}

export class RoomCore {
  private limits = new WeakMap<Sock, Limits>();

  constructor(public meta: Meta | null, private readonly env: RoomEnv) {}

  /** Creates the room record. False when the code already belongs to a live room. */
  init(m: { code: string; island: string; key: string; hostName: string }, now: number): boolean {
    if (this.meta) return false;
    this.meta = { ...m, createdAt: now, claimed: false };
    this.env.saveMeta(this.meta);
    this.env.setAlarm(now + ROOM_TIMES.unclaimed);
    return true;
  }

  peek(): { open: boolean; island?: string; hostName?: string; peers: number; hostOnline: boolean } {
    if (!this.meta) return { open: false, peers: 0, hostOnline: false };
    const peers = this.admitted();
    return { open: true, island: this.meta.island, hostName: this.meta.hostName, peers: peers.length, hostOnline: peers.some((s) => s.att.role === 'host') };
  }

  /** A socket was accepted for this room. */
  open(sock: Sock, now: number): void {
    if (!this.meta) {
      sock.close(CLOSE.noRoom, 'no-room');
      return;
    }
    sock.att = newAtt(now);
    sock.save();
    this.env.setAlarm(now + ROOM_TIMES.hello + 1000);
  }

  message(sock: Sock, data: string | ArrayBuffer | Uint8Array, now: number): void {
    const a = sock.att;
    if (typeof data === 'string') {
      if (data === 'ping') {
        sock.send('pong');
        return;
      }
      this.text(sock, data, now);
    } else {
      if (!a.role) return this.reject(sock, CLOSE.badRequest, 'hello-first');
      this.binary(sock, data instanceof Uint8Array ? data : new Uint8Array(data), now);
    }
    if (a.role && now - a.seen > 30_000) {
      a.seen = now;
      sock.save();
    }
  }

  /** A socket closed (by its peer, by an error, or by us). */
  closed(sock: Sock, now: number): void {
    const a = sock.att;
    if (!a || !a.role || !this.meta) return;
    const wasHost = a.role === 'host';
    a.role = null;
    this.broadcast({ t: 'left', id: a.id, why: 'lost' }, sock);
    this.settle(now, sock, wasHost);
  }

  alarm(now: number): void {
    const meta = this.meta;
    if (!meta) return;
    for (const s of this.env.sockets()) {
      const a = s.att;
      if (!a) continue;
      if (!a.role && now - a.opened > ROOM_TIMES.hello) s.close(CLOSE.timeout, 'hello-timeout');
      else if (a.role && now - Math.max(a.seen, s.lastPing()) > ROOM_TIMES.silent) {
        const wasHost = a.role === 'host';
        a.role = null;
        s.close(CLOSE.timeout, 'silent');
        this.broadcast({ t: 'left', id: a.id, why: 'lost' }, s);
        this.settle(now, s, wasHost);
        if (!this.meta) return;
      }
    }
    const peers = this.admitted();
    if (peers.length === 0) {
      const limit = meta.claimed ? (meta.emptySince ?? now) + ROOM_TIMES.empty : meta.createdAt + ROOM_TIMES.unclaimed;
      if (now >= limit) return this.forget();
      if (meta.claimed && meta.emptySince === undefined) {
        meta.emptySince = now;
        this.env.saveMeta(meta);
      }
      this.env.setAlarm(Math.min(limit, now + ROOM_TIMES.check));
      return;
    }
    const lastReal = Math.max(...peers.map((s) => s.att.seen));
    if (now - lastReal > ROOM_TIMES.idle) return this.end('idle', CLOSE.idle);
    if (!peers.some((s) => s.att.role === 'host')) {
      if (meta.hostAwaySince === undefined) {
        meta.hostAwaySince = now;
        this.env.saveMeta(meta);
      } else if (now - meta.hostAwaySince > ROOM_TIMES.hostAway) {
        return this.end('host-gone', CLOSE.hostGone);
      }
    }
    this.env.setAlarm(now + ROOM_TIMES.check);
  }

  // -------------------------------------------------------------------------------------

  private admitted(except?: Sock): Sock[] {
    return this.env.sockets().filter((s) => s !== except && s.att?.role);
  }

  private text(sock: Sock, text: string, now: number): void {
    const a = sock.att;
    if (text.length > LIMITS.snapshotBytes || utf8Length(text) > LIMITS.snapshotBytes) return this.reject(sock, CLOSE.abuse, 'too-big');
    const msg = parseClientMsg(text);
    if (!msg) return a.role ? this.drop(sock, 'bad') : this.reject(sock, CLOSE.badRequest, 'bad-hello');
    if (!a.role) {
      if (msg.t !== 'hi') return this.reject(sock, CLOSE.badRequest, 'hello-first');
      return this.hello(sock, msg, now);
    }
    const lim = this.limitsOf(sock, now);
    if (msg.t === 'snap') {
      if (a.role !== 'host') return this.drop(sock, 'not-host', 'snap');
      if (!lim.snapshot.take(now)) return this.drop(sock, 'rate', 'snap');
      const out = JSON.stringify({ t: 'snap', d: msg.d, f: a.id });
      for (const s of this.admitted(sock)) if (msg.to === '*' ? s.att.role === 'guest' : s.att.id === msg.to) s.send(out);
      return;
    }
    if (utf8Length(text) > LIMITS.textBytes) return this.drop(sock, 'too-big', msg.t);
    if (!lim.text.take(now)) return this.drop(sock, 'rate', msg.t);
    switch (msg.t) {
      case 'hi':
        return this.drop(sock, 'bad', 'hi');
      case 'ev': {
        if (a.role !== 'host' && HOST_ONLY_EVENTS.includes(msg.k)) return this.drop(sock, 'not-host', msg.k);
        const out = JSON.stringify({ t: 'ev', k: msg.k, d: msg.d, f: a.id });
        if (msg.to) {
          const to = this.admitted(sock).find((s) => s.att.id === msg.to);
          if (!to) return this.drop(sock, 'no-peer', msg.k);
          to.send(out);
        } else {
          for (const s of this.admitted(sock)) s.send(out);
        }
        return;
      }
      case 'me': {
        if (msg.name) a.name = msg.name;
        if (msg.color && !this.admitted(sock).some((s) => s.att.color === msg.color)) a.color = msg.color;
        sock.save();
        this.broadcast({ t: 'me', p: info(a) });
        return;
      }
      case 'bye': {
        if (a.role === 'host') return this.end('host-left', CLOSE.ended, sock);
        a.role = null;
        this.broadcast({ t: 'left', id: a.id, why: 'bye' }, sock);
        sock.close(CLOSE.normal, 'bye');
        this.settle(now, sock, false);
        return;
      }
    }
  }

  private hello(sock: Sock, hi: Extract<ReturnType<typeof parseClientMsg>, { t: 'hi' }>, now: number): void {
    const meta = this.meta;
    if (!meta) return this.reject(sock, CLOSE.noRoom, 'no-room');
    if (hi.v !== PROTOCOL_VERSION) return this.reject(sock, CLOSE.badRequest, 'version');
    let role: Role = 'guest';
    if (hi.key !== undefined) {
      if (hi.key !== meta.key) return this.reject(sock, CLOSE.badKey, 'bad-key');
      role = 'host';
    }
    const others = this.admitted(sock);
    const same = others.find((s) => s.att.id === hi.pid);
    if (same && same.att.psk !== hi.psk) return this.reject(sock, CLOSE.badRequest, 'id-taken');
    const rest = others.filter((s) => s !== same);
    let replacedHost: Sock | undefined;
    if (role === 'host') {
      replacedHost = rest.find((s) => s.att.role === 'host');
    } else if (rest.filter((s) => s.att.role === 'guest').length >= ROOM_SIZE - 1) {
      return this.reject(sock, CLOSE.full, 'full');
    }
    const stay = rest.filter((s) => s !== replacedHost);
    const usedSlots = new Set(stay.map((s) => s.att.slot));
    let slot = same?.att.slot ?? replacedHost?.att.slot ?? 0;
    if (!slot || usedSlots.has(slot)) {
      slot = 1;
      while (usedSlots.has(slot)) slot++;
    }
    const usedColors = new Set(stay.map((s) => s.att.color));
    const color = hi.color && !usedColors.has(hi.color) ? hi.color : (PEER_COLORS.find((c) => !usedColors.has(c)) ?? PEER_COLORS[(slot - 1) % PEER_COLORS.length]);

    for (const old of [same, replacedHost]) {
      if (!old) continue;
      const oldId = old.att.id;
      old.att.role = null;
      old.close(CLOSE.replaced, 'replaced');
      if (oldId !== hi.pid) this.broadcast({ t: 'left', id: oldId, why: 'lost' }, old);
    }

    sock.att = { id: hi.pid, psk: hi.psk, slot, name: hi.name, color, role, opened: sock.att?.opened ?? now, seen: now };
    sock.save();
    const you = info(sock.att);
    const hostName = role === 'host' ? hi.name : meta.hostName;
    let changed = false;
    if (!meta.claimed || meta.emptySince !== undefined) {
      meta.claimed = true;
      meta.emptySince = undefined;
      changed = true;
    }
    if (role === 'host' && (meta.hostAwaySince !== undefined || meta.hostName !== hostName)) {
      meta.hostAwaySince = undefined;
      meta.hostName = hostName;
      changed = true;
    }
    if (changed) this.env.saveMeta(meta);
    sock.send(JSON.stringify({
      t: 'welcome',
      you,
      room: { code: meta.code, island: meta.island, hostName: meta.hostName },
      peers: stay.map((s) => info(s.att)),
      resumed: Boolean(same),
    } satisfies RelayMsg));
    this.broadcast({ t: 'join', p: you, resumed: Boolean(same) }, sock);
    this.env.setAlarm(now + ROOM_TIMES.check);
  }

  private binary(sock: Sock, buf: Uint8Array, now: number): void {
    const kind = frameKind(buf);
    if (!kind) return this.drop(sock, 'bad', 'frame');
    const lim = this.limitsOf(sock, now);
    if (!(kind === 'presence' ? lim.presence : lim.voice).take(now)) return this.drop(sock, 'rate', kind);
    buf[1] = sock.att.slot;
    for (const s of this.admitted(sock)) s.send(buf);
  }

  private limitsOf(sock: Sock, now: number): Limits {
    let l = this.limits.get(sock);
    if (!l) {
      const r = LIMITS.rates;
      l = {
        presence: new Bucket(r.presence.rate, r.presence.burst, now),
        text: new Bucket(r.text.rate, r.text.burst, now),
        voice: new Bucket(r.voice.rate, r.voice.burst, now),
        snapshot: new Bucket(r.snapshot.rate, r.snapshot.burst, now),
        strikes: 0,
      };
      this.limits.set(sock, l);
    }
    return l;
  }

  /** Drops one message and tells the sender why; too many drops close the socket. */
  private drop(sock: Sock, code: 'rate' | 'too-big' | 'not-host' | 'bad' | 'no-peer', about?: string): void {
    const l = this.limits.get(sock);
    if (l && ++l.strikes > LIMITS.strikes) return this.reject(sock, CLOSE.abuse, 'abuse');
    // Rate drops of presence are silent: a burst after a stall is normal.
    if (code === 'rate' && about === 'presence') return;
    sock.send(JSON.stringify({ t: 'err', code, about } satisfies RelayMsg));
  }

  private reject(sock: Sock, code: number, reason: string): void {
    const a = sock.att;
    const was = a?.role;
    if (a) a.role = null;
    sock.close(code, reason);
    if (was && a) {
      this.broadcast({ t: 'left', id: a.id, why: 'lost' }, sock);
      this.settle(Date.now(), sock, was === 'host');
    }
  }

  private broadcast(msg: RelayMsg, except?: Sock): void {
    const out = JSON.stringify(msg);
    for (const s of this.admitted(except)) s.send(out);
  }

  /** After someone left: note an empty room or an absent host. */
  private settle(now: number, gone: Sock, wasHost: boolean): void {
    const meta = this.meta;
    if (!meta) return;
    const peers = this.admitted(gone);
    let changed = false;
    if (peers.length === 0 && meta.emptySince === undefined) {
      meta.emptySince = now;
      changed = true;
    }
    if (wasHost && peers.length > 0 && !peers.some((s) => s.att.role === 'host') && meta.hostAwaySince === undefined) {
      meta.hostAwaySince = now;
      changed = true;
    }
    if (changed) this.env.saveMeta(meta);
    this.env.setAlarm(now + (peers.length === 0 ? ROOM_TIMES.empty : ROOM_TIMES.check));
  }

  /** Ends the room for everyone and forgets it. */
  private end(why: 'host-left' | 'host-gone' | 'idle', code: number, by?: Sock): void {
    const out = JSON.stringify({ t: 'ended', why } satisfies RelayMsg);
    for (const s of this.env.sockets()) {
      const was = s.att?.role;
      if (s.att) s.att.role = null;
      if (was && s !== by) s.send(out);
      s.close(s === by ? CLOSE.normal : code, why);
    }
    this.forget();
  }

  private forget(): void {
    this.meta = null;
    this.env.saveMeta(null);
  }
}
