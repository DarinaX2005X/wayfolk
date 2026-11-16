/**
 * Small readers for the Harbor Street author tests. They follow the PLAN rules on page
 * text and dates closely enough to check the author's material; the engine's own
 * date.ts and checks are tested by their owners, and 01.7's build runs the real ones.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { blockText } from '../../../src/materials/text';
import type { Block, DocMeta, Page } from '../../../src/agents/types';

export const ROOT = resolve(__dirname, '../../..');
export const DIR = resolve(ROOT, 'content/examples/harbor-street');
export const load = <T>(rel: string): T => JSON.parse(readFileSync(resolve(DIR, rel), 'utf8')) as T;
export const exists = (rel: string) => existsSync(resolve(ROOT, rel));
export { blockText };

export type AuthorFact = { field: string; type: string; value: string; basis: 'literal' | 'derived'; subject?: string; from?: string; to?: string };
export type AuthorEvent = {
  tag: string; page: number; quote: string; kind: 'record' | 'account'; date: string; time: string; actors: string[];
  label: string; summary: string; topic: string; facts: AuthorFact[]; dupOf?: string; onRecheck?: boolean;
};
export type CaseJson = {
  id: string; kind: string; title: string; goal: string; label: [string, string]; materialHash: string; city: string;
  parties: { id: string; name: string; role: string; aliases: string[] }[];
  topics: string[]; fields: { id: string; topic: string; type: string; question: string }[]; docs: DocMeta[];
};

export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_RE =
  /\b(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+)?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\b(?:,?\s+(\d{4}))?/g;

export type FoundDate = { raw: string; weekday: string | null; iso: string | null; index: number };

const monthIndex = (m: string) => MONTHS.findIndex((x) => x.startsWith(m.toLowerCase().slice(0, 3)));
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export const weekdayOf = (isoDate: string) => DAYS[new Date(isoDate + 'T00:00:00Z').getUTCDay()];

/** Dates in a piece of text. A date without a year takes the last full year seen (passed in or found earlier). */
export function datesIn(text: string, year: number | null = null): { dates: FoundDate[]; year: number | null } {
  const dates: FoundDate[] = [];
  for (const m of text.matchAll(DATE_RE)) {
    if (m[4]) year = Number(m[4]);
    const y = m[4] ? Number(m[4]) : year;
    dates.push({ raw: m[0], weekday: m[1] ?? null, iso: y ? iso(y, monthIndex(m[3]), Number(m[2])) : null, index: m.index ?? 0 });
  }
  return { dates, year };
}

/** The year of the first full date in the page's head blocks, as PLAN says yearless dates start from the head. */
export function headYear(page: Page): number | null {
  for (const b of (page.blocks ?? []).filter((x) => x.k === 'head')) {
    const y = datesIn(blockText(b)).year;
    if (y) return y;
  }
  return null;
}

/** Every date on a page with its year resolved from the nearest full date above it. */
export function pageDates(page: Page): (FoundDate & { block: number })[] {
  let year = headYear(page);
  const out: (FoundDate & { block: number })[] = [];
  (page.blocks ?? []).forEach((b, i) => {
    const r = datesIn(blockText(b), year);
    year = r.year;
    out.push(...r.dates.map((d) => ({ ...d, block: i })));
  });
  return out;
}

export function headDates(page: Page): string[] {
  const y = headYear(page);
  return (page.blocks ?? []).filter((b) => b.k === 'head').flatMap((b) => datesIn(blockText(b), y).dates.map((d) => d.iso!).filter(Boolean));
}

/** Dates inside a quote, with the year taken from the page above the quote when the quote has none. */
export function quoteDates(page: Page, quote: string): string[] {
  const at = page.text.indexOf(quote);
  let year = headYear(page);
  year = datesIn(page.text.slice(0, Math.max(at, 0)), year).year;
  return datesIn(quote, year).dates.map((d) => d.iso!).filter(Boolean);
}

/** Words as the checks compare them: line-end hyphens joined, lower case, no surrounding punctuation. */
export function tokens(s: string): string[] {
  return s
    .replace(/([A-Za-z])-[ \t]*\r?\n[ \t]*([a-z])/g, '$1$2')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9$]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean);
}

export function countRuns(hay: string[], needle: string[]): number {
  let n = 0;
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    n++;
  }
  return n;
}

/** Longest common subsequence length of two token lists. */
export function lcs(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}

export const pageText = (blocks: Block[]) => blocks.map(blockText).join('\n');

/** pagesPerBatch = clamp(ceil(pages / 14), 6, 30), batches numbered from 1. */
export function batchOf(page: number, pages = 64): number {
  const per = Math.min(30, Math.max(6, Math.ceil(pages / 14)));
  return Math.floor((page - 1) / per) + 1;
}
