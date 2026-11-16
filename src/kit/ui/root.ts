/**
 * Roots of the panels (task 01.3.2). uikit draws every root as one call for its panels
 * plus one per font weight, so the bench panels live in three roots and not one each:
 *
 *   desk   lies in the plane of the slab: run card, tray labels, code card, class errors
 *   hand   stands at the hand, tilted to the eyes: call card, slip sheet, note, ask card,
 *          confirm card, code pad
 *   side   the service column and the work view: settings, table card, wishes, essay
 *          sheet, pair pages, reading line
 *
 * and each station board of the arc has a root of its own (`board:<stationId>`). A root
 * with both weights costs three calls, with one weight two (DESIGN "Бюджет отрисовки").
 *
 * `mountPanel(rootName, panel, at)` (after `bindInteract(app)`) puts a panel into a root: inside a root, panels sit
 * at absolute places in the root's plane. Every root is created with `fontFamilies`
 * passed explicitly (otherwise the production build looks for the bundled Inter), gets
 * RayInteractable and PokeInteractable (rays and fingertips), blocks the dwell pointer
 * and is updated once a frame by one system.
 */
import { Group, Object3D, Vector3, createSystem, type World } from '@iwsdk/core';
import { Component, Container, reversePainterSortStable } from '@pmndrs/uikit';
import type { App } from '../../app/boot/world';
import { FONT_FAMILIES, FONT_FAMILY } from '../../app/boot/fonts';
import { zone } from '../../app/perf/zone';
import { LAYOUT, SEAT, polar, type Zone } from '../../tokens/tokens';
import { addBlocker } from '../../interact/head-pointer';
import { current, makeInteractable, markRayRoot, whenAttached } from '../../interact/runtime';

/** Layout units are millimetres: 0.001 m per uikit pixel. */
export const PIXEL = 0.001;

/** Properties every root receives. */
export function rootProps(widthMm: number, heightMm: number): Record<string, unknown> {
  return {
    sizeX: widthMm * PIXEL,
    sizeY: heightMm * PIXEL,
    pixelSize: PIXEL,
    fontFamilies: FONT_FAMILIES,
    fontFamily: FONT_FAMILY,
    flexDirection: 'column',
    alignItems: 'flex-start',
  };
}

// ---------------------------------------------------------------- the frame loop of uikit

const roots = new Set<Container>();
const tickers = new Set<(dtMs: number) => void>();
const prepared = new WeakSet<World>();

class UiSystem extends createSystem({}) {
  update(delta: number): void {
    const ms = delta * 1000;
    for (const fn of tickers) {
      try {
        fn(ms);
      } catch (error) {
        console.error('[gw] ui: a ticker failed', error);
      }
    }
    for (const root of roots) root.update(ms);
  }
}

/** Prepares a World for uikit: clipping, the transparent sort order and the update system. */
export function prepareUi(world: World): void {
  if (prepared.has(world)) return;
  prepared.add(world);
  world.renderer.localClippingEnabled = true;
  world.renderer.setTransparentSort(reversePainterSortStable);
  world.registerSystem(UiSystem);
}

/** Per-frame function of a panel (counters, countdown bars); returns its removal. */
export function uiTicker(fn: (dtMs: number) => void): () => void {
  tickers.add(fn);
  return () => {
    tickers.delete(fn);
  };
}

/** Registers a root container: updated every frame, answering rays and fingertips. */
export function registerRoot(root: Container): () => void {
  roots.add(root);
  markRayRoot(root);
  const unblock = addBlocker(root);
  whenAttached(root, ({ world }) => {
    prepareUi(world);
    makeInteractable(world, root, true);
  });
  return () => {
    roots.delete(root);
    unblock();
  };
}

// ---------------------------------------------------------------- panels

/** What `mountPanel` takes: a container with its size in mm. */
export type PanelLike = { el: Container; readonly width: number; readonly height: number };

/** A panel on its own: a root sized to it (the gallery and one-off panels). */
export function asRoot(panel: PanelLike): Container {
  const root = new Container(rootProps(panel.width, panel.height) as never);
  root.add(panel.el);
  return root;
}

// ---------------------------------------------------------------- the named roots

export type RootName = 'desk' | 'hand' | 'side' | `board:${string}`;

/** Where a panel goes inside its root: metres in the root's plane, x right, y up from the root's centre. */
export type At = { x: number; y: number };

type Named = { root: Container; holder: Object3D; w: number; h: number; panels: Map<PanelLike, At> };
const named = new Map<string, Named>();

/** Planes of the three bench roots (DESIGN "Пространство в шлеме"). */
const PLANES: Record<'desk' | 'hand' | 'side', { w: number; h: number; zone: Zone; place(holder: Object3D): void }> = {
  desk: {
    // The slab plane, 1 mm above the top, x right and y forward.
    w: 1.0,
    h: 0.5,
    zone: 'bench-panels',
    place: (o) => {
      o.position.set(0, -SEAT.benchBelowEyes + 0.001, -LAYOUT.bench.dist);
      o.rotation.set(-Math.PI / 2, 0, 0);
    },
  },
  hand: {
    // Around the card at the hand, turned to face the eyes.
    w: 0.8,
    h: 0.6,
    zone: 'bench-panels',
    place: (o) => {
      const p = polar(0, LAYOUT.askCard.dist, -SEAT.benchBelowEyes + 0.02 + LAYOUT.askCard.h / 2);
      o.position.set(p.x, p.y, p.z);
      o.lookAt(0, 0, 0);
    },
  },
  side: {
    // The service column right of the bench, facing the eyes.
    w: 0.6,
    h: 0.7,
    zone: 'bench-panels',
    place: (o) => {
      const p = polar(30, 0.62, -0.12);
      o.position.set(p.x, p.y, p.z);
      o.lookAt(0, 0, 0);
    },
  },
};

function namedRoot(app: App, name: RootName, standalone?: { position: Vector3; w: number; h: number }): Named {
  let r = named.get(name);
  if (r) return r;
  const plane = name.startsWith('board:') ? null : PLANES[name as 'desk' | 'hand' | 'side'];
  const w = plane?.w ?? standalone?.w ?? 0.5;
  const h = plane?.h ?? standalone?.h ?? 0.4;
  const holder = zone(new Group(), plane?.zone ?? 'boards');
  holder.name = `ui-root:${name}`;
  const root = new Container({ ...rootProps(w * 1000, h * 1000), alignItems: 'stretch' } as never);
  root.name = `ui:${name}`;
  holder.add(root);
  const parent = name === 'desk' ? app.roots.ui.desk : name === 'hand' ? app.roots.ui.hand : name === 'side' ? app.roots.ui.side : app.roots.arc;
  if (plane) plane.place(holder);
  else if (standalone) {
    holder.position.copy(standalone.position);
    holder.lookAt(0, standalone.position.y, 0);
  }
  parent.add(holder);
  registerRoot(root);
  r = { root, holder, w, h, panels: new Map() };
  named.set(name, r);
  return r;
}

function place(r: Named, panel: PanelLike, at: At): void {
  const left = (at.x + r.w / 2) * 1000 - panel.width / 2;
  const top = (r.h / 2 - at.y) * 1000 - panel.height / 2;
  panel.el.setProperties({ positionType: 'absolute', positionLeft: left, positionTop: top } as never);
}

/**
 * Puts a panel into a root. `at` is the place in the root's plane (metres from its
 * centre). A board root takes `at.position` (its 3D place, facing the seat) on first use.
 * Returns `move(at)` and `unmount()`.
 */
export function mountPanel(
  rootName: RootName,
  panel: PanelLike,
  at: At & { position?: Vector3; size?: { w: number; h: number } },
): { move(at: At): void; unmount(): void } {
  const app = current()?.app;
  if (!app) throw new Error('mountPanel: the input layer is not bound to the app yet (bindInteract)');
  const r = namedRoot(app, rootName, at.position ? { position: at.position, w: at.size?.w ?? panel.width / 1000, h: at.size?.h ?? panel.height / 1000 } : undefined);
  place(r, panel, at);
  r.root.add(panel.el);
  r.panels.set(panel, at);
  return {
    move(next) {
      r.panels.set(panel, next);
      place(r, panel, next);
    },
    unmount() {
      r.panels.delete(panel);
      r.root.remove(panel.el);
    },
  };
}

/** Moves a whole root (the hand root follows the pinch, 10 cm above it). */
export function moveRoot(rootName: RootName, position: Vector3, faceSeat = true): void {
  const r = named.get(rootName);
  if (!r) return;
  r.holder.position.copy(position);
  if (faceSeat) r.holder.lookAt(0, 0, 0);
}

// ---------------------------------------------------------------- the gallery

const galleryRoots: (() => void)[] = [];

/** Registers every uikit root inside an object built for the gallery. */
export function mountGalleryObject(app: App, obj: Object3D): void {
  prepareUi(app.world);
  obj.traverse((o) => {
    if (o instanceof Container && !(o.parent instanceof Component)) galleryRoots.push(registerRoot(o as unknown as Container));
  });
}

export function releaseGalleryObjects(app: App): void {
  void app;
  for (const off of galleryRoots.splice(0)) off();
}
