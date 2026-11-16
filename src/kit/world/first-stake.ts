/**
 * The first stake: a cobalt stake 5 cm high and 16 mm across on a bone plate 12 × 9 cm
 * with the dashed outline of an envelope. The plate is there because cobalt does not read
 * on slate (1.91). An envelope set here starts the run, and the plan line leaves from
 * the top of the stake. `top()` gives that point in the stake's own frame.
 */
import { Object3D, Vector3 } from '@iwsdk/core';
import { bevelBox, box, cylinder, merge, placed, sphere } from './geom';
import { part } from './materials';
import { attachShadow } from './shadow';

export const STAKE = { h: 0.05, d: 0.016 };
export const PLATE = { w: 0.12, d: 0.09, h: 0.006 };

/** A cobalt stake geometry (base on y = 0): a slim cylinder with a rounded head. */
export function stakeGeometry(): ReturnType<typeof merge> {
  return merge([cylinder(STAKE.d / 2, STAKE.d / 2, STAKE.h - STAKE.d / 2, 16), placed(sphere(STAKE.d / 2, 16, 8), [0, STAKE.h - STAKE.d / 2, 0])]);
}

export function createFirstStake(): Object3D & { top(): Vector3 } {
  const root = new Object3D() as Object3D & { top(): Vector3 };
  root.name = 'kit:first-stake';
  root.userData.target = 'first-stake';
  const plate = part(bevelBox(PLATE.w, PLATE.h, PLATE.d, 0.0015, 0.008), 'bone', 'first-stake:plate');
  root.add(plate);
  // Dashed outline of an envelope (8 × 5.4 cm) in front of the stake, with the flap's V.
  const w = 0.08;
  const d = 0.054;
  const z0 = 0.008;
  const dashes = [];
  const dash = (x: number, z: number, along: 'x' | 'z', len: number): void => {
    dashes.push(placed(box(along === 'x' ? len : 0.0016, 0.0005, along === 'z' ? len : 0.0016), [x, 0, z]));
  };
  const nx = 7;
  for (let i = 0; i < nx; i++) {
    const x = -w / 2 + ((i + 0.5) * w) / nx;
    dash(x, z0 - d / 2, 'x', (w / nx) * 0.55);
    dash(x, z0 + d / 2, 'x', (w / nx) * 0.55);
  }
  const nz = 5;
  for (let i = 0; i < nz; i++) {
    const z = z0 - d / 2 + ((i + 0.5) * d) / nz;
    dash(-w / 2, z, 'z', (d / nz) * 0.55);
    dash(w / 2, z, 'z', (d / nz) * 0.55);
  }
  // The flap: two dashed diagonals meeting below the top edge.
  for (let i = 0; i < 4; i++) {
    const k = (i + 0.5) / 4;
    const len = 0.007;
    for (const side of [-1, 1]) {
      const x = side * (w / 2) * (1 - k);
      const z = z0 - d / 2 + k * d * 0.5;
      dashes.push(placed(box(len, 0.0005, 0.0016), [x, 0, z], [0, side * Math.atan2(d * 0.5, w / 2), 0]));
    }
  }
  const outline = part(merge(dashes), 'cobalt', 'first-stake:outline');
  outline.position.y = PLATE.h;
  root.add(outline);
  const stake = part(stakeGeometry(), 'cobalt', 'first-stake:stake');
  stake.position.set(0, PLATE.h, -PLATE.d / 2 + 0.014);
  root.add(stake);
  attachShadow(plate, { height: PLATE.h, size: [PLATE.w, PLATE.d], rest: 0 });
  attachShadow(stake, { height: STAKE.h, size: [STAKE.d, STAKE.d], rest: PLATE.h, strength: 0.8 });
  root.top = () => new Vector3(0, PLATE.h + STAKE.h, -PLATE.d / 2 + 0.014);
  return root;
}
