/**
 * World module: the island in the sea of clouds, the sky and the time of day, houses built
 * from modular pieces, paths, props, and the islands on the horizon.
 *
 *   const world = createWorld(app);      // app: anything with scene (+ camera, renderer)
 *   await world.ready;                   // kit loaded, island built
 *   world.setTime(new Date());
 *   const spot = world.validSpot({ x, z });
 *   const steps = world.buildPlan(spec); // the flock carries steps[i].object3d to steps[i].target
 *
 * The person sits at the origin facing −z (world.seat). The world ticks itself from the
 * render loop; call world.update() yourself only when rendering without the sky dome.
 */
import {
  Color,
  FogExp2,
  type BufferGeometry,
  Group,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from '@iwsdk/core';
import type { HouseSpec, P2 } from '../mind/types';
import { Batch } from './batch';
import { CATALOG, resolveProp } from './catalog';
import { createClouds, FOG_DENSITY, SEA_Y } from './clouds';
import { createCritters, type Critters } from './critters';
import { skyAt, type SkyState } from './daylight';
import { createMeadow } from './grass';
import { createHorizon, type HorizonIsland } from './horizon';
import { createIsland } from './island';
import { kitGeometry, loadKit } from './kit';
import { CENTER, HILL, HOUSE_R, LOTS, Land, PIER, POND, SEAT, faceSeat } from './land';
import { mainMaterial, U } from './materials';
import { M, MAT, build, cbox, cyl, place } from './geo';
import { pathGeometry, routePath } from './paths';
import { buildProp } from './props';
import { planHouse, type HousePlan, type Stage } from './recipes';
import { createBlobs } from './shadows';
import { createSky } from './sky';
import { createSigns } from './signs';
import { wind } from './wind';
import { createEvents, firePitGeometry, type WeatherKind } from './events';
import { ViewCone } from './cull';
import { setAmbienceState } from './ambience';

export { CATALOG, GIFT_PROPS, propsForTrade, resolveProp } from './catalog';
export { wind, WIND_GLSL, createWindSound } from './wind';
export { createAmbience, type Ambience } from './ambience';
export type { WeatherKind } from './events';
export type { Stage } from './recipes';

/** What createWorld needs from the app: an IWSDK World fits. */
export interface WorldHost {
  scene?: Object3D;
  camera?: Camera;
  renderer?: WebGLRenderer;
}

export interface BuildStep {
  /** A hidden child of world.root, already at its target. Show it and fly it in. */
  object3d: Object3D;
  /** Where it ends, in world.root space. */
  target: { pos: Vector3; quat: Quaternion; scale: Vector3 };
  stage: Stage;
  name: string;
  houseId: string;
}

export interface Anchor {
  /** Ground point in world.root space. */
  pos: Vector3;
  /** Facing (rotation about y; 0 faces −z for the seat, along the pier outward for the pier). */
  rotY: number;
}

export interface SeatAnchor extends Anchor {
  /** Where a resident stands to talk to the person (about 1.9 m in front). */
  meet: Vector3;
  /** A perch near the seat for Pip (top of the lamp post). */
  perch: Vector3;
}

export interface PierAnchor extends Anchor {
  /** Where a vehicle hangs while a traveler steps off (beside the landing, 1.2 m up). */
  dock: Vector3;
  /** Where the traveler stands after stepping off. */
  step: Vector3;
  /** Walking line from the landing to the meeting spot in front of the seat. */
  walk: Vector3[];
}

export interface Spot {
  id: string;
  name: string;
  pos: Vector3;
  rotY: number;
}

export interface HouseInfo {
  id: string;
  spec: HouseSpec;
  /** Door step, window, sign, top (chimney or roof), in world.root space. */
  door: Vector3;
  window: Vector3;
  top: Vector3;
  radius: number;
  built: boolean;
}

export interface World {
  root: Object3D;
  ready: Promise<void>;
  seat: SeatAnchor;
  pier: PierAnchor;
  /** The ground mesh (raycast it for pinch-to-place). */
  ground: Mesh;
  /** Sets sky, light, clouds and window glow from a clock time. */
  setTime(date: Date): void;
  readonly sky: SkyState;
  /** Nearest free spot for a house around p, turned to face the seat. */
  validSpot(p: P2 | Vector3): { ok: boolean; snapped: Vector3; rotY: number; reason?: string };
  /** A good free spot when the person has not chosen one. */
  suggestSpot(): { ok: boolean; snapped: Vector3; rotY: number };
  /** Pieces of a house in assembly order, hidden in place, for the flock to carry in. */
  buildPlan(spec: HouseSpec): BuildStep[];
  /** Marks a planned house finished (merges its pieces). Called automatically once every piece rests at its target. */
  finishHouse(id: string): void;
  /** Places a finished house at once (loading a saved island). */
  addHouse(spec: HouseSpec): HouseInfo;
  removeHouse(id: string): void;
  house(id: string): HouseInfo | undefined;
  /** Lays a winding path between two places (house ids, 'seat', 'pier' or points); returns its walking line. */
  addPath(a: string | P2, b: string | P2): Vector3[];
  /** Walking line of an existing path, either direction. */
  path(a: string, b: string): Vector3[] | undefined;
  /** Puts a catalog prop (id or plain word like 'lantern') on the ground. Returns its object, live until it settles. */
  addProp(kind: string, pos: P2 | Vector3, opts?: { id?: string; rotY?: number; scale?: number }): Object3D | null;
  removeProp(id: string): void;
  /** Names the islands on the horizon (public and friends'). */
  setHorizon(islands: { id: string; name: string }[]): void;
  horizon(id: string): HorizonIsland | undefined;
  /** Places the person can glide to. */
  spots(): Spot[];
  /** A walking line from a to b along the paths where they help, round houses and the pond otherwise. */
  route(a: P2, b: P2): P2[];
  /** Places a bird can sit: tree tops, roofs and chimneys, posts, lamps. */
  perches(): { pos: Vector3; kind: 'tree' | 'roof' | 'post' | 'lamp' }[];
  /** Benches someone can sit on (the porch bench first). */
  benches(): Anchor[];
  /** Height of the cloud sea (top of the far cloud layer). */
  readonly cloudY: number;
  /** Adds the next islet with a bridge; false when the island cannot grow further. */
  grow(): boolean;
  readonly growth: number;
  groundY(x: number, z: number): number;
  /** Rain and clear skies: rain streaks, rings on the pond, darker light, a rainbow after. */
  weather: { set(kind: WeatherKind): void; readonly kind: WeatherKind };
  /** Sends a big soft cloud whale gliding past the island (about 75 s); resolves when gone. */
  skyWhale(): Promise<void>;
  /**
   * A shooting star at night that lands glowing within reach of the seat. Resolves when it
   * lands: `star` is the glowing object (reparent it to a hand to carry it), `release()`
   * removes it.
   */
  shootingStar(): Promise<{ pos: Vector3; star: Object3D; release(): void }>;
  /** Music pulse 0..1 (and hue 0..1): windows, lanterns, flowers and fireflies glow in time. */
  setPulse(level: number, hue?: number): void;
  /** Lights or puts out the campfire by the log benches in front of the porch. */
  campfire(on: boolean): void;
  /** Where the campfire burns (ground point, world.root space). */
  readonly fire: Vector3;
  /** Per-frame tick (runs on its own from the sky's render callback). */
  update(timeMs?: number): void;
  stats(): { triangles: number; houses: number; props: number; parts: Record<string, number> };
  dispose(): void;
}

interface HouseRec {
  spec: HouseSpec;
  plan: HousePlan;
  matrix: Matrix4;
  quat: Quaternion;
  pieces: Mesh[];
  group: Group;
  built: boolean;
  still: number;
  /** Small pieces in world.root space, shown while the viewer is near. */
  fine: BufferGeometry[];
}

interface PropRec {
  id: string;
  kind: string;
  mesh: Mesh;
  settled: boolean;
  still: number;
  last: Matrix4;
}

const v3 = (p: P2, y = 0): Vector3 => new Vector3(p.x, y, p.z);

/** Log benches round the fire pit: one across the fire facing the seat, one at its side. */
const fireBenches: Anchor[] = [
  { pos: new Vector3(-2.75, 0, -5.05), rotY: Math.atan2(2.75, 5.05) },
  { pos: new Vector3(-4.0, 0, -3.3), rotY: Math.atan2(1.5, -0.4) },
];

/** A split log on two stumps, about 1.3 m long. */
function logBench(): BufferGeometry {
  return build([
    [place(cyl(0.16, 0.16, 1.3, 9), [-0.65, 0.36, 0], [0, 0, -Math.PI / 2], [1, 1, 0.75]), MAT.wood, { mat: M.bark }],
    [place(cbox(1.2, 0.04, 0.26, 0.01), [0, 0.47, 0]), MAT.woodLight],
    [place(cyl(0.13, 0.15, 0.3, 8), [-0.45, 0, 0]), MAT.woodDark, { mat: M.bark }],
    [place(cyl(0.13, 0.15, 0.3, 8), [0.45, 0, 0]), MAT.woodDark, { mat: M.bark }],
  ]);
}

/** Houses nearer than this (metres from the viewer) show their props and small details. */
const FINE_R = 13;
const FINE_MAX = 4;
/** Houses further than this from the viewer are drawn simplified (vertex clusters of HOUSE_CELL metres). */
const HOUSE_NEAR = 15;
const HOUSE_CELL = 0.06;

export function createWorld(app: WorldHost = {}, opts: { kitUrl?: string; now?: () => number } = {}): World {
  const clock = opts.now ?? ((): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const root = new Group();
  root.name = 'world';
  app.scene?.add(root);
  const land = new Land();
  const mat = mainMaterial();
  const staticBatch = new Batch('world:static', mat);
  const decorBatch = new Batch('world:decor', mat);
  const houseBatch = new Batch('world:houses', mat);
  // small house pieces (props, lamps, yard life) only for houses near the viewer
  const fineBatch = new Batch('world:house-detail', mat);
  const propBatch = new Batch('world:props', mat);
  const pathBatch = new Batch('world:paths', mat);
  const horizonBatch = new Batch('world:horizon', mat);
  const batches = [staticBatch, decorBatch, houseBatch, fineBatch, propBatch, pathBatch, horizonBatch];
  for (const b of batches) root.add(b.mesh);

  const skyRig = createSky(root);
  const clouds = createClouds(root);
  const blobs = createBlobs(root, land);
  const signs = createSigns(root);
  const horizon = createHorizon(horizonBatch);
  let meadow: ReturnType<typeof createMeadow> | null = null;
  let critters: Critters | null = null;
  let island: ReturnType<typeof createIsland> | null = null;

  const houses = new Map<string, HouseRec>();
  const props = new Map<string, PropRec>();
  const paths = new Map<string, Vector3[]>();
  let shadowList: [number, number, number, number][] = [];
  let lightList: [number, number, number][] = [];
  let propSeq = 0;
  let sky = skyAt(new Date());

  // the person's camera may need to see the far clouds and islands
  const cam = app.camera as PerspectiveCamera | undefined;
  if (cam && 'far' in cam && cam.far < 1600) {
    cam.far = 1600;
    cam.updateProjectionMatrix?.();
  }
  const FIRE = new Vector3(-2.5, 0, -3.7);
  const events = createEvents(root, { firePos: FIRE, cloudMaterial: () => clouds.solid() });
  let rainShown = 0;
  const scene = app.scene as Scene | undefined;
  if (scene && 'fog' in scene) scene.fog = new FogExp2(new Color(sky.fog), FOG_DENSITY);

  const seatY = 0.16;
  const seat: SeatAnchor = {
    pos: new Vector3(SEAT.x, seatY, SEAT.z),
    rotY: 0,
    meet: new Vector3(-0.3, 0.16, -1.9),
    perch: new Vector3(-1.6, 2.12, 0.55),
  };
  const side = { x: PIER.dir.z, z: -PIER.dir.x };
  const landingEnd = PIER.length + 0.1 + 9 * 0.33;
  const pierEnd = { x: PIER.base.x + PIER.dir.x * landingEnd, z: PIER.base.z + PIER.dir.z * landingEnd };
  const pier: PierAnchor = {
    pos: v3(pierEnd, 0.12),
    rotY: Math.atan2(PIER.dir.x, PIER.dir.z),
    dock: new Vector3(pierEnd.x + PIER.dir.x * 1.4, 1.2, pierEnd.z + PIER.dir.z * 1.4),
    step: new Vector3(pierEnd.x - PIER.dir.x * 0.8, 0.12, pierEnd.z - PIER.dir.z * 0.8),
    walk: [],
  };
  void side;

  const refreshShadows = (): void => {
    const list: [number, number, number, number][] = [...shadowList];
    for (const h of houses.values()) {
      const p = h.spec.pos;
      list.push([p.x, p.z, h.plan.radius * 1.05, 0.7]);
    }
    for (const p of props.values()) {
      const item = CATALOG[p.kind];
      list.push([p.mesh.position.x, p.mesh.position.z, Math.max(0.3, (item?.footprint ?? 0.4) * 1.3), 0.5]);
    }
    blobs.setShadows(list);
    const lights: [number, number, number][] = [...lightList];
    for (const h of houses.values()) if (h.built) {
      const d = new Vector3(...h.plan.door).applyMatrix4(h.matrix);
      lights.push([d.x, d.z, 1.6]);
    }
    for (const p of props.values()) if (CATALOG[p.kind]?.glow) lights.push([p.mesh.position.x, p.mesh.position.z, 1.4]);
    blobs.setLights(lights);
    const tops: Vector3[] = [];
    for (const h of houses.values()) if (h.built && h.plan.smoke) tops.push(new Vector3(...h.plan.top).applyMatrix4(h.matrix));
    critters?.setSmoke(tops);
    // built houses hide the plants behind them from the seat
    const walls: { x: number; z: number; r: number; h: number }[] = [];
    for (const h of houses.values()) {
      if (!h.built) continue;
      const base = land.height(h.spec.pos.x, h.spec.pos.z);
      const top = new Vector3(...h.plan.top).applyMatrix4(h.matrix).y;
      walls.push({ x: h.spec.pos.x, z: h.spec.pos.z, r: h.plan.radius * 0.62, h: base + (top - base) * 0.55 });
    }
    meadow?.setOccluders(walls);
  };

  const groundY = (x: number, z: number): number => land.height(x, z);
  // level of detail follows the viewer (in world.root space)
  const lodEye = new Vector3(SEAT.x, 1.2, SEAT.z);
  const lastLodEye = new Vector3(1e9, 0, 0);
  let lodDirty = true;

  const ready = (async () => {
    try {
      await loadKit(opts.kitUrl);
    } catch (err) {
      console.warn('[world] kit did not load, using simple shapes', err);
    }
    island = createIsland(root, land, staticBatch, decorBatch);
    shadowList = island.shadows;
    lightList = island.lights;
    island.refreshGround();
    FIRE.y = land.height(FIRE.x, FIRE.z);
    staticBatch.add('firepit', place(firePitGeometry(), [FIRE.x, FIRE.y, FIRE.z]));
    for (const b of fireBenches) {
      const y = land.height(b.pos.x, b.pos.z);
      b.pos.y = y;
      staticBatch.add(`firepit:bench:${b.rotY.toFixed(2)}`, place(logBench(), [b.pos.x, y, b.pos.z], [0, b.rotY, 0]));
    }
    land.obstacles.push({ x: FIRE.x, z: FIRE.z, r: 1.7, id: 'firepit' });
    shadowList.push([FIRE.x, FIRE.z, 0.9, 0.35]);
    lightList.push([FIRE.x, FIRE.z, 0.01]);
    meadow = createMeadow(root, land);
    meadow.clear(FIRE.x, FIRE.z, 0.75);
    for (const b of fireBenches) meadow.clear(b.pos.x, b.pos.z, 0.55);
    critters = createCritters(root, land);
    clouds.addDrifters(kitGeometry('cloud-big', 1));
    const start = { x: 0.6, z: -1.7 };
    pier.walk = layPath(start, { x: PIER.base.x - PIER.dir.x * 0.6, z: PIER.base.z - PIER.dir.z * 0.6 }, 'seat|pier', true).reverse();
    pier.walk.unshift(pier.step.clone());
    pier.walk.push(seat.meet.clone());
    // trees, bushes and rocks get simpler far versions
    for (const key of staticBatch.keys()) if (key.startsWith('tree:')) staticBatch.lod(key, 0.3, 16);
    staticBatch.lod('mushrooms', 0.05, 12);
    for (const key of decorBatch.keys()) decorBatch.lod(key, key.includes('tree') ? 0.3 : key.startsWith('bush') ? 0.2 : 0.12, 11);
    lodDirty = true;
    refreshShadows();
    applySky();
    flush();
  })();

  function flush(): void {
    for (const b of batches) b.flush();
  }

  /** The sky as it looks now: the clock's sky, greyed and dimmed while it rains. */
  function shownSky(): SkyState {
    const k = events.rain * 0.8;
    rainShown = events.rain;
    if (k < 0.005) return sky;
    const n = 1 - sky.night * 0.75;
    const grey = (c: Color, hex: string): Color => c.clone().lerp(new Color(hex).multiplyScalar(n), k);
    return {
      ...sky,
      zenith: grey(sky.zenith, '#6d7c8a'),
      mid: grey(sky.mid, '#8c98a2'),
      horizon: grey(sky.horizon, '#a3acb3'),
      fog: grey(sky.fog, '#98a3aa'),
      sun: grey(sky.sun, '#c9d0d6'),
      sunI: sky.sunI * (1 - 0.6 * k),
      hemiI: sky.hemiI * (1 - 0.15 * k),
      hemiSky: grey(sky.hemiSky, '#a9b4bd'),
      cloudLit: grey(sky.cloudLit, '#c3cad0'),
      cloudShade: grey(sky.cloudShade, '#6c7782'),
      cloudUnder: grey(sky.cloudUnder, '#8a949d'),
      water: grey(sky.water, '#5b7280'),
      glow: Math.min(1, sky.glow + k * 0.5),
    };
  }

  function applySky(): void {
    const sky = shownSky();
    skyRig.apply(sky);
    clouds.apply(sky);
    U.glow.value = sky.glow;
    U.rim.value.copy(sky.sun).multiplyScalar(sky.night > 0.5 ? 0.35 : 0.9);
    if (island) {
      const wm = island.water.material as unknown as { uniforms: Record<string, { value: Color & Vector3 }> };
      wm.uniforms.uWater.value.copy(sky.water);
      wm.uniforms.uSkyLow.value.copy(sky.horizon);
      wm.uniforms.uSkyHigh.value.copy(sky.zenith);
      wm.uniforms.uSun.value.copy(sky.sun).multiplyScalar(1 - sky.night);
      wm.uniforms.uSunDir.value.copy(sky.sunDir);
    }
    if (scene && scene.fog instanceof FogExp2) scene.fog.color.copy(sky.fog);
    blobs.setNight(Math.min(1, sky.glow + U.pulse.value * 0.5), U.glowColor.value);
    critters?.setDaylight(sky.night, sky.glow);
    setAmbienceState({ night: sky.night, rain: events.rain });
  }

  // ---------- houses ----------

  function resolvePlace(p: string | P2): P2 | null {
    if (typeof p !== 'string') return p;
    if (p === 'seat') return { x: 0.6, z: -1.7 };
    if (p === 'pier') return { x: PIER.base.x - PIER.dir.x * 0.6, z: PIER.base.z - PIER.dir.z * 0.6 };
    const h = houses.get(p);
    if (!h) return null;
    const d = new Vector3(...h.plan.door).applyMatrix4(h.matrix);
    return { x: d.x, z: d.z };
  }

  function clearAround(x: number, z: number, r: number): void {
    if (!island) return;
    let changed = false;
    for (let i = island.decor.length - 1; i >= 0; i--) {
      const d = island.decor[i];
      if (Math.hypot(d.x - x, d.z - z) < r + d.r * 0.5) {
        decorBatch.remove(d.key);
        decorBatch.remove(`${d.key}:b`);
        island.decor.splice(i, 1);
        land.obstacles = land.obstacles.filter((o) => o.id !== d.key);
        shadowList = shadowList.filter((s) => Math.hypot(s[0] - d.x, s[1] - d.z) > 0.01);
        changed = true;
      }
    }
    if (changed) island.shadows.splice(0, island.shadows.length, ...shadowList);
  }

  function planFor(spec: HouseSpec): HouseRec {
    const existing = houses.get(spec.id);
    if (existing) removeHouseNow(spec.id);
    const plan = planHouse(spec);
    const y = land.height(spec.pos.x, spec.pos.z);
    land.pads.push({ x: spec.pos.x, z: spec.pos.z, r: plan.radius * 0.85, h: y, id: spec.id });
    const quat = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spec.rotY);
    const matrix = new Matrix4().compose(new Vector3(spec.pos.x, y, spec.pos.z), quat, new Vector3(1, 1, 1));
    const group = new Group();
    group.name = `house:${spec.id}`;
    root.add(group);
    const pieces: Mesh[] = [];
    for (const piece of plan.pieces) {
      const mesh = new Mesh(piece.geo, mat);
      mesh.name = `${spec.id}:${piece.name}`;
      mesh.position.set(...piece.pos).applyMatrix4(matrix);
      mesh.quaternion.copy(quat);
      mesh.visible = false;
      mesh.userData.stage = piece.stage;
      group.add(mesh);
      pieces.push(mesh);
    }
    const rec: HouseRec = { spec, plan, matrix, quat, pieces, group, built: false, still: 0, fine: [] };
    houses.set(spec.id, rec);
    clearAround(spec.pos.x, spec.pos.z, plan.radius + 0.3);
    meadow?.clear(spec.pos.x, spec.pos.z, plan.radius + 0.2);
    island?.refreshGround();
    meadow?.refresh();
    refreshShadows();
    return rec;
  }

  function settle(rec: HouseRec): void {
    if (rec.built) return;
    rec.built = true;
    const m = new Matrix4();
    rec.pieces.forEach((mesh, i) => {
      mesh.updateMatrix();
      const piece = rec.plan.pieces[i];
      if (isFine(piece)) rec.fine.push(mesh.geometry.clone().applyMatrix4(m.copy(mesh.matrix)));
      else houseBatch.add(rec.spec.id, mesh.geometry, m.copy(mesh.matrix));
    });
    // far away the house melts its small shapes (trims, knobs, shingles) into the walls
    houseBatch.lod(rec.spec.id, HOUSE_CELL, HOUSE_NEAR);
    lodDirty = true;
    applyLod();
    root.remove(rec.group);
    rec.pieces = [];
    if (rec.spec.sign) {
      const s = rec.plan.sign;
      const sm = new Matrix4().compose(new Vector3(s.pos[0], s.pos[1], s.pos[2] + 0.035), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), s.rotY), new Vector3(1, 1, 1));
      sm.premultiply(rec.matrix);
      signs.set(rec.spec.id, rec.spec.sign, sm, s.w * 0.92, s.h * 0.85);
    }
    refreshShadows();
    houseBatch.flush();
  }

  function removeHouseNow(id: string): void {
    const rec = houses.get(id);
    if (!rec) return;
    houseBatch.remove(id);
    fineBatch.remove(id);
    root.remove(rec.group);
    signs.remove(id);
    houses.delete(id);
    land.pads = land.pads.filter((p) => p.id !== id);
    island?.refreshGround();
    meadow?.refresh();
    refreshShadows();
  }

  function info(rec: HouseRec): HouseInfo {
    return {
      id: rec.spec.id,
      spec: rec.spec,
      door: new Vector3(...rec.plan.door).applyMatrix4(rec.matrix),
      window: new Vector3(...rec.plan.window).applyMatrix4(rec.matrix),
      top: new Vector3(...rec.plan.top).applyMatrix4(rec.matrix),
      radius: rec.plan.radius,
      built: rec.built,
    };
  }

  function freeLots(): number {
    let n = 0;
    for (const l of LOTS) if (!land.blocked(l.x, l.z, HOUSE_R)) n++;
    return n;
  }

  function ensureRoom(): void {
    while (freeLots() < 2) if (!growNow()) break;
  }

  function growNow(): boolean {
    const islet = land.grow();
    if (!islet) return false;
    island?.addIslet(islet);
    meadow?.addIslet(islet);
    refreshShadows();
    return true;
  }

  // ---------- paths ----------

  function layPath(a: P2, b: P2, key: string, keep = false): Vector3[] {
    const avoid: { x: number; z: number; r: number }[] = [];
    for (const h of houses.values()) avoid.push({ x: h.spec.pos.x, z: h.spec.pos.z, r: h.plan.radius * 0.9 });
    avoid.push({ x: POND.x, z: POND.z, r: POND.r + 0.9 });
    for (const o of land.obstacles) if (!o.clearable) avoid.push({ x: o.x, z: o.z, r: o.r + 0.4 });
    const pts = routePath(a, b, avoid, key.length * 31 + Math.round(a.x * 7 + b.z * 13));
    pathBatch.remove(`path:${key}`);
    pathBatch.add(`path:${key}`, pathGeometry(land, pts, key.length * 7));
    meadow?.clearAlong(pts, 0.6);
    if (keep) land.keepClear.push(pts);
    const line = pts.map((p) => new Vector3(p.x, land.height(p.x, p.z), p.z));
    paths.set(key, line);
    pathBatch.flush();
    return line;
  }

  /** Shortest walk over the path network, or a winding line round obstacles. */
  function routeAlong(a: P2, b: P2): P2[] {
    const avoid: { x: number; z: number; r: number }[] = [];
    for (const h of houses.values()) avoid.push({ x: h.spec.pos.x, z: h.spec.pos.z, r: h.plan.radius * 0.9 });
    avoid.push({ x: POND.x, z: POND.z, r: POND.r + 0.7 });
    const free = (): P2[] => routePath(a, b, avoid, 7);
    const nodes: Vector3[] = [];
    const edges: number[][] = [];
    for (const line of paths.values()) {
      const base = nodes.length;
      line.forEach((p, i) => {
        nodes.push(p);
        edges.push([]);
        if (i > 0) {
          edges[base + i].push(base + i - 1);
          edges[base + i - 1].push(base + i);
        }
      });
    }
    if (nodes.length < 2) return free();
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        if (!edges[i].includes(j) && Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z) < 1.1) {
          edges[i].push(j);
          edges[j].push(i);
        }
    const nearest = (p: P2): [number, number] => {
      let best = -1;
      let bd = Infinity;
      nodes.forEach((n, i) => {
        const d = Math.hypot(n.x - p.x, n.z - p.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return [best, bd];
    };
    const [sa, da] = nearest(a);
    const [sb, db] = nearest(b);
    const direct = Math.hypot(a.x - b.x, a.z - b.z);
    if (da > 5 || db > 5 || da + db > direct) return free();
    const dist = new Array(nodes.length).fill(Infinity);
    const prev = new Array(nodes.length).fill(-1);
    const done = new Array(nodes.length).fill(false);
    dist[sa] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === sb) break;
      done[u] = true;
      for (const v of edges[u]) {
        const w = dist[u] + nodes[u].distanceTo(nodes[v]);
        if (w < dist[v]) {
          dist[v] = w;
          prev[v] = u;
        }
      }
    }
    if (dist[sb] === Infinity || dist[sb] + da + db > direct * 1.8 + 3) return free();
    const chain: P2[] = [];
    for (let v = sb; v >= 0; v = prev[v]) chain.unshift({ x: nodes[v].x, z: nodes[v].z });
    return [a, ...chain, b];
  }

  // ---------- level of detail ----------

  /** Props and small details are drawn only near the viewer; far houses keep walls, roof, windows. */
  function isFine(piece: { stage: Stage; geo: BufferGeometry }): boolean {
    if (piece.stage === 'props') return true;
    if (piece.stage !== 'details') return false;
    if (!piece.geo.boundingSphere) piece.geo.computeBoundingSphere();
    return piece.geo.boundingSphere!.radius < 0.32;
  }
  function applyLod(): void {
    if (!lodDirty && lodEye.distanceToSquared(lastLodEye) < 9) return;
    lodDirty = false;
    lastLodEye.copy(lodEye);
    let changed = false;
    // small details only for the few nearest houses within reach of the eye
    const nearest = [...houses.values()]
      .filter((h) => h.built)
      .map((h) => [h, Math.hypot(h.spec.pos.x - lodEye.x, h.spec.pos.z - lodEye.z)] as const)
      .filter(([, d]) => d < FINE_R)
      .sort((a, b) => a[1] - b[1])
      .slice(0, FINE_MAX)
      .map(([h]) => h);
    for (const rec of houses.values()) {
      if (!rec.built) continue;
      const near = nearest.includes(rec);
      const has = fineBatch.has(rec.spec.id);
      if (near && !has) {
        for (const g of rec.fine) fineBatch.add(rec.spec.id, g);
        changed = true;
      } else if (!near && has) {
        fineBatch.remove(rec.spec.id);
        changed = true;
      }
    }
    if (changed) fineBatch.flush();
    for (const b of [houseBatch, staticBatch, decorBatch]) b.updateLod(lodEye.x, lodEye.z);
  }

  // ---------- frame tick ----------

  const start = clock();
  let lastFrame = -1;
  let frameN = 0;
  let lastT = 0;
  const eye = new Vector3();
  const tmpM = new Matrix4();
  const tick = (timeMs?: number): void => {
    const now = timeMs ?? clock();
    const t = (now - start) / 1000;
    U.time.value = t;
    wind.update(t);
    // houses: merge once every piece is shown and resting at its target
    for (const rec of houses.values()) {
      if (rec.built || rec.pieces.length === 0) continue;
      let resting = true;
      for (let i = 0; i < rec.pieces.length; i++) {
        const mesh = rec.pieces[i];
        const piece = rec.plan.pieces[i];
        if (!mesh.visible || mesh.parent !== rec.group) {
          resting = false;
          break;
        }
        eye.set(...piece.pos).applyMatrix4(rec.matrix);
        if (mesh.position.distanceToSquared(eye) > 1e-4 || mesh.quaternion.angleTo(rec.quat) > 0.01 || Math.abs(mesh.scale.x - 1) > 0.01) {
          resting = false;
          break;
        }
      }
      rec.still = resting ? rec.still + 1 : 0;
      if (rec.still > 45) settle(rec);
    }
    // props: fold into the batch once they stop moving
    for (const p of props.values()) {
      if (p.settled) continue;
      p.mesh.updateMatrix();
      if (p.mesh.matrix.equals(p.last) && p.mesh.parent === root && p.mesh.visible) p.still++;
      else p.still = 0;
      p.last.copy(p.mesh.matrix);
      if (p.still > 150) {
        p.settled = true;
        propBatch.add(p.id, p.mesh.geometry, tmpM.copy(p.mesh.matrix));
        root.remove(p.mesh);
        propBatch.flush();
        refreshShadows();
      }
    }
    if (frameN++ % 30 === 0) applyLod();
    // grass, flowers and cloud puffs: only what the viewer can see, thinner far away
    meadow?.cull(cone);
    clouds.cull(cone, t);
    events.update(t, Math.min(0.1, Math.max(0, t - lastT)), lodEye, sky.sunDir);
    lastT = t;
    if (Math.abs(events.rain - rainShown) > 0.01 || (events.rain === 0 && rainShown > 0)) applySky();
    setAmbienceState({ fire: events.fireOn, firePos: FIRE });
    critters?.update(t);
    // light shifts as high clouds pass the sun
    const cover = Math.max(0, Math.sin(t * 0.045) * Math.sin(t * 0.027 + 1.3) - 0.35) / 0.65;
    skyRig.sun.intensity = sky.sunI * (1 - 0.28 * cover * (1 - sky.night)) * (1 - 0.6 * events.rain * 0.8);
    flush();
  };

  // ticking from the render loop: the sky dome is always drawn first
  const cone = new ViewCone();
  skyRig.dome.onBeforeRender = (renderer, _scene, camera) => {
    const frame = renderer.info.render.frame;
    if (frame === lastFrame) return;
    lastFrame = frame;
    cone.set(camera, root, renderer);
    lodEye.copy(cone.eye);
    tick();
    skyRig.follow(cone.eye);
  };

  const world: World = {
    root,
    ready,
    seat,
    pier,
    get ground() {
      return island?.ground ?? (skyRig.dome as Mesh);
    },
    get sky() {
      return sky;
    },
    get growth() {
      return land.islets.length;
    },
    setTime(date) {
      sky = skyAt(date);
      applySky();
    },
    validSpot(p) {
      const s = land.findSpot(p.x, p.z, HOUSE_R);
      const reason = s.ok ? undefined : land.blocked(p.x, p.z, HOUSE_R) ?? undefined;
      return { ok: s.ok, snapped: new Vector3(s.x, land.height(s.x, s.z), s.z), rotY: s.rotY, reason };
    },
    suggestSpot() {
      ensureRoom();
      for (const l of LOTS) if (!land.blocked(l.x, l.z, HOUSE_R)) return { ok: true, snapped: new Vector3(l.x, land.height(l.x, l.z), l.z), rotY: faceSeat(l.x, l.z) };
      // no prepared lot left: the nearest free ground anywhere
      for (let rad = 6; rad < 30; rad += 1)
        for (let a = -1.4; a <= 1.4; a += 0.1) {
          const x = Math.sin(a) * rad;
          const z = -Math.cos(a) * rad;
          if (!land.blocked(x, z, HOUSE_R)) return { ok: true, snapped: new Vector3(x, land.height(x, z), z), rotY: faceSeat(x, z) };
        }
      return { ok: false, snapped: new Vector3(LOTS[0].x, land.height(LOTS[0].x, LOTS[0].z), LOTS[0].z), rotY: faceSeat(LOTS[0].x, LOTS[0].z) };
    },
    buildPlan(spec) {
      const rec = planFor(spec);
      ensureRoom();
      return rec.plan.pieces.map((piece, i) => {
        const mesh = rec.pieces[i];
        return {
          object3d: mesh,
          target: { pos: mesh.position.clone(), quat: rec.quat.clone(), scale: new Vector3(1, 1, 1) },
          stage: piece.stage,
          name: piece.name,
          houseId: spec.id,
        };
      });
    },
    finishHouse(id) {
      const rec = houses.get(id);
      if (!rec || rec.built) return;
      for (let i = 0; i < rec.pieces.length; i++) {
        const mesh = rec.pieces[i];
        if (mesh.parent !== rec.group) rec.group.add(mesh);
        mesh.position.set(...rec.plan.pieces[i].pos).applyMatrix4(rec.matrix);
        mesh.quaternion.copy(rec.quat);
        mesh.scale.set(1, 1, 1);
        mesh.visible = true;
      }
      settle(rec);
    },
    addHouse(spec) {
      const rec = planFor(spec);
      world.finishHouse(spec.id);
      ensureRoom();
      return info(rec);
    },
    removeHouse(id) {
      removeHouseNow(id);
    },
    house(id) {
      const rec = houses.get(id);
      return rec ? info(rec) : undefined;
    },
    addPath(a, b) {
      const pa = resolvePlace(a);
      const pb = resolvePlace(b);
      if (!pa || !pb) return [];
      const key = `${typeof a === 'string' ? a : `${a.x.toFixed(1)},${a.z.toFixed(1)}`}|${typeof b === 'string' ? b : `${b.x.toFixed(1)},${b.z.toFixed(1)}`}`;
      return layPath(pa, pb, key);
    },
    path(a, b) {
      const fwd = paths.get(`${a}|${b}`);
      if (fwd) return fwd;
      const back = paths.get(`${b}|${a}`);
      return back ? [...back].reverse() : undefined;
    },
    addProp(kind, pos, o = {}) {
      const id = resolveProp(kind);
      if (!id) return null;
      const item = CATALOG[id];
      const g = 'kit' in item.source ? kitGeometry(item.source.kit, item.scale) : buildProp(item.source.proc, propSeq + 3);
      if (!g) return null;
      const s = o.scale ?? 1;
      if (s !== 1) g.scale(s, s, s);
      const mesh = new Mesh(g, mat);
      const pid = o.id ?? `prop-${++propSeq}`;
      mesh.name = `prop:${pid}`;
      mesh.userData.propId = pid;
      mesh.userData.kind = id;
      const y = 'y' in pos && typeof pos.y === 'number' ? pos.y : land.height(pos.x, pos.z);
      mesh.position.set(pos.x, y, pos.z);
      mesh.rotation.y = o.rotY ?? faceSeat(pos.x, pos.z);
      root.add(mesh);
      if (props.has(pid)) world.removeProp(pid);
      props.set(pid, { id: pid, kind: id, mesh, settled: false, still: 0, last: new Matrix4() });
      clearAround(pos.x, pos.z, item.footprint * 0.6);
      meadow?.clear(pos.x, pos.z, item.footprint * 0.8);
      refreshShadows();
      return mesh;
    },
    removeProp(id) {
      const p = props.get(id);
      if (!p) return;
      root.remove(p.mesh);
      propBatch.remove(id);
      props.delete(id);
      refreshShadows();
    },
    setHorizon(list) {
      horizon.set(list);
      horizonBatch.flush();
    },
    horizon: (id) => horizon.get(id),
    spots() {
      const out: Spot[] = [
        { id: 'seat', name: 'the porch', pos: seat.pos.clone(), rotY: 0 },
        { id: 'pier', name: 'the pier', pos: pier.step.clone(), rotY: pier.rotY + Math.PI },
        { id: 'hill', name: 'the hilltop', pos: new Vector3(HILL.x + 1.5, land.height(HILL.x + 1.5, HILL.z + 2.2), HILL.z + 2.2), rotY: faceSeat(HILL.x, HILL.z) + Math.PI },
        { id: 'spit', name: 'the sand spit', pos: new Vector3(-13.6, land.height(-13.6, -5.2), -5.2), rotY: Math.atan2(-1, 0.2) },
        { id: 'pond', name: 'the pond', pos: new Vector3(POND.x + 2.6, land.height(POND.x + 2.6, POND.z + 1.6), POND.z + 1.6), rotY: Math.atan2(POND.x - (POND.x + 2.6), POND.z - (POND.z + 1.6)) },
      ];
      for (const rec of houses.values()) {
        const front = new Vector3(rec.plan.door[0], 0, rec.plan.door[2] + 1.6).applyMatrix4(rec.matrix);
        front.y = land.height(front.x, front.z);
        out.push({ id: `house:${rec.spec.id}`, name: rec.spec.sign ?? 'a house', pos: front, rotY: rec.spec.rotY + Math.PI });
      }
      for (const i of land.islets) out.push({ id: `islet:${i.id}`, name: 'the islet', pos: new Vector3(i.cx, land.height(i.cx, i.cz), i.cz), rotY: faceSeat(i.cx, i.cz) + Math.PI });
      return out;
    },
    grow: () => growNow(),
    groundY,
    route(a, b) {
      return routeAlong(a, b);
    },
    perches() {
      const out: ReturnType<World['perches']> = island ? island.perches.map((p) => ({ pos: p.pos.clone(), kind: p.kind })) : [];
      for (const rec of houses.values()) if (rec.built) out.push({ pos: new Vector3(...rec.plan.top).applyMatrix4(rec.matrix), kind: 'roof' });
      return out;
    },
    benches() {
      const out: Anchor[] = [{ pos: new Vector3(SEAT.x, 0.16, SEAT.z + 0.32), rotY: 0 }, ...fireBenches.map((b) => ({ pos: b.pos.clone(), rotY: b.rotY }))];
      for (const rec of houses.values())
        rec.plan.pieces.forEach((piece) => {
          if (piece.name !== 'prop:bench') return;
          const p = new Vector3(...piece.pos).applyMatrix4(rec.matrix);
          p.y = land.height(p.x, p.z);
          out.push({ pos: p, rotY: rec.spec.rotY });
        });
      for (const p of props.values()) if (p.kind === 'bench') out.push({ pos: p.mesh.position.clone(), rotY: p.mesh.rotation.y });
      return out;
    },
    cloudY: SEA_Y,
    weather: {
      set(kind) {
        events.setWeather(kind);
        wind.strength = kind === 'rain' ? 1.6 : kind === 'drizzle' ? 1.25 : 1;
      },
      get kind() {
        return events.weather;
      },
    },
    skyWhale: () => events.skyWhale(),
    shootingStar() {
      // lands in front of the seat, to the right, at a seated hand's height
      const target = new Vector3(seat.pos.x + 0.35, seat.pos.y + 0.85, seat.pos.z - 0.5);
      return events.shootingStar(target);
    },
    setPulse(level, hue) {
      const k = Math.max(0, Math.min(1, level));
      U.pulse.value = k;
      if (hue !== undefined) U.pulseColor.value.setHSL(((hue % 1) + 1) % 1, 0.75, 0.62);
      critters?.setPulse(k);
      blobs.setNight(Math.min(1, sky.glow + k * 0.5), U.glowColor.value);
    },
    campfire(on) {
      events.setCampfire(on);
      lightList = lightList.filter((l) => !(l[0] === FIRE.x && l[1] === FIRE.z));
      lightList.push([FIRE.x, FIRE.z, on ? 2.6 : 0.01]);
      refreshShadows();
    },
    get fire() {
      return FIRE.clone();
    },
    update(timeMs) {
      tick(timeMs);
    },
    stats() {
      // what is drawn now: far versions where shown, grass and clouds in view
      let triangles = 0;
      for (const b of batches) triangles += b.triangles();
      triangles += (island?.triangles() ?? 0) + (meadow?.shown() ?? 0) + clouds.shown() + (critters?.triangles() ?? 0) + 32 * 18 * 2;
      for (const rec of houses.values()) for (const m of rec.pieces) triangles += m.geometry.getAttribute('position').count / 3;
      const parts: Record<string, number> = {};
      for (const b of batches) parts[b.mesh.name] = Math.round(b.triangles());
      parts.ground = Math.round(island?.triangles() ?? 0);
      parts.meadow = Math.round(meadow?.shown() ?? 0);
      parts.clouds = Math.round(clouds.shown());
      return { triangles, houses: houses.size, props: props.size, parts };
    },
    dispose() {
      app.scene?.remove(root);
    },
  };
  void CENTER;
  void SEA_Y;
  return world;
}
