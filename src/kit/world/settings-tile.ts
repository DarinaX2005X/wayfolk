/**
 * The settings tile: a bone tile 6 × 6 cm. It is selected, not taken. Three slider
 * grooves with their knobs set at different places are pressed into its top, the sign of
 * settings without text.
 */
import { Object3D } from '@iwsdk/core';
import { bevelBox, cylinder, merge, placed } from './geom';
import { part } from './materials';
import { attachShadow } from './shadow';

export function createSettingsTile(): Object3D {
  const root = new Object3D();
  root.name = 'kit:settings-tile';
  root.userData.target = 'settings';
  const tile = part(bevelBox(0.06, 0.006, 0.06, 0.0015, 0.008), 'bone', 'settings:tile');
  root.add(tile);
  const grooves = merge([-0.014, 0, 0.014].map((z) => placed(bevelBox(0.036, 0.0008, 0.0024, 0.0003), [0, 0.006, z])));
  root.add(part(grooves, 'boneShade', 'settings:grooves'));
  const knobs = merge(
    [
      [-0.008, -0.014],
      [0.011, 0],
      [-0.002, 0.014],
    ].map(([x, z]) => placed(cylinder(0.0042, 0.0045, 0.003, 16), [x, 0.006, z])),
  );
  root.add(part(knobs, 'inkSoft', 'settings:knobs'));
  attachShadow(tile, { height: 0.006, size: [0.06, 0.06], rest: 0 });
  return root;
}
