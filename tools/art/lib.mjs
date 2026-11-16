// Shared code of the art tools: reading figure files, polygon geometry, the canonical file format.
// Plain Node 22, no project dependencies, so the tools run before `npm install`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CUTOUT_DIR = path.join(ROOT, 'src', 'content', 'cutouts');
export const OUT_DIR = path.join(ROOT, 'tools', 'art', 'out');

export const GROUPS = ['nature', 'party', 'home', 'animals', 'things'];
export const PAPER_COLORS = [
  'white', 'tomato', 'tangerine', 'sun', 'leaf', 'pine', 'sky', 'cobalt', 'berry', 'pink', 'sand', 'ink',
];

// The two stage packages of the library, in the order of the Shapes tab.
export const SET_01 = [
  'sun', 'moon', 'cloud', 'star', 'hill', 'mountain', 'wave', 'pine', 'round-tree', 'tulip', 'daisy', 'leaf',
  'cake', 'candle', 'balloon', 'gift', 'banner', 'confetti',
  'house', 'tower', 'window', 'door',
  'cat', 'bird',
];
export const SET_02 = [
  'cactus', 'fern', 'mushroom', 'rainbow-arc', 'snowflake', 'snow-pine', 'raindrop', 'flame',
  'cup-trophy', 'medal', 'party-hat', 'firework', 'garland', 'heart',
  'cottage', 'apartment', 'bridge', 'lamp-post', 'fence', 'key',
  'dog', 'fox', 'rabbit', 'whale', 'fish', 'butterfly', 'owl', 'snail',
  'teacup', 'kite', 'boat', 'bicycle', 'envelope', 'rocket', 'umbrella', 'book',
];

// ---------- colours ----------

const DRAFT_PAPER_HEX = {
  white: '#FBF7EC', tomato: '#F04E30', tangerine: '#FF8A1F', sun: '#FFC531', leaf: '#12A05C', pine: '#0B6B4B',
  sky: '#6CC4F5', cobalt: '#2B63D9', berry: '#C2255C', pink: '#FF8FB1', sand: '#EBD3A7', ink: '#1F1D1A',
};

// Paper colours live in src/tokens/tokens.ts. The sheet reads them from there.
export function readPaperHex() {
  const file = path.join(ROOT, 'src', 'tokens', 'tokens.ts');
  if (!existsSync(file)) return DRAFT_PAPER_HEX;
  const text = readFileSync(file, 'utf8');
  const at = text.indexOf('PAPER_HEX');
  if (at < 0) throw new Error('PAPER_HEX is not in src/tokens/tokens.ts');
  const block = text.slice(at, text.indexOf('}', at));
  const hex = {};
  for (const m of block.matchAll(/['"]?([a-z]+)['"]?\s*:\s*['"](#[0-9a-fA-F]{6})['"]/g)) hex[m[1]] = m[2];
  const missing = PAPER_COLORS.filter((c) => !hex[c]);
  if (missing.length) throw new Error(`PAPER_HEX has no ${missing.join(', ')}`);
  return hex;
}

// ---------- figure files ----------

export const identOf = (id) => id.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());

export function listCutoutIds() {
  if (!existsSync(CUTOUT_DIR)) return [];
  return readdirSync(CUTOUT_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'types.ts' && f !== 'list.ts')
    .map((f) => f.slice(0, -3))
    .sort();
}

// A figure file is a comment, a type import and one object literal with plain numbers.
// The literal is turned into JSON and parsed as data, nothing from the file is executed.
export function readCutout(id) {
  const file = path.join(CUTOUT_DIR, `${id}.ts`);
  const text = readFileSync(file, 'utf8');
  const comment = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith('//')) break;
    comment.push(line.replace(/^\/\/ ?/, ''));
  }
  const open = text.indexOf('{', text.indexOf('CutoutSource ='));
  const close = text.lastIndexOf('}');
  if (open < 0 || close < open) throw new Error(`${id}.ts: no figure object`);
  const json = text
    .slice(open, close + 1)
    .replace(/\/\/.*$/gm, '')
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')
    .replace(/'([^']*)'/g, '"$1"')
    .replace(/,(\s*[\]}])/g, '$1');
  let data;
  try {
    data = JSON.parse(json);
  } catch (err) {
    throw new Error(`${id}.ts: the figure object is not plain data (${err.message})`);
  }
  return { comment, holes: [], details: [], ...data };
}

export function readCutouts(ids) {
  return ids.map(readCutout);
}

const num = (v) => {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? '0' : String(r);
};

function ringText(flat, indent) {
  const pairs = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push(`${num(flat[i])}, ${num(flat[i + 1])}`);
  const lines = [];
  for (let i = 0; i < pairs.length; i += 6) lines.push(`${indent}${pairs.slice(i, i + 6).join(',  ')},`);
  return lines.join('\n');
}

function ringsText(name, rings) {
  if (!rings.length) return '';
  const inner = rings.map((r) => `    [\n${ringText(r, '      ')}\n    ],`).join('\n');
  return `  ${name}: [\n${inner}\n  ],\n`;
}

export function formatCutout(c) {
  const head = c.comment.map((l) => (l ? `// ${l}` : '//')).join('\n');
  return `${head}
import type { CutoutSource } from './types';

export const ${identOf(c.id)}: CutoutSource = {
  id: '${c.id}',
  name: '${c.name}',
  group: '${c.group}',
  defaultSize: ${c.defaultSize},
  defaultPaper: '${c.defaultPaper}',
${c.defaultPaper2 ? `  defaultPaper2: '${c.defaultPaper2}',\n` : ''}  main: [
${ringText(c.main, '    ')}
  ],
${ringsText('holes', c.holes)}${ringsText('details', c.details)}};
`;
}

// ---------- geometry (flat arrays x0, y0, x1, y1 …; y up) ----------

export function pairs(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

export function signedArea(flat) {
  let a = 0;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += flat[2 * i] * flat[2 * j + 1] - flat[2 * j] * flat[2 * i + 1];
  }
  return a / 2;
}

export function bounds(rings) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of rings) {
    for (let i = 0; i < r.length; i += 2) {
      minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]);
      minY = Math.min(minY, r[i + 1]); maxY = Math.max(maxY, r[i + 1]);
    }
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

export const allRings = (c) => [c.main, ...c.holes, ...c.details];

function reversed(flat) {
  const out = [];
  for (let i = flat.length - 2; i >= 0; i -= 2) out.push(flat[i], flat[i + 1]);
  return out;
}

// One winding and one starting point per ring, so that the files diff cleanly.
function canonicalRing(flat, ccw) {
  let r = [];
  for (let i = 0; i < flat.length; i += 2) {
    const x = Math.round(flat[i] * 10) / 10 + 0;
    const y = Math.round(flat[i + 1] * 10) / 10 + 0;
    const n = r.length;
    if (n >= 2 && r[n - 2] === x && r[n - 1] === y) continue;
    r.push(x, y);
  }
  if (r.length >= 4 && r[0] === r[r.length - 2] && r[1] === r[r.length - 1]) r.length -= 2;
  if (signedArea(r) > 0 !== ccw) r = reversed(r);
  let start = 0;
  for (let i = 2; i < r.length; i += 2) {
    if (r[i + 1] < r[start + 1] || (r[i + 1] === r[start + 1] && r[i] < r[start])) start = i;
  }
  return [...r.slice(start), ...r.slice(0, start)];
}

// Height 100, bottom on y = 0, centre of the width on x = 0, one decimal, outer rings counter-clockwise.
export function normalizeCutout(c) {
  const b = bounds(allRings(c));
  const k = 100 / b.h;
  const cx = (b.minX + b.maxX) / 2;
  const fit = (flat) => flat.map((v, i) => (i % 2 === 0 ? (v - cx) * k : (v - b.minY) * k));
  return {
    ...c,
    main: canonicalRing(fit(c.main), true),
    holes: c.holes.map((h) => canonicalRing(fit(h), false)),
    details: c.details.map((d) => canonicalRing(fit(d), true)),
  };
}

export function pointInRing(x, y, flat) {
  let inside = false;
  const n = flat.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = flat[2 * i], yi = flat[2 * i + 1], xj = flat[2 * j], yj = flat[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

export function distToRing(px, py, flat) {
  let best = Infinity;
  const n = flat.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    best = Math.min(best, distToSegment(px, py, flat[2 * i], flat[2 * i + 1], flat[2 * j], flat[2 * j + 1]));
  }
  return best;
}

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

// True when the segments cross or overlap; sharing an end point does not count.
export function segmentsCross(a, b, c, d) {
  const d1 = cross(b[0] - a[0], b[1] - a[1], c[0] - a[0], c[1] - a[1]);
  const d2 = cross(b[0] - a[0], b[1] - a[1], d[0] - a[0], d[1] - a[1]);
  const d3 = cross(d[0] - c[0], d[1] - c[1], a[0] - c[0], a[1] - c[1]);
  const d4 = cross(d[0] - c[0], d[1] - c[1], b[0] - c[0], b[1] - c[1]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (p, q, r) =>
    Math.min(p[0], q[0]) - 1e-9 <= r[0] && r[0] <= Math.max(p[0], q[0]) + 1e-9 &&
    Math.min(p[1], q[1]) - 1e-9 <= r[1] && r[1] <= Math.max(p[1], q[1]) + 1e-9;
  const same = (p, q) => p[0] === q[0] && p[1] === q[1];
  if (d1 === 0 && on(a, b, c) && !same(c, a) && !same(c, b)) return true;
  if (d2 === 0 && on(a, b, d) && !same(d, a) && !same(d, b)) return true;
  if (d3 === 0 && on(c, d, a) && !same(a, c) && !same(a, d)) return true;
  if (d4 === 0 && on(c, d, b) && !same(b, c) && !same(b, d)) return true;
  return false;
}

// Distance along a ray to the nearest edge of the rings, skipping edges listed in `skip` ("ring:edge").
export function rayHit(ox, oy, dx, dy, rings, skip) {
  let best = Infinity;
  rings.forEach((flat, ri) => {
    const n = flat.length / 2;
    for (let i = 0; i < n; i++) {
      if (skip.has(`${ri}:${i}`)) continue;
      const j = (i + 1) % n;
      const ax = flat[2 * i], ay = flat[2 * i + 1];
      const ex = flat[2 * j] - ax, ey = flat[2 * j + 1] - ay;
      const den = cross(dx, dy, ex, ey);
      if (Math.abs(den) < 1e-12) continue;
      const t = cross(ax - ox, ay - oy, ex, ey) / den;
      const u = cross(ax - ox, ay - oy, dx, dy) / den;
      if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
    }
  });
  return best;
}
