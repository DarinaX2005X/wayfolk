#!/usr/bin/env node
/**
 * Preview of the evening theatre in headless Chrome, on its own Vite instance (port 5184).
 *
 *   node tests/theatre/shoot.mjs                    every shot
 *   node tests/theatre/shoot.mjs sheet stage-3      only these
 *   node tests/theatre/shoot.mjs --serve            keep the preview server running
 *
 * Shots: `sheet` draws every silhouette; `stage-<beat>` plays a prepared chapter to the
 * middle of that beat and renders the stage once. Frames land in tests/theatre/out/.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tests', 'theatre', 'out');
const args = process.argv.slice(2);
const serve = args.includes('--serve');
const wanted = args.filter((a) => !a.startsWith('--'));
const list = wanted.length ? wanted : ['sheet', 'stage-1', 'stage-4', 'stage-7'];

const server = await createServer({
  configFile: false,
  root: path.join(ROOT, 'tests', 'theatre', 'preview'),
  publicDir: path.join(ROOT, 'public'),
  logLevel: 'warn',
  server: { port: 5184, strictPort: true, host: '127.0.0.1', fs: { allow: [ROOT] } },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['@babylonjs/havok'], esbuildOptions: { target: 'esnext' } },
  esbuild: { target: 'esnext' },
});
await server.listen();
const base = 'http://127.0.0.1:5184/';
if (serve) {
  console.log(`theatre preview at ${base}`);
} else {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'] });
  try {
    for (const shot of list) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on('console', (m) => {
        if (m.type() === 'error') console.log(`[${shot}] ${m.text()}`);
      });
      page.on('pageerror', (e) => console.log(`[${shot}] ${e.message}`));
      await page.goto(`${base}?shot=${shot}`);
      await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
      const file = path.join(OUT, `${shot}.png`);
      await page.screenshot({ path: file });
      console.log(`wrote ${path.relative(ROOT, file)}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
}
