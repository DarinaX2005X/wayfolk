/**
 * World preview page: the island with all twelve houses, paths and horizon islands, seen
 * from the seat, from above or close to a house, at any hour.
 *
 *   ?time=19.2         local hour
 *   ?view=seat|above|house&house=3|pier|left|right
 *   ?houses=12         how many houses to build
 *   ?build=1           leave the last house as a hidden build plan (to check buildPlan)
 */
import { ACESFilmicToneMapping, Frustum, Matrix4, PerspectiveCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderer, type InstancedMesh, type Mesh } from '@iwsdk/core';
import type { HouseSpec, Trade } from '../../../src/mind/types';
import { TRADES } from '../../../src/mind/types';
import { createWorld } from '../../../src/world/index';
import { atHour } from '../../../src/world/daylight';

const q = new URLSearchParams(location.search);
const hour = Number(q.get('time') ?? '18.6');
const view = q.get('view') ?? 'seat';
const count = Number(q.get('houses') ?? '12');
const tone = q.get('tone') === '1';

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
if (tone) renderer.toneMapping = ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new Scene();
const camera = new PerspectiveCamera(Number(q.get('fov') ?? '72'), innerWidth / innerHeight, 0.05, 1600);
camera.position.set(0, 1.2, 0);

let offset = 0;
const now = (): number => performance.now() + offset;
const world = createWorld({ scene, camera, renderer }, { now });
/** Runs the world forward by some seconds of simulated time. */
const sim = (seconds: number): void => {
  for (let i = 0; i < seconds * 20; i++) {
    offset += 50;
    world.update(now());
  }
};

const PALETTES: Record<Trade, { wall: string; roof: string; trim: string; sign: string; props: string[] }> = {
  baker: { wall: '#f3e2c4', roof: '#c8553d', trim: '#8a5a3b', sign: 'Crumb & Co', props: ['fruit-basket'] },
  stargazer: { wall: '#e9e4f2', roof: '#3d5a8a', trim: '#c9a44a', sign: 'Night Desk', props: ['lantern'] },
  fisher: { wall: '#9cc3c9', roof: '#4f7f8f', trim: '#e8dcc0', sign: 'Fresh Catch', props: ['shell'] },
  gardener: { wall: '#d9c7a3', roof: '#6c9a4b', trim: '#f4efe4', sign: 'Seedlings', props: ['pumpkin'] },
  tinkerer: { wall: '#c9b79c', roof: '#7a5c48', trim: '#4a3a30', sign: 'Fix It', props: ['gear'] },
  storyteller: { wall: '#efd9b5', roof: '#8a4a5e', trim: '#5e3d29', sign: 'Old Tales', props: ['candle'] },
  'tea-maker': { wall: '#f1e6d2', roof: '#3f6f5f', trim: '#a8452f', sign: 'Steep', props: ['teapot'] },
  musician: { wall: '#f4d9a8', roof: '#b0573f', trim: '#5a4a6a', sign: 'Tunes', props: ['kite'] },
  painter: { wall: '#f6efe2', roof: '#d08a3a', trim: '#4f7fa6', sign: 'Studio', props: ['sunflower'] },
  beekeeper: { wall: '#f2dca0', roof: '#c9973f', trim: '#7a5230', sign: 'Honey', props: ['flower-pot'] },
  'lighthouse-keeper': { wall: '#f4f1ea', roof: '#b84a3a', trim: '#c94a3a', sign: 'Keeper', props: [] },
  cartographer: { wall: '#d8c3a0', roof: '#4d6f8a', trim: '#6b4a32', sign: 'Maps', props: ['kite'] },
};

async function main(): Promise<void> {
  await world.ready;
  const order: Trade[] = ['baker', 'tea-maker', 'stargazer', 'painter', 'fisher', 'storyteller', 'gardener', 'musician', 'beekeeper', 'lighthouse-keeper', 'cartographer', 'tinkerer'];
  const built: HouseSpec[] = [];
  for (let i = 0; i < Math.min(count, 12); i++) {
    const trade = order[i] ?? TRADES[i];
    const spot = world.suggestSpot();
    const p = PALETTES[trade];
    const spec: HouseSpec = {
      id: `h${i + 1}`,
      residentId: `r${i + 1}`,
      recipe: trade,
      pos: { x: spot.snapped.x, z: spot.snapped.z },
      rotY: spot.rotY,
      colors: { wall: p.wall, roof: p.roof, trim: p.trim },
      props: p.props,
      sign: p.sign,
      builtAt: Date.now(),
    };
    if (q.get('build') === '1' && i === count - 1) world.buildPlan(spec);
    else world.addHouse(spec);
    built.push(spec);
  }
  world.addPath('seat', 'h1');
  if (built.length > 1) world.addPath('h1', 'h2');
  if (built.length > 2) world.addPath('seat', 'h3');
  if (built.length > 3) world.addPath('h2', 'h4');
  if (built.length > 4) world.addPath('pier', 'h5');
  if (built.length > 5) world.addPath('h3', 'h6');
  if (built.length > 6) world.addPath('h1', 'h7');
  world.setHorizon([
    { id: 'maple-rock', name: 'Maple Rock' },
    { id: 'tern-isle', name: 'Tern Isle' },
    { id: 'lantern-key', name: 'Lantern Key' },
    { id: 'the-shallows', name: 'The Shallows' },
  ]);
  world.setTime(atHour(hour));
  // events: ?weather=rain|drizzle, ?bow=1 (rain then clear), ?fire=1, ?whale=1, ?star=1, ?pulse=0.8
  const wq = q.get('weather');
  if (wq === 'rain' || wq === 'drizzle') {
    world.weather.set(wq);
    sim(20);
  }
  if (q.get('bow') === '1') {
    world.weather.set('rain');
    sim(12);
    world.weather.set('clear');
    sim(30);
  }
  if (q.get('fire') === '1') {
    world.campfire(true);
    sim(4);
  }
  if (q.get('pulse')) world.setPulse(Number(q.get('pulse')), 0.08);
  if (q.get('whale') === '1') {
    void world.skyWhale();
    sim(Number(q.get('at') ?? '30'));
  }
  if (q.get('star') === '1') {
    void world.shootingStar();
    sim(Number(q.get('at') ?? '2.4'));
  }

  const look = (from: Vector3, to: Vector3): void => {
    camera.position.copy(from);
    camera.lookAt(to);
  };
  if (view === 'seat') look(new Vector3(0, 1.2, 0), new Vector3(0, 0.6, -10));
  else if (view === 'left') look(new Vector3(0, 1.2, 0), new Vector3(-8, 0.5, -8));
  else if (view === 'right') look(new Vector3(0, 1.2, 0), new Vector3(9, 0.3, -9));
  else if (view === 'back') look(new Vector3(0, 1.2, 0), new Vector3(0, 0.0, 10));
  else if (view === 'above') look(new Vector3(18, 26, 16), new Vector3(-1, -2, -11));
  else if (view === 'far') look(new Vector3(30, 9, 30), new Vector3(-1, -3, -11));
  else if (view === 'pier') look(new Vector3(world.pier.pos.x + 4, 2.4, world.pier.pos.z + 4), world.pier.pos);
  else if (view === 'house') {
    const id = `h${q.get('house') ?? '1'}`;
    const h = world.house(id);
    if (h) {
      const spec = h.spec;
      const fwd = new Vector3(Math.sin(spec.rotY), 0, Math.cos(spec.rotY));
      const side = new Vector3(fwd.z, 0, -fwd.x);
      const base = new Vector3(spec.pos.x, world.groundY(spec.pos.x, spec.pos.z), spec.pos.z);
      const dist = Number(q.get('dist') ?? '7.5');
      // walk round the front until no other house is in the way
      let cam = base.clone();
      for (const a of [0.35, -0.35, 0.8, -0.8, 1.2, -1.2, 0]) {
        const dir = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a));
        cam = base.clone().addScaledVector(dir, dist).add(new Vector3(0, 2.0, 0));
        const clear = built.every((b) => b.id === id || Math.hypot(b.pos.x - cam.x, b.pos.z - cam.z) > 3.4) && built.every((b) => {
          if (b.id === id) return true;
          // the line from camera to house should not pass through another house
          const t = Math.max(0, Math.min(1, ((b.pos.x - cam.x) * (base.x - cam.x) + (b.pos.z - cam.z) * (base.z - cam.z)) / ((base.x - cam.x) ** 2 + (base.z - cam.z) ** 2)));
          return Math.hypot(cam.x + (base.x - cam.x) * t - b.pos.x, cam.z + (base.z - cam.z) * t - b.pos.z) > 2.6;
        });
        if (clear) break;
      }
      look(cam, base.clone().add(new Vector3(0, 1.5, 0)));
    }
  }
  if (q.get('camx')) look(new Vector3(Number(q.get('camx')), Number(q.get('camy')), Number(q.get('camz'))), new Vector3(Number(q.get('tx')), Number(q.get('ty')), Number(q.get('tz'))));

  let frames = 0;
  const loop = (): void => {
    renderer.render(scene, camera);
    frames++;
    if (frames === 20) {
      const w = window as unknown as Record<string, unknown>;
      w.__stats = { houses: built.map((b) => `${b.recipe}@${b.pos.x.toFixed(1)},${b.pos.z.toFixed(1)}`).join(' '), calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, world: world.stats(), programs: renderer.info.programs?.length };
      w.__ready = true;
    }
    requestAnimationFrame(loop);
  };
  loop();
  (window as unknown as Record<string, unknown>).__world = world;
  (window as unknown as Record<string, unknown>).__probe = () => {
    const fr = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const rows: [string, number, boolean][] = [];
    scene.traverseVisible((o) => {
      const m = o as Mesh;
      if (!m.geometry || (o as unknown as { isPoints?: boolean }).isPoints) return;
      const g = m.geometry;
      const per = (g.index ? g.index.count : (g.getAttribute('position')?.count ?? 0)) / 3;
      const n = (m as InstancedMesh).isInstancedMesh ? (m as InstancedMesh).count : 1;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const s = g.boundingSphere!.clone().applyMatrix4(m.matrixWorld);
      const inView = !m.frustumCulled || fr.intersectsSphere(s);
      rows.push([m.name || m.type, Math.round(per * n), inView]);
    });
    rows.sort((a, b) => b[1] - a[1]);
    const seen = rows.filter((r) => r[2]).reduce((a, r) => a + r[1], 0);
    return [`in view ${seen}`, ...rows.map((r) => `${r[2] ? '*' : ' '} ${r[1]} ${r[0]}`)];
  };
}

main().catch((e) => {
  console.error(e);
  (window as unknown as Record<string, unknown>).__error = String(e?.stack ?? e);
});
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
