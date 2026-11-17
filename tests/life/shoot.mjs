#!/usr/bin/env node
/**
 * Preview of the life module in headless Chrome, on its own Vite instance (port 5182).
 *
 *   node tests/life/shoot.mjs                 every shot
 *   node tests/life/shoot.mjs pip-hand talk   only these
 *   node tests/life/shoot.mjs --serve         keep the preview server running
 *
 * Frames land in tests/life/out/<shot>.png. The page (tests/life/preview/) simulates
 * the scene with a fixed step up to the moment the shot asks for, then renders once.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tests', 'life', 'out');
const SHOTS = {
  'pip-hand': '?shot=pip-hand',
  talk: '?shot=talk',
  arrive: '?shot=arrive',
  build: '?shot=build',
  lineup: '?shot=lineup',
  flock: '?shot=flock',
  birds: '?shot=birds',
};

const args = process.argv.slice(2);
const serve = args.includes('--serve');
const wanted = args.filter((a) => !a.startsWith('--'));
const list = wanted.length ? wanted : Object.keys(SHOTS);

const server = await createServer({
  configFile: false,
  root: path.join(ROOT, 'tests', 'life', 'preview'),
  publicDir: path.join(ROOT, 'public'),
  logLevel: 'warn',
  server: { port: 5182, strictPort: true, host: '127.0.0.1', fs: { allow: [ROOT] } },
  resolve: { dedupe: ['three'] },
  optimizeDeps: { exclude: ['@babylonjs/havok'], esbuildOptions: { target: 'esnext' } },
  esbuild: { target: 'esnext' },
});
await server.listen();
const base = 'http://127.0.0.1:5182/';
if (serve) {
  console.log(`life preview at ${base}`);
} else {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
  let failed = 0;
  for (const name of list) {
    const query = SHOTS[name] ?? `?shot=${name}`;
    try {
      await page.goto(base + query, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__lifeDone === true, null, { timeout: 180000 });
      const info = await page.evaluate(() => window.__lifeInfo ?? null);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log(`${name}: tests/life/out/${name}.png ${info ? JSON.stringify(info) : ''}`);
    } catch (error) {
      failed += 1;
      console.log(`${name}: failed ${error.message}`);
    }
  }
  await browser.close();
  await server.close();
  process.exit(failed ? 1 : 0);
}
