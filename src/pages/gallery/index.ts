/**
 * /gallery: every component of the craft kit in every state, side by side, in the
 * browser and in the headset (task 01.3.5). Agents and reviewers use it; one frame of a
 * section shows what twenty clicks through the product would.
 *
 *   2D   tokens with measured contrast, type scales, browser controls, sounds
 *   3D   panels (normal, high contrast, large text), objects of the world kit, the
 *        hands probe, the seat frame and the bench layout
 *
 * One World and one canvas: the canvas moves into the 3D section that is in view and
 * that section's content is built for it. Camera "Seat" puts the eye where the seated
 * person's eyes are (pitch −9°, 90° across); "Overview" frames the section's content.
 * The time slider freezes the application clock and holds every animation at one
 * instant, so a frame repeats exactly.
 *
 * `?section=<id>` opens that section first (scenarios open `?section=probe`).
 */
import { Box3, DirectionalLight, Group, HemisphereLight, MathUtils, Vector3, type Object3D } from '@iwsdk/core';
import type { App } from '../../app/boot/world';
import { store } from '../../app/store';
import { registerDebug } from '../../app/debug';
import { BUDGET, COLOR, CONTRAST, LIGHT, QUALITY, SEAT, TEXT, WEB_TYPE, textSizeFor, type TextRole } from '../../tokens/tokens';
import { uiGallery } from '../../kit/ui/gallery';
import { setUiOverride, type UiOverride } from '../../kit/ui/theme';
import { mountGalleryObject, releaseGalleryObjects } from '../../kit/ui/root';
import type { GalleryEntry } from '../../kit/ui/types';
import { bindInteract } from '../../interact/bind';
import { buildHandsProbe } from './probe';
import { buildSeatFrame, buildBenchLayout } from './seat';
import { soundSection } from './sounds';
import type { RouteParams } from '../router';
import './gallery.css';

type Section = {
  id: string;
  title: string;
  kind: '2d' | '3d';
  /** 2D: fills the element. */
  render?(el: HTMLElement): void;
  /** 3D: builds into the stage root; returns its labels and a disposer. */
  build?(app: App, root: Group): Promise<Built>;
  camera?: 'seat' | 'overview';
};

type Label = { text: string; at: Vector3; kind: 'entry' | 'state' };
type Built = { labels: Label[]; dispose(): void; bounds: Box3 };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------- contrast (WCAG 2.1)

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---------------------------------------------------------------- 2D sections

function tokensSection(el2: HTMLElement): void {
  const swatches = el('div', 'g-swatches');
  const flat: [string, string][] = [];
  const walk = (prefix: string, obj: unknown): void => {
    if (typeof obj === 'string') flat.push([prefix, obj]);
    else if (Array.isArray(obj)) obj.forEach((v, i) => walk(`${prefix}.${i + 1}`, v));
    else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) walk(prefix ? `${prefix}.${k}` : k, v);
  };
  walk('', COLOR);
  for (const [name, hex] of flat) {
    const s = el('div', 'g-swatch');
    const chip = el('div', 'g-swatch-chip');
    chip.style.background = hex;
    s.append(chip, el('span', 'g-swatch-name', name), el('span', 'g-swatch-hex', hex));
    swatches.append(s);
  }
  const pairs = el('div', 'g-pairs');
  for (const p of CONTRAST) {
    const ratio = contrast(p.fg, p.bg);
    const row = el('div', `g-pair${p.pass ? '' : ' is-forbidden'}`);
    const sample = el('div', 'g-pair-sample', 'Aa 124');
    sample.style.color = p.fg;
    sample.style.background = p.bg;
    const verdict = p.pass ? `passes ${p.min}:1` : `forbidden, under ${p.min}:1`;
    row.append(sample, el('span', 'g-pair-ratio', ratio.toFixed(2)), el('span', 'g-pair-use', `${p.use}. ${verdict}`));
    pairs.append(row);
  }
  el2.append(el('h3', 'g-sub', 'Colours'), swatches, el('h3', 'g-sub', 'Contrast, measured here with WCAG 2.1'), pairs);
}

function typeSection(el2: HTMLElement): void {
  const table = el('table', 'g-table');
  const head = el('tr');
  for (const h of ['Role', 'Capital height at 1 m', 'Font size at 0.5 m', 'at 1.3 m', 'Large text at 1.3 m', 'Specimen']) head.append(el('th', '', h));
  table.append(head);
  for (const role of Object.keys(TEXT.dmm) as TextRole[]) {
    const tr = el('tr');
    const mm = (d: number, large = false): string => `${(textSizeFor(role, d, large) * 1000).toFixed(1)} mm`;
    const spec = el('td', 'g-spec', 'Checking quotes 124');
    spec.style.fontSize = `${Math.round(TEXT.dmm[role] * 1.1)}px`;
    if (role === 'body' || role === 'head' || role === 'view' || role === 'count') spec.style.fontWeight = '700';
    tr.append(el('td', '', role), el('td', '', `${TEXT.dmm[role]} mm`), el('td', '', mm(0.5)), el('td', '', mm(1.3)), el('td', '', mm(1.3, true)), spec);
    table.append(tr);
  }
  const web = el('div', 'g-webtype');
  for (const [name, px] of Object.entries(WEB_TYPE.scale)) {
    const line = el('p', `g-webtype-line g-webtype-${name}`, name === 'display' ? 'Agents do the groundwork' : `${name} ${px} px. 64 pages, 12 documents`);
    line.style.fontSize = `${px}px`;
    web.append(line);
  }
  el2.append(el('h3', 'g-sub', 'Headset text roles'), table, el('h3', 'g-sub', 'Browser scale'), web);
}

function webSection(el2: HTMLElement): void {
  const grid = el('div', 'g-web');
  const states: [string, string][] = [
    ['Rest', ''],
    ['Hover', 'is-hover'],
    ['Pressed', 'is-pressed'],
    ['Focus', 'is-focus'],
    ['Disabled', 'is-disabled'],
  ];
  for (const variant of ['primary', 'secondary', 'text'] as const) {
    const row = el('div', 'g-web-row');
    row.append(el('span', 'g-web-name', variant));
    for (const [name, cls] of states) {
      const cell = el('div', 'g-web-cell');
      const b = el('button', `button button-${variant} ${cls}`, variant === 'primary' ? 'Enter Groundwork' : variant === 'secondary' ? 'Allow microphone for voice' : 'Walk through a finished island');
      b.type = 'button';
      if (cls === 'is-disabled') {
        b.disabled = true;
        cell.append(b, el('span', 'g-web-reason', 'Live model runs are off in this copy.'));
      } else cell.append(b);
      cell.append(el('span', 'g-web-state', name));
      row.append(cell);
    }
    grid.append(row);
  }
  // The five cells of a code on /go.
  const code = el('div', 'g-code');
  for (const ch of ['X', '4', 'K', 'M', '']) {
    const cell = el('input', 'g-code-cell');
    cell.value = ch;
    cell.maxLength = 1;
    cell.setAttribute('aria-label', 'Code letter');
    code.append(cell);
  }
  el2.append(el('h3', 'g-sub', 'Buttons of the browser pages'), grid, el('h3', 'g-sub', 'Code cells of /go'), code);
}

// ---------------------------------------------------------------- 3D: laying out entries

const WALL = 2.2;
const GAP = 0.05;
const ROW_GAP = 0.12;
const WIDTH = 3.4;

/** Waits a few frames so uikit has laid out what was just built. */
const frames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    // Timers, not requestAnimationFrame: the window's frames stop while an XR session runs.
    const step = (k: number): void => (k <= 0 ? resolve() : void setTimeout(() => step(k - 1), 20));
    step(n);
  });

async function layEntries(app: App, root: Group, entries: GalleryEntry[], aspect = 1.85): Promise<Built> {
  const labels: Label[] = [];
  const box = new Box3();
  const size = new Vector3();
  type Item = { name: string; obj: Object3D; w: number; h: number; cx: number; cy: number; z: number };
  const blocks: { entry: GalleryEntry; items: Item[]; w: number; h: number }[] = [];
  const made: { entry: GalleryEntry; list: { name: string; obj: Object3D; inner: Object3D }[] }[] = [];
  for (const entry of entries) {
    const list: { name: string; obj: Object3D; inner: Object3D }[] = [];
    for (const state of entry.states) {
      try {
        const m = state.build({ world: app.world, app });
        if (m instanceof HTMLElement) continue;
        const holder = new Group();
        holder.add(m);
        root.add(holder);
        mountGalleryObject(app, m);
        list.push({ name: state.name, obj: holder, inner: m });
      } catch (error) {
        console.error(`[gw] gallery: ${entry.id} / ${state.name} failed`, error);
      }
    }
    made.push({ entry, list });
  }
  await frames(4);
  // Sizes: panels say theirs (uikit roots are centred on their origin); objects are measured.
  for (const { entry, list } of made) {
    const items: Item[] = [];
    for (const { name, obj, inner } of list) {
      const known = inner.userData.size as [number, number] | undefined;
      if (known) items.push({ name, obj, w: known[0], h: known[1], cx: 0, cy: 0, z: 0 });
      else {
        obj.updateWorldMatrix(true, true);
        box.setFromObject(obj);
        if (box.isEmpty()) box.set(new Vector3(-0.05, -0.05, 0), new Vector3(0.05, 0.05, 0));
        box.getSize(size);
        items.push({ name, obj, w: size.x, h: size.y, cx: (box.min.x + box.max.x) / 2, cy: (box.min.y + box.max.y) / 2, z: box.max.z });
      }
    }
    const w = items.reduce((s, i) => s + i.w, 0) + GAP * Math.max(0, items.length - 1);
    const h = Math.max(0.02, ...items.map((i) => i.h)) + 0.09;
    blocks.push({ entry, items, w, h });
  }
  // Shelf-pack the blocks; pick the width whose result is closest to the stage's shape.
  const pack = (width: number): { places: { x: number; y: number }[]; w: number; h: number } => {
    const places: { x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let rowH = 0;
    let maxW = 0;
    for (const b of blocks) {
      if (x > 0 && x + b.w > width) {
        x = 0;
        y += rowH + ROW_GAP;
        rowH = 0;
      }
      places.push({ x, y });
      x += b.w + 0.12;
      maxW = Math.max(maxW, x - 0.12);
      rowH = Math.max(rowH, b.h);
    }
    return { places, w: maxW, h: y + rowH };
  };
  const widest = Math.max(...blocks.map((b) => b.w), 0.3);
  let best = pack(widest);
  for (let k = 1; k <= 30; k++) {
    const p = pack(widest * (1 + k * 0.25));
    if (Math.abs(Math.log(p.w / p.h / aspect)) < Math.abs(Math.log(best.w / best.h / aspect))) best = p;
  }
  const left = -best.w / 2;
  const top = best.h / 2;
  blocks.forEach((b, i) => {
    const bx = left + best.places[i].x;
    const by = top - best.places[i].y;
    labels.push({ text: b.entry.title, at: new Vector3(bx, by, -WALL), kind: 'entry' });
    let x = bx;
    const rowTop = by - 0.035;
    for (const it of b.items) {
      it.obj.position.set(x + it.w / 2 - it.cx, rowTop - it.h / 2 - it.cy, -WALL - it.z);
      labels.push({ text: it.name, at: new Vector3(x, rowTop - it.h - 0.006, -WALL), kind: 'state' });
      x += it.w + GAP;
    }
  });
  const bounds = new Box3(new Vector3(left - 0.05, -best.h / 2 - 0.08, -WALL), new Vector3(left + best.w + 0.05, top + 0.06, -WALL));
  // The bounds live in the seated frame; the camera works in world space.
  bounds.applyMatrix4(app.roots.seat.matrixWorld);
  return {
    labels,
    bounds,
    dispose: () => {
      releaseGalleryObjects(app);
      root.clear();
    },
  };
}

async function worldEntries(): Promise<GalleryEntry[] | null> {
  // The world kit (package 01.2) may not be built yet; the gallery still opens without it.
  const mods = import.meta.glob('../../kit/world/*.ts') as Record<string, () => Promise<Record<string, unknown>>>;
  for (const load of Object.values(mods)) {
    const mod = await load().catch(() => null);
    const fn = mod?.worldGallery;
    if (typeof fn === 'function') return (fn as () => GalleryEntry[])();
  }
  return null;
}

// ---------------------------------------------------------------- the page

export async function mount(root: HTMLElement, params: RouteParams): Promise<void> {
  document.title = 'Groundwork state gallery';
  const page = el('main', 'g-page');
  const bar = el('header', 'g-bar');
  const logo = el('img', 'g-logo');
  logo.src = `${import.meta.env.BASE_URL}logo.svg`;
  logo.alt = 'Groundwork';
  bar.append(logo, el('h1', 'g-title', 'State gallery'));

  const controls = el('div', 'g-controls');
  bar.append(controls);
  const nav = el('nav', 'g-nav');
  nav.setAttribute('aria-label', 'Sections');
  page.append(bar, nav);

  let app: App | null = null;
  const override: UiOverride = { highContrast: false, largeText: false };
  let cameraMode: 'seat' | 'overview' = 'overview';
  let device: 'none' | 'quest' | 'glasses' = 'none';
  let room = false;
  let time: number | null = null;
  const savedLessMotion = store.settings.peek().lessMotion;

  const toggle = (label: string, on: boolean, fn: (on: boolean) => void): HTMLButtonElement => {
    const b = el('button', 'g-toggle', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', () => {
      const next = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(next));
      fn(next);
    });
    return b;
  };
  const choice = <T extends string>(label: string, options: T[], value: T, fn: (v: T) => void): HTMLElement => {
    const wrap = el('label', 'g-choice');
    wrap.append(el('span', '', label));
    const select = el('select', 'g-select');
    for (const o of options) {
      const opt = el('option', '', o);
      opt.value = o;
      if (o === value) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener('change', () => fn(select.value as T));
    wrap.append(select);
    return wrap;
  };

  const pick = params.query.get('entry');
  const only = (list: GalleryEntry[]): GalleryEntry[] => (pick ? list.filter((e) => e.id === pick) : list);

  const sections: Section[] = [
    { id: 'tokens', title: 'Tokens', kind: '2d', render: tokensSection },
    { id: 'type', title: 'Type', kind: '2d', render: typeSection },
    { id: 'web', title: 'Browser controls', kind: '2d', render: webSection },
    { id: 'sounds', title: 'Sounds', kind: '2d', render: soundSection },
    // `?entry=<id>` narrows the panel sections to one component, for a close look.
    { id: 'panels', title: 'Panels', kind: '3d', build: (a, r) => layEntries(a, r, only(uiGallery())) },
    {
      id: 'panels-hc',
      title: 'Panels in high contrast',
      kind: '3d',
      build: async (a, r) => {
        setUiOverride({ ...override, highContrast: true });
        return layEntries(a, r, only(uiGallery()));
      },
    },
    {
      id: 'panels-large',
      title: 'Panels in large text',
      kind: '3d',
      build: async (a, r) => {
        setUiOverride({ ...override, largeText: true });
        return layEntries(a, r, only(uiGallery()));
      },
    },
    {
      id: 'world',
      title: 'Objects of the world',
      kind: '3d',
      build: async (a, r) => {
        const entries = await worldEntries();
        return layEntries(a, r, entries ?? []);
      },
    },
    {
      id: 'probe',
      title: 'Hands probe',
      kind: '3d',
      camera: 'seat',
      build: async (a, r) => {
        const dispose = buildHandsProbe(a, r);
        await frames(2);
        return { labels: [], bounds: new Box3().setFromObject(r), dispose };
      },
    },
    { id: 'seat', title: 'Seat frame', kind: '3d', camera: 'seat', build: (a, r) => buildSeatFrame(a, r) },
    { id: 'bench', title: 'Bench layout', kind: '3d', camera: 'overview', build: (a, r) => buildBenchLayout(a, r) },
  ];

  const slots = new Map<string, { section: Section; el: HTMLElement; stage?: HTMLElement; labels?: HTMLElement; note?: HTMLElement }>();
  for (const s of sections) {
    const sec = el('section', `g-section g-${s.kind}`);
    sec.id = `section-${s.id}`;
    sec.dataset.section = s.id;
    sec.append(el('h2', 'g-heading', s.title));
    const link = el('a', 'g-nav-link', s.title);
    link.href = `#section-${s.id}`;
    nav.append(link);
    const entry: { section: Section; el: HTMLElement; stage?: HTMLElement; labels?: HTMLElement; note?: HTMLElement } = { section: s, el: sec };
    if (s.kind === '2d') {
      const body = el('div', 'g-body');
      s.render?.(body);
      sec.append(body);
    } else {
      const stage = el('div', 'g-stage');
      const labels = el('div', 'g-labels');
      const note = el('p', 'g-stage-note');
      note.hidden = true;
      stage.append(labels, note);
      sec.append(stage);
      entry.stage = stage;
      entry.labels = labels;
      entry.note = note;
    }
    page.append(sec);
    slots.set(s.id, entry);
  }
  root.replaceChildren(page);

  // ---- the world, booted once
  const holder = el('div', 'g-holder');
  const { bootApp } = await import('../../app/boot/world');
  let booted: App;
  try {
    booted = await bootApp(holder);
  } catch (error) {
    for (const s of slots.values()) if (s.note) {
      s.note.hidden = false;
      s.note.textContent = "This browser can't draw 3D scenes, so this section is empty here.";
    }
    console.error('[gw] gallery: the world did not start', error);
    return;
  }
  app = booted;
  bindInteract(app);
  // The gallery shows the kit on its own: whatever the product's views put on the roots stays hidden.
  const { roots } = app;
  for (const r of [roots.home, roots.bench, roots.arc, roots.ring, roots.work, roots.ui.desk, roots.ui.hand, roots.ui.side]) r.visible = false;
  const stageRoot = new Group();
  stageRoot.name = 'gallery';
  roots.seat.add(stageRoot);
  // One light for the gallery's own bodies and panels (DESIGN "Геометрия, материалы и свет");
  // the world kit brings its own rig for the seat frame.
  const light = new Group();
  light.name = 'gallery:light';
  const key = new DirectionalLight(LIGHT.key.color, LIGHT.key.void);
  const keyAt = new Vector3().setFromSphericalCoords(4, MathUtils.degToRad(90 - LIGHT.key.el), MathUtils.degToRad(180 - LIGHT.key.az));
  key.position.copy(keyAt);
  light.add(key, key.target, new HemisphereLight(LIGHT.fill.sky, LIGHT.fill.ground, LIGHT.fill.intensity));
  roots.seat.add(light);
  (window as unknown as { __gw?: Record<string, unknown> }).__gw &&
    Object.assign((window as unknown as { __gw: Record<string, unknown> }).__gw, { gallery: { active: () => active?.section.id ?? null, ready: () => ready } });

  // Draw calls of the bench panels (task 01.3.2: at most 12): the panels a run shows at
  // once go into the real roots of the app, the gallery's own content is hidden, and the
  // frame measure counts the zone. Scenarios call window.__gw.benchPanels().
  registerDebug('benchPanels', async () => {
    const { RunCard, AskCard } = await import('../../kit/ui/cards');
    const { StepCard } = await import('../../kit/ui/step');
    const { SettingsPanel } = await import('../../kit/ui/tools');
    const { CaptionRail } = await import('../../kit/ui/boards');
    const { mountPanel } = await import('../../kit/ui/root');
    stageRoot.visible = false;
    for (const r of [roots.ui.desk, roots.ui.hand, roots.ui.side]) r.visible = true;
    const failed: string[] = [];
    const tryMount = (name: string, fn: () => void): void => {
      try {
        fn();
      } catch (error) {
        failed.push(`${name}: ${String(error)}`);
      }
    };
    tryMount('RunCard', () => mountPanel('desk', new RunCard({ lines: ['Recorded live, 16 Nov', 'Checked on this device'], skip: { label: 'Skip to the result' }, live: { label: 'Run it live', note: '3 live runs left today for everyone.' } }), { x: -0.07, y: -0.15 }));
    tryMount('CaptionRail', () => mountPanel('rail', new CaptionRail({ lines: [{ source: 'Check', text: 'Quote not found on page 23' }] }), { x: 0, y: 0 }));
    tryMount('StepCard', () => mountPanel('hand', new StepCard({ id: 'b', title: 'Find the dates in the lease', role: 'Extractor', seconds: 6.8, status: 'review', preview: { kind: 'table', columns: ['Date', 'Amount'], rows: [['3 Jan 2026', '$1,450']] } }), { x: -0.2, y: 0 }));
    tryMount('AskCard', () => mountPanel('hand', new AskCard({ question: 'Are these the same keys?', options: [{ label: 'Same keys' }, { label: 'Different keys' }] }), { x: 0.2, y: 0 }));
    tryMount('SettingsPanel', () => mountPanel('side', new SettingsPanel({ settings: store.settings.peek() }), { x: 0, y: 0 }));
    await frames(6);
    const perf = (window as unknown as { __gw: { perf: { info(): { zones: Record<string, number> } } } }).__gw.perf.info();
    if (failed.length) throw new Error(failed.join('; '));
    return perf.zones['bench-panels'] ?? 0;
  });

  let active: { section: Section; built: Built | null } | null = null;
  let ready = false;
  let building: Promise<void> = Promise.resolve();

  const camera = (): void => {
    if (!app || !active?.built || app.world.session) return;
    const cam = app.world.camera;
    const slot = slots.get(active.section.id)!;
    const rect = slot.stage!.getBoundingClientRect();
    const aspect = rect.width / Math.max(1, rect.height);
    const seat = app.seat.origin;
    // "Seat" forces the seated eye; "Overview" lets each section use its own camera.
    const mode = cameraMode === 'seat' ? 'seat' : (active.section.camera ?? 'overview');
    if (mode === 'seat') {
      cam.position.set(seat[0], seat[1], seat[2]);
      cam.rotation.set(MathUtils.degToRad(SEAT.desk.pitchDeg), app.seat.yaw, 0, 'YXZ');
      // 90° across, but never under the 60° high of the desk camera: the bench must stay in frame.
      cam.fov = Math.max(SEAT.desk.fovDeg, MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(45)) / aspect)));
    } else {
      const b = active.built.bounds.clone();
      const size = b.getSize(new Vector3());
      const center = b.getCenter(new Vector3());
      const fov = 24;
      const fitH = size.y / 2 / Math.tan(MathUtils.degToRad(fov / 2));
      const fitW = size.x / 2 / Math.tan(MathUtils.degToRad(fov / 2)) / aspect;
      const dist = Math.max(fitH, fitW) * 1.08 + size.z;
      cam.position.copy(center).add(new Vector3(0, 0, dist));
      cam.rotation.set(0, 0, 0);
      cam.fov = fov;
    }
    cam.aspect = aspect;
    cam.near = 0.01;
    cam.far = 60;
    cam.updateProjectionMatrix();
  };

  const placeLabels = (): void => {
    if (!app || !active) return;
    const slot = slots.get(active.section.id)!;
    const layer = slot.labels!;
    const built = active.built;
    if (!built) return;
    const cam = app.world.camera;
    cam.updateMatrixWorld();
    const w = slot.stage!.clientWidth;
    const h = slot.stage!.clientHeight;
    const p = new Vector3();
    const kids = layer.children;
    built.labels.forEach((l, i) => {
      let node = kids[i] as HTMLElement | undefined;
      if (!node) {
        node = el('span', `g-label g-label-${l.kind}`, l.text);
        layer.append(node);
      }
      p.copy(l.at);
      roots.seat.localToWorld(p);
      p.project(cam);
      const inside = p.z < 1 && Math.abs(p.x) <= 1.05 && Math.abs(p.y) <= 1.05;
      node.style.display = inside ? '' : 'none';
      node.style.transform = `translate(${((p.x + 1) / 2) * w}px, ${((1 - p.y) / 2) * h}px)`;
    });
  };

  const fov = (): void => {
    if (!active) return;
    const slot = slots.get(active.section.id)!;
    slot.stage!.dataset.device = device;
    slot.stage!.dataset.room = room ? 'room' : 'void';
  };

  const activate = (id: string): void => {
    const slot = slots.get(id);
    if (!slot || slot.section.kind !== '3d' || !app) return;
    if (active?.section.id === id) return;
    const a = app;
    building = building.then(async () => {
      ready = false;
      active?.built?.dispose();
      for (const s of slots.values()) s.labels?.replaceChildren();
      setUiOverride(override);
      active = { section: slot.section, built: null };
      await bootApp(slot.stage!);
      try {
        active.built = (await slot.section.build?.(a, stageRoot)) ?? null;
      } catch (error) {
        console.error(`[gw] gallery: section ${id} failed`, error);
      }
      if (time !== null) holdAt(time);
      fov();
      camera();
      placeLabels();
      ready = true;
    });
  };

  const holdAt = (t: number): void => {
    if (!app) return;
    app.clock.freeze(true);
    stageRoot.traverse((o) => {
      const at = o.userData?.at as ((t: number) => void) | undefined;
      if (typeof at === 'function') at(t);
    });
  };

  // ---- controls
  controls.append(
    choice('Camera', ['overview', 'seat'], cameraMode, (v) => {
      cameraMode = v;
      camera();
    }),
    toggle('Room', room, (on) => {
      room = on;
      fov();
    }),
    toggle('High contrast', false, (on) => {
      override.highContrast = on;
      const id = active?.section.id;
      active = null;
      if (id) activate(id);
    }),
    toggle('Large text', false, (on) => {
      override.largeText = on;
      const id = active?.section.id;
      active = null;
      if (id) activate(id);
    }),
    toggle('Less motion', savedLessMotion, (on) => {
      store.settings.value = { ...store.settings.peek(), lessMotion: on };
    }),
    choice('Quality', ['high', 'medium', 'low'], 'high', (v) => {
      app?.world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * QUALITY[v].frameScale);
    }),
    choice('Device', ['none', 'quest', 'glasses'], device, (v) => {
      device = v;
      fov();
    }),
  );
  const slider = el('label', 'g-time');
  const range = el('input', 'g-range');
  range.type = 'range';
  range.min = '0';
  range.max = '5';
  range.step = '0.05';
  range.value = '0';
  const readout = el('span', 'g-time-value', 'live');
  range.addEventListener('input', () => {
    time = Number(range.value);
    readout.textContent = `t ${time.toFixed(2)} s`;
    holdAt(time);
  });
  const live = el('button', 'g-toggle', 'Live');
  live.type = 'button';
  live.addEventListener('click', () => {
    time = null;
    readout.textContent = 'live';
    app?.clock.freeze(false);
  });
  slider.append(el('span', '', 'Time'), range, readout, live);
  controls.append(slider);

  // Settings changed for the preview are put back when the page goes.
  window.addEventListener('pagehide', () => {
    store.settings.value = { ...store.settings.peek(), lessMotion: savedLessMotion };
  });

  // ---- which 3D section is in view
  const seen = new Map<string, number>();
  const watch = new IntersectionObserver(
    (records) => {
      for (const r of records) seen.set((r.target as HTMLElement).dataset.section!, r.intersectionRatio);
      let best: string | null = null;
      let ratio = 0.35;
      for (const [id, v] of seen) if (v > ratio && slots.get(id)?.section.kind === '3d') [best, ratio] = [id, v];
      if (best) activate(best);
    },
    { threshold: [0, 0.35, 0.6, 0.9] },
  );
  for (const s of slots.values()) if (s.section.kind === '3d') watch.observe(s.el);

  const tick = (): void => {
    camera();
    placeLabels();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Each stage fits the window under the sticky bar, so a whole section is one frame.
  const fitStages = (): void => {
    const h = Math.max(300, window.innerHeight - bar.offsetHeight - 24);
    for (const s of slots.values()) if (s.stage) s.stage.style.height = `${h}px`;
  };
  fitStages();
  window.addEventListener('resize', fitStages);

  const first = params.query.get('section');
  if (first && slots.has(first)) {
    const slot = slots.get(first)!;
    const at = (slot.stage ?? slot.el).getBoundingClientRect().top + window.scrollY - bar.offsetHeight - 12;
    window.scrollTo(0, Math.max(0, at));
    activate(first);
  }
  void BUDGET;
  void COLOR;
}
