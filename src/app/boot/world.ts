/**
 * The scene: one IWSDK World and one canvas per page. This module is the heavy chunk
 * (Three.js and IWSDK); the island page loads it with `await import(...)` after its
 * first paint.
 *
 * bootApp creates the World, the clock, the roots and the session flow, and returns the
 * `App` that the experience (src/app/wayfolk.ts) and the input layer receive.
 *
 *   desk    no session: the camera sits on the island seat, mouse or touch looks around
 *   room    immersive-ar while the person still sees their room (the entry and the farewell)
 *   void    inside the world: immersive-ar under the opaque sky, or immersive-vr
 *
 * A session can start in three ways: `app.session.enter()` from the page, the headset
 * browser, or the emulator (`npx iwsdk xr enter`). All three end in the same handler.
 */
import { Object3D, SessionMode, VisibilityState, World, createSystem } from '@iwsdk/core';
import { computed, signal, type ReadonlySignal, type Signal } from '@preact/signals-core';
import projectOptions from 'virtual:iwsdk-project';
import { createClock, type AppClock } from '../clock';
import { debugEnabled, registerDebug, registerTest } from '../debug';
import { parseAppParams, type AppParams } from '../params';
import { measure } from '../perf/info';
import { store, type InputKind, type Mode, type Store } from '../store';
import { deskSeat, type SeatFrame } from './place';
import { createSessionFlow, type ImmersiveMode, type XRSessionKind } from './session';
import { createSurfaces, type Surface, type SurfaceKind } from './surfaces';

export { XR_UNAVAILABLE, XRUnavailableError } from './session';
export type { SeatFrame } from './place';
export type { Surface } from './surfaces';

export type Interaction = { type: 'grab' | 'drop' | 'select' | 'pull' | 'reveal'; target: string; input: InputKind; at: number };

/**
 * Roots of the scene. `seat` is the seated frame of the person (eyes at entry, -Z
 * ahead); `island` holds the world module's root; `fx` the app's own effects (clouds,
 * veil, ghost footprint); `hud` follows the head (vignette).
 */
export type Roots = {
  level: Object3D;
  seat: Object3D;
  island: Object3D;
  fx: Object3D;
  ui: { desk: Object3D; hand: Object3D; side: Object3D };
};

export type App = {
  world: World;
  session: {
    mode: Signal<Mode>;
    enter(mode?: ImmersiveMode): Promise<void>;
    setMode(mode: ImmersiveMode): void;
    /** world.visibilityState and the tab visibility together. */
    visible: ReadonlySignal<boolean>;
    /** Whether passthrough is possible in the running session. */
    roomPossible(): boolean;
    /** The kind of the running session, or null at the desk. */
    kind(): XRSessionKind | null;
    exit(): void;
  };
  store: Store;
  clock: AppClock;
  params: AppParams;
  seat: SeatFrame;
  recenter(): void;
  roots: Roots;
  surfaces: { find(kind: SurfaceKind): Surface | null; onChange(fn: () => void): () => void };
  interactions: { on(fn: (e: Interaction) => void): () => void; emit(e: Interaction): void };
  /** Adds a per-frame function (dt in seconds, now in ms of application time). */
  everyFrame(fn: (dt: number, now: number) => void): () => void;
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

const MAX_PIXEL_RATIO = 2;

let booted: Promise<App> | null = null;

export function bootApp(container: HTMLElement): Promise<App> {
  booted ??= create(container).catch((error: unknown) => {
    booted = null;
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

const tickers = new Set<(dt: number, now: number) => void>();
let frameClock: AppClock | null = null;

/** Ticks the clock and runs every per-frame function of the app. */
class FrameSystem extends createSystem({}) {
  update(delta: number): void {
    const clock = frameClock;
    if (!clock) return;
    clock.tick();
    const now = clock.now();
    const dt = Math.min(0.1, Math.max(0, delta));
    for (const fn of tickers) {
      try {
        fn(dt, now);
      } catch (error) {
        console.error('[wf] a frame step failed', error);
      }
    }
  }
}

async function create(container: HTMLElement): Promise<App> {
  if (!hasWebGL2()) throw new WebGLUnavailableError();
  const params = parseAppParams(location.search, debugEnabled());

  let world: World;
  try {
    // With debug hooks on the session offer stays open, because the emulator's
    // `xr enter` can only accept a session the page offers.
    const xr = projectOptions.xr;
    const options = debugEnabled() && xr ? { ...projectOptions, xr: { ...xr, offer: 'always' as const } } : projectOptions;
    world = await World.create(container, options);
  } catch (error) {
    throw hasWebGL2() ? error : new WebGLUnavailableError(error);
  }

  // ---- canvas size follows its container
  const fit = (): void => {
    if (world.renderer.xr.isPresenting) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    world.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
    world.renderer.setSize(width, height);
    world.camera.aspect = width / height;
    world.camera.updateProjectionMatrix();
  };
  const sizes = new ResizeObserver(fit);
  sizes.observe(container);
  window.addEventListener('resize', fit);
  world.addCleanup(() => {
    sizes.disconnect();
    window.removeEventListener('resize', fit);
  });
  fit();

  // ---- clock and the frame loop
  const clock = createClock();
  if (params.capture) clock.freeze(true);
  frameClock = clock;
  world.registerSystem(FrameSystem);
  store.pace.value = params.pace;

  // ---- visibility
  const tabVisible = signal(!document.hidden);
  const onTab = (): void => {
    tabVisible.value = !document.hidden;
  };
  document.addEventListener('visibilitychange', onTab);
  const forced = signal<'hidden' | 'blurred' | 'visible' | null>(null);
  const visible = computed(() => {
    if (forced.value) return forced.value === 'visible';
    const state = world.visibilityState.value;
    return tabVisible.value && state !== VisibilityState.VisibleBlurred && (state as string) !== 'hidden';
  });

  // ---- roots
  const node = (name: string, parent?: Object3D): Object3D => {
    const object = new Object3D();
    object.name = name;
    if (parent) parent.add(object);
    else world.createTransformEntity(object, { parent: world.sceneEntity, persistent: true });
    return object;
  };
  const seatRoot = node('root:seat');
  const ui = node('root:ui');
  const roots: Roots = {
    level: world.getActiveRoot(),
    seat: seatRoot,
    island: node('root:island'),
    fx: node('root:fx'),
    ui: { desk: node('root:ui-desk', ui), hand: node('root:ui-hand', ui), side: node('root:ui-side', ui) },
  };

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
  void supported('immersive-ar');
  void supported('immersive-vr');

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
        console.error('[wf] XR session request failed', error);
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

  const listeners = new Set<(e: Interaction) => void>();
  const app: App = {
    world,
    session: {
      mode: store.mode,
      enter: (mode: ImmersiveMode = 'room') => flow.enter(mode),
      setMode: (mode) => {
        flow.setMode(mode);
      },
      visible,
      roomPossible: () => flow.roomPossible(),
      kind: () => {
        const session = world.session ?? xrManager.getSession();
        return session ? (requested ?? kindOf(session)) : null;
      },
      exit: () => flow.exit(),
    },
    store,
    clock,
    params,
    seat: deskSeat(),
    recenter: () => undefined,
    roots,
    surfaces: { find: () => null, onChange: () => () => undefined },
    interactions: {
      on(fn) {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      emit(e) {
        for (const fn of [...listeners]) {
          try {
            fn(e);
          } catch (error) {
            console.error('[wf] interaction listener failed', error);
          }
        }
      },
    },
    everyFrame(fn) {
      tickers.add(fn);
      return () => {
        tickers.delete(fn);
      };
    },
    ready: signal(false),
  };
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
    setTimeout(fit, 0);
  };
  xrManager.addEventListener('sessionstart', onSessionStart);
  xrManager.addEventListener('sessionend', onSessionEnd);

  registerDebug('app', app);
  registerDebug('clock', clock);
  registerDebug('params', params);
  registerDebug('perf', { info: () => measure(world) });
  registerDebug('seat', () => app.seat);
  registerDebug('session', { enter: app.session.enter, setMode: app.session.setMode, mode: store.mode });
  registerDebug('visibility', { force: (state: 'hidden' | 'blurred' | 'visible' | null) => (forced.value = state) });
  registerTest('setVisibility', (state: 'hidden' | 'blurred' | 'visible') => {
    forced.value = state === 'visible' ? null : state;
  });
  if (debugEnabled()) {
    const { installProbe } = await import('./probe');
    installProbe(app);
  }
  return app;
}
