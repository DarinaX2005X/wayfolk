/**
 * checkNumbers: every number of a unit's text must stand in its source.
 *
 * Kinds read from text, each with a value form so differently written equals match:
 *   money    '$4.50', '£12', '4.50 USD'          value '4.5'
 *   time     '7:00 am', '19:30', '7am'            value '07:00'
 *   date     '14 March 2027', 'March 14', ISO     value 'MM-DD' (+ year when written)
 *   percent  '12%', '12 percent'                  value '12'
 *   phone    '(555) 014-2290', '555-014-2290'     value the digits
 *   number   anything else with a digit           value the number ('1,200' -> '1200')
 *
 * A mention matches a source mention of the same kind and value; money and plain numbers
 * also match each other ('$4.50' and '4.50'), a date without a year matches the same day
 * of any year, a time range '7am–3pm' is two times. Values code computed (a sum, a count)
 * may be passed as `extra`. Pure functions, no DOM.
 */
import { findDates, findTimes } from './dates';

export type NumberKind = 'money' | 'time' | 'date' | 'percent' | 'phone' | 'number';
export type NumberMention = { raw: string; start: number; end: number; kind: NumberKind; value: string };

const MONEY_SIGN = /([$£€])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
const MONEY_WORD = /\b(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s?(?:USD|EUR|GBP|dollars?|euros?|pounds?)\b/gi;
const PERCENT = /\b(\d+(?:\.\d+)?)\s?(?:%|percent\b|per cent\b)/gi;
const PHONE = /(?:\+?\d{1,2}[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;
const PLAIN = /\d+(?:[.,]\d+)*/g;

export const numberValue = (s: string): string => {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : s;
};

/** Every number of the text, in order, without overlaps (the first reading wins). */
export function findNumbers(text: string): NumberMention[] {
  const out: NumberMention[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  const add = (m: NumberMention) => {
    if (!free(m.start, m.end)) return;
    out.push(m);
    taken.push([m.start, m.end]);
  };
  for (const m of text.matchAll(PHONE)) {
    const s = m.index ?? 0;
    add({ raw: m[0], start: s, end: s + m[0].length, kind: 'phone', value: m[0].replace(/\D/g, '').slice(-10) });
  }
  for (const m of text.matchAll(MONEY_SIGN)) {
    const s = m.index ?? 0;
    add({ raw: m[0], start: s, end: s + m[0].length, kind: 'money', value: numberValue(m[2] + (m[3] ? '.' + m[3] : '')) });
  }
  for (const m of text.matchAll(MONEY_WORD)) {
    const s = m.index ?? 0;
    add({ raw: m[0], start: s, end: s + m[0].length, kind: 'money', value: numberValue(m[1] + (m[2] ? '.' + m[2] : '')) });
  }
  for (const d of findDates(text)) {
    const md = `${String(d.month + 1).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    add({ raw: d.raw, start: d.start, end: d.end, kind: 'date', value: d.year ? `${d.year}-${md}` : md });
  }
  for (const t of findTimes(text)) add({ raw: t.raw, start: t.start, end: t.end, kind: 'time', value: t.value });
  // '7–3' after a time: '7am–3pm' is read by findTimes; '7–3pm' leaves '7' as a time too.
  for (const m of text.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s?[–-]\s?(\d{1,2})(?::(\d{2}))?\s?(a\.?m\.?|p\.?m\.?)/gi)) {
    const s = m.index ?? 0;
    const h = Number(m[1]);
    const end = Number(m[3]);
    const pm = /p/i.test(m[5]);
    // The first hour shares the suffix unless that makes it later than the second.
    let hour = (h % 12) + (pm ? 12 : 0);
    const endHour = (end % 12) + (pm ? 12 : 0);
    if (hour > endHour) hour = h % 12;
    add({ raw: m[1] + (m[2] ? ':' + m[2] : ''), start: s, end: s + m[1].length + (m[2] ? 3 : 0), kind: 'time', value: `${String(hour).padStart(2, '0')}:${m[2] ?? '00'}` });
  }
  for (const m of text.matchAll(PERCENT)) {
    const s = m.index ?? 0;
    add({ raw: m[0], start: s, end: s + m[0].length, kind: 'percent', value: numberValue(m[1]) });
  }
  for (const m of text.matchAll(PLAIN)) {
    const s = m.index ?? 0;
    // Part of a word ('h1', 'x2', 'mp3') or of a version is not a number of the text.
    if (/[A-Za-z_]/.test(text[s - 1] ?? '') || /[A-Za-z_]/.test(text[s + m[0].length] ?? '')) {
      if (!/^\d+(st|nd|rd|th|am|pm|k|m)\b/i.test(text.slice(s, s + m[0].length + 3))) continue;
    }
    add({ raw: m[0].replace(/[.,]$/, ''), start: s, end: s + m[0].replace(/[.,]$/, '').length, kind: 'number', value: numberValue(m[0].replace(/[.,]$/, '')) });
  }
  return out.sort((a, b) => a.start - b.start);
}

export type NumbersResult = {
  ok: boolean;
  /** Mentions with no match in the source, each with the nearest source value of its kind. */
  missing: { mention: NumberMention; nearest: NumberMention | null }[];
  /** Mentions that matched. */
  matched: NumberMention[];
};

const sameDay = (a: string, b: string): boolean => {
  if (a === b) return true;
  const short = (v: string) => (v.length > 5 ? v.slice(5) : v);
  // A year on one side only: the same month and day is enough.
  return (a.length === 5 || b.length === 5) && short(a) === short(b);
};

function matches(m: NumberMention, s: NumberMention): boolean {
  if (m.kind === 'date') return s.kind === 'date' && sameDay(m.value, s.value);
  if (m.kind === 'money' || m.kind === 'number') return (s.kind === 'money' || s.kind === 'number' || s.kind === 'percent') && s.value === m.value;
  if (m.kind === 'time') return (s.kind === 'time' && s.value === m.value) || (s.kind === 'number' && Number(s.value) === Number(m.value.slice(0, 2)) % 12);
  return s.kind === m.kind && s.value === m.value;
}

export type NumbersOptions = {
  /** Kinds that must stand in the source (default: all but plain numbers under 10). */
  kinds?: NumberKind[];
  /** Plain numbers smaller than this are free (counts like "3 steps"); default 10. */
  freeBelow?: number;
  /** Values code computed, by kind-less value ('1240', '07:00'). */
  extra?: string[];
};

/** The numbers of `text` that do not stand in any of the `sources`. */
export function checkNumbers(text: string, sources: readonly string[], opts: NumbersOptions = {}): NumbersResult {
  const kinds = new Set(opts.kinds ?? (['money', 'time', 'date', 'percent', 'phone', 'number'] as NumberKind[]));
  const freeBelow = opts.freeBelow ?? 10;
  const pool = sources.flatMap((s) => findNumbers(s));
  const extra = new Set(opts.extra ?? []);
  const missing: NumbersResult['missing'] = [];
  const matched: NumberMention[] = [];
  for (const m of findNumbers(text)) {
    if (!kinds.has(m.kind)) continue;
    if (m.kind === 'number' && Math.abs(Number(m.value)) < freeBelow) continue;
    // Nothing spent, nothing counted: a zero needs no source.
    if ((m.kind === 'money' || m.kind === 'number') && Number(m.value) === 0) continue;
    // Years and plain years stand for themselves in a date range: a bare 2027 needs a 2027 somewhere.
    if (pool.some((s) => matches(m, s)) || extra.has(m.value) || (m.kind === 'number' && pool.some((s) => s.kind === 'date' && s.value.startsWith(m.value + '-')))) {
      matched.push(m);
      continue;
    }
    const same = pool.filter((s) => s.kind === m.kind || (m.kind === 'money' && s.kind === 'number'));
    const near = same.length
      ? same.reduce((best, s) => (Math.abs(Number(s.value) - Number(m.value)) < Math.abs(Number(best.value) - Number(m.value)) ? s : best))
      : null;
    missing.push({ mention: m, nearest: near });
  }
  return { ok: missing.length === 0, missing, matched };
}

/** '"$4.75" isn't in the notes. They say $4.50.' */
export function missingLine(m: NumbersResult['missing'][number], where = 'the source'): string {
  const near = m.nearest && m.nearest.kind === m.mention.kind ? ` The closest there is ${m.nearest.raw}.` : '';
  return `"${m.mention.raw}" isn't in ${where}.${near}`;
}

/**
 * Sums: the stated total against the code's sum of the parts. Values are read by
 * findNumbers (money or numbers); ok when they agree to the cent.
 */
export function checkSum(parts: readonly string[], stated: string): { ok: boolean; sum: string; stated: string } {
  const value = (s: string): number => {
    const m = findNumbers(s).find((x) => x.kind === 'money' || x.kind === 'number' || x.kind === 'percent');
    return m ? Number(m.value) : NaN;
  };
  let sum = 0;
  for (const p of parts) {
    const v = value(p);
    if (Number.isFinite(v)) sum += v;
  }
  const s = value(stated);
  const round = (n: number) => Math.round(n * 100) / 100;
  return { ok: Number.isFinite(s) && round(s) === round(sum), sum: String(round(sum)), stated };
}
