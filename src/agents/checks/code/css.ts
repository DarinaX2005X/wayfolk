/**
 * A CSS syntax check without a dependency: comments, strings, blocks and declarations
 * are read the way a browser tokenizes them, and what a browser would throw away is
 * reported with its line:
 *   a block or a comment that never closes, a '}' with nothing open,
 *   a declaration without a colon ('color red;'), a string that runs to the end of its line.
 * Also returns the url(...) and @import references and the selectors of rules.
 */
import { cssUrls } from './html';

export type CssError = { line: number; text: string };
export type CssCheck = { errors: CssError[]; urls: string[]; selectors: string[] };

export function checkCss(src: string): CssCheck {
  const errors: CssError[] = [];
  const selectors: string[] = [];
  let line = 1;
  /** One frame per open block: does it hold declarations (a rule) or rules (@media)? */
  const stack: { kind: 'rule' | 'group'; line: number }[] = [];
  let buf = '';
  let bufLine = 1;
  const flushDecl = () => {
    const d = buf.trim();
    buf = '';
    if (!d) return;
    const top = stack[stack.length - 1];
    if (!top || top.kind !== 'rule') {
      if (d.startsWith('@')) return; // @import, @charset
      errors.push({ line: bufLine, text: `"${d.slice(0, 40)}" stands outside any rule` });
      return;
    }
    if (!/^(--[\w-]+|[a-zA-Z-]+)\s*:/.test(d) && !d.startsWith('@')) {
      errors.push({ line: bufLine, text: `"${d.slice(0, 40)}" is not a declaration (missing a colon)` });
    }
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\n') line++;
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) {
        errors.push({ line, text: 'A comment is never closed (missing */)' });
        break;
      }
      for (let k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let k = i + 1;
      while (k < src.length && src[k] !== ch && src[k] !== '\n') k += src[k] === '\\' ? 2 : 1;
      if (src[k] !== ch) {
        errors.push({ line, text: 'A string runs to the end of its line without its closing quote' });
        buf += src.slice(i, k);
        i = k - 1;
        continue;
      }
      if (!buf.trim()) bufLine = line;
      buf += src.slice(i, k + 1);
      i = k;
      continue;
    }
    if (ch === '{') {
      const head = buf.trim();
      buf = '';
      // @media and friends hold rules; a rule holds declarations (and nested rules, as modern CSS allows).
      const group = /^@(media|supports|layer|container|document|scope|keyframes|-webkit-keyframes)\b/i.test(head);
      if (!head) errors.push({ line, text: 'A block opens without a selector' });
      else if (!head.startsWith('@')) selectors.push(head.replace(/\s+/g, ' '));
      stack.push({ kind: group ? 'group' : 'rule', line });
      continue;
    }
    if (ch === ';') {
      flushDecl();
      continue;
    }
    if (ch === '}') {
      if (stack.length === 0) {
        errors.push({ line, text: '"}" closes a block that was never opened' });
        buf = '';
        continue;
      }
      flushDecl();
      stack.pop();
      continue;
    }
    if (!buf.trim() && !/\s/.test(ch)) bufLine = line;
    buf += ch;
  }
  if (buf.trim() && stack.length === 0 && !buf.trim().startsWith('@')) errors.push({ line: bufLine, text: `"${buf.trim().slice(0, 40)}" stands outside any rule` });
  for (const open of stack) errors.push({ line: open.line, text: `The block opened on line ${open.line} is never closed (missing })` });
  return { errors, urls: cssUrls(src), selectors };
}
