/**
 * Reading a file into pages (01.4.2): readFile(file, name) → Doc.
 *
 *   PDF  through pdf.js (pdf.ts): pages as in the file, blocks found by code (blocks.ts)
 *   TXT  sections of about 3000 characters broken at paragraphs; the product calls them
 *        "section", not "page"
 *   CSV  a guest list (csv.ts): one row block per guest, up to 50 guests per section
 *
 * Limits: 20 MB per file, 400 pages per work; errors are MaterialError with a code and
 * a line for the person. No DOM: the same code reads in the browser and in Node.
 */
import type { Block, Doc, DocMeta, Page } from '../agents/types';
import { detectBlocks, type RawLine } from './blocks';
import { readGuestRows, GUEST_COLUMNS } from './csv';
import { LIMITS, MaterialError } from './errors';
import { blockText, hash6 } from './normalize';
import { readPdf } from './pdf';
import { findDates, isoDate } from '../agents/checks/dates';

export type FileKind = 'pdf' | 'txt' | 'csv';

export function fileKind(name: string, mime = ''): FileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'csv' || mime === 'text/csv') return 'csv';
  if (ext === 'txt' || mime.startsWith('text/plain')) return 'txt';
  return null;
}

export function baseName(name: string): string {
  return name.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
}

function docId(name: string, bytes: number): string {
  const slug = baseName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file';
  return `f-${slug}-${hash6(`${name}:${bytes}`)}`;
}

/** Bytes of a Blob, in browsers and in Node. */
async function bytesOf(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** UTF-8 text without a byte-order mark; line ends as '\n'. */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

function makePage(docIdValue: string, n: number, blocks: Block[]): Page {
  return { docId: docIdValue, n, text: blocks.map(blockText).join('\n'), blocks };
}

/** The date of a document: the first full date in the head blocks of its first page. */
function docDate(pages: readonly Page[]): string | undefined {
  const head = pages[0]?.blocks?.filter((b) => b.k === 'head').map(blockText).join('\n') ?? '';
  const d = findDates(head).find((x) => x.year !== null);
  return d ? (isoDate(d.year!, d.month, d.day) ?? undefined) : undefined;
}

export async function readFile(file: Blob, name: string): Promise<Doc> {
  if (file.size > LIMITS.fileBytes) throw new MaterialError('too-big', name);
  if (file.size === 0) throw new MaterialError('empty', name);
  const kind = fileKind(name, file.type);
  if (!kind) throw new MaterialError('unsupported', name);
  const bytes = await bytesOf(file);
  const id = docId(name, bytes.length);
  let pages: Page[];
  let scanned = false;
  let docKind: DocMeta['kind'] = 'file';
  if (kind === 'pdf') {
    const pdf = await readPdf(bytes, name);
    if (pdf.pages.length > LIMITS.pages) throw new MaterialError('too-many-pages', name);
    pages = pdf.pages.map((p) => ({ ...makePage(id, p.n, detectBlocks(p.lines)), ...(p.noText ? { noText: true } : {}) }));
    scanned = pdf.scanned;
    if (pages.every((p) => p.noText)) throw new MaterialError(pages.length ? 'scanned' : 'empty', name);
  } else if (kind === 'txt') {
    const text = decodeText(bytes);
    if (!text.trim()) throw new MaterialError('empty', name);
    pages = txtSections(text).map((lines, i) => makePage(id, i + 1, detectBlocks(lines)));
    if (pages.length > LIMITS.pages) throw new MaterialError('too-many-pages', name);
  } else {
    const rows = readGuestRows(decodeText(bytes));
    if (!rows.length) throw new MaterialError('empty', name);
    pages = [];
    for (let i = 0; i < rows.length; i += 50) {
      const blocks: Block[] = rows.slice(i, i + 50).map((r) => ({
        k: 'row',
        text: GUEST_COLUMNS.map((c) => r[c]).filter(Boolean).join('; '),
      }));
      pages.push(makePage(id, pages.length + 1, blocks));
    }
  }
  if (/essay/i.test(name)) docKind = 'essay';
  const meta: DocMeta = { id, title: baseName(name), kind: docKind, from: pages[0]?.n ?? 1, to: pages[pages.length - 1]?.n ?? 1 };
  const date = docDate(pages);
  if (date) meta.date = date;
  return { meta, pages, ...(scanned ? { scanned } : {}) };
}

/**
 * A text file in sections of about 3000 characters, broken at paragraph boundaries
 * (a paragraph longer than a section is broken at a line end). Blank lines between
 * paragraphs are kept as gaps.
 */
export function txtSections(text: string, size: number = LIMITS.sectionChars): RawLine[][] {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/^\n+|\n+$/g, '')).filter((p) => p.trim());
  const sections: RawLine[][] = [];
  let cur: RawLine[] = [];
  let chars = 0;
  const push = () => {
    if (cur.length) sections.push(cur);
    cur = [];
    chars = 0;
  };
  for (const para of paragraphs) {
    const lines = para.split('\n');
    if (chars > 0 && chars + para.length > size) push();
    lines.forEach((l, i) => {
      if (chars > 0 && chars + l.length > size && para.length > size) push();
      cur.push({ text: l, ...(i === 0 && cur.length ? { gapBefore: true } : {}) });
      chars += l.length + 1;
    });
  }
  push();
  return sections;
}
