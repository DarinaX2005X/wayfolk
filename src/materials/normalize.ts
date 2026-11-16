/**
 * Normalized text, word tokens and hashes of the material (PLAN "Правила проверок",
 * 01.4.2). Pure functions without DOM or Node APIs: the engine, the build scripts of
 * 01.7 and the check trays import them from this stable path.
 *
 *   normalizeText(s)  one form of the text for comparison (src/materials/text.ts)
 *   tokens(s)         lower-case words without surrounding punctuation: quotes compare by them
 *   tokenSpans(s)     the same tokens with their offsets in the original string
 *   hash6(s)          six hex characters of 32-bit FNV-1a over normalizeText(s)
 *   materialHash(p)   SHA-256 of the normalized page texts in order
 */
import type { Page } from '../agents/types';
import { blockText, normalizeText } from './text';

export { blockText, normalizeText };

export type TokenSpan = { tok: string; start: number; end: number };

const INVISIBLE = /[​‌‍⁠﻿­]/g;
const SINGLE_QUOTES = /[‘’‚‛′`´]/g;
const DOUBLE_QUOTES = /[“”„‟″«»]/g;
const DASHES = /[‐‑‒–—―−]/g;
/** Characters a token keeps at its edges: letters, digits and currency signs (a sum stays "$2,400"), and %. */
const EDGE_KEEP = /[\p{L}\p{N}$£€%]/u;

/** The token form of one run of non-space characters, or '' when nothing is left. */
export function normalizeToken(run: string): string {
  let s = run.replace(INVISIBLE, '').replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').replace(DASHES, '-').toLowerCase();
  let a = 0;
  let b = s.length;
  while (a < b && !EDGE_KEEP.test(s[a])) a++;
  while (b > a && !EDGE_KEEP.test(s[b - 1])) b--;
  s = s.slice(a, b);
  return s;
}

/**
 * Tokens with offsets in `s` itself, so a match found by tokens maps back to the
 * original characters (locateQuote). A word broken over a line end with a hyphen
 * ("with-\ndrawn") is one token spanning both parts, as normalizeText joins it.
 */
export function tokenSpans(s: string): TokenSpan[] {
  const out: TokenSpan[] = [];
  const re = /\S+/g;
  const runs: { text: string; start: number; end: number }[] = [];
  for (const m of s.matchAll(re)) runs.push({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  for (let i = 0; i < runs.length; i++) {
    let run = runs[i];
    // 'with-' + line break + 'drawn' (lower-case continuation) is one word.
    while (i + 1 < runs.length && /[A-Za-z]-$/.test(run.text) && /^[a-z]/.test(runs[i + 1].text)) {
      const between = s.slice(run.end, runs[i + 1].start);
      if (!/\n/.test(between)) break;
      const next = runs[++i];
      run = { text: run.text.slice(0, -1) + next.text, start: run.start, end: next.end };
    }
    const tok = normalizeToken(run.text);
    if (tok) out.push({ tok, start: run.start, end: run.end });
  }
  return out;
}

/** Lower-case words without surrounding punctuation, for comparing quotes. */
export function tokens(s: string): string[] {
  return tokenSpans(s).map((t) => t.tok);
}

/** 32-bit FNV-1a over the UTF-16 code units of the normalized string, first six hex characters. */
export function hash6(s: string): string {
  const text = normalizeText(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 6);
}

/** SHA-256 in hex through Web Crypto (browsers and Node 20+ both have crypto.subtle). */
export async function sha256Hex(s: string | Uint8Array): Promise<string> {
  const data = typeof s === 'string' ? new TextEncoder().encode(s) : s;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 of the normalized texts of the pages in order, one line feed between pages. */
export function materialHash(pages: readonly Pick<Page, 'text'>[]): Promise<string> {
  return sha256Hex(pages.map((p) => normalizeText(p.text)).join('\n'));
}

/** The lines of a page as the checks see them: blockText of each block, or the whole text as one block. */
export function pageLines(page: Page): string[] {
  return page.blocks?.length ? page.blocks.map(blockText) : [page.text];
}
