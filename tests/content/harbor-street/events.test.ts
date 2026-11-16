import { describe, expect, it } from 'vitest';
import type { Page, RejectReason } from '../../../src/agents/types';
import {
  load, tokens, countRuns, lcs, quoteDates, headDates, weekdayOf, batchOf, MONTHS,
  type AuthorEvent, type AuthorFact, type CaseJson,
} from './helpers';

const pages = load<Page[]>('pages.json');
const latePages = load<Page[]>('late/pages.json');
const meta = load<CaseJson>('case.json');
const events = load<AuthorEvent[]>('events.json');
const lateEvents = load<AuthorEvent[]>('late/events.json');
const planted = load<any>('planted.json');
const latePlanted = load<any>('late/planted.json');
const verdicts = load<any[]>('verdicts.json');
const lateVerdicts = load<any[]>('late/verdicts.json');
const targets = load<any>('targets.json');
const lateTargets = load<any>('late/targets.json');
const lateCase = load<any>('late/case.json');
const truth = load<any>('truth.json');

const allPages = [...pages, ...latePages];
const pageOf = (n: number) => allPages.find((p) => p.n === n)!;
const byTag = (tag: string) => [...events, ...lateEvents].find((e) => e.tag === tag)!;
const fileTokens = allPages.map((p) => tokens(p.text));
const occurrences = (quote: string) => fileTokens.reduce((n, t) => n + countRuns(t, tokens(quote)), 0);

const REASONS: RejectReason[] = ['quote-not-found', 'quote-altered', 'quote-wrong-page', 'quote-reworded', 'quote-too-short', 'date-mismatch',
  'weekday-mismatch', 'date-out-of-range', 'unknown-actor', 'duplicate', 'fact-not-in-quote'];
const NAMES = new Set(meta.parties.map((p) => p.name));
const ALIAS_WORDS = new Set(meta.parties.flatMap((p) => [p.name, ...p.aliases]).flatMap((s) => tokens(s)));
const NEGATIONS = new Set(['no', 'not', 'never', 'none', 'nor', 'neither', 'without']);
const NUMBER_WORDS = new Set(['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']);
const significant = (w: string) =>
  /\d/.test(w) || w.startsWith('$') || NEGATIONS.has(w) || w.endsWith("n't") || NUMBER_WORDS.has(w) || ALIAS_WORDS.has(w) ||
  MONTHS.some((m) => m === w || m.slice(0, 3) === w) || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].includes(w);

function checkEventShape(e: AuthorEvent, fieldTypes: Record<string, string>) {
  // ExtractedEvent plus the author's tag and markers, nothing else
  const allowed = ['tag', 'page', 'quote', 'kind', 'date', 'time', 'actors', 'label', 'summary', 'topic', 'facts', 'dupOf', 'onRecheck'];
  expect(Object.keys(e).filter((k) => !allowed.includes(k)), e.tag).toEqual([]);
  expect(['record', 'account']).toContain(e.kind);
  expect(e.date).toMatch(/^(\d{4}-\d\d-\d\d)?$/);
  expect(e.time).toMatch(/^(\d\d:\d\d)?$/);
  expect(e.actors.length, e.tag).toBeGreaterThan(0);
  for (const a of e.actors) expect(NAMES.has(a), `${e.tag}: ${a}`).toBe(true);
  const words = e.label.split(' ');
  expect(words.length, e.label).toBeLessThanOrEqual(3);
  for (const w of words) expect(w.length, e.label).toBeLessThanOrEqual(9);
  expect(e.summary).toMatch(/^[A-Z].*\.$/);
  expect(meta.topics).toContain(e.topic);
  for (const f of e.facts) checkFactShape(e, f, fieldTypes);
}

function checkFactShape(e: AuthorEvent, f: AuthorFact, fieldTypes: Record<string, string>) {
  expect(fieldTypes[f.field], `${e.tag} ${f.field}`).toBe(f.type);
  expect(['literal', 'derived']).toContain(f.basis);
  const format: Record<string, RegExp> = { date: /^\d{4}-\d\d-\d\d$/, amount: /^\d+(\.\d+)?$/, time: /^\d\d:\d\d$/, yesno: /^(yes|no)$/, presence: /^(here|away)$/ };
  expect(f.value, `${e.tag} ${f.field}`).toMatch(format[f.type]);
  if (f.type === 'presence') {
    expect(meta.parties.map((p) => p.id)).toContain(f.subject);
    expect(f.from! <= f.to!).toBe(true);
  }
}

function checkDates(e: AuthorEvent, page: Page) {
  // a weekday in the quote must be the weekday of the event date, or the weekday check rejects a true claim
  for (const m of e.quote.matchAll(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g)) expect(weekdayOf(e.date), `${e.tag}`).toBe(m[1]);
  if (!e.date) {
    expect(e.kind, `${e.tag} has no date`).toBe('account');
    return;
  }
  const inQuote = quoteDates(page, e.quote).includes(e.date);
  const inHead = headDates(page).includes(e.date);
  // an account takes its date only from the quote; a record may take it from the page head
  expect(e.kind === 'account' ? inQuote : inQuote || inHead, `${e.tag} date ${e.date}`).toBe(true);
}

const fieldTypes = Object.fromEntries(meta.fields.map((f) => [f.id, f.type]));
const overlap = (a: string, b: string) => {
  const ta = new Set(tokens(a)), tb = new Set(tokens(b));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  return { jaccard: inter / new Set([...ta, ...tb]).size, ofSmaller: inter / Math.min(ta.size, tb.size) };
};

describe('Harbor Street events', () => {
  it('has 124 events: 118 found in the first answer, 4 duplicates to merge and 2 returned on the second look', () => {
    expect(events).toHaveLength(124);
    expect(events.filter((e) => e.dupOf)).toHaveLength(4);
    expect(events.filter((e) => e.onRecheck)).toHaveLength(2);
    expect(new Set(events.map((e) => e.tag)).size).toBe(124);
  });

  it('finds every quote word for word on its page and nowhere else in the bundle', () => {
    for (const e of events) {
      expect(pageOf(e.page).text, e.tag).toContain(e.quote);
      expect(occurrences(e.quote), e.tag).toBe(1);
      expect(e.quote.length).toBeGreaterThanOrEqual(12);
    }
  });

  it('matches the shape of ExtractedEvent with known parties, topics and fact fields', () => {
    for (const e of events) checkEventShape(e, fieldTypes);
  });

  it('dates every event from its quote, or for a record from the page head', () => {
    for (const e of events) checkDates(e, pageOf(e.page));
  });

  it('makes each duplicate overlap its event on the same page by more than 60% of tokens, after it in the answer', () => {
    for (const d of events.filter((e) => e.dupOf)) {
      const main = byTag(d.dupOf!);
      expect(main.page).toBe(d.page);
      expect(events.indexOf(main)).toBeLessThan(events.indexOf(d));
      expect(overlap(main.quote, d.quote).jaccard, d.tag).toBeGreaterThan(0.6);
      expect(main.dupOf).toBeUndefined();
    }
  });

  it('keeps different events on the same page apart, so nothing is merged by accident', () => {
    const real = events.filter((e) => !e.dupOf);
    for (let i = 0; i < real.length; i++)
      for (let j = i + 1; j < real.length; j++)
        if (real[i].page === real[j].page) expect(overlap(real[i].quote, real[j].quote).ofSmaller, `${real[i].tag} / ${real[j].tag}`).toBeLessThanOrEqual(0.6);
  });

  it('returns the two second-look events only in batches that are sent back', () => {
    const sentBackBatches = new Set(planted.planted.filter((p: any) => p.recheck).map((p: any) => p.batch));
    expect([...sentBackBatches].sort()).toEqual([4, 6, 8, 9]);
    for (const e of events.filter((x) => x.onRecheck)) expect(sentBackBatches.has(batchOf(e.page)), e.tag).toBe(true);
  });
});

describe('Harbor Street planted errors', () => {
  const list = planted.planted as any[];
  const reasons = Object.fromEntries(list.map((p) => [p.reason + ':' + p.page, p]));

  it('plants nine errors with a known reason, an outcome and the batch of their page', () => {
    expect(list).toHaveLength(9);
    for (const p of list) {
      expect(REASONS).toContain(p.reason);
      expect(['dropped', 'fixed', 'corrected', 'fact-removed']).toContain(p.outcome);
      expect(batchOf(p.page)).toBe(p.batch);
      if (p.target) expect(byTag(p.target).page).toBe(p.page);
      expect(p.claim.page === p.page || p.reason === 'quote-wrong-page').toBe(true);
    }
    expect(list.map((p) => `${p.batch}:${p.reason}`).sort()).toEqual([
      '10:quote-reworded', '4:date-out-of-range', '4:quote-not-found', '6:date-mismatch', '6:weekday-mismatch',
      '7:quote-wrong-page', '8:unknown-actor', '9:fact-not-in-quote', '9:quote-not-found',
    ]);
  });

  it('invents quotes that are not in the bundle at all', () => {
    for (const p of list.filter((x) => x.reason === 'quote-not-found')) {
      expect(p.target).toBeUndefined();
      expect(occurrences(p.claim.quote)).toBe(0);
      const t = tokens(p.claim.quote);
      // far from any window of the page, so it cannot pass as a reworded quote
      expect(lcs(t, tokens(pageOf(p.page).text)) / t.length).toBeLessThan(0.9);
      expect(p.recheck).toEqual({ action: 'withdraw' });
    }
  });

  it('puts the wrong-page quote on the page next door, in the same batch', () => {
    const p = reasons['quote-wrong-page:41'];
    expect(p.claim.page).toBe(40);
    expect(batchOf(40)).toBe(batchOf(41));
    expect(pageOf(41).text).toContain(p.claim.quote);
    expect(pageOf(40).text).not.toContain(p.claim.quote);
  });

  it('rewords a long quote with two small words, so code corrects it instead of rejecting it', () => {
    const p = reasons['quote-reworded:57'];
    const claim = tokens(p.claim.quote), source = tokens(byTag(p.target).quote);
    expect(claim.length).toBeGreaterThanOrEqual(12);
    expect(claim).toHaveLength(source.length);
    const changed = source.filter((w, i) => w !== claim[i]);
    expect(changed).toEqual(['had', 'the']);
    expect(claim.filter((w, i) => w !== source[i])).toEqual(['has', 'that']);
    for (const w of [...changed, 'has', 'that']) expect(significant(w), w).toBe(false);
    expect(lcs(claim, source) / claim.length).toBeGreaterThanOrEqual(0.9);
    expect(occurrences(p.claim.quote)).toBe(0);
  });

  it('gives each date error the reason its date would really get', () => {
    const range = reasons['date-out-of-range:20'];
    expect(range.claim.date < truth.window.noDateBefore).toBe(true);
    expect(range.recheck).toEqual({ action: 'fix', date: range.claim.date }); // the second look repeats the error
    expect(range.dropCause).toBe('failed-again');

    const mismatch = reasons['date-mismatch:33'];
    const p33 = pageOf(33);
    expect([...quoteDates(p33, mismatch.claim.quote), ...headDates(p33)]).not.toContain(mismatch.claim.date);
    expect(quoteDates(p33, mismatch.claim.quote)).toContain(mismatch.recheck.date);

    const weekday = reasons['weekday-mismatch:35'];
    const p35 = pageOf(35);
    expect(headDates(p35)).toContain(weekday.claim.date); // the date itself is on the page head, so only the weekday fails
    expect(weekday.claim.quote).toMatch(/\bFriday\b/);
    expect(weekdayOf(weekday.claim.date)).not.toBe('Friday');
    expect(weekday.recheck.date).toBe('2026-03-06');
    expect(weekdayOf(weekday.recheck.date)).toBe('Friday');
  });

  it('names an actor who is not in the case and fixes it to the right party', () => {
    const p = reasons['unknown-actor:44'];
    expect(p.claim.actors.filter((a: string) => !NAMES.has(a))).toEqual(['Ms Whitmore']);
    for (const a of p.recheck.actors) expect(NAMES.has(a)).toBe(true);
  });

  it('attaches an amount that the quote does not contain', () => {
    const p = reasons['fact-not-in-quote:52'];
    expect(p.claim.facts).toEqual([{ field: 'deposit.amount', type: 'amount', value: '2600', basis: 'literal' }]);
    expect(p.claim.quote).not.toMatch(/2,?600/);
    expect(byTag(p.target).facts).toEqual([]);
  });

  it('times the scripted answers like the target model', () => {
    expect(planted.ms.plan).toBe(3000);
    expect(Object.keys(planted.ms.extract)).toHaveLength(11);
    for (const ms of Object.values<number>(planted.ms.extract)) expect(ms >= 5000 && ms <= 8000).toBe(true);
    expect(planted.ms.extract[4]).toBe(6000);
    for (const ms of Object.values<number>(planted.ms.recheck)) expect(ms >= 3000 && ms <= 5000).toBe(true);
    expect(Object.values(planted.ms.reconcile)).toEqual([6000, 6000]);
  });
});

// ----- what the mechanism should count, worked out from the author's material -----

type Ev = AuthorEvent;
function differs(field: string, a: AuthorFact, b: AuthorFact): boolean {
  if (a.type === 'date') return a.value !== b.value;
  if (a.type === 'time') {
    const m = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
    const d = Math.abs(m(a.value) - m(b.value));
    return Math.min(d, 1440 - d) >= 30;
  }
  if (a.type === 'presence') return a.subject === b.subject && a.value !== b.value && a.from! <= b.to! && b.from! <= a.to!;
  return a.value !== b.value && field !== '';
}
/** Candidate pairs as PLAN describes them: same fact field, different value. */
function candidates(list: Ev[], only?: (a: Ev, b: Ev) => boolean): { a: string; b: string; field: string }[] {
  const out: { a: string; b: string; field: string }[] = [];
  for (let i = 0; i < list.length; i++)
    for (let j = i + 1; j < list.length; j++) {
      if (only && !only(list[i], list[j])) continue;
      for (const fa of list[i].facts)
        for (const fb of list[j].facts) if (fa.field === fb.field && differs(fa.field, fa, fb)) out.push({ a: list[i].tag, b: list[j].tag, field: fa.field });
    }
  return out;
}
const key = (a: string, b: string) => [a, b].sort().join('|');
const finalEvents = events.filter((e) => !e.dupOf && e.tag !== 'em-sent-leak'); // the planted wrong year drops this one

describe('Harbor Street pairs and verdicts', () => {
  const pairs = candidates(finalEvents);

  it('gives the pair search exactly the 14 pairs that the verdict notes cover', () => {
    expect(pairs).toHaveLength(targets.pairs);
    expect(new Set(pairs.map((p) => key(p.a, p.b)))).toEqual(new Set(verdicts.map((v) => key(v.a, v.b))));
    for (const v of verdicts) expect(pairs.find((p) => key(p.a, p.b) === key(v.a, v.b))!.field).toBe(v.field);
  });

  it('judges 6 contradictions, 7 explained pairs and 1 question', () => {
    const count = (v: string) => verdicts.filter((x) => x.verdict === v).length;
    expect([count('contradiction'), count('explained'), count('unsure')]).toEqual([targets.contradictions, targets.explained, targets.asked]);
    expect(new Set(verdicts.filter((v) => v.verdict === 'contradiction').map((v) => key(v.a, v.b)))).toEqual(
      new Set(truth.contradictions.map((c: any) => key(c.a.tag, c.b.tag))),
    );
    for (const v of verdicts) expect(v.explanation.length).toBeGreaterThan(20);
    expect(verdicts.find((v) => v.verdict === 'unsure').question.length).toBeLessThanOrEqual(240);
  });

  it('finds three pairs on the keys field, one per pair of the dates on pages 55, 48 and 50', () => {
    const keys = pairs.filter((p) => p.field === 'keys.returned_on');
    expect(keys).toHaveLength(3);
    expect(new Set(keys.flatMap((p) => [byTag(p.a).page, byTag(p.b).page]))).toEqual(new Set([55, 48, 50]));
  });

  it('keeps the boarding pass out of the pairs while it supports the tenant', () => {
    expect(pairs.some((p) => p.a === 'rc-boarding' || p.b === 'rc-boarding')).toBe(false);
    const boarding = byTag('rc-boarding').facts[0], abroad = byTag('ts-abroad').facts[0];
    expect([boarding.subject, boarding.value]).toEqual([abroad.subject, abroad.value]);
  });
});

describe('Harbor Street targets', () => {
  const list = planted.planted as any[];
  const firstAnswer = events.filter((e) => !e.onRecheck);
  const invented = list.filter((p) => !p.target);
  const sentBack = list.filter((p) => p.recheck);

  it('adds up to the author targets', () => {
    const claims = firstAnswer.length + invented.length;
    const merged = events.filter((e) => e.dupOf).length;
    const corrected = list.filter((p) => p.outcome === 'corrected').length;
    const fixed = sentBack.filter((p) => p.outcome === 'fixed').length;
    const dropped = sentBack.filter((p) => p.outcome === 'dropped').length;
    const added = events.filter((e) => e.onRecheck).length;
    const matched = claims - corrected - merged - sentBack.length;
    expect({ claims, matched, corrected, merged, sentBack: sentBack.length, fixed, dropped, added }).toEqual({
      claims: targets.claims, matched: targets.matched, corrected: targets.corrected, merged: targets.merged,
      sentBack: targets.sentBack, fixed: targets.fixed, dropped: targets.dropped, added: targets.added,
    });
    expect(matched + corrected + fixed + added).toBe(targets.events);
    expect(finalEvents.length).toBe(targets.events);
    expect(list.filter((p) => p.outcome === 'fact-removed')).toHaveLength(targets.factsRemoved);
    expect([list.length, list.length]).toEqual([targets.planted, targets.caught]); // every planted error is kept out of the result
  });

  it('needs 18 calls: a plan, 11 batches, 4 second looks and 2 reconcile calls of up to 10 pairs', () => {
    const batches = new Set(pages.map((p) => batchOf(p.n))).size;
    const rechecks = new Set(sentBack.map((p) => p.batch)).size;
    const reconcile = Math.ceil(targets.pairs / 10);
    expect({ plan: 1, extract: batches, recheck: rechecks, reconcile, total: 1 + batches + rechecks + reconcile }).toEqual(targets.calls);
  });
});

describe('Harbor Street late envelope', () => {
  it('has pages 65 and 66, dated 9 November 2026, by the author of the check-out report and the plumber', () => {
    expect(latePages.map((p) => p.n)).toEqual([65, 66]);
    for (const p of latePages) expect(headDates(p)).toContain('2026-11-09');
    expect(lateCase.label).toEqual(['2 late pages', 'Dana Whitlock \u00b7 sample']);
    const checkout = meta.docs.find((d) => d.id === 'checkout')!;
    expect(lateCase.docs.find((d: any) => d.from === 65).author).toBe(checkout.author);
    expect(lateCase.docs.find((d: any) => d.from === 66).author).toBe('sam');
    for (const p of latePages) expect(lateCase.docs.find((d: any) => d.id === p.docId)).toBeTruthy();
  });

  it('quotes the late pages word for word, once in the whole bundle', () => {
    expect(lateEvents).toHaveLength(3);
    for (const e of lateEvents) {
      expect(pageOf(e.page).text).toContain(e.quote);
      expect(occurrences(e.quote), e.tag).toBe(1);
      checkEventShape(e, fieldTypes);
      checkDates(e, pageOf(e.page));
    }
    expect(lateEvents.filter((e) => e.page === 65).map((e) => e.kind)).toEqual(['record', 'record']);
    const fake = latePlanted.planted[0];
    expect(fake.reason).toBe('quote-not-found');
    expect(occurrences(fake.claim.quote)).toBe(0);
  });

  it('meets the phrase on page 26 with the job sheet on page 66', () => {
    expect(pageOf(26).text).toContain('The first contractor visit to Unit 4B was on 10 February 2026.');
    expect(pageOf(66).text).toContain('First attendance at Unit 4B: 24 January 2026.');
  });

  it('finds pairs only between new and old events, and every one has a note', () => {
    const lateTags = new Set(lateEvents.map((e) => e.tag));
    const pairs = candidates([...finalEvents, ...lateEvents], (a, b) => lateTags.has(a.tag) !== lateTags.has(b.tag));
    expect(new Set(pairs.map((p) => key(p.a, p.b)))).toEqual(new Set(lateVerdicts.map((v) => key(v.a, v.b))));
    expect(pairs).toHaveLength(lateTargets.pairs);
    expect(lateVerdicts.filter((v) => v.verdict === 'contradiction')).toHaveLength(lateTargets.newContradictions);
    expect(pairs.some((p) => [p.a, p.b].includes('ts-keys'))).toBe(false); // page 55 and page 65 give the same date
  });

  it('resolves the keys contradiction: same author as the report, the tenant\'s date, a literal value', () => {
    const keys = truth.contradictions.find((c: any) => c.id === 'keys-returned');
    const docAuthor = (page: number) => [...meta.docs, ...lateCase.docs].find((d: any) => page >= d.from && page <= d.to)?.author;
    const resolver = lateEvents.filter((e) => e.facts.some((f) => f.field === keys.field)).find((e) => {
      const f = e.facts.find((x) => x.field === keys.field)!;
      return [keys.a, keys.b].some((s: any, i: number) => docAuthor(s.page) === docAuthor(e.page) && f.basis === 'literal' && f.value === [keys.a, keys.b][1 - i].value);
    });
    expect(resolver?.tag).toBe(lateTargets.resolvedBy.event);
    expect(lateTargets).toMatchObject({ claims: 4, events: 3, dropped: 1, resolved: 1, newContradictions: 1, calls: { total: 2, ids: ['extract/12', 'reconcile/3'] } });
    expect(lateEvents.length + latePlanted.planted.length).toBe(lateTargets.claims);
  });
});
