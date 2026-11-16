/**
 * The scene: one IWSDK World and one canvas per page. This module is the heavy chunk
 * (Three.js and IWSDK); /app loads it with `await import(...)` after its first paint.
 *
 * bootApp creates the World and the `App` every feature receives, wires the session
 * modes and installs the features found in their install.ts files (./features.ts).
 *
 *   desk    no session: the camera sits where the person would (eyes 1.15 m, 9° down)
 *   void    immersive-ar under the opaque sky of the kit, or immersive-vr
 *   room    immersive-ar with passthrough: the sky dissolves, planes of the room are used
 *
 * A session can start in three ways: `app.session.enter()` from the page, the headset
 * browser, or the emulator (`npx iwsdk xr enter`). All three end in the same handler, so
 * the mode and the seated frame never depend on who started it.
 */
import { SessionMode, VisibilityState, World, type Object3D } from '@iwsdk/core';
import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals-core';
import projectOptions from 'virtual:iwsdk-project';
import type { Doc, InputKind, Mode, Plot, Project, ProjectId } from '../../agents/types';
import type { AppClock } from '../clock';
import { debugEnabled, registerDebug } from '../debug';
import { createDocs } from '../docs';
import { persist } from '../persist';
import { store, type Store } from '../store';
import { installFeatures } from './features';
import type { SeatFrame } from './place';
import { createSessionFlow, type ImmersiveMode, type XRSessionKind } from './session';
import { createSurfaces, type Surface, type SurfaceKind } from './surfaces';

export { XR_UNAVAILABLE, XRUnavailableError } from './session';
export type { SeatFrame } from './place';
export type { Surface } from './surfaces';

/**
 * Objects the home feature (src/views/home/, order 10) puts on `app` from the kit
 * (src/kit/world/, package 01.2). Declared open here so this file builds before the kit
 * exists; the kit's own types are the real contract (PLAN "Набор ремесла").
 */
export interface Bench {
  readonly root?: Object3D;
}
export interface InboxBlock {
  readonly root?: Object3D;
}
export interface IslandView {
  readonly root?: Object3D;
}

export type PlotStore = { all(): Plot[]; save(plot: Plot): void; remove(projectId: ProjectId): void; recount(projectId: ProjectId): void };
export type Interaction = { type: 'grab' | 'drop' | 'select' | 'pull' | 'reveal'; target: string; input: InputKind; at: number };

/**
 * The roots every view hangs its objects on. All of them except `level` live in the
 * seated frame: origin at the eyes at entry, -Z ahead, +Y up, metres (the bench top is
 * at y = -0.32). `level` is the level root of IWSDK (sky and environment components go
 * there).
 */
export type Roots = {
  level: Object3D;
  /** The seated frame itself; moved by `recenter`. */
  seat: Object3D;
  home: Object3D;
  bench: Object3D;
  arc: Object3D;
  ring: Object3D;
  work: Object3D;
  ui: { desk: Object3D; hand: Object3D; side: Object3D };
};

export type App = {
  world: World;
  session: {
    mode: Signal<Mode>;
    enter(mode: 'void' | 'room'): Promise<void>;
    setMode(mode: 'void' | 'room'): void;
    /** world.visibilityState and the tab visibility together. */
    visible: ReadonlySignal<boolean>;
    /** Whether Room is possible in the running session (passthrough). */
    roomPossible(): boolean;
    exit(): void;
  };
  store: Store;
  clock: AppClock;
  /** The seated frame; recomputed by the intent `recenter`. */
  seat: SeatFrame;
  /** Recomputes the seated frame from the current head pose and moves the roots. */
  recenter(): void;
  roots: Roots;
  bench: Bench;
  inbox: InboxBlock;
  island: IslandView;
  docs(project: Project): Promise<Doc[]>;
  provideDocs(projectId: ProjectId, docs: Doc[]): void;
  surfaces: { find(kind: SurfaceKind): Surface | null; onChange(fn: () => void): () => void };
  plots: PlotStore;
  interactions: { on(fn: (e: Interaction) => void): () => void; emit(e: Interaction): void };
  /** True once the required features installed: the page may reveal the live world. */
  ready: Signal<boolean>;
};

/** Thrown by bootApp when the browser cannot give a WebGL 2 context. */
export class WebGLUnavailableError extends Error {
  readonly code = 'webgl-unavailable';
  constructor(cause?: unknown) {
    super('webgl-unavailable', { cause });
    this.name = 'WebGLUnavailableError';
  }
}

/** Above this the extra pixels cost more than they show. */
const MAX_PIXEL_RATIO = 2;

let booted: Promise<App> | null = null;
let attach: ((container: HTMLElement) => void) | null = null;

/**
 * Creates the scene inside `container`, or moves the existing one there. There is one
 * World and one canvas per page: a second call returns the same App.
 */
export function bootApp(container: HTMLElement): Promise<App> {
  if (booted) {
    return booted.then((app) => {
      attach?.(container);
      return app;
    });
  }
  booted = create(container).catch((error: unknown) => {
    booted = null;
    attach = null;
    throw error;
  });
  return booted;
}

function hasWebGL2(): boolean {
  try {
    const probe = document.createElement('canvas').getContext('webgl2');
    if (!probe) return false;
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/**
 * A field of `App` that a later feature fills in. Until then reading it fails with a
 * message that names the owner instead of handing out `undefined`.
 */
export function lateField(app: object, key: string, owner: string): void {
  Object.defineProperty(app, key, {
    configurable: true,
    enumerable: true,
    get(): never {
      throw new Error(`app.${key} is not ready: ${owner} creates it, and it has not run`);
    },
    set(value: unknown) {
      Object.defineProperty(app, key, { value, writable: true, configurable: true, enumerable: true });
    },
  });
}

async function create(container: HTMLElement): Promise<App> {
  if (!hasWebGL2()) throw new WebGLUnavailableError();

  let world: World;
  try {
    // With debug hooks on (dev, the scenario build, ?debug=1) the session offer stays
    // open, because the emulator's `xr enter` can only accept a session the page offers.
    // Everywhere else the manifest rule holds (offer "none"): a session starts only from
    // the person's own action.
    const xr = projectOptions.xr;
    const options = debugEnabled() && xr ? { ...projectOptions, xr: { ...xr, offer: 'always' as const } } : projectOptions;
    world = await World.create(container, options);
  } catch (error) {
    throw hasWebGL2() ? error : new WebGLUnavailableError(error);
  }

  // ---- canvas size follows its container, not the window

  let host = container;
  const fit = (): void => {
    if (world.renderer.xr.isPresenting) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    world.renderer.setSize(width, height);
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
  };
  const sizes = new ResizeObserver(fit);
  sizes.observe(host);
  // IWSDK sizes the canvas to the window on every window resize; this listener runs after it.
  window.addEventListener('resize', fit);
  world.addCleanup(() => {
    sizes.disconnect();
    window.removeEventListener('resize', fit);
  });
  attach = (next: HTMLElement): void => {
    if (next === host) return;
    sizes.unobserve(host);
    host = next;
    host.appendChild(world.renderer.domElement);
    sizes.observe(host);
    fit();
  };
  fit();

  // ---- visibility: the tab and the headset together; scenarios may override it

  const tabVisible = signal(typeof document === 'undefined' ? true : !document.hidden);
  const onTab = (): void => {
    tabVisible.value = !document.hidden;
  };
  document.addEventListener('visibilitychange', onTab);
  world.addCleanup(() => document.removeEventListener('visibilitychange', onTab));
  const forced = signal<'hidden' | 'blurred' | 'visible' | null>(null);
  const visible = computed(() => {
    if (forced.value) return forced.value === 'visible';
    const state = world.visibilityState.value;
    return tabVisible.value && state !== VisibilityState.VisibleBlurred && (state as string) !== 'hidden';
  });

  // ---- sessions

  const xrManager = world.renderer.xr;
  let requested: XRSessionKind | null = null;
  const support = new Map<XRSessionKind, Promise<boolean>>();
  const supported = (kind: XRSessionKind): Promise<boolean> => {
    let answer = support.get(kind);
    if (!answer) {
      answer = (async () => {
        try {
          return (await navigator.xr?.isSessionSupported(kind)) === true;
        } catch {
          return false;
        }
      })();
      support.set(kind, answer);
    }
    return answer;
  };
  // Ask now, so that enter() reaches requestSession while the click still counts as a gesture.
  void supported('immersive-ar');
  void supported('immersive-vr');
  const forget = (): void => support.clear();
  navigator.xr?.addEventListener('devicechange', forget);
  world.addCleanup(() => navigator.xr?.removeEventListener('devicechange', forget));

  /** Resolves when IWSDK has finished the session request it is working on. */
  const settled = (): Promise<void> =>
    new Promise((resolve) => {
      const check = (): void => {
        if (world.sessionRequestPending) setTimeout(check, 20);
        else resolve();
      };
      check();
    });

  const kindOf = (session: XRSession): XRSessionKind => (session.environmentBlendMode === 'opaque' ? 'immersive-vr' : 'immersive-ar');

  const flow = createSessionFlow({
    active: () => {
      const session = world.session ?? xrManager.getSession();
      return session ? (requested ?? kindOf(session)) : null;
    },
    supported,
    request: async (kind) => {
      await settled();
      if (world.session) return true;
      requested = kind;
      try {
        world.launchXR({ sessionMode: kind === 'immersive-ar' ? SessionMode.ImmersiveAR : SessionMode.ImmersiveVR });
      } catch (error) {
        console.error('[gw] XR session request failed', error);
      }
      await settled();
      if (world.session) return true;
      requested = null;
      return false;
    },
    end: () => world.exitXR(),
    setMode: (mode) => {
      store.mode.value = mode;
    },
  });

  const docs = createDocs(persist);
  const app = {
    world,
    session: {
      mode: store.mode,
      enter: (mode: ImmersiveMode) => flow.enter(mode),
      setMode: (mode: ImmersiveMode) => {
        flow.setMode(mode);
      },
      visible,
      roomPossible: () => flow.roomPossible(),
      exit: () => flow.exit(),
    },
    store,
    docs: docs.docs,
    provideDocs: docs.provideDocs,
    ready: signal(false),
  } as unknown as App;
  for (const key of ['clock', 'seat', 'roots', 'plots', 'interactions'] as const) lateField(app, key, 'src/app/core/install.ts (order 0)');
  app.recenter = () => {
    throw new Error('app.recenter is not ready: src/app/core/install.ts (order 0) sets it');
  };
  for (const key of ['bench', 'inbox', 'island'] as const) lateField(app, key, 'src/views/home/install.ts (order 10)');
  app.surfaces = createSurfaces(world, () => app.seat);

  const onSessionStart = (): void => {
    const session = xrManager.getSession();
    if (!session) return;
    const kind = requested ?? kindOf(session);
    requested = kind;
    flow.started(kind);
  };
  const onSessionEnd = (): void => {
    requested = null;
    flow.ended();
    // Three restores the canvas after the session; the container may have changed meanwhile.
    setTimeout(fit, 0);
  };
  xrManager.addEventListener('sessionstart', onSessionStart);
  xrManager.addEventListener('sessionend', onSessionEnd);
  world.addCleanup(() => {
    xrManager.removeEventListener('sessionstart', onSessionStart);
    xrManager.removeEventListener('sessionend', onSessionEnd);
  });

  registerDebug('app', app);
  registerDebug('session', { enter: app.session.enter, setMode: app.session.setMode, mode: store.mode });
  registerDebug('visibility', { force: (state: 'hidden' | 'blurred' | 'visible' | null) => (forced.value = state) });
  if (debugEnabled()) {
    const { installProbe } = await import('./probe');
    installProbe(app);
  }
  await installFeatures(app);
  app.ready.value = true;
  return app;
}

