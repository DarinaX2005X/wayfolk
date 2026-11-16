/**
 * The required core feature (order 0): the roots every view hangs on, the seated frame,
 * the application clock, the frame measure, the local plot store and the interaction
 * stream. The home feature (src/views/home/, order 10) builds the bench and the island on
 * top of it.
 *
 * Roots live in the seated frame (src/app/boot/place.ts): in the browser it is fixed at
 * the eyes of a seated person; in a session it is taken from the head on the first frame
 * with a pose, and the intent `recenter` takes it again.
 */
import { MathUtils, Object3D, createSystem, type World } from '@iwsdk/core';
import type { Plot, Project, ProjectId } from '../../agents/types';
import { SEAT } from '../../tokens/tokens';
import type { App, Interaction, PlotStore, Roots } from '../boot/world';
import { installFonts } from '../boot/fonts';
import { deskSeat, seatFrom, worldToSeat, type SeatFrame } from '../boot/place';
import type { createSurfaces } from '../boot/surfaces';
import { createClock, type AppClock } from '../clock';
import { debugEnabled, registerDebug, registerTest } from '../debug';
import { parseAppParams } from '../params';
import { measure } from '../perf/info';
import { zone } from '../perf/zone';
import { persist } from '../persist';

export const order = 0;

/** The clock ticks once per frame, in desk mode and in a session alike. */
let tickClock: AppClock | null = null;
class ClockSystem extends createSystem({}) {
  update(): void {
    tickClock?.tick();
  }
}

function makeRoots(world: World): Roots {
  const level = world.getActiveRoot();
  const seat = new Object3D();
  seat.name = 'root:seat';
  const seatEntity = world.createTransformEntity(seat, { parent: world.sceneEntity, persistent: true });
  const child = (name: string, parent = seatEntity): { object: Object3D; entity: ReturnType<World['createTransformEntity']> } => {
    const object = new Object3D();
    object.name = `root:${name}`;
    const entity = world.createTransformEntity(object, { parent, persistent: true });
    return { object, entity };
  };
  const ui = child('ui');
  return {
    level,
    seat,
    home: child('home').object,
    bench: child('bench').object,
    arc: child('arc').object,
    ring: child('ring').object,
    work: child('work').object,
    ui: { desk: child('ui-desk', ui.entity).object, hand: child('ui-hand', ui.entity).object, side: child('ui-side', ui.entity).object },
  };
}

/** Plots of the local island, kept in store.world and IndexedDB until stage 04 brings the world server. */
function localPlots(app: App): PlotStore {
  const { store } = app;
  const save = (): void => {
    const world = store.world.peek();
    if (!world) return;
    void persist()
      .then((p) => p.world.save(world))
      .catch((error: unknown) => console.error('[gw] the island could not be saved on this device', error));
  };
  const ensure = () => {
    let world = store.world.peek();
    if (!world) {
      world = { name: 'local', title: 'My island', createdAt: new Date(app.clock.wall()).toISOString(), rev: 0, plots: [], rotation: 0, onServer: false };
    }
    return world;
  };
  const write = (plots: Plot[]): void => {
    const world = ensure();
    store.world.value = { ...world, plots, rev: world.rev + 1 };
    save();
  };
  return {
    all: () => store.world.peek()?.plots ?? [],
    save(plot) {
      const rest = (store.world.peek()?.plots ?? []).filter((p) => p.projectId !== plot.projectId && p.slot !== plot.slot);
      write([...rest, plot].sort((a, b) => a.slot - b.slot));
    },
    remove(projectId: ProjectId) {
      write((store.world.peek()?.plots ?? []).filter((p) => p.projectId !== projectId));
    },
    recount(projectId: ProjectId) {
      const project = store.projects.peek().get(projectId);
      const plots = store.world.peek()?.plots ?? [];
      const plot = plots.find((p) => p.projectId === projectId);
      if (!project || !plot) return;
      const { open, total } = openItems(project.result);
      write(plots.map((p) => (p === plot ? { ...p, open, total } : p)));
    },
  };
}

/** Open points of a result: contradictions left to review and questions without an answer, and so on. */
export function openItems(result: Project['result']): { open: number; total: number } {
  if (!result) return { open: 0, total: 0 };
  if ('contradictions' in result) {
    const live = result.contradictions.filter((c) => c.state === 'open');
    return { open: live.filter((c) => c.review === 'open').length + result.open.length, total: live.length + result.open.length };
  }
  if ('wishes' in result) {
    const wishes = result.wishes.filter((w) => w.status !== 'replaced');
    return { open: wishes.filter((w) => w.status === 'needs-you' || w.status === 'broken').length, total: wishes.length };
  }
  if ('scores' in result) {
    return { open: result.scores.filter((s) => s.review.length > 0).length, total: result.scores.length };
  }
  return { open: 0, total: 0 };
}

export function install(app: App): void {
  const { world, store } = app;
  const params = parseAppParams(location.search, debugEnabled());
  installFonts();

  // ---- clock
  const clock = createClock();
  if (params.capture) clock.freeze(true);
  tickClock = clock;
  world.registerSystem(ClockSystem);
  app.clock = clock;
  store.pace.value = params.pace;

  // ---- roots and the seated frame
  const roots = makeRoots(world);
  app.roots = roots;
  const place = (seat: SeatFrame): void => {
    app.seat = seat;
    roots.seat.position.set(seat.origin[0], seat.origin[1], seat.origin[2]);
    roots.seat.rotation.set(0, seat.yaw, 0);
    roots.seat.updateMatrixWorld(true);
  };

  const aimDesk = (): void => {
    const camera = world.camera;
    camera.position.set(0, SEAT.desk.eyeHeight, 0);
    camera.rotation.set(MathUtils.degToRad(SEAT.desk.pitchDeg), 0, 0, 'YXZ');
    camera.fov = SEAT.desk.fovDeg;
    camera.updateProjectionMatrix();
  };
  place(deskSeat());
  aimDesk();

  // In a session: the frame from the head on the first frame that has a pose.
  let lastPose: { head: [number, number, number]; forward: [number, number, number]; up: [number, number, number] } | null = null;
  let wantSeat = false;
  world.onXRFrame((frame) => {
    const space = world.xrReferenceSpace;
    const pose = space ? frame.getViewerPose(space) : null;
    if (!pose) return;
    const { position: p, orientation: q } = pose.transform;
    // Rotate -Z and +Y by the head orientation (the player rig stays at the origin).
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const forward: [number, number, number] = [-(2 * (x * z + w * y)), -(2 * (y * z - w * x)), -(1 - 2 * (x * x + y * y))];
    const up: [number, number, number] = [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)];
    lastPose = { head: [p.x, p.y, p.z], forward, up };
    if (wantSeat) {
      wantSeat = false;
      place(seatFrom(lastPose.head, lastPose.forward, lastPose.up, clock.now()));
    }
  });
  let previous = store.mode.peek();
  store.mode.subscribe((mode) => {
    if (mode !== 'desk' && previous === 'desk') wantSeat = true;
    if (mode === 'desk' && previous !== 'desk') {
      lastPose = null;
      place(deskSeat());
      aimDesk();
    }
    previous = mode;
  });
  app.recenter = () => {
    if (store.mode.peek() === 'desk') {
      place(deskSeat());
      aimDesk();
    } else if (lastPose) {
      place(seatFrom(lastPose.head, lastPose.forward, lastPose.up, clock.now()));
    } else {
      wantSeat = true;
    }
  };

  // ---- local plots and the interaction stream
  app.plots = localPlots(app);
  void persist()
    .then((p) => p.world.load())
    .then((saved) => {
      if (saved && !store.world.peek()) store.world.value = saved;
    })
    .catch((error: unknown) => console.error('[gw] the island could not be read on this device', error));
  const listeners = new Set<(e: Interaction) => void>();
  app.interactions = {
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
          console.error('[gw] interaction listener failed', error);
        }
      }
    },
  };

  // Everything the input layer draws under the player rig (hands, rays) counts as the hands zone.
  zone(world.player, 'hands');

  // ---- debug hooks
  registerDebug('clock', clock);
  registerDebug('perf', { info: () => measure(world) });
  registerDebug('params', params);
  registerDebug('seat', () => app.seat);
  registerDebug('surfaces', app.surfaces);
  // The planes of the room as the seated person sees them: for tests/xr/README and checks.
  registerDebug('planes', () =>
    (app.surfaces as ReturnType<typeof createSurfaces>).list().map((p) => {
      const [x, , z] = worldToSeat(app.seat, p.center);
      return {
        label: p.label,
        orientation: p.orientation,
        width: Math.round(p.width * 100) / 100,
        height: Math.round(p.height * 100) / 100,
        distance: Math.round(Math.hypot(x, z) * 100) / 100,
        azimuth: Math.round((Math.atan2(x, -z) * 180) / Math.PI),
        aboveFloor: Math.round((p.center[1] - world.player.position.y) * 100) / 100,
      };
    }),
  );
  registerTest('setVisibility', (state: 'hidden' | 'blurred' | 'visible') => {
    const hook = (window as unknown as { __gw?: { visibility?: { force(s: string | null): void } } }).__gw?.visibility;
    hook?.force(state === 'visible' ? null : state);
  });
}
