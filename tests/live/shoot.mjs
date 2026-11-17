#!/usr/bin/env node
/**
 * Frames and the two-tab check of live visits, in headless Chromium.
 *
 *   node tests/live/shoot.mjs [gallery] [tabs] [--relay <url>]
 *
 * gallery  three visitors on the sunset stand-in → tests/live/out/gallery.png, closeup.png
 * tabs     tab A hosts a room on the relay, tab B joins with a moving head and waving fake
 *          hands, records a voice note from Chromium's fake microphone and sends it;
 *          A must see B's avatar and receive a clip that decodes → two-tab-*.png
 *
 * Its own Vite serves tests/live/preview/ on port 5184.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const args = process.argv.slice(2);
const relayAt = args.indexOf('--relay');
const relay = relayAt >= 0 ? args[relayAt + 1] : null;
const wanted = args.filter((a, i) => !a.startsWith('--') && (relayAt < 0 || i !== relayAt + 1));
const run = (name) => wanted.length === 0 || wanted.includes(name);

fs.mkdirSync(OUT, { recursive: true });
const server = await createServer({ configFile: path.join(HERE, 'preview', 'vite.config.ts') });
await server.listen();
const base = 'http://127.0.0.1:5184/';
const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'],
});
const report = {};
let failed = false;
const check = (ok, what) => {
  if (!ok) {
    failed = true;
    console.error(`FAIL ${what}`);
  } else console.log(`ok   ${what}`);
};

try {
  if (run('gallery')) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (e) => console.error('page error', e.message));
    await page.goto(`${base}?mode=gallery`);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, 'gallery.png') });
    report.gallery = await page.evaluate(() => window.__stats);
    for (const shot of ['close', 'talk']) {
      await page.goto(`${base}?mode=gallery&shot=${shot}`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(OUT, `closeup-${shot}.png`) });
    }
    await page.close();
  }

  if (run('tabs')) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, permissions: ['microphone'] });
    const host = await ctx.newPage();
    const guest = await ctx.newPage();
    for (const [name, p] of [['host', host], ['guest', guest]]) {
      p.on('pageerror', (e) => console.error(`${name} page error`, e.message));
      p.on('console', (m) => m.type() === 'error' && console.error(`${name} console`, m.text()));
    }
    const r = relay ? `&relay=${encodeURIComponent(relay)}` : '';
    await host.goto(`${base}?mode=tab&role=host${r}`);
    await host.waitForFunction(() => window.__live?.live.state === 'live', null, { timeout: 30_000 });
    const code = await host.evaluate(() => window.__live.live.code);
    check(/^[2-9A-Z]{6}$/.test(code ?? ''), `host opened room ${code}`);
    await guest.goto(`${base}?mode=tab&role=guest&code=${code}${r}`);
    await guest.waitForFunction(() => window.__live?.live.state === 'live', null, { timeout: 30_000 });
    await host.waitForFunction(() => window.__live.live.peers.length === 1, null, { timeout: 15_000 });
    await guest.waitForFunction(() => window.__live.events.includes('snapshot:preview-island'), null, { timeout: 15_000 });
    check(true, 'guest joined and received the host snapshot');
    // Let presence flow and the avatar settle.
    await host.waitForTimeout(2500);
    const seen = await host.evaluate(() => {
      const p = window.__live.live.peers[0];
      const root = window.__live.live.avatarOf(p.id);
      return { visible: Boolean(root?.visible), name: p.name };
    });
    check(seen.visible && seen.name === 'Tom', 'host sees the guest avatar');
    await host.screenshot({ path: path.join(OUT, 'two-tab-host.png') });
    await guest.screenshot({ path: path.join(OUT, 'two-tab-guest.png') });

    await guest.evaluate(() => window.__live.live.send('say', { text: 'What a view' }));
    await host.waitForFunction(() => window.__live.events.includes('say:Tom:What a view'), null, { timeout: 10_000 });
    check(true, 'event from guest reached host');

    const started = await guest.evaluate(() => window.__live.live.startTalk());
    check(started, 'guest started a talk clip');
    await guest.waitForTimeout(400);
    const ringShot = host.screenshot({ path: path.join(OUT, 'two-tab-talking.png') });
    await guest.waitForTimeout(1600);
    await ringShot;
    const sent = await guest.evaluate(() => window.__live.live.stopTalk());
    check(sent, 'guest sent the voice note');
    await host.waitForFunction(() => window.__live.voices.length === 1, null, { timeout: 15_000 });
    const voice = await host.evaluate(() => window.__live.voices[0]);
    check(voice.decodedMs > 1000 && voice.bytes > 1000, `host decoded the clip (${voice.bytes} bytes, ${voice.mime}, ${voice.decodedMs} ms)`);
    await host.waitForTimeout(600);
    await host.screenshot({ path: path.join(OUT, 'two-tab-voice.png') });
    await host.waitForTimeout(1200);
    const level = await host.evaluate(() => window.__live.maxLevel);
    check(level > 0.02, `the avatar's mouth moved with the voice (peak ${level.toFixed(2)})`);
    report.tabs = { code, voice, drawCalls: await host.evaluate(() => window.__live.drawCalls) };

    await host.evaluate(() => window.__live.live.leave());
    await guest.waitForFunction(() => window.__live.live.state === 'off', null, { timeout: 10_000 });
    const msg = await guest.evaluate(() => window.__live.live.message);
    check(msg === 'Your friend has closed their island for now.', `guest told plainly: "${msg}"`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(report));
process.exit(failed ? 1 : 0);
