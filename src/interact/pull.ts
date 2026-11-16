/**
 * `onPull(bead, { toward: 'seat', threshold, onProgress, onCommit, onCancel })`: pulling
 * the bead of a red thread toward oneself (PLAN "Тяга и раскрытие").
 *
 * Written as its own handler, not `DistanceGrabbable`: that one pulls the object to the
 * hand by itself and leaves no travel to measure. Here a `pointerdown` on the bead from
 * a hand ray remembers where that hand's wrist is; then every frame the bead rides from
 * its own point toward the seat by the projection of the wrist's travel on that axis,
 * and `onProgress(k)` reports the share of the threshold. At the threshold `onCommit()`
 * fires once; letting go earlier calls `onCancel()` and the bead returns.
 *
 * Without a hand to pull with, the pull is a select: gaze, dwell and a ray pinch that
 * cannot measure a wrist commit at once. At the desk a drag of the bead 120 px down the
 * screen is the pull. Only one thread is pulled at a time.
 */
import { Vector3, type Object3D } from '@iwsdk/core';
import { answer } from '../feel';
import { PullState, RULES, mousePull, pullProgress, type Hand, type V3 } from './logic';
import { holds } from './grab';
import { onSelect, swallowClick } from './select';
import { everyFrame, now, report, seatPoint, selectHeld, sourceOf, whenAttached, wristOf, type PointerEventLike } from './runtime';

export type PullOptions = {
  toward: 'seat';
  threshold: number;
  onProgress(k: number): void;
  onCommit(): void;
  onCancel(): void;
};

type Active = {
  hand: Hand | 'mouse';
  state: PullState;
  wrist0: Vector3;
  start: Vector3;
  /** Unit axis from the bead toward the seat, world. */
  axis: Vector3;
  /** The bead's local position when the pull began. */
  local0: Vector3;
  y0: number;
};

export function onPull(bead: Object3D, opts: PullOptions): () => void {
  const threshold = opts.threshold > 0 ? opts.threshold : RULES.pullThreshold;
  let active: Active | null = null;
  let back: { from: Vector3; to: Vector3; t0: number } | null = null;
  let alive = true;
  const wrist = new Vector3();
  const tmp = new Vector3();

  const place = (k: number): void => {
    if (!active) return;
    // The bead rides along the axis by the travel of the hand, capped at the threshold.
    const world = tmp.copy(active.start).addScaledVector(active.axis, k * threshold);
    bead.parent?.worldToLocal(world);
    bead.position.copy(world);
  };

  const finish = (): void => {
    if (!active) return;
    const a = active;
    active = null;
    holds.endPull(bead);
    back = { from: bead.position.clone(), to: a.local0.clone(), t0: now() };
    const end = a.state.release();
    if (end === 'cancel') opts.onCancel();
  };

  const progress = (k: number): void => {
    if (!active) return;
    place(k);
    opts.onProgress(k);
    if (active.state.update(k) === 'commit') {
      answer({ type: 'thread-pull', at: active.start });
      report('pull', bead, active.hand === 'mouse' ? 'mouse' : 'ray');
      opts.onCommit();
    }
  };

  const begin = (hand: Hand | 'mouse', y0 = 0): boolean => {
    if (active || !holds.startPull(bead, hand === 'mouse' ? 'right' : hand)) return false;
    bead.updateWorldMatrix(true, false);
    const start = bead.getWorldPosition(new Vector3());
    const seat = seatPoint(new Vector3());
    const axis = seat.sub(start);
    axis.y = 0;
    if (axis.lengthSq() < 1e-9) axis.set(0, 0, 1);
    axis.normalize();
    const w0 = hand === 'mouse' ? new Vector3() : (wristOf(hand, new Vector3()) ?? new Vector3());
    active = { hand, state: new PullState(), wrist0: w0, start, axis, local0: back ? back.to.clone() : bead.position.clone(), y0 };
    back = null;
    return true;
  };

  const onDown = (event: unknown): void => {
    const e = event as PointerEventLike;
    const source = sourceOf(e);
    if (source.kind === 'mouse') {
      const native = e.nativeEvent as PointerEvent | undefined;
      if (!native || !begin('mouse', native.clientY)) return;
      e.stopPropagation?.();
      let moved = false;
      const onMove = (ev: PointerEvent): void => {
        if (!active) return;
        const dy = ev.clientY - active.y0;
        if (Math.abs(dy) > 4) moved = true;
        progress(mousePull(dy));
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (moved) swallowClick(bead);
        finish();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      return;
    }
    if (source.kind !== 'ray' || !source.hand) return;
    if (!wristOf(source.hand, wrist)) return;
    if (!begin(source.hand)) return;
    e.stopPropagation?.();
    // Keep the pointer on the bead while the hand moves, so its release reaches us.
    try {
      e.target?.setPointerCapture?.(e.pointerId ?? 0);
    } catch {
      // Capture is a convenience; the frame loop also watches the pinch.
    }
  };

  const onUp = (): void => {
    if (active && active.hand !== 'mouse') finish();
  };

  bead.addEventListener('pointerdown' as never, onDown as never);
  bead.addEventListener('pointerup' as never, onUp as never);

  // Gaze, dwell and a pinch that measured nothing: the pull is a select.
  const offSelect = onSelect(
    bead,
    (input) => {
      if (input === 'gaze' || input === 'dwell') {
        answer({ type: 'thread-pull' });
        opts.onProgress(1);
        opts.onCommit();
      }
    },
    { feel: null },
  );

  let stop: (() => void) | null = null;
  whenAttached(bead, () => {
    if (!alive) return;
    stop = everyFrame((_dt, t) => {
      if (active && active.hand !== 'mouse') {
        const hand = active.hand;
        if (!selectHeld(hand) || !wristOf(hand, wrist)) {
          finish();
          return;
        }
        progress(pullProgress(active.wrist0.toArray() as V3, wrist.toArray() as V3, active.axis.toArray() as V3, threshold));
      } else if (back) {
        const k = Math.min(1, (t - back.t0) / RULES.returnMs);
        const e = 1 - (1 - k) ** 3;
        bead.position.lerpVectors(back.from, back.to, e);
        if (k >= 1) back = null;
      }
    });
  });

  return () => {
    alive = false;
    stop?.();
    offSelect();
    bead.removeEventListener('pointerdown' as never, onDown as never);
    bead.removeEventListener('pointerup' as never, onUp as never);
    holds.endPull(bead);
  };
}
