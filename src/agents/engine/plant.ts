/**
 * Mistakes code plants into a sample's recording, so the checks visibly catch them
 * (2–4 per sample). They go into the model's fresh answer before it is saved, the
 * recording keeps their indices and notes, and the second look of the recording is a
 * real model call that fixed them. Every note ends with the reason code a check is
 * expected to give, so a run can count what was caught.
 *
 *   site, with materials     a price changed in the page (number-not-in-source), a closing
 *                            tag removed (parse-error), a background image that isn't in the
 *                            project (missing-asset)
 *   site, without materials  a script file that doesn't exist (missing-file), an in-page link
 *                            to a section that isn't there (broken-link), a closing brace
 *                            removed (parse-error), an element looked up by a wrong id
 *                            (element-missing); at most 4 in all
 *   plan                     an item that ends before it starts (date-order), an owner who
 *                            isn't on the team (owner-unknown), an end after the window
 *                            (date-out-of-range), a total that doesn't add up (sum-mismatch)
 *   document                 a number changed in a section (number-not-in-source), a word
 *                            changed in a quote (quote-altered)
 */
import { addDays, isIsoDate } from '../checks/dates';
import { findNumbers } from '../checks/numbers';
import { parseHtml } from '../checks/code/html';

export type Planted<T> = { value: T; notes: string[] };

/** A price of the visible text moved by a quarter; null when the page shows no price. */
function changePrice(html: string): Planted<string> | null {
  const doc = parseHtml(html);
  const money = findNumbers(doc.visibleText).find((m) => m.kind === 'money' && /^\$/.test(m.raw));
  if (!money) return null;
  const at = html.indexOf(money.raw, html.search(/<body/i));
  if (at < 0) return null;
  const value = Number(money.value) + 0.25;
  const next = '$' + (Number.isInteger(value) ? String(value) : value.toFixed(2));
  return { value: html.slice(0, at) + next + html.slice(at + money.raw.length), notes: [`The price ${money.raw} was changed to ${next} in the page (number-not-in-source)`] };
}

/** The first closing tag of a section-like element removed. */
function dropClosingTag(html: string): Planted<string> | null {
  for (const tag of ['section', 'ul', 'article', 'div', 'main']) {
    const re = new RegExp(`</${tag}>`, 'i');
    const body = html.search(/<body/i);
    const m = re.exec(html.slice(Math.max(0, body)));
    if (!m) continue;
    const at = Math.max(0, body) + m.index;
    return { value: html.slice(0, at) + html.slice(at + m[0].length), notes: [`The closing </${tag}> was removed (parse-error)`] };
  }
  return null;
}

function addMissingScript(html: string): Planted<string> | null {
  const at = html.search(/<\/head>/i);
  if (at < 0) return null;
  return { value: html.slice(0, at) + '  <script src="storage.js" defer></script>\n' + html.slice(at), notes: ['A script storage.js that the project doesn\'t have was linked (missing-file)'] };
}

/** An in-page link to a section the page doesn't have. */
function brokenLink(html: string): Planted<string> | null {
  const doc = parseHtml(html);
  for (const m of html.matchAll(/href=(['"])#([\w-]+)\1/g)) {
    if (!doc.ids.has(m[2])) continue;
    const wrong = m[2] + '-section';
    if (doc.ids.has(wrong)) continue;
    const at = m.index ?? 0;
    return { value: html.slice(0, at) + m[0].replace('#' + m[2], '#' + wrong) + html.slice(at + m[0].length), notes: [`The link to #${m[2]} was changed to #${wrong}, which the page doesn't have (broken-link)`] };
  }
  const end = html.search(/<\/footer>/i) >= 0 ? html.search(/<\/footer>/i) : html.search(/<\/body>/i);
  if (end < 0) return null;
  return { value: html.slice(0, end) + '<a href="#help">Help</a>\n' + html.slice(end), notes: ["A link to #help, which the page doesn't have, was added (broken-link)"] };
}

function addMissingImage(css: string): Planted<string> {
  const m = /(^|\n)\s*body\s*\{/.exec(css);
  const rule = '\n  background-image: url("images/flour-texture.png");';
  if (m) {
    const at = m.index + m[0].length;
    return { value: css.slice(0, at) + rule + css.slice(at), notes: ['A background image images/flour-texture.png that the project doesn\'t have was added (missing-asset)'] };
  }
  return { value: css + `\nbody {${rule}\n}\n`, notes: ['A background image images/flour-texture.png that the project doesn\'t have was added (missing-asset)'] };
}

function breakBrace(js: string): Planted<string> | null {
  // The closing brace of the first function body that ends a line on its own.
  // Otherwise the last closing brace of the file.
  const m = /\n([ \t]*)\}\r?\n/.exec(js);
  const at = m ? m.index + 1 + m[1].length : js.lastIndexOf('}');
  if (at < 0) return null;
  return { value: js.slice(0, at) + js.slice(at + 1), notes: ['A closing brace was removed from the script (parse-error)'] };
}

function wrongLookup(js: string, html: string): Planted<string> | null {
  const ids = parseHtml(html).ids;
  for (const m of js.matchAll(/getElementById\(\s*(['"])([\w-]+)\1\s*\)/g)) {
    if (!ids.has(m[2])) continue;
    const wrong = m[2] + '-box';
    const at = m.index ?? 0;
    return { value: js.slice(0, at) + m[0].replace(m[2], wrong) + js.slice(at + m[0].length), notes: [`getElementById('${m[2]}') was changed to look for "${wrong}" (element-missing)`] };
  }
  for (const m of js.matchAll(/querySelector\(\s*(['"])#([\w-]+)\1\s*\)/g)) {
    if (!ids.has(m[2])) continue;
    const wrong = m[2] + '-box';
    const at = m.index ?? 0;
    return { value: js.slice(0, at) + m[0].replace(m[2], wrong) + js.slice(at + m[0].length), notes: [`querySelector('#${m[2]}') was changed to look for "#${wrong}" (element-missing)`] };
  }
  return null;
}

/** Mistakes for one file of a site; `html` is the page already written (for scripts). */
export function plantFile(path: string, text: string, ctx: { materials: boolean; html: string }): Planted<string> {
  let value = text;
  const notes: string[] = [];
  const apply = (p: Planted<string> | null) => {
    if (!p) return;
    value = p.value;
    notes.push(...p.notes);
  };
  if (/\.html?$/i.test(path)) {
    if (ctx.materials) {
      apply(changePrice(value));
      apply(dropClosingTag(value));
    } else {
      apply(addMissingScript(value));
      apply(brokenLink(value));
    }
  } else if (/\.css$/i.test(path) && ctx.materials) {
    apply(addMissingImage(value));
  } else if (/\.m?js$/i.test(path) && !ctx.materials) {
    apply(wrongLookup(value, ctx.html));
    apply(breakBrace(value));
  }
  return { value, notes };
}

type ItemsAnswer = {
  items: { id: string; task: string; owner: string; start: string; end: string; depends: string[]; cells: { column: string; value: string }[] }[];
  totals: { column: string; value: string }[];
};

/** Mistakes for a plan answer: indices of changed items (1000 + i for totals). */
export function plantItems(answer: ItemsAnswer, ctx: { window: { from: string; to: string } | null; team: string[] }): { json: ItemsAnswer; planted: number[]; notes: string[] } {
  const json: ItemsAnswer = structuredClone(answer);
  const planted: number[] = [];
  const notes: string[] = [];
  const items = json.items;
  const pick = (i: number) => (items.length > i ? i : -1);
  const a = pick(1);
  if (a >= 0 && isIsoDate(items[a].start) && isIsoDate(items[a].end)) {
    const start = items[a].start;
    items[a].start = addDays(items[a].end, 3);
    items[a].end = start;
    planted.push(a);
    notes.push(`"${items[a].task}" was made to end before it starts (date-order)`);
  }
  const b = pick(3);
  if (b >= 0 && ctx.team.length) {
    items[b].owner = 'Jordan Blake';
    planted.push(b);
    notes.push(`"${items[b].task}" was given an owner who isn't on the team (owner-unknown)`);
  }
  const c = pick(5);
  if (c >= 0 && ctx.window && isIsoDate(items[c].end)) {
    items[c].end = addDays(ctx.window.to, 21);
    planted.push(c);
    notes.push(`"${items[c].task}" was moved to end three weeks after the plan's window (date-out-of-range)`);
  }
  const t = json.totals.findIndex((x) => findNumbers(x.value).length > 0);
  if (t >= 0) {
    const m = findNumbers(json.totals[t].value)[0];
    const next = (Number(m.value) + 150).toLocaleString('en-US');
    json.totals[t].value = json.totals[t].value.replace(m.raw.replace(/^\$/, ''), next);
    planted.push(1000 + t);
    notes.push(`The ${json.totals[t].column} total was raised by 150 (sum-mismatch)`);
  }
  return { json, planted, notes };
}

type SectionsAnswer = { sections: { heading: string; text: string; from: string[] }[] };

export function plantSections(answer: SectionsAnswer): { json: SectionsAnswer; planted: number[]; notes: string[] } {
  const json: SectionsAnswer = structuredClone(answer);
  for (let i = 0; i < json.sections.length; i++) {
    const m = findNumbers(json.sections[i].text).find((x) => x.kind !== 'date');
    if (!m) continue;
    const next = m.kind === 'money' ? m.raw.replace(/[\d.,]+/, String(Number(m.value) + 1)) : String(Number(m.value) + 2);
    json.sections[i].text = json.sections[i].text.replace(m.raw, next);
    return { json, planted: [i], notes: [`"${m.raw}" was changed to "${next}" in "${json.sections[i].heading}" (number-not-in-source)`] };
  }
  return { json, planted: [], notes: [] };
}
