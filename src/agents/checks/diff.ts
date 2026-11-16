/**
 * Word alignment for the check trays and the source sheet (01.4.3).
 *
 *   diffWords(claim, source)  numbers of the words that stand only in one of the two
 *                             strings, aligned by the longest common subsequence of tokens
 *   locateQuote(quote, page)  where each fragment of a quote stands on the page: block
 *                             index and character offsets in that block's line
 *                             (blockText(block), the same line Page.text carries)
 *
 * Word numbers count the tokens of tokens(s) (punctuation-only runs are not words).
 */
import type { Page, QuoteSpan } from '../types';
import { pageLines, tokenSpans, tokens, type TokenSpan } from '../../materials/normalize';

/** Indices (in a and b) of a longest common subsequence of two token lists. */
export function lcsPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/** Numbers of the words of `claim` and of `source` that are not part of their common subsequence. */
export function diffWords(claim: string, source: string): { claim: number[]; source: number[] } {
  const a = tokens(claim);
  const b = tokens(source);
  const pairs = lcsPairs(a, b);
  const inA = new Set(pairs.map((p) => p[0]));
  const inB = new Set(pairs.map((p) => p[1]));
  return { claim: a.map((_, i) => i).filter((i) => !inA.has(i)), source: b.map((_, i) => i).filter((i) => !inB.has(i)) };
}

/** A quote split at its ellipses into fragments of tokens; empty fragments are dropped. */
export function quoteFragments(quote: string): string[][] {
  return quote
    .split(/\.\s*\.\s*\.|…/)
    .map((part) => tokens(part))
    .filter((t) => t.length > 0);
}

/** Tokens of a whole page with the block (line) each one stands in. */
export type PageToken = TokenSpan & { line: number };

export function pageTokens(page: Page): PageToken[] {
  const out: PageToken[] = [];
  pageLines(page).forEach((line, i) => {
    for (const t of tokenSpans(line)) out.push({ ...t, line: i });
  });
  return out;
}

/** First position at or after `from` where `needle` stands in `hay` as a run, or -1. */
export function findRun(hay: readonly string[], needle: readonly string[], from = 0): number {
  if (needle.length === 0) return -1;
  outer: for (let i = from; i + needle.length <= hay.length; i++) {
    for (let k = 0; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Token ranges [start, end) of the fragments on the page, in order, or null when the
 * quote is not there word for word. A fragment may cross block boundaries.
 */
export function matchFragments(fragments: string[][], page: readonly string[]): [number, number][] | null {
  // Try every start of the first fragment, so an early partial match does not hide a later full one.
  const first = fragments[0];
  if (!first) return null;
  for (let s = findRun(page, first); s >= 0; s = findRun(page, first, s + 1)) {
    const ranges: [number, number][] = [[s, s + first.length]];
    let at = s + first.length;
    let ok = true;
    for (const f of fragments.slice(1)) {
      const i = findRun(page, f, at);
      if (i < 0) {
        ok = false;
        break;
      }
      ranges.push([i, i + f.length]);
      at = i + f.length;
    }
    if (ok) return ranges;
  }
  return null;
}

/** Character spans per block for token ranges of pageTokens(page). */
export function spansOf(toks: readonly PageToken[], ranges: readonly [number, number][]): QuoteSpan[] {
  const out: QuoteSpan[] = [];
  for (const [a, b] of ranges) {
    let i = a;
    while (i < b) {
      const line = toks[i].line;
      let j = i;
      while (j + 1 < b && toks[j + 1].line === line) j++;
      out.push({ blockIndex: line, start: toks[i].start, end: toks[j].end });
      i = j + 1;
    }
  }
  return out;
}

/** Where the quote stands on the page, fragment by fragment; [] when it is not there word for word. */
export function locateQuote(quote: string, page: Page): QuoteSpan[] {
  const toks = pageTokens(page);
  const ranges = matchFragments(quoteFragments(quote), toks.map((t) => t.tok));
  return ranges ? spansOf(toks, ranges) : [];
}

/** The original text of the page covered by token range [a, b), joined across blocks by a space. */
export function pageSlice(page: Page, toks: readonly PageToken[], a: number, b: number): string {
  const lines = pageLines(page);
  return spansOf(toks, [[a, b]])
    .map((s) => lines[s.blockIndex].slice(s.start, s.end))
    .join(' ');
}
