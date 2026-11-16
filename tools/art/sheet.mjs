// Contact sheet of the figure library: every figure on the mat in its default paper with the white
// cut edge and the paper shadow, black silhouettes at 64 px, and a line-up at default sizes on the
// 10 mm grid. Writes SVG and, through headless Chrome, PNG.
//
//   node tools/art/sheet.mjs                          sheet-01, sheet-02 and sheet-all into tools/art/out/
//   node tools/art/sheet.mjs --ids sun,moon --name review [--cell 440] [--cols 3] [--points] [--card]
//
// --points numbers the vertices, --card puts a card-white sheet under each figure, --no-png skips Chrome.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT_DIR, SET_01, SET_02, bounds, allRings, listCutoutIds, pairs, readCutouts, readPaperHex } from './lib.mjs';

const MAT = '#1E5A48';
const MAT_LINE = '#7FB196';
const PAPER_WHITE = '#FBF7EC';
const INK = '#1F1D1A';
const INK_SOFT = '#5B564D';
const FONT = `font-family="'Bricolage Grotesque','Segoe UI',system-ui,sans-serif"`;
const EDGE_MM = 0.8; // white cut edge
const SHADOW_MM = 1; // shadow shift of a resting piece

const r1 = (v) => Math.round(v * 10) / 10;
const hex = readPaperHex();

function ringPath(flat, cx, baseY, s) {
  return `M${pairs(flat).map(([x, y]) => `${r1(cx + x * s)} ${r1(baseY - y * s)}`).join('L')}Z`;
}

// One figure: cx is the pixel of x = 0, baseY the pixel of y = 0, s pixels per unit.
function figure(c, cx, baseY, s, o = {}) {
  const mm = (s * 100) / c.defaultSize;
  const edge = r1(2 * EDGE_MM * mm);
  const join = `stroke-width="${edge}" stroke-linejoin="miter" stroke-miterlimit="2.2"`;
  const main = [c.main, ...c.holes].map((f) => ringPath(f, cx, baseY, s)).join('');
  const sh = SHADOW_MM * mm;
  let out = '';
  out += `<path d="${main}" fill-rule="evenodd" fill="#000" stroke="#000" ${join} opacity="0.1" transform="translate(${r1(sh * 1.9)} ${r1(sh * 1.9)})"/>`;
  out += `<path d="${main}" fill-rule="evenodd" fill="#000" stroke="#000" ${join} opacity="0.22" transform="translate(${r1(sh)} ${r1(sh)})"/>`;
  out += `<path d="${main}" fill-rule="evenodd" fill="${PAPER_WHITE}" stroke="${PAPER_WHITE}" ${join}/>`;
  out += `<path d="${main}" fill-rule="evenodd" fill="${hex[c.defaultPaper]}"/>`;
  for (const detail of c.details) {
    const d = ringPath(detail, cx, baseY, s);
    out += `<path d="${d}" fill="#000" stroke="#000" ${join} opacity="0.16" transform="translate(${r1(0.4 * mm)} ${r1(0.4 * mm)})"/>`;
    out += `<path d="${d}" fill="${PAPER_WHITE}" stroke="${PAPER_WHITE}" ${join}/>`;
    out += `<path d="${d}" fill="${hex[c.defaultPaper2 ?? 'white']}"/>`;
  }
  if (o.points) {
    [c.main, ...c.holes, ...c.details].forEach((flat, ri) => {
      const color = ri === 0 ? '#000' : ri <= c.holes.length ? '#06c' : '#c0c';
      pairs(flat).forEach(([x, y], i) => {
        const px = r1(cx + x * s), py = r1(baseY - y * s);
        out += `<circle cx="${px}" cy="${py}" r="2" fill="${color}"/>`;
        out += `<text x="${px + 3}" y="${py - 3}" font-size="10" ${FONT} fill="${color}" stroke="#fff" stroke-width="2.5" paint-order="stroke">${i}</text>`;
      });
    });
  }
  return out;
}

function silhouette(c, cx, baseY, s) {
  const main = [c.main, ...c.holes].map((f) => ringPath(f, cx, baseY, s)).join('');
  let out = `<path d="${main}" fill-rule="evenodd" fill="${INK}"/>`;
  for (const detail of c.details) out += `<path d="${ringPath(detail, cx, baseY, s)}" fill="${INK}"/>`;
  return out;
}

function pointCount(c) {
  const n = (f) => f.length / 2;
  const main = n(c.main) + c.holes.reduce((a, h) => a + n(h), 0);
  return [main, ...c.details.map(n)].join(' + ');
}

function buildSheet(cutouts, o) {
  const pad = 40;
  const cols = o.cols;
  const cell = o.cell;
  const cellH = Math.round(cell * 0.86) + 44;
  const width = pad * 2 + cols * cell;
  let y = pad;
  let body = '';

  body += `<text x="${pad}" y="${y + 22}" font-size="26" font-weight="700" ${FONT} fill="${PAPER_WHITE}">${o.title}</text>`;
  body += `<text x="${pad}" y="${y + 46}" font-size="14" font-weight="500" ${FONT} fill="${MAT_LINE}">Default paper, white cut edge ${EDGE_MM} mm and resting shadow at the default size. Height 100 units, base on the ground line.</text>`;
  y += 70;

  // 1. The figures in paper.
  cutouts.forEach((c, i) => {
    const x0 = pad + (i % cols) * cell;
    const y0 = y + Math.floor(i / cols) * cellH;
    const b = bounds(allRings(c));
    const s = Math.min((cell * 0.76) / b.w, (cell * 0.66) / 100);
    const baseY = y0 + cell * 0.8;
    const cx = x0 + cell / 2;
    if (o.card) body += `<rect x="${x0 + 8}" y="${y0 + 8}" width="${cell - 16}" height="${cell * 0.86 - 4}" rx="6" fill="${PAPER_WHITE}"/>`;
    body += figure(c, cx, baseY, s, o);
    const labelY = y0 + cell * 0.86 + 22;
    body += `<text x="${cx}" y="${labelY}" text-anchor="middle" font-size="15" font-weight="700" ${FONT} fill="${PAPER_WHITE}">${c.id}</text>`;
    body += `<text x="${cx}" y="${labelY + 17}" text-anchor="middle" font-size="12" font-weight="500" ${FONT} fill="${MAT_LINE}">${c.defaultSize} mm, ${pointCount(c)} points</text>`;
  });
  y += Math.ceil(cutouts.length / cols) * cellH + 16;

  // 2. Black silhouettes inside 64 × 64 px.
  const tile = 92;
  const perRow = Math.floor((width - pad * 2 - 24) / tile);
  const rows = Math.ceil(cutouts.length / perRow);
  const bandH = rows * 104 + 20;
  body += `<rect x="${pad}" y="${y}" width="${width - pad * 2}" height="${bandH}" rx="6" fill="${PAPER_WHITE}"/>`;
  cutouts.forEach((c, i) => {
    const b = bounds(allRings(c));
    const s = 64 / Math.max(b.w, 100);
    const cx = pad + 12 + (i % perRow) * tile + tile / 2;
    const top = y + 16 + Math.floor(i / perRow) * 104;
    const baseY = top + 32 + (100 * s) / 2;
    body += silhouette(c, cx, baseY, s);
    body += `<text x="${cx}" y="${top + 84}" text-anchor="middle" font-size="11" font-weight="500" ${FONT} fill="${INK_SOFT}">${c.id}</text>`;
  });
  y += bandH + 24;

  // 3. Line-up at default sizes on the mat grid: one square is 10 mm.
  if (o.lineup) {
    const pxMm = 2.4;
    const rowMm = 100;
    const gapMm = 7;
    const maxMm = (width - pad * 2) / pxMm - 14;
    const lines = [[]];
    let used = 10;
    for (const c of cutouts) {
      const wMm = (bounds(allRings(c)).w * c.defaultSize) / 100;
      if (used + wMm > maxMm && lines.at(-1).length) {
        lines.push([]);
        used = 10;
      }
      lines.at(-1).push({ c, x: used + wMm / 2 });
      used += wMm + gapMm;
    }
    body += `<text x="${pad}" y="${y + 16}" font-size="14" font-weight="500" ${FONT} fill="${MAT_LINE}">Default sizes side by side. One square of the grid is 10 mm, the card is 200 mm wide.</text>`;
    y += 30;
    for (const line of lines) {
      const h = rowMm * pxMm;
      const w = width - pad * 2;
      for (let mm = 0; mm <= w / pxMm; mm += 10) {
        const strong = mm % 50 === 0;
        body += `<line x1="${r1(pad + mm * pxMm)}" y1="${y}" x2="${r1(pad + mm * pxMm)}" y2="${y + h}" stroke="${MAT_LINE}" stroke-width="1" opacity="${strong ? 0.5 : 0.2}"/>`;
      }
      for (let mm = 0; mm <= rowMm; mm += 10) {
        const strong = mm % 50 === 0;
        const ly = r1(y + h - mm * pxMm);
        body += `<line x1="${pad}" y1="${ly}" x2="${pad + w}" y2="${ly}" stroke="${MAT_LINE}" stroke-width="1" opacity="${strong ? 0.5 : 0.2}"/>`;
        if (strong) body += `<text x="${pad - 8}" y="${ly + 4}" text-anchor="end" font-size="12" font-weight="600" ${FONT} fill="${MAT_LINE}">${mm / 10}</text>`;
      }
      for (const { c, x } of line) {
        body += figure(c, pad + x * pxMm, y + h, (c.defaultSize * pxMm) / 100);
      }
      y += h + 26;
    }
  }

  const height = Math.round(y + pad - 10);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${MAT}"/>${body}</svg>\n`;
  return { svg, width, height };
}

function findChrome() {
  const list = [
    process.env.CHROME,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return list.find((p) => p && existsSync(p));
}

function writePng(svgFile, pngFile, width, height) {
  const chrome = findChrome();
  if (!chrome) {
    console.log('  Chrome is not found (set CHROME to its path): PNG skipped');
    return;
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'byhand-sheet-'));
  try {
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${width},${height}`, `--user-data-dir=${path.join(tmp, 'profile')}`,
      `--screenshot=${pngFile}`, pathToFileURL(svgFile).href,
    ], { stdio: 'ignore' });
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function emit(name, ids, o) {
  const have = new Set(listCutoutIds());
  const present = ids.filter((id) => have.has(id));
  const missing = ids.filter((id) => !have.has(id));
  if (!present.length) {
    console.log(`${name}: no figures yet`);
    return;
  }
  const sheet = buildSheet(readCutouts(present), o);
  mkdirSync(OUT_DIR, { recursive: true });
  const svgFile = path.join(OUT_DIR, `${name}.svg`);
  const pngFile = path.join(OUT_DIR, `${name}.png`);
  writeFileSync(svgFile, sheet.svg);
  if (o.png) writePng(svgFile, pngFile, sheet.width, sheet.height);
  console.log(`${name}: ${present.length} figures, ${sheet.width} × ${sheet.height}${missing.length ? `, not drawn yet: ${missing.join(', ')}` : ''}`);
}

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n, fallback) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : fallback);
const base = { png: !flag('no-png'), points: flag('points'), card: flag('card') };

if (flag('ids')) {
  const ids = value('ids').split(',').map((s) => s.trim()).filter(Boolean);
  emit(value('name', 'review'), ids, {
    ...base, cols: Number(value('cols', 3)), cell: Number(value('cell', 440)),
    title: `Byhand cutouts, review of ${ids.length}`, lineup: flag('lineup'),
  });
} else {
  const sheets = [
    ['sheet-01', SET_01, 'Byhand cutouts, sheet 01: the first 24'],
    ['sheet-02', SET_02, 'Byhand cutouts, sheet 02: the other 36'],
    ['sheet-all', [...SET_01, ...SET_02], 'Byhand cutouts, the whole library'],
  ];
  for (const [name, ids, title] of sheets) emit(name, ids, { ...base, cols: 6, cell: 236, title, lineup: true });
}
