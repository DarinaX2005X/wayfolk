import { beforeEach, describe, expect, it } from 'vitest';
import { equalityProblems } from '../../src/agents/checks/counters';
import { LlmError, RunLockedError } from '../../src/agents/llm-error';
import { memoryLocks } from '../../src/agents/locks';
import { replayRun } from '../../src/agents/replay';
import { resetRunsForTests, resumeRun, startRun } from '../../src/agents/runner';
import { memoryRunStore } from '../../src/agents/store';
import type { AnswerSet, CallRecord, RunEvent, RunRecord } from '../../src/agents/types';
import { batchPages } from '../../src/materials/batches';
import { fakeModel, meterClaim, meterDocs, meterPlan, meterProject, offline } from './fixtures/meter';
import { deps, manualTimers, settle } from './helpers';

beforeEach(() => resetRunsForTests());

const of = <T extends RunEvent['type']>(r: RunRecord, type: T) => r.events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);

/** Recorded answers for a meter case: plan and every batch, `ms` each. */
function meterSet(pages: number, ms = 0): AnswerSet {
  const calls: CallRecord[] = [{ callId: 'plan/1/1', task: 'plan', index: 1, attempt: 1, reqHash: '', ms, ok: true, json: meterPlan, provider: 'script', model: 'script' }];
  for (const b of batchPages(meterDocs(pages)[0].pages)) {
    const events = b.numbers.map((n) => meterClaim(n));
    calls.push({ callId: `extract/${b.index}/1`, task: 'extract', index: b.index, attempt: 1, reqHash: '', ms, ok: true, json: { events }, provider: 'script', model: 'script' });
  }
  return { example: 'harbor-street', scope: 'full', answers: 'scripted', materialHash: '', calls };
}

/** A promise the test opens by hand. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { p, open };
}

async function until(test: () => boolean | Promise<boolean>, rounds = 400): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    if (await test()) return;
    await settle(1);
  }
  throw new Error('condition not reached');
}

describe('runner', () => {
  it('continues after a break in the middle of extraction without repeating calls', async () => {
    const hold = gate();
    const modelA = fakeModel({ delay: (req) => (req.task === 'extract' && req.index >= 3 ? hold.p : Promise.resolve()) });
    const store = memoryRunStore();
    const h = await startRun({ project: meterProject(), docs: meterDocs(30), scope: 'full', answers: 'live' }, deps({ llm: modelA, store }));
    await until(async () => Boolean((await store.load(h.id))?.partial['batch:2']));
    // The page goes away here: what the store holds is all that is left.
    const snapshot = (await store.load(h.id))!;
    h.cancel();
    expect(snapshot.status).toBe('running');
    const lastT = snapshot.events[snapshot.events.length - 1].t;

    resetRunsForTests();
    const storeB = memoryRunStore();
    await storeB.save(snapshot);
    const modelB = fakeModel();
    const resumed = await resumeRun(h.id, deps({ llm: modelB, store: storeB }));
    const record = await resumed!.done;
    expect(record.status).toBe('ready');
    expect(modelB.calls.map((c) => `${c.task}/${c.index}`)).toEqual(['extract/3', 'extract/4', 'extract/5']);
    expect(record.stats!.events).toBe(30);
    expect(of(record, 'tile')).toHaveLength(record.stats!.tiles);
    expect(new Set(of(record, 'tile').map((t) => t.i)).size).toBe(30);
    const seqs = record.events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(record.events.find((e) => e.seq === snapshot.events.length)!.t).toBeGreaterThanOrEqual(lastT);
    expect(equalityProblems(record.stats!)).toEqual([]);
    hold.open();
  });

  it('after the first 429 works in two streams and says so', async () => {
    let hit = false;
    const after: number[] = [];
    const model = fakeModel({
      fail: (req) => {
        if (!hit && req.task === 'extract' && req.index === 1) {
          hit = true;
          return new LlmError('rate-limited', 5);
        }
        return null;
      },
      delay: async () => {
        if (hit) after.push(model.inFlight);
        await new Promise((r) => setTimeout(r, 3));
      },
    });
    const h = await startRun({ project: meterProject(), docs: meterDocs(60), scope: 'full', answers: 'live' }, deps({ llm: model }));
    const record = await h.done;
    expect(record.status).toBe('ready');
    expect(of(record, 'waiting')[0]).toMatchObject({ reason: 'rate-limited', retryInMs: 5, callId: 'extract/1/1' });
    expect(of(record, 'note').some((n) => n.text.startsWith('The model asked us to slow down'))).toBe(true);
    expect(after.length).toBeGreaterThan(3);
    expect(Math.max(...after)).toBeLessThanOrEqual(2);
    expect(record.stats!.events).toBe(60);
  });

  it('asks again after a bad answer, then splits the batch in half', async () => {
    const model = fakeModel({ fail: (req) => (req.task === 'extract' && req.index === 1 && req.attempt <= 2 ? 'bad' : null) });
    const record = await (await startRun({ project: meterProject(), docs: meterDocs(12), scope: 'full', answers: 'live' }, deps({ llm: model }))).done;
    expect(of(record, 'note').filter((n) => n.text === 'Extractor is asked to answer again.')).toHaveLength(1);
    expect(model.calls.filter((c) => c.task === 'extract' && c.index === 1).map((c) => [c.attempt, c.pages])).toEqual([
      [1, [1, 6]],
      [2, [1, 6]],
      [3, [1, 3]],
      [4, [4, 6]],
    ]);
    expect(of(record, 'call-end').filter((e) => !e.ok).map((e) => e.code)).toEqual(['bad-output', 'bad-output']);
    expect(record.status).toBe('ready');
    expect(record.stats!.events).toBe(12);
  });

  it('reports pages it could not read when the halves fail too', async () => {
    const model = fakeModel({ fail: (req) => (req.task === 'extract' && req.index === 2 ? 'bad' : null) });
    const record = await (await startRun({ project: meterProject(), docs: meterDocs(12), scope: 'full', answers: 'live' }, deps({ llm: model }))).done;
    expect(of(record, 'error').map((e) => e.pages)).toEqual([[7, 9], [10, 12]]);
    expect(of(record, 'note').filter((n) => n.key).map((n) => n.text)).toEqual(["Pages 7–9 couldn't be read.", "Pages 10–12 couldn't be read."]);
    expect(record.status).toBe('partial');
    expect(record.stats!.pagesUnread).toEqual([7, 8, 9, 10, 11, 12]);
    expect(record.stats!.events).toBe(6);
  });

  it('keeps to the call budget by skipping second looks, never extraction', async () => {
    const model = fakeModel({
      fail: (req) => (req.task === 'extract' && req.attempt <= 2 ? 'bad' : null),
      broken: (page) => page === 1 || page === 7 || page === 13,
    });
    const record = await (await startRun({ project: meterProject(), docs: meterDocs(60), scope: 'full', answers: 'live' }, deps({ llm: model }))).done;
    expect(model.calls.filter((c) => c.task === 'recheck')).toHaveLength(0);
    expect(model.calls.filter((c) => c.task === 'extract')).toHaveLength(40);
    const dropped = of(record, 'item').filter((e) => e.item.status === 'dropped');
    expect(dropped.map((e) => e.item.dropCause)).toEqual(['budget', 'budget', 'budget']);
    expect(of(record, 'note').find((n) => n.text.startsWith('Call budget reached'))?.text).toBe('Call budget reached. 3 second looks were skipped.');
    expect(record.stats!.events).toBe(57);
    expect(equalityProblems(record.stats!)).toEqual([]);
  });

  it('returns the same handle on a double start', async () => {
    const hold = gate();
    const model = fakeModel({ delay: () => hold.p });
    const d = deps({ llm: model });
    const spec = { project: meterProject(), docs: meterDocs(6), scope: 'full' as const, answers: 'live' as const };
    const [a, b] = await Promise.all([startRun(spec, d), startRun(spec, d)]);
    const c = await startRun(spec, d);
    expect(b.id).toBe(a.id);
    expect(c.id).toBe(a.id);
    hold.open();
    await a.done;
    expect(model.calls.filter((x) => x.task === 'plan')).toHaveLength(1);
  });

  it('refuses a second tab while the first one runs the job', async () => {
    const hold = gate();
    const locks = memoryLocks();
    const store = memoryRunStore();
    const spec = { project: meterProject(), docs: meterDocs(6), scope: 'full' as const, answers: 'live' as const };
    const first = await startRun(spec, deps({ llm: fakeModel({ delay: () => hold.p }), locks, store }));
    resetRunsForTests(); // another tab: same lock manager and storage, no runs in memory
    await expect(startRun(spec, deps({ llm: fakeModel(), locks, store }))).rejects.toBeInstanceOf(RunLockedError);
    hold.open();
    await first.done;
  });

  it('cancels: no new calls, run-end cancelled, finished batches stay saved', async () => {
    const hold = gate();
    const model = fakeModel({ delay: (req) => (req.task === 'extract' && req.index >= 2 ? hold.p : Promise.resolve()) });
    const store = memoryRunStore();
    const h = await startRun({ project: meterProject(), docs: meterDocs(30), scope: 'full', answers: 'live' }, deps({ llm: model, store }));
    await until(() => Boolean(h.record().partial['batch:1']));
    h.cancel();
    const record = await h.done;
    expect(record.status).toBe('cancelled');
    expect(of(record, 'run-end')[0].status).toBe('cancelled');
    expect((await store.load(h.id))!.partial['batch:1']).toBeTruthy();
    const calls = model.calls.length;
    hold.open();
    await settle();
    expect(model.calls.length).toBe(calls);
  });

  it('skip ends the waits of recorded answers at once', async () => {
    const mt = manualTimers();
    const h = await startRun({ project: meterProject(), docs: meterDocs(12), scope: 'full', answers: meterSet(12, 5000), pace: 1 }, deps({ timers: mt.timers, now: mt.now }));
    await mt.advance(100);
    expect(of(h.record(), 'call-end')).toHaveLength(0);
    h.skip();
    for (let i = 0; i < 50 && h.record().status === 'running'; i++) await mt.advance(0);
    const record = await h.done;
    expect(record.status).toBe('ready');
    expect(mt.now()).toBeLessThan(1000);
  });

  it('pause in the middle of a wait holds the recorded answer', async () => {
    const mt = manualTimers();
    const h = await startRun({ project: meterProject(), docs: meterDocs(6), scope: 'full', answers: meterSet(6, 1000), pace: 1 }, deps({ timers: mt.timers, now: mt.now }));
    await mt.advance(500);
    h.pause(true);
    expect(h.paused).toBe(true);
    await mt.advance(10_000);
    expect(of(h.record(), 'call-end')).toHaveLength(0);
    h.pause(false);
    await mt.advance(499);
    expect(of(h.record(), 'call-end')).toHaveLength(0);
    await mt.advance(1);
    expect(of(h.record(), 'call-end')).toHaveLength(1);
    for (let i = 0; i < 20 && h.record().status === 'running'; i++) await mt.advance(1000);
    expect((await h.done).status).toBe('ready');
  });

  it('falls back to recorded answers in the middle of a live run', async () => {
    const model = fakeModel({ fail: (req) => (req.task === 'extract' && req.index === 2 ? offline() : null) });
    const record = await (await startRun({ project: meterProject(), docs: meterDocs(18), scope: 'full', answers: 'live' }, deps({ llm: model, fallback: meterSet(18) }))).done;
    expect(of(record, 'fallback')).toEqual([expect.objectContaining({ to: 'recorded', reason: 'agents-offline' })]);
    expect(record.status).toBe('ready');
    expect(record.stats!.events).toBe(18);
    expect(record.calls.find((c) => c.callId === 'extract/2/1')?.provider).toBe('script');
  });

  it('without recorded answers to fall back on, a live failure stops with what is done', async () => {
    const model = fakeModel({ fail: (req) => (req.task === 'extract' && req.index === 2 ? offline() : null) });
    const record = await (await startRun({ project: meterProject(), docs: meterDocs(12), scope: 'full', answers: 'live' }, deps({ llm: model }))).done;
    expect(of(record, 'error')[0]).toMatchObject({ code: 'agents-offline', retryable: true, pages: [7, 12] });
    expect(record.status).toBe('partial');
    expect(record.stats!.events).toBe(6);
  });

  it('writes events in batches, and right after every call-end', async () => {
    const store = memoryRunStore();
    const record = await (await startRun({ project: meterProject(), docs: meterDocs(30), scope: 'full', answers: meterSet(30), pace: 0 }, deps({ store }))).done;
    const saved = (await store.load(record.id))!;
    expect(saved.events).toHaveLength(record.events.length);
    expect(store.writes.appendEvents).toBeLessThan(record.events.length / 4);
    expect(store.writes.appendEvents).toBeGreaterThanOrEqual(of(record, 'call-end').length);
  });

  it('replays a saved copy of a run on the emergency path, with pause and skip', async () => {
    const saved = (await (await startRun({ project: meterProject(), docs: meterDocs(12), scope: 'full', answers: meterSet(12, 2000), pace: 0 }, deps())).done).events;
    const mt = manualTimers();
    const seen: RunEvent[] = [];
    const shifted = saved.map((e, i) => ({ ...e, t: i * 100 }));
    const h = replayRun(shifted, { timers: mt.timers, now: mt.now });
    h.subscribe((e) => seen.push(e));
    await mt.advance(450);
    expect(seen.length).toBe(5);
    h.pause(true);
    await mt.advance(5000);
    expect(seen.length).toBe(5);
    h.pause(false);
    h.skip();
    await mt.advance(0);
    const record = await h.done;
    expect(seen).toHaveLength(saved.length);
    expect(record.status).toBe('ready');
    expect(record.stats!.events).toBe(12);
  });
});
