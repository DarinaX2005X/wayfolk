/**
 * Feel: one source of the answer to every action. Springs, the sound palette, the
 * answer plan and the caption queue; every screen imports them from here so that motion,
 * sound and captions never differ between features. Signatures follow PLAN "Набор
 * ремесла" (src/feel/).
 */
export { Spring, springs } from './spring';
export { sound } from './sound';
export type { SoundName } from './sound';
export { answer, onFeel, sightMs } from './answer';
export { PLAN, type Answer, type FeelEvent, type FeelName } from './plan';
export { say, captions } from './captions';
export { motionReduced } from './motion';
