import { describe, expect, it } from 'vitest';
import { checkActors } from '../../src/agents/checks/actors';
import { caseWindow, checkDate, findDatedPassages, findDates, quoteDates } from '../../src/agents/checks/date';
import { dedupe } from '../../src/agents/checks/dedupe';
import { diffWords, locateQuote } from '../../src/agents/checks/diff';
import { checkFact, hasRelativeTime } from '../../src/agents/checks/fact';
import { checkQuote } from '../../src/agents/checks/quote';
import { alterKeyWord, mulberry32, seedClaims, shiftPage, SEED_KINDS } from '../../src/agents/checks/seed';
import { isSignificant, significance } from '../../src/agents/checks/significant';
import type { Block, Page, Party } from '../../src/agents/types';
import { blockText } from '../../src/materials/text';
import { willowClaims, willowDocs, willowPages, willowPlan } from './fixtures/willow';

const parties: Party[] = [
  { id: 'dana', name: 'Dana Whitlock', role: 'Managing agent', aliases: ['Ms Whitlock', 'Dana', 'agent'] },
  { id: 'lena', name: 'Lena Ortiz', role: 'Landlord', aliases: ['Ms Ortiz', 'Lena', 'landlord'] },
  { id: 'mark', name: 'Mark Ellison', role: 'Tenant', aliases: ['Mr Ellison', 'Mark', 'tenant'] },
];
const sig = significance(parties);
const page = (n: number, blocks: Block[], docId = 'd'): Page => ({ docId, n, text: blocks.map(blockText).join('\n'), blocks });

const pages: Page[] = [
  page(1, [
    { k: 'head', text: 'Date: Monday 12 January 2026, 08:47' },
    { k: 'p', text: 'On 6 March Dana said the landlord would never pay for the broken boiler.' },
    { k: 'p', text: '“I didn’t agree to anything,” she wrote — twice.' },
    { k: 'p', text: 'The tenant left both keys in the box.' },
  ]),
  page(2, [{ k: 'p', text: 'The deposit was with-\ndrawn on 4 March 2026 and the tenant left the keys with the agent in the office.' }]),
  page(3, [
    { k: 'head', text: 'Statement of Mark Ellison, 12 October 2026' },
    { k: 'p', text: 'I returned the keys on Friday 27 February 2026, when I moved out.' },
    { k: 'p', text: 'The total deducted is $1,240.00, and the balance will be paid within ten working days.' },
  ]),
];

describe('checkQuote', () => {
  const q = (quote: string, n = 1) => checkQuote({ quote, page: n }, pages, sig);

  it('accepts a quote word for word, across a hyphen at a line end and typographic quotes', () => {
    expect(q('The deposit was withdrawn on 4 March 2026', 2).status).toBe('accepted');
    expect(q('"I didn\'t agree to anything," she wrote - twice').status).toBe('accepted');
  });

  it('accepts a quote with an ellipsis when the fragments stand in order on one page', () => {
    expect(q('The deposit was withdrawn ... the keys with the agent', 2).status).toBe('accepted');
    expect(q('the keys with the agent … The deposit was withdrawn', 2).reason).toBe('quote-not-found');
  });

  it('corrects a quote that stands on another page', () => {
    const r = q('I returned the keys on Friday 27 February 2026', 1);
    expect(r).toMatchObject({ status: 'corrected', reason: 'quote-wrong-page', page: 3, found: { page: 3 } });
  });

  it('a 14-word quote with "the" changed to "that" is reworded; the event takes the page text', () => {
    const r = q('On 6 March Dana said the landlord would never pay for that broken boiler');
    expect(r.status).toBe('corrected');
    expect(r.reason).toBe('quote-reworded');
    expect(r.quote).toBe('On 6 March Dana said the landlord would never pay for the broken boiler.');
    expect(r.diff!.marks).toEqual({ claim: [11], source: [11] });
  });

  it.each([
    ['a date', 'On 9 March Dana said the landlord would never pay for the broken boiler'],
    ['a name', 'On 6 March Lena said the landlord would never pay for the broken boiler'],
    ['a negation', 'On 6 March Dana said the landlord would always pay for the broken boiler'],
  ])('the same quote with %s changed is altered', (_, quote) => {
    const r = q(quote);
    expect(r).toMatchObject({ status: 'rejected', reason: 'quote-altered' });
    expect(r.diff!.source).toBe('On 6 March Dana said the landlord would never pay for the broken boiler.');
  });

  it('an 8-word quote with one word changed is not found, and shows the nearest sentence', () => {
    const r = q('The tenant left both keys in the bag');
    expect(r).toMatchObject({ status: 'rejected', reason: 'quote-not-found' });
    expect(r.diff!.source).toBe('The tenant left both keys in the box.');
  });

  it('rejects an invented quote and a quote too short to check', () => {
    expect(q('The landlord promised to pay the plumber himself on the day').reason).toBe('quote-not-found');
    expect(q('the box').reason).toBe('quote-too-short');
  });
});

describe('significant words', () => {
  it.each(['6', '$2,400', 'march', 'friday', 'twelve', 'third', 'dana', 'ellison', "didn't", 'never', 'without'])('%s is significant', (t) =>
    expect(isSignificant(t, parties)).toBe(true));
  it.each(['the', 'that', 'had', 'has', 'box'])('%s is not', (t) => expect(isSignificant(t, parties)).toBe(false));
});

describe('checkDate', () => {
  const window = caseWindow(pages);
  it('reads dates written in words', () => {
    expect(findDates('Wednesday 4 March, March 4, 2026, 3 Feb 2026, the 4th of March').map((d) => [d.day, d.month, d.year, d.weekday])).toEqual([
      [4, 2, null, 'Wednesday'],
      [4, 2, 2026, null],
      [3, 1, 2026, null],
      [4, 2, null, null],
    ]);
  });

  it('gives a year-less date the year of the nearest full date above it', () => {
    expect(quoteDates('On 6 March Dana said', pages[0])).toEqual(['2026-03-06']);
  });

  it('accepts the date of the quote or of the page heading', () => {
    expect(checkDate({ kind: 'record', date: '2026-03-06', quote: 'On 6 March Dana said the landlord would never pay' }, pages[0], window).status).toBe('accepted');
    expect(checkDate({ kind: 'record', date: '2026-01-12', quote: 'The tenant left both keys in the box' }, pages[0], window).status).toBe('accepted');
  });

  it('date-mismatch: the date is neither in the quote nor in the heading', () => {
    expect(checkDate({ kind: 'record', date: '2026-03-14', quote: 'The deposit was withdrawn on 4 March 2026' }, pages[1], window).reason).toBe('date-mismatch');
  });

  it('weekday-mismatch: the quote names another weekday', () => {
    const r = checkDate({ kind: 'account', date: '2026-02-26', quote: 'I returned the keys on Friday 27 February 2026' }, pages[2], window);
    expect(r.reason).toBe('weekday-mismatch');
    expect(r.detail).toBe('26 February 2026 was a Thursday, the quote says Friday');
  });

  it('date-out-of-range comes before matching: a wrong year on a year-less date', () => {
    expect(window).toEqual({ from: '2026-01-12', to: '2026-10-12' });
    expect(checkDate({ kind: 'record', date: '2025-03-06', quote: 'On 6 March Dana said the landlord' }, pages[0], window).reason).toBe('date-out-of-range');
  });

  it('an account without a date in its quote stands at no date', () => {
    expect(checkDate({ kind: 'account', date: '2026-10-12', quote: 'The tenant left both keys in the box' }, pages[0], window)).toEqual({ status: 'accepted', at: null });
  });

  it('dated passages: only the first sentence of a message is dated by its time', () => {
    const p = page(9, [
      { k: 'msg', who: 'Mark', at: '20 February 2026, 19:40', text: 'Thank you. I fly out next week. Back on 9 March.' },
      { k: 'p', text: 'Nothing happened. Then on 2 March the ceiling fell.' },
      { k: 'head', text: 'Date: 1 March 2026' },
    ]);
    expect(findDatedPassages(p).map((d) => [d.text, d.date])).toEqual([
      ['Mark, 20 February 2026, 19:40: Thank you.', '2026-02-20'],
      ['Back on 9 March.', '2026-03-09'],
      ['Then on 2 March the ceiling fell.', '2026-03-02'],
    ]);
  });
});

describe('checkActors, dedupe, checkFact', () => {
  it('knows parties by name, surname and role, and nobody else', () => {
    expect(checkActors(['Mr Ellison', 'the landlord', 'Dana Whitlock'], parties)).toMatchObject({ status: 'accepted', ids: ['mark', 'lena', 'dana'] });
    expect(checkActors(['Ms Whitmore'], parties)).toMatchObject({ status: 'rejected', reason: 'unknown-actor', unknown: ['Ms Whitmore'] });
  });

  it('merges a quote on the same page that shares more than 60% of its words', () => {
    const kept = [{ id: 'e1', page: 3, quote: 'I returned the keys on Friday 27 February 2026, when I moved out' }];
    expect(dedupe({ page: 3, quote: 'I returned the keys on Friday 27 February 2026' }, kept)).toBe('e1');
    expect(dedupe({ page: 2, quote: 'I returned the keys on Friday 27 February 2026' }, kept)).toBeNull();
    expect(dedupe({ page: 3, quote: 'The total deducted is $1,240.00, and the balance will be paid' }, kept)).toBeNull();
  });

  it('removes a sum the quote does not give, keeps one it gives', () => {
    const quote = 'The total deducted is $1,240.00, and the balance will be paid within ten working days';
    const ctx = { page: pages[2] };
    expect(checkFact({ field: 'deposit.amount', type: 'amount', value: '2600', basis: 'literal' }, quote, ctx).reason).toBe('fact-not-in-quote');
    expect(checkFact({ field: 'deduction', type: 'amount', value: '1240', basis: 'literal' }, quote, ctx).status).toBe('accepted');
  });

  it('allows a derived value only with a relative time expression', () => {
    expect(hasRelativeTime('The ceiling has been leaking for two weeks now')).toBe(true);
    expect(hasRelativeTime('I only flew home five days later')).toBe(true);
    expect(hasRelativeTime('The ceiling leaked')).toBe(false);
    const ctx = { page: pages[0] };
    expect(checkFact({ field: 'leak', type: 'date', value: '2025-12-29', basis: 'derived' }, 'The ceiling has been leaking for two weeks now', ctx).status).toBe('accepted');
    expect(checkFact({ field: 'leak', type: 'date', value: '2025-12-29', basis: 'derived' }, 'The ceiling leaked', ctx).reason).toBe('fact-not-in-quote');
  });

  it('checks only the dates of a yes/no or here/away fact', () => {
    const p = page(4, [{ k: 'p', text: 'I was abroad from 4 March 2026 and only flew home five days later.' }]);
    const quote = 'I was abroad from 4 March 2026 and only flew home five days later';
    const away = { field: 'inspection.tenant', type: 'presence' as const, value: 'away', subject: 'mark', from: '2026-03-04', to: '2026-03-09' };
    expect(checkFact({ ...away, basis: 'derived' }, quote, { page: p }).status).toBe('accepted');
    expect(checkFact({ ...away, basis: 'literal' }, quote, { page: p }).reason).toBe('fact-not-in-quote');
    expect(checkFact({ ...away, basis: 'literal', to: '2026-03-04' }, quote, { page: p }).status).toBe('accepted');
  });
});

describe('diff and locate', () => {
  it('numbers the words that stand in only one string', () => {
    expect(diffWords('the keys were in the bag', 'the keys were in the box')).toEqual({ claim: [5], source: [5] });
  });
  it('finds where each fragment of a quote stands in its block', () => {
    const spans = locateQuote('The deposit was withdrawn ... the agent', pages[1]);
    const line = blockText(pages[1].blocks![0]);
    expect(spans.map((s) => line.slice(s.start, s.end))).toEqual(['The deposit was with-\ndrawn', 'the agent']);
  });
});

describe('seeded fakes', () => {
  it('every one of the five is caught on the synthetic example, for its own reason', () => {
    const wp = willowPages();
    const claims = willowClaims().slice(0, 5);
    const window = caseWindow(wp, Object.fromEntries(willowDocs().map((d) => [d.meta.id, d.meta.date])));
    const fakes = seedClaims(claims, wp, willowPlan.parties, mulberry32(7), { window });
    expect(fakes.map((f) => f.kind)).toEqual(SEED_KINDS);
    expect(fakes.map((f) => f.expect)).toEqual(['quote-altered', 'quote-not-found', 'date-mismatch', 'weekday-mismatch', 'unknown-actor']);
    const s = significance(willowPlan.parties);
    for (const f of fakes) {
      const q = checkQuote(f.claim, wp, s);
      const p = wp.find((x) => x.n === q.page)!;
      const reason =
        q.status === 'rejected' ? q.reason : (checkDate(f.claim, p, window).reason ?? checkActors(f.claim.actors, willowPlan.parties).reason);
      expect(reason).toBe(f.expect);
    }
  });

  it('a changed key word is caught three times in a row on different words', () => {
    const quote = 'On 6 March Dana said the landlord would never pay for the broken boiler';
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const changed = alterKeyWord(quote, parties, mulberry32(seed))!;
      expect(checkQuote({ quote: changed, page: 1 }, pages, sig).reason).toBe('quote-altered');
      seen.add(changed);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    expect(checkQuote(shiftPage({ quote, page: 1 }, pages), pages, sig).reason).toBe('quote-wrong-page');
  });
});
