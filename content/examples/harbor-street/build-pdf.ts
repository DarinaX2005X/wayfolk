/**
 * Builds public/examples/harbor-street.pdf from pages.json.
 *   npx tsx content/examples/harbor-street/build-pdf.ts
 *
 * A5 portrait, Helvetica 10 pt on 14 pt lines, 15 mm margins. Every blockText line
 * starts on a new line and wraps only at spaces, so reading the PDF back gives the
 * same words in the same order. Footer "Harbor Street, Unit 4B, p. N"; PDF page N is
 * page n of the bundle. Reading the file back and writing pdfTextHash is done by 01.7
 * with the engine's readFile.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { blockText } from '../../../src/materials/text';
import type { Page } from '../../../src/agents/types';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const out = resolve(root, 'public/examples/harbor-street.pdf');

const MM = 72 / 25.4;
const WIDTH = 148 * MM;
const HEIGHT = 210 * MM;
const MARGIN = 15 * MM;
const SIZE = 10;
const LEAD = 14;
const BLOCK_GAP = 5; // extra space between blocks, none between consecutive head lines
const FOOTER_SIZE = 8;
const TEXT_WIDTH = WIDTH - 2 * MARGIN;
const BOTTOM = MARGIN + LEAD; // keep one line clear above the footer

const ink = rgb(0.13, 0.13, 0.14);
const muted = rgb(0.42, 0.42, 0.44);

/** Splits one line of text into lines that fit, breaking only at spaces. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(next, size) <= width || !line) {
      if (!line && font.widthOfTextAtSize(word, size) > width) throw new Error(`Word wider than the page: ${word}`);
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line);
  return lines;
}

async function build(): Promise<void> {
  const pages = JSON.parse(readFileSync(resolve(here, 'pages.json'), 'utf8')) as Page[];
  const doc = await PDFDocument.create({ updateMetadata: false });
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  pages.forEach((page, i) => {
    if (page.n !== i + 1) throw new Error(`Page ${page.n} is out of order`);
    const pdfPage = doc.addPage([WIDTH, HEIGHT]);
    let y = HEIGHT - MARGIN - SIZE;
    let prevKind: string | null = null;
    for (const block of page.blocks ?? []) {
      const font = block.k === 'head' ? bold : regular;
      if (prevKind && !(prevKind === 'head' && block.k === 'head')) y -= BLOCK_GAP;
      // A block may carry its own line breaks (a word hyphenated at a line end).
      for (const part of blockText(block).split('\n')) {
        for (const line of wrap(part, font, SIZE, TEXT_WIDTH)) {
          if (y < BOTTOM) throw new Error(`Page ${page.n} does not fit on one A5 sheet`);
          pdfPage.drawText(line, { x: MARGIN, y, size: SIZE, font, color: ink });
          y -= LEAD;
        }
      }
      prevKind = block.k;
    }
    const footer = `Harbor Street, Unit 4B, p. ${page.n}`;
    const fw = regular.widthOfTextAtSize(footer, FOOTER_SIZE);
    pdfPage.drawText(footer, { x: (WIDTH - fw) / 2, y: MARGIN / 2, size: FOOTER_SIZE, font: regular, color: muted });
  });

  doc.setTitle('Harbor Street, Unit 4B');
  doc.setSubject('Sample tenancy dispute bundle: 64 pages in 12 documents. All people and places are fictional.');
  doc.setAuthor('Groundwork');
  doc.setCreator('Groundwork');
  doc.setProducer('Groundwork');
  doc.setLanguage('en-GB');
  const fixed = new Date('2026-11-09T09:00:00Z'); // fixed so the file is the same on every build
  doc.setCreationDate(fixed);
  doc.setModificationDate(fixed);

  const bytes = await doc.save({ useObjectStreams: false });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bytes);
  console.log(`Wrote ${out}: ${pages.length} pages, ${bytes.length} bytes`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
