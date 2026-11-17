/**
 * World preview page: the island with all twelve houses, paths and horizon islands, seen
 * from the seat, from above or close to a house, at any hour.
 *
 *   ?time=19.2         local hour
 *   ?view=seat|above|house&house=3|pier|left|right
 *   ?houses=12         how many houses to build
 *   ?build=1           leave the last house as a hidden build plan (to check buildPlan)
 */
import { ACESFilmicToneMapping, PerspectiveCamera, SRGBColorSpace, Scene, Vector3, WebGLRenderer } from '@iwsdk/core';
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

const world = createWorld({ scene, camera, renderer });

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
      look(base.clone().addScaledVector(fwd, dist).addScaledVector(side, dist * 0.35).add(new Vector3(0, 2.2, 0)), base.clone().add(new Vector3(0, 1.6, 0)));
    }
  }
  if (q.get('camx')) look(new Vector3(Number(q.get('camx')), Number(q.get('camy')), Number(q.get('camz'))), new Vector3(Number(q.get('tx')), Number(q.get('ty')), Number(q.get('tz'))));

  let frames = 0;
  const loop = (): void => {
    renderer.render(scene, camera);
    frames++;
    if (frames === 20) {
      const w = window as unknown as Record<string, unknown>;
      w.__stats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, world: world.stats(), programs: renderer.info.programs?.length };
      w.__ready = true;
    }
    requestAnimationFrame(loop);
  };
  loop();
  (window as unknown as Record<string, unknown>).__world = world;
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
