/**
 * Which words carry meaning a quote must not lose (PLAN "Правила проверок"): a token
 * with a digit, a month or weekday name, a sum with a currency sign, a number word
 * (zero to twenty, first to tenth), any word of a party's name or aliases, and the
 * negations no, not, never, none, nor, neither, without and words ending in n't.
 * A changed significant word makes a near-verbatim quote 'quote-altered'; changes in
 * other words only make it 'quote-reworded'.
 */
import type { Party } from '../types';
import { tokens } from '../../materials/normalize';

const MONTH_WORDS = [
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
];
const WEEKDAY_WORDS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
  'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
];
const NEGATIONS = ['no', 'not', 'never', 'none', 'nor', 'neither', 'without', 'cannot'];

const FIXED = new Set([...MONTH_WORDS, ...WEEKDAY_WORDS, ...NUMBER_WORDS, ...NEGATIONS]);

/** Name words of the parties (name and aliases), as tokens; possessive forms count too. */
export function partyWords(parties: readonly Party[]): Set<string> {
  const out = new Set<string>();
  for (const p of parties) for (const s of [p.name, ...p.aliases]) for (const t of tokens(s)) out.add(t);
  return out;
}

export function isSignificant(token: string, parties: readonly Party[] | Set<string>): boolean {
  const t = token.toLowerCase();
  if (/\d/.test(t)) return true;
  if (/^[$£€]/.test(t)) return true;
  if (FIXED.has(t)) return true;
  if (/n't$/.test(t) || /n’t$/.test(t)) return true;
  const names = parties instanceof Set ? parties : partyWords(parties);
  if (names.has(t)) return true;
  // "Ellison's" carries the name "ellison".
  const base = t.replace(/'s$/, '');
  return base !== t && names.has(base);
}

/** A significance test bound to the parties of the case: what checkQuote takes. */
export function significance(parties: readonly Party[]): (token: string) => boolean {
  const names = partyWords(parties);
  return (token) => isSignificant(token, names);
}
