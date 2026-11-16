#!/usr/bin/env node
/**
 * Browser and phone scenarios on Playwright: the pages with a mouse, the phone pages with
 * touch, and the live deployment from outside.
 *
 *   npm run web -- tests/web/smoke.json [--base <address>] [--device desktop | phone]
 *
 * Without --base the local dev server (https://localhost:8081) is used. The phone is
 * Chromium at 390 × 844 with touch. Package fragments of tests/xr/parts/ run here the way
 * scripts/xr.mjs runs them in mode "mouse": a step with a named target becomes a click
 * or a drag at that object's place on the canvas (window.__gw.probe, which asks
 * findTarget first), and a step with a `mouse` block uses that block. The scene hooks
 * exist on the dev server, in the scenario build, and with `?debug=1` on any build.
 *
 * Steps (format in tests/xr/README.md):
 *   { "goto": "/go" }                                   a full page load
 *   { "click": "button.app-enter" } | { "click": { "text": "Enter Groundwork" } }
 *   { "type": { "into": "#code", "text": "X4KM7" } }
 *   { "upload": { "into": "input[type=file]", "file": "tests/web/files/one.pdf" } }
 *   { "expectText": "Enter Groundwork" } | { "expectText": { "in": "h1", "text": "..." } }
 *   { "expectNoRequest": "POST /api/llm" }              no such request since the page loaded ("METHOD url")
 *   { "eval": "store.mode.value", "equals": "desk" }    as in xr.mjs, over window.__gw
 *   { "run": { ... } } | { "mouse": { "target": "name", "action": "click" | "drag", "to": ... } }
 *   { "include": "parts/<package>/<file>.json" }        tests/web/ first, then tests/xr/
 *   { "shot": "go-phone.png" }                          into tests/web/out/
 *   { "wait": 0.5 }
 *
 * Exit code: 0 all passed, 1 a step failed, 2 nothing could run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { SetupError, StepFailure, evalVerdict, expandIncludes, hasCheck, mouseActionsOf, short, sleep, withPace } from './scenario.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'tests', 'web');
const XR = path.join(ROOT, 'tests', 'xr');
const OUT = path.join(WEB, 'out');
const STEP_KINDS = ['goto', 'click', 'type', 'upload', 'expectText', 'expectNoRequest', 'eval', 'run', 'mouse', 'shot', 'wait'];
const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  },
};

const rel = (file) => path.relative(ROOT, file).replaceAll('\\', '/');
const kindOf = (step) => STEP_KINDS.find((kind) => step[kind] !== undefined);

function parseArgs(argv) {
  const args = { files: [], base: 'https://localhost:8081', device: 'desktop' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base') args.base = (argv[(i += 1)] ?? '').replace(/\/+$/, '');
    else if (arg === '--device') args.device = argv[(i += 1)];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--')) throw new SetupError(`Unknown option ${arg}`);
    else args.files.push(path.resolve(arg));
  }
  if (!(args.device in DEVICES)) throw new SetupError(`--device must be ${Object.keys(DEVICES).join(' or ')}`);
  if (!/^https?:\/\//.test(args.base)) throw new SetupError('--base must be an http(s) address');
  return args;
}

function loadScenario(file) {
  const where = rel(file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new SetupError(`${where}: ${error.message}`);
  }
  if (!Array.isArray(data.steps) || data.steps.length === 0) throw new SetupError(`${where}: "steps" must be a list with at least one step`);
  const steps = expandIncludes(data.steps, [WEB, XR], where);
  steps.forEach((step, index) => {
    const kinds = STEP_KINDS.filter((kind) => step?.[kind] !== undefined && !(kind === 'mouse' && step.run !== undefined));
    // Hand-only steps of a fragment (pull, lose, expect, visibility, clock) are skipped here unless they carry a mouse block.
    if (kinds.length === 0 && ['pull', 'lose', 'expect', 'visibility', 'clock', 'reload'].some((k) => step?.[k] !== undefined)) return;
    if (kinds.length !== 1) throw new SetupError(`${where}: step ${index + 1} must have exactly one of: include, ${STEP_KINDS.join(', ')}`);
  });
  return { file, name: typeof data.name === 'string' ? data.name : path.basename(file, '.json'), route: data.route, pace: data.pace, steps };
}

async function canvasPoint(page, where) {
  const point = await page.evaluate((target) => {
    const probe = window.__gw?.probe;
    if (!probe) return { error: 'window.__gw.probe is missing: open the page on the dev server, the scenario build, or with ?debug=1' };
    return probe.screen(target);
  }, where);
  if (!point) throw new StepFailure(`no object named ${JSON.stringify(where)} in the scene`);
  if (point.error) throw new StepFailure(point.error);
  if (!point.inside) throw new StepFailure(`${JSON.stringify(where)} is outside the canvas`);
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new StepFailure('the page has no visible canvas');
  return { x: box.x + point.x, y: box.y + point.y };
}

async function mouseAction(page, phone, { target, at, action = 'click', to, seconds = 0.5 }) {
  const from = await canvasPoint(page, target ?? at);
  if (action === 'click') {
    if (phone) await page.touchscreen.tap(from.x, from.y);
    else await page.mouse.click(from.x, from.y);
    return;
  }
  if (action !== 'drag') throw new StepFailure(`mouse action must be click or drag, got ${short(action)}`);
  const end = await canvasPoint(page, to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = Math.max(2, Math.round(seconds * 30));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const k = t * t * (3 - 2 * t);
    await page.mouse.move(from.x + (end.x - from.x) * k, from.y + (end.y - from.y) * k);
    await sleep(1000 / 30);
  }
  await page.mouse.up();
}

async function runStep(step, ctx) {
  const { page, phone } = ctx;
  const within = (Number.isFinite(step.within) ? step.within : 5) * 1000;
  switch (kindOf(step)) {
    case 'goto': {
      ctx.requests.length = 0;
      const url = new URL(withPace(step.goto, ctx.scenario.pace), ctx.base).href;
      const response = await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
      if (!response || response.status() >= 400) throw new StepFailure(`${url} answered ${response?.status() ?? 'nothing'}`);
      return url;
    }
    case 'click': {
      const locator = typeof step.click === 'string' ? page.locator(step.click) : page.getByText(step.click.text, { exact: step.click.exact ?? false });
      await locator.first().click({ timeout: within });
      return '';
    }
    case 'type': {
      await page.locator(step.type.into).first().fill(String(step.type.text), { timeout: within });
      return '';
    }
    case 'upload': {
      const file = path.resolve(ROOT, step.upload.file);
      if (!fs.existsSync(file)) throw new StepFailure(`no file ${rel(file)}`);
      await page.locator(step.upload.into).first().setInputFiles(file, { timeout: within });
      return rel(file);
    }
    case 'expectText': {
      const spec = typeof step.expectText === 'string' ? { text: step.expectText } : step.expectText;
      const scope = spec.in ? page.locator(spec.in).first() : page.locator('body');
      try {
        await scope.getByText(spec.text, { exact: false }).first().waitFor({ state: 'visible', timeout: within });
      } catch {
        const seen = (await scope.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        throw new StepFailure(`"${spec.text}" is not visible${spec.in ? ` in ${spec.in}` : ''}; the page shows: ${seen}`);
      }
      return '';
    }
    case 'expectNoRequest': {
      const pattern = String(step.expectNoRequest);
      // "POST /api/llm" matches only that method; a bare address matches any method.
      const [, method, part] = /^(?:([A-Z]+) )?(.*)$/.exec(pattern);
      const hits = ctx.requests.filter((line) => {
        const [m, url] = line.split(' ', 2);
        return (!method || m === method) && url.includes(part);
      });
      if (hits.length) throw new StepFailure(`the page asked for ${pattern}: ${hits.slice(0, 3).join(', ')}`);
      return `${ctx.requests.length} requests, none to ${pattern}`;
    }
    case 'eval': {
      // Hooks appear when the world has booted: an error is retried as long as a check is.
      const deadline = Date.now() + Math.max(hasCheck(step) ? within : 0, 20_000);
      for (;;) {
        const result = await page.evaluate((expression) => {
          const hooks = window.__gw;
          if (!hooks) return { error: 'window.__gw is missing: open the page on the dev server, the scenario build, or with ?debug=1' };
          try {
            const names = Object.keys(hooks).filter((key) => /^[A-Za-z_$][\w$]*$/.test(key));
            const value = new Function(...names, `return (${expression});`)(...names.map((key) => hooks[key]));
            return { value: value === undefined ? null : JSON.parse(JSON.stringify(value) ?? 'null') };
          } catch (error) {
            return { error: String(error?.message ?? error) };
          }
        }, step.eval);
        if (result.error) {
          if (Date.now() >= deadline) throw new StepFailure(`${step.eval}: ${result.error}`);
          await sleep(250);
          continue;
        }
        const verdict = hasCheck(step) ? evalVerdict(step, result.value) : null;
        if (verdict === null) return hasCheck(step) ? `= ${short(result.value)}` : '';
        if (Date.now() >= deadline) throw new StepFailure(`${step.eval} is ${short(result.value)}, expected ${verdict}`);
        await sleep(250);
      }
    }
    case 'run': {
      const actions = step.mouse ? [step.mouse] : mouseActionsOf(step.run);
      if (!actions) throw new StepFailure('this hand step has no mouse meaning: give the step a "mouse" block');
      for (const action of actions) await mouseAction(page, phone, action);
      return `${actions.length} pointer action${actions.length === 1 ? '' : 's'}`;
    }
    case 'mouse': {
      await mouseAction(page, phone, step.mouse);
      return '';
    }
    case 'shot': {
      const file = path.resolve(OUT, String(step.shot));
      if (path.relative(OUT, file).startsWith('..') || !/\.(png|jpe?g)$/i.test(file)) throw new StepFailure(`"shot" must be a file name inside ${rel(OUT)}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.screenshot({ path: file, fullPage: false });
      return rel(file);
    }
    case 'wait':
      await sleep(Number(step.wait) * 1000);
      return '';
    default:
      return 'skipped: no pointer meaning';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.files.length === 0) {
    console.log('usage: npm run web -- <scenario.json> [more.json] [--base <address>] [--device desktop | phone]');
    return args.help ? 0 : 2;
  }
  const scenarios = args.files.map(loadScenario);
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({ ...DEVICES[args.device], ignoreHTTPSErrors: true });
      const page = await context.newPage();
      const requests = [];
      const problems = [];
      page.on('request', (request) => requests.push(`${request.method()} ${request.url()}`));
      page.on('pageerror', (error) => problems.push(String(error.message)));
      const ctx = { page, phone: args.device === 'phone', base: args.base, requests, scenario };
      console.log(`\n${scenario.name}  (${rel(scenario.file)})\n  ${args.base}  ${args.device}`);
      let index = -1;
      try {
        if (scenario.route) await runStep({ goto: scenario.route }, ctx);
        for (index = 0; index < scenario.steps.length; index += 1) {
          const step = scenario.steps[index];
          const note = await runStep(step, ctx);
          console.log(`  ok    ${index + 1}/${scenario.steps.length}  ${kindOf(step) ?? 'step'}${step.label ? `  ${step.label}` : ''}${note ? `  ${note}` : ''}`);
        }
        if (problems.length) throw new StepFailure(`the page threw: ${problems.slice(0, 3).join(' | ')}`);
      } catch (error) {
        if (!(error instanceof StepFailure) && !(error instanceof Error && /Timeout|net::/.test(error.message))) throw error;
        failed += 1;
        const step = scenario.steps[index];
        console.log(`  FAIL  ${index + 1}/${scenario.steps.length}  ${step ? kindOf(step) : 'page'}${step?.label ? `  ${step.label}` : ''}`);
        if (step) console.log(`        step: ${JSON.stringify(step)}`);
        console.log(`        ${String(error.message).split('\n')[0]}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n${failed === 0 ? 'passed' : 'FAILED'}: ${scenarios.length - failed} of ${scenarios.length} scenario${scenarios.length === 1 ? '' : 's'}`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof SetupError ? error.message : error);
    process.exit(2);
  },
);
