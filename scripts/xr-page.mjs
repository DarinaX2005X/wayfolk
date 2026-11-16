/**
 * The page side of scripts/xr.mjs. Run through `iwsdk browser run scripts/xr-page.mjs`
 * (the dev server must be started with --allow-browser-automation). It receives one
 * operation as JSON in the GW_XR_OP environment variable, performs it in the
 * application frame of the managed browser and returns a plain object.
 *
 * Not meant to be called by hand: use `npm run xr -- <scenario.json>`.
 */

/** Evaluates an expression with the keys of window.__gw in scope. Runs in the page. */
async function evalInPage(expression) {
  const hooks = window.__gw;
  if (!hooks) {
    return {
      ok: false,
      error: 'window.__gw is missing: the page has not started or is not a build with debug hooks (dev, npm run xr:prod or ?debug=1)',
    };
  }
  try {
    const names = Object.keys(hooks).filter((key) => /^[A-Za-z_$][\w$]*$/.test(key));
    const run = new Function(...names, `return (${expression});`);
    let value = run(...names.map((key) => hooks[key]));
    if (value && typeof value.then === 'function') value = await value;
    if (value === undefined) return { ok: true, value: null, isUndefined: true };
    let text;
    try {
      text = JSON.stringify(value);
    } catch {
      return { ok: false, error: 'the result cannot be written as JSON (pick a plain value out of it)' };
    }
    return { ok: true, value: text === undefined ? null : JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

function pageState() {
  const hooks = window.__gw;
  return {
    href: location.href,
    readyState: document.readyState,
    hooks: hooks ? Object.keys(hooks) : null,
    route: document.getElementById('app')?.dataset.route ?? null,
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default async function run({ page, frame }) {
  const op = JSON.parse(process.env.GW_XR_OP ?? 'null');
  if (!op || typeof op.op !== 'string') {
    return { ok: false, error: 'GW_XR_OP is not set: this script is driven by scripts/xr.mjs' };
  }

  switch (op.op) {
    case 'goto': {
      // A full page load every time, also when only the hash differs: a scenario
      // starts from a clean page.
      try {
        await frame.evaluate((url) => {
          const next = new URL(url, location.href);
          const samePage = next.pathname === location.pathname && next.search === location.search;
          if (next.href === location.href) {
            location.reload();
          } else {
            location.assign(next.href);
            if (samePage) location.reload();
          }
        }, op.url);
      } catch {
        // The frame navigated away under the call: that is the point.
      }
      return { ok: true };
    }

    case 'reload': {
      try {
        await frame.evaluate(() => location.reload());
      } catch {
        // Same as above.
      }
      return { ok: true };
    }

    case 'state':
      return { ok: true, value: await frame.evaluate(pageState) };

    case 'eval':
      return frame.evaluate(evalInPage, op.expression);

    case 'mouse': {
      // Canvas position on the page, then real pointer input through Playwright.
      const canvas = frame.locator('canvas').first();
      const rect = await canvas.boundingBox();
      if (!rect) return { ok: false, error: 'the page has no visible canvas' };
      const path = [];
      for (const point of op.points) {
        if (!point.inside) {
          return { ok: false, error: `the point (${point.x.toFixed(0)}, ${point.y.toFixed(0)}) is outside the canvas` };
        }
        path.push({ x: rect.x + point.x, y: rect.y + point.y });
      }
      const [from, to] = path;
      await page.mouse.move(from.x, from.y);
      await sleep(80);
      await page.mouse.down();
      if (op.action === 'drag') {
        const steps = Math.max(2, Math.round((op.seconds ?? 0.5) * 30));
        for (let i = 1; i <= steps; i += 1) {
          const t = i / steps;
          // Ease in and out, as a hand moves.
          const k = t * t * (3 - 2 * t);
          await page.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
          await sleep(1000 / 30);
        }
        await sleep(60);
      } else {
        await sleep(60);
      }
      await page.mouse.up();
      return { ok: true, value: { from, to: to ?? null } };
    }

    default:
      return { ok: false, error: `unknown operation "${op.op}"` };
  }
}
