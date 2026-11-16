/**
 * Starts the input layer for one World: the frame system, the dwell pointer, the
 * scenario hook `test.loseHand`, and the feel of the app (src/feel/bind.ts). Call it once after the World boots (the gallery does;
 * in the product the core feature should, see src/interact/runtime.ts).
 */
import type { App } from '../app/boot/world';
import { bindFeel } from '../feel/bind';
import { startDwell } from './head-pointer';
import { bindInteract as bindRuntime } from './runtime';

export function bindInteract(app: App): void {
  bindRuntime(app);
  bindFeel(app);
  startDwell();
}
