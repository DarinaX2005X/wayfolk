/**
 * Guest lists for the seating (01.4.2): the first line holds the headers, the separator
 * is a comma or a semicolon, a byte-order mark is dropped. Columns name, party, side,
 * group, relation, age, needs, diet, notes; only name is required. A list pasted on the
 * phone with one name per line reads as a CSV of one column.
 */
export const GUEST_COLUMNS = ['name', 'party', 'side', 'group', 'relation', 'age', 'needs', 'diet', 'notes'] as const;
export type GuestColumn = (typeof GUEST_COLUMNS)[number];
export type GuestRow = Record<GuestColumn, string>;

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

const ALIASES: Record<string, GuestColumn> = { guest: 'name', 'full name': 'name', family: 'party', invitation: 'party', dietary: 'diet' };

export function readGuestRows(text: string): GuestRow[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const cols = header.map((h) => ((GUEST_COLUMNS as readonly string[]).includes(h) ? (h as GuestColumn) : (ALIASES[h] ?? null)));
  const body = cols.includes('name') ? rows.slice(1) : rows;
  // Without a 'name' header the list is one name per line (a pasted list).
  const pick = cols.includes('name') ? cols : (['name'] as (GuestColumn | null)[]);
  return body
    .map((r) => {
      const g = Object.fromEntries(GUEST_COLUMNS.map((c) => [c, ''])) as GuestRow;
      pick.forEach((c, i) => {
        if (c) g[c] = r[i] ?? '';
      });
      if (!cols.includes('name')) g.name = r.join(' ').trim();
      return g;
    })
    .filter((g) => g.name !== '');
}

/** A pasted list, one name per line: the same as a CSV of one column. */
export function readPastedList(text: string): GuestRow[] {
  return readGuestRows(text.split('\n').map((l) => l.replace(/[,;]/g, ' ').trim()).join('\n'));
}
