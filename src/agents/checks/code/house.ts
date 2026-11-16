/**
 * House rules of a page that code can read (engine/house-rules.ts says them to the Builder).
 * A problem goes back to the file that can fix it, with the reason 'house-rule':
 *
 *   page    an eyebrow (a short label in capitals right above an h1 or h2), a dash used as
 *           prose punctuation, an exclamation mark in a heading or a button, hype words,
 *           a missing viewport meta tag
 *   styles  a banned or serif display face (Playfair Display, Instrument Serif, Space
 *           Grotesk, a serif family), gradient text, links or buttons without :hover or
 *           :focus states, no media query for narrow screens
 *
 * Styles count wherever they are: the CSS files and the <style> blocks of the pages.
 */
import type { FileProblem, CodeFile } from './project';
import { parseHtml, querySelectorAll, textOf, walk, type HtmlDoc, type HtmlNode } from './html';
import { dashProblems, hypeProblems } from '../prose';

const BANNED_FONTS = /playfair|instrument serif|space grotesk/i;
const SERIF_NAMES = /\b(georgia|times|garamond|baskerville|cormorant|merriweather|fraunces|lora|dm serif|libre caslon|palatino|book antiqua|cambria|iowan|charter|didot|bodoni|ui-serif)\b/i;
const HIDDEN = new Set(['script', 'style', 'template', 'noscript', 'svg']);

type Rule = { selector: string; body: string };

/** Plain rules of a stylesheet, those inside @media included. Comments removed. */
export function cssRules(css: string): Rule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (selector.startsWith('@') && !selector.startsWith('@media')) continue;
    out.push({ selector: selector.replace(/^@media[^{]*$/, '').trim(), body: m[2] });
  }
  return out;
}

const classesOf = (n: HtmlNode) => (n.attrs.class ?? '').split(/\s+/).filter(Boolean);

function isEyebrow(n: HtmlNode, rules: Rule[]): boolean {
  if (!['p', 'span', 'div', 'small', 'strong', 'b', 'em'].includes(n.tag)) return false;
  if (n.children.some((c) => !['span', 'strong', 'b', 'em', 'small'].includes(c.tag))) return false;
  const text = textOf(n);
  if (!text || text.length > 48 || text.split(/\s+/).length > 6 || !/[A-Za-z]/.test(text)) return false;
  if (text === text.toUpperCase()) return true;
  // Set in capitals by the styles: a rule for one of its classes says text-transform: uppercase.
  const cls = classesOf(n);
  return rules.some((r) => /text-transform\s*:\s*uppercase/i.test(r.body) && cls.some((c) => new RegExp(`\\.${c.replace(/[^\w-]/g, '')}(?![\\w-])`).test(r.selector)));
}

function previousElement(n: HtmlNode): HtmlNode | null {
  const siblings = n.parent?.children ?? [];
  const at = siblings.indexOf(n);
  return at > 0 ? siblings[at - 1] : null;
}

/** Text of the visible elements, one entry per element with its own text. */
function visibleTexts(doc: HtmlDoc): { node: HtmlNode; text: string }[] {
  const out: { node: HtmlNode; text: string }[] = [];
  const visit = (n: HtmlNode) => {
    for (const c of n.children) {
      if (HIDDEN.has(c.tag)) continue;
      if (c.text.trim()) out.push({ node: c, text: c.text.replace(/\s+/g, ' ').trim() });
      visit(c);
    }
  };
  visit(doc.root);
  return out;
}

/** Whether some rule with `pseudo` reaches an element of `tag` (by tag or by one of its classes). */
function covers(rules: Rule[], pseudo: RegExp, tag: 'a' | 'button', doc: HtmlDoc, scripts: string): boolean {
  const els = [...walk(doc.root)].filter((n) => n.tag === tag || (tag === 'button' && n.tag === 'input' && /^(submit|button)$/i.test(n.attrs.type ?? '')));
  for (const r of rules) {
    for (const sel of r.selector.split(',')) {
      if (!pseudo.test(sel)) continue;
      const base = sel.split(pseudo)[0].trim().split(/\s+|>|\+|~/).pop() ?? '';
      if (!base || base === '*' || new RegExp(`^${tag}\\b`).test(base)) return true;
      const cls = [...base.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (cls.some((c) => els.some((e) => classesOf(e).includes(c)))) return true;
      // Elements a script makes: its class appears in the script next to the tag it creates.
      if (cls.some((c) => scripts.includes(c)) && new RegExp(`createElement\\(\\s*['"]${tag}['"]|<${tag}[\\s>]`).test(scripts)) return true;
    }
  }
  return false;
}

export function houseProblems(files: readonly CodeFile[], entry = 'index.html'): Map<string, FileProblem[]> {
  const out = new Map<string, FileProblem[]>();
  const add = (path: string, text: string, line?: number) => {
    const list = out.get(path) ?? [];
    if (list.length < 8) list.push({ reason: 'house-rule', text, ...(line ? { line } : {}) });
    out.set(path, list);
  };
  const pages = files.filter((f) => /\.html?$/i.test(f.path));
  const cssFiles = files.filter((f) => /\.css$/i.test(f.path) && f.text.trim());
  const scripts = files.filter((f) => /\.m?js$/i.test(f.path)).map((f) => f.text).join('\n');
  const docs = new Map(pages.map((p) => [p.path, parseHtml(p.text)]));
  const inline = [...docs.values()].flatMap((d) => d.styles.map((s) => s.text)).join('\n');
  const allCss = [...cssFiles.map((f) => f.text), inline].join('\n');
  const rules = cssRules(allCss);
  // Style problems go to the first stylesheet, or to the entry page when there is none.
  const styleHome = cssFiles[0]?.path ?? (docs.has(entry) ? entry : pages[0]?.path);

  for (const [path, doc] of docs) {
    for (const h of querySelectorAll(doc, 'h1, h2')) {
      const prev = previousElement(h);
      if (prev && isEyebrow(prev, rules)) add(path, `"${textOf(prev)}" is a small label in capitals right above the heading "${textOf(h).slice(0, 50)}" (an eyebrow). Remove it or make it part of the content`, prev.line);
    }
    const title = [...walk(doc.root)].find((n) => n.tag === 'title');
    const texts = [...visibleTexts(doc), ...(title?.raw ? [{ node: title, text: title.raw.trim() }] : [])];
    let dashes = 0;
    for (const t of texts) {
      for (const p of dashProblems(t.text)) if (dashes++ < 3) add(path, p, t.node.line);
    }
    for (const n of walk(doc.root)) {
      const isButton = n.tag === 'button' || (n.tag === 'input' && /^(submit|button)$/i.test(n.attrs.type ?? ''));
      const label = n.tag === 'input' ? (n.attrs.value ?? '') : textOf(n);
      if ((/^h[1-6]$/.test(n.tag) || isButton) && label.includes('!')) add(path, `The ${isButton ? 'button' : 'heading'} "${label.slice(0, 60)}" has an exclamation mark`, n.line);
    }
    for (const p of hypeProblems(doc.visibleText)) add(path, p);
    if (path === entry && !querySelectorAll(doc, 'meta[name="viewport"]').length) add(path, 'The page has no viewport meta tag, so phones show it zoomed out');
  }

  if (styleHome && (cssFiles.length || inline.trim())) {
    for (const r of rules) {
      const family = /font(?:-family)?\s*:\s*([^;]+)/i.exec(r.body)?.[1] ?? '';
      if (!family) continue;
      const withoutSans = family.replace(/sans-serif/gi, '');
      if (BANNED_FONTS.test(family)) add(styleHome, `${r.selector || 'A rule'} uses ${BANNED_FONTS.exec(family)![0]}, a face the house rules do not use`);
      else if (/(^|[\s,'"])serif\b/i.test(withoutSans) || SERIF_NAMES.test(withoutSans)) add(styleHome, `${r.selector || 'A rule'} sets a serif face (${family.trim().slice(0, 60)}); the house look is a sans with character`);
    }
    if (rules.some((r) => /background-clip\s*:\s*text/i.test(r.body) && /gradient/i.test(r.body))) add(styleHome, 'Gradient text: a heading is filled with a gradient');
    const doc = docs.get(entry) ?? [...docs.values()][0];
    if (doc) {
      const hasLinks = [...walk(doc.root)].some((n) => n.tag === 'a') || /createElement\(\s*['"]a['"]/.test(scripts);
      const hasButtons = [...walk(doc.root)].some((n) => n.tag === 'button' || (n.tag === 'input' && /^(submit|button)$/i.test(n.attrs.type ?? ''))) || /createElement\(\s*['"]button['"]|<button[\s>]/.test(scripts);
      if (hasLinks && !covers(rules, /:hover/, 'a', doc, scripts)) add(styleHome, 'Links have no :hover style');
      if (hasButtons && !covers(rules, /:hover/, 'button', doc, scripts)) add(styleHome, 'Buttons have no :hover style');
      if ((hasLinks || hasButtons) && !rules.some((r) => /:focus(-visible|-within)?\b/.test(r.selector))) add(styleHome, 'Links and buttons have no :focus-visible style, so keyboard users cannot see where they are');
    }
    if (!/@media[^{]*width/i.test(allCss)) add(styleHome, 'No media query for narrow screens: the page needs a real phone layout at 390 px');
  }
  return out;
}
