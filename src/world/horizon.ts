/**
 * Other islands floating on the horizon: public islands and friends' islands named by
 * setHorizon, plus a few far ones that are always there. Each is a small village on a cliff
 * cone, merged into one batch. Lit windows at night come from the glow mask.
 */
import { BufferGeometry, Vector3 } from '@iwsdk/core';
import { CATALOG } from './catalog';
import { M, blob, cone, hashString, join, paint, place, rng } from './geo';
import { kitGeometry } from './kit';
import type { Batch } from './batch';

export interface HorizonIsland {
  id: string;
  name: string;
  pos: Vector3;
  radius: number;
}

/** Bearings (radians from forward −z, positive to the right) kept for named islands. */
const SLOTS = [-0.62, 0.78, -1.25, 1.32, -0.15, 0.3, -1.75, 1.85];

function islandGeometry(seed: number, radius: number, village: boolean): BufferGeometry {
  const r = rng(seed);
  const parts: BufferGeometry[] = [];
  // top: a squashed lumpy disc of grass
  const top = paint(blob(radius, 2, seed, 0.06, 0.16), '#7cb24b', { shade: 0.15, mat: M.grass }, true);
  top.translate(0, -radius * 0.04, 0);
  parts.push(top);
  // underside: a rocky cone in warm strata
  const under = paint(cone(radius * 0.95, radius * 1.5, 12).rotateX(Math.PI).translate(0, -radius * 0.08, 0), '#b07a4c', { shade: 0.45, mat: M.rock }, true);
  parts.push(under);
  const hillIds = ['hills-trees-a', 'hills-trees-b', 'mountain-a', 'mountain-b'];
  const hill = hillIds[seed % hillIds.length];
  parts.push(place(kitGeometry(hill, (radius / 1.9) * (0.7 + r() * 0.2)), [radius * -0.35, radius * 0.05, radius * -0.25], [0, r() * 6.28, 0]));
  const trees = ['tree-round-a', 'tree-round-b', 'pine-yellow-medium', 'pine-orange-medium', 'trees-a-medium'];
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const d = radius * (0.35 + r() * 0.5);
    const id = trees[Math.floor(r() * trees.length)];
    parts.push(place(kitGeometry(id, CATALOG[id].scale * (1.1 + r() * 0.5)), [Math.cos(a) * d, radius * 0.05, Math.sin(a) * d], [0, r() * 6.28, 0]));
  }
  if (village) {
    const blds = ['bld-home-a', 'bld-home-b', 'bld-windmill', 'bld-tower', 'bld-church', 'bld-tavern', 'bld-well', 'bld-watermill', 'bld-market'];
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r();
      const d = radius * (0.15 + r() * 0.4);
      const id = blds[Math.floor(r() * blds.length)];
      parts.push(place(kitGeometry(id, 6 + r() * 2), [Math.cos(a) * d + radius * 0.2, radius * 0.06, Math.sin(a) * d + radius * 0.15], [0, r() * 6.28, 0]));
      // a lit window or two
      parts.push(paint(place(blob(0.55, 0, i, 0.1), [Math.cos(a) * d + radius * 0.2, radius * 0.06 + 2.2, Math.sin(a) * d + radius * 0.15 + 2.6]), '#ffd38a', { glow: true }));
    }
  }
  return join(parts);
}

export interface Horizon {
  set(list: { id: string; name: string }[]): void;
  get(id: string): HorizonIsland | undefined;
  all(): HorizonIsland[];
}

export function createHorizon(batch: Batch): Horizon {
  const named = new Map<string, HorizonIsland>();
  // the always-there far islands
  const far: [number, number, number, number][] = [
    [-0.95, 330, 26, 14], [0.35, 380, 34, 30], [1.05, 300, 22, 6], [-0.35, 420, 40, 22], [2.3, 360, 28, 18], [-2.4, 340, 30, 10],
  ];
  far.forEach(([bearing, dist, rad, y], i) => {
    const g = islandGeometry(900 + i, rad, i % 2 === 0);
    batch.add(`far:${i}`, place(g, [Math.sin(bearing) * dist, y - 8, -Math.cos(bearing) * dist], [0, bearing, 0]));
  });
  const place1 = (id: string, name: string, slot: number): HorizonIsland => {
    const seed = hashString(id);
    const r = rng(seed);
    const bearing = SLOTS[slot % SLOTS.length] + (r() - 0.5) * 0.12;
    const dist = 120 + (slot % 3) * 35 + r() * 20;
    const radius = 11 + r() * 5;
    const pos = new Vector3(Math.sin(bearing) * dist, -1 + r() * 6, -10 - Math.cos(bearing) * dist);
    batch.add(`named:${id}`, place(islandGeometry(seed, radius, true), [pos.x, pos.y, pos.z], [0, r() * 6.28, 0]));
    return { id, name, pos, radius };
  };
  return {
    set(list) {
      for (const id of named.keys()) batch.remove(`named:${id}`);
      named.clear();
      list.slice(0, SLOTS.length).forEach((it, i) => named.set(it.id, place1(it.id, it.name, i)));
    },
    get: (id) => named.get(id),
    all: () => [...named.values()],
  };
}
