/**
 * The token of the second person: a bone disc 4 cm with a `steel` ring and the name on
 * a label at its edge. Steel never lies on slate alone: the token has its bone base.
 */
import { Object3D } from '@iwsdk/core';
import { cylinder, flatRing } from './geom';
import { createLabel } from './label';
import { part } from './materials';
import { attachShadow } from './shadow';

export function createToken(label: string): Object3D {
  const root = new Object3D();
  root.name = 'kit:token';
  const disc = part(cylinder(0.02, 0.0205, 0.006, 32), 'bone', 'token:disc');
  root.add(disc);
  const ring = part(flatRing(0.0165, 0.0018, 32), 'steel', 'token:ring');
  ring.position.y = 0.0062;
  root.add(ring);
  const name = createLabel(label, { role: 'label', width: 0.07, eyeDist: 0.55, lines: 1, weight: 700, align: 'center' });
  name.rotation.x = -Math.PI / 2;
  name.position.set(0, 0.0005, 0.032);
  root.add(name);
  attachShadow(disc, { height: 0.006, size: [0.04, 0.04], rest: 0 });
  return root;
}
