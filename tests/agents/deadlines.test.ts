import { describe, expect, it } from 'vitest';
import { deadlineLine, deadlineNote, documentDeadlines, nextDeadline, reviewDue, reviewLine } from '../../src/agents/deadlines';
import { emptyStats } from '../../src/agents/checks/counters';
import type { CaseResult, Contradiction, Note, Project, SeatingResult } from '../../src/agents/types';
import { willowDocs, willowPages, willowProject } from './fixtures/willow';

/** A local day of the device at noon. */
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

const contradiction = (key: string): Contradiction => ({
  key, a: 'a', b: 'b', topic: 't', field: 'f', label: 'F', kind: 'direct', values: ['1', '2'], explanation: '', origin: 'agents',
  state: 'open', supports: [], review: 'open',
});

function caseResult(open: number, extra: Partial<CaseResult> = {}): CaseResult {
  return {
    parties: [], topics: [], fields: [], docs: [], events: [], explained: [], open: [], audit: [], rejected: [],
    contradictions: Array.from({ length: open }, (_, i) => contradiction(`k${i}`)),
    window: { from: '2025-08-04', to: '2027-03-18' },
    deadlines: [
      { id: 'evidence-due', kind: 'document', date: '2027-03-04', label: 'Evidence due', source: { docId: 'notice', page: 64 } },
      { id: 'hearing', kind: 'document', date: '2027-03-18', label: 'Hearing', source: { docId: 'notice', page: 64 } },
    ],
    stats: emptyStats(64),
    ...extra,
  };
}

const project = (result: CaseResult, over: Partial<Project> = {}): Project =>
  willowProject({ result, firstRunAt: '2026-11-10T09:00:00.000Z', ...over });

describe('dates from the documents', () => {
  it('finds dates after the last document next to deadline words', () => {
    const found = documentDeadlines(willowPages(), willowDocs());
    expect(found).toEqual([{ id: 'hearing', kind: 'document', date: '2026-06-18', label: 'Hearing', source: { docId: 'statement', page: 3 } }]);
  });

  it('counts days to the next one from the device clock: 105 days, 12 days, then passed', () => {
    const r = caseResult(6);
    expect(deadlineLine(r, day(2026, 11, 19))).toBe('Ahead: evidence due 4 Mar 2027, in 105 days');
    expect(nextDeadline(r, day(2027, 2, 20))).toMatchObject({ days: 12, deadline: { id: 'evidence-due' } });
    expect(deadlineLine(r, day(2027, 3, 5))).toBe('Ahead: hearing 18 Mar 2027, in 13 days');
    expect(deadlineLine(r, day(2027, 3, 20))).toBe('The hearing date has passed.');
  });
});

describe('the review date', () => {
  it('is firstRunAt plus 7 days while something is open', () => {
    expect(reviewDue(project(caseResult(6)))).toBe('2026-11-17');
    expect(reviewDue(project(caseResult(0)))).toBeNull();
    const reviewed = project(caseResult(1), { edits: [{ id: 'x', at: '', by: 'me', source: 'hand', kind: 'pair-review', key: 'k0', verdict: 'dismissed' }] });
    expect(reviewDue(reviewed)).toBeNull();
  });

  it('says how far it is: 6 days, 2 days, today, after', () => {
    const p = project(caseResult(6));
    expect(reviewLine(p, day(2026, 11, 11))).toBe('Review due in 6 days. 6 contradictions are open.');
    expect(reviewLine(p, day(2026, 11, 15))).toBe('Review due in 2 days. 6 contradictions are open.');
    expect(reviewLine(p, day(2026, 11, 17))).toBe('Review due today.');
    const four = project(caseResult(4));
    expect(reviewLine(four, day(2026, 11, 19))).toBe('Review was due 2 days ago. 4 contradictions are still open.');
  });

  it('works for a seating with open questions', () => {
    const seating = { questions: [{ id: 'q1', wishId: 'w1', text: 'Which Rosa?', options: [] }], wishes: [] } as unknown as SeatingResult;
    const p = willowProject({ kind: 'seating', result: seating, firstRunAt: '2026-11-10T09:00:00.000Z' });
    expect(reviewLine(p, day(2026, 11, 16))).toBe('Review due in 1 day. 1 seating question is open.');
  });
});

describe('deadline notes', () => {
  it('come two days before the review, or 14 days before a document date, once a day', () => {
    const p = project(caseResult(6));
    expect(deadlineNote(p, day(2026, 11, 11))).toBeNull();
    const note = deadlineNote(p, day(2026, 11, 15))!;
    expect(note).toMatchObject({ kind: 'deadline', by: 'deadline', text: 'Review due in 2 days. 6 contradictions are open.', read: false });
    expect(deadlineNote({ ...p, notes: [note as Note] }, day(2026, 11, 15))).toBeNull();
    const nothingOpen = project(caseResult(0));
    expect(deadlineNote(nothingOpen, day(2027, 2, 20))?.text).toBe('Ahead: evidence due 4 Mar 2027, in 12 days');
    expect(deadlineNote(nothingOpen, day(2027, 1, 20))).toBeNull();
  });
});
