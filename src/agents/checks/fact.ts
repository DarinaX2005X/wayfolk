/**
 * checkFact (PLAN "Правила проверок"): the value of a fact must come out of its own quote.
 *
 *   literal date, amount, time   code reads the value from the quote (dates with years
 *                                resolved on the page); otherwise fact-not-in-quote
 *   literal yes/no, here/away    code cannot read these words from a quote, so only the
 *                                fact's from and to dates are checked against the quote
 *   derived date, amount, time   allowed only with a relative time expression of the
 *                                vocabulary in the quote ("for two weeks now",
 *                                "last Friday", "the day before", "five days later")
 *   derived yes/no, here/away    allowed; from and to are checked as above, and a
 *                                derived one may also rest on a relative expression
 * A failing fact is removed from the event; the event itself stays.
 */
import type { CheckedItem, Fact, FactField, Page } from '../types';
import { amountValue, findAmounts, findTimes, isIsoDate, isTime } from './dates';
import { quoteDates } from './date';

const NUM = '(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|thirty|a few|a couple of|several|\\d+)';
const UNIT = '(?:day|week|fortnight|month|year|night|hour)s?';
const WEEKDAY = '(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)';

/** The vocabulary of relative time expressions that allow a derived value. */
export const RELATIVE_TIME: RegExp[] = [
  new RegExp(`\\bfor\\s+(?:the\\s+(?:last|past)\\s+)?${NUM}\\s+${UNIT}(?:\\s+now)?\\b`, 'i'),
  new RegExp(`\\b${NUM}\\s+${UNIT}\\s+(?:later|earlier|before|after|ago|on)\\b`, 'i'),
  new RegExp(`\\b(?:last|this|next|the following|the previous|that)\\s+(?:${WEEKDAY}|week|weekend|month|year)\\b`, 'i'),
  /\bthe\s+(?:day|night|week|month|morning|evening)\s+(?:before|after)\b/i,
  /\bthe\s+(?:next|following|previous)\s+(?:day|morning|evening|night|week)\b/i,
  /\b(?:yesterday|tomorrow|the other day|earlier that day|later that day|since then)\b/i,
  /\b(?:over|during)\s+the\s+holidays\b/i,
];

export function hasRelativeTime(quote: string): boolean {
  return RELATIVE_TIME.some((re) => re.test(quote));
}

export type FactResult = Pick<CheckedItem, 'status' | 'reason'> & { status: 'accepted' | 'rejected'; detail?: string };

const VALUE_FORM: Record<FactField['type'], (v: string) => boolean> = {
  date: isIsoDate,
  amount: (v) => /^\d+(\.\d{1,2})?$/.test(amountValue(v)),
  time: isTime,
  yesno: (v) => v === 'yes' || v === 'no',
  presence: (v) => v === 'here' || v === 'away',
};

export type FactContext = { page: Page; docDate?: string; fields?: readonly FactField[] };

export function checkFact(fact: Fact, quote: string, ctx: FactContext): FactResult {
  const no = (detail: string): FactResult => ({ status: 'rejected', reason: 'fact-not-in-quote', detail });
  const field = ctx.fields?.find((f) => f.id === fact.field);
  if (ctx.fields && !field) return no(`"${fact.field}" is not a field of this case`);
  const type = field?.type ?? fact.type;
  const value = String(fact.value ?? '').trim();
  if (!VALUE_FORM[type]?.(value)) return no(`"${value}" is not a ${type} value`);
  const relative = hasRelativeTime(quote);
  if (fact.basis === 'derived' && (type === 'date' || type === 'amount' || type === 'time') && !relative) {
    return no('a derived value needs a relative time expression in the quote');
  }

  const dates = () => quoteDates(quote, ctx.page, ctx.docDate);
  if (type === 'yesno' || type === 'presence') {
    for (const [name, d] of [['from', fact.from], ['to', fact.to]] as const) {
      if (!d) continue;
      if (!isIsoDate(d)) return no(`${name} "${d}" is not a date`);
      if (!dates().includes(d) && !(fact.basis === 'derived' && relative)) return no(`${name} ${d} is not in the quote`);
    }
    return { status: 'accepted' };
  }
  if (fact.basis === 'derived') return { status: 'accepted' };

  if (type === 'date' && !dates().includes(value)) return no(`${value} is not in the quote`);
  if (type === 'amount') {
    const want = amountValue(value);
    const plain = [...quote.matchAll(/\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b/g)].map((m) => amountValue(m[0]));
    if (![...findAmounts(quote).map((a) => a.value), ...plain].includes(want)) return no(`${value} is not in the quote`);
  }
  if (type === 'time' && !findTimes(quote).some((t) => t.value === value)) return no(`${value} is not in the quote`);
  return { status: 'accepted' };
}
