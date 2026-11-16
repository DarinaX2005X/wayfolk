/**
 * Planes of the real room (PLAN "Режимы Void и Room"): the wall the timeline stands on
 * (02.3.5) and the table the island and the hall model lie on (04.1.3), chosen by one
 * function so every view agrees on the same plane.
 *
 *   wall   a vertical plane at least 1.2 m wide, 0.8–3.5 m away, at most 50° from where
 *          the person looks; not a door, a window or a screen by its semantic label
 *   table  a horizontal plane facing up, 0.55–0.85 m over the floor, 0.3–0.8 m in front
 *
 * Planes come from IWSDK scene understanding as entities with the XRPlane component:
 * the WebXR plane is in its `_plane` field, the pose on `entity.object3D`. Without
 * planes (the person said no, or a VR session) `find` answers null and the views keep
 * the Void layout.
 */
import { Box3, Matrix4, Quaternion, Vector3, XRPlane, type Entity, type World } from '@iwsdk/core';
import type { SeatFrame } from './place';
import { worldToSeat } from './place';

export type SurfaceKind = 'wall' | 'table';

export type Surface = { kind: SurfaceKind; center: Vector3; normal: Vector3; width: number; height: number; entity: Entity };

/** A plane reduced to numbers: centre and normal in world space, size in its own plane. */
export type PlaneInfo = {
  center: [number, number, number];
  normal: [number, number, number];
  width: number;
  height: number;
  orientation: 'horizontal' | 'vertical' | null;
  label: string | null;
};

export const WALL = { minWidth: 1.2, near: 0.8, far: 3.5, maxAngleDeg: 50 } as const;
export const TABLE = { low: 0.55, high: 0.85, near: 0.3, far: 0.8 } as const;
const NOT_A_WALL = new Set(['door', 'window', 'screen', 'opening', 'wall art', 'wall_art']);

const deg = (rad: number): number => (rad * 180) / Math.PI;

/** Vertical when the normal lies (nearly) along the floor; horizontal when it points (nearly) up or down. */
function orientationOf(info: PlaneInfo): 'horizontal' | 'vertical' {
  if (info.orientation) return info.orientation;
  return Math.abs(info.normal[1]) > 0.7 ? 'horizontal' : 'vertical';
}

/**
 * Where on a wall the timeline would stand: the point of the wall (within its width)
 * where the level line of sight meets it, or the end of the wall nearest to it. Null when
 * the wall faces away from the person. `angle` is how far that point is from the line of
 * sight, degrees; `distance` is horizontal, metres.
 */
export function wallSpot(plane: PlaneInfo, seat: SeatFrame): { distance: number; angle: number } | null {
  const [nx, , nz] = plane.normal;
  const nl = Math.hypot(nx, nz);
  if (nl < 1e-6) return null;
  const n = [nx / nl, nz / nl];
  const o = [seat.origin[0], seat.origin[2]];
  const c = [plane.center[0], plane.center[2]];
  // The wall must face the person.
  if ((o[0] - c[0]) * n[0] + (o[1] - c[1]) * n[1] <= 0) return null;
  const tangent = [-n[1], n[0]];
  const f = [seat.forward[0], seat.forward[2]];
  const toward = f[0] * n[0] + f[1] * n[1];
  let along: number;
  if (toward < -1e-6) {
    // The line of sight hits the wall's plane: where, along the wall?
    const s = ((c[0] - o[0]) * n[0] + (c[1] - o[1]) * n[1]) / toward;
    along = (o[0] + f[0] * s - c[0]) * tangent[0] + (o[1] + f[1] * s - c[1]) * tangent[1];
  } else {
    along = (o[0] - c[0]) * tangent[0] + (o[1] - c[1]) * tangent[1];
  }
  const half = plane.width / 2;
  along = Math.max(-half, Math.min(half, along));
  const px = c[0] + tangent[0] * along - o[0];
  const pz = c[1] + tangent[1] * along - o[1];
  const distance = Math.hypot(px, pz);
  const ahead = px * f[0] + pz * f[1];
  const side = px * seat.right[0] + pz * seat.right[2];
  return { distance, angle: Math.abs(deg(Math.atan2(side, ahead))) };
}

/**
 * The best plane of a kind, or null. Pure: tests feed it numbers.
 * @param floorY height of the floor in world space
 */
export function pickSurface(kind: SurfaceKind, planes: readonly PlaneInfo[], seat: SeatFrame, floorY: number): number | null {
  let best: number | null = null;
  let bestScore = Infinity;
  planes.forEach((plane, index) => {
    const [, , z] = worldToSeat(seat, plane.center);
    const ahead = -z;
    if (kind === 'wall') {
      if (orientationOf(plane) !== 'vertical') return;
      if (plane.label && NOT_A_WALL.has(plane.label.toLowerCase())) return;
      if (plane.width < WALL.minWidth) return;
      const spot = wallSpot(plane, seat);
      if (!spot) return;
      if (spot.distance < WALL.near || spot.distance > WALL.far) return;
      if (spot.angle > WALL.maxAngleDeg) return;
      // Nearest to the line of sight first, then wider.
      const score = spot.angle - plane.width;
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    } else {
      if (orientationOf(plane) !== 'horizontal' || plane.normal[1] < 0.7) return;
      const height = plane.center[1] - floorY;
      if (height < TABLE.low || height > TABLE.high) return;
      if (ahead < TABLE.near || ahead > TABLE.far) return;
      // Nearest to the bench (0.45 m ahead), then larger.
      const score = Math.abs(ahead - 0.45) - plane.width * plane.height * 0.1;
      if (score < bestScore) {
        bestScore = score;
        best = index;
      }
    }
  });
  return best;
}

type WebXRPlaneLike = { orientation?: string; polygon?: { x: number; y: number; z: number }[]; semanticLabel?: string };

/** Numbers of one XRPlane entity, or null while it has no pose yet. */
export function planeInfo(entity: Entity, out = { m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(), n: new Vector3(), box: new Box3(), v: new Vector3() }): PlaneInfo | null {
  const object = entity.object3D;
  const plane = entity.getValue(XRPlane, '_plane') as WebXRPlaneLike | undefined;
  if (!object || !plane) return null;
  object.updateWorldMatrix(true, false);
  object.matrixWorld.decompose(out.p, out.q, out.s);
  // In plane space the plane lies in x-z and its normal is +Y.
  out.n.set(0, 1, 0).applyQuaternion(out.q).normalize();
  out.box.makeEmpty();
  for (const point of plane.polygon ?? []) out.box.expandByPoint(out.v.set(point.x, 0, point.z));
  const width = out.box.isEmpty() ? 0 : out.box.max.x - out.box.min.x;
  const height = out.box.isEmpty() ? 0 : out.box.max.z - out.box.min.z;
  // The polygon may not be centred on the plane origin.
  const center = out.box.isEmpty() ? out.p.clone() : out.box.getCenter(out.v).applyMatrix4(object.matrixWorld);
  const orientation = plane.orientation === 'horizontal' || plane.orientation === 'vertical' ? plane.orientation : null;
  return {
    center: [center.x, center.y, center.z],
    normal: [out.n.x, out.n.y, out.n.z],
    width,
    height,
    orientation,
    label: typeof plane.semanticLabel === 'string' ? plane.semanticLabel : null,
  };
}

export type Surfaces = {
  find(kind: SurfaceKind): Surface | null;
  onChange(fn: () => void): () => void;
  /** Every plane known now, as numbers: for tests/xr/README and debugging. */
  list(): (PlaneInfo & { index: number })[];
};

export function createSurfaces(world: World, seat: () => SeatFrame): Surfaces {
  const query = world.queryManager.registerQuery({ required: [XRPlane] });
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const fn of [...listeners]) {
      try {
        fn();
      } catch (error) {
        console.error('[gw] surfaces listener failed', error);
      }
    }
  };
  query.subscribe('qualify', changed);
  query.subscribe('disqualify', changed);

  const scratch = { m: new Matrix4(), q: new Quaternion(), p: new Vector3(), s: new Vector3(), n: new Vector3(), box: new Box3(), v: new Vector3() };
  const floorY = (): number => {
    for (const entity of query.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as WebXRPlaneLike | undefined;
      if (plane?.semanticLabel === 'floor' && entity.object3D) return entity.object3D.getWorldPosition(scratch.v).y;
    }
    return world.player.getWorldPosition(scratch.v).y;
  };
  const current = (): { entity: Entity; info: PlaneInfo }[] => {
    const out: { entity: Entity; info: PlaneInfo }[] = [];
    for (const entity of query.entities) {
      const info = planeInfo(entity, scratch);
      if (info) out.push({ entity, info });
    }
    return out;
  };

  return {
    find(kind) {
      const planes = current();
      const index = pickSurface(kind, planes.map((p) => p.info), seat(), floorY());
      if (index === null) return null;
      const { entity, info } = planes[index];
      return {
        kind,
        center: new Vector3(...info.center),
        normal: new Vector3(...info.normal),
        width: info.width,
        height: info.height,
        entity,
      };
    },
    onChange(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    list() {
      return current().map(({ info }, index) => ({ ...info, index }));
    },
  };
}
