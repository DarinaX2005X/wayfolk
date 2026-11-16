/**
 * A small HTML reader for the code checks: a tree of elements with line numbers, the
 * errors that break a page as a browser would build it, the visible text, and every
 * reference to another file. It also answers simple CSS selectors over that tree, so
 * "the page must have a menu with prices" can be checked by code. Pure TypeScript, no
 * DOM: the same check runs in the browser and in Node.
 *
 * Errors it reports (each with a line):
 *   an element that needs its end tag and never gets it ('<section> on line 12 is never closed')
 *   an end tag that closes something that was not open, or closes across another open element
 *   a <script>, <style>, <textarea> or <title> without its end tag
 *   an attribute quote or a comment that never closes
 *   a duplicate id
 */

export type HtmlNode = {
  tag: string;
  attrs: Record<string, string>;
  children: HtmlNode[];
  parent: HtmlNode | null;
  line: number;
  /** Raw text of script, style, textarea and title. */
  raw?: string;
  /** Text right inside this element (not of children). */
  text: string;
};

export type HtmlRef = { tag: string; attr: string; value: string; line: number };
export type HtmlError = { line: number; text: string };
export type HtmlDoc = {
  root: HtmlNode;
  errors: HtmlError[];
  ids: Map<string, number>;
  refs: HtmlRef[];
  scripts: { src: string | null; text: string; line: number; module: boolean }[];
  styles: { text: string; line: number }[];
  /** Text a visitor reads (outside script and style), blocks joined by new lines. */
  visibleText: string;
};

export const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr', 'param']);
/** Elements whose end tag may be left out (HTML's optional end tags). */
const OPTIONAL_END = new Set(['p', 'li', 'dt', 'dd', 'option', 'optgroup', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'colgroup', 'html', 'head', 'body', 'rp', 'rt', 'caption']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'th', 'br', 'dt', 'dd', 'figcaption', 'blockquote', 'form', 'label', 'button', 'option', 'address']);
const REF_ATTRS: Record<string, string[]> = {
  script: ['src'],
  link: ['href'],
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  audio: ['src'],
  a: ['href'],
  iframe: ['src'],
  embed: ['src'],
  object: ['data'],
  form: ['action'],
  use: ['href', 'xlink:href'],
  image: ['href', 'xlink:href'],
  input: ['src'],
};

const lineAt = (src: string, at: number, starts: number[]): number => {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function parseHtml(src: string): HtmlDoc {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') starts.push(i + 1);
  const line = (at: number) => lineAt(src, at, starts);
  const root: HtmlNode = { tag: '#root', attrs: {}, children: [], parent: null, line: 1, text: '' };
  const errors: HtmlError[] = [];
  const ids = new Map<string, number>();
  const refs: HtmlRef[] = [];
  const scripts: HtmlDoc['scripts'] = [];
  const styles: HtmlDoc['styles'] = [];
  const visible: string[] = [];
  const stack: HtmlNode[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;

  const addText = (t: string) => {
    if (!t) return;
    const node = top();
    const decoded = decodeEntities(t);
    node.text += decoded;
    if (!stack.some((n) => n.tag === 'head') || stack.some((n) => n.tag === 'title')) visible.push(decoded);
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      addText(src.slice(i));
      break;
    }
    addText(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) {
        errors.push({ line: line(lt), text: 'A comment is never closed (missing -->)' });
        break;
      }
      i = end + 3;
      continue;
    }
    if (src[lt + 1] === '!' || src[lt + 1] === '?') {
      const end = src.indexOf('>', lt);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const m = /^<\/\s*([a-zA-Z][\w:-]*)\s*>/.exec(src.slice(lt, lt + 80));
      if (!m) {
        addText('<');
        i = lt + 1;
        continue;
      }
      const tag = m[1].toLowerCase();
      i = lt + m[0].length;
      if (VOID.has(tag)) continue;
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at <= 0) {
        errors.push({ line: line(lt), text: `</${tag}> closes an element that is not open` });
        continue;
      }
      for (let k = stack.length - 1; k > at; k--) {
        const open = stack[k];
        if (!OPTIONAL_END.has(open.tag)) errors.push({ line: open.line, text: `<${open.tag}> on line ${open.line} is not closed before </${tag}> on line ${line(lt)}` });
      }
      stack.length = at;
      continue;
    }
    const m = /^<([a-zA-Z][\w:-]*)/.exec(src.slice(lt, lt + 64));
    if (!m) {
      addText('<');
      i = lt + 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    // Attributes up to the closing '>', honouring quotes.
    let j = lt + m[0].length;
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    let broken = false;
    for (;;) {
      while (j < src.length && /\s/.test(src[j])) j++;
      if (j >= src.length) {
        errors.push({ line: line(lt), text: `The tag <${tag}> is never finished (missing >)` });
        broken = true;
        break;
      }
      if (src[j] === '>') {
        j++;
        break;
      }
      if (src[j] === '/' && src[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      const an = /^[^\s"'>\/=]+/.exec(src.slice(j, j + 200));
      if (!an) {
        j++;
        continue;
      }
      const name = an[0].toLowerCase();
      j += an[0].length;
      while (j < src.length && /\s/.test(src[j])) j++;
      let value = '';
      if (src[j] === '=') {
        j++;
        while (j < src.length && /\s/.test(src[j])) j++;
        const q = src[j];
        if (q === '"' || q === "'") {
          const end = src.indexOf(q, j + 1);
          if (end < 0) {
            errors.push({ line: line(j), text: `The value of ${name}= in <${tag}> on line ${line(lt)} never closes its quote` });
            broken = true;
            break;
          }
          value = src.slice(j + 1, end);
          // A quote that swallowed the rest of the tag and the next tags is a missing quote.
          if (/<\/?[a-z][^>]*>/i.test(value) && value.includes('\n')) {
            errors.push({ line: line(j), text: `The value of ${name}= in <${tag}> on line ${line(lt)} runs into the next tags (a missing quote)` });
          }
          j = end + 1;
        } else {
          const uv = /^[^\s>]+/.exec(src.slice(j, j + 400));
          value = uv ? uv[0] : '';
          j += value.length;
        }
      }
      attrs[name] = decodeEntities(value);
    }
    if (broken) break;
    const node: HtmlNode = { tag, attrs, children: [], parent: null, line: line(lt), text: '' };
    // An optional-end element closes when a sibling of its kind opens (<li><li>, <p><div>).
    const parentTag = top().tag;
    if ((tag === 'li' && parentTag === 'li') || (tag === 'p' && parentTag === 'p') || ((tag === 'td' || tag === 'th') && (parentTag === 'td' || parentTag === 'th')) || (tag === 'tr' && parentTag === 'tr') || (tag === 'option' && parentTag === 'option') || ((tag === 'dt' || tag === 'dd') && (parentTag === 'dt' || parentTag === 'dd'))) {
      stack.pop();
    }
    node.parent = top();
    top().children.push(node);
    if (attrs.id !== undefined) {
      if (ids.has(attrs.id)) errors.push({ line: node.line, text: `The id "${attrs.id}" is used twice (lines ${ids.get(attrs.id)} and ${node.line})` });
      else ids.set(attrs.id, node.line);
    }
    for (const attr of REF_ATTRS[tag] ?? []) {
      const v = attrs[attr];
      if (v === undefined || v === '') continue;
      if (attr === 'srcset') {
        for (const part of v.split(',')) {
          const url = part.trim().split(/\s+/)[0];
          if (url) refs.push({ tag, attr, value: url, line: node.line });
        }
      } else refs.push({ tag, attr, value: v.trim(), line: node.line });
    }
    if (attrs.style) for (const u of cssUrls(attrs.style)) refs.push({ tag, attr: 'style', value: u, line: node.line });
    i = j;
    if (VOID.has(tag) || selfClosing) continue;
    if (RAW.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, 'i').exec(src.slice(i));
      if (!close) {
        errors.push({ line: node.line, text: `<${tag}> on line ${node.line} is never closed` });
        node.raw = src.slice(i);
        i = src.length;
      } else {
        node.raw = src.slice(i, i + close.index);
        i = i + close.index + close[0].length;
      }
      if (tag === 'script') {
        const type = (attrs.type ?? '').toLowerCase();
        const isCode = type === '' || type === 'module' || /javascript|ecmascript/.test(type);
        if (isCode) scripts.push({ src: attrs.src ?? null, text: node.raw ?? '', line: node.line, module: type === 'module' });
      } else if (tag === 'style') styles.push({ text: node.raw ?? '', line: node.line });
      else {
        node.text = decodeEntities(node.raw ?? '');
        visible.push(node.text);
      }
      continue;
    }
    if (BLOCK.has(tag)) visible.push('\n');
    stack.push(node);
  }
  for (let k = stack.length - 1; k > 0; k--) {
    const open = stack[k];
    if (!OPTIONAL_END.has(open.tag)) errors.push({ line: open.line, text: `<${open.tag}> on line ${open.line} is never closed` });
  }
  const visibleText = visible.join(' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{2,}/g, '\n').trim();
  return { root, errors, ids, refs, scripts, styles, visibleText };
}

/** url(...) values of CSS text. */
export function cssUrls(css: string): string[] {
  const out: string[] = [];
  for (const m of css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) out.push(m[2].trim());
  for (const m of css.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) out.push(m[2].trim());
  return out;
}

// ------------------------------------------------------------------ selectors

type Compound = { tag: string | null; id: string | null; classes: string[]; attrs: { name: string; op: '' | '=' | '~=' | '^=' | '$=' | '*='; value: string }[] };
type Complex = { parts: Compound[]; combinators: (' ' | '>')[] };

/** Parses a selector list; null when it uses something this reader does not know. */
export function parseSelector(sel: string): Complex[] | null {
  const out: Complex[] = [];
  for (const raw of sel.split(',')) {
    const s = raw.trim();
    if (!s) return null;
    const parts: Compound[] = [];
    const combinators: (' ' | '>')[] = [];
    let i = 0;
    let pending: ' ' | '>' | null = null;
    while (i < s.length) {
      if (/\s/.test(s[i])) {
        if (pending === null && parts.length) pending = ' ';
        i++;
        continue;
      }
      if (s[i] === '>') {
        pending = '>';
        i++;
        continue;
      }
      const c: Compound = { tag: null, id: null, classes: [], attrs: [] };
      let any = false;
      for (;;) {
        const rest = s.slice(i);
        let m: RegExpExecArray | null;
        if ((m = /^([a-zA-Z][\w-]*|\*)/.exec(rest)) && !any) {
          c.tag = m[1] === '*' ? null : m[1].toLowerCase();
        } else if ((m = /^#([\w-]+)/.exec(rest))) c.id = m[1];
        else if ((m = /^\.([\w-]+)/.exec(rest))) c.classes.push(m[1]);
        else if ((m = /^\[\s*([\w:-]+)\s*(?:([~^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/.exec(rest))) {
          c.attrs.push({ name: m[1].toLowerCase(), op: (m[2] ?? '') as Compound['attrs'][number]['op'], value: m[3] ?? m[4] ?? m[5] ?? '' });
        } else if ((m = /^:(first-child|last-child|first-of-type|last-of-type|not\([^)]*\)|nth-child\([^)]*\)|nth-of-type\([^)]*\)|hover|focus|checked|disabled|root)/.exec(rest))) {
          // Pseudo-classes do not decide presence; they are read as written-out elements.
        } else break;
        any = true;
        i += m[0].length;
      }
      if (!any) return null;
      if (parts.length) combinators.push(pending ?? ' ');
      parts.push(c);
      pending = null;
    }
    if (!parts.length) return null;
    out.push({ parts, combinators });
  }
  return out;
}

function matchCompound(n: HtmlNode, c: Compound): boolean {
  if (c.tag && n.tag !== c.tag) return false;
  if (c.id && n.attrs.id !== c.id) return false;
  if (c.classes.length) {
    const have = new Set((n.attrs.class ?? '').split(/\s+/).filter(Boolean));
    if (!c.classes.every((k) => have.has(k))) return false;
  }
  for (const a of c.attrs) {
    const v = n.attrs[a.name];
    if (v === undefined) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
  }
  return true;
}

function matchComplex(n: HtmlNode, sel: Complex, k = sel.parts.length - 1): boolean {
  if (!matchCompound(n, sel.parts[k])) return false;
  if (k === 0) return true;
  const comb = sel.combinators[k - 1];
  let p = n.parent;
  while (p && p.tag !== '#root') {
    if (matchComplex(p, sel, k - 1)) return true;
    if (comb === '>') return false;
    p = p.parent;
  }
  return false;
}

export function* walk(n: HtmlNode): Generator<HtmlNode> {
  for (const c of n.children) {
    yield c;
    yield* walk(c);
  }
}

/** Elements matching the selector, in document order. */
export function querySelectorAll(doc: HtmlDoc | HtmlNode, selector: string): HtmlNode[] {
  const parsed = parseSelector(selector);
  if (!parsed) return [];
  const root = 'root' in doc ? doc.root : doc;
  const out: HtmlNode[] = [];
  for (const n of walk(root)) if (parsed.some((s) => matchComplex(n, s))) out.push(n);
  return out;
}

/** All text inside an element, children included. */
export function textOf(n: HtmlNode): string {
  let s = n.text;
  for (const c of n.children) s += ' ' + textOf(c);
  return s.replace(/\s+/g, ' ').trim();
}
