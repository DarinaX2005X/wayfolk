/**
 * One run per project across tabs (PLAN: navigator.locks.request('gw-run-' + projectId)).
 * acquire resolves a release function, or null when another tab holds the lock. In Node
 * and in browsers without the Lock API a lock in memory does the same within one page.
 */
import type { LockManager } from './types';

export function memoryLocks(): LockManager {
  const held = new Set<string>();
  return {
    async acquire(name) {
      if (held.has(name)) return null;
      held.add(name);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        held.delete(name);
      };
    },
  };
}

type WebLocks = {
  request(name: string, options: { ifAvailable: boolean }, callback: (lock: unknown) => Promise<void> | void): Promise<unknown>;
};

/** navigator.locks when the browser has it; the lock is held until release() is called. */
export function browserLocks(locks: WebLocks): LockManager {
  return {
    acquire(name) {
      return new Promise((resolve, reject) => {
        locks
          .request(name, { ifAvailable: true }, (lock) => {
            if (!lock) {
              resolve(null);
              return;
            }
            return new Promise<void>((release) => resolve(() => release()));
          })
          .catch(reject);
      });
    },
  };
}

let shared: LockManager | null = null;

/** The lock manager of this page: navigator.locks when present, memory otherwise. */
export function defaultLocks(): LockManager {
  if (shared) return shared;
  const nav = (globalThis as { navigator?: { locks?: WebLocks } }).navigator;
  shared = nav?.locks?.request ? browserLocks(nav.locks) : memoryLocks();
  return shared;
}
