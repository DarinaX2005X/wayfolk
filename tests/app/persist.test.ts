/**
 * src/app/persist.ts on fake-indexeddb, and the same interface in memory: runs with
 * their events kept apart, calls and partial results written without losing each other,
 * the running run of a project found by the index, projects and own pages.
 */
import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { CallRecord, Doc, Project, RunEvent, RunRecord } from '../../src/agents/types';
import { createPersist, memoryPersist, type Persist } from '../../src/app/persist';

const run = (id: string, projectId: string, status: RunRecord['status'] = 'running', startedAt = '2026-11-16T10:00:00.000Z'): RunRecord => ({
  id,
  job: 'case',
  example: 'harbor-street',
  projectId,
  scope: 'full',
  startedAt,
  answers: 'scripted',
  provider: 'script',
  model: null,
  status,
  calls: [],
  events: [],
  partial: {},
  asks: {},
  result: null,
  stats: null,
});

const note = (runId: string, seq: number): RunEvent => ({ runId, seq, t: seq * 10, type: 'note', station: 's1', source: 'Reader', text: `line ${seq}` });

const call = (callId: string, ms: number): CallRecord => ({
  callId,
  task: 'extract',
  index: 1,
  attempt: 1,
  reqHash: 'a1b2c3d4',
  ms,
  ok: true,
  json: { events: [] },
  provider: 'script',
  model: 'scripted',
});

const project = (id: string): Project => ({
  id,
  kind: 'case',
  title: 'Harbor Street, Unit 4B',
  goal: "Find where the stories don't match",
  example: 'harbor-street',
  sample: true,
  slug: 'harbor-street',
  createdAt: '2026-11-16T10:00:00.000Z',
  updatedAt: '2026-11-16T10:00:00.000Z',
  rev: 1,
  firstRunAt: null,
  visibility: 'private',
  status: 'draft',
  materials: [],
  materialHash: 'h',
  runId: null,
  passes: 0,
  result: null,
  edits: [],
  notes: [],
});

const doc = (id: string, pages: number): Doc => ({
  meta: { id, title: id, kind: 'letter', from: 1, to: pages },
  pages: Array.from({ length: pages }, (_, i) => ({ docId: id, n: i + 1, text: `${id} page ${i + 1}` })),
});

const kinds: [string, () => Promise<Persist>][] = [
  ['IndexedDB', () => createPersist(new IDBFactory())],
  ['memory', async () => memoryPersist()],
];

describe.each(kinds)('persist on %s', (kind, open) => {
  it('opens the right kind of storage', async () => {
    expect((await open()).kind).toBe(kind === 'IndexedDB' ? 'indexeddb' : 'memory');
  });

  it('keeps events apart from the run and gathers them back in seq order', async () => {
    const p = await open();
    await p.runs.save(run('r1', 'p_a'));
    await p.runs.appendEvents('r1', [note('r1', 2), note('r1', 0)]);
    await p.runs.appendEvents('r1', [note('r1', 1), note('r1', 3)]);
    const loaded = await p.runs.load('r1');
    expect(loaded?.events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
    // Saving the run again with no events does not drop the stored ones.
    await p.runs.save({ ...(loaded as RunRecord), events: [], status: 'ready' });
    expect((await p.runs.load('r1'))?.events).toHaveLength(4);
    expect((await p.runs.load('r1'))?.status).toBe('ready');
  });

  it('does not mix events of two runs', async () => {
    const p = await open();
    await p.runs.save(run('a', 'p_a'));
    await p.runs.save(run('b', 'p_b'));
    await p.runs.appendEvents('a', [note('a', 0)]);
    await p.runs.appendEvents('b', [note('b', 0), note('b', 1)]);
    expect((await p.runs.load('a'))?.events).toHaveLength(1);
    await expect(p.runs.appendEvents('a', [note('b', 5)])).rejects.toThrow();
  });

  it('writes calls and partial results without losing a concurrent write', async () => {
    const p = await open();
    await p.runs.save(run('r2', 'p_a'));
    await Promise.all([
      p.runs.saveCall('r2', call('extract/1/1', 5000)),
      p.runs.savePartial('r2', 'batch:1', { claims: 12 }),
      p.runs.saveCall('r2', call('extract/2/1', 6000)),
      p.runs.savePartial('r2', 'batch:2', { claims: 9 }),
    ]);
    await p.runs.saveCall('r2', call('extract/1/1', 5100));
    const loaded = await p.runs.load('r2');
    expect(loaded?.calls.map((c) => [c.callId, c.ms])).toEqual([
      ['extract/1/1', 5100],
      ['extract/2/1', 6000],
    ]);
    expect(loaded?.partial).toEqual({ 'batch:1': { claims: 12 }, 'batch:2': { claims: 9 } });
    await expect(p.runs.saveCall('missing', call('x', 1))).rejects.toThrow();
  });

  it('finds the running run of a project and nothing for a finished one', async () => {
    const p = await open();
    await p.runs.save(run('old', 'p_x', 'ready'));
    expect(await p.runs.findRunning('p_x')).toBeNull();
    await p.runs.save(run('new', 'p_x', 'running', '2026-11-16T11:00:00.000Z'));
    await p.runs.save(run('other', 'p_y', 'running'));
    expect((await p.runs.findRunning('p_x'))?.id).toBe('new');
    expect(await p.runs.load('nope')).toBeNull();
  });

  it('keeps projects, the world and own pages, and removes pages with their project', async () => {
    const p = await open();
    await p.projects.save(project('p_1'));
    await p.projects.save({ ...project('p_2'), title: 'Second' });
    expect((await p.projects.all()).map((x) => x.id).sort()).toEqual(['p_1', 'p_2']);
    await p.docs.save('p_1', [doc('lease', 2), doc('email', 1)]);
    await p.docs.save('p_2', [doc('letter', 1)]);
    expect((await p.docs.load('p_1')).map((d) => d.meta.id)).toEqual(['lease', 'email']);
    await p.projects.remove('p_1');
    expect(await p.projects.get('p_1')).toBeNull();
    expect(await p.docs.load('p_1')).toEqual([]);
    expect(await p.docs.load('p_2')).toHaveLength(1);
    expect(await p.world.load()).toBeNull();
    await p.world.save({ name: 'local', title: 'My island', createdAt: 'x', rev: 1, plots: [], rotation: 0, onServer: false });
    expect((await p.world.load())?.title).toBe('My island');
  });

  it('returns copies, so a caller changing a loaded record does not change the store', async () => {
    const p = await open();
    await p.projects.save(project('p_c'));
    const loaded = await p.projects.get('p_c');
    loaded!.title = 'changed';
    expect((await p.projects.get('p_c'))?.title).toBe('Harbor Street, Unit 4B');
  });
});

describe('persist without IndexedDB', () => {
  it('falls back to memory when there is no IndexedDB or it refuses to open', async () => {
    expect((await createPersist(null)).kind).toBe('memory');
    const broken = { open: () => { throw new Error('blocked'); } } as unknown as IDBFactory;
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      expect((await createPersist(broken)).kind).toBe('memory');
    } finally {
      console.warn = warn;
    }
  });
});
