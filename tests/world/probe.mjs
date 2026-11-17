#!/usr/bin/env node
/**
 * Lists every drawable in the world preview with its triangle count and whether it was in
 * view, for budget work: node tests/world/probe.mjs "?view=seat&time=18"
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const server = await createServer({ configFile: path.join(HERE, 'preview', 'vite.config.ts') });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  await page.goto('http://127.0.0.1:5181/' + (process.argv[2] ?? '?view=seat&time=18'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 120000 });
  const rows = await page.evaluate(() => window.__probe());
  for (const r of rows) console.log(r);
} finally {
  await browser.close();
  await server.close();
}
