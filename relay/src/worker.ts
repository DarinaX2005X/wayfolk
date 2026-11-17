/**
 * Wayfolk live relay: a Cloudflare Worker with one Durable Object per room.
 *
 *   GET  /               health: { ok, name, v }
 *   POST /rooms          { island, name } → { code, key }   a new room; the key makes its holder the host
 *   GET  /rooms/:code    { open, island, hostName, peers, hostOnline }
 *   GET  /ws/:code       WebSocket into the room (first frame: hello, see src/live/protocol.ts)
 *
 * Rooms use the WebSocket hibernation API, so a quiet room costs no duration, and
 * 'ping' is answered by the runtime without waking the room.
 */
import { DurableObject } from 'cloudflare:workers';
import { PROTOCOL_VERSION, cleanName, makeCode, makeId, normalizeCode } from '../../src/live/protocol';
import { RoomCore, newAtt, type Att, type Meta, type Sock } from './room-core';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
}

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });
}

const ISLAND_RE = /^[A-Za-z0-9_-]{1,64}$/;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const parts = url.pathname.split('/').filter(Boolean);

    if (parts.length === 0 && req.method === 'GET') return json({ ok: true, name: 'wayfolk-relay', v: PROTOCOL_VERSION });

    if (parts[0] === 'rooms' && parts.length === 1 && req.method === 'POST') {
      const text = await req.text();
      if (text.length > 2048) return json({ error: 'too-big' }, 413);
      let body: { island?: unknown; name?: unknown };
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: 'bad-json' }, 400);
      }
      if (typeof body.island !== 'string' || !ISLAND_RE.test(body.island)) return json({ error: 'bad-island' }, 400);
      const key = makeId() + makeId();
      for (let i = 0; i < 5; i++) {
        const code = makeCode();
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (await room.init({ code, island: body.island, key, hostName: cleanName(body.name, 'A friend') })) return json({ code, key });
      }
      return json({ error: 'busy' }, 503);
    }

    if (parts[0] === 'rooms' && parts.length === 2 && req.method === 'GET') {
      const code = normalizeCode(parts[1]);
      if (!code) return json({ open: false, peers: 0, hostOnline: false });
      return json(await env.ROOMS.get(env.ROOMS.idFromName(code)).peek());
    }

    if (parts[0] === 'ws' && parts.length === 2) {
      if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'expected-websocket' }, 426);
      const code = normalizeCode(parts[1]);
      if (!code) return json({ error: 'bad-code' }, 400);
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    return json({ error: 'not-found' }, 404);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  private core!: RoomCore;
  private socks = new WeakMap<WebSocket, Sock>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      const meta = (await ctx.storage.get<Meta>('meta')) ?? null;
      this.core = new RoomCore(meta, {
        sockets: () => ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN).map((ws) => this.sock(ws)),
        saveMeta: (m) => {
          if (m) {
            void ctx.storage.put('meta', m);
          } else {
            void ctx.storage.deleteAlarm();
            void ctx.storage.deleteAll();
          }
        },
        setAlarm: (at) => {
          void ctx.storage.setAlarm(at);
        },
      });
    });
  }

  private sock(ws: WebSocket): Sock {
    let s = this.socks.get(ws);
    if (!s) {
      const ctx = this.ctx;
      const made: Sock = {
        att: (ws.deserializeAttachment() as Att | null) ?? newAtt(Date.now()),
        save: () => ws.serializeAttachment(made.att),
        send: (d) => {
          try {
            ws.send(d);
          } catch {
            /* closing */
          }
        },
        close: (code, reason) => {
          try {
            ws.close(code, reason);
          } catch {
            /* already closed */
          }
        },
        lastPing: () => ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0,
      };
      this.socks.set(ws, made);
      s = made;
    }
    return s;
  }

  async init(m: { code: string; island: string; key: string; hostName: string }): Promise<boolean> {
    return this.core.init(m, Date.now());
  }

  async peek(): Promise<ReturnType<RoomCore['peek']>> {
    return this.core.peek();
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    this.core.open(this.sock(server), Date.now());
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    this.core.message(this.sock(ws), message, Date.now());
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.core.closed(this.sock(ws), Date.now());
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.core.closed(this.sock(ws), Date.now());
  }

  async alarm(): Promise<void> {
    this.core.alarm(Date.now());
  }
}
