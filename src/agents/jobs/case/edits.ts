/**
 * The person's edits over a case result (PLAN "Результат дела"): views and export read
 * applyEdits(result, project.edits), never the raw result. Edits apply in order; a later
 * edit of the same pair replaces an earlier one.
 *
 *   pair-review kept | dismissed   the contradiction's review
 *   pair-review cleared            "Undo": the review is open again
 *   pair-review reopened           a pair resolved by a late page is open again ("reopened by you")
 *   ask-answer                     a question answered after the run (applyAnswer)
 *   event-restore                  a dropped claim comes back: "Not verified, added by you"
 *
 * A new run keeps the decisions whose pair keys it finds again (carryDecisions).
 */
import type { CaseEvent, CaseResult, Edit } from '../../types';
import { applyAnswer } from './reconcile';
import { eventId } from './verify';

export function applyEdits(result: CaseResult, edits: readonly Edit[]): CaseResult {
  let out: CaseResult = {
    ...result,
    contradictions: result.contradictions.map((c) => ({ ...c })),
    events: [...result.events],
  };
  for (const edit of edits) {
    if (edit.kind === 'pair-review') {
      const c = out.contradictions.find((x) => x.key === edit.key);
      if (!c) continue;
      if (edit.verdict === 'kept' || edit.verdict === 'dismissed') c.review = edit.verdict;
      else if (edit.verdict === 'cleared') c.review = 'open';
      else if (edit.verdict === 'reopened') {
        c.state = 'open';
        delete c.resolvedBy;
      }
    } else if (edit.kind === 'ask-answer') {
      out = applyAnswer(out, edit.askId, edit.optionId);
    } else if (edit.kind === 'event-restore') {
      const event = restoredEvent(out, edit.itemId);
      if (event && !out.events.some((e) => e.id === event.id)) {
        out = { ...out, events: [...out.events, event].sort(byTime), rejected: out.rejected.filter((r) => r.id !== edit.itemId) };
      }
    }
  }
  return out;
}

/** A dropped claim as an event of the person ("Not verified, added by you"). */
function restoredEvent(result: CaseResult, itemId: string): CaseEvent | null {
  const item = result.rejected.find((r) => r.id === itemId);
  const claim = result.restorable?.[itemId];
  if (!item || !claim || item.seeded) return null;
  const page = item.ref?.page ?? claim.page;
  const doc = result.docs.find((d) => d.id === item.ref?.docId) ?? result.docs.find((d) => page >= d.from && page <= d.to);
  const ids = result.parties.filter((p) => claim.actors.some((a) => [p.name, ...p.aliases, p.id].some((n) => n.toLowerCase() === a.toLowerCase()))).map((p) => p.id);
  return {
    id: eventId(page, claim.quote),
    kind: claim.kind,
    at: /^\d{4}-\d{2}-\d{2}$/.test(claim.date) ? claim.date : null,
    precision: 'day',
    saidAt: doc?.date ?? claim.date ?? '',
    actors: ids,
    lane: doc?.author && result.parties.some((p) => p.id === doc.author) ? doc.author : (ids[0] ?? result.parties[0]?.id ?? ''),
    label: claim.label || claim.topic,
    summary: claim.summary,
    quote: claim.quote,
    source: { docId: doc?.id ?? item.ref?.docId ?? '', docTitle: doc?.title ?? '', page },
    topic: claim.topic,
    facts: [],
    status: 'restored',
    pass: Math.max(1, ...result.events.map((e) => e.pass)),
  };
}

/** Chronological order: dated events by date, then those without a date; then page and id. */
export function byTime(a: CaseEvent, b: CaseEvent): number {
  if (a.at && b.at && a.at !== b.at) return a.at < b.at ? -1 : 1;
  if (Boolean(a.at) !== Boolean(b.at)) return a.at ? -1 : 1;
  return a.source.page - b.source.page || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The pair decisions that still apply to a new result: their keys are found again. */
export function carryDecisions(edits: readonly Edit[], result: CaseResult): Edit[] {
  const keys = new Set([...result.contradictions.map((c) => c.key), ...result.explained.map((e) => e.key)]);
  const asks = new Set(result.open.map((o) => o.askId));
  return edits.filter((e) => {
    if (e.kind === 'pair-review') return keys.has(e.key);
    if (e.kind === 'ask-answer') return asks.has(e.askId);
    if (e.kind === 'event-restore') return result.rejected.some((r) => r.id === e.itemId);
    return true;
  });
}
