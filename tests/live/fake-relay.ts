/**
 * The relay on a local Node server: the same RoomCore the Durable Object runs, behind the
 * same routes as relay/src/worker.ts. Client tests run against it offline; the deployed
 * relay gets the same tests in e2e.test.ts.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomCore, newAtt, type Meta, type Sock } from '../../relay/src/room-core';
import { cleanName, makeCode, makeId, normalizeCode } from '../../src/live/protocol';

interface Room {
  core: RoomCore;
  socks: Map<WebSocket, Sock & { pingAt: number }>;
  alarm: ReturnType<typeof setTimeout> | null;
}

export interface FakeRelay {
  url: string;
  rooms: Map<string, Room>;
  /** Closes every socket of a room without a close frame, as a network cut would. */
  cut(code: string): void;
  close(): Promise<void>;
}

export async function startFakeRelay(): Promise<FakeRelay> {
  const rooms = new Map<string, Room>();

  const roomFor = (code: string): Room => {
    let room = rooms.get(code);
    if (room) return room;
    const socks = new Map<WebSocket, Sock & { pingAt: number }>();
    const made: Room = { socks, alarm: null, core: null as unknown as RoomCore };
    made.core = new RoomCore(null, {
      sockets: () => [...socks.entries()].filter(([ws]) => ws.readyState === 1).map(([, s]) => s),
      saveMeta: (m: Meta | null) => {
        if (!m) {
          if (made.alarm) clearTimeout(made.alarm);
          rooms.delete(code);
        }
      },
      setAlarm: (at: number) => {
        if (made.alarm) clearTimeout(made.alarm);
        made.alarm = setTimeout(() => made.core.alarm(Date.now()), Math.max(0, at - Date.now()));
        made.alarm.unref?.();
      },
    });
    rooms.set(code, made);
    return made;
  };

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const parts = (req.url ?? '/').split('?')[0].split('/').filter(Boolean);
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' });
      res.end();
      return;
    }
    if (parts.length === 0) return send(res, 200, { ok: true, name: 'fake-relay', v: 1 });
    if (parts[0] === 'rooms' && parts.length === 1 && req.method === 'POST') {
      let text = '';
      req.on('data', (c: Buffer) => (text += c.toString()));
      req.on('end', () => {
        const body = JSON.parse(text || '{}') as { island?: string; name?: string };
        if (typeof body.island !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(body.island)) return send(res, 400, { error: 'bad-island' });
        const key = makeId() + makeId();
        for (let i = 0; i < 5; i++) {
          const code = makeCode();
          if (roomFor(code).core.init({ code, island: body.island, key, hostName: cleanName(body.name, 'A friend') }, Date.now())) return send(res, 200, { code, key });
        }
        send(res, 503, { error: 'busy' });
      });
      return;
    }
    if (parts[0] === 'rooms' && parts.length === 2) {
      const code = normalizeCode(parts[1]);
      const room = code ? rooms.get(code) : undefined;
      return send(res, 200, room ? room.core.peek() : { open: false, peers: 0, hostOnline: false });
    }
    send(res, 404, { error: 'not-found' });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const parts = (req.url ?? '/').split('?')[0].split('/').filter(Boolean);
    const code = parts[0] === 'ws' ? normalizeCode(parts[1]) : null;
    if (!code) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const room = rooms.get(code) ?? roomFor(code);
      const sock: Sock & { pingAt: number } = {
        att: newAtt(Date.now()),
        pingAt: 0,
        save: () => {},
        send: (d) => {
          if (ws.readyState === 1) ws.send(d);
        },
        close: (c, r) => {
          try {
            ws.close(c, r);
          } catch {
            /* gone */
          }
        },
        lastPing: () => sock.pingAt,
      };
      room.socks.set(ws, sock);
      ws.on('message', (data, isBinary) => {
        const r = rooms.get(code);
        if (!r) return;
        if (!isBinary && data.length === 4 && data.toString() === 'ping') {
          sock.pingAt = Date.now();
          sock.send('pong');
          return;
        }
        r.core.message(sock, isBinary ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice() : data.toString(), Date.now());
      });
      ws.on('close', () => {
        room.socks.delete(ws);
        rooms.get(code)?.core.closed(sock, Date.now());
      });
      ws.on('error', () => {});
      room.core.open(sock, Date.now());
      if (!room.core.meta) rooms.delete(code);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    rooms,
    cut(code: string) {
      const room = rooms.get(code);
      if (!room) return;
      for (const ws of room.socks.keys()) ws.terminate();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const r of rooms.values()) if (r.alarm) clearTimeout(r.alarm);
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}
