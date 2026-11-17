/**
 * The transport of live visits: one WebSocket to the relay, the room's people, events,
 * presence frames, voice notes, heartbeats and reconnecting with backoff. No Three.js
 * and no DOM beyond WebSocket and fetch, so the same class runs in Node for tests.
 *
 *   off         not in a room (never joined, left, or the room is gone)
 *   connecting  opening the room, or reconnecting after a drop (first seconds)
 *   live        in the room
 *   lost        the connection dropped and has not come back; still retrying for a while
 */
import {
  CLOSE,
  PROTOCOL_VERSION,
  backoff,
  closeReason,
  decodePresence,
  decodeVoice,
  encodeVoice,
  frameKind,
  isFinalClose,
  makeId,
  normalizeCode,
  parseRelayMsg,
  type CloseReason,
  type PeerInfo,
  type Presence,
  type RoomInfo,
  type VoiceNote,
} from './protocol';

export type LiveState = 'off' | 'connecting' | 'live' | 'lost';
export type LiveReason = CloseReason | 'unreachable' | 'left' | 'dropped' | 'gone' | 'bad-code';
export type LivePeer = PeerInfo;

interface WsLike {
  readonly readyState: number;
  readonly bufferedAmount: number;
  binaryType: string;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}
export type WebSocketCtor = new (url: string) => WsLike;

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };

export interface ClientOptions {
  relay: string;
  name?: string;
  color?: string;
  WebSocket?: WebSocketCtor;
  fetch?: typeof fetch;
  /** Remembers the peer id (per tab) and the hosted room (per island), so a reload resumes. */
  storage?: KV | null;
  now?: () => number;
  /** No frame at all for this long: the socket is dead. */
  deadAfter?: number;
  pingEvery?: number;
  /** A drop shows 'connecting' this long, then 'lost'. */
  lostAfter?: number;
  /** Reconnecting stops after this long. */
  giveUpAfter?: number;
}

export interface ClientEvents {
  state: (state: LiveState, reason: LiveReason | null) => void;
  welcome: (room: RoomInfo, me: LivePeer, resumed: boolean) => void;
  'peer-join': (peer: LivePeer, resumed: boolean) => void;
  'peer-leave': (peer: LivePeer, why: 'bye' | 'lost') => void;
  'peer-update': (peer: LivePeer) => void;
  presence: (p: Presence, peer: LivePeer) => void;
  voice: (note: VoiceNote, peer: LivePeer) => void;
  snapshot: (data: unknown, from: LivePeer) => void;
  event: (kind: string, data: unknown, from: LivePeer) => void;
  error: (code: string, about?: string) => void;
  ended: (why: string) => void;
}

const PEER_KEY = 'wayfolk.live.peer';
const HOST_KEY = 'wayfolk.live.host.';
/** A remembered room is tried again only while the relay still keeps it. */
const HOST_MEMORY_MS = 25 * 60_000;

class JoinError extends Error {
  constructor(readonly reason: LiveReason) {
    super(reason);
    this.name = 'LiveJoinError';
  }
}

export class LiveClient {
  state: LiveState = 'off';
  reason: LiveReason | null = null;
  role: 'host' | 'guest' | null = null;
  /** What the person set out to do, before the relay confirmed a role. */
  intent: 'host' | 'guest' | null = null;
  code: string | null = null;
  room: RoomInfo | null = null;
  me: LivePeer | null = null;
  readonly peers = new Map<string, LivePeer>();

  private readonly relay: string;
  private readonly WS: WebSocketCtor;
  private readonly fetchFn: typeof fetch;
  private readonly storage: KV | null;
  private readonly now: () => number;
  private readonly o: Required<Pick<ClientOptions, 'deadAfter' | 'pingEvery' | 'lostAfter' | 'giveUpAfter'>>;
  private name: string;
  private color: string | undefined;
  private pid: string;
  private psk: string;
  private key: string | undefined;
  private ws: WsLike | null = null;
  private attempt = 0;
  private droppedAt = 0;
  private welcomed = false;
  private everLive = false;
  private lastRx = 0;
  private lastTx = 0;
  private clip = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: { resolve: () => void; reject: (e: JoinError) => void } | null = null;
  private handlers = new Map<keyof ClientEvents, Set<(...a: never[]) => void>>();

  constructor(opts: ClientOptions) {
    this.relay = opts.relay.replace(/\/+$/, '');
    const g = globalThis as unknown as { WebSocket?: WebSocketCtor; fetch?: typeof fetch };
    const WS = opts.WebSocket ?? g.WebSocket;
    const f = opts.fetch ?? g.fetch;
    if (!WS || !f) throw new Error('live: no WebSocket or fetch on this platform');
    this.WS = WS;
    this.fetchFn = f.bind(globalThis);
    this.storage = opts.storage ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.o = { deadAfter: opts.deadAfter ?? 40_000, pingEvery: opts.pingEvery ?? 15_000, lostAfter: opts.lostAfter ?? 8_000, giveUpAfter: opts.giveUpAfter ?? 120_000 };
    this.name = opts.name ?? 'Friend';
    this.color = opts.color;
    const saved = this.read<{ pid: string; psk: string }>(PEER_KEY);
    this.pid = saved?.pid ?? makeId();
    this.psk = saved?.psk ?? makeId();
    if (!saved) this.write(PEER_KEY, { pid: this.pid, psk: this.psk });
  }

  get id(): string {
    return this.pid;
  }

  on<K extends keyof ClientEvents>(kind: K, fn: ClientEvents[K]): () => void {
    let set = this.handlers.get(kind);
    if (!set) this.handlers.set(kind, (set = new Set()));
    set.add(fn as (...a: never[]) => void);
    return () => set.delete(fn as (...a: never[]) => void);
  }

  private emit<K extends keyof ClientEvents>(kind: K, ...args: Parameters<ClientEvents[K]>): void {
    const set = this.handlers.get(kind);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as unknown as (...a: Parameters<ClientEvents[K]>) => void)(...args);
      } catch (error) {
        console.error('[live] handler failed', error);
      }
    }
  }

  /** Opens (or reopens) a room for the island; resolves with its code once inside. */
  async host(island: string, name?: string): Promise<{ code: string }> {
    if (name) this.name = name;
    this.intent = 'host';
    this.stop();
    const saved = this.read<{ code: string; key: string; at: number }>(HOST_KEY + island);
    if (saved && this.now() - saved.at < HOST_MEMORY_MS) {
      try {
        await this.enter(saved.code, saved.key);
        this.write(HOST_KEY + island, { ...saved, at: this.now() });
        return { code: saved.code };
      } catch (error) {
        const reason = (error as JoinError).reason;
        if (reason !== 'no-room' && reason !== 'bad-key' && reason !== 'replaced') throw error;
      }
    }
    this.setState('connecting', null);
    let made: { code?: string; key?: string };
    try {
      const res = await this.fetchFn(`${this.relay}/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ island, name: this.name }),
      });
      if (!res.ok) throw new Error(`relay ${res.status}`);
      made = (await res.json()) as { code?: string; key?: string };
    } catch {
      this.setState('off', 'unreachable');
      throw new JoinError('unreachable');
    }
    if (!made.code || !made.key) {
      this.setState('off', 'unreachable');
      throw new JoinError('unreachable');
    }
    this.write(HOST_KEY + island, { code: made.code, key: made.key, at: this.now() });
    await this.enter(made.code, made.key);
    return { code: made.code };
  }

  /** Joins a room by its code; resolves once inside, rejects with a LiveReason. */
  async join(code: string, name?: string): Promise<void> {
    if (name) this.name = name;
    this.intent = 'guest';
    const c = normalizeCode(code);
    if (!c) {
      this.setState('off', 'bad-code');
      throw new JoinError('bad-code');
    }
    this.stop();
    await this.enter(c, undefined);
  }

  /** Asks the relay what is behind a code, without joining. */
  async peek(code: string): Promise<{ open: boolean; island?: string; hostName?: string; peers: number; hostOnline: boolean }> {
    const c = normalizeCode(code);
    if (!c) return { open: false, peers: 0, hostOnline: false };
    const res = await this.fetchFn(`${this.relay}/rooms/${c}`);
    return (await res.json()) as { open: boolean; island?: string; hostName?: string; peers: number; hostOnline: boolean };
  }

  /** Leaves the room. A host's leave ends the room for everyone. */
  leave(): void {
    if (this.ws && this.ws.readyState === 1 && this.welcomed) this.sendText({ t: 'bye' });
    if (this.role === 'host' && this.room) this.storage?.removeItem(HOST_KEY + this.room.island);
    this.stop();
    this.clearPeers('bye');
    this.setState('off', 'left');
  }

  /** After the client gave up reconnecting: try again now. */
  retry(): void {
    if (!this.code || this.state === 'live') return;
    this.attempt = 0;
    this.droppedAt = this.now();
    this.setState('connecting', 'dropped');
    this.open();
  }

  setProfile(p: { name?: string; color?: string }): void {
    if (p.name) this.name = p.name;
    if (p.color) this.color = p.color;
    if (this.state === 'live') this.sendText({ t: 'me', name: p.name, color: p.color });
  }

  /** Sends an event to everyone in the room, or to one peer. False when not live. */
  send(kind: string, data?: unknown, to?: string): boolean {
    if (this.state !== 'live') return false;
    return this.sendText({ t: 'ev', k: kind, d: data, to });
  }

  /** Host only: the island snapshot for one guest, or '*' for every guest. */
  sendSnapshot(data: unknown, to: string): boolean {
    if (this.state !== 'live' || this.role !== 'host') return false;
    return this.sendText({ t: 'snap', d: data, to });
  }

  sendPresence(frame: Uint8Array): boolean {
    const ws = this.ws;
    if (this.state !== 'live' || !ws || ws.readyState !== 1) return false;
    // A slow link keeps only fresh poses: skip while the socket still holds older ones.
    if (ws.bufferedAmount > 16_384) return false;
    ws.send(frame);
    this.lastTx = this.now();
    return true;
  }

  sendVoice(audio: Uint8Array, durationMs: number, mime: string): boolean {
    const ws = this.ws;
    if (this.state !== 'live' || !ws || ws.readyState !== 1) return false;
    this.clip = (this.clip + 1) & 0xffff;
    ws.send(encodeVoice(this.clip, durationMs, mime, audio));
    this.lastTx = this.now();
    return true;
  }

  /** Tests: drops the socket as a network failure would. */
  debugDrop(): void {
    const ws = this.ws;
    if (!ws) return;
    this.detach(ws);
    try {
      ws.close(4999, 'test-drop');
    } catch {
      /* already closed */
    }
    this.dropped();
  }

  dispose(): void {
    this.stop();
    this.handlers.clear();
  }

  // -------------------------------------------------------------------------------------

  private enter(code: string, key: string | undefined): Promise<void> {
    this.code = code;
    this.key = key;
    this.role = null;
    this.attempt = 0;
    this.everLive = false;
    this.welcomed = false;
    this.setState('connecting', null);
    return new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.open();
    });
  }

  private open(): void {
    if (!this.code) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const url = `${this.relay.replace(/^http/, 'ws')}/ws/${this.code}`;
    let ws: WsLike;
    try {
      ws = new this.WS(url);
    } catch {
      this.dropped();
      return;
    }
    this.ws = ws;
    this.welcomed = false;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.lastRx = this.now();
      this.sendText({ t: 'hi', v: PROTOCOL_VERSION, pid: this.pid, psk: this.psk, name: this.name, color: this.color, key: this.key });
    };
    ws.onmessage = (ev) => this.receive(ev.data);
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.detach(ws);
      this.closed(ev.code);
    };
    // Browsers follow an error with a close; some runtimes (Node's WebSocket) do not, and
    // a handshake can also hang on a bad network. Either way the socket counts as dropped.
    const giveUp = () => {
      if (this.ws !== ws) return;
      this.detach(ws);
      try {
        ws.close();
      } catch {
        /* never opened */
      }
      this.closed(1006);
    };
    ws.onerror = () => setTimeout(giveUp, 100);
    setTimeout(() => {
      if (ws.readyState === 0) giveUp();
    }, 10_000);
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000);
  }

  private detach(ws: WsLike): void {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    if (this.ws === ws) this.ws = null;
  }

  private tick(): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    const now = this.now();
    if (now - this.lastRx > this.o.deadAfter) {
      this.detach(ws);
      try {
        ws.close(4999, 'dead');
      } catch {
        /* gone */
      }
      this.dropped();
      return;
    }
    if (now - this.lastTx > this.o.pingEvery) {
      ws.send('ping');
      this.lastTx = now;
    }
  }

  private closed(code: number): void {
    if (isFinalClose(code) || code === CLOSE.normal) {
      const reason: LiveReason = closeReason(code) ?? 'left';
      this.stopSocket();
      this.welcomed = false;
      this.clearPeers('lost');
      this.setState('off', reason);
      this.fail(reason);
      return;
    }
    this.dropped();
  }

  /** The socket is gone without a final word: try again with backoff. */
  private dropped(): void {
    const now = this.now();
    if (!this.everLive) {
      // Still joining: a few quick tries, then the relay counts as unreachable.
      if (this.attempt >= 3) {
        this.stop();
        this.setState('off', 'unreachable');
        this.fail('unreachable');
        return;
      }
    } else if (this.state === 'live') {
      this.droppedAt = now;
      this.setState('connecting', 'dropped');
    } else if (now - this.droppedAt > this.o.giveUpAfter) {
      this.stopSocket();
      this.clearPeers('lost');
      this.setState('lost', 'gone');
      return;
    } else if (now - this.droppedAt > this.o.lostAfter && this.state !== 'lost') {
      this.setState('lost', 'dropped');
    }
    const delay = backoff(this.attempt++);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.everLive && this.state === 'connecting' && this.now() - this.droppedAt > this.o.lostAfter) this.setState('lost', 'dropped');
      this.open();
    }, delay);
  }

  private receive(data: unknown): void {
    this.lastRx = this.now();
    if (typeof data === 'string') {
      if (data === 'pong') return;
      const m = parseRelayMsg(data);
      if (m) this.handle(m);
      return;
    }
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null;
    if (!buf) return;
    const kind = frameKind(buf);
    if (kind === 'presence') {
      const p = decodePresence(buf);
      const peer = p && this.peerBySlot(p.slot);
      if (p && peer) this.emit('presence', p, peer);
    } else if (kind === 'voice') {
      const v = decodeVoice(buf);
      const peer = v && this.peerBySlot(v.slot);
      if (v && peer) this.emit('voice', v, peer);
    }
  }

  private handle(m: NonNullable<ReturnType<typeof parseRelayMsg>>): void {
    switch (m.t) {
      case 'welcome': {
        const resumed = this.everLive;
        this.welcomed = true;
        this.everLive = true;
        this.attempt = 0;
        this.me = m.you;
        this.role = m.you.role;
        this.room = m.room;
        const seen = new Set<string>();
        for (const p of m.peers) {
          seen.add(p.id);
          const had = this.peers.get(p.id);
          this.peers.set(p.id, p);
          if (!had) this.emit('peer-join', p, false);
          else if (had.slot !== p.slot || had.name !== p.name || had.color !== p.color) this.emit('peer-update', p);
        }
        for (const [id, p] of [...this.peers]) {
          if (!seen.has(id)) {
            this.peers.delete(id);
            this.emit('peer-leave', p, 'lost');
          }
        }
        this.setState('live', null);
        this.emit('welcome', m.room, m.you, resumed);
        const pending = this.pending;
        this.pending = null;
        pending?.resolve();
        return;
      }
      case 'join': {
        const had = this.peers.has(m.p.id);
        this.peers.set(m.p.id, m.p);
        if (had) this.emit('peer-update', m.p);
        this.emit('peer-join', m.p, Boolean(m.resumed) || had);
        return;
      }
      case 'me': {
        if (m.p.id === this.me?.id) {
          this.me = m.p;
          return;
        }
        this.peers.set(m.p.id, m.p);
        this.emit('peer-update', m.p);
        return;
      }
      case 'left': {
        const p = this.peers.get(m.id);
        if (!p) return;
        this.peers.delete(m.id);
        this.emit('peer-leave', p, m.why);
        return;
      }
      case 'ev': {
        const from = this.peers.get(m.f);
        if (from) this.emit('event', m.k, m.d, from);
        return;
      }
      case 'snap': {
        const from = this.peers.get(m.f);
        if (from) this.emit('snapshot', m.d, from);
        return;
      }
      case 'err':
        this.emit('error', m.code, m.about);
        return;
      case 'ended':
        this.emit('ended', m.why);
        return;
    }
  }

  private peerBySlot(slot: number): LivePeer | undefined {
    for (const p of this.peers.values()) if (p.slot === slot) return p;
    return undefined;
  }

  private sendText(m: unknown): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(m));
    this.lastTx = this.now();
    return true;
  }

  private fail(reason: LiveReason): void {
    const pending = this.pending;
    this.pending = null;
    pending?.reject(new JoinError(reason));
  }

  private clearPeers(why: 'bye' | 'lost'): void {
    for (const p of [...this.peers.values()]) {
      this.peers.delete(p.id);
      this.emit('peer-leave', p, why);
    }
  }

  private stopSocket(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ws = this.ws;
    if (ws) {
      this.detach(ws);
      try {
        ws.close(1000, 'leave');
      } catch {
        /* gone */
      }
    }
  }

  private stop(): void {
    this.stopSocket();
    this.fail('left');
    this.welcomed = false;
  }

  private setState(state: LiveState, reason: LiveReason | null): void {
    if (this.state === state && this.reason === reason) return;
    this.state = state;
    this.reason = reason;
    this.emit('state', state, reason);
  }

  private read<T>(key: string): T | null {
    try {
      const raw = this.storage?.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    try {
      this.storage?.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode */
    }
  }
}

export { JoinError };
