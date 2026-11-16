/**
 * Springs: the only place where stiffness and damping of the product live (tokens
 * hold times, DESIGN "Motion" says what each move has to feel like).
 *
 * A spring is driven by the frame loop: set `target`, call `step(dt)` every frame, read
 * `value`. It continues from where it is when the target changes, so a gesture can
 * interrupt it at any moment; write `value` and `velocity` while the hand leads and let
 * the spring take over on release.
 */
import { motionReduced } from './motion';

/** Longest slice the integrator takes at once, seconds. Longer frames are cut into slices. */
const SLICE = 0.004;
/** Past this the frame was not a frame (tab was asleep): the spring is simply at rest. */
const LONG_PAUSE = 2;
/** Closer to the target and slower than this (in units of `value`, per second) counts as arrived. */
const REST_DISTANCE = 1e-5;
const REST_SPEED = 1e-3;

export class Spring {
  target = 0;
  value = 0;
  velocity = 0;
  /**
   * How far past the target the value may swing, in the units of `value`. A fast hand
   * can throw a spring further than its own overshoot; this is the paper stop.
   */
  overshootLimit = Infinity;
  /** Which side of the target the value has swung over to: -1, 0 (not past it) or 1. */
  private past = 0;

  constructor(
    public stiffness: number,
    public damping: number,
  ) {}

  /** Stiffness and damping in force this frame; presets swap them for "Less motion". */
  protected tuning(): { stiffness: number; damping: number; calm: boolean } {
    return { stiffness: this.stiffness, damping: this.damping, calm: false };
  }

  /**
   * Advances by `dt` seconds and returns the new value.
   *
   * Semi-implicit Euler: the velocity is updated first (its damping solved exactly over
   * the slice, so damping can never add energy), and the position then moves with the
   * new velocity. Frames are cut into slices of at most 4 ms (shorter for stiff
   * springs), so a 50 ms frame is as stable and nearly as exact as a 4 ms one.
   */
  step(dt: number): number {
    if (!(dt > 0)) return this.value;
    const { stiffness, damping, calm } = this.tuning();
    if (dt > LONG_PAUSE) return this.rest();
    const slice = Math.min(SLICE, 0.15 / Math.sqrt(Math.max(stiffness, 1e-6)));
    const n = Math.ceil(dt / slice);
    const h = dt / n;
    const keep = Math.exp(-damping * h);
    const push = damping > 1e-9 ? (1 - keep) / damping : h;
    const limit = this.overshootLimit;
    for (let i = 0; i < n; i++) {
      const before = this.value - this.target;
      this.velocity = this.velocity * keep - stiffness * before * push;
      this.value += h * this.velocity;
      const after = this.value - this.target;
      if (calm) {
        // "Less motion": the value arrives and stops, it never crosses the target.
        if (before === 0 || before * after <= 0) this.rest();
        continue;
      }
      if (limit === Infinity) continue;
      if (after !== 0 && before * after <= 0) {
        this.past = after > 0 ? 1 : -1;
      } else if (this.past !== 0 && (before * this.past <= 0 || Math.abs(before) > limit * 1.000001)) {
        // Someone moved the value or the target by hand: this is travel, not overshoot.
        this.past = 0;
      }
      if (this.past !== 0 && Math.abs(after) > limit) {
        this.value = this.target + this.past * limit;
        if (this.velocity * this.past > 0) this.velocity = 0;
      }
    }
    // What is left is far below anything a person can see: stop exactly on the target,
    // so that whoever draws from this value can stop redrawing.
    if (Math.abs(this.value - this.target) < REST_DISTANCE && Math.abs(this.velocity) < REST_SPEED) this.rest();
    return this.value;
  }

  /** Puts the spring at its target with no motion left. */
  rest(): number {
    this.value = this.target;
    this.velocity = 0;
    this.past = 0;
    return this.value;
  }

  /** Puts the spring at `v` with no motion left: for teleports and first placement. */
  jump(v: number): void {
    this.target = v;
    this.rest();
  }

  /** True when the value is within `eps` of the target and has all but stopped. */
  resting(eps = 1e-3): boolean {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < eps * 40;
  }
}

/**
 * Stiffness and damping of a spring that, released from rest, stays within 0.1 % of
 * the travel from `seconds` on, with damping ratio `zeta` (1 = no overshoot at all).
 */
export function tuned(seconds: number, zeta: number): { stiffness: number; damping: number } {
  // Envelope of the error: e^(-zeta w t) / sqrt(1 - zeta^2) for zeta < 1 and
  // (1 + w t) e^(-w t) at zeta = 1, where it reaches 0.001 at w t = 9.233.
  // The 6 % on top covers what the integrator loses on 50 ms frames.
  const w =
    (zeta >= 1 ? 9.233 / seconds : Math.log(1000 / Math.sqrt(1 - zeta * zeta)) / (zeta * seconds)) * 1.06;
  return { stiffness: w * w, damping: 2 * Math.min(zeta, 1) * w };
}

type Mood = { stiffness: number; damping: number };

/** A preset spring that reads the "Less motion" setting on every step. */
class FeelSpring extends Spring {
  constructor(
    private readonly lively: Mood,
    private readonly quiet: Mood | null,
    limit: number,
  ) {
    super(lively.stiffness, lively.damping);
    this.overshootLimit = limit;
  }

  protected override tuning(): { stiffness: number; damping: number; calm: boolean } {
    if (!motionReduced()) return { stiffness: this.lively.stiffness, damping: this.lively.damping, calm: false };
    const q = this.quiet ?? this.lively;
    return { stiffness: q.stiffness, damping: q.damping, calm: true };
  }

  override step(dt: number): number {
    // A wobble has no end state other than rest, so with "Less motion" it is simply still.
    if (this.quiet === null && motionReduced()) return this.rest();
    return super.step(dt);
  }
}

/** Times and swings from DESIGN "Motion"; the units of `value` are degrees for the first two. */
export const SETTLE_SECONDS = 0.25;
export const SETTLE_OVERSHOOT_DEG = 4;
export const WOBBLE_SECONDS = 1.2;
export const WOBBLE_SWING_DEG = 14;
export const WOBBLE_HZ = 4;
export const SNAP_SECONDS = 0.06;

/**
 * settle: an angle arrives at its stop (0 or 90 degrees) in 250 ms. Damping ratio
 * 0.715 overshoots a full 90 degree travel by 3.6 degrees and shorter travels by less;
 * a lid thrown by a fast hand is held at 4 degrees past the stop.
 */
const SETTLE = tuned(SETTLE_SECONDS, 0.715);
const SETTLE_QUIET = tuned(SETTLE_SECONDS, 1);

/**
 * wobble: a piece on a paper spring swings about its rest at 4 Hz and is still within
 * 1.2 s. `value` is the extra tilt in degrees around 0: set `value` or add to
 * `velocity` to push it. The swing never exceeds 14 degrees.
 */
const WOBBLE: Mood = (() => {
  const wd = 2 * Math.PI * WOBBLE_HZ;
  // Decay rate that brings the envelope to 0.1 % in the given time (zeta comes out near 0.23).
  const decay = (Math.log(1000 / Math.sqrt(1 - 0.23 * 0.23)) / WOBBLE_SECONDS) * 1.06;
  return { stiffness: wd * wd + decay * decay, damping: 2 * decay };
})();

/** snap: a piece clicks to the 5 mm grid in 60 ms with a hint of overshoot (1.5 %). */
const SNAP = tuned(SNAP_SECONDS, 0.8);
const SNAP_QUIET = tuned(SNAP_SECONDS, 1);

export const springs = {
  settle: (): Spring => new FeelSpring(SETTLE, SETTLE_QUIET, SETTLE_OVERSHOOT_DEG),
  wobble: (): Spring => new FeelSpring(WOBBLE, null, WOBBLE_SWING_DEG),
  snap: (): Spring => new FeelSpring(SNAP, SNAP_QUIET, Infinity),
};
