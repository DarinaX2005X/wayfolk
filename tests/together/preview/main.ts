/**
 * Preview of src/together/ outside the app: the real island (src/world), its life
 * (src/life), live visits over the deployed relay (src/live) and the together module, in
 * two tabs.
 *
 *   ?role=host                       hosts a room on a seeded island (Mira)
 *   ?role=guest&code=XXXXXX          joins it with an island of its own (Tom)
 *   &time=18:40                      the clock (sunset by default)
 *   &relay=<url>                     another relay
 *
 * window.__tg drives it from tests/together/shoot.mjs: camera, fake hands, fast-forward.
 */
import { Euler, Matrix4, NoToneMapping, Object3D, PerspectiveCamera, Quaternion, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from '@iwsdk/core';
import { createLife } from '../../../src/life/index';
import type { Life, LifeWorld } from '../../../src/life/types';
import { createLive, type Live } from '../../../src/live/index';
import { PREPARED } from '../../../src/mind/prepared';
import type { HouseSpec, IslandState, Resident } from '../../../src/mind/types';
import { createTogether, type Together, type TogetherHand } from '../../../src/together/index';
import { createWorld, type World } from '../../../src/world/index';

const q = new URLSearchParams(location.search);
const role = q.get('role') === 'guest' ? 'guest' : 'host';
const status = document.getElementById('status')!;
const pipLine = document.getElementById('pip')!;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new Scene();
const camera = new PerspectiveCamera(Number(q.get('fov') ?? 62), innerWidth / innerHeight, 0.05, 1600);
scene.add(camera);

function at(hhmm: string): Date {
  const d = new Date();
  const [h, m] = hhmm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------------------
// Islands of the two people

function islandOf(id: string, name: string, seed: number, folk: string[]): IslandState {
  const residents = folk.map((rid) => ({ ...structuredClone(PREPARED.find((p) => p.id === rid)!), arrivedAt: Date.now(), houseId: `h-${rid}` })) as Resident[];
  return { id, name, seed, visibility: 'private', radius: 14, residents, houses: [], paths: [], props: [], events: [], createdAt: Date.now(), lastVisit: Date.now() };
}

function settle(world: World, state: IslandState): void {
  for (const r of state.residents) {
    let spec = state.houses.find((h) => h.residentId === r.id);
    if (!spec) {
      const spot = world.suggestSpot();
      spec = { id: `h-${r.id}`, residentId: r.id, recipe: r.trade, pos: { x: spot.snapped.x, z: spot.snapped.z }, rotY: spot.rotY, colors: r.house?.colors ?? { wall: '#efe2c8', roof: r.colors.accent, trim: '#8a5a3b' }, props: r.house?.props ?? [], sign: r.house?.sign ?? r.name, builtAt: Date.now() } as HouseSpec;
      state.houses.push(spec);
    }
    world.addHouse(spec);
  }
}

function spawnFolk(world: World, life: Life, state: IslandState): void {
  for (const r of state.residents) {
    const h = state.houses.find((x) => x.id === r.houseId);
    life.spawn(r, h ? { x: h.pos.x + Math.sin(h.rotY) * 2, z: h.pos.z + Math.cos(h.rotY) * 2 } : undefined);
  }
  void world;
}

// ---------------------------------------------------------------------------------------
// Fake hands: what the app's hands give together, and joints for live presence

const TIPS_L: [number, number, number][] = [
  [0.087, -0.04, -0.101],
  [0.035, -0.022, -0.178],
  [-0.01, -0.016, -0.188],
  [-0.035, -0.013, -0.176],
  [-0.062, -0.022, -0.144],
];

function makeHand(): TogetherHand & { wrist: Vector3; quat: Quaternion; tips: Vector3[] } {
  return { tracked: false, pinching: false, palm: new Vector3(), indexTip: new Vector3(), thumbTip: new Vector3(), rayOrigin: new Vector3(), rayDir: new Vector3(0, 0, -1), wrist: new Vector3(), quat: new Quaternion(), tips: TIPS_L.map(() => new Vector3()) };
}
const fakeHands = { left: makeHand(), right: makeHand() };
const joints = { left: new Float32Array(25 * 16), right: new Float32Array(25 * 16) };
const grip = new Object3D();
let immersive = q.get('xr') === '1';
const adapters = {
  hand: { left: { connected: true, jointTransforms: joints.left, gripSpace: grip }, right: { connected: true, jointTransforms: joints.right, gripSpace: grip } },
  controller: { left: { connected: false }, right: { connected: false } },
};

/** Puts a hand (island frame = world here) with its palm at `palm`, fingers up, palm facing `facing`. */
function setHand(side: 'left' | 'right', palm: Vector3, facing: Vector3, opts: { pinch?: boolean; fingers?: Vector3 } = {}): void {
  const h = fakeHands[side];
  const fingers = (opts.fingers ?? new Vector3(0, 1, 0)).clone().normalize();
  const z = fingers.clone().negate();
  const y = facing.clone().normalize().negate();
  const x = new Vector3().crossVectors(y, z).normalize();
  y.crossVectors(z, x).normalize();
  h.quat.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  h.wrist.copy(palm).addScaledVector(fingers, -0.07);
  const m = side === 'left' ? 1 : -1;
  TIPS_L.forEach((t, i) => {
    h.tips[i].copy(h.wrist).addScaledVector(x, t[0] * m).addScaledVector(y, t[1]).addScaledVector(z, t[2]);
  });
  if (opts.pinch) h.tips[0].copy(h.tips[1]).addScaledVector(x, 0.01 * m);
  h.tracked = true;
  h.pinching = Boolean(opts.pinch);
  h.palm.copy(palm);
  h.indexTip.copy(h.tips[1]);
  h.thumbTip!.copy(h.tips[0]);
  h.rayOrigin!.copy(h.wrist);
  h.rayDir!.copy(facing).normalize();
  const arr = joints[side];
  new Matrix4().compose(h.wrist, h.quat, new Vector3(1, 1, 1)).toArray(arr, 0);
  [4, 9, 14, 19, 24].forEach((j, i) => new Matrix4().makeTranslation(h.tips[i].x, h.tips[i].y, h.tips[i].z).toArray(arr, j * 16));
}

// ---------------------------------------------------------------------------------------

declare global {
  interface Window {
    __ready?: boolean;
    __tg?: Record<string, unknown> & { together: Together; live: Live; world: World; life: Life; events: string[]; pip: string[] };
  }
}

const frameFns: ((dt: number, now: number) => void)[] = [];
let t = 0;
let life!: Life;
let world!: World;
let together!: Together;
let live!: Live;
const events: string[] = [];
const pip: string[] = [];

/** Steps everything by `seconds` without drawing (fixed 1/30 s steps). */
function fast(seconds: number): void {
  const step = 1 / 30;
  for (let s = 0; s < seconds; s += step) tick(step);
}

function tick(dt: number): void {
  t += dt;
  world.update(t * 1000);
  life.update(dt, t);
  for (const fn of frameFns) fn(dt, performance.now());
}

let last = performance.now();
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tick(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

const eyeAt = (p: Vector3, yaw: number): void => {
  camera.position.set(p.x, p.y + 1.15, p.z);
  camera.rotation.set(-0.08, yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
};

async function main(): Promise<void> {
  world = createWorld({ scene, camera, renderer });
  await world.ready;
  world.setTime(at(q.get('time') ?? '18:40'));
  life = createLife({ scene, camera }, { ...world, heightAt: (x: number, z: number) => world.groundY(x, z), route: (a: { x: number; z: number }, b: { x: number; z: number }) => world.route(a, b), perches: () => world.perches(), benches: () => world.benches(), radius: 14 } as unknown as LifeWorld);
  await life.ready;
  const own = role === 'host' ? islandOf('isle-mira-preview', 'Juniper Rock', 4242, ['p-musician-fox', 'p-tea-maker-hedgehog', 'p-fisher-otter']) : islandOf('isle-tom-preview', 'Thistle Knoll', 777, ['p-baker-rabbit', 'p-gardener-bear']);
  if (role === 'host') {
    settle(world, own);
    spawnFolk(world, life, own);
  } else {
    // The friend's own houses, laid out once so the summary has their places.
    settle(world, own);
    for (const h of own.houses) world.removeHouse(h.id);
  }
  const mind = { state: own, async save() {}, async load() { return own; } };
  eyeAt(world.seat.pos, 0);

  const liveWorld = { camera, scene, input: { xr: { visualAdapters: adapters } }, renderer: { xr: { get isPresenting() { return immersive; } } } };
  live = createLive({ world: liveWorld, space: world.root, everyFrame: (fn) => (frameFns.push(fn), () => {}) }, { relay: q.get('relay') ?? undefined, name: role === 'host' ? 'Mira' : 'Tom', storage: null, snapshot: () => own, ground: (x, z) => world.groundY(x, z) });
  live.on('state', (s, _r, msg) => {
    events.push(`state:${s}`);
    status.textContent = `${role} · ${s}${msg ? ` · ${msg}` : ''}${live.code ? ` · ${live.code}` : ''}`;
  });
  live.on('snapshot', (s) => {
    events.push(`snapshot:${s.id}`);
    // A guest: the host's island appears (as the app's visit flow does it).
    if (role === 'guest') {
      for (const h of s.houses) world.addHouse(h);
      spawnFolk(world, life, s);
      const pier = world.spots()[1];
      eyeAt(pier.pos, pier.rotY);
    }
  });
  const memory = new Map<string, string>();
  together = createTogether({
    world,
    life,
    mind,
    live,
    app: {
      camera,
      everyFrame: (fn) => (frameFns.push(fn), () => {}),
      canvas: renderer.domElement,
      hands: { get: (side) => fakeHands[side] },
      glide: (p, yaw) => {
        eyeAt(p, yaw);
        events.push('glide');
      },
      pipSay: (text) => {
        pip.push(text);
        pipLine.textContent = text;
        pipLine.style.display = q.get('captions') === '0' ? 'none' : 'block';
        void life.pip.say(text);
      },
      postcard: { showCard: (title) => events.push(`postcard:${title}`) },
      renderer,
      scene,
      storage: { getItem: (k) => memory.get(k) ?? null, setItem: (k, v) => void memory.set(k, v) },
      immersive: () => immersive,
    },
  });
  for (const k of ['tg-hello', 'tg-dock', 'tg-hold', 'tg-plank', 'tg-built', 'tg-duet', 'tg-chime', 'tg-lantern', 'tg-stars', 'tg-five', 'tg-offer'])
    live.on(k, (_d: unknown, from: { name: string }) => events.push(`${k}:${from.name}`));
  life.startDaily();

  window.__tg = {
    together,
    live,
    world,
    life,
    events,
    pip,
    fast,
    camera,
    renderer,
    memory,
    eyeAt: (x: number, y: number, z: number, yaw: number, pitch = -0.08) => {
      camera.position.set(x, y, z);
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      camera.updateMatrixWorld();
    },
    lookAt: (x: number, y: number, z: number, tx: number, ty: number, tz: number, fov?: number) => {
      camera.position.set(x, y, z);
      if (fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(tx, ty, tz);
      camera.updateMatrixWorld();
    },
    setImmersive: (on: boolean) => {
      immersive = on;
    },
    setHand: (side: 'left' | 'right', palm: number[], facing: number[], pinch = false, fingers?: number[]) => setHand(side, new Vector3(...palm), new Vector3(...facing), { pinch, fingers: fingers ? new Vector3(...fingers) : undefined }),
    dropHands: () => {
      fakeHands.left.tracked = false;
      fakeHands.right.tracked = false;
    },
    /** Screen point of an island-frame position (for real mouse clicks). */
    screen: (x: number, y: number, z: number) => {
      const v = new Vector3(x, y, z).project(camera);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, front: v.z < 1 };
    },
    stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    render: () => renderer.render(scene, camera),
    Euler,
  } as unknown as NonNullable<Window['__tg']>;

  if (role === 'host') {
    const { code } = await live.host(own.id, { snapshot: () => own });
    events.push(`hosted:${code}`);
  } else if (q.get('code')) {
    await live.join(q.get('code')!);
    events.push('joined');
  }
  requestAnimationFrame(loop);
  window.__ready = true;
}

void main().catch((error) => {
  console.error(error);
  status.textContent = `failed: ${String(error)}`;
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
