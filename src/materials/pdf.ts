/**
 * PDF to pages through pdf.js (01.4.2). The library and its worker load lazily, the
 * first time a PDF is read; in Node the legacy build runs without a worker. Text is
 * taken page by page with page numbers as in the file; lines are put together from the
 * coordinates of the text pieces, a wider vertical gap starts a new block, and wide
 * horizontal gaps split a line into table cells. A page with almost no text has no text
 * layer; when more than half the pages have none, the document is a scan.
 */
import type { RawLine } from './blocks';
import { MaterialError } from './errors';

export type PdfPage = { n: number; lines: RawLine[]; noText: boolean };

type TextItem = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };
type PdfJs = {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; useSystemFonts?: boolean; verbosity?: number; disableFontFace?: boolean }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }> }> }>;
    destroy(): Promise<void>;
  };
  GlobalWorkerOptions: { workerSrc: string };
};

/** Pages with fewer visible characters than this have no text layer. */
export const NO_TEXT_CHARS = 16;

let loading: Promise<PdfJs> | null = null;

async function pdfjs(): Promise<PdfJs> {
  if (!loading) {
    loading = (async () => {
      const inBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
      // The Node build stays out of the browser bundle: its name is not visible to the bundler.
      const legacy = 'pdfjs-dist/legacy/build/pdf.mjs';
      if (!inBrowser) return (await import(/* @vite-ignore */ legacy)) as unknown as PdfJs;
      const lib = (await import('pdfjs-dist')) as unknown as PdfJs;
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    })();
    loading.catch(() => (loading = null));
  }
  return loading;
}

export async function readPdf(bytes: Uint8Array, name = ''): Promise<{ pages: PdfPage[]; scanned: boolean }> {
  const lib = await pdfjs();
  const task = lib.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, verbosity: 0, disableFontFace: true });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    await task.destroy();
    const n = (error as { name?: string })?.name ?? '';
    if (n === 'PasswordException') throw new MaterialError('encrypted', name);
    throw new MaterialError('unsupported', name);
  }
  try {
    const pages: PdfPage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = (content.items as TextItem[]).filter((it) => typeof it.str === 'string' && Array.isArray(it.transform));
      const lines = buildLines(items);
      const chars = lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0);
      pages.push({ n, lines, noText: chars < NO_TEXT_CHARS });
    }
    const without = pages.filter((p) => p.noText).length;
    return { pages, scanned: pages.length > 0 && without > pages.length / 2 };
  } finally {
    await task.destroy();
  }
}

/**
 * Text pieces to lines: pieces whose baselines are within half a font height form one
 * line, read left to right; a gap wider than a space adds a space, a gap wider than
 * three font sizes starts a new cell; a vertical gap larger than 1.3 line spacing marks
 * a new block.
 */
export function buildLines(items: readonly TextItem[]): RawLine[] {
  const pieces = items
    // Space pieces carry no position worth keeping (pdf.js may stretch one over a column gap); gaps decide spaces.
    .filter((it) => it.str.trim().length > 0)
    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, size: Math.abs(it.transform[3]) || it.height || 10 }));
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: (typeof pieces)[] = [];
  for (const p of pieces) {
    const row = rows.find((r) => Math.abs(r[0].y - p.y) <= Math.max(1, r[0].size * 0.5));
    if (row) row.push(p);
    else rows.push([p]);
  }
  rows.sort((a, b) => b[0].y - a[0].y);
  const spacings: number[] = [];
  for (let i = 1; i < rows.length; i++) spacings.push(rows[i - 1][0].y - rows[i][0].y);
  // The leading of the body text: the tightest spacing between lines (a short page has too few gaps for a median).
  const lineGaps = spacings.filter((d) => d > 2);
  const typical = lineGaps.length ? Math.min(...lineGaps) : 14;
  const out: RawLine[] = [];
  rows.forEach((row, i) => {
    row.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let text = '';
    let cell = '';
    let end = -Infinity;
    for (const p of row) {
      const gap = p.x - end;
      if (end !== -Infinity && gap > p.size * 3) {
        cells.push(cell.trim());
        cell = '';
        text += '   ';
      } else if (end !== -Infinity && gap > p.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(p.str)) {
        text += ' ';
        cell += ' ';
      }
      text += p.str;
      cell += p.str;
      end = p.x + p.w;
    }
    cells.push(cell.trim());
    const gapBefore = i > 0 && rows[i - 1][0].y - row[0].y > typical * 1.3;
    const line: RawLine = { text: text.replace(/\s+$/, ''), ...(gapBefore ? { gapBefore } : {}) };
    if (cells.filter(Boolean).length >= 3) line.cells = cells.filter(Boolean);
    if (line.text.trim()) out.push(line);
  });
  return out;
}
