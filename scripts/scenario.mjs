/**
 * What scripts/xr.mjs (hands in the emulator) and scripts/web.mjs (mouse and phone in
 * Playwright) share: reading a scenario file, inserting fragments of packages, adding
 * the pace to the route, checking an `eval` result, and turning a named-target step into
 * a mouse action. The format is described in tests/xr/README.md.
 */
import fs from 'node:fs';
import path from 'node:path';

/** A step that did not hold. Ends the scenario with exit code 1. */
export class StepFailure extends Error {}
/** The run cannot start or continue (no server, bad file). Exit code 2. */
export class SetupError extends Error {}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const short = (value) => {
  const text = JSON.stringify(value);
  return text === undefined ? 'undefined' : text.length > 200 ? `${text.slice(0, 200)}…` : text;
};

export const sameJson = (a, b) => {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every((key) => sameJson(a[key], b[key]));
};

/**
 * Inserts the steps of `{ "include": "parts/<package>/<file>.json" }` (relative to the
 * scenario root, tests/xr/ or tests/web/; `root` may list several), recursively, with the fragment's name as the
 * label prefix of its steps. A fragment that includes itself is an error.
 */
export function expandIncludes(steps, root, where, seen = []) {
  // Several roots: scripts/web.mjs looks in tests/web/ first, then in tests/xr/.
  const roots = (Array.isArray(root) ? root : [root]).map((r) => path.resolve(r));
  const out = [];
  for (const [index, step] of steps.entries()) {
    if (step && typeof step === 'object' && typeof step.include === 'string') {
      const candidates = roots.map((r) => path.resolve(r, step.include));
      const file = candidates.find((f) => fs.existsSync(f)) ?? candidates[0];
      if (!roots.some((r) => file.startsWith(r + path.sep))) throw new SetupError(`${where}: step ${index + 1}: include must stay inside ${roots.join(' or ')}`);
      if (seen.includes(file)) throw new SetupError(`${where}: ${step.include} includes itself`);
      let fragment;
      try {
        fragment = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        throw new SetupError(`${where}: step ${index + 1}: cannot read ${step.include}: ${error.message}`);
      }
      if (!Array.isArray(fragment.steps)) throw new SetupError(`${step.include}: a fragment is { "name": "...", "steps": [ ... ] }`);
      const name = typeof fragment.name === 'string' ? fragment.name : path.basename(file, '.json');
      for (const inner of expandIncludes(fragment.steps, root, step.include, [...seen, file])) {
        out.push({ ...inner, label: inner.label ? `${name}: ${inner.label}` : name, ...(step.mode && !inner.mode ? { mode: step.mode } : {}) });
      }
    } else {
      out.push(step);
    }
  }
  return out;
}

/** The route with `?pace=` added (or replaced) when the scenario sets a pace. */
export function withPace(route, pace) {
  if (pace === undefined) return route;
  const url = new URL(route, 'http://x.local');
  url.searchParams.set('pace', String(pace));
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Whether an eval result passes: `equals` (JSON equality), `near` with `tol`,
 * `atMost`, `atLeast`. Returns null when it passes, else what was expected.
 */
export function evalVerdict(step, got) {
  const wanted = [];
  if (step.equals !== undefined && !sameJson(got, step.equals)) wanted.push(short(step.equals));
  if (step.near !== undefined && !(typeof got === 'number' && Math.abs(got - step.near) <= (step.tol ?? 0))) {
    wanted.push(`${step.near} ± ${step.tol ?? 0}`);
  }
  if (step.atMost !== undefined && !(typeof got === 'number' && got <= step.atMost)) wanted.push(`at most ${step.atMost}`);
  if (step.atLeast !== undefined && !(typeof got === 'number' && got >= step.atLeast)) wanted.push(`at least ${step.atLeast}`);
  return wanted.length ? wanted.join(' and ') : null;
}

export const hasCheck = (step) => ['equals', 'near', 'atMost', 'atLeast'].some((key) => step[key] !== undefined);

const targetName = (inner) => (typeof inner.target === 'string' ? inner.target : inner.target?.name);

/**
 * A hand step in mouse terms. A step with its own `mouse` block uses it. Otherwise:
 * `press` on a target is a click on it; a pinch on a target followed by a move to another
 * target or position and the release is a drag; a pinch and release on the same target
 * is a click. Returns null when the hand step has no mouse meaning (then the step needs
 * a `mouse` block).
 */
export function mouseActionsOf(run) {
  const actions = [];
  let held = null;
  for (const inner of run.steps ?? []) {
    const name = targetName(inner);
    if (inner.press !== undefined && name) {
      actions.push({ action: 'click', target: name });
      continue;
    }
    const pinch = typeof inner.pinch === 'number' ? inner.pinch : inner.pinch?.value;
    if (pinch !== undefined && pinch >= 0.9) {
      if (!name) return null;
      held = { from: name, to: null };
      continue;
    }
    if (held && (name || inner.position)) {
      held.to = name ?? (Array.isArray(inner.position) ? inner.position : [inner.position.x, inner.position.y, inner.position.z]);
    }
    if (pinch !== undefined && pinch <= 0.7 && held) {
      actions.push(held.to === null || held.to === held.from ? { action: 'click', target: held.from } : { action: 'drag', target: held.from, to: held.to, seconds: inner.duration ?? 0.5 });
      held = null;
    }
  }
  if (held) return null;
  return actions;
}
