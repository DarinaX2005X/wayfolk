/**
 * The numbers of the gate and the work sheet (PLAN, the equality next to "Правила
 * проверок"):
 *
 *   claims  = matched + corrected + merged + sentBack
 *   sentBack = fixed + dropped
 *   events  = matched + corrected + fixed + added
 *
 * Fakes seeded by code are not in claims, sentBack or dropped: they count only in
 * `seeded` and `caught`. A planted or seeded error is caught when its wrong content did
 * not reach the result: dropped, fixed on the second look, corrected or merged by code,
 * or its wrong fact removed. Only an error accepted as is counts as not caught.
 */
import type { CheckedItem, RunStats } from '../types';

export type ClaimTrack = {
  id: string;
  /** extract: an answer of the extractor; recheck: added on the second look. */
  origin: 'extract' | 'recheck';
  /** Decision of the first check. */
  first: 'accepted' | 'corrected' | 'merged' | 'rejected';
  /** Status after everything (fixed or dropped for sent-back claims). */
  final: CheckedItem['status'];
  planted: boolean;
  seeded: boolean;
  factsChecked: number;
  factsRemoved: number;
  /** Became an event of the result. */
  event: boolean;
};

export type ClaimCounts = Pick<
  RunStats,
  'claims' | 'matched' | 'corrected' | 'merged' | 'sentBack' | 'fixed' | 'dropped' | 'added' | 'events' | 'factsChecked' | 'factsRemoved' | 'planted' | 'seeded' | 'caught'
>;

export function countClaims(tracks: readonly ClaimTrack[]): ClaimCounts {
  const c: ClaimCounts = {
    claims: 0, matched: 0, corrected: 0, merged: 0, sentBack: 0, fixed: 0, dropped: 0, added: 0, events: 0,
    factsChecked: 0, factsRemoved: 0, planted: 0, seeded: 0, caught: 0,
  };
  for (const t of tracks) {
    if (t.planted) c.planted++;
    if (t.seeded) c.seeded++;
    if ((t.planted || t.seeded) && isCaught(t)) c.caught++;
    if (t.event) {
      c.events++;
      c.factsChecked += t.factsChecked;
      c.factsRemoved += t.factsRemoved;
    }
    if (t.seeded) continue;
    if (t.origin === 'recheck') {
      if (t.event) c.added++;
      continue;
    }
    c.claims++;
    if (t.first === 'accepted') c.matched++;
    else if (t.first === 'corrected') c.corrected++;
    else if (t.first === 'merged') c.merged++;
    else {
      c.sentBack++;
      if (t.final === 'fixed') c.fixed++;
      else c.dropped++;
    }
  }
  return c;
}

export function isCaught(t: ClaimTrack): boolean {
  if (t.seeded) return !t.event || t.first !== 'accepted' || t.factsRemoved > 0;
  return !(t.first === 'accepted' && t.final === 'accepted' && t.factsRemoved === 0);
}

/** The broken equalities as readable lines; [] when all hold. */
export function equalityProblems(s: Pick<RunStats, 'claims' | 'matched' | 'corrected' | 'merged' | 'sentBack' | 'fixed' | 'dropped' | 'added' | 'events'>): string[] {
  const out: string[] = [];
  if (s.claims !== s.matched + s.corrected + s.merged + s.sentBack) {
    out.push(`claims ${s.claims} != matched ${s.matched} + corrected ${s.corrected} + merged ${s.merged} + sent back ${s.sentBack}`);
  }
  if (s.sentBack !== s.fixed + s.dropped) out.push(`sent back ${s.sentBack} != fixed ${s.fixed} + dropped ${s.dropped}`);
  if (s.events !== s.matched + s.corrected + s.fixed + s.added) {
    out.push(`events ${s.events} != matched ${s.matched} + corrected ${s.corrected} + fixed ${s.fixed} + added ${s.added}`);
  }
  return out;
}

export function emptyStats(pages = 0): RunStats {
  return {
    pages, pagesUnread: [], calls: {}, modelMs: 0, checkMs: 0, claims: 0, matched: 0, corrected: 0, merged: 0, sentBack: 0,
    fixed: 0, dropped: 0, added: 0, events: 0, factsChecked: 0, factsRemoved: 0, pairs: 0, contradictions: 0, explained: 0,
    asked: 0, planted: 0, seeded: 0, caught: 0, tiles: 0, coverage: { datedPassages: 0, covered: 0, pagesWithoutEvents: [] },
  };
}
