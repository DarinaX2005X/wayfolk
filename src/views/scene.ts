/**
 * The world objects the home view builds once and the run view works with. The home
 * feature (src/views/home/install.ts, order 10) fills it; later features read it.
 */
import type { Object3D, Vector3 } from '@iwsdk/core';
import type { Bench, InboxBlock, IslandView, ModeSwitch, Sky, LightRig, VoiceStone } from '../kit/world/types';

export type HomeScene = {
  sky: Sky;
  light: LightRig;
  home: Object3D;
  bench: Bench;
  inbox: InboxBlock;
  stake: Object3D & { top(): Vector3 };
  stone: VoiceStone;
  modeSwitch: ModeSwitch;
  settingsTile: Object3D;
  island: IslandView;
};

let scene: HomeScene | null = null;

export function setScene(s: HomeScene): void {
  scene = s;
}

export function homeScene(): HomeScene {
  if (!scene) throw new Error('the home scene is not built yet: src/views/home/install.ts (order 10) builds it');
  return scene;
}
