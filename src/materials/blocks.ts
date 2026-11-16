/**
 * Blocks of an own file, found by code without the model (01.4.2), so an own PDF is
 * drawn in the same form as the example and the author and time of a message take part
 * in the page text and in the quote check:
 *
 *   head    'From:', 'To:', 'Cc:', 'Date:', 'Sent:', 'Subject:' lines of a letter
 *   msg     'Mark Ellison, 4 March 2026, 18:12: text' or '[18:12] Mark: text'
 *           (who and at; a bare time takes the date of the nearest date line above)
 *   row     a table: three or more columns in three lines in a row; a first cell with
 *           a date becomes `at`
 *   clause  numbered points: '1.', '1.1', '(a)'
 *   sig     'Signed', 'Signature'
 *   p       everything else, lines joined into paragraphs
 */
import type { Block } from '../agents/types';
import { findDates, findTimes } from '../agents/checks/dates';

export type RawLine = {
  text: string;
  /** Cells of the line when the reader saw column gaps (PDF coordinates, tabs, pipes). */
  cells?: string[];
  /** A visible gap above this line: a new paragraph starts. */
  gapBefore?: boolean;
};

const HEAD = /^(From|To|Cc|Bcc|Date|Sent|Subject):\s*\S/i;
const MSG_DATED = /^([\p{Lu}][\p{L}'’.-]*(?:\s+[\p{Lu}][\p{L}'’.-]*){0,3}),\s+(.+?\d{4}(?:,?\s+\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)?):\s+(.*)$/u;
const MSG_TIMED = /^\[(\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)\]\s+([^:]{1,40}):\s+(.*)$/i;
const CLAUSE = /^(\d+\.(?:\d+\.?)*|\d+\.\d+(?:\.\d+)*|\([a-z]\)|\([ivx]+\))\s+\S/;
const SIG = /^(Signed|Signature)\b/i;
/** Essays in one text: a line of three hyphens between them, a "Name: …" line at the top of each. */
const SEPARATOR = /^-{3,}$/;
const NAME = /^Name:\s*\S/i;

/** Splits a line into cells by tabs, pipes or runs of three spaces. */
export function splitCells(text: string): string[] {
  const parts = text.includes('\t') ? text.split('\t') : text.includes('|') ? text.split('|') : text.split(/\s{3,}/);
  return parts.map((c) => c.trim()).filter(Boolean);
}

const fullDate = (s: string) => findDates(s).find((d) => d.year !== null && d.start === 0 && d.end >= s.trim().length - 1);
/** A log line: '14 February 2026, 23:55: Call from the resident of 4C.' */
const LOG = /^(.{6,40}?\d{4}(?:,?\s+\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?)?):\s+(.*)$/i;

export function detectBlocks(lines: readonly RawLine[]): Block[] {
  const out: Block[] = [];
  let cur: Block | null = null;
  let lastDate: string | null = null;
  const close = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  const start = (b: Block) => {
    close();
    cur = b;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const text = line.text.trim();
    if (!text) {
      close();
      continue;
    }
    if (line.gapBefore) close();
    if (SEPARATOR.test(text)) {
      start({ k: 'p', text });
      close();
      continue;
    }
    if (NAME.test(text)) {
      start({ k: 'head', text });
      close();
      continue;
    }
    const dates = findDates(text);
    const own = dates.find((d) => d.year !== null);
    const prev: Block | null = cur ?? out[out.length - 1] ?? null;
    // Letter header: at the top of the page, after another header line, or a run of two (a second email).
    if (HEAD.test(text) && (!prev || prev.k === 'head' || HEAD.test(lines[i + 1]?.text.trim() ?? ''))) {
      start({ k: 'head', text });
      if (own) lastDate = `${own.day} ${MONTHS[own.month]} ${own.year}`;
      continue;
    }
    const dated = MSG_DATED.exec(text);
    if (dated && findDates(dated[2]).some((d) => d.year !== null)) {
      start({ k: 'msg', who: dated[1], at: dated[2], text: dated[3] });
      continue;
    }
    const timed = MSG_TIMED.exec(text);
    if (timed) {
      start({ k: 'msg', who: timed[2].trim(), at: lastDate ? `${lastDate}, ${timed[1]}` : timed[1], text: timed[3] });
      continue;
    }
    const cells = line.cells ?? splitCells(text);
    if (cells.length >= 3 && isTable(lines, i)) {
      const first = fullDate(cells[0]);
      const time = first && cells[1] && findTimes(cells[1]).length && cells[1].trim().length <= 8 ? cells[1].trim() : '';
      if (first) start({ k: 'row', at: time ? `${cells[0]}, ${time}` : cells[0], text: cells.slice(time ? 2 : 1).join('; ') });
      else start({ k: 'row', text: cells.join('; ') });
      close();
      continue;
    }
    const log = LOG.exec(text);
    if (log && fullDate(log[1].replace(/,?\s+\d{1,2}:\d{2}.*$/, ''))) {
      start({ k: 'row', at: log[1], text: log[2] });
      continue;
    }
    // A line that is only a date ("4 March 2026") dates the messages under it.
    if (own && own.start === 0 && own.end >= text.length - 1) lastDate = `${own.day} ${MONTHS[own.month]} ${own.year}`;
    if (SIG.test(text)) {
      start({ k: 'sig', text });
      continue;
    }
    if (CLAUSE.test(text)) {
      start({ k: 'clause', text });
      continue;
    }
    if (cur && !(cur.k === 'head' && !line.gapBefore && HEAD.test(text))) {
      const c: Block = cur;
      cur = { ...c, text: joinLines([c.text, text]) };
    } else start({ k: 'p', text });
  }
  close();
  return out;
}

/** Three lines in a row with three or more cells each, this one among them. */
function isTable(lines: readonly RawLine[], i: number): boolean {
  const many = (k: number) => {
    const l = lines[k];
    return Boolean(l && (l.cells ?? splitCells(l.text)).length >= 3);
  };
  for (let s = i - 2; s <= i; s++) if (many(s) && many(s + 1) && many(s + 2)) return true;
  return false;
}

/** Lines of one paragraph joined: a word broken with a hyphen at a line end is joined again. */
export function joinLines(lines: readonly string[]): string {
  let out = '';
  for (const l of lines) {
    if (!out) out = l;
    else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(l)) out = out.slice(0, -1) + l;
    else out += ' ' + l;
  }
  return out;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
