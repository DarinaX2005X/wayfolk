#!/usr/bin/env node
/**
 * Probe of free public TURN servers that need no account (PLAN "Рассадка вдвоём").
 *
 *   node scripts/turn-probe.mjs [--json]
 *
 * For each candidate below, a Chromium page (Playwright) opens an RTCPeerConnection with
 * `iceTransportPolicy: 'relay'` and waits up to 8 s for a candidate of type `relay`: that
 * candidate exists only if the server allocated a relay for us with these credentials.
 * Prints a table "server, relay received, time, note" and, for every live server, the
 * lines TURN_URLS= and TURN_CREDENTIAL= ready for the deployment's variables.
 *
 * The same run checks the public PeerJS broker (0.peerjs.com:443) that the seating for
 * two uses: two peers open in the page, connect and pass one message.
 *
 * It creates no account and tries no paid server. Credentials below are the ones the
 * servers publish for everyone.
 */
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

/**
 * Candidates: address, name, password, where they come from. `fetchCredential` servers
 * hand out a short-lived credential to anyone (no account) and are asked first.
 */
const CANDIDATES = [
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject', source: 'Open Relay project, metered.ca (older published shared credential)' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject', source: 'Open Relay project, metered.ca' },
  { urls: 'turns:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject', source: 'Open Relay project, metered.ca' },
  { urls: 'turn:freestun.net:3478', username: 'free', credential: 'free', source: 'freestun.net, published free/free' },
  { urls: 'turn:freeturn.net:3478', username: 'free', credential: 'free', source: 'freeturn.net, published free/free' },
  { urls: 'turn:freeturn.tel:3478', username: 'free', credential: 'free', source: 'freeturn.tel, published free/free' },
  {
    urls: null,
    fetchCredential: 'https://turn.elixir-webrtc.org/?service=turn&username=groundwork-probe',
    source: 'Elixir WebRTC Rel test deployment (credential by POST, ttl about 30 min, "development and testing only")',
  },
];

const WAIT_MS = 8000;
const asJson = process.argv.includes('--json');

/** The credential a `fetchCredential` server gives out now. */
async function fetchCredential(candidate) {
  try {
    const response = await fetch(candidate.fetchCredential, { method: 'POST', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return { ...candidate, urls: '(credential service)', note: `credential service answered ${response.status}` };
    const body = await response.json();
    return { ...candidate, urls: body.uris?.join(',') ?? '', username: body.username, credential: body.password, note: `credential ttl ${body.ttl} s` };
  } catch (err) {
    return { ...candidate, urls: '(credential service)', note: `credential service unreachable: ${err?.name ?? err}` };
  }
}

/** Runs in the page: gathers relay candidates for one server. */
function gatherRelay({ server, waitMs }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const errors = [];
    let pc;
    try {
      pc = new RTCPeerConnection({ iceServers: [server], iceTransportPolicy: 'relay' });
    } catch (err) {
      resolve({ relay: false, ms: 0, note: `rejected by the browser: ${err.message}` });
      return;
    }
    const done = (relay, note) => {
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
        /* closed */
      }
      resolve({ relay, ms: Math.round(performance.now() - started), note });
    };
    const timer = setTimeout(() => done(false, errors.length ? errors.join('; ') : 'no relay candidate in time'), waitMs);
    pc.onicecandidate = (event) => {
      if (event.candidate && event.candidate.type === 'relay') done(true, `relay ${event.candidate.protocol} ${event.candidate.address ?? ''}`.trim());
      if (!event.candidate) done(false, errors.length ? errors.join('; ') : 'gathering ended without a relay candidate');
    };
    pc.onicecandidateerror = (event) => errors.push(`${event.errorCode} ${event.errorText}`.trim());
    pc.createDataChannel('probe');
    pc.createOffer().then((offer) => pc.setLocalDescription(offer));
  });
}

/** Runs in the page: two PeerJS peers on the public broker pass one message. */
function peerjsRoundTrip({ waitMs, ids }) {
  return new Promise((resolve) => {
    const started = performance.now();
    const options = { host: '0.peerjs.com', port: 443, secure: true, path: '/' };
    const peers = [];
    const finish = (ok, note) => {
      clearTimeout(timer);
      for (const peer of peers) {
        try {
          peer.destroy();
        } catch {
          /* gone */
        }
      }
      resolve({ ok, ms: Math.round(performance.now() - started), note });
    };
    const timer = setTimeout(() => finish(false, 'no message in time'), waitMs);
    const host = new window.Peer(ids[0], options);
    peers.push(host);
    host.on('error', (err) => finish(false, `host: ${err.type}`));
    host.on('connection', (conn) => conn.on('data', (data) => finish(data === 'hello from guest', `message received: ${data}`)));
    host.on('open', () => {
      const guest = new window.Peer(ids[1], options);
      peers.push(guest);
      guest.on('error', (err) => finish(false, `guest: ${err.type}`));
      guest.on('open', () => {
        const conn = guest.connect(ids[0], { reliable: true });
        conn.on('open', () => conn.send('hello from guest'));
        conn.on('error', (err) => finish(false, `channel: ${err?.type ?? err}`));
      });
    });
  });
}

async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch {
    return chromium.launch({ headless: true });
  }
}

const browser = await launch();
const results = [];
let peerjs = { ok: false, ms: 0, note: 'not run' };
try {
  const page = await browser.newPage();
  // A secure origin, so WebRTC behaves as on the deployment.
  await page.goto('https://example.com/');
  for (const raw of CANDIDATES) {
    const candidate = raw.fetchCredential ? await fetchCredential(raw) : raw;
    if (!candidate.username) {
      results.push({ server: candidate.urls, relay: false, ms: 0, note: candidate.note, source: candidate.source });
      continue;
    }
    const server = { urls: candidate.urls.split(','), username: candidate.username, credential: candidate.credential };
    const outcome = await page.evaluate(gatherRelay, { server, waitMs: WAIT_MS });
    results.push({
      server: candidate.urls,
      relay: outcome.relay,
      ms: outcome.ms,
      note: [candidate.note, outcome.note].filter(Boolean).join('; '),
      source: candidate.source,
      username: candidate.username,
      credential: candidate.credential,
      temporary: Boolean(raw.fetchCredential),
    });
  }
  const require = createRequire(import.meta.url);
  await page.addScriptTag({ path: require.resolve('peerjs/dist/peerjs.min.js') });
  const suffix = Math.random().toString(36).slice(2, 10);
  peerjs = await page.evaluate(peerjsRoundTrip, { waitMs: 15000, ids: [`gw-probe-${suffix}-a`, `gw-probe-${suffix}-b`] });
} finally {
  await browser.close();
}

if (asJson) {
  console.log(JSON.stringify({ at: new Date().toISOString(), turn: results.map(({ credential, ...rest }) => rest), peerjs }, null, 2));
} else {
  console.log(`TURN probe ${new Date().toISOString()}\n`);
  console.log(`${'server'.padEnd(48)} ${'relay'.padEnd(6)} ${'time'.padStart(7)}  note`);
  for (const r of results) console.log(`${String(r.server).padEnd(48)} ${(r.relay ? 'yes' : 'no').padEnd(6)} ${`${r.ms} ms`.padStart(7)}  ${r.note ?? ''}`);
  const live = results.filter((r) => r.relay);
  const lasting = live.filter((r) => !r.temporary);
  console.log('');
  if (lasting.length > 0) {
    const first = lasting[0];
    console.log('Live servers with a lasting credential:');
    console.log(`TURN_URLS=${lasting.filter((r) => r.username === first.username && r.credential === first.credential).map((r) => r.server).join(',')}`);
    console.log(`TURN_CREDENTIAL=${first.username}:${first.credential}`);
  } else {
    console.log('No live public TURN server with a lasting credential. The seating for two works when both devices are on the same network.');
  }
  for (const r of live.filter((x) => x.temporary)) {
    console.log(`Note: ${r.server} gave a relay with a temporary credential (${r.source}); it cannot go into a fixed variable.`);
  }
  console.log(`\nPeerJS broker 0.peerjs.com:443: ${peerjs.ok ? 'works' : 'FAILED'} (${peerjs.ms} ms, ${peerjs.note})`);
}
