#!/usr/bin/env node
/**
 * Frames of the seat view for the render-and-fix rounds of the look: opens /app on the
 * dev server at the desk (or any --base), runs a list of steps and writes PNGs into
 * tests/views/out/.
 *
 *   node tests/views/shoot.mjs tests/views/frames.json [--base https://localhost:8081] [--fov 90] [--w 1600 --h 1000]
 *
 * Steps: { "goto": "/app?debug=1" } | { "eval": "<expression over window.__gw>" } |
 *        { "until": "<expression>", "within": 30 } | { "wait": 1.5 } | { "shot": "name.png" }
 * `fov` widens the desk camera to about what a headset shows, so frames compare with the seat.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'tests/views/out');
fs.mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
const base = opt('base', 'https://localhost:8081');
const fov = Number(opt('fov', plan.fov ?? 0));
const W = Number(opt('w', plan.w ?? 1600));
const H = Number(opt('h', plan.h ?? 1000));

const browser = await chromium.launch({ headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, ignoreHTTPSErrors: true });
page.on('response', (r) => {
  if (r.status() >= 500) console.log(`[http ${r.status()}] ${r.url()}`);
});
page.on('framenavigated', (f) => {
  if (f === page.mainFrame()) console.log(`[navigated] ${f.url()}`);
});
page.on('pageerror', (e) => console.log(`[page error] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' || /vite|reload|optimiz/i.test(m.text())) console.log(`[console] ${m.text().slice(0, 300)}`);
});

const evaluate = (expr) =>
  page.evaluate(async (code) => {
    const hooks = window.__gw ?? {};
    const fn = new Function(...Object.keys(hooks), `return (${code});`);
    return await fn(...Object.values(hooks));
  }, expr);

let failed = 0;
for (const step of plan.steps) {
  try {
    if (step.goto) {
      await page.goto(base + step.goto, { waitUntil: 'load' });
      await page.waitForFunction(() => window.__gw?.app?.ready?.value === true, null, { timeout: 90000 });
      // Desk: the plate goes down when the scene is live.
      if (fov) await evaluate(`(() => { const c = app.world.camera; c.fov = ${fov}; c.updateProjectionMatrix(); return true; })()`);
      await page.waitForTimeout(1500);
    } else if (step.eval) {
      const r = await evaluate(step.eval);
      console.log(`eval ${step.eval.slice(0, 70)} -> ${JSON.stringify(r)?.slice(0, 200)}`);
    } else if (step.until) {
      const deadline = Date.now() + (step.within ?? 30) * 1000;
      let r;
      for (;;) {
        r = await evaluate(step.until).catch((e) => String(e));
        if (r === true) break;
        if (Date.now() > deadline) throw new Error(`until ${step.until} -> ${JSON.stringify(r)}`);
        await page.waitForTimeout(250);
      }
      console.log(`until ${step.until.slice(0, 70)} ok`);
    } else if (step.wait) {
      await page.waitForTimeout(step.wait * 1000);
    } else if (step.shot) {
      const out = path.join(OUT, step.shot);
      await page.screenshot({ path: out });
      console.log(`shot ${path.relative(ROOT, out)}`);
    }
  } catch (error) {
    failed++;
    console.log(`FAILED ${JSON.stringify(step).slice(0, 120)}: ${error.message.slice(0, 400)}`);
    if (step.must) break;
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
