/**
 * Connection servers for the seating for two (PLAN "Рассадка вдвоём"), the answer of
 * `GET /api/code/ice` (the route itself is added with api/code.ts by 02.4). Always public
 * STUN; TURN only when TURN_URLS (comma separated `turn:` / `turns:` addresses) and
 * TURN_CREDENTIAL (`name:password`) are both set. `relay` tells the client whether a
 * relay exists, so the code card can say in advance that both devices need the same
 * Wi-Fi. Half a configuration (addresses without a credential or the reverse) gives no
 * TURN and is reported in the log by variable name.
 */
import type { IceAnswer, RTCIceServerInit } from './contracts';
import { list, text, type Env } from './env';

export const PUBLIC_STUN: RTCIceServerInit = { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] };

export function iceServers(env: Env = process.env): IceAnswer {
  const servers: RTCIceServerInit[] = [PUBLIC_STUN];
  const urls = list(env, 'TURN_URLS').filter((url) => /^turns?:[^\s]+$/i.test(url));
  const credential = text(env, 'TURN_CREDENTIAL');
  const split = credential.indexOf(':');
  const username = split > 0 ? credential.slice(0, split) : '';
  const password = split > 0 ? credential.slice(split + 1) : '';
  if (urls.length > 0 && username && password) {
    servers.push({ urls, username, credential: password });
    return { iceServers: servers, relay: true };
  }
  if (urls.length > 0 || credential) {
    console.warn(JSON.stringify({ at: 'ice', problem: 'TURN_URLS and TURN_CREDENTIAL must both be set; relay is off' }));
  }
  return { iceServers: servers, relay: false };
}
