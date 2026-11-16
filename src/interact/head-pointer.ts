/**
 * Dwell: select by resting the pointer on a target (setting `dwell`, PLAN "Указатель
 * головы"). Quest has no eye tracking and the gaze system of IWSDK is made for the
 * glasses, so this layer leads its own pointer:
 *   - in a session with a gaze source (glasses): the gaze ray (`player.eyeSpace`);
 *   - in a session without one (Quest): a ray from the head straight ahead;
 *   - at the desk: the mouse.
 * Every frame it finds the nearest select target under the ray (hit volumes of at least
 * 2.2°, the centre closest to the ray wins, nothing behind a panel), draws a 6 mm dot
 * there, arms for 250 ms, fills a ring over `dwellMs` and calls the same handler as a
 * pinch would. The same target then rests for 1 s.
 */
import {
  Box3,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Ray,
  RingGeometry,
  Vector2,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import { store } from '../app/store';
import { zone } from '../app/perf/zone';
import { COLOR } from '../tokens/tokens';
import { DwellState, pickTarget, smoothDir, type Candidate, type V3 } from './logic';
import { current, everyFrame, whenBound, worldCenter, worldRadius } from './runtime';
import { selectTargets, type SelectTarget } from './select';

const DOT = 0.003;
const RING_IN = 0.0045;
const RING_OUT = 0.0065;
const SEGMENTS = 48;

type Cached = { center: Vector3; radius: number; at: number };
const cache = new WeakMap<SelectTarget, Cached>();
const blockers = new Set<Object3D>();

/** A surface the dwell pointer cannot see through (panel roots). */
export function addBlocker(obj: Object3D): () => void {
  blockers.add(obj);
  return () => {
    blockers.delete(obj);
  };
}

function visible(obj: Object3D): boolean {
  for (let o: Object3D | null = obj; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function within(obj: Object3D, root: Object3D): boolean {
  for (let o: Object3D | null = obj; o; o = o.parent) if (o === root) return true;
  return false;
}

export type DwellView = { phase: string; target: string | null; fill: number };

let state: DwellView = { phase: 'idle', target: null, fill: 0 };

/** What the dwell pointer does now (scenarios read it through window.__gw.dwell). */
export function dwellState(): DwellView {
  return state;
}

let started = false;

/** Starts the dwell pointer once the input layer is bound. */
export function startDwell(): void {
  if (started) return;
  started = true;
  whenBound(({ world, app }) => {
    const dwell = new DwellState(store.settings.peek().dwellMs);
    const marker = zone(new Group(), 'hands');
    marker.name = 'dwell-pointer';
    const dotMat = new MeshBasicMaterial({ color: COLOR.cobalt, depthTest: false, transparent: true });
    const dot = new Mesh(new CircleGeometry(DOT, 20), dotMat);
    const ringGeo = new RingGeometry(RING_IN, RING_OUT, SEGMENTS, 1);
    const ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: COLOR.cobalt, depthTest: false, transparent: true }));
    dot.renderOrder = ring.renderOrder = 10_000;
    marker.add(dot, ring);
    marker.visible = false;
    world.scene.add(marker);

    let mouse: Vector2 | null = null;
    const canvas = world.renderer.domElement;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse = new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    canvas.addEventListener('pointerleave', () => {
      mouse = null;
    });

    const origin = new Vector3();
    const dir = new Vector3();
    let smooth: [number, number, number] = [0, 0, -1];
    const ray = new Ray();
    const box = new Box3();
    const hit = new Vector3();

    everyFrame((dt, now) => {
      const settings = store.settings.peek();
      if (!settings.dwell) {
        marker.visible = false;
        state = { phase: 'idle', target: null, fill: 0 };
        dwell.update(null, now);
        return;
      }
      dwell.fillMs = settings.dwellMs;

      // ---- the ray
      if (world.session) {
        const xr = world.input.xr;
        const gaze = xr.gazeEnabled ? world.player.eyeSpace : null;
        const space = gaze && world.player.gazeOrigin === 'tracked' ? gaze : world.player.head;
        space.updateWorldMatrix(true, false);
        space.getWorldPosition(origin);
        dir.set(0, 0, -1).transformDirection(space.matrixWorld);
      } else {
        if (!mouse) {
          marker.visible = false;
          dwell.update(null, now);
          state = { phase: 'idle', target: null, fill: 0 };
          return;
        }
        const camera = world.camera;
        camera.updateMatrixWorld();
        origin.setFromMatrixPosition(camera.matrixWorld);
        dir.set(mouse.x, mouse.y, 0.5).unproject(camera).sub(origin).normalize();
      }
      smooth = world.session ? smoothDir(smooth, [dir.x, dir.y, dir.z], dt) : [dir.x, dir.y, dir.z];
      ray.origin.copy(origin);
      ray.direction.set(smooth[0], smooth[1], smooth[2]);

      // ---- what lies under it
      const list: Candidate<SelectTarget>[] = [];
      for (const t of selectTargets) {
        if (!t.dwell || !t.enabled() || !visible(t.obj)) continue;
        let c = cache.get(t);
        if (!c || now - c.at > 300) {
          c = { center: worldCenter(t.obj, new Vector3()), radius: worldRadius(t.obj), at: now };
          cache.set(t, c);
        }
        const dist = c.center.distanceTo(origin);
        let blocked = false;
        for (const b of blockers) {
          if (!visible(b) || within(t.obj, b)) continue;
          box.setFromObject(b);
          if (ray.intersectBox(box, hit) && hit.distanceTo(origin) < dist - c.radius) {
            blocked = true;
            break;
          }
        }
        if (!blocked) list.push({ target: t, center: c.center.toArray() as V3, radius: c.radius });
      }
      const on = pickTarget(origin.toArray() as V3, smooth, list);
      const picked = dwell.update(on, now) as SelectTarget | null;
      if (picked) picked.fire('dwell');

      // ---- the dot and the ring
      const fill = dwell.fill(now);
      state = { phase: dwell.phase, target: on ? on.obj.name || null : null, fill };
      if (on) {
        const c = cache.get(on)!;
        const d = c.center.distanceTo(origin);
        marker.position.copy(origin).addScaledVector(ray.direction, Math.max(0.2, d - c.radius));
        marker.lookAt(origin);
        // Same angular size at any distance: 6 mm at half a metre.
        marker.scale.setScalar(Math.max(0.4, d / 0.5));
        marker.visible = true;
        const shown = dwell.phase === 'filling' ? Math.round(fill * SEGMENTS) : 0;
        ringGeo.setDrawRange(0, shown * 6);
        ring.visible = shown > 0;
      } else {
        marker.visible = false;
      }
    });

    const debug = (window as unknown as { __gw?: Record<string, unknown> }).__gw;
    if (debug) debug.dwell = dwellState;
    void app;
  });
}

/** Whether a dwell pointer is running (for the gallery). */
export function dwellRunning(): boolean {
  return started && current() !== null;
}
