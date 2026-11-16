/**
 * The seated frame (DESIGN "Пространство в шлеме"): the origin at the eyes of the person
 * at the moment of entry, -Z straight ahead along the floor, +Y up, metres. Every layout
 * number of tokens LAYOUT is relative to this frame, so the whole scene stands where the
 * person sits, whichever way they faced when they entered. Plain numbers, no Three.js,
 * so the rule is tested on its own; src/app/core/install.ts applies it to the roots.
 */
import { SEAT } from '../../tokens/tokens';

export type Vec3 = readonly [number, number, number];

export type SeatFrame = {
  /** Eye position at entry, in world metres. */
  origin: [number, number, number];
  /** Turn around the vertical axis, radians: 0 looks along world -Z. */
  yaw: number;
  /** Horizontal unit vector straight ahead, world. */
  forward: [number, number, number];
  /** Horizontal unit vector to the right, world. */
  right: [number, number, number];
  /** When the frame was taken (application time, ms). */
  at: number;
};

/**
 * The seated frame from a head pose.
 * @param head     eye position, world metres
 * @param forward  where the head looks (need not be unit length)
 * @param up       where the top of the head points; used when the person looks straight
 *                 down or up and `forward` has no horizontal part
 */
export function seatFrom(head: Vec3, forward: Vec3, up: Vec3 = [0, 1, 0], at = 0): SeatFrame {
  let fx = forward[0];
  let fz = forward[2];
  let length = Math.hypot(fx, fz);
  const whole = Math.hypot(forward[0], forward[1], forward[2]);
  // Less than about 12° away from vertical: the horizontal part is too small to trust.
  if (length < 0.2 * whole) {
    // Looking down at the lap or up at the ceiling: the top of the head then points
    // ahead (looking down) or behind (looking up).
    const sign = forward[1] > 0 ? -1 : 1;
    fx = up[0] * sign;
    fz = up[2] * sign;
    length = Math.hypot(fx, fz);
  }
  if (length < 1e-6 || !Number.isFinite(length)) {
    fx = 0;
    fz = -1;
    length = 1;
  }
  fx /= length;
  fz /= length;
  return {
    origin: [head[0], head[1], head[2]],
    yaw: Math.atan2(-fx, -fz),
    forward: [fx, 0, fz],
    right: [-fz, 0, fx],
    at,
  };
}

/** The frame of the browser without a session: eyes 1.15 m over the floor, facing -Z. */
export function deskSeat(): SeatFrame {
  return seatFrom([0, SEAT.desk.eyeHeight, 0], [0, 0, -1]);
}

/** A point of the seated frame (x right, y up, z back) in world metres. */
export function seatToWorld(seat: SeatFrame, p: Vec3): [number, number, number] {
  const [rx, , rz] = seat.right;
  const [fx, , fz] = seat.forward;
  return [
    seat.origin[0] + rx * p[0] - fx * p[2],
    seat.origin[1] + p[1],
    seat.origin[2] + rz * p[0] - fz * p[2],
  ];
}

/** A world point in the seated frame. */
export function worldToSeat(seat: SeatFrame, p: Vec3): [number, number, number] {
  const dx = p[0] - seat.origin[0];
  const dz = p[2] - seat.origin[2];
  const [rx, , rz] = seat.right;
  const [fx, , fz] = seat.forward;
  return [dx * rx + dz * rz, p[1] - seat.origin[1], -(dx * fx + dz * fz)];
}

/** Half angles of a device's view, degrees (Quest 3 and Meta VR Glasses differ a lot). */
export type HalfAngles = { left: number; right: number; up: number; down: number };

export const DEVICE_VIEW: Record<'quest3' | 'glasses', HalfAngles> = {
  quest3: { left: 52, right: 52, up: 48, down: 48 },
  glasses: { left: 37, right: 37, up: 25, down: 43 },
};

/**
 * A test of whether a point of the seated frame lies inside a device's view when the
 * person looks straight ahead (head at the origin, level gaze). `margin` degrees are kept
 * free at every edge.
 */
export function fovCone(half: HalfAngles, margin = 0): (p: Vec3) => boolean {
  return (p) => {
    const ahead = -p[2];
    if (ahead <= 0) return false;
    const az = (Math.atan2(p[0], ahead) * 180) / Math.PI;
    const el = (Math.atan2(p[1], Math.hypot(p[0], ahead)) * 180) / Math.PI;
    return az >= -(half.left - margin) && az <= half.right - margin && el <= half.up - margin && el >= -(half.down - margin);
  };
}
