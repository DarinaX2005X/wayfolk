/**
 * Why a file could not become pages (01.4.2). Each code has an English line the
 * product shows next to the file; the code is for the program.
 */
export type MaterialErrorCode =
  | 'too-many-pages'
  | 'too-big'
  | 'too-many-files'
  | 'scanned'
  | 'unsupported'
  | 'empty'
  | 'encrypted';

export const LIMITS = {
  /** Pages of one work. */
  pages: 400,
  /** Bytes of one file. */
  fileBytes: 20 * 1024 * 1024,
  files: 10,
  /** Characters of a TXT "section" (a page of a text file). */
  sectionChars: 3000,
} as const;

const LINES: Record<MaterialErrorCode, string> = {
  'too-many-pages': `This is more than ${LIMITS.pages} pages. Split it into smaller works.`,
  'too-big': 'This file is larger than 20 MB.',
  'too-many-files': `Up to ${LIMITS.files} files at a time.`,
  scanned: 'This PDF is a scan without text. Export it with text, or run it through text recognition first.',
  unsupported: 'This kind of file cannot be read. Use PDF, TXT, Markdown or CSV.',
  empty: 'There is no text in this file.',
  encrypted: 'This PDF is locked with a password. Save an unlocked copy and try again.',
};

export class MaterialError extends Error {
  constructor(
    public code: MaterialErrorCode,
    public file = '',
  ) {
    super(LINES[code]);
    this.name = 'MaterialError';
  }
  /** The line the product shows. */
  get line(): string {
    return LINES[this.code];
  }
}

/** Checks a set of files before reading: count and size. */
export function checkFiles(files: readonly { name: string; size: number }[]): void {
  if (files.length > LIMITS.files) throw new MaterialError('too-many-files');
  for (const f of files) {
    if (f.size > LIMITS.fileBytes) throw new MaterialError('too-big', f.name);
    if (f.size === 0) throw new MaterialError('empty', f.name);
  }
}
