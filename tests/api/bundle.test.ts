/**
 * The file Vercel actually runs: api/_bundle.js.
 *
 * 1. It must match its sources, otherwise the deployed functions drift from the code the
 *    tests check. Fix: `node tools/dev-api/bundle.mjs` (`npm test` runs it first).
 * 2. It must load in plain Node, outside Vite, and answer through its router. This is
 *    the failure a green build hides: Vercel compiles the functions file by file and a
 *    module that only Vite can load breaks on the first request.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type SmokeReport = { ok: boolean; functions: string[]; steps: { name: string; status: number; ok: boolean }[] };

function runSmoke(): Promise<SmokeReport> {
  const env = { ...process.env };
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.OPENROUTER_API_KEY;
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.join(ROOT, 'tools/dev-api/bundle-smoke.mjs')], { cwd: ROOT, env, timeout: 30_000 }, (error, stdout, stderr) => {
      try {
        resolve(JSON.parse(stdout) as SmokeReport);
      } catch {
        reject(new Error(`the bundle did not load in plain Node:\n${stderr || String(error)}`));
      }
    });
  });
}

describe('api/_bundle.js', () => {
  it('matches its sources', async () => {
    // The check runs as its own process: the bundler script is plain Node, not a test module.
    const fresh = await new Promise<boolean>((resolve) => {
      execFile(process.execPath, [path.join(ROOT, 'tools/dev-api/bundle.mjs'), '--check'], { cwd: ROOT, timeout: 30_000 }, (error) => resolve(!error));
    });
    expect(fresh, 'api/_bundle.js is missing or out of date. Run: node tools/dev-api/bundle.mjs').toBe(true);
  });

  it('loads in plain Node and answers through its router in the one JSON shape', async () => {
    const report = await runSmoke();
    expect(report.steps.filter((step) => !step.ok)).toEqual([]);
    expect(report.steps.find((step) => step.name === 'unknown function')?.status).toBe(404);
  });
});
