/**
 * The rules of the three hand actions and of selection, as plain functions without
 * Three.js or a browser, so tests/interact/ checks them on their own: thresholds,
 * hysteresis, the return of a dropped object, the double pinch, dwell timing, which hand
 * may take what, and the choice of a target under a pointer. The runtime (./runtime.ts)
 * feeds them poses every frame.
 */

export type V3 = readonly [number, number, number];

export const sub = (a: V3, b: V3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Numbers of the actions (DESIGN "Компоненты", PLAN "Набор ремесла", tokens MOTION.slip). */
export const RULES = {
  /** A hand closer than this to a takeable object takes it; a ray select from it is ignored. */
  nearHand: 0.12,
  /** Release within this radius of a snap target pulls the object onto it. */
  snapMs: 120,
  returnMs: 400,
  /** Two selects of one target within this time are one select. */
  doubleMs: 300,
  /** A hand lost for longer than this lets go of what it holds. */
  lostMs: 500,
  /** Reveal: lifted toward the seat by `lift` or turned by `turnDeg` opens; below `closeLift` and `closeDeg` closes. */
  lift: 0.06,
  turnDeg: 60,
  closeLift: 0.03,
  closeDeg: 35,
  /** Pull: the bead travels toward the seat; `threshold` metres of wrist travel commits. */
  pullThreshold: 0.15,
  /** Mouse: dragging a bead this many pixels down the screen is a pull; the wheel over a slip reveals it. */
  mousePullPx: 120,
  /** Dwell: the pointer rests this long before the ring starts, then fills for `dwellMs`, then pauses on that target. */
  dwellArmMs: 250,
  dwellCooldownMs: 1000,
  /** Hit volume of a select target, degrees of angular size from the seat. */
  minAngleDeg: 2.2,
  /** Smoothing time of the head pointer, seconds. */
  smoothTau: 0.06,
} as const;

// ---------------------------------------------------------------- hysteresis

/** A switch with two thresholds: on at or above `on`, off only below `off`. */
export class Hysteresis {
  value = false;
  constructor(
    readonly on: number,
    readonly off: number,
  ) {}
  update(x: number): boolean {
    if (!this.value && x >= this.on) this.value = true;
    else if (this.value && x < this.off) this.value = false;
    return this.value;
  }
}

// ---------------------------------------------------------------- one select per pinch

/** Drops a second select of the same target that comes within `ms` of the first. */
export class SelectGuard {
  private last = new Map<unknown, number>();
  constructor(private readonly ms: number = RULES.doubleMs) {}
  accept(target: unknown, now: number): boolean {
    const before = this.last.get(target);
    if (before !== undefined && now - before >= 0 && now - before < this.ms) return false;
    this.last.set(target, now);
    return true;
  }
}

// ---------------------------------------------------------------- who holds what

export type Hand = 'left' | 'right';

/**
 * One holder per object and one pull at a time. A second hand never takes over what
 * the first holds, and while one thread is being pulled no other thread is taken.
 */
export class Holds {
  private held = new Map<unknown, Hand>();
  private pulling: { what: unknown; hand: Hand } | null = null;

  take(what: unknown, hand: Hand): boolean {
    const by = this.held.get(what);
    if (by && by !== hand) return false;
    this.held.set(what, hand);
    return true;
  }
  holder(what: unknown): Hand | null {
    return this.held.get(what) ?? null;
  }
  release(what: unknown): void {
    this.held.delete(what);
  }
  /** What a hand holds, if anything. */
  heldBy(hand: Hand): unknown[] {
    return [...this.held].filter(([, h]) => h === hand).map(([w]) => w);
  }
  startPull(what: unknown, hand: Hand): boolean {
    if (this.pulling && this.pulling.what !== what) return false;
    if (this.pulling && this.pulling.hand !== hand) return false;
    this.pulling = { what, hand };
    return true;
  }
  endPull(what: unknown): void {
    if (this.pulling?.what === what) this.pulling = null;
  }
  get activePull(): unknown {
    return this.pulling?.what ?? null;
  }
}

// ---------------------------------------------------------------- lost tracking

/** Counts how long a hand has been missing; `lost` once it passes `ms`. Tracking back resets it. */
export class LossTimer {
  private since: number | null = null;
  constructor(private readonly ms: number = RULES.lostMs) {}
  update(tracked: boolean, now: number): boolean {
    if (tracked) {
      this.since = null;
      return false;
    }
    if (this.since === null) this.since = now;
    return now - this.since > this.ms;
  }
  reset(): void {
    this.since = null;
  }
}

// ---------------------------------------------------------------- drop: snap or return

export type DropTarget<T> = { target: T; at: V3; radius: number };

/** The nearest snap target within its radius of `at`, or null. */
export function pickSnap<T>(at: V3, targets: readonly DropTarget<T>[]): DropTarget<T> | null {
  let best: DropTarget<T> | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    const d = len(sub(at, t.at));
    if (d <= t.radius && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/** Ease out (cubic): fast start, soft landing. */
export const easeOut = (k: number): number => 1 - (1 - clamp(k, 0, 1)) ** 3;

/** Where an object is `elapsed` ms into a move from `from` to `to` that lasts `ms`. */
export function tween(from: V3, to: V3, elapsed: number, ms: number): [number, number, number] {
  const k = ms <= 0 ? 1 : easeOut(elapsed / ms);
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
}

// ---------------------------------------------------------------- pull

/**
 * Progress of a pull: how far the wrist has travelled along the axis toward the seat,
 * as a share of the threshold (0…1). Sideways and backward motion count for nothing.
 */
export function pullProgress(wristStart: V3, wristNow: V3, towardSeat: V3, threshold: number = RULES.pullThreshold): number {
  const axis = towardSeat;
  const l = len(axis);
  if (l < 1e-9 || threshold <= 0) return 0;
  const along = dot(sub(wristNow, wristStart), axis) / l;
  return clamp(along / threshold, 0, 1);
}

/** Pull states: the bead follows the hand; at 1 it commits once; released before that it cancels. */
export class PullState {
  progress = 0;
  committed = false;
  update(k: number): 'commit' | null {
    this.progress = k;
    if (!this.committed && k >= 1) {
      this.committed = true;
      return 'commit';
    }
    return null;
  }
  release(): 'cancel' | 'done' {
    return this.committed ? 'done' : 'cancel';
  }
}

/** A mouse drag down the screen as a pull: `dy` pixels down, the share of the threshold. */
export function mousePull(dy: number, px: number = RULES.mousePullPx): number {
  return clamp(dy / px, 0, 1);
}

// ---------------------------------------------------------------- reveal

/**
 * Reveal of a sheet in the hand. Opens when lifted toward the seat by `lift` metres
 * above where it was taken, or turned by `turnDeg` around any axis in the plane of the
 * sheet; closes only when both fall back below the lower thresholds (hysteresis).
 */
export class RevealState {
  open = false;
  constructor(
    readonly lift: number = RULES.lift,
    readonly turnDeg: number = RULES.turnDeg,
    readonly closeLift: number = RULES.closeLift,
    readonly closeDeg: number = RULES.closeDeg,
  ) {}
  update(liftM: number, turnDeg: number): 'open' | 'close' | null {
    if (!this.open && (liftM >= this.lift || turnDeg >= this.turnDeg)) {
      this.open = true;
      return 'open';
    }
    if (this.open && liftM < this.closeLift && turnDeg < this.closeDeg) {
      this.open = false;
      return 'close';
    }
    return null;
  }
  /** Let go: a revealed sheet folds back. */
  release(): 'close' | null {
    if (!this.open) return null;
    this.open = false;
    return 'close';
  }
}

/**
 * Lift toward the seat: the rise of the held point above where it was taken, plus the
 * part of its travel that comes toward the eyes. A sheet raised straight up or brought
 * up toward the face both count; moving it away or down does not.
 */
export function liftOf(start: V3, now: V3, eye: V3): number {
  const up = now[1] - start[1];
  const toward = sub(eye, start);
  const flat: V3 = [toward[0], 0, toward[2]];
  const l = len(flat);
  const closer = l > 1e-6 ? dot(sub(now, start), flat) / l : 0;
  return Math.max(0, up) + Math.max(0, closer) * 0.5;
}

/**
 * Turn of a sheet: the angle between its normal now and when it was taken, in degrees.
 * A turn about the normal itself (spinning the sheet flat) does not change the normal
 * and counts as no turn, which is what "around an axis in the plane of the sheet" means.
 */
export function turnOf(normalStart: V3, normalNow: V3): number {
  const a = len(normalStart);
  const b = len(normalNow);
  if (a < 1e-9 || b < 1e-9) return 0;
  return (Math.acos(clamp(dot(normalStart, normalNow) / (a * b), -1, 1)) * 180) / Math.PI;
}

// ---------------------------------------------------------------- dwell

export type DwellPhase = 'idle' | 'arming' | 'filling' | 'cooldown';

/**
 * Dwell selection: the pointer rests on a target for `armMs` before the ring starts,
 * the ring fills over `fillMs`, then the target is selected and the same target is left
 * alone for `cooldownMs`. Moving to another target or off any target starts over.
 */
export class DwellState {
  phase: DwellPhase = 'idle';
  target: unknown = null;
  private since = 0;
  private cooledAt = -Infinity;
  private cooled: unknown = null;

  constructor(
    public fillMs = 800,
    readonly armMs: number = RULES.dwellArmMs,
    readonly cooldownMs: number = RULES.dwellCooldownMs,
  ) {}

  /** Share of the ring filled (0…1). */
  fill(now: number): number {
    if (this.phase !== 'filling') return 0;
    return clamp((now - this.since - this.armMs) / this.fillMs, 0, 1);
  }

  /** Feeds what the pointer is on now; returns the target when it is selected. */
  update(on: unknown, now: number): unknown {
    if (on !== this.target) {
      this.target = on;
      this.since = now;
      this.phase = on === null ? 'idle' : 'arming';
    }
    if (on === null) return null;
    if (on === this.cooled && now - this.cooledAt < this.cooldownMs) {
      this.phase = 'cooldown';
      this.since = now;
      return null;
    }
    if (this.phase === 'cooldown') {
      this.phase = 'arming';
      this.since = now;
    }
    const t = now - this.since;
    if (t < this.armMs) {
      this.phase = 'arming';
      return null;
    }
    this.phase = 'filling';
    if (t >= this.armMs + this.fillMs) {
      this.cooled = on;
      this.cooledAt = now;
      this.phase = 'cooldown';
      this.since = now;
      return on;
    }
    return null;
  }
}

// ---------------------------------------------------------------- picking under a pointer

export type Candidate<T> = {
  target: T;
  /** Centre of the target, world metres. */
  center: V3;
  /** Radius of the target's own bounds, metres. */
  radius: number;
};

/**
 * The target under a ray. Every target is hit within a cone around its centre no
 * smaller than `minAngleDeg` of angular size from the ray origin (the hit volume), so a
 * 1 cm bead at 1.3 m is still easy to select. Among the targets hit, the one whose
 * centre is closest to the ray (in angle) wins, so tight neighbours split fairly.
 * `blockedAt`, when given, is the distance of the nearest blocking surface (a panel):
 * targets behind it are not picked.
 */
export function pickTarget<T>(
  origin: V3,
  dir: V3,
  candidates: readonly Candidate<T>[],
  minAngleDeg: number = RULES.minAngleDeg,
  blockedAt = Infinity,
): T | null {
  const dl = len(dir);
  if (dl < 1e-9) return null;
  let best: T | null = null;
  let bestAngle = Infinity;
  for (const c of candidates) {
    const to = sub(c.center, origin);
    const dist = len(to);
    if (dist < 1e-6) continue;
    const ahead = dot(to, dir) / dl;
    if (ahead <= 0) continue;
    if (ahead - c.radius > blockedAt) continue;
    const angle = (Math.acos(clamp(ahead / dist, -1, 1)) * 180) / Math.PI;
    const own = (Math.atan2(c.radius, dist) * 180) / Math.PI;
    const reach = Math.max(own, minAngleDeg / 2);
    if (angle > reach) continue;
    if (angle < bestAngle) {
      bestAngle = angle;
      best = c.target;
    }
  }
  return best;
}

/** Exponential smoothing of a direction (the head pointer), `tau` seconds, renormalised. */
export function smoothDir(prev: V3, next: V3, dt: number, tau: number = RULES.smoothTau): [number, number, number] {
  const a = tau <= 0 ? 1 : 1 - Math.exp(-dt / tau);
  const v: [number, number, number] = [prev[0] + (next[0] - prev[0]) * a, prev[1] + (next[1] - prev[1]) * a, prev[2] + (next[2] - prev[2]) * a];
  const l = len(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
