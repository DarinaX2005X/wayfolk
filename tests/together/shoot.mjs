#!/usr/bin/env node
/**
 * Two people on one island, in two headless tabs over the deployed relay, and the frames
 * of what they do together (tests/together/out/).
 *
 *   node tests/together/shoot.mjs [bridge] [duet] [lanterns] [five] [--relay <url>]
 *
 * bridge    the guest's island drifts in and docks; both hold the rope (the host with a
 *           real mouse press on its coil); planks fly; the bridge is finished and kept
 * duet      the chimes by the fire: one alone, then both; the island's pulse must be far
 *           stronger with both
 * lanterns  both let a lantern go; they meet and the constellation is kept on both sides
 * five      the guest in a headset (fake hands) meets the host's raised mitten: the
 *           high five fires on both sides and the postcard is taken
 *
 * Its own Vite serves tests/together/preview/ on port 5185.
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
const base = 'http://127.0.0.1:5185/';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let failed = false;
const report = {};
const check = (ok, what) => {
  if (!ok) {
    failed = true;
    console.error(`FAIL ${what}`);
  } else console.log(`ok   ${what}`);
};
const shot = async (page, name) => {
  await page.evaluate(() => window.__tg.render());
  await page.screenshot({ path: path.join(OUT, name) });
  console.log(`     frame ${name}`);
};

async function pair(time = '18:40', extra = '') {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await ctx.newPage();
  const guest = await ctx.newPage();
  for (const [name, p] of [['host', host], ['guest', guest]]) {
    p.on('pageerror', (e) => console.error(`${name} page error`, e.message));
    p.on('console', (m) => m.type() === 'error' && console.error(`${name} console`, m.text()));
  }
  const r = relay ? `&relay=${encodeURIComponent(relay)}` : '';
  await host.goto(`${base}?role=host&time=${time}${r}${extra}`);
  await host.waitForFunction(() => window.__tg?.live.state === 'live' && window.__tg.live.code, null, { timeout: 60_000 });
  const code = await host.evaluate(() => window.__tg.live.code);
  await guest.goto(`${base}?role=guest&code=${code}&time=${time}${r}${extra}`);
  await guest.waitForFunction(() => window.__tg?.live.state === 'live', null, { timeout: 60_000 });
  await guest.waitForFunction(() => window.__tg.events.some((e) => e.startsWith('snapshot:')), null, { timeout: 30_000 });
  check(true, `host ${code} and guest are together`);
  return { ctx, host, guest };
}

try {
  if (run('bridge')) {
    const { ctx, host, guest } = await pair();
    await host.waitForFunction(() => window.__tg.events.includes('tg-hello:Tom'), null, { timeout: 20_000 });
    await guest.waitForFunction(() => window.__tg.events.includes('tg-hello:Mira'), null, { timeout: 20_000 });
    check(true, 'both said hello with their islands');
    await guest.waitForFunction(() => window.__tg.events.includes('tg-dock:Mira'), null, { timeout: 20_000 });
    check(true, "the host docked the guest's island");
    // Mid-drift, seen from the porch looking right.
    for (const p of [host, guest]) await p.evaluate(() => window.__tg.fast(7));
    await host.evaluate(() => window.__tg.lookAt(0, 1.3, 0.4, 14, 0.5, -6, 62));
    await shot(host, 'bridge-1-drift.png');
    for (const p of [host, guest]) await p.evaluate(() => window.__tg.fast(10));
    const docked = await host.evaluate(() => window.__tg.together.neighbours.map((n) => ({ docked: n.docked, complete: n.complete, planks: n.planksN })));
    check(docked.length === 1 && docked[0].docked && !docked[0].complete, `docked and waiting for a bridge (${JSON.stringify(docked)})`);
    // The host at the near bridge head, the guest at the far one, as their glides put them.
    const spots = await host.evaluate(() => {
      const n = window.__tg.together.neighbours[0];
      return { near: [n.spots.near.pos.x, n.spots.near.pos.y, n.spots.near.pos.z, n.spots.near.rotY], far: [n.spots.far.pos.x, n.spots.far.pos.y, n.spots.far.pos.z, n.spots.far.rotY], coil: n.coils.near.position.toArray() };
    });
    await host.evaluate(([x, y, z, yaw]) => window.__tg.eyeAt(x, y + 1.15, z, yaw, -0.12), spots.near);
    await guest.evaluate(([x, y, z, yaw]) => window.__tg.eyeAt(x, y + 1.15, z, yaw, -0.12), spots.far);
    await host.waitForTimeout(1500);
    await shot(host, 'bridge-2-docked.png');
    // The host presses its coil with a real mouse and keeps holding; the guest holds too.
    const pt = await host.evaluate(([x, y, z]) => window.__tg.screen(x, y + 0.6, z), spots.coil);
    await host.mouse.move(pt.x, pt.y);
    await host.mouse.down();
    await host.waitForTimeout(400);
    const heldHost = await host.evaluate(() => window.__tg.together.neighbours[0].hold.near);
    check(heldHost, 'a mouse press on the coil holds the near end');
    await host.evaluate(() => window.__tg.fast(3));
    const lonely = await host.evaluate(() => window.__tg.together.neighbours[0].laid.filter(Boolean).length);
    check(lonely === 0, 'no plank while only one end is held');
    await guest.evaluate(() => window.__tg.together.hold(true));
    await host.waitForFunction(() => window.__tg.together.neighbours[0].hold.far, null, { timeout: 10_000 });
    check(true, "the host sees the guest's hold");
    await host.evaluate(() => window.__tg.fast(5.2));
    await guest.waitForTimeout(800);
    await guest.evaluate(() => window.__tg.fast(2.5));
    await host.evaluate(() => window.__tg.lookAt(9.2, 2.1, -1.2, 15.5, -0.6, -4.6, 55));
    await shot(host, 'bridge-3-building.png');
    await shot(guest, 'bridge-3-building-guest.png');
    const mid = await host.evaluate(() => window.__tg.together.neighbours[0].laid.filter(Boolean).length);
    check(mid > 3, `planks laid while both hold (${mid})`);
    // The guest lets go: the work stops.
    await guest.evaluate(() => window.__tg.together.hold(false));
    await host.waitForFunction(() => !window.__tg.together.neighbours[0].hold.far, null, { timeout: 10_000 });
    await host.evaluate(() => window.__tg.fast(3));
    const paused = await host.evaluate(() => window.__tg.together.debug.run.launched);
    await host.evaluate(() => window.__tg.fast(2));
    const still = await host.evaluate(() => window.__tg.together.debug.run.launched);
    check(paused === still, `the bridge waits while one lets go (${paused} = ${still})`);
    await guest.evaluate(() => window.__tg.together.hold(true));
    await host.waitForFunction(() => window.__tg.together.neighbours[0].hold.far, null, { timeout: 10_000 });
    for (let i = 0; i < 12; i++) {
      await host.evaluate(() => window.__tg.fast(1));
      await guest.evaluate(() => window.__tg.fast(1));
      if (await host.evaluate(() => window.__tg.together.neighbours[0].complete)) break;
    }
    await host.mouse.up();
    await guest.waitForFunction(() => window.__tg.events.includes('tg-built:Mira'), null, { timeout: 20_000 });
    await guest.evaluate(() => window.__tg.fast(1));
    const done = await guest.evaluate(() => window.__tg.together.neighbours.map((n) => n.complete));
    check(done.length === 1 && done[0], 'the bridge is finished on both sides');
    const kept = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__tg.together.record.bridges.map((b) => `${b.island.name}:${b.slot}:${b.names.join('+')}`))));
    check(kept[0].length === 1 && kept[1].length === 1, `both keep the bridge (${kept[0]} / ${kept[1]})`);
    await host.evaluate(() => window.__tg.fast(4));
    await host.evaluate(() => window.__tg.lookAt(7.5, 3.4, 3.8, 18.5, -0.8, -3.2, 55));
    await shot(host, 'bridge-4-done.png');
    await guest.evaluate(() => window.__tg.fast(2));
    await guest.evaluate(() => window.__tg.lookAt(26.5, 2.6, 4.5, 14, 0, -6, 60));
    await shot(guest, 'bridge-5-guest-view.png');
    // Later: folk walk over (fast-forward the walking clock).
    await host.evaluate(() => window.__tg.fast(26));
    await host.evaluate(() => window.__tg.lookAt(9.5, 2.2, 1.5, 17.5, -0.2, -3.6, 52));
    await shot(host, 'bridge-6-folk.png');
    report.bridge = { mid, kept, stats: await host.evaluate(() => window.__tg.stats()) };
    await ctx.close();
  }

  if (run('duet')) {
    const { ctx, host, guest } = await pair('18:50');
    await host.waitForFunction(() => window.__tg.events.includes('tg-hello:Tom'), null, { timeout: 20_000 });
    await host.evaluate(() => window.__tg.together.duet(true));
    await guest.waitForFunction(() => window.__tg.together.duetOpen, null, { timeout: 10_000 });
    check(true, 'the chimes are out on both sides');
    // Alone: the host plays a little tune with real clicks on its tubes.
    const tubes = await host.evaluate(() => {
      const d = window.__tg.together.debug.duet;
      const out = [];
      for (let i = 0; i < 5; i++) {
        const a = new window.__tg.camera.position.constructor();
        const b = new window.__tg.camera.position.constructor();
        d.sets.low.ends(i, a, b);
        out.push(a.lerp(b, 0.5).toArray());
      }
      return out;
    });
    let soloPeak = 0;
    for (let k = 0; k < 8; k++) {
      const p = tubes[k % 5];
      const s = await host.evaluate(([x, y, z]) => window.__tg.screen(x, y, z), p);
      await host.mouse.click(s.x, s.y);
      await host.evaluate(() => window.__tg.fast(0.3));
      soloPeak = Math.max(soloPeak, await host.evaluate(() => window.__tg.together.debug.duet.pulse));
    }
    check(soloPeak > 0.05 && soloPeak <= 0.31, `one player alone lights the island a little (${soloPeak.toFixed(2)})`);
    // Both play.
    let duoPeak = 0;
    for (let k = 0; k < 10; k++) {
      await guest.evaluate((i) => window.__tg.together.debug.duet.strike('high', i % 5, 0.8, null) || window.__tg.together.debug.ctx.send('tg-chime', { i: i % 5, v: 0.8 }), k);
      const s = await host.evaluate(([x, y, z]) => window.__tg.screen(x, y, z), tubes[(k * 2) % 5]);
      await host.mouse.click(s.x, s.y);
      await host.evaluate(() => window.__tg.fast(0.3));
      duoPeak = Math.max(duoPeak, await host.evaluate(() => window.__tg.together.debug.duet.pulse));
    }
    check(duoPeak > soloPeak * 2, `both together light it far more (${duoPeak.toFixed(2)} vs ${soloPeak.toFixed(2)})`);
    await host.evaluate(() => window.__tg.fast(3));
    for (let k = 0; k < 6; k++) {
      await guest.evaluate((i) => window.__tg.together.debug.duet.strike('high', i % 5, 0.9, null) || window.__tg.together.debug.ctx.send('tg-chime', { i: i % 5, v: 0.9 }), k);
      await host.evaluate((i) => window.__tg.together.debug.duet.strike('low', (i * 3) % 5, 0.9, null) || window.__tg.together.debug.ctx.send('tg-chime', { i: (i * 3) % 5, v: 0.9 }), k);
      await host.evaluate(() => window.__tg.fast(0.25));
    }
    await host.evaluate(() => window.__tg.lookAt(0.6, 1.7, 0.8, -2.6, 0.7, -4.2, 58));
    await shot(host, 'duet-1-both.png');
    const spot = await guest.evaluate(() => {
      const s = window.__tg.together.debug.duet.spots.guest;
      return [s.pos.x, s.pos.y, s.pos.z, s.rotY];
    });
    await guest.evaluate(([x, y, z, yaw]) => window.__tg.eyeAt(x, y + 1.15, z, yaw, -0.25), spot);
    await shot(guest, 'duet-2-guest-seat.png');
    report.duet = { soloPeak, duoPeak };
    await ctx.close();
  }

  if (run('lanterns')) {
    const { ctx, host, guest } = await pair('21:40');
    await host.waitForFunction(() => window.__tg.events.includes('tg-hello:Tom'), null, { timeout: 20_000 });
    await guest.evaluate(() => window.__tg.together.lantern());
    await host.waitForFunction(() => window.__tg.events.includes('tg-lantern:Tom'), null, { timeout: 10_000 });
    await host.evaluate(() => window.__tg.fast(3));
    await host.evaluate(() => window.__tg.together.lantern());
    await host.evaluate(() => window.__tg.fast(4));
    await host.evaluate(() => window.__tg.lookAt(0, 1.2, 0.3, 4, 6, -10, 62));
    await shot(host, 'lanterns-1-rising.png');
    await guest.waitForFunction(() => window.__tg.events.includes('tg-stars:Mira'), null, { timeout: 15_000 });
    await host.evaluate(() => window.__tg.fast(9));
    await guest.evaluate(() => window.__tg.fast(9));
    await host.evaluate(() => window.__tg.fast(3));
    const star = await host.evaluate(() => window.__tg.together.record.stars.map((s) => s.dir));
    const d = star[0] ?? [0, 0.6, -0.8];
    await host.evaluate(([x, y, z]) => window.__tg.lookAt(0, 1.2, 0, x * 80, 1.2 + y * 80 - 4, z * 80, 62), d);
    await shot(host, 'lanterns-2-stars.png');
    const kept = await Promise.all([host, guest].map((p) => p.evaluate(() => window.__tg.together.record.stars.map((s) => s.names.join(' and ')))));
    check(kept[0].length === 1 && kept[1].length === 1, `the constellation is kept on both islands (${kept[0]} / ${kept[1]})`);
    report.lanterns = { kept };
    await ctx.close();
  }

  if (run('five')) {
    const { ctx, host, guest } = await pair('18:40');
    await host.waitForFunction(() => window.__tg.events.includes('tg-hello:Tom'), null, { timeout: 20_000 });
    // They stand face to face on the meadow in front of the porch.
    await host.evaluate(() => window.__tg.eyeAt(0.2, 1.3, -2.2, -Math.PI / 2 - 0.1, 0));
    await guest.evaluate(() => window.__tg.eyeAt(1.25, 1.33, -2.25, Math.PI / 2 - 0.05, 0));
    await guest.evaluate(() => {
      window.__tg.setImmersive(true);
      window.__tg.setHand('right', [1.05, 1.18, -2.45], [-1, 0, 0]);
      window.__tg.setHand('left', [1.08, 0.92, -2.0], [0, -1, 0], false, [-1, 0, 0]);
    });
    await host.waitForTimeout(2500);
    // The host (a page) clicks the guest: a mitten goes up on the guest's side.
    const g = await host.evaluate(() => {
      const p = window.__tg.live.peers[0];
      const a = window.__tg.live.avatarOf(p.id).userData.avatar;
      return window.__tg.screen(a.pose.pos[0], a.pose.pos[1], a.pose.pos[2]);
    });
    await host.mouse.click(g.x, g.y);
    await guest.waitForFunction(() => window.__tg.events.includes('tg-offer:Mira'), null, { timeout: 10_000 });
    await guest.evaluate(() => window.__tg.fast(0.5));
    const mitten = await guest.evaluate(() => window.__tg.together.debug.five.theirMitten.position.toArray());
    // The guest's right hand slaps the mitten.
    for (let k = 0; k <= 6; k++) {
      await guest.evaluate(([m, k]) => {
        const p = [1.05 + (m[0] - 1.05) * (k / 6), 1.18 + (m[1] - 1.18) * (k / 6), -2.45 + (m[2] + 2.45) * (k / 6)];
        window.__tg.setHand('right', p, [-1, 0, 0]);
        window.__tg.fast(1 / 30);
      }, [mitten, k]);
    }
    await guest.waitForFunction(() => window.__tg.together.lastPostcard !== null, null, { timeout: 5_000 }).catch(() => {});
    await host.waitForFunction(() => window.__tg.events.includes('tg-five:Tom'), null, { timeout: 10_000 });
    check(true, 'the high five reached the host');
    await host.evaluate(() => window.__tg.fast(0.6));
    await host.evaluate(() => window.__tg.lookAt(-0.6, 1.6, -0.2, 0.7, 1.3, -2.3, 58));
    await shot(host, 'five-1-spiral.png');
    await host.waitForFunction(() => window.__tg.together.lastPostcard !== null, null, { timeout: 5_000 });
    for (const [name, p] of [['host', host], ['guest', guest]]) {
      const url = await p.evaluate(() => window.__tg.together.lastPostcard);
      if (url) fs.writeFileSync(path.join(OUT, `five-2-postcard-${name}.jpg`), Buffer.from(url.split(',')[1], 'base64'));
      check(Boolean(url), `${name} took the postcard`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exit(failed ? 1 : 0);
