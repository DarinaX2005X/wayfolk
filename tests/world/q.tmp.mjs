import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const ROOT = 'C:/Users/user/Desktop/meta/project/tests/world';
const server = await createServer({ configFile: path.join(ROOT, 'preview', 'vite.config.ts') });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:5181/' + (process.argv[2] ?? '?view=seat&time=18'), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const out = await page.evaluate(process.argv[3]);
  console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
} finally { await browser.close(); await server.close(); }
