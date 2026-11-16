/**
 * Fakes the code adds to a live run to test its own checks (PLAN "Трудный механизм",
 * step seed). Five kinds, each meant to be caught by a different check:
 *
 *   word     a significant word of a real quote is changed          quote-altered
 *   splice   halves of two sentences from different pages            quote-not-found
 *   date     the date is moved by 10 days                            date-mismatch
 *   weekday  an event whose quote names a weekday is moved one day   weekday-mismatch
 *            (with no such event, a second date shift of 20 days)    date-mismatch
 *   actor    a participant who is not in the case                    unknown-actor
 *
 * Fakes are marked `seeded`, never go to the second look and never reach the result.
 * The corrupting functions are exported one by one: the "Try to fool the check" tray
 * uses them on single events too (alterKeyWord, shiftDate, swapActor, shiftPage).
 */
import type { ExtractedEvent, Page, Party, RejectReason } from '../types';
import { pageLines, tokenSpans } from '../../materials/normalize';
import { splitSentences } from '../../materials/sentences';
import { actorIndex, checkActors } from './actors';
import { addDays, checkDate, findWeekdays, isIsoDate, type CaseWindow } from './date';
import { checkQuote } from './quote';
import { isSignificant, partyWords, significance } from './significant';

export type Rng = () => number;

/** A small deterministic generator (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(list: readonly T[], rng: Rng): T => list[Math.floor(rng() * list.length) % list.length];

/** Fisher-Yates shuffle of a copy. */
export function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const NEGATION_SWAP: Record<string, string> = {
  never: 'always',
  not: 'now',
  no: 'a',
  none: 'all',
  nor: 'and',
  neither: 'either',
  without: 'with',
  cannot: 'can',
};
/** Names nobody in a case is likely to carry; the first one that matches no party is used. */
const STRANGERS = ['Ms Whitmore', 'Jordan Hale', 'Mr Brandt', 'Nora Castell', 'Mr Ivers', 'Paula Strand'];

function sameCase(from: string, to: string): string {
  if (from === from.toUpperCase() && from !== from.toLowerCase()) return to.toUpperCase();
  if (from[0] === from[0]?.toUpperCase()) return to[0].toUpperCase() + to.slice(1);
  return to;
}

/** A different word with the same role: another number, month, weekday, party name or the opposite of a negation. */
function replacement(word: string, parties: readonly Party[], rng: Rng): string | null {
  const lower = word.toLowerCase();
  if (/\d/.test(word)) {
    const m = /\d+/.exec(word)!;
    const n = Number(m[0]);
    const next = n + (n > 1 && rng() < 0.5 ? -1 : 1) * (n >= 100 ? 100 : n >= 10 ? 3 : 1);
    return word.slice(0, m.index) + String(next).padStart(m[0].length === 2 && n < 10 ? 2 : 1, '0') + word.slice(m.index + m[0].length);
  }
  const month = MONTHS.findIndex((x) => x.toLowerCase() === lower);
  if (month >= 0) return sameCase(word, MONTHS[(month + 1 + Math.floor(rng() * 10)) % 12]);
  const day = WEEKDAYS.findIndex((x) => x.toLowerCase() === lower);
  if (day >= 0) return sameCase(word, WEEKDAYS[(day + 1 + Math.floor(rng() * 5)) % 7]);
  if (NEGATION_SWAP[lower]) return sameCase(word, NEGATION_SWAP[lower]);
  if (/n't$/i.test(word)) return word.replace(/n't$/i, '').replace(/^ca$/i, 'can').replace(/^wo$/i, 'will');
  const names = parties.flatMap((p) => p.name.split(/\s+/));
  const others = names.filter((n) => n.toLowerCase() !== lower);
  if (partyWords(parties).has(lower) && others.length) return sameCase(word, pick(others, rng));
  return null;
}

/** The quote with one significant word changed, or null when it has none to change. */
export function alterKeyWord(quote: string, parties: readonly Party[], rng: Rng): string | null {
  const names = partyWords(parties);
  const spans = tokenSpans(quote).filter((t) => isSignificant(t.tok, names));
  // Prefer words in the middle: a change at the very edge may fall outside the compared window.
  const inner = spans.filter((_, i) => i > 0 && i < spans.length - 1);
  const order = shuffle(inner.length ? inner : spans, rng);
  for (const t of order) {
    const raw = quote.slice(t.start, t.end);
    const core = /[\p{L}\p{N}$£€'%,.]+/u.exec(raw);
    if (!core) continue;
    const word = core[0].replace(/[,.]+$/, '');
    const next = replacement(word, parties, rng);
    if (!next || next === word) continue;
    const at = t.start + core.index;
    return quote.slice(0, at) + next + quote.slice(at + word.length);
  }
  return null;
}

/** The event moved by `days` (its date only; the quote is untouched). */
export function shiftDate<T extends { date: string }>(event: T, days: number): T {
  return isIsoDate(event.date) ? { ...event, date: addDays(event.date, days) } : event;
}

/** The event with a participant who is not a party of the case in place of its first actor. */
export function swapActor<T extends { actors: string[] }>(event: T, parties: readonly Party[], name?: string): T {
  const index = actorIndex(parties);
  const stranger = name ?? STRANGERS.find((s) => checkActors([s], index).status === 'rejected') ?? 'Jordan Hale';
  return { ...event, actors: [stranger, ...event.actors.slice(1)] };
}

/** The event pointed at a neighbouring page (the quote stays). */
export function shiftPage<T extends { page: number }>(event: T, pages: readonly Page[], by = 1): T {
  const numbers = pages.map((p) => p.n);
  const target = numbers.includes(event.page + by) ? event.page + by : numbers.includes(event.page - by) ? event.page - by : event.page;
  return { ...event, page: target };
}

/** First half of a sentence of one page joined to the second half of a sentence of another. */
export function spliceSentences(a: string, b: string): string {
  const ta = a.split(/\s+/);
  const tb = b.split(/\s+/);
  const left = ta.slice(0, Math.max(3, Math.ceil(ta.length / 2)));
  const right = tb.slice(Math.floor(tb.length / 2));
  return [...left, ...right].join(' ').replace(/\s+([,.;:])/g, '$1');
}

export type SeedKind = 'word' | 'splice' | 'date' | 'weekday' | 'actor';
export const SEED_KINDS: SeedKind[] = ['word', 'splice', 'date', 'weekday', 'actor'];

export type SeededClaim = { kind: SeedKind; expect: RejectReason; claim: ExtractedEvent; from: ExtractedEvent };

export type SeedContext = {
  pages: readonly Page[];
  parties: readonly Party[];
  window: CaseWindow | null;
  docDates?: Record<string, string | undefined>;
};

/**
 * Makes the fakes of the given kinds (all five by default) from real claims. Each fake
 * is run through the checks it is meant for, and only a fake that is really caught for
 * the expected reason is returned, so the count of seeded fakes is honest.
 */
export function seedClaims(
  events: readonly ExtractedEvent[],
  pages: readonly Page[],
  parties: readonly Party[],
  rng: Rng,
  opts: { kinds?: SeedKind[]; window?: CaseWindow | null; docDates?: Record<string, string | undefined> } = {},
): SeededClaim[] {
  const ctx: SeedContext = { pages, parties, window: opts.window ?? null, docDates: opts.docDates };
  const sig = significance(parties);
  const byPage = new Map(pages.map((p) => [p.n, p]));
  // Sources: claims whose quote really stands on their page and whose date checks out.
  const sources = events.filter((e) => {
    const page = byPage.get(e.page);
    if (!page || checkQuote(e, pages, sig).status !== 'accepted') return false;
    return checkDate(e, page, ctx.window, ctx.docDates?.[page.docId]).status === 'accepted';
  });
  const out: SeededClaim[] = [];
  for (const kind of opts.kinds ?? SEED_KINDS) {
    const made = makeSeed(kind, sources, ctx, sig, rng);
    if (made) out.push(made);
  }
  return out;
}

function makeSeed(kind: SeedKind, sources: readonly ExtractedEvent[], ctx: SeedContext, sig: (t: string) => boolean, rng: Rng): SeededClaim | null {
  const shuffled = shuffle(sources, rng);
  const page = (n: number) => ctx.pages.find((p) => p.n === n)!;
  const dateReason = (e: ExtractedEvent) => checkDate(e, page(e.page), ctx.window, ctx.docDates?.[page(e.page).docId]).reason;
  const strip = (e: ExtractedEvent): ExtractedEvent => ({ ...e, facts: [] });
  for (const from of shuffled) {
    if (kind === 'word') {
      const quote = alterKeyWord(from.quote, ctx.parties, rng);
      if (!quote) continue;
      const claim = { ...strip(from), quote };
      const r = checkQuote(claim, ctx.pages, sig);
      if (r.status === 'rejected') return { kind, expect: r.reason!, claim, from };
    }
    if (kind === 'splice') {
      const other = shuffled.find((o) => o.page !== from.page);
      if (!other) continue;
      const a = longestSentence(page(from.page));
      const b = longestSentence(page(other.page));
      if (!a || !b) continue;
      const claim = { ...strip(from), quote: spliceSentences(a, b) };
      if (checkQuote(claim, ctx.pages, sig).reason === 'quote-not-found') return { kind, expect: 'quote-not-found', claim, from };
    }
    if (kind === 'date' && isIsoDate(from.date)) {
      const claim = shiftDate(strip(from), 10);
      if (dateReason(claim) === 'date-mismatch') return { kind, expect: 'date-mismatch', claim, from };
    }
    if (kind === 'weekday' && isIsoDate(from.date) && findWeekdays(from.quote).length) {
      const claim = shiftDate(strip(from), 1);
      if (dateReason(claim) === 'weekday-mismatch') return { kind, expect: 'weekday-mismatch', claim, from };
    }
    if (kind === 'actor' && from.actors.length) {
      const claim = swapActor(strip(from), ctx.parties);
      if (checkActors(claim.actors, ctx.parties).status === 'rejected') return { kind, expect: 'unknown-actor', claim, from };
    }
  }
  // No event names a weekday: the second date fake moves a date by 20 days instead.
  if (kind === 'weekday') {
    for (const from of shuffled) {
      if (!isIsoDate(from.date)) continue;
      const claim = shiftDate(strip(from), 20);
      if (dateReason(claim) === 'date-mismatch') return { kind, expect: 'date-mismatch', claim, from };
    }
  }
  return null;
}

function longestSentence(page: Page): string | null {
  let best: string | null = null;
  for (const line of pageLines(page)) for (const s of splitSentences(line)) if (!best || s.text.length > best.length) best = s.text;
  return best && best.split(/\s+/).length >= 6 ? best : null;
}
