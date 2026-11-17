/**
 * The numbers behind doing things together, as pure functions (unit tested in Node):
 * where a friend's island docks and where its bridge runs, the order and pace of the
 * planks, how the duet turns two people's notes into the island's pulse, when two
 * lanterns count as twins, what a constellation looks like, and what counts as a high five.
 *
 * Frame: the island's own (world.root), the person's seat at the origin facing −z.
 */
import { CENTER, outlinePoint } from '../world/land';
import type { P2 } from '../mind/types';
import type { SlotId } from './records';

// ---------------------------------------------------------------------------------------
// Where a friend's island docks

export interface Slot {
  id: SlotId;
  /** Bridge head on this island (ground point, inset from the edge). */
  a: P2;
  /** Bridge head on the friend's island. */
  b: P2;
  /** From this island toward the friend's (unit). */
  dir: P2;
  /** Centre of the friend's island. */
  centre: P2;
  radius: number;
  /** Rotation of the friend's island about y so its local −x faces back to us. */
  yaw: number;
  /** Where it starts drifting in from, far over the clouds. */
  far: P2;
}

export const NEIGHBOUR_R = 6.2;
const INSET = 0.9;

function slotAt(id: SlotId, angle: number, gap: number, turn: number): Slot {
  const edge = outlinePoint(angle, 0);
  const a = outlinePoint(angle, INSET);
  let dx = edge.x - CENTER.x;
  let dz = edge.z - CENTER.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l;
  dz /= l;
  // A small turn keeps the friend's island clear of the pier and the islets.
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  const dir = { x: dx * c - dz * s, z: dx * s + dz * c };
  const far = { x: edge.x + dir.x * gap, z: edge.z + dir.z * gap };
  const centre = { x: far.x + dir.x * NEIGHBOUR_R, z: far.z + dir.z * NEIGHBOUR_R };
  const b = { x: far.x + dir.x * INSET, z: far.z + dir.z * INSET };
  const side = { x: -dir.z, z: dir.x };
  return {
    id,
    a,
    b,
    dir,
    centre,
    radius: NEIGHBOUR_R,
    yaw: Math.atan2(-dir.z, dir.x),
    far: { x: centre.x + dir.x * 150 + side.x * 40, z: centre.z + dir.z * 150 + side.z * 40 },
  };
}

/** East: off the right edge, between the porch and the pier. West: past the sand spit. */
export const SLOTS: Record<SlotId, Slot> = {
  east: slotAt('east', 0.42, 6.0, 0.05),
  west: slotAt('west', 2.68, 6.0, -0.12),
};

/** A point along the bridge from a (t = 0) to b (t = 1), with the rope sag. */
export function bridgePoint(slot: Slot, t: number, ya: number, yb: number, sag = 0.32): { x: number; y: number; z: number } {
  return {
    x: slot.a.x + (slot.b.x - slot.a.x) * t,
    y: ya + (yb - ya) * t - Math.sin(t * Math.PI) * sag,
    z: slot.a.z + (slot.b.z - slot.a.z) * t,
  };
}

export const PLANK_GAP = 0.34;

export function plankCount(slot: Slot): number {
  return Math.max(8, Math.round(Math.hypot(slot.b.x - slot.a.x, slot.b.z - slot.a.z) / PLANK_GAP));
}

/** Planks are laid from both ends toward the middle: 0, n−1, 1, n−2, … */
export function plankOrder(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    out.push(i);
    if (n - 1 - i !== i) out.push(n - 1 - i);
  }
  return out;
}

/** Which flock carries plank i: this island's for the near half, the friend's for the far half. */
export function plankSide(i: number, n: number): 'near' | 'far' {
  return i < n / 2 ? 'near' : 'far';
}

// ---------------------------------------------------------------------------------------
// The bridge grows only while both hold

export const PLANK_EVERY = 0.42;

export class BridgeRun {
  readonly order: number[];
  launched = 0;
  private acc = 0;

  constructor(readonly n: number, already = 0) {
    this.order = plankOrder(n);
    this.launched = Math.max(0, Math.min(n, already));
    // The first plank goes up as soon as both hold.
    this.acc = PLANK_EVERY;
  }

  get done(): boolean {
    return this.launched >= this.n;
  }

  /** 0..1 of the planks lifted so far. */
  get progress(): number {
    return this.launched / this.n;
  }

  /** Advances the clock; returns the planks to lift now (none while one person lets go). */
  step(dt: number, near: boolean, far: boolean): number[] {
    if (this.done) return [];
    if (!(near && far)) {
      // Holding again starts with a short breath, not a burst of stored planks.
      this.acc = Math.min(this.acc, PLANK_EVERY * 0.6);
      return [];
    }
    this.acc += dt;
    const out: number[] = [];
    while (this.acc >= PLANK_EVERY && this.launched < this.n) {
      this.acc -= PLANK_EVERY;
      out.push(this.order[this.launched]);
      this.launched += 1;
    }
    return out;
  }
}

/** How taut the guide rope is: slack, one end held, both held. */
export function ropeTension(near: boolean, far: boolean): number {
  return near && far ? 1 : near || far ? 0.45 : 0;
}

// ---------------------------------------------------------------------------------------
// The duet

/** D major pentatonic: any notes of it sound well together. Host plays low, guest high. */
export const SCALE = [0, 2, 4, 7, 9];
export const ROOT_HZ = 293.66; // D4

export function chimeHz(part: 'low' | 'high', i: number): number {
  const steps = part === 'low' ? [-5, 0, 2, 4, 7] : [7, 9, 12, 14, 16];
  return ROOT_HZ * Math.pow(2, steps[Math.max(0, Math.min(steps.length - 1, i))] / 12);
}

export const ENERGY_TAU = 1.4;

/** One player's energy: each strike adds, it fades over a second or two. */
export class Energy {
  value = 0;
  lastAt = -1e9;
  strike(v: number, now: number): void {
    this.value = Math.min(1, this.value + 0.28 * v + 0.08);
    this.lastAt = now;
  }
  decay(dt: number): void {
    this.value *= Math.exp(-dt / ENERGY_TAU);
  }
}

/**
 * The island's pulse from two players' energies (0..1 each). One player alone reaches at
 * most SOLO_MAX; two together, each at full play, reach 1.
 */
export const SOLO_MAX = 0.3;
export function duetPulse(a: number, b: number): number {
  const solo = SOLO_MAX * Math.max(a, b);
  const both = Math.sqrt(Math.max(0, a) * Math.max(0, b));
  return Math.max(0, Math.min(1, solo + both * 0.95));
}

/** The two play together when both struck within this window, seconds. */
export const TOGETHER_S = 2.5;
export function playingTogether(lastA: number, lastB: number, now: number): boolean {
  return now - lastA < TOGETHER_S * 1000 && now - lastB < TOGETHER_S * 1000;
}

// ---------------------------------------------------------------------------------------
// Twin lanterns

/** Two lanterns let go within this many seconds of each other are twins. */
export const TWIN_S = 20;

export function areTwins(atA: number | null, atB: number | null): boolean {
  return atA !== null && atB !== null && Math.abs(atA - atB) < TWIN_S * 1000;
}

/** Where twin lanterns meet: high above between the two, a little out over the clouds. */
export function meetPoint(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[2] + b[2]) / 2;
  // Out from the island's middle, so they meet over open sky in front of both.
  let ox = mx - CENTER.x;
  let oz = mz - CENTER.z;
  const l = Math.hypot(ox, oz) || 1;
  ox /= l;
  oz /= l;
  return [mx + ox * 4 - 2, Math.max(a[1], b[1]) + 9, mz + oz * 4 - 6];
}

/**
 * A constellation for two names: two small figures of four stars, one for each person,
 * joined by one line. Points on a unit plane (x right, y up), lines as index pairs.
 */
export function constellation(names: [string, string], seed: number): { points: [number, number][]; lines: [number, number][]; bright: number[] } {
  let h = seed >>> 0;
  for (const ch of names.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const r = (): number => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const points: [number, number][] = [];
  const lines: [number, number][] = [];
  for (let side = 0; side < 2; side++) {
    const sx = side === 0 ? -1 : 1;
    const base = points.length;
    // A little kite: the near star reaches toward the middle, where the two figures meet.
    const cx = sx * (0.5 + r() * 0.1);
    const cy = (r() - 0.5) * 0.18;
    points.push([sx * 0.14, cy * 0.4 + 0.02]);
    points.push([cx, cy + 0.2 + r() * 0.12]);
    points.push([cx + sx * (0.24 + r() * 0.1), cy + (r() - 0.5) * 0.1]);
    points.push([cx - sx * 0.04, cy - 0.2 - r() * 0.12]);
    lines.push([base, base + 1], [base + 1, base + 2], [base + 2, base + 3], [base + 3, base]);
  }
  // The meeting: the two near stars, joined.
  lines.push([0, 4]);
  return { points, lines, bright: [0, 4] };
}

// ---------------------------------------------------------------------------------------
// High five

/** Palms this close (metres) count as touching; a slap needs a little speed. */
export const FIVE_REACH = 0.14;
export const FIVE_SPEED = 0.25;
export const FIVE_COOLDOWN_MS = 2500;

export function isHighFive(distance: number, closingSpeed: number): boolean {
  return distance < FIVE_REACH && closingSpeed > FIVE_SPEED;
}

/** The palm centre from a wrist and fingertips (index..pinky). */
export function palmFrom(wrist: readonly number[], tips: readonly number[]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;
  for (let t = 1; t < 5; t++) {
    x += tips[t * 3];
    y += tips[t * 3 + 1];
    z += tips[t * 3 + 2];
    n++;
  }
  if (!n || (x === 0 && y === 0 && z === 0)) return [wrist[0], wrist[1], wrist[2]];
  const k = 0.42;
  return [wrist[0] + (x / n - wrist[0]) * k, wrist[1] + (y / n - wrist[1]) * k, wrist[2] + (z / n - wrist[2]) * k];
}
