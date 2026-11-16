/**
 * A JavaScript syntax check without a dependency and without running the code: the
 * engine of the page (or of Node) compiles the source as a function body and never calls
 * it. Module syntax (import and export lines) is rewritten first, since a function body
 * cannot hold it; top-level await is allowed by compiling as an async function. When
 * the compiler refuses, a bracket scan finds the line to point at.
 *
 * Also returns what the code refers to: imported files, fetched files, and the ids and
 * selectors it looks up in the page, so the references check can find a missing element.
 */

export type JsCheck = {
  error: { line: number; text: string } | null;
  imports: { value: string; line: number }[];
  fetches: { value: string; line: number }[];
  /** getElementById('x') and querySelector('#x') with a literal. */
  lookups: { id: string; line: number; how: string }[];
  /** Ids the code itself gives to elements it creates. */
  madeIds: Set<string>;
};

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => unknown;

/** import/export lines become harmless statements of the same line count. */
export function stripModuleSyntax(src: string): string {
  return src
    .replace(/^\s*import\s+(?:[\w*{}\s,]+?\s+from\s+)?(['"])[^'"]+\1\s*;?/gm, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*export\s+default\s+/gm, (m) => m.replace(/export\s+default\s+/, 'void '))
    .replace(/^\s*export\s+(?=(const|let|var|function|class|async)\b)/gm, (m) => ' '.repeat(m.length))
    .replace(/^\s*export\s*\{[^}]*\}\s*(from\s*(['"])[^'"]+\2)?\s*;?/gm, (m) => m.replace(/[^\n]/g, ' '));
}

const lineOf = (src: string, at: number) => src.slice(0, at).split('\n').length;

/** The first place where brackets, strings or comments go wrong; null when they balance. */
export function bracketScan(src: string): { line: number; text: string } | null {
  const stack: { ch: string; line: number }[] = [];
  const close: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  let line = 1;
  let prevSignificant = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') {
      line++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      i--;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return { line, text: 'A comment is never closed (missing */)' };
      line += src.slice(i, end).split('\n').length - 1;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let k = i + 1;
      while (k < src.length && src[k] !== ch && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      if (src[k] !== ch) return { line, text: 'A string is never closed' };
      i = k;
      prevSignificant = 'a';
      continue;
    }
    if (ch === '`') {
      let k = i + 1;
      let depth = 0;
      while (k < src.length) {
        if (src[k] === '\\') {
          k += 2;
          continue;
        }
        if (depth === 0 && src[k] === '`') break;
        if (src[k] === '$' && src[k + 1] === '{') {
          depth++;
          k += 2;
          continue;
        }
        if (depth > 0 && src[k] === '}') depth--;
        if (src[k] === '\n') line++;
        k++;
      }
      if (k >= src.length) return { line, text: 'A template string is never closed (missing `)' };
      i = k;
      prevSignificant = 'a';
      continue;
    }
    // A regular expression literal: a '/' where a value may start.
    if (ch === '/' && /^$|[(,=:[!&|?{};+\-*%<>~^]$/.test(prevSignificant)) {
      let k = i + 1;
      let inClass = false;
      while (k < src.length && src[k] !== '\n') {
        if (src[k] === '\\') {
          k += 2;
          continue;
        }
        if (src[k] === '[') inClass = true;
        else if (src[k] === ']') inClass = false;
        else if (src[k] === '/' && !inClass) break;
        k++;
      }
      if (src[k] === '/') {
        i = k;
        prevSignificant = 'a';
        continue;
      }
    }
    if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line });
    else if (ch in close) {
      const open = stack.pop();
      if (!open) return { line, text: `"${ch}" closes nothing` };
      if (open.ch !== close[ch]) return { line, text: `"${ch}" on line ${line} does not match "${open.ch}" from line ${open.line}` };
    }
    if (!/\s/.test(ch)) prevSignificant = /[\w$]/.test(ch) ? 'a' : ch;
  }
  const open = stack.pop();
  if (open) return { line: open.line, text: `"${open.ch}" opened on line ${open.line} is never closed` };
  return null;
}

/** Compiles without running; the compiler's message, or null when the source is valid. */
export function compileProblem(src: string, module: boolean): string | null {
  const body = module ? stripModuleSyntax(src) : src;
  try {
    // Never called: only compiled.
    new AsyncFunction(body);
    return null;
  } catch (e) {
    if (e instanceof SyntaxError) return e.message;
    // A page whose policy forbids compiling code: fall back to the bracket scan alone.
    return bracketScan(body)?.text ?? null;
  }
}

export function checkJs(src: string, opts: { module?: boolean } = {}): JsCheck {
  let error: JsCheck['error'] = null;
  const problem = compileProblem(src, opts.module ?? /^\s*(import|export)\s/m.test(src));
  if (problem) {
    const scan = bracketScan(src);
    error = scan ? { line: scan.line, text: `${problem}. ${scan.text}` } : { line: 0, text: problem };
  }
  const imports: JsCheck['imports'] = [];
  for (const m of src.matchAll(/(?:^|\s)import\s+(?:[\w*{}\s,]+?\s+from\s+)?(['"])([^'"]+)\1/gm)) imports.push({ value: m[2], line: lineOf(src, m.index ?? 0) });
  for (const m of src.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)) imports.push({ value: m[2], line: lineOf(src, m.index ?? 0) });
  const fetches: JsCheck['fetches'] = [];
  for (const m of src.matchAll(/\bfetch\(\s*(['"])([^'"]+)\1/g)) fetches.push({ value: m[2], line: lineOf(src, m.index ?? 0) });
  const lookups: JsCheck['lookups'] = [];
  for (const m of src.matchAll(/getElementById\(\s*(['"])([\w-]+)\1\s*\)/g)) lookups.push({ id: m[2], line: lineOf(src, m.index ?? 0), how: m[0] });
  for (const m of src.matchAll(/querySelector(?:All)?\(\s*(['"])#([\w-]+)\1\s*\)/g)) lookups.push({ id: m[2], line: lineOf(src, m.index ?? 0), how: m[0] });
  const madeIds = new Set<string>();
  for (const m of src.matchAll(/\bid\s*=\s*\\?["']([\w-]+)\\?["']|\.id\s*=\s*(['"`])([\w-]+)\2|\bid\s*:\s*(['"])([\w-]+)\4|setAttribute\(\s*(['"])id\6\s*,\s*(['"])([\w-]+)\7/g)) {
    madeIds.add(m[1] ?? m[3] ?? m[5] ?? m[8]);
  }
  return { error, imports, fetches, lookups, madeIds };
}
