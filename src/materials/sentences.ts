/**
 * Deterministic sentence splitting (01.4.2): a sentence ends at '.', '?' or '!' followed
 * by a space and a capital letter (an opening quote or bracket may stand between).
 * The abbreviations Mr, Mrs, Ms, Dr, e.g. and i.e. never end a sentence.
 */
export type Sentence = { text: string; start: number; end: number };

const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'e.g', 'i.e']);

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const re = /[.?!]+["'”’)]*(?=\s+["'“‘(]?\p{Lu})/gu;
  for (const m of text.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    if (m[0][0] === '.') {
      const before = text.slice(start, m.index).split(/\s+/).pop() ?? '';
      const word = before.replace(/^["'(“‘]+/, '').toLowerCase();
      // 'Mr.' 'e.g.' and single capitals of initials ('L. Ortiz') do not end a sentence.
      if (ABBREVIATIONS.has(word) || /^\p{Lu}$/u.test(before)) continue;
    }
    push(out, text, start, end);
    start = end;
  }
  push(out, text, start, text.length);
  return out;
}

function push(out: Sentence[], text: string, from: number, to: number): void {
  let a = from;
  let b = to;
  while (a < b && /\s/.test(text[a])) a++;
  while (b > a && /\s/.test(text[b - 1])) b--;
  if (b > a) out.push({ text: text.slice(a, b), start: a, end: b });
}
