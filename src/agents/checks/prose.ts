/**
 * House rules of wording that code can read (engine/house-rules.ts says them to the agents):
 *
 *   dashes      an em dash, or a spaced en dash or hyphen between words, used as prose
 *               punctuation (ranges between numbers like 7:00–3:00 are fine)
 *   shouting    an exclamation mark
 *   hype        magic, seamless, effortless, revolutionary and their kin
 *   formula     "it's not X, it's Y" and "not just X but Y"
 *   heading     a full stop at the end of a heading
 *
 * Each returns readable lines for the person ("A dash is used as punctuation: "…""), or [].
 */

export const HYPE = ['magic', 'magical', 'seamless', 'seamlessly', 'effortless', 'effortlessly', 'revolutionary', 'revolutionize', 'game-changing', 'game changer', 'superpower', 'supercharge', 'unlock', 'unleash', 'elevate your', 'next-level', 'world-class', 'cutting-edge'];

const snippet = (text: string, at: number) => {
  const from = Math.max(0, at - 30);
  return (from > 0 ? '…' : '') + text.slice(from, at + 30).replace(/\s+/g, ' ').trim() + (at + 30 < text.length ? '…' : '');
};

/** Dashes used as punctuation in prose. */
export function dashProblems(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[—–]|\s-{1,2}\s/g)) {
    const at = m.index ?? 0;
    const before = text.slice(0, at).trimEnd().slice(-1);
    const after = text.slice(at + m[0].length).trimStart().slice(0, 1);
    // A range between numbers (9–5, 7:00 – 3:00, 2019–2024) is notation, not punctuation.
    const numberBefore = /\d/.test(before) || /\b(am|pm|a\.m\.|p\.m\.)$/i.test(text.slice(0, at).trimEnd());
    if (numberBefore && /\d/.test(after)) continue;
    out.push(`A dash is used as punctuation: "${snippet(text, at)}". Rewrite the sentence without it`);
    if (out.length >= 3) break;
  }
  return out;
}

export function shoutProblems(text: string, where: string): string[] {
  return text.includes('!') ? [`${where} has an exclamation mark: "${text.trim().slice(0, 80)}"`] : [];
}

export function hypeProblems(text: string): string[] {
  const lower = text.toLowerCase();
  const found = HYPE.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[-\s]/g, '[-\\s]')}([^a-z]|$)`).test(lower));
  return found.length ? [`Hype words: ${found.map((w) => `"${w}"`).join(', ')}. Say what it does instead`] : [];
}

export function formulaProblems(text: string): string[] {
  const out: string[] = [];
  const res = [/\b(it|this|that)['’]?s not (just |only |about )?[^.,;:]{1,60}[,;] (it|this|that)['’]?s\b/i, /\bnot (just|only|merely) [^.;:]{1,60}[,;]? but\b/i, /\bis(n['’]t| not) (just|only|merely) [^.;:]{1,60}[,;] it['’]?s\b/i];
  for (const re of res) {
    const m = re.exec(text);
    if (m) out.push(`A "not X, but Y" formula: "${m[0].slice(0, 90)}". Say the thing directly`);
  }
  return out;
}

export function headingProblems(heading: string): string[] {
  const t = heading.trim();
  const out: string[] = [];
  if (/[^.]\.$/.test(t)) out.push(`The heading "${t.slice(0, 60)}" ends with a full stop`);
  out.push(...shoutProblems(t, 'The heading'));
  return out;
}

/** Every wording rule over a text: dashes, exclamation marks, hype, formulas. */
export function proseProblems(text: string): string[] {
  return [...dashProblems(text), ...shoutProblems(text, 'The text').slice(0, 1), ...hypeProblems(text), ...formulaProblems(text)];
}
