/**
 * dedupe (PLAN "Правила проверок"): a claim on the same page as an earlier kept claim,
 * whose quote shares more than 60% of its tokens with it, is merged into it. The
 * earlier claim stays (lower batch number, then lower number in the answer). The share
 * is counted against the shorter quote, so a quote cut out of a longer one is merged.
 * When both carry their claims, the claims must say the same too: two prices read from
 * one line of a price list share the quote but are two facts (different numbers, or
 * claims that share no more than 60% of their words, are never merged).
 */
import { tokens } from '../../materials/normalize';

export const DEDUPE_SHARE = 0.6;

export type Kept = { id: string; page: number; quote: string; claim?: string };

/** Share of tokens two quotes have in common, against the shorter one (multiset intersection). */
export function overlapShare(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const count = new Map<string, number>();
  for (const t of ta) count.set(t, (count.get(t) ?? 0) + 1);
  let shared = 0;
  for (const t of tb) {
    const k = count.get(t) ?? 0;
    if (k > 0) {
      shared++;
      count.set(t, k - 1);
    }
  }
  return shared / Math.min(ta.length, tb.length);
}

/** The id of the kept claim this one duplicates, or null. */
export function dedupe(claim: { page: number; quote: string; claim?: string }, kept: readonly Kept[]): string | null {
  for (const k of kept) {
    if (k.page !== claim.page || overlapShare(k.quote, claim.quote) <= DEDUPE_SHARE) continue;
    if (claim.claim !== undefined && k.claim !== undefined && !sameClaim(claim.claim, k.claim)) continue;
    return k.id;
  }
  return null;
}

const numbersOf = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '')).sort().join(' ');

function sameClaim(a: string, b: string): boolean {
  return numbersOf(a) === numbersOf(b) && overlapShare(a, b) > DEDUPE_SHARE;
}
