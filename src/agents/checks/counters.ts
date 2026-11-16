/**
 * The numbers of the gate and of the work sheet (RunStats):
 *
 *   units    = matched + corrected + merged + sentBack
 *   sentBack = fixed + dropped
 *   kept     = matched + corrected + fixed
 *
 * `checked` counts kept units that code checked; `agentOnly` kept units nothing in code
 * could check ("Reviewed by an agent"). A planted mistake is caught when its wrong
 * content did not reach the result: it was sent back (and fixed or dropped) or corrected
 * by code. Only a planted unit accepted as is counts as not caught.
 */
import type { RunStats } from '../types';

export type UnitTrack = {
  id: string;
  first: 'accepted' | 'corrected' | 'merged' | 'rejected';
  final: 'accepted' | 'corrected' | 'merged' | 'fixed' | 'dropped';
  /** Code applied at least one check to it. */
  checked: boolean;
  planted: boolean;
  seeded: boolean;
};

export type UnitCounts = Pick<
  RunStats,
  'units' | 'matched' | 'corrected' | 'merged' | 'sentBack' | 'fixed' | 'dropped' | 'kept' | 'checked' | 'agentOnly' | 'planted' | 'seeded' | 'caught'
>;

export function countUnits(tracks: readonly UnitTrack[]): UnitCounts {
  const c: UnitCounts = { units: 0, matched: 0, corrected: 0, merged: 0, sentBack: 0, fixed: 0, dropped: 0, kept: 0, checked: 0, agentOnly: 0, planted: 0, seeded: 0, caught: 0 };
  for (const t of tracks) {
    if (t.planted) c.planted++;
    if (t.seeded) c.seeded++;
    if ((t.planted || t.seeded) && isCaught(t)) c.caught++;
    if (t.seeded) continue;
    c.units++;
    if (t.first === 'accepted') c.matched++;
    else if (t.first === 'corrected') c.corrected++;
    else if (t.first === 'merged') c.merged++;
    else {
      c.sentBack++;
      if (t.final === 'fixed') c.fixed++;
      else c.dropped++;
    }
    if (t.final === 'accepted' || t.final === 'corrected' || t.final === 'fixed') {
      c.kept++;
      if (t.checked) c.checked++;
      else c.agentOnly++;
    }
  }
  return c;
}

export function isCaught(t: UnitTrack): boolean {
  return t.first !== 'accepted';
}

/** The broken equalities as readable lines; [] when all hold. */
export function equalityProblems(s: Pick<RunStats, 'units' | 'matched' | 'corrected' | 'merged' | 'sentBack' | 'fixed' | 'dropped' | 'kept'>): string[] {
  const out: string[] = [];
  if (s.units !== s.matched + s.corrected + s.merged + s.sentBack) {
    out.push(`units ${s.units} != matched ${s.matched} + corrected ${s.corrected} + merged ${s.merged} + sent back ${s.sentBack}`);
  }
  if (s.sentBack !== s.fixed + s.dropped) out.push(`sent back ${s.sentBack} != fixed ${s.fixed} + dropped ${s.dropped}`);
  if (s.kept !== s.matched + s.corrected + s.fixed) out.push(`kept ${s.kept} != matched ${s.matched} + corrected ${s.corrected} + fixed ${s.fixed}`);
  return out;
}

export function emptyStats(pages = 0): RunStats {
  return {
    pages, calls: {}, modelMs: 0, checkMs: 0, steps: 0, units: 0, matched: 0, corrected: 0, merged: 0, sentBack: 0, fixed: 0, dropped: 0,
    kept: 0, agentOnly: 0, checked: 0, files: 0, required: 0, requiredFound: 0, asked: 0, planted: 0, seeded: 0, caught: 0, tiles: 0, redos: 0,
  };
}
