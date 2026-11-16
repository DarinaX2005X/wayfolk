/**
 * Feel: one source of the answer to every action. Springs, the sound palette and
 * the answer plan; every screen imports them from here so that motion
 * and sound never differ between features. Signatures follow PLAN "Contracts", "Feel".
 */
export { Spring, springs } from './spring';
export { sound } from './sound';
export type { LoopName, SoundName } from './sound';
export { answer, onFeel } from './answer';
export { PLAN, type Answer, type FeelEvent, type FeelName } from './plan';
export { motionReduced } from './motion';
