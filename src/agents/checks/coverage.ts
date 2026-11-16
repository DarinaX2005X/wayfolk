/**
 * Coverage (PLAN "Правила проверок"): how many dated passages of the material the
 * accepted quotes touch, and which pages gave no event. The work sheet shows
 * "N dated passages were not used. See them." with N = datedPassages − covered.
 */
import type { Page, QuoteSpan } from '../types';
import { findDatedPassages, type DatedPassage } from './date';

export type AcceptedQuote = { page: number; spans: readonly QuoteSpan[] };

export type Coverage = { datedPassages: number; covered: number; pagesWithoutEvents: number[]; uncovered: DatedPassage[] };

export function passageCovered(p: DatedPassage, quotes: readonly AcceptedQuote[]): boolean {
  return quotes.some((q) => q.page === p.page && q.spans.some((s) => s.blockIndex === p.blockIndex && s.start < p.end && s.end > p.start));
}

export function coverage(
  pages: readonly Page[],
  accepted: readonly AcceptedQuote[],
  docDates: Record<string, string | undefined> = {},
): Coverage {
  const passages = pages.flatMap((p) => findDatedPassages(p, docDates[p.docId]));
  const uncovered = passages.filter((p) => !passageCovered(p, accepted));
  const withEvents = new Set(accepted.map((q) => q.page));
  return {
    datedPassages: passages.length,
    covered: passages.length - uncovered.length,
    pagesWithoutEvents: pages.map((p) => p.n).filter((n) => !withEvents.has(n)),
    uncovered,
  };
}
