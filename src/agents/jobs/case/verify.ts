/**
 * The gate (PLAN "Трудный механизм", step verify): one claim of the extractor through
 * checkQuote, checkDate, checkActors, dedupe and checkFact, in that order, and the event
 * it becomes. Used by the first run, the second look and later pages alike.
 */
import type { CaseEvent, CasePlan, CheckedItem, Doc, ExtractedEvent, Fact, Page, Party } from '../../types';
import { hash6 } from '../../../materials/normalize';
import { actorIndex, checkActors } from '../../checks/actors';
import { checkDate, findTimes, headDates, isTime, type CaseWindow } from '../../checks/date';
import { dedupe, type Kept } from '../../checks/dedupe';
import { checkFact } from '../../checks/fact';
import { checkQuote } from '../../checks/quote';
import { significance } from '../../checks/significant';
import type { QuoteSpan } from '../../types';

export type CheckEnv = {
  plan: CasePlan;
  docs: readonly Doc[];
  pages: readonly Page[];
  window: CaseWindow | null;
  docDates: Record<string, string | undefined>;
  sig: (token: string) => boolean;
  actors: Map<string, string>;
  pageByN: Map<number, Page>;
};

export function checkEnv(plan: CasePlan, docs: readonly Doc[], pages: readonly Page[], window: CaseWindow | null): CheckEnv {
  return {
    plan,
    docs,
    pages,
    window,
    docDates: Object.fromEntries(docs.map((d) => [d.meta.id, d.meta.date])),
    sig: significance(plan.parties),
    actors: actorIndex(plan.parties),
    pageByN: new Map(pages.map((p) => [p.n, p])),
  };
}

export type ClaimVerdict = {
  status: 'accepted' | 'corrected' | 'merged' | 'rejected';
  item: CheckedItem;
  /** The event the claim became (accepted or corrected). */
  event?: CaseEvent;
  /** Where its quote stands (for coverage). */
  spans: QuoteSpan[];
  /** Items of facts removed from the event. */
  factItems: CheckedItem[];
  factsChecked: number;
  factsRemoved: number;
  /** Human words for the reason, for the caption line. */
  detail?: string;
  mergedInto?: string;
};

/** Facts as the model sends them ('' for a missing subject, from or to) in contract form. */
export function cleanFacts(facts: readonly Fact[] | undefined): Fact[] {
  return (facts ?? []).map((f) => {
    const out: Fact = { field: f.field, type: f.type, value: String(f.value ?? '').trim(), basis: f.basis };
    if (f.subject) out.subject = f.subject;
    if (f.from) out.from = f.from;
    if (f.to) out.to = f.to;
    return out;
  });
}

/** The answer of the extractor with every optional value present, as the flat schema has it. */
export function fillEvent(e: Partial<ExtractedEvent>): ExtractedEvent {
  return {
    kind: e.kind === 'account' ? 'account' : 'record',
    date: e.date ?? '',
    time: e.time ?? '',
    actors: Array.isArray(e.actors) ? e.actors : [],
    label: e.label ?? '',
    summary: e.summary ?? '',
    quote: e.quote ?? '',
    page: typeof e.page === 'number' ? e.page : Number(e.page) || 0,
    topic: e.topic ?? '',
    facts: (Array.isArray(e.facts) ? e.facts : []).map((f) => ({ subject: '', from: '', to: '', ...f })) as Fact[],
  };
}

export const eventId = (page: number, quote: string): string => `e${page}-${hash6(quote)}`;

export function verifyClaim(
  id: string,
  claim: ExtractedEvent,
  env: CheckEnv,
  kept: readonly Kept[],
  meta: { batch: number; planted?: boolean; seeded?: boolean; pass: number; status: CaseEvent['status'] },
): ClaimVerdict {
  const base: CheckedItem = {
    id,
    kind: 'claim',
    status: 'rejected',
    claim: claim.quote,
    batch: meta.batch,
    ...(meta.planted ? { planted: true } : {}),
    ...(meta.seeded ? { seeded: true } : {}),
  };
  const q = checkQuote(claim, env.pages, env.sig);
  const page = env.pageByN.get(q.page);
  const doc = page ? env.docs.find((d) => d.meta.id === page.docId)?.meta : undefined;
  const ref = page ? { docId: page.docId, page: page.n } : undefined;
  const item: CheckedItem = {
    ...base,
    ...(ref ? { ref } : {}),
    ...(q.found ? { found: q.found } : {}),
    ...(q.diff ? { diff: q.diff } : {}),
    ...(q.spans?.length ? { spans: q.spans } : {}),
  };
  const reject = (reason: CheckedItem['reason'], detail?: string): ClaimVerdict => ({
    status: 'rejected',
    item: { ...item, status: 'rejected', reason },
    spans: q.spans ?? [],
    factItems: [],
    factsChecked: 0,
    factsRemoved: 0,
    ...(detail ? { detail } : {}),
  });
  if (q.status === 'rejected' || !page) return reject(q.reason ?? 'quote-not-found');

  const d = checkDate({ kind: claim.kind, date: claim.date, quote: q.quote }, page, env.window, doc?.date);
  if (d.status === 'rejected') return reject(d.reason, d.detail);

  const a = checkActors(claim.actors, env.actors);
  if (a.status === 'rejected') return reject('unknown-actor', `${a.unknown.join(', ')} ${a.unknown.length > 1 ? 'are' : 'is'} not in this case`);

  const into = dedupe({ page: page.n, quote: q.quote }, kept);
  if (into) {
    return {
      status: 'merged',
      item: { ...item, status: 'merged', reason: 'duplicate', eventId: into },
      spans: q.spans ?? [],
      factItems: [],
      factsChecked: 0,
      factsRemoved: 0,
      mergedInto: into,
    };
  }

  const facts: Fact[] = [];
  const factItems: CheckedItem[] = [];
  const raw = cleanFacts(claim.facts);
  const evId = eventId(page.n, q.quote);
  raw.forEach((f, k) => {
    const r = checkFact(f, q.quote, { page, docDate: doc?.date, fields: env.plan.fields });
    if (r.status === 'accepted') {
      const field = env.plan.fields.find((x) => x.id === f.field);
      facts.push({ ...f, type: field?.type ?? f.type });
    } else {
      factItems.push({
        id: `${id}.f${k + 1}`,
        kind: 'fact',
        status: 'rejected',
        reason: 'fact-not-in-quote',
        claim: `${f.field}: ${f.value}`,
        eventId: evId,
        batch: meta.batch,
        ...(meta.planted ? { planted: true } : {}),
        ...(meta.seeded ? { seeded: true } : {}),
        ref: { docId: page.docId, page: page.n },
        diff: { claim: `${f.field}: ${f.value}`, source: q.quote },
      });
    }
  });

  const status = q.status === 'corrected' ? 'corrected' : 'accepted';
  const time = claim.time && isTime(claim.time) && timeStated(claim.time, q.quote, page) ? claim.time : '';
  const at = d.at ? (time ? `${d.at}T${time}` : d.at) : null;
  const lane = doc?.author && env.plan.parties.some((p) => p.id === doc.author) ? doc.author : (a.ids[0] ?? env.plan.parties[0]?.id ?? '');
  const event: CaseEvent = {
    id: evId,
    kind: claim.kind,
    at,
    precision: at && time ? 'minute' : 'day',
    saidAt: doc?.date ?? headDates(page, doc?.date)[0] ?? d.at ?? '',
    actors: a.ids,
    lane,
    label: claim.label.trim() || claim.topic,
    summary: claim.summary.trim(),
    quote: q.quote,
    source: { docId: page.docId, docTitle: doc?.title ?? page.docId, page: page.n },
    topic: claim.topic,
    facts,
    status: meta.status === 'verified' && status === 'corrected' ? 'corrected' : meta.status,
    pass: meta.pass,
  };
  return {
    status,
    item: { ...item, status, ...(q.reason ? { reason: q.reason } : {}), eventId: evId },
    event,
    spans: q.spans ?? [],
    factItems,
    factsChecked: raw.length,
    factsRemoved: factItems.length,
  };
}

/** A time is kept only when the quote or the page heading states it. */
function timeStated(time: string, quote: string, page: Page): boolean {
  if (findTimes(quote).some((t) => t.value === time)) return true;
  const heads = page.blocks?.filter((b) => b.k === 'head').map((b) => b.text).join('\n') ?? '';
  return findTimes(heads).some((t) => t.value === time);
}

/**
 * Parties written in the material: the name or a proper-noun alias ("Ms Ortiz", not the
 * role word "landlord") stands in the text as whole words, in any case.
 */
export function partiesInText(parties: readonly Party[], text: string): Party[] {
  const lower = text.toLowerCase();
  const word = (s: string) => new RegExp(`(^|[^\\p{L}])${s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'u');
  return parties.filter((p) =>
    [p.name, ...p.aliases.filter((a) => /^\p{Lu}/u.test(a.trim()))].some((n) => n.trim().length > 1 && word(n.trim()).test(lower)),
  );
}

