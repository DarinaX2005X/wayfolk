/**
 * Which words carry meaning a quote must not lose (PLAN "Правила проверок"): a token
 * with a digit, a month or weekday name, a sum with a currency sign, a number word
 * (zero to twenty, first to tenth), a name that occurs in the materials, and the
 * negations no, not, never, none, nor, neither, without and words ending in n't.
 * A changed significant word makes a near-verbatim quote 'quote-altered'; changes in
 * other words only make it 'quote-reworded'.
 */
import type { Page } from '../types';
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

/**
 * Names of the materials: capitalized words that occur somewhere not at the start of a
 * sentence (so "The" and "Please" stay ordinary words), as tokens.
 */
export function namesIn(pages: readonly Pick<Page, 'text'>[]): Set<string> {
  const out = new Set<string>();
  for (const p of pages) {
    for (const m of p.text.matchAll(/(?<![.!?:\n]\s*|^)\b([A-Z][a-z]+(?:'s)?)\b/gm)) {
      const t = tokens(m[1])[0];
      if (t && !FIXED.has(t)) out.add(t.replace(/'s$/, ''));
    }
  }
  return out;
}

export function isSignificant(token: string, names: ReadonlySet<string>): boolean {
  const t = token.toLowerCase();
  if (/\d/.test(t)) return true;
  if (/^[$£€]/.test(t)) return true;
  if (FIXED.has(t)) return true;
  if (/n't$/.test(t) || /n’t$/.test(t)) return true;
  if (names.has(t)) return true;
  const base = t.replace(/'s$/, '');
  return base !== t && names.has(base);
}

/** A significance test bound to the names of the materials: what checkQuote takes. */
export function significance(pages: readonly Pick<Page, 'text'>[]): (token: string) => boolean {
  const names = namesIn(pages);
  return (token) => isSignificant(token, names);
}
