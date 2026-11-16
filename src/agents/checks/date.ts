/**
 * checkDate and dated passages (PLAN "Правила проверок", 01.4.3).
 *
 * checkDate(event, page, window), in this order:
 *   1. the date lies in the case window: from the earliest to the latest date of the
 *      material plus 30 days (date-out-of-range). It runs before matching, so a
 *      year-less "12 January" claimed as 2025-01-12 on a page whose heading puts it in
 *      2026 is out of range, not a mismatch;
 *   2. a weekday word in the quote is compared with the claimed date: "4 March 2026 was
 *      a Wednesday, the quote says Friday" (weekday-mismatch);
 *   3. the date stands in the quote or in the head blocks of the page (date-mismatch).
 * An `account` takes its date only from the quote: without a date in the quote it gets
 * at = null and nothing to mismatch.
 *
 * findDatedPassages(page): sentences of blocks p, msg, row and clause in which a date
 * is found. The time prefix of a msg or row block (`at`) stands before its first
 * sentence, so only that sentence is dated by it; later sentences need their own date.
 */
import type { CheckedItem, Page } from '../types';
import { pageLines } from '../../materials/normalize';
import { splitSentences } from '../../materials/sentences';
import { locateQuote } from './diff';
import {

  dayNumber,
  findDates,
  findWeekdays,
  headDates,
  isIsoDate,
  isoDate,
  longDate,
  pageDates,
  weekdayOf,
  yearOf,
  type ResolvedDate,
} from './dates';

export * from './dates';

export type CaseWindow = { from: string; to: string };
/** The window reaches this many days past the latest date of the material. */
export const WINDOW_AFTER_DAYS = 30;

export type DateClaim = { kind: 'record' | 'account'; date: string; quote: string };

export type DateResult = Pick<CheckedItem, 'status' | 'reason'> & {
  status: 'accepted' | 'rejected';
  /** The date the event stands at, or null (an account without a date in its quote). */
  at: string | null;
  /** Human words for the reason, e.g. '4 March 2026 was a Wednesday, the quote says Friday'. */
  detail?: string;
};

/** The ISO dates written in the quote, with years resolved from where the quote stands on the page. */
export function quoteDates(quote: string, page: Page, docDate?: string): string[] {
  const spans = locateQuote(quote, page);
  if (spans.length) {
    const dates = pageDates(page, docDate);
    return dates
      .filter((d) => spans.some((s) => s.blockIndex === d.line && d.start >= s.start && d.end <= s.end) && d.iso)
      .map((d) => d.iso!);
  }
  // Not on the page word for word (a reworded quote keeps the page text, so this is rare):
  // the quote's own full dates give the year, then the page, then the document.
  const own = findDates(quote);
  const year = own.find((d) => d.year !== null)?.year ?? pageDates(page, docDate).find((d) => d.year !== null)?.year ?? yearOf(docDate);
  return own.map((d) => isoDate(d.year ?? year ?? NaN, d.month, d.day)).filter((d): d is string => Boolean(d));
}

export function checkDate(event: DateClaim, page: Page, window: CaseWindow | null, docDate?: string): DateResult {
  const date = (event.date ?? '').trim();
  const inQuote = quoteDates(event.quote, page, docDate);
  if (event.kind === 'account' && inQuote.length === 0) return { status: 'accepted', at: null };
  if (!date) return { status: 'accepted', at: null };
  if (!isIsoDate(date)) return { status: 'rejected', reason: 'date-mismatch', at: null, detail: `"${date}" is not a date` };

  if (window && !inWindow(date, window)) {
    return {
      status: 'rejected',
      reason: 'date-out-of-range',
      at: null,
      detail: `${longDate(date)} is outside this case, ${longDate(window.from)} to ${longDate(window.to)}`,
    };
  }

  const said = findWeekdays(event.quote);
  if (said.length && !said.includes(weekdayOf(date))) {
    return {
      status: 'rejected',
      reason: 'weekday-mismatch',
      at: null,
      detail: `${longDate(date)} was a ${weekdayOf(date)}, the quote says ${said[0]}`,
    };
  }

  const known = new Set([...inQuote, ...(event.kind === 'record' ? headDates(page, docDate) : [])]);
  if (!known.has(date)) {
    return { status: 'rejected', reason: 'date-mismatch', at: null, detail: `${longDate(date)} is not in the quote or the page heading` };
  }
  return { status: 'accepted', at: date };
}

export function inWindow(date: string, window: CaseWindow): boolean {
  const d = dayNumber(date);
  return d >= dayNumber(window.from) && d <= dayNumber(window.to) + WINDOW_AFTER_DAYS;
}

/**
 * The case window: the earliest and the latest date written in the material (years
 * resolved as for every date). `to` is the latest date itself; checkDate adds 30 days.
 */
export function caseWindow(pages: readonly Page[], docDates: Record<string, string | undefined> = {}): CaseWindow | null {
  let min = Infinity;
  let max = -Infinity;
  let from = '';
  let to = '';
  for (const p of pages) {
    for (const d of pageDates(p, docDates[p.docId])) {
      if (!d.iso) continue;
      const n = dayNumber(d.iso);
      if (n < min) [min, from] = [n, d.iso];
      if (n > max) [max, to] = [n, d.iso];
    }
  }
  return from ? { from, to } : null;
}

// ------------------------------------------------------------------ dated passages

export type DatedPassage = {
  page: number;
  /** Index of the block (line of the page). */
  blockIndex: number;
  /** Offsets of the sentence in blockText(block). */
  start: number;
  end: number;
  text: string;
  /** The first resolved date of the sentence. */
  date: string;
};

const DATED_KINDS = new Set(['p', 'msg', 'row', 'clause']);

export function findDatedPassages(page: Page, docDate?: string): DatedPassage[] {
  const dates = pageDates(page, docDate).filter((d) => d.iso);
  const lines = pageLines(page);
  const out: DatedPassage[] = [];
  lines.forEach((line, i) => {
    const kind = page.blocks ? page.blocks[i].k : 'p';
    if (!DATED_KINDS.has(kind)) return;
    for (const s of splitSentences(line)) {
      const d: ResolvedDate | undefined = dates.find((x) => x.line === i && x.start >= s.start && x.end <= s.end);
      if (d) out.push({ page: page.n, blockIndex: i, start: s.start, end: s.end, text: s.text, date: d.iso! });
    }
  });
  return out;
}
