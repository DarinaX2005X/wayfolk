#!/usr/bin/env node
/**
 * Checks the API of a running site with real requests: the deployment, or the dev
 * server. The unit tests show the handlers do the right thing with stand-ins; this shows
 * the deployed functions load, are routed by vercel.json and answer in the one JSON shape.
 *
 *   node tools/dev-api/probe.mjs https://wayfolk.example
 *   node tools/dev-api/probe.mjs https://localhost:8081
 *
 * The dev server has a local certificate that Node does not trust by default. Point Node
 * at its certificate authority instead of switching the check off:
 *   NODE_EXTRA_CA_CERTS=<path to the CA certificate> node tools/dev-api/probe.mjs https://localhost:8081
 *
 * Only reads: nothing is written to storage and no model is called, so it can run after
 * every deployment. Exit code 0 when every answer had the expected status and shape.
 */
const base = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: node tools/dev-api/probe.mjs <site address, for example https://wayfolk.example>');
  process.exit(2);
}

const checks = [
  // An address no function serves: the router answers, not the static fallback.
  { name: 'unknown api address', path: '/api/nothing-here', expect: [404], error: 'not-found' },
  // Model status: always 200; without a key `live: false`.
  { name: 'model status', path: '/api/llm', expect: [200], fields: ['live', 'provider', 'model'] },
  // Connection servers for the seating for two: always 200, at least public STUN.
  { name: 'ice servers', path: '/api/code/ice', expect: [200], fields: ['iceServers', 'relay'] },
  // A code that cannot exist.
  { name: 'missing code', path: '/api/code/X0000', expect: [404, 503] },
  // A world that does not exist.
  { name: 'missing world', path: '/api/worlds/no-such-world-00', expect: [404, 503] },
];

let failed = 0;
for (const check of checks) {
  let status = 0;
  let body = null;
  let note = '';
  try {
    const response = await fetch(base + check.path, { signal: AbortSignal.timeout(15_000) });
    status = response.status;
    const type = response.headers.get('content-type') ?? '';
    body = type.includes('application/json') ? await response.json() : null;
    if (body === null) note = `not JSON (${type || 'no content type'})`;
  } catch (err) {
    note = String(err?.message ?? err);
  }
  let ok = check.expect.includes(status) && body !== null;
  if (ok && check.error && body.error !== check.error) {
    ok = false;
    note = `error ${JSON.stringify(body.error)}, expected ${check.error}`;
  }
  if (ok && check.fields) {
    const missing = check.fields.filter((field) => !(field in body));
    if (missing.length) {
      ok = false;
      note = `missing ${missing.join(', ')}`;
    }
  }
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(22)} ${String(status).padEnd(4)} ${note}`);
}
console.log(failed ? `\n${failed} of ${checks.length} checks failed` : `\nall ${checks.length} checks passed`);
process.exit(failed ? 1 : 0);
