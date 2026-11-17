/**
 * Stand-in for `createLive` (src/live/, package 01.5) until it lands: a friend's link
 * can be shown, but nobody can join yet.
 */
import { shareOrigin } from '../origin';
import type { LivePort } from '../ports';

export function createStandinLive(): LivePort & { available: false } {
  return {
    available: false,
    host(islandId) {
      const code = islandId.slice(-6);
      return { code, link: `${shareOrigin()}/island?live=${code}&island=${encodeURIComponent(islandId)}` };
    },
    join() {
      return null;
    },
    leave() {
      return undefined;
    },
    send() {
      return undefined;
    },
    on() {
      return () => undefined;
    },
  };
}
