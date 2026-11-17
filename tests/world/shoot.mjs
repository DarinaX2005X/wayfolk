#!/usr/bin/env node
/**
 * Renders the world preview in headless Chrome and saves frames to tests/world/out/.
 *
 *   node tests/world/shoot.mjs                       the standard set
 *   node tests/world/shoot.mjs name "?view=seat&time=19"   one frame
 *
 * Starts its own Vite on port 5181 (the world package's port) and stops it afterwards.
 * Prints draw calls and triangles for every frame.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
fs.mkdirSync(OUT, { recursive: true });

const SET = [
  ['seat-morning', '?view=seat&time=8.2'],
  ['seat-golden', '?view=seat&time=18.0'],
  ['seat-sunset', '?view=seat&time=19.1'],
  ['seat-night', '?view=seat&time=23'],
  ['seat-rain', '?view=seat&time=15&weather=rain'],
  ['seat-rainbow', '?view=seat&time=16.5&bow=1'],
  ['seat-down', '?camx=0&camy=1.15&camz=0&tx=0&ty=0&tz=-2.4&time=18.0'],
  ['seat-right-pier', '?view=right&time=18.6'],
  ['seat-fire', '?camx=0&camy=1.15&camz=0&tx=-2.5&ty=0.2&tz=-5&time=22&fire=1'],
  ['seat-pulse', '?view=seat&time=19.6&pulse=0.9'],
  ['sky-whale', '?view=seat&time=17.2&whale=1&at=36'],
  ['shooting-star', '?camx=0&camy=1.15&camz=0&tx=0.6&ty=0.9&tz=-2&time=23&star=1&at=3.4'],
  ['above-golden', '?view=above&time=18.2'],
  ['pond', '?camx=-4.5&camy=1.6&camz=-10&tx=-8.3&ty=0&tz=-13.6&time=17.5'],
];

const args = process.argv.slice(2);
const HOUSES = Array.from({ length: 12 }, (_, i) => [`house-${i + 1}`, `?view=house&house=${i + 1}&time=17.6&dist=5.2`]);
const shots = args[0] === 'houses' ? HOUSES : args.length >= 2 ? [[args[0], args[1]]] : SET;
const W = Number(process.env.W ?? 1280);
const H = Number(process.env.H ?? 800);

const server = await createServer({ configFile: path.join(HERE, 'preview', 'vite.config.ts') });
await server.listen();
const base = 'http://127.0.0.1:5181/';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'],
});
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text().slice(0, 300)}`);
  });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  for (const [name, query] of shots) {
    const t0 = Date.now();
    await page.goto(base + query, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 120000 });
    const err = await page.evaluate(() => window.__error);
    if (err) {
      console.log(`${name}: ERROR ${err}`);
      continue;
    }
    await page.waitForTimeout(Number(process.env.WAIT ?? 300));
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => window.__stats);
    if (process.env.HOUSES) console.log(stats.houses);
    console.log(`${name}: calls ${stats.calls}, tris ${stats.triangles}, world ${JSON.stringify(stats.world)} (${Date.now() - t0} ms)`);
  }
} finally {
  await browser.close();
  await server.close();
}
