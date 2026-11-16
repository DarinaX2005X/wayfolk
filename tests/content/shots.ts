/**
 * Opens the three sample previews in Chromium at /samples/<id>/ and saves screenshots to
 * tests/content/out/ (desktop full page and phone width). The habit tracker is also used:
 * a habit is added and ticked, the page reloaded, and the habit must still be there.
 * The habit tracker is opened once more the way a live project is: uploaded to the
 * preview route (/api/r, sandboxed with its strict policy) and used there.
 * Console errors and failed requests of a page are printed and fail the run.
 *
 *   npx tsx tests/content/shots.ts
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';
import { createPreviewRoutes } from '../../api/_lib/preview';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'tests', 'content', 'out');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.csv': 'text/csv', '.ics': 'text/calendar', '.svg': 'image/svg+xml', '.json': 'application/json' };

const preview = createPreviewRoutes({ env: () => ({ STORAGE_DRIVER: 'memory' }) as unknown as NodeJS.ProcessEnv, files: () => null });

const server = createServer(async (req, res) => {
  if (req.url?.startsWith('/api/r')) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const r = await (req.method === 'POST' ? preview.POST : preview.GET)(new Request('http://localhost' + req.url, { method: req.method, headers: { 'content-type': 'application/json' }, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) }));
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(PUBLIC, path.normalize(p));
  if (!file.startsWith(PUBLIC) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});

async function main(): Promise<void> {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let failed = false;
  try {
    for (const id of ['bakery-site', 'habit-tracker', 'launch-plan']) {
      for (const [name, viewport] of [
        ['desktop', { width: 1280, height: 800 }],
        ['phone', { width: 390, height: 844 }],
      ] as const) {
        const ctx = await browser.newContext({ viewport });
        const page = await ctx.newPage();
        const problems: string[] = [];
        page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
        page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
        page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
        await page.goto(`http://127.0.0.1:${port}/samples/${id}/`, { waitUntil: 'networkidle' });
        await page.screenshot({ path: path.join(OUT, `${id}-${name}.png`), fullPage: true });
        if (id === 'habit-tracker' && name === 'desktop') {
          await useTracker(page, `${id}-used`);
          await page.reload({ waitUntil: 'networkidle' });
          const kept = await page.getByText('Read 20 pages').count();
          console.log(`habit-tracker: after a reload the new habit is ${kept ? 'still there' : 'GONE'}`);
          if (!kept) failed = true;
          await page.screenshot({ path: path.join(OUT, `${id}-reloaded.png`), fullPage: true });
        }
        console.log(`${id} ${name}: ${problems.length ? problems.join(' | ') : 'no errors'}`);
        if (problems.length) failed = true;
        await ctx.close();
      }
    }
    // The same app as a live project: uploaded, then opened at its short address.
    const dir = path.join(PUBLIC, 'samples', 'habit-tracker');
    const files = readdirSync(dir).map((f) => ({ path: f, text: readFileSync(path.join(dir, f), 'utf8') }));
    const up = await fetch(`http://127.0.0.1:${port}/api/r`, { method: 'POST', body: JSON.stringify({ title: 'Habit tracker', files }) });
    const { url } = (await up.json()) as { url: string };
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const problems: string[] = [];
    page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'networkidle' });
    await useTracker(page, 'habit-tracker-preview-route');
    console.log(`habit-tracker at ${url} (sandboxed preview route): ${problems.length ? problems.join(' | ') : 'no errors'}`);
    if (problems.length) failed = true;
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`Screenshots in ${path.relative(ROOT, OUT)}`);
  if (failed) process.exit(1);
}

/** Adds a habit and ticks it off today. */
async function useTracker(page: Page, shot: string): Promise<void> {
  const input = page.locator('input[type="text"], input:not([type])').first();
  await input.fill('Read 20 pages');
  await input.press('Enter');
  await page.waitForTimeout(300);
  const tick = page.locator('input[type="checkbox"], button[aria-pressed], [role="checkbox"]').first();
  if (await tick.count()) await tick.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${shot}.png`), fullPage: true });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
