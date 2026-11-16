/**
 * The "Less motion" setting, read in one place. Springs and the answer plan ask this
 * function and nothing else, so the source of the setting can change here alone.
 */
import { store } from '../app/store';

/** True when the person asked for less motion: no overshoot, no wobble, same end states. */
export function motionReduced(): boolean {
  return store.settings.value.lessMotion === true;
}
