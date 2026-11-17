/**
 * Where the person's island lives on the device: IndexedDB (database `wayfolk`, store
 * `islands`, key `home`). A browser without IndexedDB, or one that refuses it (private
 * mode, blocked storage), gets a memory store and the island lasts for the session; the
 * mind says so through `persistent`.
 */
import type { IslandState } from './types';

export interface IslandStore {
  readonly persistent: boolean;
  load(): Promise<IslandState | null>;
  save(state: IslandState): Promise<void>;
  clear(): Promise<void>;
}

export function memoryStore(): IslandStore {
  let saved: IslandState | null = null;
  return {
    persistent: false,
    async load() {
      return saved ? structuredClone(saved) : null;
    },
    async save(state) {
      saved = structuredClone(state);
    },
    async clear() {
      saved = null;
    },
  };
}

const DB = 'wayfolk';
const STORE = 'islands';
const KEY = 'home';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexeddb: open failed'));
    request.onblocked = () => reject(new Error('indexeddb: blocked'));
  });
}

function run<T>(db: IDBDatabase, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? new Error('indexeddb: transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('indexeddb: aborted'));
  });
}

/** IndexedDB when it works, otherwise memory. */
export async function deviceStore(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<IslandStore> {
  if (!factory) return memoryStore();
  let db: IDBDatabase;
  try {
    db = await open(factory);
  } catch {
    return memoryStore();
  }
  return {
    persistent: true,
    async load() {
      const value = await run<unknown>(db, 'readonly', (s) => s.get(KEY));
      return (value as IslandState | undefined) ?? null;
    },
    async save(state) {
      await run(db, 'readwrite', (s) => s.put(structuredClone(state), KEY));
    },
    async clear() {
      await run(db, 'readwrite', (s) => s.delete(KEY));
    },
  };
}
