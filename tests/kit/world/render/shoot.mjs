#!/usr/bin/env node
/**
 * Takes frames of the world kit for review: starts the plain Vite server of
 * vite.config.ts on port 8093, opens the bench page in headless Chrome and writes PNGs to
 * tests/kit/world/out/ (not committed).
 *
 *   node tests/kit/world/render/shoot.mjs seat home cover
 *   node tests/kit/world/render/shoot.mjs "gallery:sector:closed 119" --w 900 --h 600
 *   node tests/kit/world/render/shoot.mjs --all-gallery
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../out');
fs.mkdirSync(out, { recursive: true });
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const W = Number(opt('w', 1200));
const H = Number(opt('h', 800));
const T = opt('t', '100000');
let shots = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

const server = await createServer({ configFile: path.join(here, 'vite.config.ts') });
await server.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
const base = 'http://127.0.0.1:8093/tests/kit/world/render/index.html';

if (args.includes('--all-gallery')) {
  await page.goto(`${base}?view=list`);
  await page.waitForFunction(() => window.__list, null, { timeout: 60000 });
  const list = await page.evaluate(() => window.__list);
  shots = list.flatMap((e) => e.states.map((s) => `gallery:${e.id}:${s}`));
}

for (const shot of shots) {
  const [view, entry, ...rest] = shot.split(':');
  const state = rest.join(':');
  const q = new URLSearchParams({ view, w: String(W), h: String(H), t: T });
  if (entry) q.set('entry', entry);
  if (state) q.set('state', state);
  for (const k of ['probe', 'from', 'at', 'fov']) if (opt(k)) q.set(k, opt(k));
  await page.goto(`${base}?${q}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
  const err = await page.evaluate(() => window.__error);
  const info = await page.evaluate(() => window.__info);
  const name = shot.replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '');
  const file = path.join(out, `${opt('name', name)}.png`);
  await page.locator('canvas').screenshot({ path: file });
  console.log(`${shot} -> ${path.relative(process.cwd(), file)} ${err ? `ERROR ${err}` : JSON.stringify(info)}`);
}
await browser.close();
await server.close();
