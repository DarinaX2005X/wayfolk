/**
 * Small preferences in localStorage, remembered on this device: settings
 * (`wf.settings.v1`), the owner key of the world (`gw.ownerKey`), the world name
 * (`gw.worldName`) and what the first session has already shown (`gw.seen`). Keys are
 * `wf.*` (PLAN "Где живут данные"). Projects and runs live in IndexedDB (persist.ts).
 *
 * Storage is an input boundary. A value can be missing, cut short, written by an older
 * build, edited by hand, or unreadable because the browser blocks storage. None of
 * that may stop the app: a broken value is dropped and replaced by the fallback, a
 * partly broken one keeps the parts that are sound, and storage is rewritten with the
 * cleaned value so the same garbage is not read again.
 */
import type { Signal } from '@preact/signals-core';

const PREFIX = 'wf.';

/** Changes are written at most once per this many milliseconds. */
export const WRITE_INTERVAL_MS = 300;

/**
 * Turns a parsed stored value into a valid `T`. Returns `undefined` when nothing
 * usable is left, and the fallback is used instead.
 */
export type Sanitize<T> = (raw: unknown) => T | undefined;

function assertKey(key: string): void {
  if (!key.startsWith(PREFIX)) {
    throw new Error(`prefs: key "${key}" must start with "${PREFIX}"`);
  }
}

/** localStorage, or null where it is missing or blocked (private mode, sandboxed frame, Node). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** JSON type of a value, enough to tell whether a stored value has the shape of the fallback. */
function kind(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

/**
 * Parses a raw stored string. Returns the cleaned value, or `undefined` when the
 * string is not JSON, has another shape than the fallback, or the sanitizer rejects it.
 */
function parse<T>(raw: string, fallback: T, sanitize?: Sanitize<T>): T | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (sanitize) {
    return sanitize(parsed);
  }
  // Without a sanitizer the least we can require is the same JSON type as the
  // fallback: an object where an object is expected, a list where a list is.
  // A null fallback means "nothing stored yet" and accepts any value.
  if (fallback !== null && kind(parsed) !== kind(fallback)) {
    return undefined;
  }
  return parsed as T;
}

/**
 * Reads `key`. Returns `fallback` when the key is absent, unreadable or broken.
 * Pass `sanitize` for anything with inner structure: it receives the parsed JSON and
 * returns the valid part of it.
 */
export function load<T>(key: string, fallback: T, sanitize?: Sanitize<T>): T {
  assertKey(key);
  const store = storage();
  if (!store) return fallback;

  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return fallback;
  }
  if (raw === null) return fallback;

  const clean = parse(raw, fallback, sanitize);
  const value = clean === undefined ? fallback : clean;
  // Replace what was stored whenever cleaning changed it.
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text !== raw) {
    if (import.meta.env.DEV) {
      console.warn(`[gw] stored "${key}" was ${clean === undefined ? 'unreadable and was reset' : 'repaired'}`);
    }
    save(key, value);
  }
  return value;
}

/**
 * Writes `key`. Returns false when the value cannot be stored (storage blocked or
 * full, value not serializable); the app keeps working from memory.
 */
export function save(key: string, value: unknown): boolean {
  assertKey(key);
  const store = storage();
  if (!store) return false;
  try {
    const text = JSON.stringify(value);
    if (text === undefined) {
      store.removeItem(key);
    } else {
      store.setItem(key, text);
    }
    return true;
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn(`[gw] could not store "${key}"`, error);
    }
    return false;
  }
}

/** Removes `key`. Returns false when storage is unavailable. */
export function clear(key: string): boolean {
  assertKey(key);
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps `key` in step with a signal.
 *
 * - A change is written at most once per 300 ms; the latest value wins.
 * - A pending write is flushed at once when the page is hidden or unloaded, so
 *   closing the tab or taking the headset off loses nothing.
 * - A write from another tab of the same site updates the signal, so two tabs do not
 *   overwrite each other's settings with a stale copy.
 *
 * The signal's current value is not written on binding: loading is the caller's step
 * (`signal(load(key, fallback, sanitize))`). Returns a function that flushes and unbinds.
 */
export function bindPersist<T>(target: Signal<T>, key: string, sanitize?: Sanitize<T>): () => void {
  assertKey(key);

  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastWrite = Number.NEGATIVE_INFINITY;
  /** True while the signal is being updated from another tab: that value is already stored. */
  let adopting = false;
  let first = true;

  const flush = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (!dirty) return;
    dirty = false;
    lastWrite = Date.now();
    save(key, target.peek());
  };

  const unsubscribe = target.subscribe(() => {
    if (first) {
      first = false;
      return;
    }
    if (adopting) return;
    dirty = true;
    if (timer !== undefined) return;
    const wait = Math.max(0, lastWrite + WRITE_INTERVAL_MS - Date.now());
    timer = setTimeout(flush, wait);
  });

  const onVisibility = (): void => {
    flush();
  };

  const onStorage = (event: StorageEvent): void => {
    if (event.key !== key || event.newValue === null) return;
    const incoming = parse(event.newValue, target.peek(), sanitize);
    if (incoming === undefined) return;
    // The other tab's write is newer than anything pending here.
    dirty = false;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    adopting = true;
    try {
      target.value = incoming;
    } finally {
      adopting = false;
    }
  };

  const doc = typeof document === 'undefined' ? null : document;
  const win = typeof window === 'undefined' ? null : window;
  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', onVisibility);
  win?.addEventListener('storage', onStorage);

  return () => {
    flush();
    unsubscribe();
    doc?.removeEventListener('visibilitychange', onVisibility);
    win?.removeEventListener('pagehide', onVisibility);
    win?.removeEventListener('storage', onStorage);
  };
}
