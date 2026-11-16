/**
 * A RunStore in memory, for Node scripts (01.7 runs the engine with pace 0) and tests.
 * The page uses the IndexedDB store of src/app/persist.ts behind the same interface.
 */
import type { CallRecord, RunEvent, RunRecord, RunStore } from './types';

const copy = <T>(v: T): T => structuredClone(v);

export type MemoryRunStore = RunStore & {
  /** Every write, for tests that count them. */
  readonly writes: { save: number; appendEvents: number; saveCall: number; savePartial: number };
};

export function memoryRunStore(): MemoryRunStore {
  const runs = new Map<string, RunRecord>();
  const writes = { save: 0, appendEvents: 0, saveCall: 0, savePartial: 0 };
  const get = (id: string) => {
    const r = runs.get(id);
    if (!r) throw new Error(`run store: no run ${id}`);
    return r;
  };
  return {
    writes,
    async load(runId) {
      const r = runs.get(runId);
      return r ? copy(r) : null;
    },
    async findRunning(projectId) {
      const found = [...runs.values()]
        .filter((r) => r.projectId === projectId && r.status === 'running')
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return found.length ? copy(found[0]) : null;
    },
    async save(record) {
      writes.save++;
      const prev = runs.get(record.id);
      const events = new Map<number, RunEvent>((prev?.events ?? []).map((e) => [e.seq, e]));
      for (const e of record.events) events.set(e.seq, e);
      runs.set(record.id, copy({ ...record, events: [...events.values()].sort((a, b) => a.seq - b.seq) }));
    },
    async appendEvents(runId, events) {
      writes.appendEvents++;
      const r = get(runId);
      const seen = new Set(r.events.map((e) => e.seq));
      for (const e of events) if (!seen.has(e.seq)) r.events.push(copy(e));
      r.events.sort((a, b) => a.seq - b.seq);
    },
    async saveCall(runId, call: CallRecord) {
      writes.saveCall++;
      const r = get(runId);
      const at = r.calls.findIndex((c) => c.callId === call.callId);
      if (at >= 0) r.calls[at] = copy(call);
      else r.calls.push(copy(call));
    },
    async savePartial(runId, key, value) {
      writes.savePartial++;
      const r = get(runId);
      r.partial = { ...r.partial, [key]: copy(value) };
    },
  };
}
