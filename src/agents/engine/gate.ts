/**
 * The gate: every unit a step produced passes code checks before it can reach the
 * result. One shape for all kinds of units:
 *
 *   check   accepted | corrected (code fixed it: a page number, a total) | merged (a
 *           duplicate) | rejected (with reasons)
 *   rejected units go back to the agent once, with the reasons; the answer is checked by
 *   the same functions: fixed, or dropped ('failed-again', 'withdrawn', 'not-recorded',
 *   'budget'). There is no third try.
 *
 * Each decision is an `item` event; each kept unit lays a tile. A unit no check in code
 * applies to is accepted with the label "agent" ("Reviewed by an agent"), never "checked".
 */
import type { CheckedItem, CheckName, RejectReason, Unit, UnitKind } from '../types';
import type { UnitTrack } from '../checks/counters';
import type { Engine } from './engine';

export type Problem = { reason: RejectReason; text: string; line?: number };

export type Verdict<T> = {
  status: 'accepted' | 'corrected' | 'merged' | 'rejected';
  problems: Problem[];
  /** Checks that applied; empty means only an agent can vouch for it. */
  checks: CheckName[];
  /** The unit as code corrected it. */
  data?: T;
  mergedInto?: string;
  found?: CheckedItem['found'];
  diff?: CheckedItem['diff'];
  spans?: CheckedItem['spans'];
  ref?: CheckedItem['ref'];
};

export type Candidate<T> = {
  id: string;
  data: T;
  /** Mistakes code planted into this unit when the sample was recorded (their notes). */
  planted: string[];
};

export type GateSpec<T> = {
  station: string;
  kind: UnitKind;
  /** The words of the unit on its card and slip. */
  claim(data: T): string;
  check(c: Candidate<T>, kept: readonly Candidate<T>[]): Verdict<T>;
  /**
   * The second look for the rejected units: for each id the fixed data, 'withdraw', or
   * 'missing' (nothing recorded) / 'budget' (no calls left).
   */
  fix(sent: { c: Candidate<T>; verdict: Verdict<T> }[]): Promise<Map<string, T | 'withdraw' | 'missing' | 'budget'>>;
  /** Builds the result unit of a kept candidate. */
  unit(c: Candidate<T>, status: Unit['status'], checks: CheckName[]): Unit;
  /** False for kinds whose units do not lay tiles. */
  tiles?: boolean;
};

export type GateOut<T> = { kept: { c: Candidate<T>; unit: Unit; final: 'accepted' | 'corrected' | 'fixed' }[]; sentBack: number; fixed: number; dropped: number; merged: number };

const label = (checks: readonly CheckName[]): 'checked' | 'agent' => (checks.length ? 'checked' : 'agent');

function item<T>(spec: GateSpec<T>, c: Candidate<T>, v: Verdict<T>, status: CheckedItem['status'], extra: Partial<CheckedItem> = {}): CheckedItem {
  return {
    id: c.id,
    kind: spec.kind,
    station: spec.station,
    status,
    ...(v.problems[0] ? { reason: v.problems[0].reason } : {}),
    ...(v.problems.length ? { problems: v.problems.map((p) => (p.line ? `Line ${p.line}: ${p.text}` : p.text)) } : {}),
    claim: spec.claim(v.data ?? c.data),
    unitId: c.id,
    label: label(v.checks),
    checks: v.checks,
    ...(c.planted.length ? { planted: true } : {}),
    ...(v.found ? { found: v.found } : {}),
    ...(v.diff ? { diff: v.diff } : {}),
    ...(v.spans ? { spans: v.spans } : {}),
    ...(v.ref ? { ref: v.ref } : {}),
    ...extra,
  };
}

/** Planted mistakes whose reason code found among the problems. */
export function caughtOf(planted: readonly string[], problems: readonly Problem[], firstStatus: string): number {
  if (!planted.length) return 0;
  if (firstStatus === 'merged') return planted.length;
  let n = 0;
  for (const p of planted) {
    const reason = /\(([a-z-]+)\)\s*$/.exec(p)?.[1];
    if (reason ? problems.some((x) => x.reason === reason) : firstStatus !== 'accepted') n++;
  }
  return n;
}

export async function runGate<T>(engine: Engine, spec: GateSpec<T>, candidates: readonly Candidate<T>[]): Promise<GateOut<T>> {
  const out: GateOut<T> = { kept: [], sentBack: 0, fixed: 0, dropped: 0, merged: 0 };
  const accepted: Candidate<T>[] = [];
  const sent: { c: Candidate<T>; verdict: Verdict<T> }[] = [];
  const order: { c: Candidate<T>; unit?: Unit; final?: 'accepted' | 'corrected' | 'fixed' }[] = [];
  const t0 = engine.ctx.now();
  for (const c of candidates) {
    const v = spec.check(c, accepted);
    const track: UnitTrack = { id: c.id, first: v.status, final: v.status === 'rejected' ? 'dropped' : v.status, checked: v.checks.length > 0, planted: c.planted.length > 0, seeded: false };
    engine.track(track, caughtOf(c.planted, v.problems, v.status), c.planted.length);
    if (v.status === 'merged') {
      out.merged++;
      engine.emitItem(spec.station, item(spec, c, v, 'merged', { reason: 'duplicate' }));
      continue;
    }
    if (v.status === 'rejected') {
      engine.emitItem(spec.station, item(spec, c, v, 'rejected'));
      sent.push({ c, verdict: v });
      order.push({ c });
      continue;
    }
    const cc = v.data !== undefined ? { ...c, data: v.data } : c;
    accepted.push(cc);
    engine.emitItem(spec.station, item(spec, cc, v, v.status));
    order.push({ c: cc, unit: spec.unit(cc, v.status === 'corrected' ? 'corrected' : v.checks.length ? 'checked' : 'agent', v.checks), final: v.status });
  }
  engine.addCheckMs(engine.ctx.now() - t0);

  if (sent.length) {
    out.sentBack = sent.length;
    const fixes = await spec.fix(sent);
    for (const s of sent) {
      const f = fixes.get(s.c.id);
      const at = order.findIndex((o) => o.c.id === s.c.id);
      if (f === undefined || f === 'withdraw' || f === 'missing' || f === 'budget') {
        const cause = f === 'withdraw' ? 'withdrawn' : f === 'missing' ? 'not-recorded' : f === 'budget' ? 'budget' : 'withdrawn';
        out.dropped++;
        const dropped = item(spec, s.c, s.verdict, 'dropped', { dropCause: cause });
        engine.emitItem(spec.station, dropped);
        engine.reject(dropped);
        continue;
      }
      const c2: Candidate<T> = { ...s.c, data: f, planted: [] };
      const v2 = spec.check(c2, accepted);
      if (v2.status === 'rejected' || v2.status === 'merged') {
        out.dropped++;
        const dropped = item(spec, c2, v2.status === 'merged' ? { ...v2, problems: [{ reason: 'duplicate', text: 'The fixed unit repeats one already kept' }] } : v2, 'dropped', { dropCause: 'failed-again', planted: s.c.planted.length > 0 || undefined });
        engine.emitItem(spec.station, dropped);
        engine.reject(dropped);
        continue;
      }
      out.fixed++;
      engine.retrack(s.c.id, 'fixed');
      const cc = v2.data !== undefined ? { ...c2, data: v2.data } : c2;
      accepted.push(cc);
      engine.emitItem(spec.station, item(spec, cc, v2, 'fixed', { planted: s.c.planted.length > 0 || undefined, reason: s.verdict.problems[0]?.reason, problems: s.verdict.problems.map((p) => p.text) }));
      if (at >= 0) order[at] = { c: cc, unit: spec.unit(cc, 'fixed', v2.checks), final: 'fixed' };
    }
  }
  for (const o of order) {
    if (!o.unit || !o.final) continue;
    out.kept.push({ c: o.c, unit: o.unit, final: o.final });
    if (spec.tiles !== false) engine.ctx.tile(spec.station, { kind: spec.kind, id: o.unit.id });
  }
  return out;
}
