/**
 * Page text rules shared by the example author, the engine and the check trays
 * (PLAN "Правила проверок"). No DOM, no Node APIs: the same functions run in the
 * browser, in Node scripts and in tests. Owner from package 01.4 on.
 */
import type { Block } from '../agents/types';

/**
 * One line of a page: author and time of the block first, then its text.
 *   { who: 'Mark', at: '4 March 2026, 18:12', text: 'Keys are in the box' }
 *   -> 'Mark, 4 March 2026, 18:12: Keys are in the box'
 * Page.text = blocks.map(blockText).join('\n').
 */
export function blockText(b: Block): string {
  const prefix = b.who ? b.who + (b.at ? ', ' + b.at : '') + ': ' : b.at ? b.at + ': ' : '';
  return prefix + b.text;
}

/** Typographic quotes and dashes, and the spaces that look like a space. */
const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const DASHES = /[‐‑‒–—―−]/g;
const SPACES = /[    - 　]/g;
const INVISIBLE = /[​‌‍⁠﻿­]/g;
/** A word broken over a line end with a hyphen: 'with-\ndrawn' -> 'withdrawn'. */
const LINE_HYPHEN = /([A-Za-z])-[ \t]*\r?\n[ \t]*([a-z])/g;

/**
 * The text as the checks compare it. Letter case is kept; only the form changes:
 * - a word hyphenated across a line end is joined again,
 * - typographic quotes become ' and ", dashes and the minus sign become -,
 * - no-break and thin spaces become ordinary spaces, invisible marks (soft hyphen,
 *   zero-width space, byte-order mark) are removed,
 * - every run of whitespace, line breaks included, becomes one space; the ends are trimmed.
 */
export function normalizeText(s: string): string {
  return s
    .replace(INVISIBLE, '')
    .replace(LINE_HYPHEN, '$1$2')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(SPACES, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
