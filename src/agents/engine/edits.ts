/**
 * applyEdits: the person's direction on top of a run's result. The view and the exports
 * read a result only through it.
 *
 *   step-review   approve a step card ("Approve") or clear that; nothing runs again
 *   step-redo     marks the card while the redo run (start.ts redoStep) works
 *   ask-answer    a later answer to an ask
 *   unit-restore  a dropped unit brought back: "Not checked, added by you"
 *   unit-edit     the person's own words for a unit; numbers are checked again and a
 *                 number not in the materials stays with a warning, never as "checked"
 *   row-edit      a cell of a plan item; the plan checks run again on the row
 */
import type { Edit, PlanItem, TaskResult, Unit } from '../types';
import { checkNumbers, missingLine } from '../checks/numbers';
import { checkPlanItem } from '../checks/plan-table';

export type EditContext = { sources?: string[] };

export function applyEdits(result: TaskResult, edits: readonly Edit[], ctx: EditContext = {}): TaskResult {
  if (!edits.length) return result;
  const r: TaskResult = structuredClone(result);
  for (const e of edits) {
    switch (e.kind) {
      case 'step-review': {
        const card = r.cards.find((c) => c.stepId === e.stepId);
        if (card) card.review = e.verdict === 'approved' ? 'approved' : 'none';
        break;
      }
      case 'step-redo': {
        const card = r.cards.find((c) => c.stepId === e.stepId);
        if (card && card.instruction !== e.instruction) {
          card.review = 'redo';
          card.instruction = e.instruction;
        }
        break;
      }
      case 'ask-answer':
        r.answers[e.askId] = e.optionId;
        break;
      case 'unit-restore': {
        const item = r.rejected.find((x) => x.id === e.itemId);
        if (!item || r.units.some((u) => u.id === item.id)) break;
        const stepId = item.station ?? item.id.split(/[.:]/)[0];
        const unit: Unit = {
          id: item.id,
          stepId,
          kind: (item.kind as Unit['kind']) ?? 'note',
          title: item.claim,
          body: item.claim,
          status: 'restored',
          checks: [],
          warnings: ['Not checked, added by you', ...(item.problems ?? [])],
          version: 1,
        };
        r.units.push(unit);
        r.rejected = r.rejected.filter((x) => x.id !== item.id);
        break;
      }
      case 'unit-edit': {
        const unit = r.units.find((u) => u.id === e.unitId);
        if (!unit) break;
        unit.body = e.text;
        unit.status = 'edited';
        unit.version += 1;
        unit.warnings = ctx.sources ? checkNumbers(e.text, ctx.sources).missing.map((m) => `${missingLine(m, 'your materials')} Kept because you wrote it.`) : [];
        const d = r.deliverable;
        if (d?.kind === 'document') {
          const sec = d.sections.find((s) => s.id === unit.id);
          if (sec) sec.text = e.text;
        }
        break;
      }
      case 'row-edit': {
        const d = r.deliverable;
        if (d?.kind !== 'plan') break;
        const item = d.items.find((i) => i.id === e.rowId);
        if (!item) break;
        const field = e.column.toLowerCase();
        if (field === 'task' || field === 'owner' || field === 'start' || field === 'end') (item as Record<string, unknown>)[field] = e.value;
        else item.cells[e.column] = e.value;
        const unit = r.units.find((u) => u.id === item.id);
        const problems = checkPlanItem(item as PlanItem, { all: d.items, window: d.window, team: d.team, sources: [], moneyColumns: [] });
        if (unit) {
          unit.status = 'edited';
          unit.version += 1;
          unit.cells = { ...unit.cells, [e.column]: e.value };
          unit.warnings = problems.map((p) => `${p.text}. Kept because you changed it.`);
        }
        break;
      }
      default:
        break;
    }
  }
  return r;
}
