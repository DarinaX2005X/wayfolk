/**
 * `onSelect(obj, fn, opts)`: one select from every input the product supports
 * (PLAN "Набор ремесла"):
 *   - a pinch along a hand ray (or a controller trigger),
 *   - a fingertip press on a panel button (PokeInteractable on the panel root),
 *   - a pinch while looking at the target (gaze on the glasses),
 *   - dwell of the pointer when the setting is on (./head-pointer.ts),
 *   - a mouse click at the desk.
 * All of them arrive as one `click` of @pmndrs/pointer-events on the object, except
 * dwell, which this layer fires itself. Two selects within 300 ms are one; a ray select
 * from a hand already within 12 cm of a takeable object is left to the grab.
 */
import type { Object3D } from '@iwsdk/core';
import type { InputKind } from '../app/store';
import { answer, type FeelName } from '../feel';
import { RULES, SelectGuard } from './logic';
import {
  handDistance,
  makeInteractable,
  now,
  report,
  sourceOf,
  underRayRoot,
  whenAttached,
  worldCenter,
  type PointerEventLike,
} from './runtime';

export type SelectOptions = {
  /** Selectable by dwell too (on by default; the setting `dwell` still has to be on). */
  dwell?: boolean;
  /** Remove the handler after the first select. */
  once?: boolean;
  /** Answer to play while the pointer is over the object (lift and no sound for `hover`). */
  hover?: FeelName;
  /** The answer of the select itself; `select` by default, null for none (the caller answers). */
  feel?: FeelName | null;
  /** Fingertip press too (panel buttons). */
  poke?: boolean;
  /** For takeable objects: the handle a near hand would take instead. */
  nearOf?: Object3D;
  /** False while the target cannot be selected (a disabled button). */
  enabled?: () => boolean;
};

export type SelectTarget = {
  obj: Object3D;
  fire(input: InputKind): void;
  dwell: boolean;
  enabled: () => boolean;
};

/** Every live select target: the dwell pointer looks among these. */
export const selectTargets = new Set<SelectTarget>();

const guard = new SelectGuard();
const listeners = new Map<Object3D, number>();

/** Suppresses the next click on an object (a mouse drag that ended on it). */
const swallow = new WeakSet<Object3D>();
export function swallowClick(obj: Object3D): void {
  swallow.add(obj);
}

export function onSelect(obj: Object3D, fn: (input: InputKind) => void, opts: SelectOptions = {}): () => void {
  let alive = true;
  const enabled = opts.enabled ?? (() => true);

  const fire = (input: InputKind): void => {
    if (!alive || !enabled()) return;
    if (!guard.accept(obj, now())) return;
    if (opts.feel !== null) {
      try {
        answer({ type: opts.feel ?? 'select', at: worldCenter(obj, obj.position.clone()) });
      } catch {
        // Sound never blocks the action.
      }
    }
    report('select', obj, input);
    if (opts.once) off();
    fn(input);
  };

  const onClick = (event: unknown): void => {
    const e = event as PointerEventLike;
    if (swallow.has(obj)) {
      swallow.delete(obj);
      return;
    }
    const source = sourceOf(e);
    // A hand right at a takeable object takes it; its ray pinch is not a select.
    if (opts.nearOf && source.hand && source.kind === 'ray' && handDistance(source.hand, opts.nearOf) < RULES.nearHand) return;
    e.stopPropagation?.();
    fire(source.kind);
  };
  const onEnter = (): void => {
    if (opts.hover) answer({ type: opts.hover });
  };

  const entry: SelectTarget = { obj, fire, dwell: opts.dwell !== false, enabled };
  selectTargets.add(entry);

  obj.addEventListener('click' as never, onClick as never);
  if (opts.hover) obj.addEventListener('pointerenter' as never, onEnter as never);
  listeners.set(obj, (listeners.get(obj) ?? 0) + 1);

  whenAttached(obj, ({ world }) => {
    if (!alive) return;
    // Buttons of a panel are reached through the panel root, which already answers rays.
    if (!underRayRoot(obj)) makeInteractable(world, obj, opts.poke);
  });

  function off(): void {
    if (!alive) return;
    alive = false;
    selectTargets.delete(entry);
    obj.removeEventListener('click' as never, onClick as never);
    obj.removeEventListener('pointerenter' as never, onEnter as never);
  }
  return off;
}
