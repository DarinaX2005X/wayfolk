/**
 * Small life round every house, so a close look is rewarded: a washing line whose laundry
 * moves in the wind, a cat dozing on a crate or the doorstep (its tail stirs), firewood under
 * a little roof, a watering can, crates, a bicycle against the wall, stepping stones to the
 * door, and a scarecrow by a vegetable patch for the growing trades. What a house gets and
 * where it stands follows from its id, so it is the same every time the island loads.
 */
import { TorusGeometry, type BufferGeometry } from '@iwsdk/core';
import type { HouseSpec } from '../mind/types';
import { M, MAT, ball, blob, cbox, cone, cyl, mixHex, place, rng, tone, type Hex, type PaintOpts } from './geo';
import { mossyRock } from './props';

type Part = [BufferGeometry, Hex, PaintOpts?];

/** What the yard needs from the house builder. */
export interface YardHost {
  spec: HouseSpec;
  add(stage: 'props', name: string, parts: Part[]): void;
  prop(id: string, x: number, z: number, rotY?: number, y?: number, scaleK?: number): void;
  /** Ground points already used by the recipe's props (house frame). */
  used: { x: number; z: number; r: number }[];
  /** Half sizes of the house body on the ground (house frame). */
  half: { x: number; z: number };
}

const at = (parts: Part[], x: number, y: number, z: number, rotY = 0): Part[] => parts.map(([g, c, o]) => [place(g, [x, y, z], [0, rotY, 0]), c, o]);

function laundry(r: () => number, colours: Hex[]): Part[] {
  const len = 1.9;
  const parts: Part[] = [];
  for (const z of [-len / 2, len / 2]) {
    parts.push([place(cbox(0.07, 1.45, 0.07, 0.015), [0, 0, z]), MAT.woodDark]);
    parts.push([place(cbox(0.05, 0.05, 0.3, 0.01), [0, 1.38, z]), MAT.woodDark]);
  }
  parts.push([place(cyl(0.008, 0.008, len, 4), [0, 1.36, -len / 2], [Math.PI / 2, 0, 0]), MAT.rope]);
  let z = -len / 2 + 0.2;
  while (z < len / 2 - 0.3) {
    const w = 0.28 + r() * 0.22;
    const h = 0.32 + r() * 0.3;
    const c = colours[Math.floor(r() * colours.length)];
    const sheet = cbox(0.02, h, w, 0.005);
    parts.push([place(sheet, [0, 1.36 - h, z + w / 2], [0, 0, (r() - 0.5) * 0.05]), c, { flutter: 'down', mat: M.cloth, shade: 0.12 }]);
    parts.push([place(cbox(0.03, 0.04, 0.02, 0.005), [0, 1.34, z + 0.05]), MAT.woodLight]);
    z += w + 0.07 + r() * 0.08;
  }
  return parts;
}

function cat(r: () => number): Part[] {
  const coats: [Hex, Hex][] = [['#e0894a', '#f6d2a8'], ['#7d7f86', '#d9d6cf'], ['#3a3433', '#f1ece2'], ['#c9a17a', '#f4e6cf']];
  const [fur, belly] = coats[Math.floor(r() * coats.length)];
  const smooth: PaintOpts = { smooth: true, shade: 0.3, mat: M.plain };
  return [
    [place(blob(0.1, 1, 3, 0.04), [0, 0.1, 0], [0, 0, 0], [1.05, 1.15, 1.35]), fur, smooth],
    [place(blob(0.06, 1, 4, 0.03), [0, 0.1, 0.09], [0, 0, 0], [1, 1.2, 0.6]), belly, smooth],
    [place(ball(0.075, 10, 8), [0, 0.25, 0.08], [0, 0, 0], [1.1, 0.95, 1]), fur, smooth],
    [place(cone(0.032, 0.06, 4), [-0.045, 0.3, 0.07], [0, 0.4, -0.25]), fur, { shade: 0.1 }],
    [place(cone(0.032, 0.06, 4), [0.045, 0.3, 0.07], [0, -0.4, 0.25]), fur, { shade: 0.1 }],
    [place(ball(0.012, 6, 4), [-0.028, 0.26, 0.15]), '#2a2420', { shade: 0 }],
    [place(ball(0.012, 6, 4), [0.028, 0.26, 0.15]), '#2a2420', { shade: 0 }],
    [place(ball(0.03, 8, 6), [-0.06, 0.02, 0.12], [0, 0, 0], [1, 0.6, 1.4]), belly, smooth],
    [place(ball(0.03, 8, 6), [0.06, 0.02, 0.12], [0, 0, 0], [1, 0.6, 1.4]), belly, smooth],
    // the tail curls round the paws and stirs in the wind
    [place(cyl(0.022, 0.026, 0.22, 6), [0.09, 0.03, -0.1], [Math.PI / 2 - 0.2, 0.9, 0]), fur, { flutter: 'all', mat: M.plain, shade: 0.1 }],
    [place(cyl(0.02, 0.022, 0.16, 6), [0.17, 0.02, 0.03], [Math.PI / 2, -0.2, 0]), fur, { flutter: 'all', mat: M.plain, shade: 0.1 }],
  ];
}

function firewood(r: () => number): Part[] {
  const parts: Part[] = [];
  const rows = [5, 4, 3];
  rows.forEach((n, k) => {
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 0.17;
      parts.push([place(cyl(0.075, 0.075, 0.55, 7), [x, 0.08 + k * 0.14, -0.27], [Math.PI / 2, 0, r() * 3]), tone(MAT.wood, 0.9 + r() * 0.25), { mat: M.bark }]);
      parts.push([place(cyl(0.06, 0.06, 0.01, 7), [x, 0.08 + k * 0.14, 0.285], [Math.PI / 2, 0, 0]), '#e3bf8a', { shade: 0, mat: M.plank }]);
    }
  });
  // a small lean-to roof
  for (const x of [-0.5, 0.5]) parts.push([place(cbox(0.06, 0.75, 0.06, 0.01), [x, 0, -0.32]), MAT.woodDark]);
  parts.push([place(cbox(1.2, 0.05, 0.75, 0.015), [0, 0.74, -0.05], [-0.25, 0, 0]), MAT.plank]);
  parts.push([place(cyl(0.12, 0.12, 0.2, 8), [0.72, 0, 0.1]), MAT.wood, { mat: M.bark }]);
  parts.push([place(cbox(0.03, 0.22, 0.05, 0.01), [0.72, 0.2, 0.1], [0, 0, 0.5]), MAT.woodLight]);
  parts.push([place(cbox(0.1, 0.04, 0.03, 0.01), [0.78, 0.33, 0.1], [0, 0, 0.5]), MAT.iron]);
  return parts;
}

function wateringCan(colour: Hex): Part[] {
  return [
    [cyl(0.09, 0.1, 0.2, 10), colour, { shade: 0.2 }],
    [place(cyl(0.012, 0.02, 0.24, 6), [0.08, 0.06, 0], [0, 0, -0.9]), colour, { shade: 0.1 }],
    [place(cyl(0.03, 0.02, 0.03, 6), [0.27, 0.22, 0], [0, 0, -0.9]), tone(colour, 0.8)],
    [place(new TorusGeometry(0.07, 0.012, 5, 10, Math.PI), [-0.02, 0.2, 0], [0, 0, 0]), tone(colour, 0.85)],
  ];
}

function bicycle(colour: Hex): Part[] {
  const wheel = (x: number): Part[] => [
    [place(new TorusGeometry(0.26, 0.025, 6, 18), [x, 0.28, 0]), '#2e2a2a', { mat: M.plain }],
    [place(cyl(0.008, 0.008, 0.5, 4), [x, 0.03, 0], [0, 0, 0]), MAT.iron],
    [place(cyl(0.008, 0.008, 0.5, 4), [x - 0.25, 0.28, 0], [0, 0, Math.PI / 2]), MAT.iron],
  ];
  return [
    ...wheel(-0.45),
    ...wheel(0.45),
    [place(cyl(0.02, 0.02, 0.6, 6), [-0.45, 0.28, 0], [0, 0, -1.1]), colour],
    [place(cyl(0.02, 0.02, 0.55, 6), [0.05, 0.3, 0], [0, 0, 0.25]), colour],
    [place(cyl(0.02, 0.02, 0.62, 6), [-0.02, 0.62, 0], [0, 0, -Math.PI / 2 + 0.08]), colour],
    [place(cyl(0.02, 0.02, 0.5, 6), [0.45, 0.28, 0], [0, 0, 0.35]), colour],
    [place(cbox(0.2, 0.04, 0.09, 0.015), [-0.05, 0.84, 0]), '#5a3a2a'],
    [place(cyl(0.015, 0.015, 0.4, 6), [0.32, 0.86, -0.2], [Math.PI / 2, 0, 0]), MAT.iron],
    [place(cbox(0.24, 0.12, 0.2, 0.02), [0.55, 0.62, 0]), MAT.straw, { mat: M.thatch }],
  ];
}

function patch(r: () => number): Part[] {
  const parts: Part[] = [[place(cbox(1.3, 0.12, 0.9, 0.04), [0, 0, 0]), MAT.soil, { mat: M.dirt }]];
  for (const z of [-0.22, 0.22])
    for (let i = 0; i < 4; i++) {
      const x = -0.45 + i * 0.3;
      const g = blob(0.07 + r() * 0.04, 1, i * 7 + (z > 0 ? 1 : 0), 0.2, 0.8);
      parts.push([place(g, [x, 0.17, z]), r() < 0.5 ? MAT.leaf : MAT.leafLight, { smooth: true, mat: M.leaf, shade: 0.3 }]);
      if (r() < 0.4) parts.push([place(ball(0.035, 6, 4), [x + 0.03, 0.2, z + 0.05]), r() < 0.5 ? '#e0582f' : '#f2a33a', { shade: 0.2 }]);
    }
  return parts;
}

/** Adds the yard to a house: always stepping stones, then a few things picked by the id. */
export function addYard(h: YardHost, door: [number, number, number]): void {
  const r = rng(`${h.spec.id}:yard`);
  const used = [...h.used];
  const free = (x: number, z: number, rad: number): boolean => {
    if (Math.abs(x) < h.half.x + rad * 0.7 && Math.abs(z) < h.half.z + rad * 0.7) return false;
    if (Math.hypot(x - door[0], z - door[2]) < 0.9 + rad) return false;
    return used.every((u) => Math.hypot(u.x - x, u.z - z) > u.r + rad);
  };
  const take = (x: number, z: number, rad: number): void => {
    used.push({ x, z, r: rad });
  };

  // stepping stones from the door out into the grass
  const stones: Part[] = [];
  for (let i = 0; i < 4; i++) {
    const s = 0.16 + r() * 0.06;
    const g = mossyRock(s, 700 + i + Math.floor(r() * 50), 0.35);
    stones.push([place(g, [door[0] + (i % 2 ? 0.12 : -0.1), -0.06 - s * 0.35, door[2] + 0.35 + i * 0.5], [0, r() * 6, 0], [1.25, 0.32, 1]), i % 2 ? '#a9a194' : '#b8ae9c', { mat: M.rock, shade: 0.25 }]);
  }
  h.add('props', 'prop:yard-stones', stones);

  const sides = [-1, 1];
  const sx = (s: number): number => s * (h.half.x + 0.75);
  const linen = [mixHex(h.spec.colors.wall, '#ffffff', 0.6), '#f4efe4', '#9cc1d9', mixHex(h.spec.colors.roof, '#ffffff', 0.35), '#f2c6c0', '#e9d9a6'];
  const picks = ['laundry', 'firewood', 'bicycle', 'can', 'crates', 'cat'];
  // a stable shuffle; growing trades always get their patch and scarecrow
  for (let i = picks.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [picks[i], picks[j]] = [picks[j], picks[i]];
  }
  const grower = h.spec.recipe === 'gardener' || h.spec.recipe === 'beekeeper' || h.spec.recipe === 'baker';
  const want = grower ? ['patch', ...picks.slice(0, 3)] : picks.slice(0, 4);
  const hasCat = want.includes('cat') || r() < 0.5;
  const order = [...want.filter((w) => w !== 'cat'), ...(hasCat ? ['cat'] : [])];
  let perch: { x: number; y: number; z: number } | null = null;

  for (const what of order) {
    if (what === 'laundry') {
      const s = sides[Math.floor(r() * 2)];
      for (const side of [s, -s]) {
        const x = sx(side) + side * 0.15;
        if (free(x, -0.6, 0.5) && free(x, 0.4, 0.5)) {
          h.add('props', 'prop:yard-laundry', at(laundry(r, linen), x, 0, -0.1, 0));
          take(x, -0.6, 0.5);
          take(x, 0.4, 0.5);
          break;
        }
      }
    } else if (what === 'firewood') {
      for (const [x, z, rot] of [[sx(-1), -0.9, Math.PI / 2], [sx(1), -0.9, -Math.PI / 2], [-0.9, -h.half.z - 0.6, Math.PI], [0.9, -h.half.z - 0.6, Math.PI]] as [number, number, number][]) {
        if (!free(x, z, 0.6)) continue;
        h.add('props', 'prop:yard-firewood', at(firewood(r), x, 0, z, rot));
        take(x, z, 0.6);
        if (!perch) perch = { x: x + Math.sin(rot) * -0.05, y: 0.52, z };
        break;
      }
    } else if (what === 'bicycle') {
      for (const s of sides) {
        const x = s * (h.half.x + 0.3);
        const z = h.half.z * 0.2;
        if (!free(x, z, 0.4)) continue;
        const g = at(bicycle(['#3f6f8f', '#b8483a', '#4f7d4a', '#d39b32'][Math.floor(r() * 4)]), 0, 0, 0, Math.PI / 2);
        h.add('props', 'prop:yard-bicycle', g.map(([gg, c, o]) => [place(gg, [x, 0, z], [0, 0, s * 0.12]), c, o]));
        take(x, z, 0.4);
        break;
      }
    } else if (what === 'can') {
      for (const [x, z] of [[door[0] + 0.75, door[2] - 0.1], [door[0] - 0.75, door[2] - 0.1], [sx(1), 1.0], [sx(-1), 1.0]] as [number, number][]) {
        if (!used.every((u) => Math.hypot(u.x - x, u.z - z) > u.r + 0.2)) continue;
        h.add('props', 'prop:yard-can', at(wateringCan(['#5f8f9f', '#7da35a', '#c46b4a'][Math.floor(r() * 3)]), x, 0, z, r() * 6));
        take(x, z, 0.2);
        break;
      }
    } else if (what === 'crates') {
      for (const [x, z] of [[sx(1), -h.half.z], [sx(-1), -h.half.z], [sx(1), h.half.z * 0.6], [sx(-1), h.half.z * 0.6]] as [number, number][]) {
        if (!free(x, z, 0.45)) continue;
        h.prop('crate-small', x, z, r() * 0.6 - 0.3);
        h.prop('crate-small', x + 0.05, z + 0.02, r() * 0.8, 0.3, 0.85);
        take(x, z, 0.45);
        if (!perch || r() < 0.5) perch = { x: x + 0.05, y: 0.55, z: z + 0.02 };
        break;
      }
    } else if (what === 'patch') {
      for (const s of sides) {
        const x = sx(s) + s * 0.25;
        const z = 0.6;
        if (!free(x, z, 0.75)) continue;
        h.add('props', 'prop:yard-patch', at(patch(r), x, 0, z, Math.PI / 2));
        take(x, z, 0.75);
        const cx = x + s * 0.2;
        const cz = z + 1.0;
        if (free(cx, cz, 0.3)) {
          h.prop('scarecrow', cx, cz, -s * 0.5);
          take(cx, cz, 0.3);
        }
        break;
      }
    } else if (what === 'cat') {
      // dozing on the firewood or a crate if there is one, else on the doorstep
      const spot = perch ?? { x: door[0] + 0.6, y: 0, z: door[2] - 0.1 };
      h.add('props', 'prop:yard-cat', at(cat(r), spot.x, spot.y, spot.z, (r() - 0.5) * 1.6));
    }
  }
}
