/**
 * What the product keeps on this device, in IndexedDB (database `groundwork`, version 1;
 * PLAN "Где живут данные"):
 *
 *   world      the island, one record under the key 'world'
 *   projects   Project by `id`
 *   runs       RunRecord by `id` without its events; index `byProject` on
 *              [projectId, status] serves findRunning
 *   runEvents  RunEvent by [runId, seq]: appending a batch never rewrites the run record;
 *              load() gathers them back into RunRecord.events in seq order
 *   docs       pages of own files by [projectId, docId]
 *
 * Small preferences live in localStorage (prefs.ts). Where IndexedDB is missing or
 * refuses to open (private windows of some browsers, blocked storage, Node), the same
 * interface works in memory for the life of the page, and `kind` says so.
 */
import type {
  CallRecord,
  Doc,
  Project,
  ProjectId,
  RunEvent,
  RunRecord,
  RunStore,
  World,
} from '../agents/types';

export const DB_NAME = 'groundwork';
export const DB_VERSION = 1;

export type Persist = {
  kind: 'indexeddb' | 'memory';
  runs: RunStore;
  world: { load(): Promise<World | null>; save(world: World): Promise<void> };
  projects: {
    all(): Promise<Project[]>;
    get(id: ProjectId): Promise<Project | null>;
    save(project: Project): Promise<void>;
    remove(id: ProjectId): Promise<void>;
  };
  docs: {
    load(projectId: ProjectId): Promise<Doc[]>;
    save(projectId: ProjectId, docs: Doc[]): Promise<void>;
    remove(projectId: ProjectId): Promise<void>;
  };
};

type StoredRun = Omit<RunRecord, 'events'> & { events: [] };
type StoredDoc = { projectId: ProjectId; docId: string; order: number; doc: Doc };
type StoredEvent = RunEvent;

const stripEvents = (record: RunRecord): StoredRun => ({ ...record, events: [] });

// ------------------------------------------------------------------ IndexedDB

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

/** Opens (and on first use creates) the database. Rejects when IndexedDB is unavailable. */
export function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('world')) db.createObjectStore('world');
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('runs')) {
        const runs = db.createObjectStore('runs', { keyPath: 'id' });
        runs.createIndex('byProject', ['projectId', 'status']);
      }
      if (!db.objectStoreNames.contains('runEvents')) db.createObjectStore('runEvents', { keyPath: ['runId', 'seq'] });
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: ['projectId', 'docId'] });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema later: let it, this tab reloads its data on next open.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB did not open'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'));
  });
}

function idbPersist(db: IDBDatabase): Persist {
  const eventsOf = (runId: string): IDBKeyRange => IDBKeyRange.bound([runId, -Infinity], [runId, Infinity]);

  /** Read-modify-write of one run record in one transaction, so two writes never lose each other. */
  const updateRun = async (runId: string, change: (run: StoredRun) => void): Promise<void> => {
    const tx = db.transaction('runs', 'readwrite');
    const runs = tx.objectStore('runs');
    const run = (await request(runs.get(runId))) as StoredRun | undefined;
    if (!run) {
      tx.abort();
      await done(tx).catch(() => undefined);
      throw new Error(`persist: no run ${runId}`);
    }
    change(run);
    runs.put(run);
    await done(tx);
  };

  const runs: RunStore = {
    async load(runId) {
      const tx = db.transaction(['runs', 'runEvents'], 'readonly');
      const run = (await request(tx.objectStore('runs').get(runId))) as StoredRun | undefined;
      if (!run) return null;
      const events = (await request(tx.objectStore('runEvents').getAll(eventsOf(runId)))) as StoredEvent[];
      return { ...run, events };
    },
    async findRunning(projectId) {
      const tx = db.transaction('runs', 'readonly');
      const found = (await request(tx.objectStore('runs').index('byProject').getAll([projectId, 'running']))) as StoredRun[];
      if (found.length === 0) return null;
      // The latest one if, against the rules, there are several.
      found.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return runs.load(found[0].id);
    },
    async save(record) {
      const tx = db.transaction(['runs', 'runEvents'], 'readwrite');
      tx.objectStore('runs').put(stripEvents(record));
      const events = tx.objectStore('runEvents');
      for (const event of record.events) events.put(event);
      await done(tx);
    },
    async appendEvents(runId, list) {
      if (list.length === 0) return;
      const tx = db.transaction('runEvents', 'readwrite');
      const events = tx.objectStore('runEvents');
      for (const event of list) {
        if (event.runId !== runId) throw new Error(`persist: event of run ${event.runId} appended to ${runId}`);
        events.put(event);
      }
      await done(tx);
    },
    async saveCall(runId, call) {
      await updateRun(runId, (run) => {
        const at = run.calls.findIndex((c) => c.callId === call.callId);
        if (at >= 0) run.calls[at] = call;
        else run.calls.push(call);
      });
    },
    async savePartial(runId, key, value) {
      await updateRun(runId, (run) => {
        run.partial = { ...run.partial, [key]: value };
      });
    },
  };

  return {
    kind: 'indexeddb',
    runs,
    world: {
      async load() {
        const tx = db.transaction('world', 'readonly');
        return ((await request(tx.objectStore('world').get('world'))) as World | undefined) ?? null;
      },
      async save(world) {
        const tx = db.transaction('world', 'readwrite');
        tx.objectStore('world').put(world, 'world');
        await done(tx);
      },
    },
    projects: {
      async all() {
        const tx = db.transaction('projects', 'readonly');
        return (await request(tx.objectStore('projects').getAll())) as Project[];
      },
      async get(id) {
        const tx = db.transaction('projects', 'readonly');
        return ((await request(tx.objectStore('projects').get(id))) as Project | undefined) ?? null;
      },
      async save(project) {
        const tx = db.transaction('projects', 'readwrite');
        tx.objectStore('projects').put(project);
        await done(tx);
      },
      async remove(id) {
        const tx = db.transaction(['projects', 'docs'], 'readwrite');
        tx.objectStore('projects').delete(id);
        tx.objectStore('docs').delete(IDBKeyRange.bound([id, ''], [id, '￿']));
        await done(tx);
      },
    },
    docs: {
      async load(projectId) {
        const tx = db.transaction('docs', 'readonly');
        const rows = (await request(tx.objectStore('docs').getAll(IDBKeyRange.bound([projectId, ''], [projectId, '￿'])))) as StoredDoc[];
        return rows.sort((a, b) => a.order - b.order).map((row) => row.doc);
      },
      async save(projectId, docs) {
        const tx = db.transaction('docs', 'readwrite');
        const store = tx.objectStore('docs');
        store.delete(IDBKeyRange.bound([projectId, ''], [projectId, '￿']));
        docs.forEach((doc, order) => store.put({ projectId, docId: doc.meta.id, order, doc } satisfies StoredDoc));
        await done(tx);
      },
      async remove(projectId) {
        const tx = db.transaction('docs', 'readwrite');
        tx.objectStore('docs').delete(IDBKeyRange.bound([projectId, ''], [projectId, '￿']));
        await done(tx);
      },
    },
  };
}

// ------------------------------------------------------------------ memory

const copy = <T>(value: T): T => structuredClone(value);

/** The same interface in memory: for browsers without IndexedDB and for tests. */
export function memoryPersist(): Persist {
  let world: World | null = null;
  const projects = new Map<ProjectId, Project>();
  const runRecords = new Map<string, StoredRun>();
  const runEvents = new Map<string, Map<number, RunEvent>>();
  const docs = new Map<ProjectId, Doc[]>();

  const runs: RunStore = {
    async load(runId) {
      const run = runRecords.get(runId);
      if (!run) return null;
      const events = [...(runEvents.get(runId)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
      return copy({ ...run, events });
    },
    async findRunning(projectId) {
      const found = [...runRecords.values()]
        .filter((r) => r.projectId === projectId && r.status === 'running')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return found.length ? runs.load(found[0].id) : null;
    },
    async save(record) {
      runRecords.set(record.id, copy(stripEvents(record)));
      if (record.events.length) await runs.appendEvents(record.id, record.events);
    },
    async appendEvents(runId, list) {
      let bySeq = runEvents.get(runId);
      if (!bySeq) runEvents.set(runId, (bySeq = new Map()));
      for (const event of list) {
        if (event.runId !== runId) throw new Error(`persist: event of run ${event.runId} appended to ${runId}`);
        bySeq.set(event.seq, copy(event));
      }
    },
    async saveCall(runId, call: CallRecord) {
      const run = runRecords.get(runId);
      if (!run) throw new Error(`persist: no run ${runId}`);
      const at = run.calls.findIndex((c) => c.callId === call.callId);
      if (at >= 0) run.calls[at] = copy(call);
      else run.calls.push(copy(call));
    },
    async savePartial(runId, key, value) {
      const run = runRecords.get(runId);
      if (!run) throw new Error(`persist: no run ${runId}`);
      run.partial = { ...run.partial, [key]: copy(value) };
    },
  };

  return {
    kind: 'memory',
    runs,
    world: {
      async load() {
        return world ? copy(world) : null;
      },
      async save(next) {
        world = copy(next);
      },
    },
    projects: {
      async all() {
        return [...projects.values()].map(copy);
      },
      async get(id) {
        const found = projects.get(id);
        return found ? copy(found) : null;
      },
      async save(project) {
        projects.set(project.id, copy(project));
      },
      async remove(id) {
        projects.delete(id);
        docs.delete(id);
      },
    },
    docs: {
      async load(projectId) {
        return copy(docs.get(projectId) ?? []);
      },
      async save(projectId, list) {
        docs.set(projectId, copy(list));
      },
      async remove(projectId) {
        docs.delete(projectId);
      },
    },
  };
}

// ------------------------------------------------------------------ the one instance

/**
 * Opens storage: IndexedDB when it works, memory otherwise. The second call returns the
 * same promise. Pass a factory in tests (fake-indexeddb).
 */
export function createPersist(factory: IDBFactory | null | undefined = globalThis.indexedDB): Promise<Persist> {
  if (!factory) return Promise.resolve(memoryPersist());
  return openDb(factory).then(
    (db) => idbPersist(db),
    (error: unknown) => {
      console.warn('[gw] IndexedDB is not available, keeping work in memory for this page', error);
      return memoryPersist();
    },
  );
}

let shared: Promise<Persist> | null = null;

/** The storage of this page. */
export function persist(): Promise<Persist> {
  shared ??= createPersist();
  return shared;
}
