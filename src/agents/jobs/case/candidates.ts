/**
 * Candidate pairs for the reconciler (PLAN "Трудный механизм", step reconcile): every
 * pair of accepted events with the same fact field and different values (dates a day
 * or more apart, times 30 minutes or more apart, different sums, yes against no), or
 * with the same subject of a presence field, overlapping intervals and different values.
 * The key of a pair is the two event ids in alphabetical order joined by '|'; the
 * model's verdicts are joined back by that key, so a recording does not depend on the
 * order of candidates. Pairs are judged in batches of 10.
 */
import type { CaseEvent, Fact, FactField } from '../../types';
import { amountValue, dayNumber, isIsoDate, isTime, minutesOf } from '../../checks/dates';

export type Candidate = {
  key: string;
  a: string;
  b: string;
  field: string;
  values: [string, string];
};

export const PAIRS_PER_CALL = 10;
export const MAX_RECONCILE_CALLS = 3;

export const pairKey = (x: string, y: string): string => (x < y ? `${x}|${y}` : `${y}|${x}`);

/** Do two values of a field disagree? */
export function differs(type: FactField['type'], x: string, y: string): boolean {
  if (type === 'date') return isIsoDate(x) && isIsoDate(y) && Math.abs(dayNumber(x) - dayNumber(y)) >= 1;
  if (type === 'time') return isTime(x) && isTime(y) && Math.abs(minutesOf(x) - minutesOf(y)) >= 30;
  if (type === 'amount') return amountValue(x) !== amountValue(y);
  return x !== y;
}

/** The days a presence fact covers: from..to, or the event's day when the fact gives none. */
function interval(f: Fact, e: CaseEvent): [number, number] | null {
  const from = f.from && isIsoDate(f.from) ? f.from : f.to && isIsoDate(f.to) ? f.to : e.at;
  const to = f.to && isIsoDate(f.to) ? f.to : from;
  if (!from || !to) return null;
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a <= b ? [a, b] : [b, a];
}

/** The facts of an event by field; the first fact of a field counts. */
function factsOf(e: CaseEvent): Map<string, Fact> {
  const out = new Map<string, Fact>();
  for (const f of e.facts) if (!out.has(f.field)) out.set(f.field, f);
  return out;
}

/** Does this pair of facts of one field make a candidate? */
export function factsConflict(type: FactField['type'], fa: Fact, ea: CaseEvent, fb: Fact, eb: CaseEvent): boolean {
  if (type === 'presence') {
    if ((fa.subject ?? '') !== (fb.subject ?? '') || fa.value === fb.value) return false;
    const ia = interval(fa, ea);
    const ib = interval(fb, eb);
    return Boolean(ia && ib && ia[0] <= ib[1] && ib[0] <= ia[1]);
  }
  return differs(type, fa.value, fb.value);
}

/**
 * All candidates among the events, or only between `fresh` and the others when given
 * (later pages pair only new events with old ones). Sorted by field order of the plan,
 * then by key. A pair of events that differ in two fields is one candidate (first field).
 */
export function candidates(events: readonly CaseEvent[], fields: readonly FactField[], fresh?: ReadonlySet<string>): Candidate[] {
  const types = new Map(fields.map((f) => [f.id, f.type]));
  const order = new Map(fields.map((f, i) => [f.id, i]));
  const facts = events.map((e) => factsOf(e));
  const out = new Map<string, Candidate>();
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const a = events[i];
      const b = events[j];
      if (a.id === b.id) continue;
      if (fresh && fresh.has(a.id) === fresh.has(b.id)) continue;
      for (const [field, fa] of facts[i]) {
        const fb = facts[j].get(field);
        const type = types.get(field);
        if (!fb || !type) continue;
        if (!factsConflict(type, fa, a, fb, b)) continue;
        const key = pairKey(a.id, b.id);
        if (out.has(key)) continue;
        const [x, y] = a.id < b.id ? [a, b] : [b, a];
        const [vx, vy] = a.id < b.id ? [fa.value, fb.value] : [fb.value, fa.value];
        out.set(key, { key, a: x.id, b: y.id, field, values: [vx, vy] });
      }
    }
  }
  return [...out.values()].sort((p, q) => (order.get(p.field) ?? 99) - (order.get(q.field) ?? 99) || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
}

/**
 * Candidates in call-sized batches: 10 per call, at most `maxCalls` calls (pairs spread
 * evenly when more than 10 × maxCalls); maxCalls 1 puts every pair in one call.
 */
export function pairBatches<T>(pairs: readonly T[], maxCalls = MAX_RECONCILE_CALLS): T[][] {
  if (!pairs.length || maxCalls < 1) return [];
  const size = Math.max(PAIRS_PER_CALL, Math.ceil(pairs.length / maxCalls));
  const out: T[][] = [];
  for (let i = 0; i < pairs.length; i += size) out.push(pairs.slice(i, i + size));
  return out;
}
