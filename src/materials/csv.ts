/**
 * Tables in CSV (any task): the first line holds the headers, the separator is a comma
 * or a semicolon, a byte-order mark is dropped. Each row reads as one 'row' block
 * "Header: value; Header: value", so a quote of a row names its columns.
 */

/** Rows of a CSV text: quoted fields may hold separators, quotes ("") and line breaks. */
export function parseCsv(text: string, separator?: ',' | ';'): string[][] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const sep = separator ?? guessSeparator(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      quoted = true;
      field = '';
    } else if (ch === sep) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** Semicolon when the first line has more of them than commas. */
function guessSeparator(text: string): ',' | ';' {
  const first = text.split('\n', 1)[0] ?? '';
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/** Rows of a table as "Header: value; Header: value" lines (empty cells left out). */
export function readTableRows(text: string): string[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  if (rows.length === 1) return [rows[0].join('; ')];
  const header = rows[0];
  return rows.slice(1).map((r) =>
    r
      .map((cell, i) => (cell === '' ? '' : header[i] ? `${header[i]}: ${cell}` : cell))
      .filter(Boolean)
      .join('; '),
  );
}
