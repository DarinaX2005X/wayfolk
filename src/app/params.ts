/**
 * Page parameters of /island. They exist only where debug hooks are on (dev, the
 * scenario build, `?debug=1`; src/app/debug.ts); on the deployment without `debug=1`
 * the page ignores them and behaves as a person opening it would see it.
 *
 *   pace=<number>   multiplies the waits of the first minute (0.25 in scenarios)
 *   fresh=1         forget the island on this device and start the first minute again
 *   later=1         pretend this is a later visit (Pip tells what happened meanwhile)
 *   capture=1       frozen clock, stepped by the capture tool
 *   offline=1       no model calls at all, prepared travelers and lines only
 *   keyart=1        still frames for the cover (src/app/keyart.ts): the theatre keeps depth
 */
export type AppParams = {
  pace: number;
  fresh: boolean;
  later: boolean;
  capture: boolean;
  offline: boolean;
  keyart: boolean;
  debug: boolean;
};

/** Reads the parameters; with `enabled` false only the defaults come back. */
export function parseAppParams(search: string, enabled: boolean): AppParams {
  const q = new URLSearchParams(search);
  const params: AppParams = { pace: 1, fresh: false, later: false, capture: false, offline: false, keyart: false, debug: q.get('debug') === '1' };
  if (!enabled) return params;
  const pace = Number(q.get('pace'));
  if (q.has('pace') && Number.isFinite(pace) && pace >= 0 && pace <= 10) params.pace = pace;
  params.fresh = q.get('fresh') === '1';
  params.later = q.get('later') === '1';
  params.capture = q.get('capture') === '1';
  params.offline = q.get('offline') === '1';
  params.keyart = q.get('keyart') === '1';
  return params;
}
