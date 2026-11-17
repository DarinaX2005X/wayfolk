/**
 * Twelve house recipes, one per trade. A recipe lays out modular pieces in the house's own
 * frame (origin on the ground at the centre, front and door toward +z), in assembly order:
 * foundation, walls, roof, details, props. Colours come from HouseSpec.colors; stone, wood,
 * glass and brass are shared. Every recipe has its own silhouette so a house reads from
 * across the island: the baker's chimney and oven, the stargazer's dome, the fisher's stilts…
 */
import { CylinderGeometry, type BufferGeometry } from '@iwsdk/core';
import type { HouseSpec, Trade } from '../mind/types';
import { CATALOG } from './catalog';
import { M, MAT, autoSurface, ball, build, cbox, cone, cyl, dome, gear, hull, lathe, mixHex, place, rng, tone, type Hex, type PaintOpts } from './geo';
import { kitGeometry } from './kit';
import { buildProp } from './props';

export type Stage = 'foundation' | 'walls' | 'roof' | 'details' | 'props';
export const STAGES: Stage[] = ['foundation', 'walls', 'roof', 'details', 'props'];

export interface Piece {
  name: string;
  stage: Stage;
  /** Geometry around the piece's own pivot (centre of its box). */
  geo: BufferGeometry;
  /** Pivot in the house frame. */
  pos: [number, number, number];
}

export interface SignSpot {
  pos: [number, number, number];
  rotY: number;
  w: number;
  h: number;
}

export interface HousePlan {
  pieces: Piece[];
  /** Radius kept free on the ground. */
  radius: number;
  height: number;
  /** Door, in the house frame (ground level, just outside). */
  door: [number, number, number];
  /** A window someone can lean in to look through. */
  window: [number, number, number];
  sign: SignSpot;
  /** Top of the chimney or the highest point, for smoke or a bird to perch. */
  top: [number, number, number];
  /** True when `top` is a chimney or pipe that smokes. */
  smoke?: boolean;
}

type Part = [BufferGeometry, Hex, PaintOpts?];
const GLOW: PaintOpts = { glow: true, shade: 0, wobble: 0 };

/** Centred bevelled box. */
function B(w: number, h: number, d: number, x = 0, y = 0, z = 0, rot: [number, number, number] = [0, 0, 0], bevel = 0.03): BufferGeometry {
  const g = cbox(w, h, d, bevel);
  g.translate(0, -h / 2, 0);
  return place(g, [x, y, z], rot);
}

class HouseBuilder {
  pieces: Piece[] = [];
  r: () => number;
  constructor(public spec: HouseSpec) {
    this.r = rng(spec.id + spec.recipe);
  }
  /** Walls are plaster, roofs tiles (thatch on straw), trim timber; shared colours map themselves. */
  surface(c: Hex): number {
    if (c === this.spec.colors.roof) return M.tile;
    if (c === this.spec.colors.wall) return M.plaster;
    if (c === this.spec.colors.trim) return M.plank;
    const auto = autoSurface(c);
    if (auto !== M.plain) return auto;
    return M.plaster;
  }
  get wall(): Hex { return this.spec.colors.wall; }
  get roof(): Hex { return this.spec.colors.roof; }
  get trim(): Hex { return this.spec.colors.trim; }

  add(stage: Stage, name: string, parts: Part[]): void {
    if (!parts.length) return;
    const geo = build(parts.map(([g, c, o]): Part => [g, c, { mat: this.surface(c), ...(o ?? {}) }]));
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    const cx = (bb.min.x + bb.max.x) / 2;
    const cy = (bb.min.y + bb.max.y) / 2;
    const cz = (bb.min.z + bb.max.z) / 2;
    geo.translate(-cx, -cy, -cz);
    geo.computeBoundingSphere();
    this.pieces.push({ name, stage, geo, pos: [cx, cy, cz] });
  }

  /** A catalog prop (kit or code) at x, z on the ground, turned by rotY. */
  prop(id: string, x: number, z: number, rotY = 0, y = 0, scaleK = 1): void {
    const item = CATALOG[id];
    if (!item) return;
    let g: BufferGeometry | null;
    if ('kit' in item.source) g = kitGeometry(item.source.kit, item.scale * scaleK);
    else {
      g = buildProp(item.source.proc, Math.floor(this.r() * 1000));
      if (g && scaleK !== 1) g.scale(scaleK, scaleK, scaleK);
    }
    if (!g) return;
    place(g, [x, y, z], [0, rotY, 0]);
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const c: [number, number, number] = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2];
    g.translate(-c[0], -c[1], -c[2]);
    g.computeBoundingSphere();
    this.pieces.push({ name: `prop:${id}`, stage: 'props', geo: g, pos: c });
  }
}

// ---------- shared parts ----------

function foundation(w: number, d: number, h = 0.32, color: Hex = MAT.stone): Part[] {
  const parts: Part[] = [[B(w, h, d, 0, h / 2 - 0.12, 0, [0, 0, 0], 0.06), color]];
  // a few cobbles along the base so it reads as stone, not a slab
  const r = rng(Math.round(w * 100 + d * 10));
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1;
    const x = (r() - 0.5) * (w - 0.4);
    parts.push([B(0.28 + r() * 0.15, 0.12, 0.08, x, h - 0.2 + r() * 0.06, side * (d / 2 + 0.01)), tone(color, 0.86 + r() * 0.1)]);
  }
  return parts;
}

function walls(w: number, d: number, h: number, color: Hex, y0 = 0.2): Part[] {
  return [[B(w, h, d, 0, y0 + h / 2, 0, [0, 0, 0], 0.05), color, { shade: 0.22 }]];
}

function beams(w: number, d: number, h: number, color: Hex, y0 = 0.2, mid = true): Part[] {
  const t = 0.11;
  const parts: Part[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push([B(t, h, t, sx * (w / 2), y0 + h / 2, sz * (d / 2)), color]);
  for (const sz of [-1, 1]) parts.push([B(w + 0.06, t, t, 0, y0 + h - t / 2, sz * (d / 2 + 0.01)), color]);
  for (const sx of [-1, 1]) parts.push([B(t, t, d + 0.06, sx * (w / 2 + 0.01), y0 + h - t / 2, 0), color]);
  if (mid) {
    parts.push([B(w + 0.04, t * 0.8, t * 0.8, 0, y0 + 0.08, d / 2 + 0.02), color]);
    parts.push([B(t * 0.8, h * 0.95, t * 0.8, -w / 4 - 0.15, y0 + h / 2, d / 2 + 0.02, [0, 0, 0.0]), color]);
  }
  return parts;
}

/** Triangular gable ends between the walls and a pitched roof. */
function gableFill(w: number, d: number, h: number, rise: number, color: Hex): Part[] {
  return [[hull([
    [-w / 2, h, -d / 2], [-w / 2, h, d / 2], [-w / 2, h + rise, 0],
    [w / 2, h, -d / 2], [w / 2, h, d / 2], [w / 2, h + rise, 0],
  ]), color, { shade: 0.1 }]];
}

/** One slab of a pitched roof (ridge along x), with shingle rows. side +1 front, −1 back. */
function roofSlab(w: number, d: number, h: number, rise: number, over: number, side: 1 | -1, color: Hex, t = 0.13): Part[] {
  const half = d / 2;
  const len = Math.hypot(half, rise);
  const ux = half / len;
  const uy = -rise / len; // down the slope toward the eave
  const ex = ux * (len + over);
  const ey = uy * (len + over);
  const nx = rise / len;
  const ny = half / len;
  const W = w / 2 + over * 0.8;
  const ridgeY = h + rise + 0.04;
  const pts: [number, number, number][] = [];
  for (const sx of [-1, 1]) {
    pts.push([sx * W, ridgeY, 0]);
    pts.push([sx * W, ridgeY + ey, side * ex]);
    pts.push([sx * W, ridgeY + ny * t, side * nx * t]);
    pts.push([sx * W, ridgeY + ey + ny * t, side * (ex + nx * t)]);
  }
  const parts: Part[] = [[hull(pts), color, { shade: 0.12 }]];
  const dark = tone(color, 0.82);
  for (const f of [0.3, 0.55, 0.8]) {
    const y = ridgeY + ey * f + ny * t * 0.95;
    const z = side * (ex * f + nx * t * 0.6);
    parts.push([B(W * 2 - 0.04, 0.035, 0.07, 0, y, z, [side * Math.atan2(rise, half), 0, 0], 0.01), dark]);
  }
  return parts;
}

function pitchedRoof(hb: HouseBuilder, w: number, d: number, h: number, rise: number, over = 0.3, color = hb.roof): void {
  hb.add('roof', 'roof-front', roofSlab(w, d, h, rise, over, 1, color));
  hb.add('roof', 'roof-back', roofSlab(w, d, h, rise, over, -1, color));
  hb.add('roof', 'ridge', [[B(w + over * 1.8, 0.14, 0.2, 0, h + rise + 0.14, 0, [0, 0, 0], 0.04), tone(color, 0.75)]]);
}

/** Window facing +z centred on the origin; placed by the caller. */
function windowParts(w: number, h: number, trim: Hex, shutter: Hex | null, flowers = false, cross = true): Part[] {
  const t = 0.07;
  const parts: Part[] = [
    [B(w, h, 0.04, 0, 0, -0.01), MAT.glass, GLOW],
    [B(w + t * 2, t, 0.09, 0, h / 2 + t / 2, 0), trim],
    [B(w + t * 2, t, 0.09, 0, -h / 2 - t / 2, 0), trim],
    [B(t, h, 0.09, -w / 2 - t / 2, 0, 0), trim],
    [B(t, h, 0.09, w / 2 + t / 2, 0, 0), trim],
    [B(w + 0.26, 0.06, 0.16, 0, -h / 2 - t - 0.02, 0.05), trim],
  ];
  if (cross) {
    parts.push([B(0.035, h, 0.05, 0, 0, 0.01), trim]);
    parts.push([B(w, 0.035, 0.05, 0, 0, 0.01), trim]);
  }
  if (shutter) {
    for (const s of [-1, 1]) parts.push([B(w * 0.48, h + 0.06, 0.04, s * (w / 2 + t + w * 0.24 + 0.01), 0, 0.0), shutter]);
  }
  if (flowers) {
    parts.push([B(w + 0.1, 0.13, 0.16, 0, -h / 2 - 0.17, 0.08), MAT.woodDark]);
    const cols = ['#f06a6a', '#f7d046', '#f4f0e8', '#e86a9a'];
    for (let i = 0; i < 4; i++) parts.push([place(ball(0.07, 6, 4), [-w / 2 + 0.08 + (i * (w - 0.16)) / 3, -h / 2 - 0.08, 0.1]), i % 2 ? MAT.leaf : cols[i % cols.length], { shade: 0 }]);
  }
  return parts;
}

function roundWindowParts(r: number, trim: Hex): Part[] {
  return [
    [place(cyl(r, r, 0.04, 10), [0, 0, -0.01], [Math.PI / 2, 0, 0]), MAT.glass, GLOW],
    [place(lathe([[r, -0.05], [r + 0.08, -0.05], [r + 0.08, 0.05], [r, 0.05]], 10), [0, 0, 0], [Math.PI / 2, 0, 0]), trim],
    [B(0.035, r * 2, 0.04, 0, 0, 0.01), trim],
  ];
}

function doorParts(w: number, h: number, wood: Hex, trim: Hex, arch = true): Part[] {
  const t = 0.08;
  const parts: Part[] = [
    [B(w, h, 0.06, 0, h / 2, 0), wood, { shade: 0.15 }],
    [B(0.03, h - 0.1, 0.07, -w / 4, h / 2, 0.005), tone(wood, 0.8)],
    [B(0.03, h - 0.1, 0.07, w / 4, h / 2, 0.005), tone(wood, 0.8)],
    [B(t, h + 0.05, 0.1, -w / 2 - t / 2, (h + 0.05) / 2, 0), trim],
    [B(t, h + 0.05, 0.1, w / 2 + t / 2, (h + 0.05) / 2, 0), trim],
    [place(ball(0.04, 6, 4), [w / 2 - 0.1, h * 0.48, 0.05]), MAT.brass, { shade: 0 }],
    [B(w + 0.45, 0.1, 0.42, 0, 0.05, 0.22), MAT.stone],
  ];
  if (arch) {
    // half-round top: a trim arch with the door's wood inside it
    const half = (r: number, d: number): BufferGeometry => new CylinderGeometry(r, r, d, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).rotateZ(0);
    parts.push([place(half(w / 2 + t, 0.1), [0, h, -0.005]), trim]);
    parts.push([place(half(w / 2, 0.08), [0, h, 0.012]), wood, { shade: 0 }]);
  }
  else parts.push([B(w + t * 2, t, 0.1, 0, h + t / 2, 0), trim]);
  return parts;
}

function chimneyParts(x: number, z: number, y0: number, h: number, color: Hex = MAT.stone): Part[] {
  return [
    [B(0.44, h, 0.44, x, y0 + h / 2, z, [0, 0, 0], 0.04), color],
    [B(0.56, 0.12, 0.56, x, y0 + h + 0.06, z, [0, 0, 0], 0.03), tone(color, 0.8)],
    [B(0.3, 0.06, 0.3, x, y0 + h + 0.15, z), '#3a2f2a', { shade: 0 }],
  ];
}

function signBoard(x: number, y: number, z: number, rotY: number, w = 1.0, h = 0.34, hanging = true): Part[] {
  const parts: Part[] = [[place(B(w, h, 0.06, 0, 0, 0), [x, y, z], [0, rotY, 0]), MAT.woodLight]];
  if (hanging) {
    parts.push([place(B(w * 0.9, 0.05, 0.05, 0, h / 2 + 0.16, -0.0), [x, y, z], [0, rotY, 0]), MAT.iron]);
    for (const s of [-1, 1]) parts.push([place(B(0.02, 0.16, 0.02, s * w * 0.35, h / 2 + 0.08, 0), [x, y, z], [0, rotY, 0]), MAT.iron]);
  }
  return parts;
}

/** A small lantern on an iron bracket, facing +z; glows at night. */
function wallLamp(): Part[] {
  return [
    [B(0.05, 0.05, 0.22, 0, 0.12, 0.11), MAT.iron],
    [B(0.04, 0.2, 0.04, 0, 0.02, 0.02), MAT.iron],
    [B(0.15, 0.03, 0.15, 0, 0.13, 0.22), MAT.iron],
    [B(0.11, 0.15, 0.11, 0, 0.04, 0.22), '#ffd27a', GLOW],
    [place(cone(0.11, 0.08, 4), [0, 0.12, 0.22], [0, Math.PI / 4, 0]), MAT.iron],
  ];
}

const at = (parts: Part[], pos: [number, number, number], rotY = 0): Part[] =>
  parts.map(([g, c, o]) => [place(g, pos, [0, rotY, 0]), c, o]);

// ---------- recipes ----------

type RecipeFn = (hb: HouseBuilder) => Omit<HousePlan, 'pieces'>;

const RECIPES: Record<Trade, RecipeFn> = {
  baker(hb) {
    const w = 3.0, d = 2.6, h = 1.9, y0 = 0.2, rise = 1.35;
    hb.add('foundation', 'base', foundation(w + 0.3, d + 0.3));
    hb.add('walls', 'walls', walls(w, d, h, hb.wall, y0));
    hb.add('walls', 'beams', beams(w, d, h, hb.trim, y0));
    hb.add('walls', 'gables', gableFill(w, d, y0 + h, rise, hb.wall));
    hb.add('walls', 'oven', at([
      [B(1.1, 0.5, 1.2, 0, 0.25, 0, [0, 0, 0], 0.05), MAT.stone],
      [place(dome(0.62, 10, 4), [0, 0.5, 0], [0, 0, 0], [0.9, 0.85, 0.95]), MAT.terracotta],
      [B(0.34, 0.26, 0.1, 0, 0.66, 0.56), '#ff9a3d', GLOW],
    ], [w / 2 + 0.55, 0, 0.1], Math.PI / 2));
    pitchedRoof(hb, w, d, y0 + h, rise, 0.32);
    hb.add('details', 'chimney', chimneyParts(0.85, -0.55, y0 + h, 2.2, MAT.stoneDark));
    hb.add('details', 'door', at(doorParts(0.78, 1.3, MAT.woodDark, hb.trim), [0, y0, d / 2 + 0.03]));
    hb.add('details', 'window-left', at(windowParts(0.6, 0.55, hb.trim, hb.roof, true), [-0.95, y0 + 1.15, d / 2 + 0.04]));
    hb.add('details', 'window-right', at(windowParts(0.6, 0.55, hb.trim, hb.roof, true), [0.95, y0 + 1.15, d / 2 + 0.04]));
    hb.add('details', 'window-side', at(windowParts(0.55, 0.5, hb.trim, null), [-w / 2 - 0.04, y0 + 1.15, 0], -Math.PI / 2));
    hb.add('details', 'awning', [[B(1.2, 0.06, 0.55, 0.95, y0 + 1.62, d / 2 + 0.28, [0.35, 0, 0]), mixHex(hb.roof, MAT.cream, 0.35)]]);
    hb.add('details', 'sign', signBoard(-1.25, y0 + 1.95, d / 2 + 0.45, 0, 0.9, 0.3));
    hb.add('details', 'window-back-l', at(windowParts(0.55, 0.5, hb.trim, hb.roof), [-0.8, y0 + 1.15, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'window-back-r', at(windowParts(0.55, 0.5, hb.trim, hb.roof, true), [0.8, y0 + 1.15, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'lamp', at(wallLamp(), [0.62, y0 + 1.35, d / 2 + 0.02]));
    hb.prop('crate-buns', 1.75, 1.75, 0.3);
    hb.prop('sack', -1.9, 1.5, 0.8);
    hb.prop('barrel', 1.9, -1.1);
    return { radius: 2.4, height: 4.3, door: [0, 0, d / 2 + 0.6], window: [0.95, y0 + 1.15, d / 2 + 0.1], sign: { pos: [-1.25, y0 + 1.95, d / 2 + 0.49], rotY: 0, w: 0.9, h: 0.3 }, top: [0.85, y0 + h + 2.4, -0.55], smoke: true };
  },

  stargazer(hb) {
    const r = 1.35, h = 2.3, y0 = 0.25;
    hb.add('foundation', 'base', [[cyl(r + 0.25, r + 0.35, 0.4, 12), MAT.stone], [B(1.3, 0.12, 0.6, 0, 0.06, r + 0.35), MAT.stoneDark]]);
    hb.add('walls', 'tower', [[place(cyl(r - 0.05, r, h, 12), [0, y0, 0]), hb.wall, { shade: 0.25 }]]);
    hb.add('walls', 'band', [[place(cyl(r + 0.08, r + 0.08, 0.16, 12), [0, y0 + h - 0.12, 0]), hb.trim], [place(cyl(r + 0.06, r + 0.06, 0.1, 12), [0, y0 + 0.9, 0]), hb.trim]]);
    hb.add('roof', 'dome', [[place(dome(r + 0.12, 14, 6), [0, y0 + h + 0.02, 0]), hb.roof, { shade: 0.3 }]]);
    hb.add('roof', 'slit', [[place(B(0.36, 1.25, 0.12, 0, 0, 0, [0, 0, 0], 0.02), [0, y0 + h + 0.72, 0.85], [-0.75, 0, 0]), '#ffd27a', GLOW]]);
    hb.add('details', 'scope', [
      [place(cyl(0.16, 0.22, 1.5, 10), [0, y0 + h + 0.5, 0.35], [-0.95, 0, 0]), MAT.brass, { shade: 0.1 }],
      [place(cyl(0.24, 0.24, 0.14, 10), [0, y0 + h + 1.35, 1.0], [-0.95, 0, 0]), tone(MAT.brass, 0.7)],
    ]);
    hb.add('details', 'door', at(doorParts(0.72, 1.25, hb.roof, hb.trim), [0, y0, r - 0.02]));
    hb.add('details', 'porthole-l', at(roundWindowParts(0.24, hb.trim), [-0.9, y0 + 1.5, 0.95], -0.75));
    hb.add('details', 'porthole-r', at(roundWindowParts(0.24, hb.trim), [0.9, y0 + 1.5, 0.95], 0.75));
    const stars: Part[] = [];
    const rr = rng(hb.spec.id);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rr();
      const e = 0.35 + rr() * 0.5;
      stars.push([place(B(0.09, 0.09, 0.03, 0, 0, 0, [0, 0, 0.78]), [Math.cos(a) * (r + 0.14) * Math.cos(e), y0 + h + (r + 0.1) * Math.sin(e), Math.sin(a) * (r + 0.14) * Math.cos(e)], [0, -a + Math.PI / 2, 0]), '#ffe08a', GLOW]);
    }
    hb.add('details', 'stars', stars);
    hb.add('details', 'sign', signBoard(1.25, y0 + 0.75, r + 0.5, -0.3, 0.8, 0.28, false).concat([[B(0.06, 0.8, 0.06, 1.25, 0.4, r + 0.45), MAT.woodDark]]));
    hb.add('details', 'porthole-back', at(roundWindowParts(0.24, hb.trim), [0, y0 + 1.5, -r - 0.02], Math.PI));
    hb.add('details', 'porthole-side', at(roundWindowParts(0.22, hb.trim), [-r - 0.02, y0 + 1.1, 0], -Math.PI / 2));
    hb.add('details', 'lamp', at(wallLamp(), [0.62, y0 + 1.2, r - 0.08], 0.3));
    hb.prop('star-lamp', -1.7, 1.2, 0.4);
    hb.prop('globe', 1.9, -0.6, 0);
    hb.prop('telescope', -1.9, -0.7, 1.2);
    return { radius: 2.2, height: 4.2, door: [0, 0, r + 0.6], window: [-0.9, y0 + 1.5, 1.0], sign: { pos: [1.25, y0 + 0.75, r + 0.54], rotY: -0.3, w: 0.8, h: 0.28 }, top: [0, y0 + h + r + 0.15, 0] };
  },

  fisher(hb) {
    const w = 2.4, d = 2.0, h = 1.55, deckY = 0.95, rise = 0.85;
    const posts: Part[] = [];
    for (const x of [-1.45, 0, 1.45]) for (const z of [-1.25, 1.25]) posts.push([B(0.16, deckY + 0.3, 0.16, x, (deckY + 0.3) / 2 - 0.3, z), MAT.woodDark]);
    hb.add('foundation', 'stilts', posts);
    const deck: Part[] = [];
    for (let i = 0; i < 9; i++) deck.push([B(0.33, 0.08, 2.9, -1.6 + 0.2 + i * 0.35, deckY, 0), i % 2 ? MAT.plank : MAT.woodLight]);
    hb.add('foundation', 'deck', deck);
    hb.add('walls', 'hut', walls(w, d, h, hb.wall, deckY + 0.04).concat([[B(w + 0.06, 0.1, d + 0.06, 0, deckY + 0.1, 0), hb.trim]]));
    hb.add('walls', 'planks', [0, 1, 2, 3, 4].map((i): Part => [B(w + 0.02, 0.025, 0.03, 0, deckY + 0.35 + i * 0.27, d / 2 + 0.01), tone(hb.wall, 0.85)]));
    hb.add('walls', 'gables', gableFill(w, d, deckY + 0.04 + h, rise, hb.wall));
    pitchedRoof(hb, w, d, deckY + 0.04 + h, rise, 0.38);
    hb.add('details', 'door', at(doorParts(0.7, 1.2, MAT.woodDark, hb.trim, false), [0.45, deckY + 0.04, d / 2 + 0.03]));
    hb.add('details', 'window', at(windowParts(0.5, 0.45, hb.trim, null), [-0.6, deckY + 0.95, d / 2 + 0.04]));
    hb.add('details', 'porthole', at(roundWindowParts(0.2, hb.trim), [w / 2 + 0.04, deckY + 1.0, 0], Math.PI / 2));
    const rail: Part[] = [];
    for (const x of [-1.55, -0.6, 1.55]) rail.push([B(0.08, 0.55, 0.08, x, deckY + 0.3, 1.4), MAT.woodDark]);
    rail.push([place(cyl(0.025, 0.025, 1.0, 5), [-1.08, deckY + 0.5, 1.4], [0, 0, Math.PI / 2]), MAT.rope]);
    hb.add('details', 'rail', rail);
    const steps: Part[] = [];
    for (let i = 0; i < 4; i++) steps.push([B(0.75, 0.07, 0.3, 0.45, 0.2 + i * 0.24, 2.4 - i * 0.26), MAT.plank]);
    steps.push([B(0.07, 1.2, 0.07, 0.07, 0.5, 1.95, [0.8, 0, 0]), MAT.woodDark]);
    steps.push([B(0.07, 1.2, 0.07, 0.83, 0.5, 1.95, [0.8, 0, 0]), MAT.woodDark]);
    hb.add('details', 'steps', steps);
    hb.add('details', 'flag', [[B(0.05, 0.9, 0.05, -1.05, deckY + h + 0.5, -0.5), MAT.woodDark], [B(0.03, 0.3, 0.42, -1.05, deckY + h + 0.82, -0.29), MAT.sea]]);
    hb.add('details', 'sign', signBoard(-0.6, deckY + 1.55, d / 2 + 0.1, 0, 0.9, 0.24, false));
    hb.add('details', 'window-back', at(windowParts(0.5, 0.45, hb.trim, hb.roof), [0, deckY + 0.95, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'lamp', at(wallLamp(), [0.95, deckY + 1.25, d / 2 + 0.02]));
    hb.prop('net', -2.2, 0.3, Math.PI / 2);
    hb.prop('fishing-rod', 1.6, 1.4, -0.4, deckY + 0.04);
    hb.prop('barrel', -1.2, 1.15, 0, deckY + 0.04);
    hb.prop('bucket-water', 1.9, 2.0);
    return { radius: 2.4, height: 4.0, door: [0.45, 0, 2.9], window: [-0.6, deckY + 0.95, d / 2 + 0.1], sign: { pos: [-0.6, deckY + 1.55, d / 2 + 0.14], rotY: 0, w: 0.9, h: 0.24 }, top: [0, deckY + h + rise + 0.3, 0] };
  },

  gardener(hb) {
    const w = 3.0, d = 2.2, h = 1.6, y0 = 0.32, rise = 0.9;
    hb.add('foundation', 'base', foundation(w + 0.2, d + 0.2, 0.44, mixHex(hb.trim, MAT.terracotta, 0.5)));
    const frame = '#f2efe6';
    const glass: Part[] = [];
    glass.push([B(w, h, d, 0, y0 + h / 2, 0, [0, 0, 0], 0.02), MAT.glassLight, { glow: true, shade: 0.1, wobble: 0 }]);
    hb.add('walls', 'glass', glass);
    const bars: Part[] = [];
    for (let i = 0; i <= 5; i++) {
      const x = -w / 2 + (i * w) / 5;
      bars.push([B(0.07, h + 0.02, 0.07, x, y0 + h / 2, d / 2 + 0.02), frame], [B(0.07, h + 0.02, 0.07, x, y0 + h / 2, -d / 2 - 0.02), frame]);
    }
    for (let i = 0; i <= 3; i++) {
      const z = -d / 2 + (i * d) / 3;
      bars.push([B(0.07, h + 0.02, 0.07, w / 2 + 0.02, y0 + h / 2, z), frame], [B(0.07, h + 0.02, 0.07, -w / 2 - 0.02, y0 + h / 2, z), frame]);
    }
    bars.push([B(w + 0.1, 0.07, d + 0.1, 0, y0 + h, 0), frame], [B(w + 0.1, 0.06, 0.07, 0, y0 + h * 0.5, d / 2 + 0.03), frame]);
    hb.add('walls', 'frame', bars);
    hb.add('walls', 'gables', [[hull([
      [-w / 2, y0 + h, -d / 2], [-w / 2, y0 + h, d / 2], [-w / 2, y0 + h + rise, 0],
      [w / 2, y0 + h, -d / 2], [w / 2, y0 + h, d / 2], [w / 2, y0 + h + rise, 0],
    ]), MAT.glassLight, { glow: true, shade: 0.1, wobble: 0 }]]);
    const roofBars: Part[] = [];
    const ang = Math.atan2(rise, d / 2);
    const len = Math.hypot(rise, d / 2) + 0.1;
    for (let i = 0; i <= 5; i++) {
      const x = -w / 2 + (i * w) / 5;
      for (const s of [-1, 1]) roofBars.push([B(0.07, 0.07, len, x, y0 + h + rise / 2 + 0.04, (s * d) / 4, [s * ang, 0, 0]), frame]);
    }
    roofBars.push([B(w + 0.2, 0.12, 0.14, 0, y0 + h + rise + 0.05, 0), hb.roof]);
    hb.add('roof', 'roof-frame', roofBars);
    // little brick potting shed on the side, in the house colours
    hb.add('walls', 'shed', [[B(1.2, 1.5, 1.6, -w / 2 - 0.62, 0.75 + 0.05, -0.1, [0, 0, 0], 0.04), hb.wall, { shade: 0.2 }]]);
    hb.add('roof', 'shed-roof', [[B(1.5, 0.12, 1.9, -w / 2 - 0.62, 1.7, -0.1, [0, 0, 0.32]), hb.roof]]);
    hb.add('details', 'door', at(doorParts(0.75, 1.3, frame, hb.trim, false), [0.6, y0, d / 2 + 0.05]));
    hb.add('details', 'shed-door', at(doorParts(0.55, 1.05, MAT.woodDark, hb.trim, false), [-w / 2 - 0.62, 0.02, 0.72]));
    const plants: Part[] = [];
    for (let i = 0; i < 4; i++) plants.push([place(cbox(0.5, 0.25, 0.3, 0.03), [-1.1 + i * 0.6, y0 + h + 0.0, 0.0]), MAT.terracotta]);
    hb.add('details', 'sign', signBoard(-0.6, y0 + 1.25, d / 2 + 0.12, 0, 0.9, 0.28, false));
    hb.add('details', 'lamp', at(wallLamp(), [-w / 2 - 0.62 + 0.45, 1.15, 0.72]));
    hb.prop('flower-bed', -0.6, 1.9, 0);
    hb.prop('sunflower', 2.0, 0.2, -0.6);
    hb.prop('wheelbarrow', 2.1, 1.5, -0.9);
    hb.prop('flower-pot', 1.25, 1.75, 0);
    hb.prop('crate-tomatoes', -2.6, 1.1, 0.2);
    return { radius: 2.5, height: 3.0, door: [0.6, 0, d / 2 + 0.7], window: [0, y0 + 1.0, d / 2 + 0.1], sign: { pos: [-0.6, y0 + 1.25, d / 2 + 0.16], rotY: 0, w: 0.9, h: 0.28 }, top: [0, y0 + h + rise + 0.2, 0] };
  },

  tinkerer(hb) {
    const w = 3.2, d = 2.6, hf = 2.3, hb2 = 1.6, y0 = 0.2;
    hb.add('foundation', 'base', foundation(w + 0.3, d + 0.3));
    // walls with a mono-pitch top: tall at the front, low at the back
    hb.add('walls', 'walls', [[hull([
      [-w / 2, y0, -d / 2], [w / 2, y0, -d / 2], [-w / 2, y0, d / 2], [w / 2, y0, d / 2],
      [-w / 2, y0 + hb2, -d / 2], [w / 2, y0 + hb2, -d / 2], [-w / 2, y0 + hf, d / 2], [w / 2, y0 + hf, d / 2],
    ]), hb.wall, { shade: 0.22 }]]);
    hb.add('walls', 'beams', [
      ...[-1, 1].flatMap((sx): Part[] => [[B(0.12, hf, 0.12, sx * w / 2, y0 + hf / 2, d / 2), hb.trim], [B(0.12, hb2, 0.12, sx * w / 2, y0 + hb2 / 2, -d / 2), hb.trim]]),
      [B(w + 0.06, 0.12, 0.12, 0, y0 + hf - 0.06, d / 2 + 0.01), hb.trim],
    ]);
    const a = Math.atan2(hf - hb2, d);
    hb.add('roof', 'roof', [
      [B(w + 0.6, 0.14, Math.hypot(d, hf - hb2) + 0.7, 0, y0 + (hf + hb2) / 2 + 0.1, 0, [-a, 0, 0]), hb.roof],
      [B(w + 0.66, 0.06, 0.12, 0, y0 + hf + 0.25, d / 2 + 0.33, [-a, 0, 0]), tone(hb.roof, 0.75)],
    ]);
    hb.add('details', 'pipe', [
      [place(cyl(0.13, 0.13, 1.5, 8), [1.0, y0 + hf - 0.3, -0.5]), MAT.iron],
      [place(cyl(0.2, 0.16, 0.18, 8), [1.0, y0 + hf + 1.2, -0.5]), tone(MAT.iron, 0.8)],
      [place(cyl(0.16, 0.16, 0.1, 8), [1.0, y0 + hf + 0.4, -0.5]), MAT.brass],
    ]);
    hb.add('details', 'big-gear', gear(0.62, 0.12, 10).map((g): Part => [place(g, [-0.95, y0 + 1.35, d / 2 + 0.1]), MAT.brass, { shade: 0.15 }]));
    hb.add('details', 'roof-gear', gear(0.42, 0.1, 8).map((g): Part => [place(g, [-0.6, y0 + hf + 0.65, 0.3], [0, 0.4, 0]), tone(MAT.brass, 0.85), { shade: 0.15 }]).concat([[B(0.12, 0.5, 0.12, -0.6, y0 + hf + 0.2, 0.3), MAT.iron]]));
    const door: Part[] = [[B(1.3, 1.45, 0.06, 0, 0.72, 0), MAT.woodDark, { shade: 0.15 }]];
    door.push([B(1.4, 0.1, 0.09, 0, 1.47, 0.01), hb.trim], [B(0.08, 1.5, 0.09, -0.68, 0.75, 0.01), hb.trim], [B(0.08, 1.5, 0.09, 0.68, 0.75, 0.01), hb.trim]);
    door.push([B(0.08, 1.75, 0.04, 0, 0.72, 0.04, [0, 0, 0.72]), tone(MAT.woodDark, 0.75)]);
    door.push([B(1.8, 0.1, 0.5, 0, 0.05, 0.25), MAT.stone]);
    hb.add('details', 'door', at(door, [0.65, y0, d / 2 + 0.03]));
    hb.add('details', 'window-side', at(windowParts(0.7, 0.55, hb.trim, null), [w / 2 + 0.04, y0 + 1.2, 0.1], Math.PI / 2));
    hb.add('details', 'window-top', at(roundWindowParts(0.22, hb.trim), [0.65, y0 + 1.92, d / 2 + 0.04]));
    hb.add('details', 'sign', signBoard(-0.95, y0 + 2.08, d / 2 + 0.1, 0, 1.0, 0.26, false));
    hb.add('details', 'window-back', at(windowParts(0.6, 0.5, hb.trim, null), [-0.6, y0 + 1.0, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'window-back-2', at(windowParts(0.6, 0.5, hb.trim, null), [0.7, y0 + 1.0, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'window-left', at(windowParts(0.6, 0.5, hb.trim, null), [-w / 2 - 0.04, y0 + 1.1, 0], -Math.PI / 2));
    hb.add('details', 'lamp', at(wallLamp(), [-0.1, y0 + 1.55, d / 2 + 0.02]));
    hb.prop('crate-big', 2.0, 1.4, 0.3);
    hb.prop('crate-small', 2.05, 1.4, 0.8, 0.75);
    hb.prop('lumber', -2.1, 0.3, Math.PI / 2);
    hb.prop('anvil', -1.4, 1.9, 0.5);
    return { radius: 2.5, height: 4.2, door: [0.65, 0, d / 2 + 0.7], window: [w / 2 + 0.1, y0 + 1.2, 0.1], sign: { pos: [-0.95, y0 + 2.08, d / 2 + 0.14], rotY: 0, w: 1.0, h: 0.26 }, top: [1.0, y0 + hf + 1.35, -0.5], smoke: true };
  },

  storyteller(hb) {
    const w = 2.4, d = 2.2, h1 = 1.55, h2 = 1.35, y0 = 0.2, rise = 1.55;
    const W2 = w + 0.36, D2 = d + 0.3;
    hb.add('foundation', 'base', foundation(w + 0.3, d + 0.3));
    hb.add('walls', 'ground-floor', walls(w, d, h1, hb.wall, y0));
    hb.add('walls', 'upper-floor', walls(W2, D2, h2, mixHex(hb.wall, MAT.cream, 0.25), y0 + h1));
    hb.add('walls', 'beams', beams(W2, D2, h2, hb.trim, y0 + h1, false).concat([
      [B(W2 + 0.04, 0.12, 0.12, 0, y0 + h1 + 0.04, D2 / 2 + 0.01), hb.trim],
      [B(0.1, h2, 0.1, 0, y0 + h1 + h2 / 2, D2 / 2 + 0.02), hb.trim],
      ...[-1, 1].map((s): Part => [B(0.09, 0.62, 0.09, s * 0.6, y0 + h1 + 0.65, D2 / 2 + 0.03, [0, 0, s * 0.75]), hb.trim]),
    ]));
    hb.add('walls', 'gables', gableFill(W2, D2, y0 + h1 + h2, rise, mixHex(hb.wall, MAT.cream, 0.25)));
    pitchedRoof(hb, W2, D2, y0 + h1 + h2, rise, 0.32);
    hb.add('details', 'chimney', chimneyParts(-0.7, -0.6, y0 + h1 + h2, 2.0));
    hb.add('details', 'door', at(doorParts(0.72, 1.25, hb.roof, hb.trim), [-0.45, y0, d / 2 + 0.03]));
    hb.add('details', 'bay-window', at(windowParts(0.55, 0.6, hb.trim, null, true), [0.65, y0 + 0.85, d / 2 + 0.04]));
    hb.add('details', 'upper-window-l', at(windowParts(0.5, 0.5, hb.trim, hb.roof), [-0.75, y0 + h1 + 0.72, D2 / 2 + 0.04]));
    hb.add('details', 'upper-window-r', at(windowParts(0.5, 0.5, hb.trim, hb.roof), [0.75, y0 + h1 + 0.72, D2 / 2 + 0.04]));
    hb.add('details', 'round-window', at(roundWindowParts(0.22, hb.trim), [0, y0 + h1 + h2 + 0.55, D2 / 2 + 0.04]));
    hb.add('details', 'sign', signBoard(0.75, y0 + h1 - 0.12, d / 2 + 0.55, 0, 0.9, 0.26));
    hb.add('details', 'window-back', at(windowParts(0.5, 0.5, hb.trim, hb.roof, true), [0.4, y0 + 0.85, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'upper-back', at(windowParts(0.5, 0.5, hb.trim, hb.roof), [0, y0 + h1 + 0.72, -D2 / 2 - 0.04], Math.PI));
    hb.add('details', 'upper-side', at(windowParts(0.45, 0.45, hb.trim, hb.roof), [W2 / 2 + 0.04, y0 + h1 + 0.72, 0], Math.PI / 2));
    hb.add('details', 'lamp', at(wallLamp(), [-0.98, y0 + 1.25, d / 2 + 0.02]));
    hb.prop('books', 1.5, 1.6, -0.3);
    hb.prop('armchair', -1.75, 1.55, 0.5);
    hb.prop('lamp-standing', -2.2, 0.6, 0);
    hb.prop('book', 1.2, 1.9, 0.9);
    return { radius: 2.3, height: 5.3, door: [-0.45, 0, d / 2 + 0.7], window: [0.65, y0 + 0.85, d / 2 + 0.1], sign: { pos: [0.75, y0 + h1 - 0.12, d / 2 + 0.59], rotY: 0, w: 0.9, h: 0.26 }, top: [-0.7, y0 + h1 + h2 + 2.2, -0.6], smoke: true };
  },

  'tea-maker'(hb) {
    const w = 2.8, d = 2.6, h = 1.55, y0 = 0.42;
    hb.add('foundation', 'platform', [[B(3.9, 0.42, 3.6, 0, 0.21 - 0.1, 0, [0, 0, 0], 0.06), MAT.stone], [B(1.3, 0.2, 0.5, 0, 0.0, 1.95), MAT.stoneDark]]);
    hb.add('walls', 'walls', walls(w, d, h, hb.wall, y0));
    hb.add('walls', 'posts', [-1, 1].flatMap((sx) => [-1, 1].map((sz): Part => [B(0.16, h + 0.1, 0.16, sx * (w / 2 + 0.35), y0 + (h + 0.1) / 2, sz * (d / 2 + 0.35)), hb.trim])).concat([[B(w + 0.86, 0.14, 0.14, 0, y0 + h + 0.03, d / 2 + 0.35), hb.trim]]));
    const wideRoof = (yb: number, wb: number, db: number, wt: number, dt: number, rise: number): BufferGeometry => hull([
      [-wb / 2, yb, -db / 2], [wb / 2, yb, -db / 2], [-wb / 2, yb, db / 2], [wb / 2, yb, db / 2],
      [-wb / 2 + 0.1, yb + 0.12, -db / 2 + 0.1], [wb / 2 - 0.1, yb + 0.12, -db / 2 + 0.1], [-wb / 2 + 0.1, yb + 0.12, db / 2 - 0.1], [wb / 2 - 0.1, yb + 0.12, db / 2 - 0.1],
      [-wt / 2, yb + rise, -dt / 2], [wt / 2, yb + rise, -dt / 2], [-wt / 2, yb + rise, dt / 2], [wt / 2, yb + rise, dt / 2],
    ]);
    const yr = y0 + h + 0.08;
    hb.add('roof', 'lower-roof', [[wideRoof(yr, 4.5, 4.2, 2.0, 1.8, 0.75), hb.roof, { shade: 0.15 }], [B(4.55, 0.08, 4.25, 0, yr + 0.02, 0), tone(hb.roof, 0.7)]]);
    hb.add('roof', 'upper-walls', [[B(1.8, 0.45, 1.6, 0, yr + 0.95, 0), hb.wall]]);
    hb.add('roof', 'upper-roof', [[wideRoof(yr + 1.15, 2.7, 2.5, 0.25, 0.25, 0.85), hb.roof, { shade: 0.15 }], [place(ball(0.12, 8, 6), [0, yr + 2.05, 0]), MAT.brass]]);
    const tips: Part[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) tips.push([place(cone(0.08, 0.3, 6), [sx * 2.2, yr + 0.05, sz * 2.05], [-sz * 0.6, 0, sx * 0.6]), tone(hb.roof, 0.7)]);
    hb.add('details', 'roof-tips', tips);
    hb.add('details', 'door', at([
      [B(1.0, 1.25, 0.05, 0, 0.62, 0), MAT.paper, GLOW],
      ...[-0.25, 0.25].map((x): Part => [B(0.04, 1.25, 0.07, x, 0.62, 0.01), MAT.woodDark]),
      [B(1.0, 0.04, 0.07, 0, 0.62, 0.01), MAT.woodDark],
      [B(1.16, 0.08, 0.1, 0, 1.28, 0), hb.trim], [B(0.08, 1.3, 0.1, -0.54, 0.65, 0), hb.trim], [B(0.08, 1.3, 0.1, 0.54, 0.65, 0), hb.trim],
    ], [0, y0, d / 2 + 0.03]));
    hb.add('details', 'round-window', at(roundWindowParts(0.34, hb.trim), [-w / 2 - 0.03, y0 + 0.85, 0], -Math.PI / 2));
    hb.add('details', 'round-window-r', at(roundWindowParts(0.34, hb.trim), [w / 2 + 0.03, y0 + 0.85, 0], Math.PI / 2));
    hb.add('details', 'sign', signBoard(0, y0 + h - 0.2, d / 2 + 0.43, 0, 1.1, 0.26, false));
    hb.add('details', 'round-window-back', at(roundWindowParts(0.34, hb.trim), [0, y0 + 0.85, -d / 2 - 0.03], Math.PI));
    hb.prop('lantern-hanging', -1.75, d / 2 + 0.36, 0, y0 + h - 0.05 + 0.6);
    hb.prop('lantern-hanging', 1.75, d / 2 + 0.36, 0, y0 + h - 0.05 + 0.6);
    hb.prop('tea-table', 1.6, 2.6, -0.2);
    hb.prop('stone-lamp', -2.3, 2.1, 0.3);
    hb.prop('flower-pot', -1.5, 2.4, 0);
    return { radius: 2.6, height: 3.6, door: [0, 0, 2.35], window: [-w / 2 - 0.1, y0 + 0.85, 0], sign: { pos: [0, y0 + h - 0.2, d / 2 + 0.47], rotY: 0, w: 1.1, h: 0.26 }, top: [0, y0 + h + 2.2, 0] };
  },

  musician(hb) {
    const w = 2.8, d = 2.5, h = 1.8, y0 = 0.2, rise = 1.15;
    hb.add('foundation', 'base', foundation(w + 0.3, d + 0.3));
    hb.add('walls', 'walls', walls(w, d, h, hb.wall, y0));
    hb.add('walls', 'beams', beams(w, d, h, hb.trim, y0));
    hb.add('walls', 'gables', gableFill(w, d, y0 + h, rise, hb.wall));
    pitchedRoof(hb, w, d, y0 + h, rise, 0.34);
    const top = y0 + h + rise;
    const belfry: Part[] = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) belfry.push([B(0.1, 0.8, 0.1, sx * 0.36, top + 0.4, sz * 0.36), hb.trim]);
    belfry.push([B(0.95, 0.1, 0.95, 0, top + 0.02, 0), hb.trim]);
    belfry.push([hull([[-0.6, top + 0.8, -0.6], [0.6, top + 0.8, -0.6], [-0.6, top + 0.8, 0.6], [0.6, top + 0.8, 0.6], [0, top + 1.45, 0]]), hb.roof, { shade: 0.15 }]);
    hb.add('roof', 'belfry', belfry);
    hb.add('details', 'bell', [[place(lathe([[0, 0], [0.22, 0], [0.2, 0.04], [0.15, 0.11], [0.13, 0.28], [0.09, 0.33], [0, 0.35]], 12), [0, top + 0.28, 0]), MAT.brass, { shade: 0.35 }]]);
    hb.add('details', 'door', at(doorParts(0.75, 1.3, MAT.woodDark, hb.trim), [-0.55, y0, d / 2 + 0.03]));
    hb.add('details', 'window', at(windowParts(0.6, 0.55, hb.trim, hb.roof, true), [0.75, y0 + 1.15, d / 2 + 0.04]));
    hb.add('details', 'window-side', at(windowParts(0.55, 0.5, hb.trim, hb.roof), [w / 2 + 0.04, y0 + 1.15, 0], Math.PI / 2));
    const chimes: Part[] = [];
    for (let i = 0; i < 5; i++) chimes.push([place(cyl(0.022, 0.022, 0.3 + (i % 3) * 0.12, 6), [-1.25 + i * 0.09, y0 + h - 0.45 - (i % 3) * 0.12, d / 2 + 0.55]), '#c4dbe0', { shade: 0.1 }]);
    chimes.push([B(0.5, 0.04, 0.04, -1.07, y0 + h - 0.08, d / 2 + 0.55), MAT.woodDark]);
    hb.add('details', 'chimes', chimes);
    const notes: Part[] = [[place(ball(0.09, 6, 4), [0, 0, 0], [0, 0, 0], [1.2, 0.85, 0.5]), MAT.iron], [B(0.035, 0.36, 0.035, 0.09, 0.17, 0), MAT.iron], [B(0.14, 0.04, 0.035, 0.15, 0.34, 0, [0, 0, -0.4]), MAT.iron]];
    hb.add('details', 'note', at(notes, [0.75, y0 + h - 0.2, d / 2 + 0.06]));
    hb.add('details', 'sign', signBoard(-0.55, y0 + 1.68, d / 2 + 0.08, 0, 0.9, 0.24, false));
    hb.add('details', 'window-back', at(windowParts(0.55, 0.5, hb.trim, hb.roof, true), [0, y0 + 1.15, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'window-left', at(windowParts(0.55, 0.5, hb.trim, hb.roof), [-w / 2 - 0.04, y0 + 1.15, 0], -Math.PI / 2));
    hb.add('details', 'lamp', at(wallLamp(), [-0.05, y0 + 1.3, d / 2 + 0.02]));
    hb.prop('drum', 1.7, 1.7, 0.3);
    hb.prop('bench', -1.6, 1.8, 0, 0, 0.8);
    hb.prop('wind-chime', 2.1, 0.2, -0.5);
    return { radius: 2.4, height: 4.7, door: [-0.55, 0, d / 2 + 0.7], window: [0.75, y0 + 1.15, d / 2 + 0.1], sign: { pos: [-0.55, y0 + 1.68, d / 2 + 0.12], rotY: 0, w: 0.9, h: 0.24 }, top: [0, top + 1.45, 0] };
  },

  painter(hb) {
    const w = 3.2, d = 2.6, hf = 2.6, hb2 = 1.7, y0 = 0.2;
    hb.add('foundation', 'base', foundation(w + 0.3, d + 0.3));
    hb.add('walls', 'walls', [[hull([
      [-w / 2, y0, -d / 2], [w / 2, y0, -d / 2], [-w / 2, y0, d / 2], [w / 2, y0, d / 2],
      [-w / 2, y0 + hb2, -d / 2], [w / 2, y0 + hb2, -d / 2], [-w / 2, y0 + hf, d / 2], [w / 2, y0 + hf, d / 2],
    ]), hb.wall, { shade: 0.22 }]]);
    const a = Math.atan2(hf - hb2, d);
    hb.add('roof', 'roof', [
      [B(w + 0.5, 0.14, Math.hypot(d, hf - hb2) + 0.6, 0, y0 + (hf + hb2) / 2 + 0.1, 0, [-a, 0, 0]), hb.roof],
      [B(1.0, 0.06, 0.9, 0.7, y0 + (hf + hb2) / 2 + 0.2, -0.1, [-a, 0, 0]), MAT.glass, GLOW],
    ]);
    // the big studio window across the front
    const ww = 2.0, wh = 1.45;
    const win: Part[] = [[B(ww, wh, 0.04, 0, 0, -0.01), MAT.glass, GLOW]];
    for (let i = 0; i <= 4; i++) win.push([B(0.07, wh + 0.07, 0.09, -ww / 2 + (i * ww) / 4, 0, 0), hb.trim]);
    for (let j = 0; j <= 3; j++) win.push([B(ww + 0.07, 0.07, 0.09, 0, -wh / 2 + (j * wh) / 3, 0), hb.trim]);
    win.push([B(ww + 0.3, 0.07, 0.18, 0, -wh / 2 - 0.06, 0.06), hb.trim]);
    hb.add('details', 'studio-window', at(win, [0.45, y0 + 1.35, d / 2 + 0.04]));
    hb.add('details', 'door', at(doorParts(0.62, 1.25, hb.roof, hb.trim), [-1.15, y0, d / 2 + 0.03]));
    const splash: Part[] = [];
    const cols = ['#e8603c', '#f6c64b', '#6ab0d8', '#6db35a', '#e86a9a'];
    const r = rng(hb.spec.id + 'paint');
    for (let i = 0; i < 7; i++) splash.push([place(cyl(0.06 + r() * 0.06, 0.06 + r() * 0.06, 0.02, 7), [-w / 2 + 0.2 + r() * 0.5, y0 + 0.3 + r() * 1.4, d / 2 + 0.02], [Math.PI / 2, 0, 0]), cols[i % cols.length], { shade: 0 }]);
    hb.add('details', 'paint', splash);
    hb.add('details', 'sign', signBoard(-1.15, y0 + 1.72, d / 2 + 0.08, 0, 0.75, 0.22, false));
    hb.add('details', 'window-back', at(windowParts(0.55, 0.5, hb.trim, hb.roof), [-0.7, y0 + 1.0, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'window-back-2', at(windowParts(0.55, 0.5, hb.trim, hb.roof), [0.7, y0 + 1.0, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'window-side', at(windowParts(0.6, 0.6, hb.trim, hb.roof, true), [w / 2 + 0.04, y0 + 1.2, 0.1], Math.PI / 2));
    hb.add('details', 'lamp', at(wallLamp(), [-1.15, y0 + 1.95, d / 2 + 0.02]));
    hb.prop('easel', 1.4, 2.0, -0.4);
    hb.prop('frame-standing', -0.4, 2.1, 0.2);
    hb.prop('stool', 0.75, 2.4, 0);
    hb.prop('flower-pot', -2.0, 1.4, 0);
    return { radius: 2.5, height: 3.6, door: [-1.15, 0, d / 2 + 0.7], window: [0.45, y0 + 1.35, d / 2 + 0.1], sign: { pos: [-1.15, y0 + 1.72, d / 2 + 0.12], rotY: 0, w: 0.75, h: 0.22 }, top: [0, y0 + hf + 0.4, 0] };
  },

  beekeeper(hb) {
    const r = 1.45, h = 1.55, y0 = 0.22;
    hb.add('foundation', 'base', [[cyl(r + 0.2, r + 0.28, 0.34, 12), MAT.stone]]);
    hb.add('walls', 'walls', [[place(cyl(r, r, h, 12), [0, y0, 0]), hb.wall, { shade: 0.25 }]]);
    const posts: Part[] = [];
    for (let i = 0; i < 6; i++) {
      const aa = (i / 6) * Math.PI * 2 + Math.PI / 6;
      posts.push([B(0.1, h, 0.1, Math.cos(aa) * (r + 0.02), y0 + h / 2, Math.sin(aa) * (r + 0.02)), hb.trim]);
    }
    posts.push([place(cyl(r + 0.05, r + 0.05, 0.1, 12), [0, y0 + h - 0.08, 0]), hb.trim]);
    hb.add('walls', 'posts', posts);
    const straw = mixHex(MAT.straw, hb.roof, 0.3);
    hb.add('roof', 'thatch', [[place(cone(r + 0.65, 1.75, 12), [0, y0 + h - 0.12, 0]), straw, { shade: 0.3 }]]);
    hb.add('roof', 'thatch-rim', [[place(cyl(r + 0.62, r + 0.68, 0.12, 12), [0, y0 + h - 0.16, 0]), tone(straw, 0.8)], [place(cone(0.35, 0.45, 8), [0, y0 + h + 1.4, 0]), tone(straw, 0.85)]]);
    hb.add('details', 'door', at(doorParts(0.7, 1.15, hb.roof, hb.trim), [0, y0, r - 0.01]));
    hb.add('details', 'window-l', at(roundWindowParts(0.22, hb.trim), [-1.0, y0 + 0.95, 1.02], -0.78));
    hb.add('details', 'window-r', at(roundWindowParts(0.22, hb.trim), [1.0, y0 + 0.95, 1.02], 0.78));
    hb.add('details', 'sign', signBoard(0, y0 + 1.48, r + 0.12, 0, 0.8, 0.22, false));
    hb.add('details', 'window-back', at(roundWindowParts(0.22, hb.trim), [0, y0 + 0.95, -r - 0.01], Math.PI));
    hb.add('details', 'window-side', at(roundWindowParts(0.22, hb.trim), [-r - 0.01, y0 + 0.95, 0], -Math.PI / 2));
    hb.add('details', 'lamp', at(wallLamp(), [0.55, y0 + 1.15, r - 0.12], 0.4));
    hb.prop('beehive', -2.0, 0.9, 0.3);
    hb.prop('beehive', -2.25, -0.4, 0.8);
    hb.prop('beehive', 2.05, 0.7, -0.4);
    hb.prop('flower-bed', 1.3, 2.0, -0.3);
    hb.prop('honey-jar', -0.95, 1.9, 0);
    return { radius: 2.4, height: 3.6, door: [0, 0, r + 0.6], window: [-1.0, y0 + 0.95, 1.1], sign: { pos: [0, y0 + 1.48, r + 0.16], rotY: 0, w: 0.8, h: 0.22 }, top: [0, y0 + h + 1.85, 0] };
  },

  'lighthouse-keeper'(hb) {
    const y0 = 0.4;
    hb.add('foundation', 'base', [[cyl(1.35, 1.5, 0.5, 12), MAT.stone], [B(1.2, 0.14, 0.5, 0, 0.07, 1.5), MAT.stoneDark]]);
    const bands = [[1.1, 1.0], [1.0, 0.92], [0.92, 0.84], [0.84, 0.76]];
    bands.forEach(([rb, rt], i) => {
      hb.add('walls', `band-${i}`, [[place(cyl(rt, rb, 1.0, 12), [0, y0 + i * 1.0, 0]), i % 2 ? hb.trim : hb.wall, { shade: 0.15 }]]);
    });
    const top = y0 + 4.0;
    const gal: Part[] = [[place(cyl(1.15, 1.0, 0.16, 12), [0, top, 0]), MAT.stoneDark]];
    for (let i = 0; i < 12; i++) {
      const aa = (i / 12) * Math.PI * 2;
      gal.push([B(0.05, 0.42, 0.05, Math.cos(aa) * 1.08, top + 0.37, Math.sin(aa) * 1.08), MAT.iron]);
    }
    gal.push([place(lathe([[1.06, 0], [1.1, 0], [1.1, 0.05], [1.06, 0.05]], 12), [0, top + 0.56, 0]), MAT.iron]);
    hb.add('roof', 'gallery', gal);
    hb.add('roof', 'lamp-room', [[place(cyl(0.62, 0.62, 0.75, 8), [0, top + 0.16, 0]), '#ffe7a8', GLOW], ...Array.from({ length: 8 }, (_, i): Part => {
      const aa = (i / 8) * Math.PI * 2 + Math.PI / 8;
      return [B(0.06, 0.75, 0.06, Math.cos(aa) * 0.63, top + 0.535, Math.sin(aa) * 0.63), MAT.iron];
    })]);
    hb.add('roof', 'cap', [[place(cone(0.8, 0.85, 8), [0, top + 0.91, 0]), hb.roof, { shade: 0.2 }], [place(ball(0.12, 8, 6), [0, top + 1.8, 0]), MAT.brass]]);
    hb.add('details', 'door', at(doorParts(0.68, 1.2, MAT.woodDark, hb.trim), [0, y0, 1.06]));
    hb.add('details', 'window-1', at(windowParts(0.34, 0.45, hb.trim, null, false, false), [0, y0 + 2.0, 0.97]));
    hb.add('details', 'window-2', at(windowParts(0.3, 0.42, hb.trim, null, false, false), [0, y0 + 3.0, 0.89]));
    // keeper's hut on the side
    const hw = 1.8, hd = 1.6, hh = 1.35;
    hb.add('walls', 'hut', at(walls(hw, hd, hh, hb.wall, 0.15).concat(gableFill(hw, hd, 0.15 + hh, 0.7, hb.wall)), [1.9, 0, -0.3]));
    hb.add('roof', 'hut-roof', at(roofSlab(hw, hd, 0.15 + hh, 0.7, 0.25, 1, hb.roof).concat(roofSlab(hw, hd, 0.15 + hh, 0.7, 0.25, -1, hb.roof)), [1.9, 0, -0.3]));
    hb.add('details', 'hut-window', at(windowParts(0.45, 0.4, hb.trim, hb.roof, true), [1.9, 0.9, -0.3 + hd / 2 + 0.04]));
    hb.add('details', 'sign', signBoard(-1.1, 1.05, 1.15, 0.5, 0.8, 0.22, false).concat([[B(0.06, 1.0, 0.06, -1.1, 0.5, 1.1), MAT.woodDark]]));
    hb.add('details', 'window-back', at(windowParts(0.3, 0.42, hb.trim, null, false, false), [0, y0 + 2.5, -0.95], Math.PI));
    hb.add('details', 'lamp', at(wallLamp(), [0.5, y0 + 1.1, 1.0]));
    hb.prop('bell', -1.9, 0.2, 0.8, 0, 0.7);
    hb.prop('shell', 0.9, 1.9, 0.4);
    hb.prop('lantern', -0.9, 1.7, 0);
    return { radius: 2.6, height: 6.6, door: [0, 0, 1.7], window: [1.9, 0.9, 0.55], sign: { pos: [-1.1, 1.05, 1.19], rotY: 0.5, w: 0.8, h: 0.22 }, top: [0, top + 1.95, 0] };
  },

  cartographer(hb) {
    const w = 2.2, d = 2.2, h = 3.6, y0 = 0.25, rise = 1.6;
    hb.add('foundation', 'base', foundation(w + 0.4, d + 0.4, 0.5));
    hb.add('walls', 'lower', walls(w, d, h * 0.5, hb.wall, y0));
    hb.add('walls', 'upper', walls(w, d, h * 0.5, mixHex(hb.wall, MAT.cream, 0.2), y0 + h * 0.5));
    hb.add('walls', 'beams', beams(w, d, h, hb.trim, y0, false).concat([
      [B(w + 0.08, 0.12, d + 0.08, 0, y0 + h * 0.5, 0), hb.trim],
    ]));
    hb.add('roof', 'roof', [[hull([
      [-w / 2 - 0.35, y0 + h, -d / 2 - 0.35], [w / 2 + 0.35, y0 + h, -d / 2 - 0.35], [-w / 2 - 0.35, y0 + h, d / 2 + 0.35], [w / 2 + 0.35, y0 + h, d / 2 + 0.35],
      [-w / 2 - 0.3, y0 + h + 0.12, -d / 2 - 0.3], [w / 2 + 0.3, y0 + h + 0.12, -d / 2 - 0.3], [-w / 2 - 0.3, y0 + h + 0.12, d / 2 + 0.3], [w / 2 + 0.3, y0 + h + 0.12, d / 2 + 0.3],
      [0, y0 + h + rise, 0],
    ]), hb.roof, { shade: 0.15 }]]);
    hb.add('details', 'flag', [[B(0.05, 1.3, 0.05, 0, y0 + h + rise + 0.55, 0), MAT.woodDark], [B(0.03, 0.4, 0.62, 0, y0 + h + rise + 1.0, 0.31), mixHex(hb.trim, MAT.red, 0.5)]]);
    hb.add('details', 'door', at(doorParts(0.72, 1.3, MAT.woodDark, hb.trim), [0, y0, d / 2 + 0.03]));
    hb.add('details', 'window-low', at(windowParts(0.45, 0.5, hb.trim, hb.roof), [w / 2 + 0.04, y0 + 1.05, 0], Math.PI / 2));
    hb.add('details', 'window-up', at(windowParts(0.7, 0.62, hb.trim, hb.roof), [0, y0 + h * 0.5 + 0.85, d / 2 + 0.04]));
    hb.add('details', 'window-up-side', at(windowParts(0.5, 0.55, hb.trim, hb.roof), [-w / 2 - 0.04, y0 + h * 0.5 + 0.85, 0], -Math.PI / 2));
    const balcony: Part[] = [[B(1.5, 0.1, 0.7, 0, y0 + h * 0.5 + 0.05, d / 2 + 0.35), MAT.plank]];
    for (const x of [-0.7, -0.23, 0.23, 0.7]) balcony.push([B(0.05, 0.5, 0.05, x, y0 + h * 0.5 + 0.35, d / 2 + 0.67), MAT.woodDark]);
    balcony.push([B(1.5, 0.06, 0.06, 0, y0 + h * 0.5 + 0.6, d / 2 + 0.67), MAT.woodDark]);
    for (const x of [-0.6, 0.6]) balcony.push([B(0.08, 0.5, 0.08, x, y0 + h * 0.5 - 0.22, d / 2 + 0.55, [0.6, 0, 0]), MAT.woodDark]);
    hb.add('details', 'balcony', balcony);
    hb.add('details', 'map-board', at([
      [B(0.9, 0.7, 0.05, 0, 0, 0), MAT.woodDark], [B(0.8, 0.6, 0.03, 0, 0, 0.03), MAT.paper, { shade: 0 }],
      [B(0.3, 0.22, 0.01, -0.15, 0.1, 0.05), '#8fbf7a', { shade: 0 }], [B(0.25, 0.3, 0.01, 0.2, -0.05, 0.05), '#8fbf7a', { shade: 0 }], [B(0.6, 0.08, 0.01, 0, -0.2, 0.05), '#7fb7d4', { shade: 0 }],
    ], [w / 2 + 0.04, y0 + 2.6, 0], Math.PI / 2));
    hb.add('details', 'sign', signBoard(-0.85, y0 + 1.5, d / 2 + 0.1, 0, 0.6, 0.22, false));
    hb.add('details', 'window-back', at(windowParts(0.5, 0.5, hb.trim, hb.roof), [0, y0 + 1.05, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'window-back-up', at(windowParts(0.6, 0.55, hb.trim, hb.roof, true), [0, y0 + h * 0.5 + 0.85, -d / 2 - 0.04], Math.PI));
    hb.add('details', 'lamp', at(wallLamp(), [0.62, y0 + 1.25, d / 2 + 0.02]));
    hb.prop('map', 1.6, 1.6, -0.5);
    hb.prop('globe', -1.5, 1.6, 0);
    hb.prop('books', -1.85, 0.6, 1.0);
    hb.prop('telescope', 0.4, d / 2 + 0.45, 0, y0 + h * 0.5 + 0.1, 0.6);
    return { radius: 2.3, height: 6.9, door: [0, 0, d / 2 + 0.7], window: [0, y0 + h * 0.5 + 0.85, d / 2 + 0.1], sign: { pos: [-0.85, y0 + 1.5, d / 2 + 0.14], rotY: 0, w: 0.6, h: 0.22 }, top: [0, y0 + h + rise + 1.2, 0] };
  },
};

export const RECIPE_TRADES = Object.keys(RECIPES) as Trade[];

/** Lays out the pieces of a house in its own frame, in assembly order. */
export function planHouse(spec: HouseSpec): HousePlan {
  const fn = RECIPES[spec.recipe] ?? RECIPES.baker;
  const hb = new HouseBuilder(spec);
  const info = fn(hb);
  const rank = (s: Stage): number => STAGES.indexOf(s);
  // spec.props go around the yard, on slots the recipe did not use
  const slots: [number, number, number][] = [[-1.6, 2.45, 0.3], [1.65, 2.5, -0.3], [-2.5, 1.2, 0.9], [2.55, 1.1, -0.9], [-2.6, -0.9, 1.4], [2.6, -1.0, -1.4], [0, -2.5, Math.PI], [-1.6, -2.4, 2.5]];
  spec.props.forEach((id, i) => {
    const s = slots[i % slots.length];
    const item = CATALOG[id];
    if (!item) return;
    const far = 1 + Math.floor(i / slots.length) * 0.3;
    hb.prop(id, s[0] * far, s[1] * far, s[2]);
  });
  const pieces = hb.pieces
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p.stage) - rank(b.p.stage) || (a.p.stage === 'props' ? a.i - b.i : a.p.pos[1] - b.p.pos[1] || a.i - b.i))
    .map(({ p }) => p);
  return { ...info, pieces };
}
