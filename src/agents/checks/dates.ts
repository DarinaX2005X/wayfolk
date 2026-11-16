/**
 * Reading dates, times and sums written in words (PLAN "Правила проверок", 01.4.3):
 *   dates  '4 March 2026', 'March 4, 2026', 'Wednesday 4 March', '3 Feb 2026', '3 Feb',
 *          '4th of March', '2026-03-04'
 *   times  '10:40 pm', '23:55', '7 am'
 *   sums   '$2,400', '$1,240.00', '£950'
 * A date without a year gets the year of the nearest full date above it on the same
 * page (head blocks come first), else the year of DocMeta.date; with no year anywhere
 * it is not a date for the checks. Pure functions, no DOM.
 */
import type { Page } from '../types';
import { pageLines } from '../../materials/normalize';

export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?';
const WEEKDAY = '(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '((?:19|20)\\d{2})';
/** 'Wednesday, 4 March 2026', '4th of March', '3 Feb'. */
const DAY_FIRST = new RegExp(`\\b(?:${WEEKDAY},?\\s+(?:the\\s+)?)?${DAY}\\s+(?:of\\s+)?${MONTH}(?![a-z])(?:,?\\s+${YEAR}\\b)?`, 'gi');
/** 'March 4, 2026', 'Wednesday, March 4'. */
const MONTH_FIRST = new RegExp(`\\b(?:${WEEKDAY},?\\s+)?${MONTH}\\s+${DAY}\\b(?!:)(?:,?\\s+${YEAR}\\b)?`, 'gi');
const ISO = /\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/g;
const WEEKDAY_WORD = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b(?!s)/gi;

export type DateMention = {
  raw: string;
  start: number;
  end: number;
  day: number;
  /** 0..11 */
  month: number;
  /** null when the text gives no year. */
  year: number | null;
  weekday: string | null;
};

export type ResolvedDate = DateMention & { iso: string | null; line: number };

const monthIndex = (m: string): number => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().replace('.', '').slice(0, 3)));
const cap = (s: string): string => s[0].toUpperCase() + s.slice(1).toLowerCase();

export function isoDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month || d.getUTCDate() !== day) return null;
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' to a UTC day number; NaN when it is not a real date. */
export function dayNumber(iso: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return NaN;
  const ok = isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return ok ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000 : NaN;
}

export const isIsoDate = (s: string): boolean => Number.isFinite(dayNumber(s));

export function addDays(iso: string, days: number): string {
  const d = new Date((dayNumber(iso) + days) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(iso: string): string {
  return WEEKDAYS[new Date(dayNumber(iso) * 86_400_000).getUTCDay()];
}

/** '4 March 2026' for an ISO date: the form product texts use. */
export function longDate(iso: string): string {
  const n = dayNumber(iso);
  if (!Number.isFinite(n)) return iso;
  const d = new Date(n * 86_400_000);
  return `${d.getUTCDate()} ${cap(MONTHS[d.getUTCMonth()])} ${d.getUTCFullYear()}`;
}

/** Every date written in the text, in order of appearance. */
export function findDates(text: string): DateMention[] {
  const out: DateMention[] = [];
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
  for (const m of text.matchAll(ISO)) {
    const s = m.index ?? 0;
    if (!isoDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) continue;
    out.push({ raw: m[0], start: s, end: s + m[0].length, day: Number(m[3]), month: Number(m[2]) - 1, year: Number(m[1]), weekday: null });
    taken.push([s, s + m[0].length]);
  }
  for (const m of text.matchAll(DAY_FIRST)) {
    const s = m.index ?? 0;
    const day = Number(m[2]);
    if (day < 1 || day > 31 || !free(s, s + m[0].length)) continue;
    out.push({ raw: m[0], start: s, end: s + m[0].length, day, month: monthIndex(m[3]), year: m[4] ? Number(m[4]) : null, weekday: m[1] ? cap(m[1]) : null });
    taken.push([s, s + m[0].length]);
  }
  for (const m of text.matchAll(MONTH_FIRST)) {
    const s = m.index ?? 0;
    const day = Number(m[3]);
    if (day < 1 || day > 31 || !free(s, s + m[0].length)) continue;
    out.push({ raw: m[0], start: s, end: s + m[0].length, day, month: monthIndex(m[2]), year: m[4] ? Number(m[4]) : null, weekday: m[1] ? cap(m[1]) : null });
    taken.push([s, s + m[0].length]);
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Weekday words in the text ('Friday', not 'Fridays'), capitalized. */
export function findWeekdays(text: string): string[] {
  return [...text.matchAll(WEEKDAY_WORD)].map((m) => cap(m[1]));
}

export function yearOf(iso: string | undefined | null): number | null {
  const m = iso ? /^(\d{4})-/.exec(iso) : null;
  return m ? Number(m[1]) : null;
}

/**
 * Every date of a page with its year resolved: the nearest full date above it on the
 * page (lines in order, head blocks first as they stand first), else the year of the
 * document's date. `line` is the index in pageLines(page).
 */
export function pageDates(page: Page, docDate?: string): ResolvedDate[] {
  const lines = pageLines(page);
  const fallback = yearOf(docDate);
  // Head blocks give the starting year even when a body line stands above them.
  let year: number | null = null;
  page.blocks?.forEach((b, i) => {
    if (year === null && b.k === 'head') year = findDates(lines[i]).find((d) => d.year !== null)?.year ?? null;
  });
  const out: ResolvedDate[] = [];
  lines.forEach((line, i) => {
    for (const d of findDates(line)) {
      if (d.year !== null) year = d.year;
      const y = d.year ?? year ?? fallback;
      out.push({ ...d, iso: y === null ? null : isoDate(y, d.month, d.day), line: i });
    }
  });
  return out;
}

/** ISO dates written in the head blocks of the page. */
export function headDates(page: Page, docDate?: string): string[] {
  if (!page.blocks) return [];
  return pageDates(page, docDate)
    .filter((d) => page.blocks![d.line]?.k === 'head' && d.iso)
    .map((d) => d.iso!);
}

// ------------------------------------------------------------------ times and sums

export type TimeMention = { raw: string; start: number; end: number; value: string };

/** '10:40 pm' -> '22:40', '23:55' -> '23:55', '7 am' -> '07:00'. */
export function findTimes(text: string): TimeMention[] {
  const out: TimeMention[] = [];
  const re = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?![\w:])/gi;
  for (const m of text.matchAll(re)) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const suffix = m[3]?.toLowerCase().replace(/\./g, '');
    if (!m[2] && !suffix) continue; // a bare number is not a time
    if (min > 59) continue;
    let hour = h;
    if (suffix) {
      if (h < 1 || h > 12) continue;
      hour = (h % 12) + (suffix === 'pm' ? 12 : 0);
    } else if (h > 23) continue;
    const s = m.index ?? 0;
    out.push({ raw: m[0], start: s, end: s + m[0].length, value: `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}` });
  }
  return out;
}

export type AmountMention = { raw: string; start: number; end: number; value: string };

/** '$2,400' -> '2400', '$1,240.00' -> '1240', '£950.50' -> '950.5'. */
export function findAmounts(text: string): AmountMention[] {
  const out: AmountMention[] = [];
  const re = /([$£€])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g;
  for (const m of text.matchAll(re)) {
    const s = m.index ?? 0;
    out.push({ raw: m[0], start: s, end: s + m[0].length, value: amountValue(m[2] + (m[3] ? '.' + m[3] : '')) });
  }
  return out;
}

/** '2,400.00' -> '2400', '950.50' -> '950.5': the value form of facts. */
export function amountValue(s: string): string {
  const n = Number(s.replace(/[,$£€\s]/g, ''));
  if (!Number.isFinite(n)) return s.trim();
  return String(Math.round(n * 100) / 100);
}

/** 'HH:MM' with a valid hour and minute. */
export const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const minutesOf = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
