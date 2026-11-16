/**
 * Late pages resolve contradictions by code (01.4.5): a contradiction becomes
 * `resolved` when a new event (record or account alike: a corrected report is a
 * document, not an explanation) has the same fact field with a literal value, comes
 * from a document by the same author as the document of one side of the pair, and
 * gives the value of the other side. The person's review of the pair is kept; an edit
 * pair-review 'reopened' makes it open again (applyEdits).
 */
import type { CaseEvent, Contradiction, DocMeta } from '../../types';
import { amountValue } from '../../checks/dates';

const same = (field: string, x: string, y: string) => (field.includes('amount') ? amountValue(x) === amountValue(y) : x === y);

export function resolveContradictions(
  contradictions: readonly Contradiction[],
  events: readonly CaseEvent[],
  fresh: readonly CaseEvent[],
  docs: readonly DocMeta[],
): { contradictions: Contradiction[]; resolved: string[] } {
  const authorOf = (e: CaseEvent | undefined) => (e ? docs.find((d) => d.id === e.source.docId)?.author : undefined);
  const resolved: string[] = [];
  const out = contradictions.map((c) => {
    if (c.state === 'resolved') return c;
    const sides: [CaseEvent | undefined, CaseEvent | undefined] = [events.find((e) => e.id === c.a), events.find((e) => e.id === c.b)];
    for (const n of fresh) {
      const f = n.facts.find((x) => x.field === c.field && x.basis === 'literal');
      const author = authorOf(n);
      if (!f || !author) continue;
      for (const s of [0, 1] as const) {
        const other = 1 - s;
        if (authorOf(sides[s]) === author && same(c.field, f.value, c.values[other])) {
          resolved.push(c.key);
          return { ...c, state: 'resolved' as const, resolvedBy: { docId: n.source.docId, page: n.source.page } };
        }
      }
    }
    return c;
  });
  return { contradictions: out, resolved };
}
