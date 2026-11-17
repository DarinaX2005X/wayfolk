#!/usr/bin/env node
/**
 * Triangle budget from the seat and two glide spots: for every view, what the renderer drew
 * (calls, triangles) and the triangles per part that pass frustum culling.
 *
 *   node tests/world/budget.mjs            the standard views, a table per part
 *   node tests/world/budget.mjs entries    batch entries by size with distance from the seat
 *
 * Starts its own Vite on port 5181 and stops it afterwards.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VIEWS = [
  ['seat: houses', '?view=seat&time=18'],
  ['seat: pier', '?view=right&time=18'],
  ['seat: left', '?view=left&time=18'],
  ['seat: cloud sea', '?camx=0&camy=1.2&camz=0&tx=14&ty=-6&tz=4&time=18'],
  ['seat: down', '?camx=0&camy=1.15&camz=0&tx=0&ty=0&tz=-2.4&time=18'],
  ['glide: pier', '?view=spot&spot=pier&time=18&turn=3.14'],
  ['glide: sand spit', '?view=spot&spot=spit&time=18'],
];
const GROUP = (name) => {
  if (/^world:(grass|grass-mid|grass-far|daisies|tulips|bells|puffs|poppies|buttercups|lavender|cornflowers|clover|ferns)/.test(name)) return 'grass & flowers';
  if (/cloud-puffs|cloud-drifters|cloud-sea|cloud-deep|sun-shafts/.test(name)) return 'clouds';
  if (name === 'world:houses') return 'houses';
  if (name === 'world:house-detail') return 'house details';
  if (name === 'world:horizon') return 'horizon islands';
  if (name === 'world:static') return 'static (cliffs, porch, pier, trees)';
  if (name === 'world:decor') return 'bushes & rocks';
  if (name === 'world:ground') return 'ground';
  if (name === 'world:sky-whale' || name.startsWith('world:whale')) return 'whale';
  return 'other';
};

const server = await createServer({ configFile: path.join(HERE, 'preview', 'vite.config.ts') });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  const views = process.argv[2] === 'entries' ? [VIEWS[0]] : VIEWS;
  const table = {};
  const totals = [];
  for (const [name, query] of views) {
    await page.goto('http://127.0.0.1:5181/' + query, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 120000 });
    await page.waitForTimeout(1200);
    if (process.argv[2] === 'entries') {
      const rows = await page.evaluate(() => window.__entries());
      for (const r of rows.slice(0, Number(process.argv[3] ?? 80))) console.log(r.join('\t'));
      break;
    }
    const stats = await page.evaluate(() => window.__info());
    const rows = await page.evaluate(() => window.__probe());
    const parts = {};
    for (const line of rows.slice(1)) {
      const m = /^([* ]) (\d+) (.*)$/.exec(line);
      if (!m || m[1] !== '*') continue;
      const g = GROUP(m[3]);
      parts[g] = (parts[g] ?? 0) + Number(m[2]);
    }
    for (const [g, n] of Object.entries(parts)) (table[g] ??= {})[name] = n;
    totals.push([name, stats.calls, stats.tris]);
  }
  if (process.argv[2] !== 'entries') {
    const names = views.map((v) => v[0]);
    console.log(['part', ...names].join(' | '));
    for (const [g, row] of Object.entries(table).sort((a, b) => (b[1][names[0]] ?? 0) - (a[1][names[0]] ?? 0)))
      console.log([g, ...names.map((n) => ((row[n] ?? 0) / 1000).toFixed(1) + 'k')].join(' | '));
    console.log(['renderer tris', ...totals.map((t) => (t[2] / 1000).toFixed(1) + 'k')].join(' | '));
    console.log(['draw calls', ...totals.map((t) => t[1])].join(' | '));
  }
} finally {
  await browser.close();
  await server.close();
}
