#!/usr/bin/env node
/**
 * The one typeface of Wayfolk, Atkinson Hyperlegible Next (OFL), for both surfaces:
 *
 *   public/fonts/atkinson-hyperlegible-next-latin-{400,700}-normal.woff2   browser pages
 *   public/fonts/OFL.txt                                                  the licence
 *   public/fonts/atkinson-msdf/atkinson-{400,700}.json + .png             MSDF atlases for uikit
 *
 *   npm run font
 *
 * The atlases are built once and committed: `npm run build` never needs msdf-bmfont-xml.
 * Run this only to rebuild them (Python 3 with fontTools and brotli converts the woff2
 * sources to TrueType first, because msdf-bmfont-xml reads TrueType and OpenType only).
 *
 * Tabular figures. The digits of Atkinson Hyperlegible Next have different widths, and
 * msdf-bmfont-xml takes glyphs by cmap without applying the `tnum` feature. So after
 * the build every digit of both weights gets one advance (the widest digit's) and its
 * xoffset is moved so the digit stands in the middle of that step; kerning pairs with a
 * digit are dropped. Browser pages get the
 * same with `font-variant-numeric: tabular-nums`.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const SOURCE = path.join(ROOT, 'node_modules', '@fontsource', 'atkinson-hyperlegible-next');
const FONTS = path.join(ROOT, 'public', 'fonts');
const ATLAS = path.join(FONTS, 'atkinson-msdf');
const WEIGHTS = [400, 700];

/** ASCII and the typographic marks the product prints in the headset. */
export const CHARSET =
  Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('') + '’“”–—·…°×$£';
export const SIZE = 48;
export const DISTANCE_RANGE = 4;

const woff2 = (weight) => `atkinson-hyperlegible-next-latin-${weight}-normal.woff2`;

/** Gives the ten digits one advance and centres each in it. Returns the advance. */
export function tabularDigits(font) {
  const digits = font.chars.filter((c) => c.char >= '0' && c.char <= '9');
  if (digits.length !== 10) throw new Error(`the atlas has ${digits.length} digits, expected 10`);
  const step = Math.max(...digits.map((d) => d.xadvance));
  for (const d of digits) {
    // The ink of the glyph spans xoffset .. xoffset + width inside its old advance; keep its
    // side bearings in proportion by moving it by half of the advance it gains.
    d.xoffset = Math.round((d.xoffset + (step - d.xadvance) / 2) * 1000) / 1000;
    d.xadvance = step;
  }
  // Kerning would move a digit off its step: tabular figures keep none.
  const ids = new Set(digits.map((d) => d.id));
  font.kernings = (font.kernings ?? []).filter((k) => !ids.has(k.first) && !ids.has(k.second));
  return step;
}

function toTtf(src, dst) {
  const code = 'import sys\nfrom fontTools.ttLib import TTFont\nf = TTFont(sys.argv[1])\nf.flavor = None\nf.save(sys.argv[2])\n';
  for (const python of ['python', 'python3', 'py']) {
    const run = spawnSync(python, ['-I', '-c', code, src, dst], { encoding: 'utf8' });
    if (run.status === 0) return;
    if (run.error?.code === 'ENOENT') continue;
    throw new Error(`fontTools could not convert ${path.basename(src)}:\n${run.stderr}`);
  }
  throw new Error('Python 3 with fontTools and brotli is needed to rebuild the atlas (pip install fonttools brotli)');
}

function buildAtlas(ttf, weight) {
  const generateBMFont = require('msdf-bmfont-xml');
  return new Promise((resolve, reject) => {
    generateBMFont(
      ttf,
      {
        outputType: 'json',
        filename: path.join(ATLAS, `atkinson-${weight}`),
        charset: CHARSET,
        fontSize: SIZE,
        distanceRange: DISTANCE_RANGE,
        fieldType: 'msdf',
        textureSize: [512, 512],
        smartSize: true,
        pot: true,
      },
      (error, textures, font) => (error ? reject(error) : resolve({ textures, font })),
    );
  });
}

async function main() {
  mkdirSync(ATLAS, { recursive: true });
  for (const weight of WEIGHTS) copyFileSync(path.join(SOURCE, 'files', woff2(weight)), path.join(FONTS, woff2(weight)));
  copyFileSync(path.join(SOURCE, 'LICENSE'), path.join(FONTS, 'OFL.txt'));

  const temp = mkdtempSync(path.join(tmpdir(), 'gw-font-'));
  try {
    for (const weight of WEIGHTS) {
      const ttf = path.join(temp, `atkinson-${weight}.ttf`);
      toTtf(path.join(SOURCE, 'files', woff2(weight)), ttf);
      const { textures, font } = await buildAtlas(ttf, weight);
      if (textures.length !== 1) throw new Error(`weight ${weight}: ${textures.length} atlas pages, uikit reads exactly one`);
      const png = `atkinson-${weight}.png`;
      writeFileSync(path.join(ATLAS, png), textures[0].texture);
      const data = JSON.parse(font.data);
      data.pages = [png];
      data.info.face = `Atkinson Hyperlegible Next ${weight === 700 ? 'Bold' : 'Regular'}`;
      const missing = Array.from(CHARSET).filter((ch) => !data.chars.some((c) => c.char === ch));
      if (missing.length) throw new Error(`weight ${weight}: the atlas is missing ${JSON.stringify(missing.join(''))}`);
      const step = tabularDigits(data);
      writeFileSync(path.join(ATLAS, `atkinson-${weight}.json`), `${JSON.stringify(data)}\n`);
      console.log(`atkinson-${weight}: ${data.chars.length} glyphs, ${data.common.scaleW}x${data.common.scaleH}, digits ${step}`);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(`written to ${path.relative(ROOT, FONTS)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

