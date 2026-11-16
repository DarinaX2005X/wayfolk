/**
 * Two kinds of dates ahead (01.4.5, PLAN "Результат дела"):
 *
 *   from the documents  a date later than the last document, next to "hearing", "due",
 *                       "deadline" or "no later than" ("Ahead: evidence due 4 Mar 2027,
 *                       in 105 days"; after the last one "The hearing date has passed.")
 *   review              the product's own date: Project.firstRunAt plus 7 days, kept
 *                       while the work has open items ("Review due in 6 days. 6
 *                       contradictions are open.")
 * Days are counted between calendar days of the device's clock. Works for all three
 * kinds of work: open items are open contradictions and questions of a case, open
 * questions and wishes that need the person in a seating, essays with a clip.
 */
import type { CaseResult, Deadline, Doc, EssaysResult, Note, Page, Project, SeatingResult } from './types';
import { dayNumber, isoDate, pageDates } from './checks/dates';
import { pageLines } from '../materials/normalize';
import { splitSentences } from '../materials/sentences';
import { applyEdits } from './jobs/case/edits';

export const REVIEW_DAYS = 7;
export const REVIEW_NOTE_DAYS = 2;
export const DOCUMENT_NOTE_DAYS = 14;

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2027-03-04' -> '4 Mar 2027'. */
export function shortDate(iso: string): string {
  const d = new Date(dayNumber(iso) * 86_400_000);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The calendar day of a device date, as an ISO date. */
export function localDay(now: Date): string {
  return isoDate(now.getFullYear(), now.getMonth(), now.getDate()) ?? now.toISOString().slice(0, 10);
}

/** Whole days from the device's today to an ISO date (negative when it has passed). */
export function daysUntil(iso: string, now: Date): number {
  return dayNumber(iso.slice(0, 10)) - dayNumber(localDay(now));
}

const KEYWORDS = /\b(hearing|due|deadline|no later than)\b/i;

function deadlineLabel(sentence: string): string {
  if (/\bhearing\b/i.test(sentence) && !/\b(no later than|due|deadline)\b/i.test(sentence)) return 'Hearing';
  if (/\b(evidence|documents?)\b/i.test(sentence)) return 'Evidence due';
  if (/\bdeadline\b/i.test(sentence)) return 'Deadline';
  return 'Due';
}

/** Dates in the documents that lie after the last document, next to a deadline word. */
export function documentDeadlines(pages: readonly Page[], docs: readonly Doc[]): Deadline[] {
  const docDates = Object.fromEntries(docs.map((d) => [d.meta.id, d.meta.date]));
  const found: { iso: string; label: string; page: Page; keyword: boolean }[] = [];
  for (const page of pages) {
    const dates = pageDates(page, docDates[page.docId]).filter((d) => d.iso);
    pageLines(page).forEach((line, li) => {
      for (const s of splitSentences(line)) {
        const keyword = KEYWORDS.test(s.text);
        for (const d of dates) {
          if (d.line === li && d.start >= s.start && d.end <= s.end) found.push({ iso: d.iso!, label: deadlineLabel(s.text), page, keyword });
        }
      }
    });
  }
  const docLast = docs.map((d) => d.meta.date).filter((d): d is string => Boolean(d)).sort().pop();
  const last = docLast ?? found.filter((f) => !f.keyword).map((f) => f.iso).sort().pop();
  if (!last) return [];
  const out: Deadline[] = [];
  for (const f of found) {
    if (!f.keyword || f.iso <= last) continue;
    if (out.some((d) => d.date === f.iso && d.label === f.label)) continue;
    let id = f.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (out.some((d) => d.id === id)) id += '-' + f.iso;
    out.push({ id, kind: 'document', date: f.iso, label: f.label, source: { docId: f.page.docId, page: f.page.n } });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The nearest document date that has not passed, and the days to it. */
export function nextDeadline(result: Pick<CaseResult, 'deadlines'>, now: Date): { deadline: Deadline; days: number } | null {
  const ahead = result.deadlines
    .filter((d) => d.kind === 'document')
    .map((d) => ({ deadline: d, days: daysUntil(d.date, now) }))
    .filter((d) => d.days >= 0)
    .sort((a, b) => a.days - b.days);
  return ahead[0] ?? null;
}

const inDays = (n: number) => (n === 0 ? 'today' : n === 1 ? 'in 1 day' : `in ${n} days`);

/** 'Ahead: evidence due 4 Mar 2027, in 105 days'; 'The hearing date has passed.'; null without document dates. */
export function deadlineLine(result: Pick<CaseResult, 'deadlines'>, now: Date): string | null {
  const docs = result.deadlines.filter((d) => d.kind === 'document');
  if (!docs.length) return null;
  const next = nextDeadline(result, now);
  if (next) return `Ahead: ${next.deadline.label.toLowerCase()} ${shortDate(next.deadline.date)}, ${inDays(next.days)}`;
  const last = [...docs].sort((a, b) => (a.date < b.date ? -1 : 1)).pop()!;
  return `The ${last.label.toLowerCase()} date has passed.`;
}

/** Open items of a work: what the review date waits for. */
export function openItems(project: Project): number {
  const r = project.result;
  if (!r) return 0;
  if (project.kind === 'case') {
    const c = applyEdits(r as CaseResult, project.edits);
    return c.contradictions.filter((x) => x.state === 'open' && x.review === 'open').length + c.open.length;
  }
  if (project.kind === 'seating') {
    const s = r as SeatingResult;
    return (s.questions?.length ?? 0) + (s.wishes?.filter((w) => w.status === 'needs-you' || w.status === 'broken').length ?? 0);
  }
  const e = r as EssaysResult;
  return e.scores ? e.scores.filter((s) => s.review.length > 0).length : 0;
}

function openPhrase(project: Project, n: number, still: boolean): string {
  const s = still ? 'still ' : '';
  if (project.kind === 'case') {
    const r = applyEdits(project.result as CaseResult, project.edits);
    const c = r.contradictions.filter((x) => x.state === 'open' && x.review === 'open').length;
    const q = r.open.length;
    const parts = [c ? `${c} ${c === 1 ? 'contradiction' : 'contradictions'}` : '', q ? `${q} ${q === 1 ? 'question' : 'questions'}` : ''].filter(Boolean);
    return `${parts.join(' and ')} ${c + q === 1 ? 'is' : 'are'} ${s}open.`;
  }
  if (project.kind === 'seating') return `${n} seating ${n === 1 ? 'question is' : 'questions are'} ${s}open.`;
  return `${n} ${n === 1 ? 'essay is' : 'essays are'} ${s}waiting for review.`;
}

/** firstRunAt plus 7 days, while the work has open items; otherwise null. */
export function reviewDue(project: Project): string | null {
  if (!project.firstRunAt || openItems(project) === 0) return null;
  const start = project.firstRunAt.slice(0, 10);
  if (!Number.isFinite(dayNumber(start))) return null;
  return new Date((dayNumber(start) + REVIEW_DAYS) * 86_400_000).toISOString().slice(0, 10);
}

/** 'Review due in 6 days. 6 contradictions are open.', 'Review due today.', 'Review was due 2 days ago. 4 contradictions are still open.' */
export function reviewLine(project: Project, now: Date): string | null {
  const due = reviewDue(project);
  if (!due) return null;
  const days = daysUntil(due, now);
  const n = openItems(project);
  if (days > 0) return `Review due ${inDays(days)}. ${openPhrase(project, n, false)}`;
  if (days === 0) return 'Review due today.';
  return `Review was due ${-days === 1 ? '1 day' : `${-days} days`} ago. ${openPhrase(project, n, true)}`;
}

/**
 * A note when the review date is 2 days away or less, or a document date 14 days or
 * less; not more than one deadline note per calendar day.
 */
export function deadlineNote(project: Project, now: Date): Note | null {
  const today = localDay(now);
  if (project.notes.some((n) => n.kind === 'deadline' && localDay(new Date(n.at)) === today)) return null;
  const due = reviewDue(project);
  let text: string | null = null;
  if (due && daysUntil(due, now) <= REVIEW_NOTE_DAYS) text = reviewLine(project, now);
  if (!text && project.kind === 'case' && project.result) {
    const next = nextDeadline(project.result as CaseResult, now);
    if (next && next.days <= DOCUMENT_NOTE_DAYS) text = deadlineLine(project.result as CaseResult, now);
  }
  if (!text) return null;
  return { id: `n_deadline_${today}`, projectId: project.id, at: now.toISOString(), by: 'deadline', kind: 'deadline', text, read: false };
}
