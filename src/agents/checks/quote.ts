/**
 * checkQuote (PLAN "Правила проверок"): is the model's quote really on the page it names?
 *
 *   word for word on the named page            accepted
 *   word for word on another page of the file  corrected, quote-wrong-page, found.page
 *   10+ tokens, a window of the named page (length ±20%) whose longest common
 *   subsequence covers 90% of the quote:
 *     only insignificant words differ          corrected, quote-reworded (the event takes the page text)
 *     a significant word differs               rejected, quote-altered
 *   otherwise                                  rejected, quote-not-found (diff.source: nearest sentence)
 *   shorter than 12 characters                 rejected, quote-too-short
 *
 * Comparison is by tokens after normalizeText. A quote with an ellipsis is split into
 * fragments that must stand on one page in order.
 */
import type { CheckedItem, Page } from '../types';
import { normalizeText, pageLines, tokens } from '../../materials/normalize';
import { splitSentences } from '../../materials/sentences';
import { diffWords, lcsPairs, matchFragments, pageSlice, pageTokens, quoteFragments, spansOf } from './diff';

export type QuoteClaim = { quote: string; page: number };

export type QuoteResult = Pick<CheckedItem, 'status' | 'reason' | 'found' | 'diff' | 'spans'> & {
  status: 'accepted' | 'corrected' | 'rejected';
  /** The page the quote stands on after the check (the named page unless corrected). */
  page: number;
  /** The quote the event keeps: the model's, or the page text for quote-reworded. */
  quote: string;
};

export const MIN_QUOTE_CHARS = 12;
export const FUZZY_MIN_TOKENS = 10;
export const FUZZY_COVER = 0.9;
export const FUZZY_LENGTH = 0.2;

export function checkQuote(claim: QuoteClaim, pages: readonly Page[], significant: (token: string) => boolean): QuoteResult {
  const quote = claim.quote ?? '';
  const named = pages.find((p) => p.n === claim.page) ?? null;
  const fragments = quoteFragments(quote);
  if (normalizeText(quote).length < MIN_QUOTE_CHARS || fragments.length === 0) {
    return { status: 'rejected', reason: 'quote-too-short', page: claim.page, quote, diff: { claim: quote, source: '' } };
  }

  // (a) word for word on the named page.
  if (named) {
    const toks = pageTokens(named);
    const ranges = matchFragments(fragments, toks.map((t) => t.tok));
    if (ranges) return { status: 'accepted', page: named.n, quote, spans: spansOf(toks, ranges) };
  }

  // (b) word for word on another page: the nearest such page.
  const others = pages
    .filter((p) => p.n !== claim.page)
    .sort((a, b) => Math.abs(a.n - claim.page) - Math.abs(b.n - claim.page) || a.n - b.n);
  for (const p of others) {
    const toks = pageTokens(p);
    const ranges = matchFragments(fragments, toks.map((t) => t.tok));
    if (!ranges) continue;
    const text = ranges.map(([a, b]) => pageSlice(p, toks, a, b)).join(' ... ');
    return { status: 'corrected', reason: 'quote-wrong-page', page: p.n, quote, found: { page: p.n, text }, spans: spansOf(toks, ranges) };
  }

  // (c) nearly word for word on the named page.
  const q = fragments.flat();
  if (named && q.length >= FUZZY_MIN_TOKENS) {
    const toks = pageTokens(named);
    const w = bestWindow(q, toks.map((t) => t.tok));
    if (w && w.common >= Math.ceil(FUZZY_COVER * q.length - 1e-9)) {
      const window = toks.slice(w.start, w.end).map((t) => t.tok);
      const pairs = lcsPairs(q, window);
      const inQ = new Set(pairs.map((p) => p[0]));
      const inW = new Set(pairs.map((p) => p[1]));
      const differing = [...q.filter((_, i) => !inQ.has(i)), ...window.filter((_, i) => !inW.has(i))];
      const source = pageSlice(named, toks, w.start, w.end);
      const diff = { claim: quote, source, marks: diffWords(quote, source) };
      const spans = spansOf(toks, [[w.start, w.end]]);
      if (differing.some(significant)) return { status: 'rejected', reason: 'quote-altered', page: named.n, quote, diff, spans };
      return { status: 'corrected', reason: 'quote-reworded', page: named.n, quote: source, diff, spans, found: { page: named.n, text: source } };
    }
  }

  // (d) nowhere: show the nearest sentence of the named page.
  const source = named ? nearestSentence(q, named) : '';
  return {
    status: 'rejected',
    reason: 'quote-not-found',
    page: claim.page,
    quote,
    diff: { claim: quote, source, marks: source ? diffWords(quote, source) : undefined },
  };
}

/**
 * The window of the page (length within ±20% of the quote) with the longest common
 * subsequence with the quote; ties go to the length closest to the quote, then the
 * earliest start. One DP per start yields every window length at once.
 */
export function bestWindow(q: readonly string[], page: readonly string[]): { start: number; end: number; common: number } | null {
  const n = q.length;
  const minLen = Math.max(1, Math.ceil(n * (1 - FUZZY_LENGTH)));
  const maxLen = Math.floor(n * (1 + FUZZY_LENGTH));
  const qset = new Set(q);
  let best: { start: number; end: number; common: number } | null = null;
  let prev = new Uint16Array(n + 1);
  let cur = new Uint16Array(n + 1);
  for (let s = 0; s < page.length; s++) {
    // A window that begins with a word the quote does not have is never better than the one after it.
    if (!qset.has(page[s])) continue;
    prev.fill(0);
    const limit = Math.min(maxLen, page.length - s);
    for (let len = 1; len <= limit; len++) {
      const tok = page[s + len - 1];
      cur[0] = 0;
      for (let i = 1; i <= n; i++) cur[i] = q[i - 1] === tok ? prev[i - 1] + 1 : Math.max(prev[i], cur[i - 1]);
      [prev, cur] = [cur, prev];
      if (len < minLen) continue;
      const common = prev[n];
      if (
        !best ||
        common > best.common ||
        (common === best.common && Math.abs(len - n) < Math.abs(best.end - best.start - n))
      ) {
        best = { start: s, end: s + len, common };
      }
    }
  }
  return best;
}

/** The sentence of the page that shares the most tokens with the quote. */
export function nearestSentence(q: readonly string[], page: Page): string {
  const want = new Map<string, number>();
  for (const t of q) want.set(t, (want.get(t) ?? 0) + 1);
  let best = '';
  let bestScore = 0;
  for (const line of pageLines(page)) {
    for (const s of splitSentences(line)) {
      const toks = tokens(s.text);
      if (!toks.length) continue;
      const have = new Map(want);
      let shared = 0;
      for (const t of toks) {
        const k = have.get(t) ?? 0;
        if (k > 0) {
          shared++;
          have.set(t, k - 1);
        }
      }
      const score = shared / Math.max(toks.length, q.length);
      if (score > bestScore) {
        bestScore = score;
        best = s.text;
      }
    }
  }
  return best;
}
