/**
 * `onReveal(grabbable, { lift, turnDeg, onOpen, onClose })`: a sheet in the hand opens
 * when it is lifted toward the seat by `lift` (6 cm) above where it was taken, or turned
 * by `turnDeg` (60°) around any axis in the plane of the sheet (PLAN "Тяга и
 * раскрытие"). It closes with hysteresis (below 3 cm and under 35°) or when let go.
 * Lifting alone is enough: no turn of the wrist is needed.
 *
 * Without a hand: a select of the proxy (ray, gaze, dwell, click) opens the sheet where
 * it lies, raising it 6 cm; a second select closes it. At the desk the mouse wheel over
 * the sheet opens it (wheel up) and closes it (wheel down).
 *
 * The sheet's own plane is its local XZ plane (normal +Y), as the kit builds slips.
 */
import { Quaternion, Vector3 } from '@iwsdk/core';
import { answer } from '../feel';
import { RULES, RevealState, liftOf, turnOf, type V3 } from './logic';
import type { Grabbable } from './grab';
import { grabState } from './grab';
import { onSelect } from './select';
import { everyFrame, eyes, now, report, whenAttached } from './runtime';

export type RevealOptions = { lift: number; turnDeg: number; onOpen(): void; onClose(): void };

const UP = new Vector3(0, 1, 0);

export function onReveal(g: Grabbable, opts: RevealOptions): () => void {
  const state = new RevealState(opts.lift || RULES.lift, opts.turnDeg || RULES.turnDeg);
  let alive = true;
  let wasHeld = false;
  const start = new Vector3();
  const n0 = new Vector3();
  const p = new Vector3();
  const n = new Vector3();
  const q = new Quaternion();
  const eye = new Vector3();
  /** Raised in place by a select (no hand): the lift tween. */
  let raised = false;
  let lift: { from: number; to: number; t0: number; ms: number } | null = null;

  const open = (input: 'hand' | 'ray' | 'gaze' | 'dwell' | 'mouse'): void => {
    answer({ type: 'slip-open', at: g.handle.getWorldPosition(new Vector3()) });
    report('reveal', g.proxy, input);
    opts.onOpen();
  };
  const close = (): void => opts.onClose();

  const raiseInPlace = (up: boolean): void => {
    const base = grabState(g.handle)?.home.p.y ?? g.handle.position.y;
    lift = { from: g.handle.position.y, to: up ? base + RULES.lift : base, t0: now(), ms: up ? 220 : 160 };
  };

  const offSelect = onSelect(
    g.proxy,
    (input) => {
      if (grabState(g.handle)?.held) return;
      raised = !raised;
      raiseInPlace(raised);
      if (raised) {
        state.open = true;
        open(input);
      } else {
        state.open = false;
        close();
      }
    },
    { feel: null, nearOf: g.handle },
  );

  const onWheel = (event: unknown): void => {
    const native = (event as { nativeEvent?: WheelEvent }).nativeEvent;
    const dy = native?.deltaY ?? 0;
    if (dy === 0 || grabState(g.handle)?.held) return;
    const want = dy < 0;
    if (want === raised) return;
    raised = want;
    raiseInPlace(raised);
    state.open = raised;
    if (raised) open('mouse');
    else close();
  };
  g.proxy.addEventListener('wheel' as never, onWheel as never);

  let stop: (() => void) | null = null;
  whenAttached(g.handle, () => {
    if (!alive) return;
    stop = everyFrame((_dt, t) => {
      const held = grabState(g.handle)?.held ?? null;
      g.handle.updateWorldMatrix(true, false);
      if (held && !wasHeld) {
        // Taken: measure from here. A sheet raised by a select is taken as it is.
        lift = null;
        raised = false;
        g.handle.getWorldPosition(start);
        n0.copy(UP).applyQuaternion(g.handle.getWorldQuaternion(q));
        if (state.open) {
          state.open = false;
          close();
        }
      }
      if (held) {
        g.handle.getWorldPosition(p);
        n.copy(UP).applyQuaternion(g.handle.getWorldQuaternion(q));
        const m = liftOf(start.toArray() as V3, p.toArray() as V3, eyes(eye).toArray() as V3);
        const turn = turnOf(n0.toArray() as V3, n.toArray() as V3);
        const change = state.update(m, turn);
        if (change === 'open') open(held === 'mouse' ? 'mouse' : 'hand');
        if (change === 'close') close();
      } else if (wasHeld && state.release() === 'close') {
        close();
      }
      wasHeld = held !== null;
      if (lift && !held) {
        const k = Math.min(1, (t - lift.t0) / lift.ms);
        g.handle.position.y = lift.from + (lift.to - lift.from) * (1 - (1 - k) ** 3);
        if (k >= 1) lift = null;
      }
    });
  });

  return () => {
    alive = false;
    stop?.();
    offSelect();
    g.proxy.removeEventListener('wheel' as never, onWheel as never);
  };
}
