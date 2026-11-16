/**
 * A plot of the ring (DESIGN "Участок"): a sector of 42.6° between radii 1.46 and
 * 2.16 m, its inner edge 0.47 m below the eyes and its outer edge 0.30 m (tilted 14°
 * toward the person). Every checked unit lands as a tile: the plot is the count of
 * checked facts.
 *
 *   setOutline(on)  the cobalt dashed outline of the plan, drawn in 1.2 s
 *   setGrid(n)      rows = clamp(ceil(sqrt(n / 2.6)), 4, 14), cols = ceil(n / rows), at most 392 cells
 *   layTile(u, lit) the tile of unit u falls 4 cm in 200 ms into its cell (row by row from the inner edge, left to right);
 *                   a verified tile (lit, the default) then lights its seams: a thin unlit line of the seam colour
 *                   draws out under its edges in 180 ms, so the island becomes a map of verified work
 *   layRow(a, b)    units a..b fall in one wave of 200 ms (the display queue catching up)
 *   close(n)        in 500 ms the n units move into an even grid for the real count, the seam narrows to
 *                   2.5 mm, the cut and keel show along the inner edge, the plot sinks 2 cm and becomes one
 *                   merged geometry with vertex colours; tile numbers keep their laying order
 *   addCourse(n)    a narrow extra course at the outer edge (late pages), numbered after the others
 *   clear(ms)       lifts the tiles off row by row before a rerun
 *
 * Over 392 units one tile stands for `perTile` units: tile j carries units j·perTile…
 * The picture is a function of the recorded stamps and of t (`update(t)`).
 *
 * Frame: the sector root sits at the centre of the island (the head, eye height), turned
 * so the slot's centre azimuth is −z; slot s stands at azimuth 45°·s.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Shape,
  Vector3,
} from '@iwsdk/core';
import { COLOR, LAYOUT, MATERIAL, MOTION, SEAT } from '../../tokens/tokens';
import { bevelBox, box, merge, prep, slab, tint } from './geom';
import { mat, part } from './materials';
import { animate, drop, easeInOut, easeOut, lessMotion, now, progress, rand } from './time';
import type { SectorState, SectorView } from './types';

export const RING = {
  inner: LAYOUT.ring.inner,
  outer: LAYOUT.ring.outer,
  innerY: -SEAT.benchBelowEyes + LAYOUT.ring.innerY,
  outerY: -SEAT.benchBelowEyes + LAYOUT.ring.outerY,
  span: 360 / LAYOUT.ring.slots - LAYOUT.ring.gapDeg,
  slotDeg: 360 / LAYOUT.ring.slots,
};
export const MAX_CELLS = 392;
const TILE_H = 0.008;
const COURSE_W = 0.05;
const OUTLINE_MS = MOTION.stake.outlineMs;
const REGRID_MS = 300;
const CLEAR_TILE_MS = 160;
const SEAM_MS = 180;
/** The lit seam: a plate under the tile, wider by the seam, its top below the tile's top. */
const SEAM_LIFT = 0.0012;
const SEAM_H = 0.0045;
let seamMaterial: MeshBasicMaterial | null = null;
function seamMat(): MeshBasicMaterial {
  seamMaterial ??= new MeshBasicMaterial({ color: COLOR.seam, toneMapped: false });
  seamMaterial.name = 'kit:seam';
  return seamMaterial;
}

const TILT = Math.atan2(RING.outerY - RING.innerY, RING.outer - RING.inner);

/** Height of the plot surface at radius r (sector frame). */
export function surfaceY(r: number): number {
  return RING.innerY + ((r - RING.inner) / (RING.outer - RING.inner)) * (RING.outerY - RING.innerY);
}

export type Grid = { rows: number; cols: number; perTile: number; tiles: number };

/** The grid of a plot for `units` units (PLAN/task 01.2.2). */
export function gridFor(units: number): Grid {
  const n = Math.max(1, Math.floor(units));
  const perTile = Math.max(1, Math.ceil(n / MAX_CELLS));
  const tiles = Math.ceil(n / perTile);
  const rows = Math.min(14, Math.max(4, Math.ceil(Math.sqrt(tiles / 2.6))));
  const cols = Math.max(1, Math.ceil(tiles / rows));
  return { rows, cols, perTile, tiles };
}

/** Cell of tile i: row from the inner edge, column from the left. */
export function cellOf(grid: Grid, i: number): { row: number; col: number } {
  return { row: Math.floor(i / grid.cols), col: i % grid.cols };
}

const SPAN = (RING.span * Math.PI) / 180;

/** Centre (on the surface) and frame of a cell. */
function cellPose(grid: Grid, i: number, seam: number, out: { pos: Vector3; q: Quaternion; sx: number; sz: number }, course = false, courseN = 1): void {
  let r: number;
  let a: number;
  let dr: number;
  let da: number;
  if (course) {
    dr = COURSE_W;
    r = RING.outer + 0.004 + dr / 2;
    da = SPAN / courseN;
    a = -SPAN / 2 + (i + 0.5) * da;
  } else {
    const { row, col } = cellOf(grid, i);
    dr = (RING.outer - RING.inner) / grid.rows;
    da = SPAN / grid.cols;
    r = RING.inner + (row + 0.5) * dr;
    a = -SPAN / 2 + (col + 0.5) * da;
  }
  out.pos.set(r * Math.sin(a), surfaceY(r), -r * Math.cos(a));
  out.q.setFromEuler(euler.set(TILT, -a, 0, 'YXZ'));
  out.sx = Math.max(0.004, r * da - seam);
  out.sz = Math.max(0.004, dr / Math.cos(TILT) - seam);
}
const euler = new Euler();

function pushQuad(p: number[], a: Vector3, b: Vector3, c: Vector3, d: Vector3): void {
  p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
}

/** The base under the tiles: the cut along the inner edge and the keel set back under it. */
function baseGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const prism = (r0: number, r1: number, top: (r: number) => number, depth: number, color: string, topColor: string): void => {
    const p: number[] = [];
    const pt = (r: number, a: number, y: number): Vector3 => new Vector3(r * Math.sin(a), y, -r * Math.cos(a));
    const steps = 24;
    for (let s = 0; s < steps; s++) {
      const a0 = -SPAN / 2 + (SPAN * s) / steps;
      const a1 = -SPAN / 2 + (SPAN * (s + 1)) / steps;
      // inner face (toward the person)
      pushQuad(p, pt(r0, a0, top(r0) - depth), pt(r0, a1, top(r0) - depth), pt(r0, a1, top(r0)), pt(r0, a0, top(r0)));
      // outer face
      pushQuad(p, pt(r1, a1, top(r1) - depth), pt(r1, a0, top(r1) - depth), pt(r1, a0, top(r1)), pt(r1, a1, top(r1)));
      // bottom
      pushQuad(p, pt(r0, a1, top(r0) - depth), pt(r0, a0, top(r0) - depth), pt(r1, a0, top(r1) - depth), pt(r1, a1, top(r1) - depth));
    }
    for (const [a, flip] of [
      [-SPAN / 2, false],
      [SPAN / 2, true],
    ] as const) {
      const q = [pt(r0, a, top(r0) - depth), pt(r1, a, top(r1) - depth), pt(r1, a, top(r1)), pt(r0, a, top(r0))];
      if (flip) pushQuad(p, q[0], q[1], q[2], q[3]);
      else pushQuad(p, q[3], q[2], q[1], q[0]);
    }
    const topStart = p.length;
    for (let s = 0; s < steps; s++) {
      const a0 = -SPAN / 2 + (SPAN * s) / steps;
      const a1 = -SPAN / 2 + (SPAN * (s + 1)) / steps;
      pushQuad(p, pt(r0, a0, top(r0)), pt(r0, a1, top(r0)), pt(r1, a1, top(r1)), pt(r1, a0, top(r1)));
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(p), 3));
    g.computeVertexNormals();
    const c = new Color(color);
    const ct = new Color(topColor);
    const colors = new Float32Array(p.length);
    for (let i = 0; i < p.length; i += 3) {
      const cc = i >= topStart ? ct : c;
      colors[i] = cc.r;
      colors[i + 1] = cc.g;
      colors[i + 2] = cc.b;
    }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    parts.push(prep(g));
  };
  const cut = MATERIAL.plot.cut;
  prism(RING.inner, RING.outer, (r) => surfaceY(r) - 0.0005, cut - 0.0005, COLOR.ground.cut, COLOR.slateEdge);
  const inset = MATERIAL.plot.keelInset;
  prism(RING.inner + inset, RING.outer - inset, (r) => surfaceY(r) - cut, MATERIAL.plot.keel, COLOR.ground.keel, COLOR.ground.keel);
  return merge(parts);
}
let baseGeo: BufferGeometry | null = null;

/** A tile whose inner edge (+z, toward the person) is `inner` wide and outer edge `outer` wide. */
function trapezoidTile(inner: number, outer: number, depth: number): BufferGeometry {
  const shape = new Shape();
  const b = Math.min(MATERIAL.tile.bevel, TILE_H / 4);
  const hi = inner / 2 - b;
  const ho = outer / 2 - b;
  const hd = depth / 2 - b;
  // Shape y becomes -z after slab(): +y is the outer edge.
  shape.moveTo(-hi, -hd);
  shape.lineTo(hi, -hd);
  shape.lineTo(ho, hd);
  shape.lineTo(-ho, hd);
  shape.lineTo(-hi, -hd);
  return slab(shape, TILE_H, b);
}

/** Tile geometry for a grid: sized to the middle cell, base on y = 0. */
function tileGeometry(sx: number, sz: number): BufferGeometry {
  return bevelBox(sx, TILE_H, sz, Math.min(MATERIAL.tile.bevel, TILE_H / 4), 0.002);
}

type Pose = { pos: Vector3; q: Quaternion; sx: number; sz: number };
const poseA: Pose = { pos: new Vector3(), q: new Quaternion(), sx: 1, sz: 1 };
const poseB: Pose = { pos: new Vector3(), q: new Quaternion(), sx: 1, sz: 1 };
const m4 = new Matrix4();
const v3 = new Vector3();
const s3 = new Vector3();
const up = new Vector3();

export function createSector(spec: { slot: number; seed: number }): SectorView {
  const root = new Object3D();
  root.name = `kit:sector:${spec.slot}`;
  root.rotation.y = (-spec.slot * RING.slotDeg * Math.PI) / 180;
  const body = new Object3D();
  root.add(body);
  const tones = COLOR.ground.tile.map((h) => new Color(h));
  const toneOf = (j: number): Color => tones[Math.floor(rand(spec.seed, j) * 3) % 3];

  // ---- state
  let state: SectorState = 'outline';
  let outlineOn = false;
  let outlineAt = -Infinity;
  let grid: Grid | null = null;
  let prevGrid: Grid | null = null;
  let gridAt = -Infinity;
  const CAP = MAX_CELLS + 64;
  const layAt = new Float64Array(CAP).fill(NaN);
  const dropMs = new Float32Array(CAP).fill(MOTION.tile.flipDropMs);
  const lit = new Uint8Array(CAP).fill(1);
  let laidMax = -1;
  let closeAt = -Infinity;
  let final: Grid | null = null;
  let course = 0;
  let courseAt = -Infinity;
  let clearAt = -Infinity;
  let clearMs = 0;
  let bordered = false;

  // ---- tiles while laying: one instanced mesh
  let geoGrid = '';
  const tilesMesh = new InstancedMesh(tileGeometry(0.1, 0.08), mat('vcMatte'), CAP);
  tilesMesh.name = `sector:${spec.slot}:tiles`;
  tilesMesh.count = 0;
  tilesMesh.frustumCulled = false;
  tilesMesh.instanceColor = new InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
  body.add(tilesMesh);
  const seamGeo = prep(box(1, SEAM_H, 1));
  seamGeo.translate(0, SEAM_H / 2 + SEAM_LIFT, 0);
  const seamsMesh = new InstancedMesh(seamGeo, seamMat(), CAP);
  seamsMesh.name = `sector:${spec.slot}:seams`;
  seamsMesh.count = 0;
  seamsMesh.frustumCulled = false;
  body.add(seamsMesh);
  let mergedSeams: Mesh | null = null;

  // ---- the outline of the plan: dashes around the sector
  const dashPoses: Matrix4[] = [];
  {
    const y = 0.004;
    const add = (r: number, a: number, along: 'r' | 'a'): void => {
      const pos = new Vector3(r * Math.sin(a), surfaceY(r) + y, -r * Math.cos(a));
      const q = new Quaternion().setFromEuler(new Euler(TILT, -a, along === 'r' ? 0 : 0, 'YXZ'));
      const s = along === 'a' ? new Vector3(0.022, 1, 0.005) : new Vector3(0.005, 1, 0.022);
      dashPoses.push(new Matrix4().compose(pos, q, s));
    };
    const step = 0.036;
    const arc = (r: number, reverse: boolean): void => {
      const n = Math.max(2, Math.round((r * SPAN) / step));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        add(r, -SPAN / 2 + SPAN * (reverse ? 1 - k : k), 'a');
      }
    };
    const side = (a: number, outward: boolean): void => {
      const n = Math.max(2, Math.round((RING.outer - RING.inner) / step));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n;
        add(RING.inner + (RING.outer - RING.inner) * (outward ? k : 1 - k), a, 'r');
      }
    };
    arc(RING.inner - 0.01, false);
    side(SPAN / 2 + 0.006, true);
    arc(RING.outer + 0.01, true);
    side(-SPAN / 2 - 0.006, false);
  }
  const dashGeo = prep(box(1, 0.0025, 1));
  const outline = new InstancedMesh(dashGeo, mat('cobalt'), dashPoses.length);
  outline.name = `sector:${spec.slot}:outline`;
  outline.frustumCulled = false;
  outline.count = 0;
  dashPoses.forEach((m, i) => outline.setMatrixAt(i, m));
  body.add(outline);

  // ---- closed: one merged geometry; the bone border of a plot whose points are all reviewed
  let merged: Mesh | null = null;
  let mergedKey = '';
  let trisPerTile = 0;
  let mergedTiles = 0;
  const border = part(
    (() => {
      const pieces: BufferGeometry[] = [];
      const n = 28;
      for (let i = 0; i < n; i++) {
        const a = -SPAN / 2 + (SPAN * (i + 0.5)) / n;
        const r = RING.inner + 0.006;
        const g = box(((RING.inner * SPAN) / n) * 1.02, 0.006, 0.01);
        g.applyMatrix4(new Matrix4().compose(new Vector3(r * Math.sin(a), surfaceY(r) + TILE_H * 0.5, -r * Math.cos(a)), new Quaternion().setFromEuler(new Euler(TILT, -a, 0, 'YXZ')), new Vector3(1, 1, 1)));
        pieces.push(g);
      }
      return merge(pieces);
    })(),
    'bone',
    `sector:${spec.slot}:border`,
  );
  border.visible = false;
  body.add(border);

  const unitsToTile = (u: number, g: Grid): number => Math.floor(u / g.perTile);

  const ensureGrid = (units: number): Grid => {
    if (!grid || units > grid.tiles * grid.perTile) {
      const next = gridFor(Math.max(units, grid ? grid.tiles * grid.perTile : 0));
      if (grid && laidMax >= 0) {
        prevGrid = grid;
        gridAt = now();
      }
      grid = next;
    }
    return grid;
  };

  const buildMerged = (g: Grid, n: number, withCourse: number): void => {
    const key = `${g.rows}x${g.cols}:${g.tiles}:${withCourse}`;
    if (merged && mergedKey === key) return;
    if (merged) {
      merged.removeFromParent();
      merged.geometry.dispose();
    }
    const seam = MATERIAL.seam.closed;
    const pose = poseA;
    const pieces: BufferGeometry[] = [];
    const tiles = Math.ceil(n / g.perTile);
    // One trapezoid per row (narrower at the inner edge), so the tiles follow the wedge.
    const rowTiles = new Map<number, BufferGeometry>();
    const rowSeams = new Map<number, BufferGeometry>();
    const seamPieces: BufferGeometry[] = [];
    let tile: BufferGeometry | null = null;
    for (let j = 0; j < tiles + withCourse; j++) {
      const isCourse = j >= tiles;
      if (!isCourse) cellPose(g, j, seam, pose);
      else cellPose(g, j - tiles, seam, pose, true, withCourse);
      const row = isCourse ? -1 : cellOf(g, j).row;
      tile = rowTiles.get(row) ?? null;
      if (!tile) {
        const dr = isCourse ? COURSE_W : (RING.outer - RING.inner) / g.rows;
        const r0 = isCourse ? RING.outer + 0.004 : RING.inner + row * dr;
        const da = isCourse ? SPAN / withCourse : SPAN / g.cols;
        tile = trapezoidTile(r0 * da - seam, (r0 + dr) * da - seam, pose.sz);
        rowTiles.set(row, tile);
      }
      const c = tile.clone();
      m4.compose(pose.pos, pose.q, s3.set(1, 1, 1));
      c.applyMatrix4(m4);
      if (isCourse || lit[Math.min(CAP - 1, j)]) {
        let plate = rowSeams.get(row) ?? null;
        if (!plate) {
          const dr = isCourse ? COURSE_W : (RING.outer - RING.inner) / g.rows;
          const r0 = isCourse ? RING.outer + 0.004 : RING.inner + row * dr;
          const da = isCourse ? SPAN / withCourse : SPAN / g.cols;
          plate = trapezoidTile(r0 * da, (r0 + dr) * da, pose.sz + seam);
          plate.scale(1, SEAM_H / TILE_H, 1);
          plate.translate(0, SEAM_LIFT, 0);
          rowSeams.set(row, plate);
        }
        const sp = plate.clone();
        sp.applyMatrix4(m4);
        seamPieces.push(sp);
      }
      tint(c, toneOf(j < tiles ? j : 100000 + j - tiles));
      pieces.push(c);
    }
    trisPerTile = tile ? (tile.index ? tile.index.count : tile.attributes.position.count) / 3 : 0;
    mergedTiles = tiles + withCourse;
    baseGeo ??= baseGeometry();
    pieces.push(baseGeo);
    merged = part(merge(pieces), 'vcMatte', `sector:${spec.slot}:plot`);
    merged.userData.sector = spec.slot;
    mergedKey = key;
    body.add(merged);
    if (mergedSeams) {
      mergedSeams.removeFromParent();
      mergedSeams.geometry.dispose();
      mergedSeams = null;
    }
    if (seamPieces.length) {
      mergedSeams = new Mesh(merge(seamPieces), seamMat());
      mergedSeams.name = `sector:${spec.slot}:seams-closed`;
      mergedSeams.raycast = () => {};
      body.add(mergedSeams);
    }
  };

  /** Draws the course tiles into the instanced mesh from index `from`; returns the count used. */
  const drawCourse = (t: number, from: number, g: Grid, seam: number, reduced: boolean): number => {
    let count = from;
    if (course <= 0) return count;
    const bb = tilesMesh.geometry.boundingBox!;
    const gx = bb.max.x - bb.min.x;
    const gz = bb.max.z - bb.min.z;
    const colors = tilesMesh.instanceColor!;
    for (let k = 0; k < course; k++) {
      const i = from + k;
      if (i >= CAP) break;
      const at = courseAt + k * MOTION.tile.staggerMs;
      if (t < at) {
        m4.makeScale(0, 0, 0);
        tilesMesh.setMatrixAt(i, m4);
        count = i + 1;
        continue;
      }
      const kd = reduced ? 1 : progress(t, at, MOTION.tile.flipDropMs);
      cellPose(g, k, seam, poseA, true, course);
      up.set(0, 1, 0).applyQuaternion(poseA.q);
      v3.copy(poseA.pos).addScaledVector(up, MOTION.tile.dropFrom * (1 - drop(kd)));
      m4.compose(v3, poseA.q, s3.set(poseA.sx / gx, 1, poseA.sz / gz));
      tilesMesh.setMatrixAt(i, m4);
      const c = toneOf(100000 + k);
      colors.setXYZ(i, c.r, c.g, c.b);
      count = i + 1;
    }
    return count;
  };

  const sector: SectorView = {
    root,
    slot: spec.slot,
    seed: spec.seed,
    get state() {
      return state;
    },
    get perTile() {
      return (final ?? grid)?.perTile ?? 1;
    },
    get tiles() {
      const g = final ?? grid;
      if (!g) return 0;
      return (final ? g.tiles : Math.min(g.tiles, laidMax + 1)) + course;
    },
    get grid() {
      const g = final ?? grid;
      return { rows: g?.rows ?? 0, cols: g?.cols ?? 0 };
    },
    setOutline(on) {
      if (on === outlineOn) return;
      outlineOn = on;
      outlineAt = now();
    },
    setGrid(planned) {
      const next = gridFor(planned);
      if (grid && laidMax >= 0 && (next.rows !== grid.rows || next.cols !== grid.cols)) {
        prevGrid = grid;
        gridAt = now();
      }
      grid = next;
      if (state === 'outline') state = 'laying';
    },
    layTile(u, on = true) {
      const g = ensureGrid(u + 1);
      const i = unitsToTile(u, g);
      if (i >= CAP) return;
      if (!Number.isNaN(layAt[i]) && layAt[i] > clearAt) return;
      layAt[i] = now();
      lit[i] = on ? 1 : 0;
      dropMs[i] = MOTION.tile.flipDropMs;
      laidMax = Math.max(laidMax, i);
      if (state === 'outline') state = 'laying';
    },
    layRow(from, to) {
      if (to < from) return;
      const g = ensureGrid(to + 1);
      const a = unitsToTile(from, g);
      const b = Math.min(CAP - 1, unitsToTile(to, g));
      const t0 = now();
      const n = b - a + 1;
      for (let i = a; i <= b; i++) {
        if (!Number.isNaN(layAt[i]) && layAt[i] > clearAt) continue;
        // One wave in 200 ms: starts spread over 80 ms, each falls in 120 ms.
        layAt[i] = t0 + (n > 1 ? ((i - a) / (n - 1)) * 80 : 0);
        dropMs[i] = 120;
        lit[i] = 1;
      }
      laidMax = Math.max(laidMax, b);
      if (state === 'outline') state = 'laying';
    },
    close(n) {
      final = gridFor(Math.max(1, n));
      if (!grid) grid = final;
      closeAt = now();
      state = bordered ? 'bordered' : 'closed';
    },
    addCourse(n) {
      course = Math.max(0, Math.floor(n));
      courseAt = now();
    },
    clear(ms = 1200) {
      clearAt = now();
      clearMs = ms;
      closeAt = -Infinity;
      final = null;
      course = 0;
      bordered = false;
      state = 'outline';
    },
    setState(next) {
      if (next === 'bordered') bordered = true;
      if (next === 'closed') bordered = false;
      state = next;
    },
    tileIndexAt(hit) {
      if (hit.object && hit.object === merged && hit.faceIndex != null && trisPerTile > 0) {
        const j = Math.floor(hit.faceIndex / trisPerTile);
        if (j < mergedTiles) return j;
      }
      if (hit.object === tilesMesh && hit.instanceId != null) {
        const i = hit.instanceId;
        if (final && grid) return Math.min(final.tiles - 1, Math.floor((i * grid.perTile) / final.perTile));
        return i;
      }
      if (!hit.point) return -1;
      root.updateWorldMatrix(true, false);
      const p = root.worldToLocal(v3.copy(hit.point));
      const r = Math.hypot(p.x, p.z);
      const a = Math.atan2(p.x, -p.z);
      const g = final ?? grid;
      if (!g || Math.abs(a) > SPAN / 2) return -1;
      if (r > RING.outer && course > 0) {
        const k = Math.floor(((a + SPAN / 2) / SPAN) * course);
        return g.tiles + Math.min(course - 1, Math.max(0, k));
      }
      if (r < RING.inner || r > RING.outer) return -1;
      const row = Math.min(g.rows - 1, Math.floor(((r - RING.inner) / (RING.outer - RING.inner)) * g.rows));
      const col = Math.min(g.cols - 1, Math.floor(((a + SPAN / 2) / SPAN) * g.cols));
      const i = row * g.cols + col;
      const count = final ? g.tiles : Math.min(g.tiles, laidMax + 1);
      return i < count ? i : -1;
    },
    tilePosition(i, target = new Vector3()) {
      const g = final ?? grid ?? gridFor(1);
      const seam = final ? MATERIAL.seam.closed : MATERIAL.seam.laying;
      if (i >= g.tiles && course > 0) cellPose(g, i - g.tiles, seam, poseA, true, course);
      else cellPose(g, i, seam, poseA);
      up.set(0, 1, 0).applyQuaternion(poseA.q);
      target.copy(poseA.pos).addScaledVector(up, TILE_H);
      if (final) target.y -= MOTION.plot.settle;
      root.updateWorldMatrix(true, false);
      return root.localToWorld(target);
    },
    update(t) {
      const reduced = lessMotion();
      // Outline: dashes appear around the perimeter in 1.2 s; go away in 0.3 s.
      const ko = reduced ? (t >= outlineAt ? 1 : 0) : progress(t, outlineAt, outlineOn ? OUTLINE_MS : 300);
      const shownDashes = outlineOn ? Math.floor(ko * dashPoses.length) : Math.floor((1 - ko) * dashPoses.length);
      const closing = final !== null && t >= closeAt;
      outline.count = closing ? 0 : shownDashes;
      outline.visible = outline.count > 0;

      const g = grid;
      const kClose = closing ? (reduced ? 1 : easeInOut(progress(t, closeAt, MOTION.plot.closeMs))) : 0;
      // Closed and settled: the merged plot.
      if (final && closing && kClose >= 1) {
        const courseDone = course === 0 || reduced || t >= courseAt + (course - 1) * MOTION.tile.staggerMs + MOTION.tile.flipDropMs;
        buildMerged(final, final.tiles * final.perTile, courseDone ? course : 0);
        merged!.visible = true;
        if (mergedSeams) mergedSeams.visible = true;
        seamsMesh.visible = false;
        body.position.y = -MOTION.plot.settle;
        border.visible = state === 'bordered';
        tilesMesh.visible = !courseDone;
        if (!courseDone) {
          cellPose(final, 0, 0, poseA);
          const key = `${final.rows}x${final.cols}`;
          if (key !== geoGrid) {
            tilesMesh.geometry = tileGeometry(poseA.sx, poseA.sz);
            geoGrid = key;
          }
          tilesMesh.count = drawCourse(t, 0, final, MATERIAL.seam.closed, false);
          tilesMesh.instanceMatrix.needsUpdate = true;
          tilesMesh.instanceColor!.needsUpdate = true;
        }
        return;
      }
      if (merged) merged.visible = false;
      if (mergedSeams) mergedSeams.visible = false;
      seamsMesh.visible = true;
      border.visible = false;
      tilesMesh.visible = true;
      body.position.y = -MOTION.plot.settle * kClose;
      if (!g) {
        tilesMesh.count = 0;
        return;
      }
      const key = `${g.rows}x${g.cols}`;
      if (key !== geoGrid) {
        cellPose(g, 0, 0, poseA);
        tilesMesh.geometry = tileGeometry(poseA.sx, poseA.sz);
        geoGrid = key;
      }
      const bb = tilesMesh.geometry.boundingBox!;
      const gx = bb.max.x - bb.min.x;
      const gz = bb.max.z - bb.min.z;
      const kGrid = prevGrid ? (reduced ? 1 : easeInOut(progress(t, gridAt, REGRID_MS))) : 1;
      const seam = MATERIAL.seam.laying + (MATERIAL.seam.closed - MATERIAL.seam.laying) * kClose;
      const colors = tilesMesh.instanceColor!;
      const units = final ? final.tiles * final.perTile : 0;
      const n = Math.max(laidMax + 1, 0);
      let count = 0;
      for (let i = 0; i < n + (closing ? 0 : 0); i++) {
        const at = layAt[i];
        let shown = !Number.isNaN(at) && t >= at;
        let lift = 0;
        let shrink = 1;
        if (shown && at <= clearAt) {
          // Cleared: rows go away from the outer edge in, within clearMs.
          const row = cellOf(g, i).row;
          const start = clearAt + ((g.rows - 1 - row) / Math.max(1, g.rows)) * Math.max(0, clearMs - CLEAR_TILE_MS);
          const kc = progress(t, start, CLEAR_TILE_MS);
          if (kc >= 1) shown = false;
          lift = 0.04 * easeOut(kc);
          shrink = 1 - kc;
        }
        if (!shown) {
          m4.makeScale(0, 0, 0);
          tilesMesh.setMatrixAt(i, m4);
          seamsMesh.setMatrixAt(i, m4);
          continue;
        }
        const kd = reduced ? 1 : progress(t, at, dropMs[i]);
        lift += MOTION.tile.dropFrom * (1 - drop(kd));
        cellPose(g, i, seam, poseA);
        if (prevGrid && kGrid < 1) {
          cellPose(prevGrid, i, seam, poseB);
          poseA.pos.lerpVectors(poseB.pos, poseA.pos, kGrid);
          poseA.q.slerpQuaternions(poseB.q, poseA.q, kGrid);
          poseA.sx += (poseB.sx - poseA.sx) * (1 - kGrid);
          poseA.sz += (poseB.sz - poseA.sz) * (1 - kGrid);
        }
        let tone = i;
        if (final && kClose > 0) {
          // Into the even grid of the real count; extra tiles of a merged unit fold away.
          const u = i * g.perTile;
          const j = Math.floor(u / final.perTile);
          if (u >= units || u % final.perTile !== 0) shrink *= 1 - kClose;
          if (j < final.tiles) {
            cellPose(final, j, seam, poseB);
            poseA.pos.lerp(poseB.pos, kClose);
            poseA.q.slerp(poseB.q, kClose);
            poseA.sx += (poseB.sx - poseA.sx) * kClose;
            poseA.sz += (poseB.sz - poseA.sz) * kClose;
            tone = j;
          }
        }
        up.set(0, 1, 0).applyQuaternion(poseA.q);
        v3.copy(poseA.pos).addScaledVector(up, lift);
        m4.compose(v3, poseA.q, s3.set((poseA.sx / gx) * shrink, shrink, (poseA.sz / gz) * shrink));
        tilesMesh.setMatrixAt(i, m4);
        // The seams light once the tile lies: the plate grows out from under it.
        const ks = lit[i] ? (reduced ? (kd >= 1 ? 1 : 0) : easeOut(progress(t, at + dropMs[i], SEAM_MS))) : 0;
        if (ks > 0 && lift < 1e-4) {
          const grow = (MATERIAL.seam.laying + 0.0005) * ks;
          m4.compose(poseA.pos, poseA.q, s3.set((poseA.sx + grow) * shrink, shrink, (poseA.sz + grow) * shrink));
        } else m4.makeScale(0, 0, 0);
        seamsMesh.setMatrixAt(i, m4);
        const c = toneOf(tone);
        colors.setXYZ(i, c.r, c.g, c.b);
        count = i + 1;
      }
      // The extra course at the outer edge.
      count = Math.max(count, drawCourse(t, n, g, seam, reduced));
      tilesMesh.count = count;
      tilesMesh.instanceMatrix.needsUpdate = true;
      seamsMesh.count = Math.min(count, n);
      seamsMesh.instanceMatrix.needsUpdate = true;
      colors.needsUpdate = true;
    },
  };
  animate(sector);
  return sector;
}
