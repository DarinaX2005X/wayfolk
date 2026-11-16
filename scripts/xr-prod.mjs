#!/usr/bin/env node
/**
 * Hand scenarios on the built bundle, locally: `npm run xr:prod -- <scenario.json>`.
 *
 * 1. Builds dist/ with Rollup as for the deployment (code split, minified, the API bundle
 *    first), with VITE_GW_TEST=1 so the debug hooks stay on.
 * 2. Serves dist/ through the managed dev server with GW_SERVE_DIST=1 (vite.config.ts):
 *    the files come from dist/, the page goes through the dev server's HTML transform, so
 *    the IWSDK plugin injects the emulator and the client of its command bridge, and
 *    /api/* answers from the dev API on the memory driver.
 * 3. Runs scripts/xr.mjs with the given arguments.
 *
 * Why the build keeps the DEV branches (NODE_ENV=development, --mode development). A
 * build with import.meta.env.DEV === false drops IWSDK's MCP runtime (world-initializer:
 * "In production Vite builds ... this entire code path is tree-shaken"); the page then
 * connects to the bridge but never becomes command-ready, so no `xr` command reaches it.
 * Checked on 16.11.2026 three ways: injectOnBuild in iwsdk.config.json (connects, not
 * command-ready), the same plus the HTML transform (two emulator copies, not ready), a
 * DEV build with the HTML transform (ready; this path). Everything else of the product
 * build is the same bundle; the deployment itself is checked from outside with
 * `npm run web -- --base <address>`.
 *
 * The emulator plugin activates only on localhost. A dev server that was running from
 * sources is stopped for the run and started again afterwards in the mode it had;
 * scenario runs are queued, so no other scenario runs meanwhile.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'node_modules', '@iwsdk', 'cli', 'bin', 'iwsdk.js');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const LOCK = path.join(ROOT, 'tests', 'xr', 'out', '.prod-lock');

function cli(args, env = {}) {
  const run = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
  const out = run.stdout ?? '';
  try {
    return JSON.parse(out.slice(out.indexOf('{')));
  } catch {
    return { ok: false, error: { message: (out + (run.stderr ?? '')).trim().slice(0, 500) } };
  }
}

function step(title, command, args, env = {}) {
  console.log(`\n> ${title}`);
  const run = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env }, windowsHide: true });
  if (run.status !== 0) throw new Error(`${title} failed (exit ${run.status})`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitReady(seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const status = cli(['dev', 'status']);
    if (status.ok && status.data?.state?.running) return status;
    await sleep(1000);
  }
  throw new Error(`the dev server did not come up in ${seconds} s`);
}

async function main() {
  const passThrough = process.argv.slice(2);
  if (passThrough.length === 0 || passThrough.includes('--help')) {
    console.log('usage: npm run xr:prod -- <scenario.json> [more.json ...] [xr.mjs options]');
    return passThrough.includes('--help') ? 0 : 2;
  }
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
  } catch {
    console.error(`another xr:prod run holds ${path.relative(ROOT, LOCK)}; wait for it or remove the file if no run is going`);
    return 2;
  }

  const before = cli(['dev', 'status']);
  const wasRunning = Boolean(before.ok && before.data?.state?.running);
  // The status names the window mode only when it is headed; anything else counts as headless.
  const wasHeadless = !JSON.stringify(before).includes('"headless":false');
  let code = 1;
  try {
    if (wasRunning) {
      console.log('\n> stopping the dev server that serves the sources');
      cli(['dev', 'down']);
      await sleep(1500);
    }
    step('API bundle', process.execPath, ['tools/dev-api/bundle.mjs']);
    step('bundle with debug hooks (VITE_GW_TEST=1, DEV branches kept for the bridge)', process.execPath, [VITE, 'build', '--mode', 'development'], {
      VITE_GW_TEST: '1',
      NODE_ENV: 'development',
    });
    console.log('\n> serving dist/ through the managed dev server (GW_SERVE_DIST=1)');
    const up = cli(['dev', 'up', '--headless', '--allow-browser-automation', '--timeout', '120000'], { GW_SERVE_DIST: '1', VITE_GW_TEST: '1' });
    if (!up.ok) throw new Error(`the dev server did not start on dist/: ${up.error?.message ?? 'unknown error'}`);
    await waitReady(120);

    code = await new Promise((resolve) => {
      const child = spawn(process.execPath, ['scripts/xr.mjs', ...passThrough], { cwd: ROOT, stdio: 'inherit', windowsHide: true });
      child.on('close', (status) => resolve(status ?? 1));
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    code = 2;
  } finally {
    console.log('\n> stopping the server of dist/');
    cli(['dev', 'down']);
    if (wasRunning) {
      await sleep(1500);
      console.log(`> starting the dev server from sources again (${wasHeadless ? 'headless' : 'headed'})`);
      cli(['dev', 'up', ...(wasHeadless ? ['--headless'] : []), '--allow-browser-automation', '--timeout', '120000']);
    }
    fs.rmSync(LOCK, { force: true });
  }
  return code;
}

main().then((code) => process.exit(code));
