/**
 * Essays out of read material (01.4.2): one file is one essay; in one TXT, essays are
 * separated by a line of three hyphens or begin at a line "Name: …". The student's name
 * comes from the "Name: …" line or from the file name. Sentences are split by
 * splitSentences (sentences.ts). The model never gets the names: essays carry the
 * aliases "Student 01…" and sentence ids like "e07.s12".
 */
import type { Doc, Essay } from '../agents/types';
import { blockText } from './normalize';
import { LIMITS, MaterialError } from './errors';
import { splitSentences } from './sentences';

export { splitSentences };

export type EssayText = { student: string; text: string; source: string };

const NAME_LINE = /^\s*Name:\s*(.+?)\s*$/i;
const SEPARATOR = /^\s*-{3,}\s*$/;
export const TOO_SHORT_WORDS = 80;

function nameFromFile(title: string): string {
  return title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** The essays of one read file. */
export function splitEssays(doc: Doc): EssayText[] {
  const lines = doc.pages.flatMap((p) => (p.blocks?.length ? p.blocks.map(blockText) : p.text.split('\n')));
  const out: EssayText[] = [];
  let cur: { student: string; lines: string[] } | null = null;
  const close = () => {
    if (cur && cur.lines.join(' ').trim()) out.push({ student: cur.student, text: cur.lines.join('\n').trim(), source: doc.meta.title });
    cur = null;
  };
  for (const raw of lines) {
    for (const line of raw.split('\n')) {
      if (SEPARATOR.test(line)) {
        close();
        continue;
      }
      const name = NAME_LINE.exec(line);
      if (name) {
        if (cur && (cur as { lines: string[] }).lines.join('').trim()) close();
        cur = { student: name[1], lines: [] };
        continue;
      }
      if (!cur) cur = { student: '', lines: [] };
      cur.lines.push(line);
    }
  }
  close();
  if (out.length === 1 && !out[0].student) out[0].student = nameFromFile(doc.meta.title);
  out.forEach((e, i) => {
    if (!e.student) e.student = out.length > 1 ? `${nameFromFile(doc.meta.title)} ${i + 1}` : nameFromFile(doc.meta.title);
  });
  return out;
}

/** Essays of the contract: ids e01…, aliases "Student 01…", sentences "e01.s01…", too short under 80 words. */
export function toEssays(texts: readonly EssayText[]): Essay[] {
  if (texts.length > LIMITS.essays) throw new MaterialError('too-many-essays');
  return texts.map((t, i) => {
    const num = String(i + 1).padStart(2, '0');
    const id = `e${num}`;
    const sentences = t.text
      .split(/\n\s*\n|\n/)
      .flatMap((para) => splitSentences(para.trim()))
      .map((s, k) => ({ id: `${id}.s${String(k + 1).padStart(2, '0')}`, text: s.text }));
    const words = t.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    return { id, student: t.student, alias: `Student ${num}`, words, tooShort: words < TOO_SHORT_WORDS, sentences };
  });
}
