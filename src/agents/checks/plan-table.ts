/**
 * checkPlanItems: the rows of a plan as code can check them.
 *
 *   dates          start and end are real dates (date-order when unreadable)
 *   date-order     the end is not before the start
 *   window         both dates lie inside the plan's window (date-out-of-range)
 *   order-broken   a task starts after the tasks it depends on end
 *   owner-unknown  the owner is one of the team named in the goal or materials
 *   numbers        money and numbers in the row stand in the sources (number-not-in-source)
 *
 * And checkTotals: a stated total of a column against the sum code makes of its rows.
 */
import type { PlanItem, RejectReason } from '../types';
import { dayNumber, isIsoDate, longDate } from './dates';
import { checkNumbers, checkSum, findNumbers, missingLine } from './numbers';

export type RowProblem = { reason: RejectReason; text: string };

/** Lowercase name words, for matching "Priya" against "Priya Raman (design)". */
const nameWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^a-zÀ-ɏ'-]+/)
    .filter((w) => w.length > 1);

export function ownerKnown(owner: string, team: readonly string[]): boolean {
  const words = nameWords(owner);
  if (!words.length) return false;
  const known = new Set(team.flatMap(nameWords));
  // Every person named in the owner cell must be on the team ("Priya and Sam").
  const people = owner.split(/\s*(?:,|&|\/|\band\b|\+)\s*/i).filter((p) => p.trim());
  return people.every((p) => nameWords(p).some((w) => known.has(w)));
}

export function checkPlanItem(
  item: PlanItem,
  ctx: { all: readonly PlanItem[]; window: { from: string; to: string } | null; team: readonly string[]; sources: readonly string[]; moneyColumns: readonly string[] },
): RowProblem[] {
  const out: RowProblem[] = [];
  const startOk = isIsoDate(item.start);
  const endOk = isIsoDate(item.end);
  if (!startOk || !endOk) {
    out.push({ reason: 'date-order', text: `"${!startOk ? item.start : item.end}" is not a date` });
  } else {
    if (dayNumber(item.end) < dayNumber(item.start)) {
      out.push({ reason: 'date-order', text: `It ends on ${longDate(item.end)}, before it starts on ${longDate(item.start)}` });
    }
    if (ctx.window && isIsoDate(ctx.window.from) && isIsoDate(ctx.window.to)) {
      const from = dayNumber(ctx.window.from);
      const to = dayNumber(ctx.window.to);
      for (const [label, d] of [['starts', item.start], ['ends', item.end]] as const) {
        const n = dayNumber(d);
        if (n < from || n > to) {
          out.push({ reason: 'date-out-of-range', text: `It ${label} on ${longDate(d)}, outside the plan's window ${longDate(ctx.window.from)} to ${longDate(ctx.window.to)}` });
          break;
        }
      }
    }
    for (const dep of item.depends) {
      const before = ctx.all.find((x) => x.id === dep);
      if (!before) continue;
      if (isIsoDate(before.end) && dayNumber(item.start) < dayNumber(before.end)) {
        out.push({ reason: 'order-broken', text: `It starts on ${longDate(item.start)}, before "${before.task}" ends on ${longDate(before.end)}` });
      }
    }
  }
  if (ctx.team.length && !ownerKnown(item.owner, ctx.team)) {
    out.push({ reason: 'owner-unknown', text: `"${item.owner}" is not on the team (${ctx.team.join(', ')})` });
  }
  if (ctx.sources.length) {
    for (const column of ctx.moneyColumns) {
      const cell = item.cells[column] ?? '';
      if (!cell) continue;
      const r = checkNumbers(cell, ctx.sources, { kinds: ['money'] });
      for (const m of r.missing) out.push({ reason: 'number-not-in-source', text: `${column}: ${missingLine(m, 'the materials')}` });
    }
  }
  return out;
}

/** A stated total against the code's sum of the column. */
export function checkTotal(items: readonly PlanItem[], column: string, stated: string): { ok: boolean; sum: string } {
  const parts = items.map((i) => i.cells[column] ?? '').filter((c) => findNumbers(c).length);
  const r = checkSum(parts, stated);
  return { ok: r.ok, sum: r.sum };
}
