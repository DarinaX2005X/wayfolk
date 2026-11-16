#!/usr/bin/env node
/**
 * Type check of only the given paths, for packages that work in parallel:
 *
 *   npm run typecheck:mine -- src/kit/world tests/kit
 *
 * The files under the paths are checked with the project settings (src/ with
 * tsconfig.json, everything else with tsconfig.node.json), together with whatever they
 * import, but only errors located under the given paths are reported. A neighbour's
 * half-written module therefore does not fail your check, while a wrong call from your
 * code into it still does. Exit code 0 when your paths are clean.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const norm = (p) => path.resolve(ROOT, p).replaceAll('\\', '/');

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args.length === 0) {
  console.error('usage: npm run typecheck:mine -- <path> [<path> ...]');
  process.exit(2);
}
const targets = args.map(norm);
for (const t of targets) {
  if (!fs.existsSync(t)) {
    console.error(`no such path: ${path.relative(ROOT, t)}`);
    process.exit(2);
  }
}

const isSrc = (t) => t === norm('src') || t.startsWith(`${norm('src')}/`);
const groups = [
  { base: 'tsconfig.json', paths: targets.filter(isSrc) },
  { base: 'tsconfig.node.json', paths: targets.filter((t) => !isSrc(t)) },
].filter((g) => g.paths.length > 0);

const include = (t) => {
  const rel = path.relative(ROOT, t).replaceAll('\\', '/');
  return fs.statSync(t).isDirectory() ? `${rel}/**/*.ts` : rel;
};
const mine = (file) => {
  const abs = norm(file);
  return targets.some((t) => abs === t || abs.startsWith(`${t}/`));
};

let errors = 0;
for (const group of groups) {
  const temp = path.join(ROOT, `.tsconfig.mine.${process.pid}.json`);
  fs.writeFileSync(temp, JSON.stringify({ extends: `./${group.base}`, include: [...group.paths.map(include), ...(group.base === 'tsconfig.json' ? ['src/vite-env.d.ts'] : [])], exclude: ['tests/xr/out/**', 'tests/web/out/**'] }));
  try {
    const run = spawnSync(process.execPath, [TSC, '--noEmit', '--pretty', 'false', '-p', temp], { cwd: ROOT, encoding: 'utf8' });
    const lines = `${run.stdout}${run.stderr}`.split(/\r?\n/);
    let keep = false;
    for (const line of lines) {
      const at = /^(.+?)\(\d+,\d+\): error /.exec(line);
      if (at) keep = mine(at[1]);
      else if (/^\S/.test(line)) keep = false;
      if (keep && line.trim()) {
        if (at) errors += 1;
        console.log(line);
      }
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}
console.log(errors ? `\n${errors} type error${errors === 1 ? '' : 's'} in ${args.join(', ')}` : `no type errors in ${args.join(', ')}`);
process.exit(errors ? 1 : 0);
