/**
 * Checks of a code project as a whole (the files of all write-code steps):
 *
 *   parse     each HTML, CSS, JS and JSON file parses (parse-error with its line)
 *   refs      every src, href, url(...), import and fetch inside the project leads to a
 *             file of the project (missing-file for pages, styles, scripts and data,
 *             missing-asset for images, fonts and media); every in-page anchor and link
 *             to another page of the project resolves (broken-link); every element the
 *             scripts look up by id exists in a page that loads them, or is made by them
 *             (element-missing)
 *   required  the parts the plan asked for are in the entry page (required-missing)
 *   house     the house rules code can read in a page and its styles (house.ts), when asked
 *   numbers   prices, times, dates, percentages and phone numbers in the visible text
 *             of the pages stand in the materials (number-not-in-source)
 *
 * External addresses are not fetched here: they get "Not checked: needs the server".
 */
import type { CheckName, LoadReport, RejectReason } from '../../types';
import { checkNumbers, missingLine, type NumberKind } from '../numbers';
import { checkCss } from './css';
import { parseHtml, querySelectorAll, type HtmlDoc } from './html';
import { checkJs } from './js';
import { houseProblems } from './house';

export type CodeFile = { path: string; text: string };
export type FileProblem = { reason: RejectReason; text: string; line?: number };
export type FileCheck = { path: string; checks: CheckName[]; problems: FileProblem[]; external: string[] };
export type ProjectCheck = { files: FileCheck[]; load: LoadReport };

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const PAGE_LIKE = /\.(html?|css|m?js|json|txt|md|xml)$/i;
export const SITE_EXTENSIONS = ['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md', '.txt', '.webmanifest'];

export const mimeOf = (path: string): string => {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return (
    {
      html: 'text/html; charset=utf-8',
      htm: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'text/javascript; charset=utf-8',
      mjs: 'text/javascript; charset=utf-8',
      json: 'application/json; charset=utf-8',
      webmanifest: 'application/manifest+json',
      svg: 'image/svg+xml',
      md: 'text/markdown; charset=utf-8',
      txt: 'text/plain; charset=utf-8',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      ico: 'image/x-icon',
    } as Record<string, string>
  )[ext] ?? 'application/octet-stream';
};

/** A project path from a reference in `from`; null for external and empty references. */
export function resolvePath(from: string, ref: string): { path: string; hash: string } | null {
  if (!ref || EXTERNAL.test(ref)) return null;
  const [beforeHash, hash = ''] = ref.split('#', 2);
  const clean = beforeHash.split('?')[0];
  if (clean === '') return { path: from, hash };
  const base = clean.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const part of clean.replace(/^\/+/, '').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') base.pop();
    else base.push(decodeURIComponent(part));
  }
  let path = base.join('/');
  if (path === '' || clean.endsWith('/')) path = (path ? path + '/' : '') + 'index.html';
  return { path, hash };
}

const isPage = (p: string) => /\.html?$/i.test(p);

export function checkProject(
  files: readonly CodeFile[],
  opts: { required?: { what: string; selector: string }[]; sources?: string[]; numberKinds?: NumberKind[]; entry?: string; house?: boolean } = {},
): ProjectCheck {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const entry = opts.entry ?? 'index.html';
  const html = new Map<string, HtmlDoc>();
  const out = new Map<string, FileCheck>(files.map((f) => [f.path, { path: f.path, checks: [], problems: [], external: [] }]));
  const add = (path: string, p: FileProblem) => out.get(path)?.problems.push(p);
  const mark = (path: string, ...names: CheckName[]) => {
    const c = out.get(path);
    if (c) for (const n of names) if (!c.checks.includes(n)) c.checks.push(n);
  };
  const errors: LoadReport['errors'] = [];

  const refTo = (from: string, value: string, line: number, isLink: boolean) => {
    mark(from, 'refs');
    if (EXTERNAL.test(value)) {
      if (/^https?:|^\/\//i.test(value)) out.get(from)!.external.push(value);
      return;
    }
    const r = resolvePath(from, value);
    if (!r) return;
    const target = byPath.get(r.path);
    if (!target) {
      const reason: RejectReason = isLink ? 'broken-link' : PAGE_LIKE.test(r.path) ? 'missing-file' : 'missing-asset';
      add(from, { reason, text: `${value} is not in the project`, line });
      return;
    }
    if (r.hash && isPage(r.path)) {
      const doc = html.get(r.path) ?? parseHtml(target.text);
      if (!doc.ids.has(r.hash) && !(r.hash === 'top' || r.hash === '')) add(from, { reason: 'broken-link', text: `#${r.hash} is not an id in ${r.path}`, line });
    }
  };

  // Pages first: their parse is needed for anchors and lookups.
  for (const f of files) if (isPage(f.path)) html.set(f.path, parseHtml(f.text));

  for (const f of files) {
    const path = f.path;
    if (isPage(path)) {
      const doc = html.get(path)!;
      mark(path, 'parse');
      for (const e of doc.errors) add(path, { reason: 'parse-error', text: e.text, line: e.line });
      for (const r of doc.refs) refTo(path, r.value, r.line, r.tag === 'a');
      for (const s of doc.styles) {
        const c = checkCss(s.text);
        for (const e of c.errors) add(path, { reason: 'parse-error', text: `In <style>: ${e.text}`, line: s.line + e.line - 1 });
        for (const u of c.urls) refTo(path, u, s.line, false);
      }
      const madeIds = new Set<string>();
      const lookups: { id: string; line: number; how: string; file: string }[] = [];
      for (const s of doc.scripts) {
        if (s.src) {
          const r = resolvePath(path, s.src);
          const target = r ? byPath.get(r.path) : undefined;
          if (target && /\.m?js$/i.test(target.path)) {
            const c = checkJs(target.text, { module: s.module });
            c.madeIds.forEach((id) => madeIds.add(id));
            for (const l of c.lookups) lookups.push({ ...l, file: target.path });
          }
          continue;
        }
        const c = checkJs(s.text, { module: s.module });
        if (c.error) add(path, { reason: 'parse-error', text: `In <script>: ${c.error.text}`, line: s.line + Math.max(0, c.error.line - 1) });
        c.madeIds.forEach((id) => madeIds.add(id));
        for (const l of c.lookups) lookups.push({ ...l, line: s.line + l.line - 1, file: path });
        for (const im of [...c.imports, ...c.fetches]) refTo(path, im.value, s.line + im.line - 1, false);
      }
      for (const l of lookups) {
        mark(l.file, 'refs');
        if (!doc.ids.has(l.id) && !madeIds.has(l.id)) {
          add(l.file, { reason: 'element-missing', text: `${l.how} finds nothing: ${path} has no element with id "${l.id}"`, line: l.line });
        }
      }
      if (opts.sources && opts.sources.length) {
        mark(path, 'numbers');
        const n = checkNumbers(doc.visibleText, opts.sources, { kinds: opts.numberKinds ?? ['money', 'time', 'date', 'percent', 'phone'] });
        for (const m of n.missing) add(path, { reason: 'number-not-in-source', text: missingLine(m, 'the materials') });
      }
    } else if (/\.css$/i.test(path)) {
      mark(path, 'parse');
      const c = checkCss(f.text);
      for (const e of c.errors) add(path, { reason: 'parse-error', text: e.text, line: e.line });
      for (const u of c.urls) refTo(path, u, 0, false);
    } else if (/\.m?js$/i.test(path)) {
      mark(path, 'parse');
      const c = checkJs(f.text);
      if (c.error) add(path, { reason: 'parse-error', text: c.error.text, line: c.error.line || undefined });
      for (const im of [...c.imports, ...c.fetches]) refTo(path, im.value, im.line, false);
    } else if (/\.(json|webmanifest)$/i.test(path)) {
      mark(path, 'parse');
      try {
        JSON.parse(f.text);
      } catch (e) {
        add(path, { reason: 'parse-error', text: `Not valid JSON: ${(e as Error).message}` });
      }
    } else if (/\.svg$/i.test(path)) {
      mark(path, 'parse');
      const doc = parseHtml(f.text);
      for (const e of doc.errors) add(path, { reason: 'parse-error', text: e.text, line: e.line });
    }
  }

  // House rules a page can be checked for (house.ts).
  if (opts.house) {
    for (const f of files) if (/\.(html?|css)$/i.test(f.path)) mark(f.path, 'house');
    for (const [path, problems] of houseProblems(files, entry)) for (const p of problems) add(path, p);
  }

  // Required parts of the entry page.
  const required: LoadReport['required'] = [];
  const entryDoc = html.get(entry);
  for (const r of opts.required ?? []) {
    const found = entryDoc ? querySelectorAll(entryDoc, r.selector).length > 0 : false;
    required.push({ ...r, found });
    if (entryDoc) mark(entry, 'required');
    if (!found && byPath.has(entry)) add(entry, { reason: 'required-missing', text: `${r.what} is missing: nothing matches ${r.selector}` });
  }
  if (!byPath.has(entry) && files.some((f) => isPage(f.path))) {
    const first = files.find((f) => isPage(f.path))!;
    add(first.path, { reason: 'missing-file', text: 'The project has no index.html to open' });
  }

  for (const c of out.values()) {
    for (const p of c.problems) {
      const kind = p.reason === 'parse-error' || p.reason === 'element-missing' || p.reason === 'missing-asset' || p.reason === 'missing-file' || p.reason === 'broken-link' || p.reason === 'required-missing' ? p.reason : null;
      if (kind) errors.push({ kind, text: p.text, file: c.path, ...(p.line ? { line: p.line } : {}) });
    }
  }
  return { files: [...out.values()], load: { ok: errors.length === 0, errors, required } };
}
