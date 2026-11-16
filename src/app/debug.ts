/**
 * The debug handle `window.__gw[key]`. Hand scenarios (scripts/xr.mjs), browser
 * scenarios (scripts/web.mjs) and capture read the application state through it instead
 * of judging pictures (PLAN "Набор ремесла": store, run, clock, perf, test, capture, ...).
 *
 * It exists, together with the object probe and the page parameters run, pace, answers
 * and capture, in three cases (PLAN "Подключение пакетов без общих файлов"):
 *   - the dev server (import.meta.env.DEV),
 *   - a build for scenarios (`npm run xr:prod` builds with VITE_GW_TEST=1),
 *   - any build opened with `?debug=1`.
 * On the deployment without `debug=1` registerDebug does nothing and the object is absent.
 */
import { store } from './store';

type DebugHost = { __gw?: Record<string, unknown> };

let decided: boolean | null = null;

/** Whether debug hooks and test parameters are on for this page. */
export function debugEnabled(): boolean {
  if (decided !== null) return decided;
  if (typeof window === 'undefined') return (decided = false);
  let query = false;
  try {
    query = new URLSearchParams(window.location.search).get('debug') === '1';
  } catch {
    query = false;
  }
  decided = import.meta.env.DEV || import.meta.env.VITE_GW_TEST === '1' || query;
  return decided;
}

export function registerDebug(key: string, value: unknown): void {
  if (!debugEnabled()) return;
  const host = window as unknown as DebugHost;
  host.__gw ??= {};
  host.__gw[key] = value;
}

registerDebug('store', store);

/**
 * Adds a scenario hook to `window.__gw.test` (blockApi, setVisibility, forceLive,
 * failNext, loseHand, ...). Each owning package registers its own; the object is shared.
 */
export function registerTest(name: string, fn: (...args: never[]) => unknown): void {
  if (!debugEnabled()) return;
  const host = window as unknown as DebugHost;
  host.__gw ??= {};
  const test = (host.__gw.test ??= {}) as Record<string, unknown>;
  test[name] = fn;
}
