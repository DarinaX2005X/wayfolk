#!/usr/bin/env node
/**
 * Loads the bundled server the way Vercel will: plain Node, no Vite, no TypeScript, no
 * storage token. Then sends it a few requests through `handle` and every function the
 * bundle exports, and checks each answers with the expected status and a JSON body in
 * the one error shape `{ error }`.
 *
 *   node tools/dev-api/bundle-smoke.mjs [path to bundle]
 *
 * Prints one JSON object with every step and exits 1 when a step did not give the
 * expected answer. tests/api/bundle.test.ts runs this script in a child process.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundlePath = path.resolve(process.argv[2] ?? path.join(ROOT, 'api', '_bundle.js'));

// The functions read their configuration when the bundle is loaded: start without any.
for (const name of ['BLOB_READ_WRITE_TOKEN', 'OPENROUTER_API_KEY', 'GEMINI_API_KEY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) {
  delete process.env[name];
}
process.env.STORAGE_DRIVER ??= 'memory';

const BASE = 'https://smoke.example';
const steps = [];
let failed = false;

async function step(name, expected, run) {
  let status = 0;
  let body = null;
  try {
    const response = await run();
    status = response.status;
    body = await response.json();
  } catch (err) {
    body = { thrown: String(err) };
  }
  const ok = expected.includes(status) && body !== null && typeof body === 'object' && !('thrown' in body);
  if (!ok) failed = true;
  steps.push({ name, expected, status, ok, body });
}

const bundle = await import(pathToFileURL(bundlePath).href);
const functions = Object.keys(bundle.FUNCTIONS ?? {});

await step('unknown function', [404], () => bundle.handle(new Request(`${BASE}/api/nothing-here`)));
await step('outside /api/', [404], () => bundle.handle(new Request(`${BASE}/w/quiet-meadow-27`)));
for (const name of functions) {
  // Without keys and storage a function still answers, with a readable refusal or a
  // status that says it is off; it never throws.
  await step(`${name}: GET`, [200, 400, 404, 405, 503], () => bundle.handle(new Request(`${BASE}/api/${name}`)));
}

console.log(JSON.stringify({ ok: !failed, functions, steps }, null, 2));
process.exitCode = failed ? 1 : 0;
