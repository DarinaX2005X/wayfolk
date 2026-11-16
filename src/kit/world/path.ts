/**
 * The run arc (DESIGN "Дуга прогона"): a shelf of tiles 22 cm wide (radius 1.215 to
 * 1.435 m) 0.47 m below the eyes from −31° to +31°, extended on the left by the parking
 * of the instruments from −41° to −31°. Two rows: mechanisms stand in the inner row
 * (1.27 m), instruments walk to their station along the outer row (1.38 m).
 *
 * `setPlan` raises the cobalt stakes of the stations out of the shelf left to right,
 * 120 ms apart, each overshooting 3 cm and settling in 180 ms, and strings the plan line
 * (5 mm) from stake to stake in 240 ms per span. The line leaves from the first stake on
 * the bench and crosses the air to the shelf as a straight taut string: between bench and
 * shelf nothing walks, only paper flies. `retract()` takes stakes and line back into the
 * shelf. A slate rod of 6 mm rises behind each station; the board hangs on its top.
 *
 * All points are in the seated frame (the root of the path is the seated frame).
 */
import { Color, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3, type BufferGeometry } from '@iwsdk/core';
import type { Station } from '../../agents/types';
import { COLOR, LAYOUT, MATERIAL, MOTION, SEAT, polar } from '../../tokens/tokens';
import { box, cylinder, flatRing, merge, prep, tint, bevelBox } from './geom';
import { stakeGeometry, STAKE, PLATE } from './first-stake';
import { mat, part, setMat, type KitMat } from './materials';
import { animate, easeInOut, easeOut, lessMotion, now, progress, rand, clamp01 } from './time';
import type { PathView, StationState } from './types';
import { slotPoint } from './bench';

const ARC = LAYOUT.arc;
export const SHELF = {
  y: -SEAT.benchBelowEyes + ARC.y,
  inner: ARC.inner,
  outer: ARC.inner + ARC.d,
  rowInner: ARC.rows.inner,
  rowOuter: ARC.rows.outer,
  from: ARC.parking.from,
  to: ARC.to,
  thickness: 0.03,
};
const STAKE_R = SHELF.inner + 0.012;
const ROD_R = SHELF.outer - 0.006;
const ROD_TOP = -SEAT.benchBelowEyes + LAYOUT.board.full.y;
const LINE_UP = 0.042;
const RISE_MS = MOTION.stake.settleMs;
const STAGGER = MOTION.stake.staggerMs;
const SPAN_MS = MOTION.stake.lineMs;
const RETRACT_MS = 600;
const STATE_KEY: Record<StationState, KitMat> = {
  pending: 'bone',
  active: 'cobalt',
  waiting: 'amber',
  asking: 'amber',
  error: 'vermilion',
  done: 'moss',
};

const rad = (deg: number): number => (deg * Math.PI) / 180;
export function arcPoint(angleDeg: number, r: number, target = new Vector3()): Vector3 {
  const p = polar(angleDeg, r, SHELF.y);
  return target.set(p.x, p.y, p.z);
}

/** The shelf: two rows of tiles along the arc, with the cut along its inner edge. */
function shelfGeometry(): BufferGeometry {
  const tones = COLOR.ground.tile.map((h) => new Color(h));
  const pieces: BufferGeometry[] = [];
  const seam = MATERIAL.seam.laying;
  const rows = [
    [SHELF.inner, SHELF.inner + ARC.d / 2],
    [SHELF.inner + ARC.d / 2, SHELF.outer],
  ];
  rows.forEach(([r0, r1], row) => {
    const rm = (r0 + r1) / 2;
    const span = rad(SHELF.to - SHELF.from);
    const n = Math.round((span * rm) / 0.11);
    for (let i = 0; i < n; i++) {
      const a = rad(SHELF.from) + ((i + 0.5) / n) * span;
      const w = (span / n) * rm - seam;
      const g = bevelBox(w, 0.012, r1 - r0 - seam, MATERIAL.tile.bevel, 0.002);
      g.translate(0, -0.012, 0);
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -a);
      g.applyMatrix4(new Matrix4().compose(new Vector3(rm * Math.sin(a), 0, -rm * Math.cos(a)), q, new Vector3(1, 1, 1)));
      tint(g, tones[Math.floor(rand(11, row, i) * 3) % 3]);
      pieces.push(g);
    }
  });
  // Body under the tiles: the cut face toward the person, keel colour below.
  const steps = 36;
  for (let i = 0; i < steps; i++) {
    const a0 = rad(SHELF.from) + (i / steps) * rad(SHELF.to - SHELF.from);
    const a1 = rad(SHELF.from) + ((i + 1) / steps) * rad(SHELF.to - SHELF.from);
    const am = (a0 + a1) / 2;
    const w = (a1 - a0) * SHELF.inner * 1.01;
    const g = box(w, SHELF.thickness - 0.012, ARC.d - 0.01);
    g.translate(0, -SHELF.thickness, 0);
    const r = SHELF.inner + ARC.d / 2;
    g.applyMatrix4(new Matrix4().compose(new Vector3(r * Math.sin(am), 0, -r * Math.cos(am)), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -am), new Vector3(1, 1, 1)));
    tint(g, COLOR.ground.cut);
    pieces.push(g);
  }
  return merge(pieces);
}

/**
 * Parking place i (0..5): two rows of three, 7.5 cm apart, from −31° leftwards; the outer
 * row lies on the lane, so the places nearest the shelf come first.
 */
export function parkingPlace(i: number, target = new Vector3()): Vector3 {
  const k = Math.max(0, Math.min(ARC.parking.rows * ARC.parking.perRow - 1, Math.floor(i)));
  const row = k % 2;
  const col = Math.floor(k / 2);
  const r = SHELF.rowOuter - ARC.parking.step + row * ARC.parking.step;
  const step = (ARC.parking.step / (SHELF.rowOuter - ARC.parking.step / 2)) * (180 / Math.PI);
  return arcPoint(ARC.parking.to - 0.9 - col * step, r, target);
}

type StakeNode = { id: string; angle: number; stake: Object3D; collar: ReturnType<typeof part>; rod: ReturnType<typeof part>; state: StationState; progress: number };

export function createPath(): PathView {
  const root = new Object3D();
  root.name = 'kit:path';
  const shelfRoot = new Object3D();
  shelfRoot.position.y = SHELF.y;
  shelfRoot.visible = false;
  const shelf = part(shelfGeometry(), 'vcMatte', 'path:shelf');
  shelfRoot.add(shelf);
  root.add(shelfRoot);

  const stakeGeo = stakeGeometry();
  const collarGeo = flatRing(STAKE.d / 2 + 0.0012, 0.0022, 20);
  const rodGeo = cylinder(LAYOUT.board.rod / 2, LAYOUT.board.rod / 2, ROD_TOP - SHELF.y, 8);
  let stakes: StakeNode[] = [];
  let leaving: StakeNode[] = [];
  let planAt = -Infinity;
  let retractAt = -Infinity;
  let shownAt = -Infinity;
  let stationsNow: Station[] = [];
  const start = new Vector3();

  // The plan line: one instanced unit cylinder per span (bench → first stake, then stake to stake).
  const lineGeo = prep(cylinder(0.0025, 0.0025, 1, 8, true));
  const line = new InstancedMesh(lineGeo, mat('cobalt'), 8);
  line.name = 'path:line';
  line.frustumCulled = false;
  line.count = 0;
  root.add(line);

  const ends: Vector3[] = [];
  const m4 = new Matrix4();
  const q = new Quaternion();
  const dir = new Vector3();
  const yAxis = new Vector3(0, 1, 0);
  const s3 = new Vector3();

  const stakeTop = (angle: number, target = new Vector3()): Vector3 => arcPoint(angle, STAKE_R, target).setY(SHELF.y + LINE_UP);

  const path: PathView = {
    root,
    setPlan(stations, opts = {}) {
      // A new plan first takes the old stakes away.
      if (stakes.length) {
        leaving = stakes;
        retractAt = now();
      }
      stationsNow = stations;
      const n = Math.min(5, Math.max(3, stations.length)) as 3 | 4 | 5;
      const angles = ARC.stations[n];
      const t0 = now();
      planAt = leaving.length ? t0 + 200 : t0;
      if (!shelfRoot.visible) shownAt = t0;
      shelfRoot.visible = true;
      if (opts.start) start.copy(opts.start);
      else {
        // Top of the first stake on the bench (axis-aligned plate, stake at its far side).
        slotPoint('firstStake', false, start);
        start.y += PLATE.h + STAKE.h;
        start.z += -PLATE.d / 2 + 0.014;
      }
      stakes = stations.slice(0, 5).map((s, i) => {
        const node = new Object3D();
        node.name = `stake:${s.id}`;
        arcPoint(angles[i], STAKE_R, node.position);
        const stake = part(stakeGeo, 'cobalt', `stake:${s.id}`);
        const collar = part(collarGeo, 'bone', `stake:${s.id}:collar`);
        collar.position.y = STAKE.h * 0.72;
        stake.add(collar);
        node.add(stake);
        const rod = part(rodGeo, 'slate', `rod:${s.id}`);
        arcPoint(angles[i], ROD_R, rod.position);
        root.add(node, rod);
        return { id: s.id, angle: angles[i], stake: node, collar, rod, state: 'pending' as StationState, progress: 0 };
      });
    },
    setStation(id, state, progressValue = 0) {
      const s = stakes.find((x) => x.id === id);
      if (!s) return new Vector3(0, ROD_TOP, -1.3);
      s.state = state;
      s.progress = clamp01(progressValue);
      setMat(s.collar, STATE_KEY[state]);
      return arcPoint(s.angle, ROD_R).setY(ROD_TOP);
    },
    retract() {
      leaving = stakes;
      stakes = [];
      retractAt = now();
    },
    parking(i) {
      return parkingPlace(i);
    },
    spot(stationId, i) {
      const a = path.angle(stationId);
      const row = (i >> 1) & 1;
      const side = i & 1 ? 1 : -1;
      const r = row ? SHELF.rowOuter : SHELF.rowInner;
      const da = ((side * ARC.workSpots.step) / 2 / r) * (180 / Math.PI);
      return arcPoint(a + da, r);
    },
    lane(angleDeg) {
      return arcPoint(angleDeg, SHELF.rowOuter);
    },
    angle(stationId) {
      const s = stakes.find((x) => x.id === stationId);
      if (s) return s.angle;
      const i = stationsNow.findIndex((x) => x.id === stationId);
      const n = Math.min(5, Math.max(3, stationsNow.length)) as 3 | 4 | 5;
      return i >= 0 ? ARC.stations[n][i] : 0;
    },
    stake(stationId) {
      return stakeTop(path.angle(stationId));
    },
    stations() {
      return [...stationsNow];
    },
    update(t) {
      const reduced = lessMotion();
      shelfRoot.position.y = SHELF.y - (reduced ? 0 : 0.03 * (1 - easeOut(progress(t, shownAt, 400))));
      // Rising stakes: 3 cm over the top, then settle in the rest of 180 ms.
      stakes.forEach((s, i) => {
        const at = planAt + i * STAGGER;
        const k = reduced ? (t >= at ? 1 : 0) : progress(t, at, RISE_MS);
        let h: number;
        if (k <= 0) h = 0;
        else if (k < 0.55) h = easeOut(k / 0.55) * (1 + MOTION.stake.settle / STAKE.h);
        else {
          const u = (k - 0.55) / 0.45;
          h = 1 + (MOTION.stake.settle / STAKE.h) * Math.cos(u * Math.PI * 1.5) * (1 - u);
        }
        s.stake.scale.set(1, Math.max(0.001, h), 1);
        s.stake.visible = k > 0;
        s.rod.visible = k > 0;
        s.rod.scale.set(1, Math.max(0.001, easeOut(k)), 1);
      });
      leaving.forEach((s, i) => {
        const k = reduced ? 1 : progress(t, retractAt + (leaving.length - 1 - i) * 80, 260);
        s.stake.scale.set(1, Math.max(0.001, 1 - easeInOut(k)), 1);
        s.rod.scale.set(1, Math.max(0.001, 1 - easeInOut(k)), 1);
        if (k >= 1) {
          s.stake.removeFromParent();
          s.rod.removeFromParent();
        }
      });
      if (leaving.length && leaving.every((s) => !s.stake.parent)) leaving = [];
      // The plan line: first span through the air, then from stake to stake.
      ends.length = 0;
      const list = stakes.length ? stakes : leaving;
      if (list.length) {
        ends.push(start);
        for (const s of list) ends.push(stakeTop(s.angle, s.stake.userData.top ?? (s.stake.userData.top = new Vector3())));
      }
      let count = 0;
      const retracting = !stakes.length && leaving.length > 0;
      const kRetract = retracting ? (reduced ? 1 : progress(t, retractAt, RETRACT_MS)) : 0;
      const total = ends.length - 1;
      for (let i = 0; i < total; i++) {
        const k = reduced ? (t >= planAt ? 1 : 0) : easeOut(progress(t, planAt + i * SPAN_MS, SPAN_MS));
        // Retracting: spans go back right to left.
        const kr = retracting ? clamp01(kRetract * total - (total - 1 - i)) : 0;
        const len = Math.max(0, k - kr);
        if (len <= 0.0001) continue;
        const a = ends[i];
        const b = ends[i + 1];
        dir.subVectors(b, a);
        const full = dir.length();
        dir.normalize();
        // The unit cylinder stands on y = 0: its base at `a`, its length along the span.
        q.setFromUnitVectors(yAxis, dir);
        m4.compose(a, q, s3.set(1, full * len, 1));
        line.setMatrixAt(count, m4);
        count += 1;
      }
      line.count = count;
      line.instanceMatrix.needsUpdate = true;
    },
  };
  animate(path);
  return path;
}
