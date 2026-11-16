import { beforeEach, describe, expect, it } from 'vitest';
import { applyEdits } from '../../src/agents/jobs/case/edits';
import { candidates } from '../../src/agents/jobs/case/candidates';
import { resetRunsForTests, startRun } from '../../src/agents/runner';
import type { CaseEvent, CaseResult, Edit, Note, Project } from '../../src/agents/types';
import { willowClaims, willowDocs, willowLateClaims, willowLateDoc, willowLatePage, willowLateSet, willowPages, willowPlan, willowProject } from './fixtures/willow';
import { deps, idOf, runWillow } from './helpers';

beforeEach(() => resetRunsForTests());

const allPages = () => [...willowPages(), willowLatePage()];

/** Verdicts for the three late pairs: the new fee against $120 explained, the new visit a contradiction with 2 March. */
function lateVerdicts() {
  const old = willowClaims();
  const fresh = willowLateClaims();
  const ev = (c: (typeof old)[number]) => ({ id: idOf(c, allPages()), facts: c.facts, at: c.date || null }) as unknown as CaseEvent;
  const pairs = candidates([ev(old[1]), ev(old[3]), ev(old[4]), ev(fresh[0]), ev(fresh[1])], willowPlan.fields, new Set([idOf(fresh[0], allPages()), idOf(fresh[1], allPages())]));
  const visitWithFee = idOf(old[1], allPages());
  return pairs.map((p) => ({
    pairKey: p.key,
    verdict: p.field === 'visit.date' && p.key.includes(visitWithFee) ? 'contradiction' : 'explained',
    explanation: 'scripted',
  }));
}

async function firstRun(edits: Edit[] = []): Promise<Project> {
  const { record } = await runWillow({ answer: null });
  return willowProject({ result: record.result as CaseResult, firstRunAt: '2026-11-10T09:00:00Z', passes: 1, edits, status: 'ready' });
}

async function late(project: Project, set = willowLateSet(lateVerdicts())) {
  resetRunsForTests();
  const h = await startRun({ project, docs: [...willowDocs(), willowLateDoc()], scope: { pages: [4] }, answers: set, pace: 0 }, deps());
  const record = await h.done;
  return { record, result: record.result as CaseResult, note: record.partial.note as Note };
}

describe('late pages', () => {
  it('one page adds events, resolves one contradiction and adds one', async () => {
    const project = await firstRun();
    const before = project.result as CaseResult;
    const { record, result, note } = await late(project);
    expect(record.status).toBe('ready');
    expect(record.events.find((e) => e.type === 'plan')).toMatchObject({ stations: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] });
    expect(record.calls.map((c) => c.callId)).toEqual(['extract/2/1', 'reconcile/2/1']);
    expect(result.events).toHaveLength(before.events.length + 2);
    expect(result.events.filter((e) => e.pass === 2)).toHaveLength(2);
    const fee = result.contradictions.find((c) => c.field === 'fee.amount')!;
    expect(fee).toMatchObject({ state: 'resolved', resolvedBy: { docId: 'letter2', page: 4 } });
    const added = result.contradictions.filter((c) => c.origin === 'late-pages');
    expect(added).toHaveLength(1);
    expect(added[0].field).toBe('visit.date');
    // The invented claim is dropped at once: there is no second look on late pages.
    expect(record.events.filter((e) => e.type === 'item' && e.item.status === 'dropped')).toHaveLength(1);
    expect(note.text).toBe('1 new page was read. 2 new events. 1 contradiction resolved, 1 new.');
    expect(note.diff).toMatchObject({ pages: 1, rejected: 1, resolved: [fee.key], contradictions: [added[0].key] });
    expect(result.indices).toEqual({ batch: 2, reconcile: 2 });
  });

  it('a pair kept by the person stays kept when resolved, and "reopened" opens it again', async () => {
    const pre = await firstRun();
    const key = (pre.result as CaseResult).contradictions[0].key;
    const kept: Edit = { id: 'e1', at: '2026-11-11T10:00:00Z', by: 'me', source: 'hand', kind: 'pair-review', key, verdict: 'kept' };
    const { result } = await late({ ...pre, edits: [kept] });
    const view = applyEdits(result, [kept]);
    expect(view.contradictions.find((c) => c.key === key)).toMatchObject({ state: 'resolved', review: 'kept', values: ['180', '120'] });
    const reopened: Edit = { id: 'e2', at: '2026-11-12T10:00:00Z', by: 'me', source: 'hand', kind: 'pair-review', key, verdict: 'reopened' };
    const again = applyEdits(result, [kept, reopened]).contradictions.find((c) => c.key === key)!;
    expect(again.state).toBe('open');
    expect(again.review).toBe('kept');
    expect(again.resolvedBy).toBeUndefined();
  });

  it('the same page read again changes nothing', async () => {
    const project = await firstRun();
    const once = await late(project);
    const twice = await late({ ...project, result: once.result, passes: 2 }, { ...willowLateSet([]), calls: [] });
    expect(twice.record.status).toBe('ready');
    expect(twice.record.calls).toHaveLength(0);
    expect(twice.result.events).toHaveLength(once.result.events.length);
    expect(twice.result.contradictions).toEqual(once.result.contradictions);
    expect(twice.note.text).toBe('These pages were read before. Nothing changed in the chronology.');
  });
});
