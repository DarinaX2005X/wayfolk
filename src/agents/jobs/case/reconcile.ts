/**
 * Joining the reconciler's verdicts to the candidates by pair key (PLAN "Трудный
 * механизм", step reconcile):
 *   contradiction  a Contradiction: 'direct' when both values are literal, otherwise
 *                  'judgment'; `supports` takes third events with the value of one side
 *   explained      an Explained pair
 *   unsure         a question to the person (no more than two per run): the first option
 *                  makes the pair a contradiction with origin 'you', the second an
 *                  Explained pair by 'you'; without an answer the pair stays in `open`
 *   unjudged       a pair the recording never judged: "Not compared in this recording"
 */
import type { CaseEvent, CaseResult, Contradiction, Explained, FactField, OpenAsk } from '../../types';
import { candidates, type Candidate } from './candidates';

export type Verdict = 'contradiction' | 'explained' | 'unsure' | 'unjudged';
export type PairVerdict = { pairKey: string; verdict: Verdict; explanation: string; question?: string; options?: string[] };

export const MAX_ASKS = 2;
export const MAX_QUESTION_CHARS = 240;
export const OPTION_CONFLICT = 'conflict';
export const OPTION_EXPLAINED = 'explained';

/** 'keys.returned_on' -> 'Keys returned on'. */
export function fieldLabel(fieldId: string): string {
  const words = fieldId.replace(/[._]+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : fieldId;
}

export function supportsFor(c: Candidate, events: readonly CaseEvent[]): Contradiction['supports'] {
  const out: Contradiction['supports'] = [];
  const subjectOf = (id: string) => events.find((e) => e.id === id)?.facts.find((f) => f.field === c.field)?.subject ?? '';
  const subject = subjectOf(c.a);
  for (const e of events) {
    if (e.id === c.a || e.id === c.b) continue;
    const f = e.facts.find((x) => x.field === c.field);
    if (!f || (f.subject ?? '') !== subject) continue;
    if (f.value === c.values[0]) out.push({ eventId: e.id, side: 'a' });
    else if (f.value === c.values[1]) out.push({ eventId: e.id, side: 'b' });
  }
  return out;
}

export function makeContradiction(
  c: Candidate,
  events: readonly CaseEvent[],
  fields: readonly FactField[],
  explanation: string,
  origin: Contradiction['origin'],
): Contradiction {
  const ea = events.find((e) => e.id === c.a);
  const eb = events.find((e) => e.id === c.b);
  const fa = ea?.facts.find((f) => f.field === c.field);
  const fb = eb?.facts.find((f) => f.field === c.field);
  const field = fields.find((f) => f.id === c.field);
  return {
    key: c.key,
    a: c.a,
    b: c.b,
    topic: field?.topic ?? ea?.topic ?? '',
    field: c.field,
    label: fieldLabel(c.field),
    kind: fa?.basis === 'literal' && fb?.basis === 'literal' ? 'direct' : 'judgment',
    values: c.values,
    explanation,
    origin,
    state: 'open',
    supports: supportsFor(c, events),
    review: 'open',
  };
}

/** The question for the person: the model's own when short enough, else a template from the pair's values. */
export function askQuestion(v: PairVerdict, c: Candidate): string {
  const q = (v.question ?? '').trim();
  if (q && q.length <= MAX_QUESTION_CHARS) return q;
  return `The documents give two values for ${fieldLabel(c.field).toLowerCase()}: ${c.values[0]} and ${c.values[1]}. Is this a real conflict?`;
}

export function askOptions(v: PairVerdict): { id: string; label: string }[] {
  const given = (v.options ?? []).map((o) => o.trim()).filter(Boolean);
  const [conflict, explained] = given.length >= 2 ? given : ["Yes, it's a conflict", 'No, both can be true'];
  return [
    { id: OPTION_CONFLICT, label: conflict },
    { id: OPTION_EXPLAINED, label: explained },
  ];
}

/** What an answer makes of an asked pair. */
export function answerPair(
  ask: OpenAsk,
  optionId: string,
  c: Candidate,
  events: readonly CaseEvent[],
  fields: readonly FactField[],
): { contradiction: Contradiction } | { explained: Explained } {
  const label = ask.options.find((o) => o.id === optionId)?.label ?? optionId;
  if (optionId === (ask.options[0]?.id ?? OPTION_CONFLICT)) {
    return { contradiction: makeContradiction(c, events, fields, `You answered "${label}": ${ask.question}`, 'you') };
  }
  return { explained: { key: c.key, a: c.a, b: c.b, reason: `You answered "${label}": ${ask.question}`, by: 'you' } };
}

/** The candidate between two events of a result, if their facts still disagree. */
export function candidateBetween(result: Pick<CaseResult, 'events' | 'fields'>, a: string, b: string): Candidate | null {
  const pair = result.events.filter((e) => e.id === a || e.id === b);
  return candidates(pair, result.fields)[0] ?? null;
}

/**
 * The person answered a question after the run ended (or answers it again): the pair
 * leaves `open` and becomes a contradiction or an explained pair.
 */
export function applyAnswer(result: CaseResult, askId: string, optionId: string): CaseResult {
  const ask = result.open.find((o) => o.askId === askId);
  if (!ask || !ask.options.some((o) => o.id === optionId)) return result;
  const c = candidateBetween(result, ask.pair[0], ask.pair[1]);
  if (!c) return result;
  const out = answerPair(ask, optionId, c, result.events, result.fields);
  return {
    ...result,
    open: result.open.filter((o) => o.askId !== askId),
    contradictions: 'contradiction' in out ? [...result.contradictions.filter((x) => x.key !== c.key), out.contradiction] : result.contradictions,
    explained: 'explained' in out ? [...result.explained.filter((x) => x.key !== c.key), out.explained] : result.explained,
  };
}
