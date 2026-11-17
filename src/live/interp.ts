/**
 * Smooth playback of a peer's presence. Frames arrive 15 times a second with network
 * jitter; the avatar is drawn a little in the past (about 100 ms), interpolating between
 * the two frames around that moment, so motion stays even when frames bunch up or a few
 * are late. The sender's clock is mapped to ours by the fastest observed delivery.
 *
 * Pure numbers, no Three.js, so it is tested in Node.
 */
import type { HandPose, Presence } from './protocol';

export interface HandOut {
  /** The hand has fresh data at the render time. */
  present: boolean;
  controller: boolean;
  wrist: number[];
  quat: number[];
  /** Thumb, index, middle, ring, pinky: 5 × xyz. */
  tips: number[];
}

export interface PoseOut {
  pos: number[];
  quat: number[];
  talking: boolean;
  immersive: boolean;
  left: HandOut;
  right: HandOut;
}

export function emptyPose(): PoseOut {
  const hand = (): HandOut => ({ present: false, controller: false, wrist: [0, 0, 0], quat: [0, 0, 0, 1], tips: new Array(15).fill(0) });
  return { pos: [0, 0, 0], quat: [0, 0, 0, 1], talking: false, immersive: false, left: hand(), right: hand() };
}

interface Entry {
  t: number;
  p: Presence;
}

const RING = 24;
const WINDOW = 48;

export class PoseTrack {
  private ring: Entry[] = [];
  private lastRaw: number | null = null;
  private unwrapped = 0;
  private offsets: number[] = [];
  private minOffset = Infinity;
  private jitter = 0;
  /** Local ms of the newest frame's arrival. */
  lastArrival = -Infinity;

  /** Ms the playback runs behind the newest frame. */
  get delay(): number {
    return Math.min(250, Math.max(70, 60 + 1.5 * this.jitter));
  }

  push(p: Presence, arrival: number): void {
    if (this.lastRaw === null) {
      this.unwrapped = p.time;
    } else {
      // Signed 32-bit difference: survives the wrap of the sender's clock.
      const d = (p.time - this.lastRaw) | 0;
      if (d <= 0) return; // late or repeated frame
      this.unwrapped += d;
    }
    this.lastRaw = p.time >>> 0;
    const offset = arrival - this.unwrapped;
    this.offsets.push(offset);
    if (this.offsets.length > WINDOW) this.offsets.shift();
    let min = Infinity;
    let sum = 0;
    for (const o of this.offsets) if (o < min) min = o;
    for (const o of this.offsets) sum += o - min;
    // A faster path shifts the whole timeline; the ring is re-based so it stays monotonic.
    if (min !== this.minOffset && Number.isFinite(this.minOffset)) {
      const shift = min - this.minOffset;
      for (const e of this.ring) e.t += shift;
    }
    this.minOffset = min;
    this.jitter = sum / this.offsets.length;
    this.ring.push({ t: this.unwrapped + min, p });
    if (this.ring.length > RING) this.ring.shift();
    this.lastArrival = arrival;
  }

  /** Ms since the newest frame arrived. */
  age(now: number): number {
    return now - this.lastArrival;
  }

  get size(): number {
    return this.ring.length;
  }

  clear(): void {
    this.ring.length = 0;
    this.offsets.length = 0;
    this.lastRaw = null;
    this.minOffset = Infinity;
    this.lastArrival = -Infinity;
  }

  /** Writes the pose at `now - delay` into `out`; false when there is nothing yet. */
  sample(now: number, out: PoseOut): boolean {
    const ring = this.ring;
    const n = ring.length;
    if (n === 0) return false;
    const rt = now - this.delay;
    let a = ring[0];
    let b = ring[0];
    if (rt >= ring[n - 1].t) {
      a = b = ring[n - 1];
    } else if (rt > ring[0].t) {
      for (let i = n - 2; i >= 0; i--) {
        if (ring[i].t <= rt) {
          a = ring[i];
          b = ring[i + 1];
          break;
        }
      }
    }
    const span = b.t - a.t;
    const k = span > 0 ? Math.min(1, Math.max(0, (rt - a.t) / span)) : 1;
    lerp3(a.p.head.pos, b.p.head.pos, k, out.pos);
    slerp(a.p.head.quat, b.p.head.quat, k, out.quat);
    const near = k < 0.5 ? a.p : b.p;
    out.talking = near.talking;
    out.immersive = near.immersive;
    mixHand(a.p.left, b.p.left, k, out.left);
    mixHand(a.p.right, b.p.right, k, out.right);
    return true;
  }
}

function mixHand(a: HandPose | undefined, b: HandPose | undefined, k: number, out: HandOut): void {
  const from = a ?? b;
  const to = b ?? a;
  if (!from || !to) {
    out.present = false;
    return;
  }
  // A hand that is in only one of the two frames is held, not blended with nothing.
  const kk = a && b ? k : a ? 0 : 1;
  out.present = kk < 0.5 ? Boolean(a) : Boolean(b);
  out.controller = !(kk < 0.5 ? from : to).tips;
  lerp3(from.wrist, to.wrist, kk, out.wrist);
  slerp(from.quat, to.quat, kk, out.quat);
  const ft = from.tips;
  const tt = to.tips ?? ft;
  if (ft && tt) {
    for (let i = 0; i < 5; i++) {
      const f = ft[i];
      const t = tt[i];
      out.tips[i * 3] = f[0] + (t[0] - f[0]) * kk;
      out.tips[i * 3 + 1] = f[1] + (t[1] - f[1]) * kk;
      out.tips[i * 3 + 2] = f[2] + (t[2] - f[2]) * kk;
    }
  } else if (tt) {
    for (let i = 0; i < 5; i++) {
      out.tips[i * 3] = tt[i][0];
      out.tips[i * 3 + 1] = tt[i][1];
      out.tips[i * 3 + 2] = tt[i][2];
    }
  }
}

export function lerp3(a: readonly number[], b: readonly number[], k: number, out: number[]): void {
  out[0] = a[0] + (b[0] - a[0]) * k;
  out[1] = a[1] + (b[1] - a[1]) * k;
  out[2] = a[2] + (b[2] - a[2]) * k;
}

/** Spherical interpolation of (x, y, z, w) quaternions along the short way. */
export function slerp(a: readonly number[], b: readonly number[], k: number, out: number[]): void {
  let bx = b[0];
  let by = b[1];
  let bz = b[2];
  let bw = b[3];
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let s0 = 1 - k;
  let s1 = k;
  if (cos < 0.9995) {
    const omega = Math.acos(Math.min(1, cos));
    const sin = Math.sin(omega);
    s0 = Math.sin((1 - k) * omega) / sin;
    s1 = Math.sin(k * omega) / sin;
  }
  const x = a[0] * s0 + bx * s1;
  const y = a[1] * s0 + by * s1;
  const z = a[2] * s0 + bz * s1;
  const w = a[3] * s0 + bw * s1;
  const len = Math.hypot(x, y, z, w) || 1;
  out[0] = x / len;
  out[1] = y / len;
  out[2] = z / len;
  out[3] = w / len;
}
