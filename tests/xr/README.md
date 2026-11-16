# Scenarios: hands in the emulator, pointer and phone in Playwright

Two runners share one scenario format and one set of package fragments:

- `npm run xr -- tests/xr/<scenario>.json` drives the app in the IWSDK emulator (IWER) through the dev server's command bridge: hands, hand rays, gaze and the mouse on the canvas. `npm run xr:all` runs every scenario under `tests/xr/` (not `out/`, not `parts/`). `--device metaVRGlasses` runs the given scenarios on the glasses.
- `npm run xr:prod -- tests/xr/<scenario>.json` runs the same on the production build, served locally.
- `npm run web -- tests/web/<scenario>.json [--base <address>] [--device desktop | phone]` drives Chromium through Playwright: pages with a mouse, phone pages with touch (390 × 844), and the deployment from outside.

The dev server must run with browser automation: `npm run dev:headless`. Scenario runs are queued: a second run waits for the first.

## A scenario

```json
{
  "name": "smoke",
  "route": "/app?testscene=1",
  "pace": 0.25,
  "xr": true,
  "device": "metaQuest3",
  "environment": "home_office",
  "mode": "hand-ray",
  "steps": [ ... ]
}
```

- `route` is opened with a full page load. `pace` is added as `?pace=` (it multiplies recorded waits and the display minimums; 0.25 in ordinary scenarios, 1 in the one that checks timings).
- `xr: true` enters a session after the page has booted its world. `device` is `metaQuest3` (default) or `metaVRGlasses`; `environment` is an emulator room. Both are written to `iwsdk.config.json` for the run and restored after it.
- `mode` is the input of the scenario; any step may carry its own `mode` for that step only (`hand`, `hand-ray`, `controller`, `gaze`; `mouse` needs `"xr": false`).

The person is seated and the body never moves. In mode `hand` every `run` step goes to `xr run-sequence` with `body: "fixed"`, so a step passes only where a seated person reaches; `"body": "auto"` in a scenario is an error. In modes `hand-ray` and `gaze` the runner never calls `run-sequence`: it aims with `xr look-at` and `xr animate-to` and selects with a pinch.

## Steps

| Step | What it does |
| --- | --- |
| `{ "include": "parts/<package>/<file>.json" }` | Inserts the steps of a package fragment. |
| `{ "run": { "device": "hand-right", "steps": [ ... ] } }` | Hand mode: `xr run-sequence` with `body: "fixed"`. Ray and gaze: `target`/`position` aims, `press` is a short select, `pinch: 1` holds, `pinch: 0` lets go. Mouse: a press on a target is a click, pinch, move and release is a drag; a `mouse` block next to `run` replaces the translation. |
| `{ "pull": { "target": "thread:<key>", "by": 0.15, "seconds": 0.6 } }` | Hand-ray: aim at the target, pinch, move the hand `by` metres toward the seat along the ray, let go. An ordinary ray step only turns the hand, so a pull of a thread needs this step. In mouse mode the step needs a `mouse` block. |
| `{ "lose": { "hand": "right", "seconds": 0.8 } }` | Calls `window.__gw.test.loseHand` (registered by `src/interact/`). |
| `{ "head": { "position": [x, y, z], "yaw": 145 } }` | Moves the emulated headset (`xr set-transform`) and takes the seated frame again (`app.recenter()`). |
| `{ "mouse": { "target": "name", "action": "click" \| "drag", "to": "name" \| [x, y, z] } }` | Pointer input at an object's place on the canvas. |
| `{ "expect": { "target": "name", "near": [x, y, z], "tol": 0.01 } }` | The centre of a named object is within `tol` metres. |
| `{ "eval": "<expression>", "equals": v }` | An expression with the keys of `window.__gw` in scope (`store`, `app`, `clock`, `perf`, `test`, `probe`, `seat`, `planes`, ...). Checks: `equals`, `near` with `tol`, `atMost`, `atLeast` (any combination). Without a check it is only run. |
| `{ "visibility": "hidden" \| "blurred" \| "visible" }` | `window.__gw.test.setVisibility`. |
| `{ "clock": "2027-03-01" }` | `window.__gw.clock.set`: the wall date for deadlines. |
| `{ "reload": true }`, `{ "shot": "file.png" }`, `{ "wait": 0.5 }` | Reload (and enter the session again), a frame into `tests/xr/out/`, a pause. |

`expect` and `eval` retry for `within` seconds (default 3). Positions are metres in the XR origin frame: −Z forward, +Y up. Any step may carry a `label`.

`scripts/web.mjs` adds `goto`, `click`, `type`, `upload`, `expectText` and `expectNoRequest` (for example `"/api/llm"`: no request to it since the page loaded), takes `run`, `mouse`, `eval`, `shot`, `wait` and `include` as above, and skips hand-only steps (`pull`, `lose`, `expect`, `visibility`, `clock`) unless they carry a `mouse` block. Its includes look in `tests/web/` first, then in `tests/xr/`.

### Fragments of packages

A package that brings a view also brings `tests/xr/parts/<package>/<file>.json` (and `tests/web/parts/<package>/` where the phone is involved):

```json
{ "name": "check gate", "steps": [ { "label": "first stamp", "eval": "...", "atMost": 20000 } ] }
```

Fragments address objects only by named targets (`findTarget`, PLAN "Набор ремесла"), never by coordinates, so one fragment runs by hand, by gaze and by mouse. A step without a mouse meaning carries a `mouse` block. A package checks its fragment on `/app?run=<example>&answers=scripted&pace=0.25` before it hands over. Example of a scenario that mixes modes:

```json
{ "label": "reach the bench by hand, seated", "mode": "hand",
  "run": { "device": "hand-right", "steps": [ { "position": { "relativeTo": "head", "x": 0.1, "y": -0.3, "z": -0.45 }, "anchor": "index-tip", "orientation": "auto", "duration": 0.6 } ] } },
{ "include": "parts/check/fool-tray.json", "mode": "hand-ray" }
```

### Turning a sheet in the hand

The hand's orientation in a `run` step is given as directions of the fingers and the palm, as `run-sequence` takes them. To open a slip by turning it 60° (the reveal of `onReveal`): take it with the palm down, then turn the palm 60° toward the thumb side while the fingers keep pointing forward.

```json
{ "run": { "device": "hand-right", "steps": [
  { "label": "take the slip", "target": "slip:e23-a41b0c", "approach": { "distance": 0.06 }, "pinch": { "value": 1, "at": "arrival" } },
  { "label": "palm down", "position": { "relativeTo": "head", "x": 0.05, "y": -0.25, "z": -0.38 }, "anchor": "grasp", "orientation": { "fingers": [0, 0, -1], "palm": [0, -1, 0] }, "duration": 0.5 },
  { "label": "turn 60°", "orientation": { "fingers": [0, 0, -1], "palm": [-0.866, -0.5, 0] }, "duration": 0.4 },
  { "label": "let go", "pinch": 0, "duration": 0.15 }
] } }
```

## The built bundle locally (`npm run xr:prod`)

1. `tools/dev-api/bundle.mjs`, then `vite build --mode development` with `VITE_GW_TEST=1` and `NODE_ENV=development`: the same Rollup bundle as the deployment (code split, minified), with the debug hooks on and the DEV branches kept.
2. The managed dev server is started with `GW_SERVE_DIST=1`: `vite.config.ts` then serves the files of `dist/` instead of the sources (an address without a file gets `dist/index.html`, as `vercel.json` rewrites it). The page goes through the dev server's HTML transform, so the IWSDK plugin injects the emulator and the client of its command bridge; `/@…` addresses and `/api/*` pass through (dev API on the memory driver).
3. `scripts/xr.mjs` runs with the given arguments. A dev server that was running from sources is stopped for the run and started again afterwards.

Why not a build with `import.meta.env.DEV === false`: IWSDK drops its MCP runtime from such a build (`world-initializer`: the code path is tree-shaken in production builds), and without it the page connects to the bridge but never becomes command-ready, so no `xr` command reaches it. Checked on 16.11.2026: `dev.emulator.injectOnBuild` in `iwsdk.config.json` (the plugin refuses emulator options in `vite.config.ts`) gives a connected, never ready page; adding the HTML transform loads two emulator copies and is not ready either; the DEV-branch bundle with the HTML transform is ready and passes the smoke scenario. The deployment itself is checked from outside with `npm run web -- tests/web/smoke.json --base <address>`. The emulator plugin activates only on `localhost`; a deployment never carries it.

## Measured once (task 01.1.4)

### View factor of the draw count

Test scene `/app?testscene=1` (a sphere on the arc, the bench slab, one uikit panel with two weights of text): at the desk `renderer.info.render.calls` is 5 and the walk over the scene counts 5. Inside an emulated session it reports 18 with 9 unique draws (the same 5 and four draws of the emulated hands), on `metaQuest3` and on `metaVRGlasses` alike: three.js counts every draw once per view.

**`BUDGET.viewFactor = 2`.** `window.__gw.perf.info()` divides by it while presenting and reports unique draws per eye; its zone split must agree with that number within two draws (`mismatch` is null), and the smoke scenario checks it.

### Planes of the emulator rooms

Read through `window.__gw.planes()` from the default emulator pose (headset at 1.6 m in the middle of the room, facing −Z). The plane object is in the component field `_plane` (the schema of `XRPlane` declares only `_plane`; the `plane` of the documentation example does not exist), and the pose comes through `entity.object3D`. Azimuth: 0 ahead, positive to the right; distance horizontal from the head; height of the centre over the floor.

`home_office` (3.5 × 4 m):

| Plane | Orientation | Size, m | Distance, m | Azimuth | Height, m |
| --- | --- | --- | --- | --- | --- |
| wall | vertical | 3.5 × 2.7 | 2.40 | 0° | 1.35 |
| window | vertical | 1.4 × 1.4 | 2.40 | 0° | 1.55 |
| desk | horizontal | 1.5 × 0.7 | 2.03 | 0° | 0.73 |
| wall | vertical | 4 × 2.7 | 1.80 | 77° | 1.35 |
| wall | vertical | 4 × 2.7 | 1.80 | −77° | 1.35 |
| wall art | vertical | 1.1 × 0.75 | 1.76 | 98° | 1.55 |
| couch | horizontal | 1.2 × 0.66 | 1.19 | 102° | 0.45 |
| table | horizontal | 0.44 × 0.44 | 1.91 | 132° | 0.50 |
| wall art | vertical | 0.6 × 0.8 | 1.75 | 155° | 1.50 |
| door | vertical | 0.85 × 2.06 | 1.69 | −159° | 1.03 |
| wall | vertical | 3.5 × 2.7 | 1.60 | 180° | 1.35 |
| floor, ceiling | horizontal | 3.5 × 4 | | | 0, 2.7 |

Wall rule (02.3.5: vertical, at least 1.2 m wide, 0.8–3.5 m away, the point where the line of sight meets it within 50°, not a door, window, screen or wall art): **the wall ahead at 2.40 m**. Table rule (04.1.3: horizontal, facing up, 0.55–0.85 m over the floor, 0.3–0.8 m in front): **none**. The desk is at the right height but 2.03 m away; the small table is 0.50 m high and behind.

The same holds from the default pose of the other rooms (`sunlit_living_room`: wall ahead at 3.40 m, no table within 0.8 m; `conference_room`: wall at −43° 3.29 m, the 0.72 m table 2.6 m away). So **Room tasks are checked in `sunlit_living_room` with the headset seated at its 0.9 × 0.9 m table**: before entering Room a scenario sets

```json
{ "label": "sit at the table", "head": { "position": [-0.635, 1.15, 0.9], "yaw": 145 } }
```

and takes the seated frame again. From that seat `app.surfaces.find('table')` returns the table at (−0.95, 0.74, 1.35), 0.9 × 0.9 m, 0.55 m ahead, and `find('wall')` the 5 m wall at z = 2.4, 1.83 m ahead along the line of sight (measured 16.11.2026).

| Plane (`sunlit_living_room`, default pose) | Orientation | Size, m | Distance, m | Azimuth | Height, m |
| --- | --- | --- | --- | --- | --- |
| table | horizontal | 1.15 × 0.6 | 1.95 | 0° | 0.42 |
| couch | horizontal | 1.9 × 0.66 | 2.78 | 0° | 0.45 |
| wall art | vertical | 1.22 × 0.82 | 3.38 | 0° | 1.62 |
| wall | vertical | 5 × 2.7 | 3.40 | 0° | 1.35 |
| couch | horizontal | 0.62 × 0.58 | 2.09 | −54° | 0.54 |
| window | vertical | 2.1 × 1.8 | 2.84 | −62° | 1.45 |
| wall | vertical | 5.8 × 2.7 | 2.55 | ±79° | 1.35 |
| wall art | vertical | 0.64 × 0.94 | 2.83 | −118° | 1.50 |
| table | horizontal | 0.9 × 0.9 | 1.65 | −145° | 0.74 |
| door | vertical | 0.85 × 2.06 | 2.79 | 149° | 1.03 |
| wall art | vertical | 0.72 × 0.72 | 2.49 | −164° | 1.45 |
| wall | vertical | 5 × 2.7 | 2.40 | 180° | 1.35 |

The emulator's headset stands at 1.6 m; the seated layout is measured from the eyes, so it holds at any height, and a scenario that needs the seated eye height of DESIGN (1.15 m) sets the headset as above.

## Smoke scenarios

- `tests/xr/smoke.json`: boot, the Void and Room inside one session, visibility, the seated frame, the view factor and the zone count against renderer.info, the frame budget, the wall date, hand-ray aim, a pull, a seated hand reach, and a frame. Passes on `metaQuest3` and `metaVRGlasses` (`--device metaVRGlasses`) and through `npm run xr:prod`.
- `tests/web/smoke.json`: every route opens (with `--device phone` too), `/app` before entry with no request to `/api/llm`, then the test scene by pointer through the core fragment.
