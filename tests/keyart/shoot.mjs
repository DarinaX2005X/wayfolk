#!/usr/bin/env node
/**
 * Key art for the cover and the gallery: still frames at 2400 × 1600 (3:2) with no page
 * UI, rendered from the live scene (src/app/keyart.ts) on the local dev server.
 *
 *   node tests/keyart/shoot.mjs              every frame (a b c d e)
 *   node tests/keyart/shoot.mjs b c          only these (cover1 cover2 cover3: the covers, no words)
 *   node tests/keyart/shoot.mjs --base <url> another server with debug hooks
 *
 * Each frame gets a fresh page (`?keyart=1&fresh=1&offline=1`), runs `test.keyart(kind)`
 * and saves the canvas alone to tests/keyart/out/keyart-<kind>.png. Chrome runs headless
 * and muted on the machine's GPU (the software renderer is too slow for the frames).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tests', 'keyart', 'out');
const args = process.argv.slice(2);
const baseAt = args.indexOf('--base');
const base = baseAt >= 0 ? args[baseAt + 1].replace(/\/+$/, '') : 'https://localhost:8081';
const kinds = args.filter((a, i) => !a.startsWith('--') && (baseAt < 0 || i !== baseAt + 1));
const list = kinds.length ? kinds : ['a', 'b', 'c', 'd', 'e'];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--ignore-certificate-errors'] });
let failed = 0;
try {
  for (const kind of list) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
    page.on('pageerror', (e) => console.log(`[${kind}] ${e.message}`));
    await page.goto(`${base}/?keyart=1&fresh=1&offline=1&debug=1`);
    await page.waitForFunction(() => document.querySelector('.home')?.dataset.loaded === 'yes', null, { timeout: 120000 });
    const ok = await page.evaluate((k) => window.__gw?.test?.keyart?.(k), kind);
    if (!ok) {
      console.log(`[${kind}] no such frame, or the page has no debug hooks`);
      failed += 1;
      await page.close();
      continue;
    }
    // No page UI: everything that is not the canvas or one of its ancestors is hidden.
    await page.evaluate(() => {
      let el = document.querySelector('canvas');
      while (el && el !== document.documentElement) {
        const parent = el.parentElement;
        if (!parent) break;
        for (const sib of parent.children) if (sib !== el) sib.style.visibility = 'hidden';
        el = parent;
      }
    });
    await page.waitForTimeout(100);
    const file = path.join(OUT, kind.startsWith('cover') ? `cover-${kind.slice(5)}.png` : `keyart-${kind}.png`);
    await page.locator('canvas').first().screenshot({ path: file });
    console.log(`wrote ${path.relative(ROOT, file)}`);
    await page.close();
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
