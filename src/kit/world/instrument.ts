/**
 * Walking instruments (DESIGN "Прибор"): one instrument is one open model call. A bone
 * drum 62 mm across and 30 mm high with a platform 74 mm on top, three conical legs of
 * 80 mm (11 → 7 mm) with feet on a circle of 92 mm, one lens 17 mm in front (ink,
 * roughness 0.2), no face. The cobalt ring of 8 mm on the drum burns exactly while its
 * call is open: it lights on `spawn(role, callId)`, on the way to the station already,
 * and goes out with `setCall(null)` on the answer. The pool says how many burn (`lit()`).
 *
 * Walking: 0.9 m/s fast steps (nine steps of 10 cm a second, body swaying ±3°) and the
 * last 10 cm one leg at a time (five steps of 5 cm a second, ±5° and 4 mm). From the
 * parking to Extract this is under a second, to Reconcile about one and a half. Routes go
 * out to the outer row of the shelf (the lane), along it, and in to the spot; a walker
 * whose lane is blocked by instruments standing on it waits short of them with its ring
 * burning. Less motion: glides without steps and appears by fading in. Low quality: legs
 * stand still and the body glides with its sway.
 *
 * The whole pool draws with six calls: drums, legs, lenses, rings, loads and labels.
 * Positions and pose are a function of the recorded moves and of time.
 */
import {
  BatchedMesh,
  Color,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type World,
} from '@iwsdk/core';
import type { AgentRole } from '../../agents/types';
import { COLOR, MOTION } from '../../tokens/tokens';
import { zone } from '../../app/perf/zone';
import { bevelBox, cylinder, flatRing, lathe, merge, placed, sphere, tint } from './geom';
import { createBatch } from './batch';
import { createLabel, setLabelText } from './label';
import { SHELF, arcPoint, parkingPlace } from './path';
import { animate, clamp01, easeInOut, easeOut, installKit, kitQuality, lessMotion, now, progress, rand, wobble } from './time';
import type { CarryKind, Instrument, InstrumentPool } from './types';

export const INSTRUMENT = {
  drumR: 0.031,
  drumH: 0.03,
  platformR: 0.037,
  platformH: 0.005,
  legLen: 0.08,
  legTop: 0.0055,
  legFoot: 0.0035,
  feetR: 0.046,
  lensR: 0.0085,
  ringH: 0.008,
  hipR: 0.021,
};
const STAND_DRUM_BOTTOM = 0.078;
const FOLD_DRUM_BOTTOM = 0.014;
const SPEED = MOTION.instrument.speed;
const TAIL = MOTION.instrument.stepTail;
const TAIL_SPEED = MOTION.instrument.stepsPerSecond * MOTION.instrument.stepLength;
const UNFOLD_MS = MOTION.instrument.unfoldMs;
const LANE = SHELF.rowOuter;
/** How far along the lane a route cuts the corner, per metre off the lane. */
const CUT = 2.5;

// ---------------------------------------------------------------- routes

export type Leg = { from: Vector3; to: Vector3; t0: number; t1: number; tail: boolean; s0: number };

const azimuth = (p: Vector3): number => (Math.atan2(p.x, -p.z) * 180) / Math.PI;
const radius = (p: Vector3): number => Math.hypot(p.x, p.z);

/** The polyline from a to b along the shelf: out to the lane, along it, in to b. */
export function routePoints(a: Vector3, b: Vector3): Vector3[] {
  const a0 = azimuth(a);
  const a1 = azimuth(b);
  const d0 = Math.abs(LANE - radius(a));
  const d1 = Math.abs(LANE - radius(b));
  const sign = a1 >= a0 ? 1 : -1;
  const arcDeg = Math.abs(a1 - a0);
  const lengthAlong = (arcDeg * Math.PI * LANE) / 180;
  if (lengthAlong < 0.02 || lengthAlong < (d0 + d1) * 0.5) return [a.clone(), b.clone()];
  let b0 = a0 + ((sign * CUT * d0) / LANE) * (180 / Math.PI);
  let b1 = a1 - ((sign * CUT * d1) / LANE) * (180 / Math.PI);
  if ((b1 - b0) * sign < 0) b0 = b1 = (a0 + a1) / 2;
  const pts = [a.clone()];
  const n = Math.max(1, Math.ceil(Math.abs(b1 - b0) / 2));
  for (let i = 0; i <= n; i++) pts.push(arcPoint(b0 + ((b1 - b0) * i) / n, LANE));
  pts.push(b.clone());
  for (const p of pts) p.y = a.y;
  return pts;
}

/** Times a polyline: fast steps, then the last 10 cm one leg at a time. */
export function timeRoute(points: Vector3[], t0: number): { legs: Leg[]; ms: number; length: number } {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += points[i].distanceTo(points[i - 1]);
  const tailFrom = Math.max(0, total - TAIL);
  const legs: Leg[] = [];
  let s = 0;
  let t = t0;
  const pushLeg = (from: Vector3, to: Vector3, tail: boolean): void => {
    const d = from.distanceTo(to);
    if (d < 1e-6) return;
    const ms = (d / (tail ? TAIL_SPEED : SPEED)) * 1000;
    legs.push({ from, to, t0: t, t1: t + ms, tail, s0: s });
    t += ms;
    s += d;
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = a.distanceTo(b);
    if (s + d <= tailFrom || total <= 1e-6) pushLeg(a, b, false);
    else if (s >= tailFrom) pushLeg(a, b, true);
    else {
      const k = (tailFrom - s) / d;
      const m = a.clone().lerp(b, k);
      pushLeg(a, m, false);
      pushLeg(m, b, true);
    }
  }
  return { legs, ms: t - t0, length: total };
}

// ---------------------------------------------------------------- geometry

function drumGeometry(): BufferGeometry {
  const I = INSTRUMENT;
  return merge([
    tint(lathe([[0, 0], [I.drumR - 0.003, 0], [I.drumR, 0.003], [I.drumR, I.drumH - 0.002], [I.drumR - 0.002, I.drumH], [0, I.drumH]], 32), COLOR.bone),
    tint(placed(cylinder(0.009, 0.012, 0.004, 16), [0, I.drumH, 0]), COLOR.boneShade),
    tint(placed(bevelBox(I.platformR * 2, I.platformH, I.platformR * 2, 0.0012, I.platformR), [0, I.drumH + 0.003, 0]), COLOR.bone),
  ]);
}

function loadGeometries(): Record<CarryKind | 'hourglass' | 'band', BufferGeometry> {
  const paper = COLOR.paper;
  const page = merge([0, 1, 2].map((i) => tint(placed(bevelBox(0.062, 0.0012, 0.046, 0.0003, 0.002), [0.0015 * (i - 1), i * 0.0013, 0.001 * i], [0, (i - 1) * 0.04, 0]), i === 2 ? paper : COLOR.edge)));
  const cards = merge(Array.from({ length: 6 }, (_, i) => tint(placed(bevelBox(0.04, 0.0014, 0.03, 0.0003, 0.002), [0.001 * ((i * 7) % 3) - 0.001, i * 0.0016, 0]), i % 2 ? paper : COLOR.edge)));
  const spool = merge([
    tint(placed(cylinder(0.013, 0.013, 0.003, 20), [0, 0, 0], [Math.PI / 2, 0, 0]), COLOR.bone),
    tint(placed(cylinder(0.009, 0.009, 0.018, 16), [0, 0.0, -0.009], [Math.PI / 2, 0, 0]), COLOR.vermilion),
    tint(placed(cylinder(0.013, 0.013, 0.003, 20), [0, 0, -0.018], [Math.PI / 2, 0, 0]), COLOR.bone),
  ]);
  spool.translate(0, 0.013, 0.009);
  const slips = merge([
    tint(placed(bevelBox(0.05, 0.001, 0.034, 0.0003, 0.002), [0, 0, 0], [0, 0.12, 0]), paper),
    tint(placed(bevelBox(0.05, 0.001, 0.034, 0.0003, 0.002), [0.003, 0.0012, 0.002], [0, -0.08, 0]), paper),
    tint(placed(flatRing(0.006, 0.001, 16), [-0.012, 0.0024, 0.002]), COLOR.vermilion),
  ]);
  const pencil = merge([
    tint(placed(cylinder(0.0035, 0.0035, 0.06, 6), [0, 0.0035, 0], [0, 0, Math.PI / 2]), COLOR.bone),
    tint(placed(cylinder(0.0035, 0.0006, 0.012, 6), [-0.03, 0.0035, 0], [0, 0, Math.PI / 2]), COLOR.slate),
  ]);
  pencil.rotateY(0.5);
  const hourglass = merge([
    tint(placed(cylinder(0.009, 0.009, 0.002, 16), [0, 0, 0]), COLOR.slate),
    tint(placed(cylinder(0.0015, 0.008, 0.013, 16), [0, 0.002, 0]), COLOR.amber),
    tint(placed(cylinder(0.008, 0.0015, 0.013, 16), [0, 0.015, 0]), COLOR.amber),
    tint(placed(cylinder(0.009, 0.009, 0.002, 16), [0, 0.028, 0]), COLOR.slate),
  ]);
  const band = tint(bevelBox(0.064, 0.0006, 0.008, 0.0002), COLOR.highlight);
  return { page, cards, spool, slips, pencil, hourglass, band };
}

// ---------------------------------------------------------------- one instrument

type Inst = {
  id: number;
  role: AgentRole;
  callId: string | null;
  home: number;
  legs: Leg[];
  arriveAt: number;
  pos: Vector3;
  heading: number;
  spawnAt: number;
  foldAt: number;
  folded: boolean;
  foldAfterArrive: boolean;
  sitAt: number;
  sitting: boolean;
  workAt: number;
  working: boolean;
  hopAt: number;
  failAt: number;
  failed: boolean;
  carry: CarryKind | null;
  label: string;
  face: Vector3 | null;
  faceAt: number;
  hover: boolean;
  pending: Vector3 | null;
  active: boolean;
  seed: number;
  labelMesh: ReturnType<typeof createLabel>;
  loadNode: Object3D;
};

export function createInstruments(world: World | null, max = 6): InstrumentPool {
  if (world) installKit(world);
  const root = new Object3D();
  root.name = 'kit:instruments';
  zone(root, 'instruments');

  const ceramic = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0, vertexColors: true });
  const lensMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0, vertexColors: true });
  const drums = new InstancedMesh(drumGeometry(), ceramic, max);
  drums.name = 'instruments:drums';
  const legGeo = tint(cylinder(INSTRUMENT.legTop, INSTRUMENT.legFoot, 1, 8), COLOR.bone);
  const legs = new InstancedMesh(legGeo, ceramic, max * 3);
  legs.name = 'instruments:legs';
  const lensGeo = tint(merge([placed(cylinder(INSTRUMENT.lensR, INSTRUMENT.lensR, 0.009, 20), [0, 0, 0], [Math.PI / 2, 0, 0]), placed(sphere(INSTRUMENT.lensR * 0.8, 16, 8), [0, 0, 0.0045], [0, 0, 0], [1, 1, 0.45])]), '#FFFFFF');
  lensGeo.translate(0, INSTRUMENT.drumH * 0.55, INSTRUMENT.drumR + 0.0035);
  const lenses = new InstancedMesh(lensGeo, lensMat, max);
  lenses.name = 'instruments:lenses';
  const ringGeo = tint(cylinder(INSTRUMENT.drumR + 0.0008, INSTRUMENT.drumR + 0.0008, INSTRUMENT.ringH, 32, true), '#FFFFFF');
  ringGeo.translate(0, INSTRUMENT.drumH * 0.5 - INSTRUMENT.ringH / 2 - 0.002, 0);
  const rings = new InstancedMesh(ringGeo, ceramic, max);
  rings.name = 'instruments:rings';
  for (const m of [drums, legs, lenses, rings]) {
    m.frustumCulled = false;
    m.count = 0;
    root.add(m);
  }
  const load = loadGeometries();
  const loads = new BatchedMesh(max * 3, 20000, 40000, ceramic);
  loads.name = 'instruments:loads';
  loads.frustumCulled = false;
  loads.sortObjects = false;
  const loadIds = Object.fromEntries(Object.entries(load).map(([k, g]) => [k, loads.addGeometry(g)])) as Record<keyof typeof load, number>;
  root.add(loads);
  const labelRoot = new Object3D();
  labelRoot.name = 'instruments:labels';
  root.add(labelRoot);
  createBatch(labelRoot);

  const colorBone = new Color(COLOR.bone);
  const colorInk = new Color(COLOR.ink);
  const colorCobalt = new Color(COLOR.cobalt);
  const colorGray = new Color(COLOR.outline);
  const white = new Color(1, 1, 1);

  const insts: Inst[] = [];
  const loadInst: { carry: number; glass: number; band: number }[] = [];
  for (let i = 0; i < max; i++) {
    const carry = loads.addInstance(loadIds.page);
    const glass = loads.addInstance(loadIds.hourglass);
    const band = loads.addInstance(loadIds.band);
    for (const id of [carry, glass, band]) {
      loads.setColorAt(id, white);
      loads.setVisibleAt(id, false);
    }
    loadInst.push({ carry, glass, band });
  }

  const parkingPoint = (i: number): Vector3 => parkingPlace(i);

  const positionAt = (it: Inst, t: number, out: Vector3): { leg: Leg | null; s: number } => {
    if (!it.legs.length || t >= it.arriveAt) {
      out.copy(it.legs.length ? it.legs[it.legs.length - 1].to : it.pos);
      return { leg: null, s: 0 };
    }
    for (const leg of it.legs) {
      if (t < leg.t1) {
        const k = clamp01((t - leg.t0) / (leg.t1 - leg.t0));
        out.lerpVectors(leg.from, leg.to, k);
        return { leg, s: leg.s0 + leg.from.distanceTo(leg.to) * k };
      }
    }
    out.copy(it.legs[it.legs.length - 1].to);
    return { leg: null, s: 0 };
  };

  const standingOnLane = (it: Inst, t: number): number | null => {
    if (!it.active || it.folded) return null;
    const p = new Vector3();
    positionAt(it, t, p);
    if (t < it.arriveAt) return null;
    return Math.abs(radius(p) - LANE) < 0.035 ? azimuth(p) : null;
  };

  const plan = (it: Inst, target: Vector3, t: number): number => {
    const from = new Vector3();
    positionAt(it, t, from);
    // A walker passing instruments that stand on the lane waits short of them.
    const a0 = azimuth(from);
    const a1 = azimuth(target);
    let stop: number | null = null;
    for (const other of insts) {
      if (other === it) continue;
      const a = standingOnLane(other, t);
      if (a === null) continue;
      const between = a1 > a0 ? a > a0 + 1.5 && a < a1 - 4.5 : a < a0 - 1.5 && a > a1 + 4.5;
      if (between) {
        const back = a1 > a0 ? a - 7.5 : a + 7.5;
        if (stop === null || (a1 > a0 ? back < stop : back > stop)) stop = back;
      }
    }
    let goal = target;
    it.pending = null;
    if (stop !== null) {
      goal = arcPoint(stop, LANE);
      it.pending = target.clone();
    }
    const route = timeRoute(routePoints(from, goal), t);
    it.legs = route.legs;
    it.arriveAt = t + route.ms;
    it.pos.copy(goal);
    return route.ms;
  };

  const handle = (it: Inst): Instrument => ({
    get id() {
      return it.id;
    },
    get role() {
      return it.role;
    },
    get callId() {
      return it.callId;
    },
    get state() {
      const t = now();
      if (it.folded) return 'folded';
      if (it.failed) return 'failed';
      if (it.pending) return 'waiting';
      if (t < it.arriveAt) return 'moving';
      if (it.sitting) return 'sitting';
      if (it.working) return 'working';
      return 'standing';
    },
    moveTo(point) {
      // It sets off at once: the legs straighten during the first steps out of the parking.
      it.foldAfterArrive = false;
      return plan(it, point.clone().setY(SHELF.y), now());
    },
    carry(kind, label) {
      it.carry = kind;
      it.label = label ?? '';
      setLabelText(it.labelMesh, it.label || ' ');
    },
    work(on) {
      it.working = on;
      it.workAt = now();
    },
    sit(on) {
      it.sitting = on;
      it.sitAt = now();
    },
    hop() {
      it.hopAt = now();
    },
    fail() {
      it.failed = true;
      it.failAt = now();
    },
    fold() {
      const t = now();
      it.callId = null;
      it.working = false;
      it.sitting = false;
      it.carry = null;
      plan(it, parkingPoint(it.home), t);
      it.foldAfterArrive = true;
    },
    setCall(callId) {
      it.callId = callId;
    },
    face(point) {
      it.face = point ? point.clone() : null;
      it.faceAt = now();
    },
    hover(on) {
      it.hover = on;
      it.faceAt = now();
    },
    position(target = new Vector3()) {
      positionAt(it, now(), target);
      return target;
    },
  });

  const handles: Instrument[] = [];
  for (let i = 0; i < max; i++) {
    const labelMesh = createLabel(' ', { role: 'label', width: 0.05, eyeDist: 1.3, lines: 1, align: 'center' });
    labelMesh.rotation.x = -Math.PI / 2;
    const loadNode = new Object3D();
    loadNode.add(labelMesh);
    labelMesh.position.set(0, 0.0045, 0.004);
    labelMesh.visible = false;
    labelRoot.add(loadNode);
    const it: Inst = {
      id: i,
      role: 'extractor',
      callId: null,
      home: i,
      legs: [],
      arriveAt: -Infinity,
      pos: parkingPoint(i),
      heading: 0,
      spawnAt: -Infinity,
      foldAt: -1e9,
      folded: true,
      foldAfterArrive: false,
      sitAt: -Infinity,
      sitting: false,
      workAt: -Infinity,
      working: false,
      hopAt: -Infinity,
      failAt: -Infinity,
      failed: false,
      carry: null,
      label: '',
      face: null,
      faceAt: -Infinity,
      hover: false,
      pending: null,
      active: false,
      seed: 17 + i * 31,
      labelMesh,
      loadNode,
    };
    insts.push(it);
    handles.push(handle(it));
  }

  const pool: InstrumentPool = {
    root,
    spawn(role, callId) {
      const t = now();
      // A parked one first (nearest parking place first), else the one used longest ago.
      let it = insts.find((x) => !x.active);
      if (!it) it = [...insts].filter((x) => !x.callId).sort((a, b) => a.spawnAt - b.spawnAt)[0] ?? insts[0];
      const home = it.home;
      it.role = role;
      it.callId = callId ?? null;
      it.active = true;
      it.folded = false;
      it.failed = false;
      it.working = false;
      it.sitting = false;
      it.carry = null;
      it.face = null;
      it.pending = null;
      it.foldAfterArrive = false;
      it.legs = [];
      it.pos.copy(parkingPoint(home));
      it.arriveAt = t;
      it.spawnAt = t;
      it.heading = 0;
      it.seed = 17 + home * 31 + Math.floor(rand(t) * 1000);
      return handles[it.id];
    },
    byCall(callId) {
      const it = insts.find((x) => x.active && x.callId === callId);
      return it ? handles[it.id] : null;
    },
    all() {
      return insts.filter((x) => x.active).map((x) => handles[x.id]);
    },
    lit() {
      return insts.filter((x) => x.active && !x.folded && x.callId && !x.failed).length;
    },
    update(t) {
      const reduced = lessMotion();
      const still = kitQuality() === 'low';
      let n = 0;
      let nl = 0;
      for (const it of insts) {
        const li = loadInst[it.id];
        // Waiting walkers try again.
        if (it.pending && t >= it.arriveAt) {
          const target = it.pending;
          plan(it, target, t);
        }
        if (it.foldAfterArrive && t >= it.arriveAt) {
          it.foldAfterArrive = false;
          it.folded = true;
          it.foldAt = it.arriveAt;
          it.active = false;
        }
        if (!it.active && !it.folded) {
          loads.setVisibleAt(li.carry, false);
          loads.setVisibleAt(li.glass, false);
          loads.setVisibleAt(li.band, false);
          it.loadNode.visible = false;
          continue;
        }
        const { leg, s } = positionAt(it, t, pos);
        const moving = leg !== null;
        // Heading: along the way while moving; turning to what it works with when standing.
        if (moving) {
          dir.subVectors(leg.to, leg.from);
          it.heading = Math.atan2(dir.x, dir.z);
        }
        let yaw = it.heading;
        if (!moving) {
          let want: number | null = null;
          if (it.hover) want = Math.atan2(-pos.x, -pos.z);
          else if (it.face) want = Math.atan2(it.face.x - pos.x, it.face.z - pos.z);
          if (want !== null) {
            const k = reduced ? 1 : easeInOut(progress(t, Math.max(it.faceAt, it.arriveAt), 260));
            let d = want - it.heading;
            while (d > Math.PI) d -= 2 * Math.PI;
            while (d < -Math.PI) d += 2 * Math.PI;
            yaw = it.heading + d * k;
          }
        }
        // Folding and unfolding: 300 ms; sitting folds the legs the same way.
        let open = 1;
        if (it.folded) open = 1 - (reduced ? 1 : progress(t, it.foldAt, UNFOLD_MS));
        else open = reduced ? 1 : progress(t, it.spawnAt, UNFOLD_MS);
        if (it.sitting) open = Math.min(open, 1 - (reduced ? 1 : progress(t, it.sitAt, UNFOLD_MS)));
        else if (it.sitAt > -Infinity && !it.folded) open = Math.min(open, reduced ? 1 : progress(t, it.sitAt, UNFOLD_MS));
        open = easeInOut(open);
        // Gait.
        const tail = leg?.tail ?? false;
        const stepLen = tail ? MOTION.instrument.stepLength : 0.1;
        const steps = s / stepLen;
        const gaitOn = moving && !reduced && !still;
        const swayDeg = gaitOn ? (tail ? 5 : 3) * Math.sin(Math.PI * steps) : still && moving ? 2 * Math.sin(t / 90) : 0;
        const bob = gaitOn ? (tail ? 0.004 : 0.002) * Math.abs(Math.sin(Math.PI * steps)) : 0;
        const idle = moving || it.folded ? 0 : 1;
        const hop = reduced ? 0 : 0.03 * Math.sin(Math.PI * clamp01((t - it.hopAt) / 260)) * (t >= it.hopAt && t < it.hopAt + 260 ? 1 : 0);
        const lean = it.working && !moving ? (reduced ? 0.2 : 0.2 * easeOut(progress(t, it.workAt, 300))) : 0;
        const failTilt = it.failed ? 0.12 * easeOut(progress(t, it.failAt, 300)) : 0;
        const drumBottom = FOLD_DRUM_BOTTOM + (STAND_DRUM_BOTTOM - FOLD_DRUM_BOTTOM) * open;
        const fade = reduced && it.active ? clamp01((t - it.spawnAt) / 200) : 1;
        body.position.set(pos.x, SHELF.y + drumBottom + bob + hop, pos.z);
        euler.set(lean + failTilt, yaw, (swayDeg * Math.PI) / 180 + 0.012 * idle * wobble(it.seed, t, 2600), 'YXZ');
        body.quaternion.setFromEuler(euler);
        body.scale.setScalar(fade);
        body.updateMatrix();
        drums.setMatrixAt(n, body.matrix);
        drums.setColorAt(n, colorBone);
        rings.setMatrixAt(n, body.matrix);
        const lit = Boolean(it.callId) && !it.folded;
        rings.setColorAt(n, it.failed ? colorGray : lit ? colorCobalt : colorBone);
        lenses.setMatrixAt(n, body.matrix);
        lenses.setColorAt(n, open < 0.5 ? colorBone : colorInk);
        // Legs: hips under the drum, feet on the shelf; one leg swings at a time.
        for (let k = 0; k < 3; k++) {
          const a = yaw + (k * 2 * Math.PI) / 3 + Math.PI / 3;
          hip.set(Math.sin(a) * INSTRUMENT.hipR * 0.9, 0, Math.cos(a) * INSTRUMENT.hipR * 0.9).applyQuaternion(body.quaternion).add(body.position);
          const footR = 0.016 + (INSTRUMENT.feetR - 0.016) * open;
          foot.set(pos.x + Math.sin(a) * footR, SHELF.y + hop * 0.6, pos.z + Math.cos(a) * footR);
          if (gaitOn) {
            const c = (((steps - k) / 3) % 1 + 1) % 1;
            const stride = tail ? 0.03 : 0.035;
            let off: number;
            let lift = 0;
            if (c < 1 / 3) {
              const u = c * 3;
              off = stride * (u - 0.5);
              lift = (tail ? 0.01 : 0.012) * Math.sin(Math.PI * u);
            } else off = stride * (0.5 - (c - 1 / 3) * 1.5);
            foot.x += Math.sin(it.heading) * off;
            foot.z += Math.cos(it.heading) * off;
            foot.y += lift;
          }
          dir.subVectors(hip, foot);
          const length = dir.length();
          q.setFromUnitVectors(up, dir.normalize());
          m4.compose(foot, q, s3.set(1, length, 1));
          legs.setMatrixAt(nl, m4);
          nl += 1;
        }
        // The load on the platform, the hourglass above a sitting one, the band of work.
        const top = INSTRUMENT.drumH + 0.008;
        if (it.carry) {
          loads.setGeometryIdAt(li.carry, loadIds[it.carry]);
          // The load turns with the body, but its writing reads from the seat.
          loadQ.setFromAxisAngle(up, Math.atan2(-pos.x, -pos.z) - yaw);
          m4.compose(v0.set(0, top, 0.002), loadQ, one);
          if (it.failed) m4.makeTranslation(0.045, -drumBottom + 0.001, 0.01);
          m4.premultiply(body.matrix);
          loads.setMatrixAt(li.carry, m4);
          loads.setVisibleAt(li.carry, true);
          it.loadNode.matrixAutoUpdate = false;
          it.loadNode.matrix.copy(m4);
          it.loadNode.visible = it.carry === 'page' && it.label.trim().length > 0;
          it.labelMesh.visible = it.loadNode.visible;
        } else {
          loads.setVisibleAt(li.carry, false);
          it.loadNode.visible = false;
        }
        if (it.sitting) {
          m4.makeTranslation(0, top + 0.04, 0);
          m4.premultiply(body.matrix);
          loads.setMatrixAt(li.glass, m4);
          loads.setVisibleAt(li.glass, true);
        } else loads.setVisibleAt(li.glass, false);
        if (it.working && it.carry && !moving) {
          const sweep = reduced ? 0.5 : ((t - it.workAt) % 900) / 900;
          m4.makeTranslation(0, top + 0.006, -0.02 + 0.04 * sweep);
          m4.premultiply(body.matrix);
          loads.setMatrixAt(li.band, m4);
          loads.setVisibleAt(li.band, true);
        } else loads.setVisibleAt(li.band, false);
        n += 1;
      }
      drums.count = rings.count = lenses.count = n;
      legs.count = nl;
      for (const m of [drums, rings, lenses, legs]) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
      labelRoot.updateMatrixWorld(true);
    },
  };
  animate(pool);
  return pool;
}

const pos = new Vector3();
const dir = new Vector3();
const hip = new Vector3();
const foot = new Vector3();
const up = new Vector3(0, 1, 0);
const q = new Quaternion();
const m4 = new Matrix4();
const s3 = new Vector3();
const euler = new Euler();
const body = new Object3D();
const loadQ = new Quaternion();
const v0 = new Vector3();
const one = new Vector3(1, 1, 1);
