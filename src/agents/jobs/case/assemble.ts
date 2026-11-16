/**
 * The assembly table (PLAN "Трудный механизм", step assemble): the CaseResult with its
 * lanes, events, contradictions, explained pairs, open questions, the audit list and
 * what was dropped, the case window, both kinds of dates ahead, coverage and RunStats.
 * The summary line is written by code from the counters; no model call writes it.
 */
import type { CaseEvent, CasePlan, CaseResult, CheckedItem, Contradiction, Deadline, Doc, Explained, ExtractedEvent, OpenAsk, Page, RunStats } from '../../types';
import { addDays } from '../../checks/dates';
import type { CaseWindow } from '../../checks/date';
import { countClaims, emptyStats, type ClaimTrack } from '../../checks/counters';
import { coverage, type AcceptedQuote } from '../../checks/coverage';
import { documentDeadlines, REVIEW_DAYS } from '../../deadlines';
import { byTime } from './edits';

export type AssembleInput = {
  plan: CasePlan;
  docs: readonly Doc[];
  pages: readonly Page[];
  events: readonly CaseEvent[];
  contradictions: readonly Contradiction[];
  explained: readonly Explained[];
  open: readonly OpenAsk[];
  audit: readonly CheckedItem[];
  restorable: Record<string, ExtractedEvent>;
  tracks: readonly ClaimTrack[];
  accepted: readonly AcceptedQuote[];
  window: CaseWindow | null;
  pairs: number;
  asked: number;
  pagesUnread: number[];
  checkMs: number;
  /** firstRunAt of the project, or the start of this run when it is the first. */
  firstRunAt: string;
  indices: { batch: number; reconcile: number };
  pageHashes: Record<string, string>;
};

export function assembleCase(input: AssembleInput): CaseResult {
  const docDates = Object.fromEntries(input.docs.map((d) => [d.meta.id, d.meta.date]));
  const cov = coverage(input.pages, input.accepted, docDates);
  const counts = countClaims(input.tracks);
  const stats: RunStats = {
    ...emptyStats(input.pages.length),
    ...counts,
    events: input.events.length,
    pagesUnread: [...input.pagesUnread].sort((a, b) => a - b),
    checkMs: Math.round(input.checkMs),
    pairs: input.pairs,
    contradictions: input.contradictions.length,
    explained: input.explained.length,
    asked: input.asked,
    coverage: { datedPassages: cov.datedPassages, covered: cov.covered, pagesWithoutEvents: cov.pagesWithoutEvents },
  };
  const review: Deadline = {
    id: 'review',
    kind: 'review',
    date: addDays(input.firstRunAt.slice(0, 10), REVIEW_DAYS),
    label: 'Review due',
  };
  const rejected = input.audit.filter((i) => i.status === 'dropped' && !i.seeded && i.kind === 'claim');
  return {
    parties: input.plan.parties,
    topics: input.plan.topics,
    fields: input.plan.fields,
    docs: input.docs.map((d) => d.meta),
    events: [...input.events].sort(byTime),
    contradictions: [...input.contradictions],
    explained: [...input.explained],
    open: [...input.open],
    audit: [...input.audit],
    rejected,
    window: input.window ?? { from: '', to: '' },
    deadlines: [...documentDeadlines(input.pages, input.docs), review],
    stats,
    indices: input.indices,
    pageHashes: input.pageHashes,
    restorable: Object.fromEntries(Object.entries(input.restorable).filter(([id]) => rejected.some((r) => r.id === id))),
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Harbor Street, Unit 4B: 64 pages in 12 documents, 6 people, 119 checked events,
 * 6 places where the accounts don't match." Contradictions set aside or resolved are
 * not counted.
 */
export function summaryLine(result: CaseResult, title?: string): string {
  const conflicts = result.contradictions.filter((c) => c.state === 'open' && c.review !== 'dismissed').length;
  const where = conflicts === 0 ? "no places where the accounts don't match" : plural(conflicts, "place where the accounts don't match", "places where the accounts don't match");
  const body = [
    `${plural(result.stats.pages, 'page', 'pages')} in ${plural(result.docs.length, 'document', 'documents')}`,
    plural(result.parties.length, 'person', 'people'),
    plural(result.events.length, 'checked event', 'checked events'),
    where,
  ].join(', ');
  return `${title ? title + ': ' : ''}${body}.`;
}
