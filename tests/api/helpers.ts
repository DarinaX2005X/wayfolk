/**
 * Stand-ins shared by the API tests: Upstash Redis behind its REST API, and Vercel Blob
 * as the JSON-record adapter sees it. Both follow a movable clock so expiry is tested
 * without waiting.
 */
import type { BlobJson } from '../../api/_lib/blob-json';

export type Clock = { now(): number; advance(ms: number): void };

export function clock(start = Date.UTC(2026, 10, 16, 12, 0, 0)): Clock {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms) };
}

type Cell = { value: string; exp: number | null };

/**
 * Upstash REST: POST <url> with a JSON command array answers `{ result }`; POST
 * <url>/pipeline with an array of commands answers `[{ result } | { error }]`; a bad
 * token is 401 `{ error }`. Replies have the forms of the real service: SET gives "OK"
 * or null, INCRBY a number, GET a string or null, EVAL whatever the script returns.
 * The two scripts of kv.ts are recognised by their text.
 */
export function fakeUpstash(time: Clock, token = 'upstash-test-token') {
  const cells = new Map<string, Cell>();
  const zsets = new Map<string, Map<string, number>>();
  const calls: { path: string; commands: string[][] }[] = [];
  let failNext: { status: number; body: unknown } | null = null;

  const live = (key: string): Cell | null => {
    const cell = cells.get(key);
    if (!cell) return null;
    if (cell.exp !== null && cell.exp <= time.now()) {
      cells.delete(key);
      return null;
    }
    return cell;
  };

  function run(args: string[]): unknown {
    const [name, ...rest] = args;
    switch (name.toUpperCase()) {
      case 'GET':
        return live(rest[0])?.value ?? null;
      case 'SET': {
        const [key, value, ...opts] = rest;
        const upper = opts.map((o) => o.toUpperCase());
        if (upper.includes('NX') && live(key)) return null;
        const ex = upper.indexOf('EX');
        cells.set(key, { value, exp: ex >= 0 ? time.now() + Number(opts[ex + 1]) * 1000 : null });
        return 'OK';
      }
      case 'DEL':
        return Number(cells.delete(rest[0])) + Number(zsets.delete(rest[0]));
      case 'INCRBY': {
        const cell = live(rest[0]);
        const value = Number(cell?.value ?? 0) + Number(rest[1]);
        cells.set(rest[0], { value: String(value), exp: cell?.exp ?? null });
        return value;
      }
      case 'EXPIRE': {
        const cell = live(rest[0]);
        if (!cell) return 0;
        if (rest[2]?.toUpperCase() === 'NX' && cell.exp !== null) return 0;
        cell.exp = time.now() + Number(rest[1]) * 1000;
        return 1;
      }
      case 'ZADD': {
        const set = zsets.get(rest[0]) ?? new Map<string, number>();
        zsets.set(rest[0], set);
        const added = set.has(rest[2]) ? 0 : 1;
        set.set(rest[2], Number(rest[1]));
        return added;
      }
      case 'EVAL': {
        const [script, , key, ...argv] = rest;
        if (script.includes('ZRANGEBYSCORE')) {
          const set = zsets.get(key) ?? new Map<string, number>();
          const due = [...set.entries()]
            .filter(([, score]) => score <= Number(argv[0]))
            .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1))
            .slice(0, Number(argv[1]))
            .map(([m]) => m);
          for (const m of due) set.delete(m);
          return due;
        }
        if (script.includes('cjson.decode')) {
          const cell = live(key);
          if (!cell) return 0;
          let rev: unknown;
          try {
            rev = (JSON.parse(cell.value) as { rev?: unknown }).rev;
          } catch {
            return 0;
          }
          if (rev !== Number(argv[1])) return 0;
          cells.set(key, { value: argv[0], exp: argv[2] ? time.now() + Number(argv[2]) * 1000 : null });
          return 1;
        }
        throw new Error('unknown script');
      }
      default:
        throw new Error(`ERR unknown command '${name}'`);
    }
  }

  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (init?.headers && new Headers(init.headers).get('authorization') !== `Bearer ${token}`) {
      return reply(401, { error: 'Unauthorized' });
    }
    if (failNext) {
      const f = failNext;
      failNext = null;
      return reply(f.status, f.body);
    }
    const body = JSON.parse(String(init?.body)) as string[] | string[][];
    if (url.pathname.endsWith('/pipeline')) {
      const commands = body as string[][];
      calls.push({ path: '/pipeline', commands });
      return reply(
        200,
        commands.map((command) => {
          try {
            return { result: run(command) };
          } catch (err) {
            return { error: String((err as Error).message) };
          }
        }),
      );
    }
    calls.push({ path: '/', commands: [body as string[]] });
    try {
      return reply(200, { result: run(body as string[]) });
    } catch (err) {
      return reply(400, { error: String((err as Error).message) });
    }
  };

  return {
    fetch: fetch as typeof globalThis.fetch,
    calls,
    cells,
    /** The next request answers this instead. */
    failWith(status: number, body: unknown) {
      failNext = { status, body };
    },
    commandCount: () => calls.reduce((n, c) => n + c.commands.length, 0),
  };
}

/** JSON records the way ./blob-json.ts stores them, in a Map, with operation counts. */
export function fakeBlobJson(): BlobJson & { files: Map<string, unknown>; ops: { read: number; write: number } } {
  const files = new Map<string, unknown>();
  const ops = { read: 0, write: 0 };
  return {
    files,
    ops,
    async read<T>(pathname: string) {
      ops.read += 1;
      return (files.has(pathname) ? structuredClone(files.get(pathname)) : null) as T | null;
    },
    async create(pathname, value) {
      ops.write += 1;
      if (files.has(pathname)) return false;
      files.set(pathname, structuredClone(value));
      return true;
    },
    async write(pathname, value) {
      ops.write += 1;
      files.set(pathname, structuredClone(value));
    },
    async remove(pathname) {
      files.delete(pathname);
    },
  };
}

export const jsonResponse = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
