import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { batchPages } from '../../src/materials/batches';
import { detectBlocks } from '../../src/materials/blocks';
import { parseCsv, readGuestRows, readPastedList } from '../../src/materials/csv';
import { MaterialError } from '../../src/materials/errors';
import { splitEssays, splitSentences, toEssays } from '../../src/materials/essays';
import { matchExample } from '../../src/materials/example';
import { hash6, materialHash, tokens } from '../../src/materials/normalize';
import { readFile, txtSections } from '../../src/materials/read';
import type { ExampleMeta } from '../../src/agents/types';

/** A line printed on a PDF page: plain text, a table row of cells, or a gap before it. */
type Line = string | { cells: string[] } | { gap: string };

async function makePdf(pages: Line[][], footer?: (n: number) => string): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines, i) => {
    const page = doc.addPage([420, 595]);
    let y = 550;
    for (const line of lines) {
      if (typeof line === 'object' && 'gap' in line) {
        y -= 6;
        page.drawText(line.gap, { x: 40, y, size: 10, font });
      } else if (typeof line === 'object') {
        line.cells.forEach((c, k) => page.drawText(c, { x: 40 + k * 120, y, size: 10, font }));
      } else page.drawText(line, { x: 40, y, size: 10, font });
      y -= 14;
    }
    if (footer) page.drawText(footer(i + 1), { x: 40, y: 30, size: 8, font });
  });
  return new Blob([new Uint8Array(await doc.save())], { type: 'application/pdf' });
}

const letter: Line[][] = [
  ['From: Mark Ellison', 'To: Dana Whitlock', 'Date: Monday 12 January 2026, 08:47', 'Subject: Leak', { gap: 'The bathroom ceiling has been leaking for two weeks' }, 'now. It drips into the bath most nights.', { gap: 'Please send someone this week.' }],
  ['Lena Ortiz, 22 January 2026, 19:06: ok go ahead with the plumber,', "I'll cover it.", { gap: 'Mark Ellison, 22 January 2026, 19:10: Thank you.' }],
  [{ cells: ['3 February 2026', '08:10', 'Leak reported', 'Tom'] }, { cells: ['4 February 2026', '09:30', 'Bucket emptied', 'Tom'] }, { cells: ['5 February 2026', '10:00', 'Agency called', 'Dana'] }],
];

describe('readFile: PDF', () => {
  it('reads three pages with page numbers, letter heads, messages and table rows', async () => {
    const doc = await readFile(await makePdf(letter), 'case.pdf');
    expect(doc.pages.map((p) => p.n)).toEqual([1, 2, 3]);
    expect(doc.meta).toMatchObject({ title: 'case', kind: 'file', from: 1, to: 3, date: '2026-01-12' });
    const [p1, p2, p3] = doc.pages;
    expect(p1.blocks!.map((b) => b.k)).toEqual(['head', 'head', 'head', 'head', 'p', 'p']);
    expect(p1.blocks![4].text).toBe('The bathroom ceiling has been leaking for two weeks now. It drips into the bath most nights.');
    expect(p2.blocks).toEqual([
      { k: 'msg', who: 'Lena Ortiz', at: '22 January 2026, 19:06', text: "ok go ahead with the plumber, I'll cover it." },
      { k: 'msg', who: 'Mark Ellison', at: '22 January 2026, 19:10', text: 'Thank you.' },
    ]);
    expect(p2.text).toContain("Lena Ortiz, 22 January 2026, 19:06: ok go ahead with the plumber, I'll cover it.");
    expect(p3.blocks![0]).toEqual({ k: 'row', at: '3 February 2026, 08:10', text: 'Leak reported; Tom' });
    expect(doc.scanned).toBeUndefined();
  });

  it('marks pages without a text layer, and a document of mostly such pages as a scan', async () => {
    const doc = await readFile(await makePdf([['Page one has a sentence of real text on it.'], [], []]), 'scan.pdf');
    expect(doc.scanned).toBe(true);
    expect(doc.pages.map((p) => Boolean(p.noText))).toEqual([false, true, true]);
    await expect(readFile(await makePdf([[], []]), 'blank.pdf')).rejects.toMatchObject({ code: 'scanned' });
  });

  it('refuses an empty file, an unknown kind and a broken PDF with a reason', async () => {
    await expect(readFile(new Blob([]), 'empty.txt')).rejects.toBeInstanceOf(MaterialError);
    await expect(readFile(new Blob([]), 'empty.txt')).rejects.toMatchObject({ code: 'empty' });
    await expect(readFile(new Blob(['x']), 'photo.jpg')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(readFile(new Blob(['%PDF-1.7 nonsense']), 'broken.pdf')).rejects.toMatchObject({ code: 'unsupported' });
    await expect(readFile(new Blob(['   \n  ']), 'blank.txt')).rejects.toMatchObject({ code: 'empty', line: 'There is no text in this file.' });
  });
});

describe('readFile: TXT and CSV', () => {
  it('cuts a text into sections of about 3000 characters at paragraph ends', async () => {
    const para = (i: number) => `Paragraph ${i}. ` + 'The tenant wrote to the agent about the leak again. '.repeat(10);
    const text = Array.from({ length: 12 }, (_, i) => para(i + 1)).join('\n\n');
    const doc = await readFile(new Blob([text], { type: 'text/plain' }), 'notes.txt');
    expect(doc.pages.length).toBe(Math.ceil(text.length / 3000) + (text.length % 3000 > 2400 ? 1 : 0) || doc.pages.length);
    for (const p of doc.pages) {
      expect(p.text.length).toBeLessThanOrEqual(3000);
      expect(p.blocks![0].text).toMatch(/^Paragraph \d+\./);
    }
    expect(doc.pages.flatMap((p) => p.blocks!).map((b) => b.text)).toHaveLength(12);
    expect(txtSections('a\n\nb')).toEqual([[{ text: 'a' }, { text: 'b', gapBefore: true }]]);
  });

  it('reads a guest list with semicolons and a byte-order mark', async () => {
    const csv = '﻿name;party;side;group;age\nRosa Delgado;Delgado;bride;family;adult\n"Novak, Peter";Novak;groom;"friends; school";senior\n';
    expect(readGuestRows(csv)).toEqual([
      { name: 'Rosa Delgado', party: 'Delgado', side: 'bride', group: 'family', relation: '', age: 'adult', needs: '', diet: '', notes: '' },
      { name: 'Novak, Peter', party: 'Novak', side: 'groom', group: 'friends; school', relation: '', age: 'senior', needs: '', diet: '', notes: '' },
    ]);
    const doc = await readFile(new Blob([csv], { type: 'text/csv' }), 'guests.csv');
    expect(doc.pages[0].blocks).toHaveLength(2);
    expect(doc.pages[0].text).toBe('Rosa Delgado; Delgado; bride; family; adult\nNovak, Peter; Novak; groom; friends; school; senior');
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(readPastedList('Rosa Delgado\nPeter Novak\n\n').map((g) => g.name)).toEqual(['Rosa Delgado', 'Peter Novak']);
  });

  it('splits one TXT into essays at separators and Name lines', async () => {
    const text = [
      'Name: Alice Brown', 'The war changed the town. People left.', '---',
      'Name: Ben Carter', 'Dr. Lee says e.g. the mills closed. Then the river rose!', '',
      'Name: Chloe Diaz', 'Short one.',
    ].join('\n');
    const doc = await readFile(new Blob([text]), 'class.txt');
    const essays = splitEssays(doc);
    expect(essays.map((e) => e.student)).toEqual(['Alice Brown', 'Ben Carter', 'Chloe Diaz']);
    const shaped = toEssays(essays);
    expect(shaped[1]).toMatchObject({ id: 'e02', alias: 'Student 02', tooShort: true });
    expect(shaped[1].sentences.map((s) => s.id + ' ' + s.text)).toEqual(['e02.s01 Dr. Lee says e.g. the mills closed.', 'e02.s02 Then the river rose!']);
    const single = splitEssays(await readFile(new Blob(['My essay about rivers.']), 'Dana_Whitlock.txt'));
    expect(single).toEqual([{ student: 'Dana Whitlock', text: 'My essay about rivers.', source: 'Dana_Whitlock' }]);
  });
});

describe('text rules', () => {
  it('splits sentences deterministically and keeps abbreviations', () => {
    expect(splitSentences('Mr. Ellison left. Mrs. Ortiz stayed? Yes! i.e. Nobody else').map((s) => s.text)).toEqual([
      'Mr. Ellison left.',
      'Mrs. Ortiz stayed?',
      'Yes! i.e. Nobody else',
    ]);
  });
  it('tokens, hash6 and the material hash', async () => {
    expect(tokens('“I didn’t,” said Ms. Ortiz — $2,400!')).toEqual(["i", "didn't", 'said', 'ms', 'ortiz', '$2,400']);
    expect(hash6('The keys  were returned')).toBe(hash6('The keys were returned'));
    expect(hash6('a')).toMatch(/^[0-9a-f]{6}$/);
    expect(await materialHash([{ text: 'a  b' }])).toBe(await materialHash([{ text: 'a b' }]));
  });
  it('finds blocks in plain lines', () => {
    expect(detectBlocks([{ text: '1. Term. The term begins' }, { text: 'on 1 September 2025.' }, { text: '(a) Rent is due monthly.' }]).map((b) => [b.k, b.text])).toEqual([
      ['clause', '1. Term. The term begins on 1 September 2025.'],
      ['clause', '(a) Rent is due monthly.'],
    ]);
    expect(detectBlocks([{ text: '4 March 2026' }, { text: '[18:12] Mark: keys are in the box' }])[1]).toEqual({ k: 'msg', who: 'Mark', at: '4 March 2026, 18:12', text: 'keys are in the box' });
  });
});

describe('batches', () => {
  it('64 pages give 11 batches of 6, the last 61–64; 400 pages give 14 of 29', () => {
    const b64 = batchPages(Array.from({ length: 64 }, (_, i) => i + 1));
    expect(b64).toHaveLength(11);
    expect(b64[10]).toMatchObject({ index: 11, pages: [61, 64] });
    const b400 = batchPages(Array.from({ length: 400 }, (_, i) => i + 1));
    expect(b400).toHaveLength(14);
    expect(b400[0].numbers).toHaveLength(29);
    expect(batchPages([65, 66], 12)).toEqual([{ index: 12, pages: [65, 66], numbers: [65, 66] }]);
  });
});

describe('matchExample', () => {
  it('knows the example PDF by the text read from it, and not after one word changes', async () => {
    const footer = (n: number) => `Willow Lane, Flat 2, p. ${n}`;
    const original = await readFile(await makePdf(letter, footer), 'willow.pdf');
    const meta: ExampleMeta = {
      id: 'harbor-street', kind: 'case', title: 'Example', goal: 'g', label: ['a', 'b'], materialHash: '', pdfTextHash: await materialHash(original.pages),
    };
    const again = await readFile(await makePdf(letter, footer), 'downloaded.pdf');
    expect(await matchExample(again.pages, [meta])).toBe(meta);
    const changed = letter.map((p) => p.map((l) => (l === 'now. It drips into the bath most nights.' ? 'now. It drips into the sink most nights.' : l)));
    const edited = await readFile(await makePdf(changed, footer), 'edited.pdf');
    expect(await matchExample(edited.pages, [meta])).toBeNull();
  });
});
