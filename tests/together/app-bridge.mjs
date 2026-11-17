#!/usr/bin/env node
/**
 * The bridge through the whole app, in two headless tabs: the host opens the island in a
 * page and invites a friend; the guest opens the invite link; the guest's island drifts in
 * and docks; both hold the rope; the flocks lay the planks; the bridge is kept on both
 * sides. Frames land in tests/together/out/app-bridge-*.png.
 *
 *   node tests/together/app-bridge.mjs                 the local dev server (npm run dev:headless)
 *   node tests/together/app-bridge.mjs --base <url>    a deployment (its debug hooks open with ?debug=1)
 *
 * Exit code 0 when the bridge is finished and kept on both sides.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const args = process.argv.slice(2);
const baseAt = args.indexOf('--base');
const base = (baseAt >= 0 ? args[baseAt + 1] : 'https://localhost:8081').replace(/\/+$/, '');
fs.mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const say = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--ignore-certificate-errors'] });
let ok = false;
try {
  const open = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 760 }, ignoreHTTPSErrors: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => say(`[${who}] ${e.message}`));
    return page;
  };
  const ev = (page, expr) => page.evaluate(`(async () => { const g = window.__gw; with (g) { return (${expr}); } })()`);
  const until = async (page, expr, secs, label) => {
    const end = Date.now() + secs * 1000;
    while (Date.now() < end) {
      if (await ev(page, expr).catch(() => false)) return true;
      await sleep(400);
    }
    throw new Error(`timed out: ${label ?? expr}`);
  };

  // The host: an island in a page, then an invite.
  const host = await open('host');
  await host.goto(`${base}/?fresh=1&desk=1&debug=1&offline=1`);
  await until(host, "Boolean(window.__gw.wf && window.__gw.together) && store.look.value === 'island'", 90, 'host on the island');
  const invite = await ev(host, 'wf.invite()');
  if (!invite?.link) throw new Error('no invite link');
  say(`invite ${invite.code}`);

  // The guest opens the link (rebased onto this server) in a fresh browser.
  const link = new URL(invite.link);
  const guestUrl = `${base}${link.pathname}${link.search}${link.search ? '&' : '?'}desk=1&debug=1&offline=1`;
  const guest = await open('guest');
  await guest.goto(guestUrl);
  await until(guest, "Boolean(window.__gw.together) && modules.live.role === 'guest' && modules.live.state === 'live'", 60, 'guest joined live');
  say('guest joined');
  await until(host, 'Boolean(together && together.friend)', 40, 'host sees the friend');
  await until(guest, 'Boolean(together && together.friend)', 40, 'guest sees the friend');
  say('both see each other');

  // The guest's island drifts in and docks beside the host's.
  await until(host, 'together.neighbours.length > 0', 40, 'the island drifts in (host)');
  await until(guest, 'together.neighbours.length > 0', 40, 'the island drifts in (guest)');
  await until(host, 'Boolean(together.debug.building && together.debug.building.docked)', 60, 'docked');
  say('docked');
  await host.screenshot({ path: path.join(OUT, 'app-bridge-1-docked-host.png') });

  // Both hold the rope: the flocks lay the planks only while both hold.
  await ev(host, 'together.hold(true)');
  await ev(guest, 'together.hold(true)');
  await sleep(5000);
  await host.screenshot({ path: path.join(OUT, 'app-bridge-2-building-host.png') });
  await guest.screenshot({ path: path.join(OUT, 'app-bridge-2-building-guest.png') });
  await until(host, 'together.record.bridges.length > 0', 120, 'the bridge is kept (host)');
  await until(guest, 'together.record.bridges.length > 0', 60, 'the bridge is kept (guest)');
  await ev(host, 'together.hold(false)');
  await ev(guest, 'together.hold(false)');
  await sleep(1500);
  await host.screenshot({ path: path.join(OUT, 'app-bridge-3-done-host.png') });
  await guest.screenshot({ path: path.join(OUT, 'app-bridge-3-done-guest.png') });
  say('the bridge is finished and kept on both sides');
  ok = true;
} catch (error) {
  say(`FAIL ${error.message}`);
} finally {
  await browser.close();
}
process.exit(ok ? 0 : 1);
