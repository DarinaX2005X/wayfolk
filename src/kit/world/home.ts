/**
 * The person's own plot: a disc of radius 0.9 m under the seat, top 0.55 m below the
 * eyes, made of three rings of tiles of the two `ground.home` tones with a 2.5 mm seam,
 * an even cut of 45 mm and the keel along the edge (DESIGN "Пространство в шлеме").
 * One merged geometry with baked colours: one draw, in the matte batch.
 */
import { Object3D, Shape, Color } from '@iwsdk/core';
import { COLOR, LAYOUT, MATERIAL } from '../../tokens/tokens';
import { zone } from '../../app/perf/zone';
import { cylinder, merge, prep, slab, tint } from './geom';
import { part } from './materials';
import { rand } from './time';

const RINGS = [
  { from: 0.0, to: 0.3, tiles: 1 },
  { from: 0.3, to: 0.6, tiles: 10 },
  { from: 0.6, to: 0.9, tiles: 16 },
];
const TILE = 0.014;
const SEAM = MATERIAL.seam.closed;

/** An annular tile from radius a to b and angle a0 to a1 (radians), seam inset. */
function annular(r0: number, r1: number, a0: number, a1: number, h: number): ReturnType<typeof slab> {
  const s = new Shape();
  const half = SEAM / 2;
  const inner = Math.max(r0 + half, 0);
  const outer = r1 - half;
  const steps = Math.max(4, Math.ceil(((a1 - a0) * outer) / 0.04));
  const da0 = (r: number): number => (r > 0 ? half / r : 0);
  const pt = (r: number, a: number): [number, number] => [r * Math.sin(a), r * Math.cos(a)];
  if (inner <= 1e-4) {
    // The middle disc.
    for (let i = 0; i <= 48; i++) {
      const [x, y] = pt(outer, (i / 48) * Math.PI * 2);
      if (i === 0) s.moveTo(x, y);
      else s.lineTo(x, y);
    }
    return slab(s, h, 0.002);
  }
  for (let i = 0; i <= steps; i++) {
    const a = a0 + da0(outer) + ((a1 - a0 - 2 * da0(outer)) * i) / steps;
    const [x, y] = pt(outer, a);
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + da0(inner) + ((a1 - a0 - 2 * da0(inner)) * i) / steps;
    const [x, y] = pt(inner, a);
    s.lineTo(x, y);
  }
  return slab(s, h, 0.002);
}

/** The home plot: origin at the centre of the top face. */
export function createHomePlot(): Object3D {
  const root = new Object3D();
  root.name = 'kit:home';
  zone(root, 'sky-bench');
  const tones = COLOR.ground.home.map((h) => new Color(h));
  const pieces = [];
  let k = 0;
  for (const ring of RINGS) {
    for (let i = 0; i < ring.tiles; i++) {
      const a0 = (i / ring.tiles) * Math.PI * 2 + (ring.from > 0.5 ? 0.09 : 0);
      const a1 = ((i + 1) / ring.tiles) * Math.PI * 2 + (ring.from > 0.5 ? 0.09 : 0);
      const g = annular(ring.from, ring.to, a0, a1, TILE);
      g.translate(0, -TILE, 0);
      tint(g, tones[rand(7, k++) < 0.5 ? 0 : 1]);
      pieces.push(g);
    }
  }
  const r = LAYOUT.homePlot.w / 2;
  const cut = cylinder(r, r, MATERIAL.plot.cut - TILE, 64, true);
  cut.translate(0, -MATERIAL.plot.cut, 0);
  tint(cut, COLOR.ground.cut);
  const keelR = r - MATERIAL.plot.keelInset;
  const keel = cylinder(keelR, keelR - 0.02, MATERIAL.plot.keel, 64, false);
  keel.translate(0, -MATERIAL.plot.cut - MATERIAL.plot.keel, 0);
  tint(keel, COLOR.ground.keel);
  const under = cylinder(r - 0.001, r - 0.001, 0.001, 64);
  under.translate(0, -MATERIAL.plot.cut, 0);
  tint(under, COLOR.ground.keel);
  pieces.push(prep(cut), keel, under);
  const mesh = part(merge(pieces), 'vcMatte', 'home:tiles');
  root.add(mesh);
  return root;
}
