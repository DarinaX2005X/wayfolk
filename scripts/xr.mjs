#!/usr/bin/env node
/**
 * Hand scenarios: drives the running app in the IWSDK emulator from a JSON file and
 * checks the application state after each step. See --help and tests/xr/README.md.
 *
 * Every step goes through the IWSDK command line (`iwsdk xr ...`, `iwsdk browser ...`),
 * the same surface a person or an agent uses by hand, so a scenario proves what a
 * manual session would.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SetupError,
  StepFailure,
  evalVerdict,
  expandIncludes,
  hasCheck,
  mouseActionsOf,
  short,
  sleep,
  withPace,
} from './scenario.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'node_modules', '@iwsdk', 'cli', 'bin', 'iwsdk.js');
const CONFIG = path.join(ROOT, 'iwsdk.config.json');
const SCENARIOS = path.join(ROOT, 'tests', 'xr');
const PAGE_SCRIPT = 'scripts/xr-page.mjs';

const DEVICES = { metaQuest3: 'Meta Quest 3', metaVRGlasses: 'Meta VR Glasses' };
const MODES = ['hand', 'hand-ray', 'controller', 'gaze', 'mouse'];
const STEP_KINDS = ['run', 'pull', 'mouse', 'lose', 'head', 'expect', 'eval', 'visibility', 'clock', 'reload', 'shot', 'wait'];

const HELP = `Hand scenarios for Groundwork

  npm run xr -- <scenario.json> [more.json ...]   run the given scenarios
  npm run xr:all                                  run every scenario under tests/xr/
  npm run xr:prod -- <scenario.json>              the same on the production build (dist/)
  node scripts/xr.mjs --help                      this text

The dev server must be running with browser automation:  npm run dev:headless
One run at a time: a second run waits for the first to finish.

Options
  --all            every *.json under tests/xr/ (except out/ and parts/)
  --bail           with several scenarios, stop after the first that fails
  --keep-open      leave the XR session running after the last step
  --out <dir>      where frames go (default tests/xr/out)
  --device <name>  run every given scenario on this device (metaQuest3 | metaVRGlasses)

Scenario file
  {
    "name":   "smoke",
    "route":  "/app?run=harbor-street&answers=scripted",   page to open, always a fresh load
    "pace":   0.25,                               added to the route as ?pace=
    "xr":     true,                               enter an immersive session first
    "device": "metaQuest3" | "metaVRGlasses",     emulator device (default metaQuest3)
    "environment": "home_office",                 emulator room (default: as configured)
    "mode":   "hand" | "hand-ray" | "controller" | "gaze" | "mouse",
    "steps":  [ ... ]
  }

  mode "hand"        hands reach the object; "run" goes to "xr run-sequence" with
                     body "fixed": the seated body never leans or steps ("auto" is an error)
  mode "hand-ray"    hands stay where they are: each target is aimed at with the hand
                     ray (xr look-at) and taken with a pinch; the body never moves
  mode "controller"  the same with a controller ray and its trigger
  mode "gaze"        device metaVRGlasses: the gaze ray aims, a hand pinch selects
  mode "mouse"       "xr": false; real pointer input on the canvas

Steps, executed in order; the run stops at the first one that fails. Any step may carry
"label", and "mode" to use another input mode for that step only.
  { "include": "parts/<package>/<file>.json" }          the steps of a package fragment
  { "run": { "device": "hand-right", "steps": [ ... ] } }
        Parameters of "iwsdk xr run-sequence". In the ray modes each inner step is
        translated: "target" or "position" aims the ray, "press" is a short select,
        "pinch" 1 holds, "pinch" 0 lets go. In mode "mouse" a press is a click and a
        pinch, move and release is a drag, unless the step carries a "mouse" block.
  { "pull": { "target": "thread:<key>", "by": 0.15, "seconds": 0.6 } }
        hand-ray: aim at the target, pinch, move the wrist "by" metres toward the seat
        along the ray, let go. A ray step only turns the hand; this one moves it.
  { "lose": { "hand": "right", "seconds": 0.8 } }       the emulator loses that hand
  { "head": { "position": [x, y, z], "yaw": 145 } }     move the seated head, then app.recenter()
  { "mouse": { "target": "name", "action": "click" | "drag", "to": [x, y, z] | "name" } }
  { "expect": { "target": "name", "near": [x, y, z], "tol": 0.01 } }
  { "eval": "store.mode.value", "equals": "room" }
  { "eval": "clock.now()", "atMost": 20000, "atLeast": 0 }
  { "eval": "perf.info().calls", "near": 60, "tol": 30 }
        A JavaScript expression with the keys of window.__gw in scope (store, app,
        probe, test, clock, perf, ...). Without a check it is only executed.
  { "visibility": "blurred" | "hidden" | "visible" }   window.__gw.test.setVisibility
  { "clock": "2027-03-01" }                             window.__gw.clock.set
  { "reload": true }                                    reload the page (and re-enter XR)
  { "shot": "smoke-quest.png" }                         frame into tests/xr/out/
  { "wait": 0.5 }                                       seconds

  "expect" and "eval" retry for up to "within" seconds (default 3) before they fail.
  Positions are metres in the XR origin frame: -Z forward, +Y up.

Exit code: 0 all passed, 1 a step failed (the step is printed), 2 nothing could run.
`;

const rel = (file) => path.relative(ROOT, file).replaceAll('\\', '/');

// ---------------------------------------------------------------- the IWSDK command line

/**
 * Runs one IWSDK command and returns its JSON envelope `{ ok, data }` or
 * `{ ok: false, error }`. Never throws for a failed command.
 */
function iwsdk(args, { input, env, timeoutMs = 60_000 } = {}) {
  const full = [CLI, ...args];
  if (input !== undefined) full.push('--input-json', JSON.stringify(input));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, full, {
      cwd: ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: { code: 'timeout', message: `iwsdk ${args.join(' ')} gave no answer in ${timeoutMs} ms` } });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: { code: 'spawn', message: String(error.message) } });
    });
    child.on('close', () => {
      clearTimeout(timer);
      const start = out.indexOf('{');
      try {
        resolve(JSON.parse(out.slice(start)));
      } catch {
        resolve({ ok: false, error: { code: 'not_json', message: (out + err).trim().slice(0, 600) || 'no output' } });
      }
    });
  });
}

const messageOf = (answer) => answer?.error?.message ?? 'unknown error';

async function command(args, options) {
  const answer = await iwsdk(args, options);
  if (!answer.ok) throw new StepFailure(`iwsdk ${args.join(' ')}: ${messageOf(answer)}`);
  return answer.data?.result ?? answer.data;
}

/** Repeats `probe` until it returns a value other than undefined, or time runs out. */
async function until(probe, { seconds, every = 0.25 }) {
  const deadline = Date.now() + seconds * 1000;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) return undefined;
    await sleep(every * 1000);
  }
}

// ---------------------------------------------------------------- page side

async function pageOp(op, timeoutMs = 45_000) {
  const answer = await iwsdk(['browser', 'run', PAGE_SCRIPT, '--timeout', String(timeoutMs)], {
    env: { GW_XR_OP: JSON.stringify(op) },
    timeoutMs: timeoutMs + 15_000,
  });
  if (!answer.ok) {
    const message = messageOf(answer);
    if (/automation is disabled/i.test(message)) {
      throw new SetupError('The dev server runs without browser automation. Restart it:\n  npx iwsdk dev down\n  npm run dev:headless');
    }
    return { ok: false, error: message };
  }
  return answer.data?.result ?? { ok: false, error: 'the page script returned nothing' };
}

/** Evaluates an expression over window.__gw. Throws StepFailure when it cannot run. */
async function pageEval(expression) {
  const result = await pageOp({ op: 'eval', expression });
  if (!result.ok) throw new StepFailure(`${expression}: ${result.error}`);
  return result.isUndefined ? undefined : result.value;
}

// ---------------------------------------------------------------- server and emulator

async function requireServer() {
  if (!fs.existsSync(CLI)) throw new SetupError('IWSDK CLI is not installed. Run "npm install".');
  const answer = await iwsdk(['dev', 'status']);
  const data = answer.data;
  if (!answer.ok || !data?.state?.running) {
    throw new SetupError('The dev server is not running. Start it:\n  npm run dev:headless');
  }
  if (data.state.session?.browserAutomation?.enabled !== true) {
    throw new SetupError('The dev server runs without browser automation. Restart it:\n  npx iwsdk dev down\n  npm run dev:headless');
  }
  const url = data.runtimeUrls?.local;
  if (!url) throw new SetupError('The dev server reports no local address (npx iwsdk dev status).');
  return { url };
}

async function serverReady(deviceName, seconds) {
  const ok = await until(
    async () => {
      const status = await iwsdk(['dev', 'status']);
      if (!status.ok || !status.data?.state?.browserCommandReady) return undefined;
      const xr = await iwsdk(['xr', 'status']);
      if (!xr.ok) return undefined;
      if (deviceName && xr.data?.result?.deviceName !== deviceName) return undefined;
      return true;
    },
    { seconds, every: 1 },
  );
  if (!ok) throw new SetupError(`The managed browser did not become ready${deviceName ? ` as ${deviceName}` : ''} in ${seconds} s.`);
}

/** The emulator device and room live in iwsdk.config.json; changing them restarts Vite in place. */
const emulator = {
  original: null,
  read() {
    return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  },
  async use(device, environment) {
    const config = this.read();
    const now = config.dev?.emulator ?? {};
    if (now.device === device && (!environment || now.environment === environment)) return;
    this.original ??= fs.readFileSync(CONFIG, 'utf8');
    config.dev = { ...config.dev, emulator: { ...now, device, ...(environment ? { environment } : {}) } };
    fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`);
    console.log(`  emulator: ${device}${environment ? `, ${environment}` : ''} (iwsdk.config.json changed for this run)`);
    // Vite restarts in place; the device is checked once the scenario page has booted its world.
    await sleep(3000);
    await until(async () => ((await iwsdk(['dev', 'status'])).data?.state?.running ? true : undefined), { seconds: 60, every: 1 });
  },
  restoreSync() {
    if (this.original === null) return false;
    fs.writeFileSync(CONFIG, this.original);
    this.original = null;
    return true;
  },
};

async function xrStatus() {
  const answer = await iwsdk(['xr', 'status']);
  return answer.ok ? answer.data.result : null;
}

async function leaveXR() {
  const status = await xrStatus();
  if (!status?.sessionActive) return;
  await iwsdk(['xr', 'exit']);
  await until(async () => ((await xrStatus())?.sessionActive ? undefined : true), { seconds: 10 });
}

async function setInput(mode) {
  await command(['xr', 'set-input-mode'], { input: { mode: mode === 'controller' ? 'controller' : 'hand' } });
}

async function enterXR(scenario) {
  await leaveXR();
  const offered = await until(async () => ((await xrStatus())?.sessionOffered ? true : undefined), { seconds: 30 });
  if (!offered) {
    throw new StepFailure(`the page ${scenario.route} offered no XR session in 30 s: it has to boot the world on load`);
  }
  await command(['xr', 'enter']);
  const status = await until(
    async () => {
      const s = await xrStatus();
      return s?.sessionActive ? s : undefined;
    },
    { seconds: 15 },
  );
  if (!status) throw new StepFailure('the XR session did not start in 15 s (npx iwsdk browser logs shows why)');
  await setInput(scenario.mode);
  if (scenario.mode === 'gaze') await requireGaze();
  // A few frames for the app to take the seated frame and for the hands to appear.
  await sleep(400);
  return status;
}

async function requireGaze() {
  const state = await command(['xr', 'get-device-state']);
  if (!state?.gaze?.connected) throw new StepFailure('mode "gaze": the emulator has no connected gaze source (device must be metaVRGlasses)');
}

async function openRoute(server, route) {
  const url = new URL(route, server.url).href;
  await pageOp({ op: 'goto', url });
  const ready = await until(
    async () => {
      const result = await pageOp({ op: 'state' }).catch((error) => {
        if (error instanceof SetupError) throw error;
        return null;
      });
      const state = result?.ok ? result.value : null;
      if (!state || state.readyState !== 'complete') return undefined;
      if (new URL(state.href).href !== url) return undefined;
      return state.hooks?.includes('store') ? state : undefined;
    },
    { seconds: 40, every: 0.5 },
  );
  if (!ready) throw new StepFailure(`the page ${route} did not load in 40 s (npx iwsdk browser logs shows why)`);
  return ready;
}

// ---------------------------------------------------------------- geometry for the ray modes

const toPoint = (value, what) => {
  if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) return { x: value[0], y: value[1], z: value[2] };
  if (value && [value.x, value.y, value.z].every(Number.isFinite) && value.relativeTo === undefined) return { x: value.x, y: value.y, z: value.z };
  throw new StepFailure(`${what} must be [x, y, z] in XR origin metres, got ${JSON.stringify(value)}`);
};

/** Orientation that points a device's -Z axis from `from` at `to`, Y kept up. */
function lookQuaternion(from, to) {
  let zx = from.x - to.x;
  let zy = from.y - to.y;
  let zz = from.z - to.z;
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl;
  zy /= zl;
  zz /= zl;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  let xl = Math.hypot(xx, xy, xz);
  if (xl < 1e-6) {
    xx = 0;
    xy = -zz;
    xz = zy;
    xl = Math.hypot(xx, xy, xz) || 1;
  }
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const trace = xx + yy + zz;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return { w: 0.25 / s, x: (yz - zy) * s, y: (zx - xz) * s, z: (xy - yx) * s };
  }
  if (xx > yy && xx > zz) {
    const s = 2 * Math.sqrt(1 + xx - yy - zz);
    return { w: (yz - zy) / s, x: 0.25 * s, y: (yx + xy) / s, z: (zx + xz) / s };
  }
  if (yy > zz) {
    const s = 2 * Math.sqrt(1 + yy - xx - zz);
    return { w: (zx - xz) / s, x: (yx + xy) / s, y: 0.25 * s, z: (zy + yz) / s };
  }
  const s = 2 * Math.sqrt(1 + zz - xx - yy);
  return { w: (xy - yx) / s, x: (zx + xz) / s, y: (zy + yz) / s, z: 0.25 * s };
}

async function locate(name) {
  const found = await pageEval(`probe.locate(${JSON.stringify(name)})`).catch(() => null);
  if (found) return found;
  const listed = await command(['xr', 'list-targets']).catch(() => null);
  const target = listed?.targets?.find((t) => t.name === name);
  if (!target) return null;
  const p = target.position;
  return { center: [p.x, p.y, p.z], origin: [p.x, p.y, p.z], size: [target.size.x, target.size.y, target.size.z], visible: true };
}

async function aimPoint(inner) {
  let point = null;
  if (inner.target !== undefined) {
    const name = typeof inner.target === 'string' ? inner.target : inner.target?.name;
    const found = await locate(name);
    if (!found) throw new StepFailure(`no object named "${name}" in the scene (npx iwsdk xr list-targets)`);
    point = { x: found.center[0], y: found.center[1], z: found.center[2] };
  } else if (inner.position !== undefined) {
    if (inner.position?.relativeTo !== undefined) throw new StepFailure('a position relative to the head or body works in mode "hand" only; give [x, y, z]');
    point = toPoint(inner.position, '"position"');
  }
  if (point && inner.offset !== undefined && inner.offset?.normal === undefined) {
    const offset = toPoint(inner.offset, '"offset"');
    point = { x: point.x + offset.x, y: point.y + offset.y, z: point.z + offset.z };
  }
  return point;
}

const deviceSide = (device) => (String(device ?? 'hand-right').endsWith('left') ? 'left' : 'right');

/** One "run" step in a ray mode: aim with the ray, select with a pinch or the trigger. The body never moves. */
async function runRay(run, mode) {
  const side = deviceSide(run.device);
  const selector = mode === 'controller' ? `controller-${side}` : `hand-${side}`;
  const pointer = mode === 'gaze' ? 'gaze' : selector;
  let holding = false;
  for (const inner of run.steps ?? []) {
    if (inner.body !== undefined) throw new StepFailure(`mode "${mode}" never moves the body: remove "body" from the inner step`);
    const point = await aimPoint(inner);
    if (point) {
      if (holding) {
        // Moving while holding has to be seen by the app as a path, not as a jump.
        const at = await command(['xr', 'get-transform'], { input: { device: pointer } });
        const seconds = typeof inner.duration === 'number' ? inner.duration : 0.4;
        await command(['xr', 'animate-to'], {
          input: { device: pointer, orientation: lookQuaternion(at.position, point), duration: seconds, easing: 'minimum-jerk' },
          timeoutMs: 60_000 + seconds * 1000,
        });
      } else {
        await command(['xr', 'look-at'], { input: { device: pointer, target: point } });
        await sleep(120);
      }
    }
    if (inner.press !== undefined) {
      await command(['xr', 'select'], { input: { device: selector, duration: inner.press?.hold ?? 0.15 } });
    }
    if (inner.pinch !== undefined) {
      const value = typeof inner.pinch === 'number' ? inner.pinch : inner.pinch?.value;
      if (!Number.isFinite(value)) throw new StepFailure(`"pinch" must be a number or { "value": n }, got ${JSON.stringify(inner.pinch)}`);
      holding = value >= 0.9;
      await command(['xr', 'set-select-value'], { input: { device: selector, value: holding ? 1 : value <= 0.7 ? 0 : value } });
      await sleep(120);
    }
    if (!point && inner.press === undefined && inner.pinch === undefined && typeof inner.duration === 'number') {
      await sleep(inner.duration * 1000);
    }
  }
  if (holding) {
    await command(['xr', 'set-select-value'], { input: { device: selector, value: 0 } });
    throw new StepFailure('the step ended while still holding: add { "pinch": 0 } as its last inner step');
  }
}

/** Pointer input at canvas places, through the page (mode "mouse"). */
async function mouseAction({ target, at, action = 'click', to, seconds }) {
  const where = target ?? at;
  if (where === undefined) throw new StepFailure('a mouse step needs "target" or "at"');
  if (target === undefined) toPoint(at, '"at"');
  const from = await pageEval(`probe.screen(${JSON.stringify(where)})`);
  if (!from) throw new StepFailure(`no object named ${JSON.stringify(where)} in the scene`);
  const points = [from];
  if (action === 'drag') {
    if (to === undefined) throw new StepFailure('a drag needs "to": a target name or [x, y, z]');
    if (typeof to !== 'string') toPoint(to, '"to"');
    const end = await pageEval(`probe.screen(${JSON.stringify(to)})`);
    if (!end) throw new StepFailure(`no object named ${JSON.stringify(to)} in the scene`);
    points.push(end);
  }
  const result = await pageOp({ op: 'mouse', action, points, seconds });
  if (!result.ok) throw new StepFailure(result.error);
}

// ---------------------------------------------------------------- steps

const kindOf = (step) => STEP_KINDS.find((kind) => step[kind] !== undefined);

async function runStep(step, ctx) {
  const { scenario } = ctx;
  const mode = step.mode ?? scenario.mode;
  if (step.mode && step.mode !== ctx.inputMode) {
    if (!scenario.xr || step.mode === 'mouse') throw new StepFailure(`a step can switch between hand, hand-ray, controller and gaze inside a session only`);
    await setInput(step.mode);
    if (step.mode === 'gaze') await requireGaze();
    ctx.inputMode = step.mode;
  } else if (!step.mode && ctx.inputMode !== scenario.mode && scenario.xr) {
    await setInput(scenario.mode);
    ctx.inputMode = scenario.mode;
  }
  const within = Number.isFinite(step.within) ? step.within : 3;

  switch (kindOf(step)) {
    case 'run': {
      if (mode === 'mouse') {
        const actions = step.mouse ? [step.mouse] : mouseActionsOf(step.run);
        if (!actions) throw new StepFailure('this hand step has no mouse meaning: give the step a "mouse" block');
        for (const action of actions) await mouseAction(action);
        return `${actions.length} mouse action${actions.length === 1 ? '' : 's'}`;
      }
      if (mode !== 'hand') {
        await runRay(step.run, mode);
        return '';
      }
      if (step.run.body !== undefined && step.run.body !== 'fixed') {
        throw new StepFailure(`body "${step.run.body}" is a scenario error: the person is seated, so every hand step runs with body "fixed"`);
      }
      const input = { ...step.run, body: 'fixed' };
      const planned = (input.steps ?? []).reduce((sum, s) => sum + (typeof s.duration === 'number' ? s.duration : 3), 0);
      const timeoutMs = 30_000 + planned * 1000;
      const result = await command(['xr', 'run-sequence', '--timeout', String(timeoutMs)], { input, timeoutMs: timeoutMs + 15_000 });
      if (result?.cancelled) throw new StepFailure('the sequence was cancelled');
      const warnings = result?.warnings ?? [];
      return warnings.length ? `warnings: ${warnings.map((w) => (typeof w === 'string' ? w : short(w))).join('; ')}` : '';
    }

    case 'pull': {
      if (mode === 'mouse') {
        if (!step.mouse) throw new StepFailure('a pull in mode "mouse" needs a "mouse" block (a drag toward the camera)');
        await mouseAction(step.mouse);
        return 'mouse';
      }
      if (mode !== 'hand-ray' && mode !== 'gaze') throw new StepFailure(`"pull" runs in mode "hand-ray" (or "gaze"), not "${mode}"`);
      const { target, by = 0.15, seconds = 0.6, hand = 'right' } = step.pull;
      if (!(by > 0 && by < 0.6)) throw new StepFailure(`"by" must be metres between 0 and 0.6, got ${short(by)}`);
      const device = `hand-${hand}`;
      const point = await aimPoint({ target });
      await command(['xr', 'look-at'], { input: { device: mode === 'gaze' ? 'gaze' : device, target: point } });
      await sleep(150);
      const start = await command(['xr', 'get-transform'], { input: { device } });
      const p = start.position;
      // Toward the seat along the ray: from the target back through the hand.
      let dx = p.x - point.x;
      let dy = p.y - point.y;
      let dz = p.z - point.z;
      const length = Math.hypot(dx, dy, dz) || 1;
      dx /= length;
      dy /= length;
      dz /= length;
      await command(['xr', 'set-select-value'], { input: { device, value: 1 } });
      await sleep(120);
      try {
        await command(['xr', 'animate-to'], {
          input: { device, position: { x: p.x + dx * by, y: p.y + dy * by, z: p.z + dz * by }, duration: seconds, easing: 'minimum-jerk' },
          timeoutMs: 60_000 + seconds * 1000,
        });
        await sleep(100);
      } finally {
        await command(['xr', 'set-select-value'], { input: { device, value: 0 } });
      }
      return `${by} m in ${seconds} s`;
    }

    case 'lose': {
      const { hand = 'right', seconds = 0.8 } = step.lose;
      const has = await pageEval('typeof test !== "undefined" && typeof test.loseHand === "function"').catch(() => false);
      if (!has) throw new StepFailure('window.__gw.test.loseHand is not registered (src/interact/ provides it)');
      await pageEval(`test.loseHand(${JSON.stringify(hand)}, ${Number(seconds)})`);
      await sleep(seconds * 1000);
      return '';
    }

    case 'head': {
      if (!scenario.xr) throw new StepFailure('"head" moves the emulated headset: it needs "xr": true');
      const { position, yaw = 0, pitch = 0, recenter = true } = step.head;
      const at = toPoint(position, '"head.position"');
      await command(['xr', 'set-transform'], { input: { device: 'headset', position: at, orientation: { pitch, yaw, roll: 0 } } });
      await sleep(300);
      if (recenter) await pageEval('(app.recenter(), true)');
      await sleep(200);
      return `at [${[at.x, at.y, at.z].join(', ')}], yaw ${yaw}°`;
    }

    case 'mouse': {
      if (scenario.xr && mode !== 'mouse') throw new StepFailure('"mouse" needs "xr": false');
      await mouseAction(step.mouse);
      return '';
    }

    case 'expect': {
      const { target, near, tol = 0.01 } = step.expect;
      const want = toPoint(near, '"near"');
      let last = null;
      const ok = await until(
        async () => {
          last = await locate(target);
          if (!last) return undefined;
          const d = Math.hypot(last.center[0] - want.x, last.center[1] - want.y, last.center[2] - want.z);
          last.distance = d;
          return d <= tol ? true : undefined;
        },
        { seconds: within },
      );
      if (!ok) {
        throw new StepFailure(
          last
            ? `"${target}" is at [${last.center.map((v) => v.toFixed(4)).join(', ')}], ${last.distance.toFixed(4)} m from the expected point (tol ${tol})`
            : `no object named "${target}" in the scene`,
        );
      }
      return `${last.distance.toFixed(4)} m off`;
    }

    case 'eval': {
      const checks = hasCheck(step);
      let got;
      let error = null;
      let verdict = null;
      const ok = await until(
        async () => {
          try {
            got = await pageEval(step.eval);
            error = null;
          } catch (e) {
            if (!(e instanceof StepFailure)) throw e;
            error = e;
            return undefined;
          }
          if (!checks) return true;
          verdict = evalVerdict(step, got);
          return verdict === null ? true : undefined;
        },
        { seconds: checks ? within : 0 },
      );
      if (!ok) {
        if (error) throw error;
        throw new StepFailure(`${step.eval} is ${short(got)}, expected ${verdict}`);
      }
      return checks ? `= ${short(got)}` : '';
    }

    case 'visibility': {
      if (!['blurred', 'hidden', 'visible'].includes(step.visibility)) {
        throw new StepFailure(`"visibility" must be blurred, hidden or visible, got ${short(step.visibility)}`);
      }
      const has = await pageEval('typeof test !== "undefined" && typeof test.setVisibility === "function"').catch(() => false);
      if (!has) throw new StepFailure('window.__gw.test.setVisibility is not registered (src/app/core/ provides it)');
      await pageEval(`test.setVisibility(${JSON.stringify(step.visibility)})`);
      return '';
    }

    case 'clock': {
      const has = await pageEval('typeof clock !== "undefined" && typeof clock.set === "function"').catch(() => false);
      if (!has) throw new StepFailure('window.__gw.clock.set is not registered (src/app/core/ provides it)');
      await pageEval(`clock.set(${JSON.stringify(step.clock)})`);
      return '';
    }

    case 'reload': {
      await openRoute(ctx.server, ctx.route);
      if (scenario.xr) {
        await enterXR(scenario);
        ctx.inputMode = scenario.mode;
      }
      return '';
    }

    case 'shot': {
      const file = path.resolve(ctx.out, String(step.shot));
      if (path.relative(ctx.out, file).startsWith('..') || !/\.(png|jpe?g)$/i.test(file)) {
        throw new StepFailure(`"shot" must be a .png or .jpg file name inside ${rel(ctx.out)}, got ${short(step.shot)}`);
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.rmSync(file, { force: true });
      await sleep(250);
      const jpeg = /\.jpe?g$/i.test(file);
      const result = await command(['browser', 'screenshot', '--output-file', file], { input: jpeg ? { format: 'jpeg', quality: 92 } : {} });
      if (!fs.existsSync(file) || fs.statSync(file).size === 0) throw new StepFailure(`the frame was not written to ${rel(file)}`);
      return `${rel(file)} ${result?.width ?? '?'}x${result?.height ?? '?'}`;
    }

    case 'wait': {
      if (!Number.isFinite(step.wait) || step.wait < 0) throw new StepFailure(`"wait" must be seconds, got ${short(step.wait)}`);
      await sleep(step.wait * 1000);
      return '';
    }

    default:
      throw new StepFailure(`unknown step ${short(step)}`);
  }
}

// ---------------------------------------------------------------- scenarios

export function loadScenario(file, overrides = {}) {
  const where = rel(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new SetupError(`${where}: ${error.message}`);
  }
  const problems = [];
  const scenario = {
    file,
    name: typeof data.name === 'string' ? data.name : path.basename(file, '.json'),
    route: data.route,
    pace: data.pace,
    xr: data.xr === true,
    device: overrides.device ?? data.device ?? 'metaQuest3',
    environment: data.environment,
    mode: data.mode ?? (data.xr === true ? 'hand' : 'mouse'),
    steps: Array.isArray(data.steps) ? expandIncludes(data.steps, SCENARIOS, where) : data.steps,
  };
  if (typeof scenario.route !== 'string' || !scenario.route.startsWith('/')) problems.push('"route" must be a path like "/app"');
  if (scenario.pace !== undefined && !(Number.isFinite(scenario.pace) && scenario.pace >= 0)) problems.push('"pace" must be a number, 0 or more');
  if (data.xr !== undefined && typeof data.xr !== 'boolean') problems.push('"xr" must be true or false');
  if (!(scenario.device in DEVICES)) problems.push(`"device" must be one of ${Object.keys(DEVICES).join(', ')}`);
  if (!MODES.includes(scenario.mode)) problems.push(`"mode" must be one of ${MODES.join(', ')}`);
  if (scenario.mode === 'mouse' && scenario.xr) problems.push('mode "mouse" needs "xr": false');
  if (scenario.mode !== 'mouse' && MODES.includes(scenario.mode) && !scenario.xr) problems.push(`mode "${scenario.mode}" needs "xr": true`);
  if (scenario.mode === 'gaze' && scenario.device !== 'metaVRGlasses') problems.push('mode "gaze" needs "device": "metaVRGlasses"');
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    problems.push('"steps" must be a list with at least one step');
  } else {
    scenario.steps.forEach((step, index) => {
      const kinds = STEP_KINDS.filter((kind) => step?.[kind] !== undefined && !(kind === 'mouse' && (step.run !== undefined || step.pull !== undefined)));
      const at = `step ${index + 1}${step?.label ? ` (${step.label})` : ''}`;
      if (kinds.length !== 1) problems.push(`${at} must have exactly one of: include, ${STEP_KINDS.join(', ')}`);
      else if (kinds[0] === 'run' && !Array.isArray(step.run?.steps)) problems.push(`${at}: "run" needs "steps"`);
      else if (kinds[0] === 'run' && step.run.body !== undefined && step.run.body !== 'fixed') problems.push(`${at}: body "${step.run.body}": a seated scenario runs with body "fixed" only`);
      if (step?.mode !== undefined && !MODES.includes(step.mode)) problems.push(`${at}: "mode" must be one of ${MODES.join(', ')}`);
    });
  }
  if (problems.length) throw new SetupError(`${where}:\n  ${problems.join('\n  ')}`);
  return scenario;
}

function findScenarios(dir = SCENARIOS) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === SCENARIOS && (entry.name === 'out' || entry.name === 'parts')) continue;
      found.push(...findScenarios(full));
    } else if (entry.name.endsWith('.json')) {
      found.push(full);
    }
  }
  return found.sort();
}

async function runScenario(scenario, ctx) {
  const total = scenario.steps.length;
  const route = withPace(scenario.route, scenario.pace);
  console.log(`\n${scenario.name}  (${rel(scenario.file)})\n  ${route}  ${scenario.xr ? 'xr' : 'page'}  ${scenario.mode}  ${scenario.device}`);
  const run = { ...ctx, scenario, route, inputMode: scenario.mode };
  let index = -1;
  try {
    await emulator.use(scenario.device, scenario.environment);
    await openRoute(ctx.server, route);
    // The command bridge of the app answers once the page has a World.
    await serverReady(DEVICES[scenario.device], 120);
    if (scenario.xr) await enterXR(scenario);
    else await leaveXR();
    for (index = 0; index < total; index += 1) {
      const step = scenario.steps[index];
      const note = await runStep(step, run);
      const label = step.label ? `  ${step.label}` : '';
      console.log(`  ok    ${index + 1}/${total}  ${kindOf(step)}${label}${note ? `  ${note}` : ''}`);
    }
    return true;
  } catch (error) {
    if (!(error instanceof StepFailure)) throw error;
    if (index >= 0 && index < total) {
      const step = scenario.steps[index];
      console.log(`  FAIL  ${index + 1}/${total}  ${kindOf(step) ?? 'step'}${step.label ? `  ${step.label}` : ''}`);
      console.log(`        step: ${JSON.stringify(step)}`);
    } else {
      console.log('  FAIL  before the first step');
    }
    console.log(`        ${error.message.replaceAll('\n', '\n        ')}`);
    return false;
  } finally {
    if (scenario.xr && !ctx.keepOpen) await leaveXR().catch(() => {});
  }
}

// ---------------------------------------------------------------- one run at a time

function lock(out, waitSeconds) {
  const file = path.join(out, '.lock');
  fs.mkdirSync(out, { recursive: true });
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error.code === 'EPERM';
    }
  };
  const release = () => {
    try {
      if (fs.readFileSync(file, 'utf8').trim() === String(process.pid)) fs.rmSync(file, { force: true });
    } catch {
      // Already gone.
    }
  };
  return (async () => {
    const deadline = Date.now() + waitSeconds * 1000;
    let said = false;
    for (;;) {
      try {
        fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
        return release;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const owner = Number(fs.readFileSync(file, 'utf8').trim() || 0);
      if (!owner || !alive(owner)) {
        fs.rmSync(file, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new SetupError(`Another scenario run (pid ${owner}) did not finish in ${waitSeconds} s.`);
      if (!said) {
        console.log(`Waiting for another scenario run (pid ${owner}) to finish...`);
        said = true;
      }
      await sleep(1500);
    }
  })();
}

// ---------------------------------------------------------------- entry

function parseArgs(argv) {
  const args = { files: [], all: false, bail: false, keepOpen: false, help: false, device: undefined, out: path.join(SCENARIOS, 'out') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--all') args.all = true;
    else if (arg === '--bail') args.bail = true;
    else if (arg === '--keep-open') args.keepOpen = true;
    else if (arg === '--out') args.out = path.resolve(argv[(i += 1)] ?? '');
    else if (arg === '--device') args.device = argv[(i += 1)];
    else if (arg.startsWith('--')) throw new SetupError(`Unknown option ${arg}. See --help.`);
    else args.files.push(path.resolve(arg));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return 0;
  }
  const files = args.all ? findScenarios() : args.files;
  if (files.length === 0) {
    console.error(args.all ? `No scenarios under ${rel(SCENARIOS)}.` : 'Give a scenario file, or --all. See --help.');
    return 2;
  }
  const scenarios = files.map((file) => loadScenario(file, { device: args.device }));
  // Fewest emulator restarts: scenarios for the same device and room run together.
  if (args.all) scenarios.sort((a, b) => `${a.device} ${a.environment ?? ''}`.localeCompare(`${b.device} ${b.environment ?? ''}`));

  const release = await lock(args.out, 900);
  const cleanup = () => {
    emulator.restoreSync();
    release();
  };
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });

  let failed = 0;
  try {
    const server = await requireServer();
    for (const scenario of scenarios) {
      const ok = await runScenario(scenario, { server, out: args.out, keepOpen: args.keepOpen });
      if (!ok) {
        failed += 1;
        if (args.bail) break;
      }
    }
  } finally {
    const changed = emulator.restoreSync();
    if (changed) {
      console.log('\niwsdk.config.json restored; the dev server restarts in place.');
      await sleep(3000);
    }
    release();
  }

  const passed = scenarios.length - failed;
  console.log(`\n${failed === 0 ? 'passed' : 'FAILED'}: ${passed} of ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'}`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      emulator.restoreSync();
      if (error instanceof SetupError) console.error(error.message);
      else console.error(error);
      process.exit(2);
    },
  );
}
