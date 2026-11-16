/**
 * Render bench of the world kit: builds kit scenes with a plain WebGLRenderer, the same
 * light and an environment gradient like IBLGradient, and a camera from the seat (head
 * at the origin, 9° down, 90° across), so frames compare with design/frame-D-seat.png.
 *
 *   ?view=seat      the run in the middle of Harbor Street
 *   ?view=home      home before a run
 *   ?view=cover     the island from behind and above (DESIGN "Обложка")
 *   ?view=gallery&entry=<id>&state=<name>   one state of worldGallery()
 *   &w=1200&h=800   frame size; &t=<ms> kit time of the frame
 *
 * window.__ready turns true when fonts are loaded and the frame is drawn.
 */
import {
  ACESFilmicToneMapping,
  BackSide,
  Color,
  Mesh,
  NoToneMapping,
  Object3D,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from '@iwsdk/core';
import type { Plot, Station } from '../../../../src/agents/types';
import { SKY, LAYOUT } from '../../../../src/tokens/tokens';
import { createBench } from '../../../../src/kit/world/bench';
import { createFirstStake } from '../../../../src/kit/world/first-stake';
import { createHomePlot } from '../../../../src/kit/world/home';
import { createInbox } from '../../../../src/kit/world/inbox';
import { createInstruments } from '../../../../src/kit/world/instrument';
import { createIsland } from '../../../../src/kit/world/island';
import { labelFontsReady } from '../../../../src/kit/world/label';
import { createLight } from '../../../../src/kit/world/light';
import { createMechanism } from '../../../../src/kit/world/mechanism';
import { createModeSwitch } from '../../../../src/kit/world/mode-switch';
import { createPairTags } from '../../../../src/kit/world/pair-tags';
import { createPath } from '../../../../src/kit/world/path';
import { createSector } from '../../../../src/kit/world/sector';
import { createSettingsTile } from '../../../../src/kit/world/settings-tile';
import { shadowLayer } from '../../../../src/kit/world/shadow';
import { createSky } from '../../../../src/kit/world/sky';
import { createSlip } from '../../../../src/kit/world/slip';
import { atTime, tickKit, useKitClock } from '../../../../src/kit/world/time';
import { createTray } from '../../../../src/kit/world/tray';
import { createVoiceStone } from '../../../../src/kit/world/voice-stone';
import { worldGallery } from '../../../../src/kit/world/gallery';

declare global {
  interface Window {
    __ready?: boolean;
    __error?: string;
    __info?: unknown;
    __list?: { id: string; states: string[] }[];
  }
}

const params = new URLSearchParams(location.search);
const W = Number(params.get('w') ?? 1200);
const H = Number(params.get('h') ?? 800);
const T = Number(params.get('t') ?? 100_000);
const view = params.get('view') ?? 'seat';
useKitClock(() => T);

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
void ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const seat = new Object3D();
seat.name = 'root:seat';
scene.add(seat);
scene.add(shadowLayer());

// Environment like IBLGradient: zenith, horizon, nadir.
function environment(): void {
  const env = new Scene();
  const c = (h: string) => new Color(h);
  env.add(
    new Mesh(
      new SphereGeometry(10, 32, 16),
      new ShaderMaterial({
        side: BackSide,
        uniforms: { a: { value: c(SKY.ibl.sky) }, b: { value: c(SKY.ibl.equator) }, g: { value: c(SKY.ibl.ground) } },
        vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 a; uniform vec3 b; uniform vec3 g; varying vec3 p; void main(){ float y = p.y; vec3 c = y > 0.0 ? mix(b, a, pow(y, 0.6)) : mix(b, g, pow(-y, 0.6)); gl_FragColor = vec4(c, 1.0); }',
      }),
    ),
  );
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 1;
}
environment();

const camera = new PerspectiveCamera(60, W / H, 0.01, 60);
/** The seat camera: 90° across, 9° down. */
function seatCamera(): void {
  const hfov = 90;
  camera.fov = (2 * Math.atan(Math.tan((hfov * Math.PI) / 360) / (W / H)) * 180) / Math.PI;
  camera.position.set(0, 0, 0);
  camera.rotation.set((-9 * Math.PI) / 180, 0, 0, 'YXZ');
  camera.updateProjectionMatrix();
}

const CASE: Station[] = [
  { id: 's1', step: 'read', label: 'Read', by: 'code' },
  { id: 's2', step: 'extract', label: 'Extract', by: 'model', role: 'extractor' },
  { id: 's3', step: 'verify', label: 'Check', by: 'code' },
  { id: 's4', step: 'reconcile', label: 'Reconcile', by: 'model', role: 'reconciler' },
  { id: 's5', step: 'assemble', label: 'Assemble', by: 'code' },
];

export const PLOTS: Plot[] = [
  { projectId: 'p1', slug: 'harbor-street', slot: 1, kind: 'case', title: 'Harbor Street, Unit 4B', sample: true, visibility: 'public', object: { kind: 'case-stack', pages: 64, open: 6, closed: 1 }, doneAt: '2026-11-14T10:00:00Z', tiles: 119, perTile: 1, seed: 4, tileRefs: [], passes: 1, open: 6, total: 7, flag: 'none' },
  { projectId: 'p2', slug: 'wedding', slot: 2, kind: 'seating', title: 'Wedding', sample: true, visibility: 'public', object: { kind: 'cake', rows: 3, tablesPerRow: [4, 4, 3] }, doneAt: '2026-11-14T10:00:00Z', tiles: 84, perTile: 1, seed: 8, tileRefs: [], passes: 1, open: 1, total: 23, flag: 'question' },
  { projectId: 'p3', slug: 'class-9b', slot: 7, kind: 'essays', title: 'Class 9B', sample: true, visibility: 'public', object: { kind: 'notebooks', count: 24, review: 3 }, doneAt: '2026-11-14T10:00:00Z', tiles: 72, perTile: 1, seed: 12, tileRefs: [], passes: 1, open: 3, total: 24, flag: 'deadline' },
  { projectId: 'p4', slug: 'harbor-late', slot: 6, kind: 'case', title: 'Dana Whitlock, deposit', sample: false, visibility: 'public', object: { kind: 'case-stack', pages: 30, open: 2, closed: 3 }, doneAt: '2026-11-12T10:00:00Z', tiles: 46, perTile: 1, seed: 21, tileRefs: [], passes: 2, open: 2, total: 5, flag: 'pages' },
  { projectId: 'p5', slug: 'reunion', slot: 3, kind: 'seating', title: 'Reunion dinner', sample: false, visibility: 'public', object: { kind: 'cake', rows: 2, tablesPerRow: [5, 3] }, doneAt: '2026-11-10T10:00:00Z', tiles: 40, perTile: 1, seed: 33, tileRefs: [], passes: 1, open: 0, total: 9, flag: 'none' },
];

function homeAndBench(opts: { pin: boolean }) {
  const home = createHomePlot();
  home.position.set(0, -0.55, 0);
  seat.add(home);
  const bench = createBench();
  seat.add(bench.root);
  const inbox = createInbox();
  bench.attach('inbox', inbox.root);
  atTime(T - 5000, () => {
    inbox.offer([
      { id: 'harbor', kind: 'sample', lines: ['Harbor Street, Unit 4B', '64 pages, 12 documents'], example: 'harbor-street' },
      { id: 'wedding', kind: 'sample', lines: ['Wedding', '84 guests, a wish letter'], example: 'wedding' },
      { id: 'class', kind: 'sample', lines: ['Class 9B', '24 essays, 2 marked'], example: 'class-9b' },
      { id: 'files', kind: 'files', lines: ['Your files', 'Send them from your phone'] },
    ]);
    inbox.setPin(opts.pin);
  });
  const stake = createFirstStake();
  bench.attach('firstStake', stake);
  const stone = createVoiceStone();
  bench.attach('voiceStone', stone.root);
  const sw = createModeSwitch();
  bench.attach('modeSwitch', sw.root);
  bench.attach('settingsTile', createSettingsTile());
  return { bench, inbox, stake, stone, sw };
}

function build(): void {
  const sky = createSky(null);
  seat.add(sky.root);
  const light = createLight(null);
  seat.add(light.root);
  if (view === 'seat' || view === 'home') {
    seatCamera();
    const { bench } = homeAndBench({ pin: view === 'home' });
    const island = createIsland(1);
    seat.add(island.root);
    island.setPlots(PLOTS);
    if (view === 'home') return;
    const tray = createTray('sent-back');
    bench.attach('traySent', tray.root);
    atTime(T - 4000, () => {
      for (let i = 0; i < 4; i++) tray.add(createSlip({ id: `x${i}`, kind: 'claim', status: 'rejected', reason: i % 2 ? 'quote-altered' : 'quote-not-found', claim: 'I handed both sets of keys to Dana on 2 March' }));
    });
    const path = createPath();
    seat.add(path.root);
    atTime(T - 20_000, () => path.setPlan(CASE));
    atTime(T - 19_000, () => {
      path.setStation('s1', 'done');
      path.setStation('s2', 'active', 0.6);
      path.setStation('s3', 'active', 0.5);
    });
    const at = (id: string, mech: Object3D, r = LAYOUT.arc.rows.inner) => {
      const a = path.angle(id);
      const rad = (a * Math.PI) / 180;
      mech.position.set(r * Math.sin(rad), -0.47, -r * Math.cos(rad));
      mech.rotation.y = -rad;
      seat.add(mech);
    };
    const cutter = createMechanism('cutter');
    at('s1', cutter.root);
    const gate = createMechanism('gate');
    at('s3', gate.root);
    const assembly = createMechanism('assembly');
    at('s5', assembly.root);
    atTime(T - 50, () => gate.pulse('stamp'));
    const pool = createInstruments(null);
    seat.add(pool.root);
    for (let i = 0; i < 4; i++) {
      const inst = atTime(T - 8000, () => pool.spawn('extractor', `call-${i}`));
      atTime(T - 8000, () => {
        inst.moveTo(path.spot('s2', i));
        inst.carry('page', `${i * 6 + 1}–${i * 6 + 6}`);
        inst.face(path.spot('s2', i).clone().add(new Vector3(0, 0, 0.1)));
      });
      atTime(T - 6000, () => inst.work(true));
    }
    const sector = createSector({ slot: 0, seed: 5 });
    seat.add(sector.root);
    atTime(T - 15_000, () => {
      sector.setOutline(true);
      sector.setGrid(124);
    });
    for (let i = 0; i < 41; i++) atTime(T - 9000 + i * 150, () => sector.layTile(i));
    const tags = createPairTags();
    void tags;
    return;
  }
  if (view === 'cover') {
    const { bench } = homeAndBench({ pin: false });
    void bench;
    const island = createIsland(1);
    seat.add(island.root);
    island.setPlots(PLOTS);
    camera.fov = 40;
    camera.aspect = W / H;
    camera.position.set(-0.9, 2.6, 4.2);
    camera.rotation.set((-29 * Math.PI) / 180, 0, 0, 'YXZ');
    camera.updateProjectionMatrix();
    return;
  }
  if (view === 'perf') {
    // Six walking instruments: mean cost of one pool update and of one rendered frame.
    seatCamera();
    const path = createPath();
    seat.add(path.root);
    atTime(T - 20_000, () => path.setPlan(CASE));
    const pool = createInstruments(null);
    seat.add(pool.root);
    const kinds = ['page', 'cards', 'spool', 'slips', 'pencil', 'page'] as const;
    const all = kinds.map((k, i) => atTime(T, () => pool.spawn('extractor', `p${i}`)));
    all.forEach((it, i) => atTime(T, () => {
      it.carry(kinds[i], i === 0 ? '1–6' : undefined);
      it.moveTo(i % 2 ? path.spot('s4', i % 4) : path.spot('s2', i % 4));
    }));
    const n = 600;
    let t0 = performance.now();
    for (let i = 0; i < n; i++) pool.update(T + i * 2);
    const updateMs = (performance.now() - t0) / n;
    const frames = (withPool: boolean): number => {
      pool.root.visible = withPool;
      const gl = renderer.getContext();
      const start = performance.now();
      for (let i = 0; i < 120; i++) {
        pool.update(T + i * 11);
        renderer.render(scene, camera);
      }
      gl.finish();
      return (performance.now() - start) / 120;
    };
    const hide = params.get('hide');
    if (hide) pool.root.traverse((o) => { if (o.name.includes(hide)) o.visible = false; });
    frames(true);
    frames(true);
    const without = frames(false);
    const withPool = frames(true);
    t0 = 0;
    renderer.render(scene, camera);
    (window as unknown as { __perf: unknown }).__perf = { updateMs, frameWithout: without, frameWith: withPool, added: withPool - without, calls: renderer.info.render.calls };
    return;
  }
  if (view === 'gallery') {
    seatCamera();
    const entry = worldGallery().find((e) => e.id === params.get('entry'));
    const state = entry?.states.find((s) => s.name === params.get('state')) ?? entry?.states[0];
    if (!state) throw new Error(`no gallery state ${params.get('entry')} / ${params.get('state')}`);
    const obj = state.build({ world: null as never, app: null as never }) as Object3D;
    seat.add(obj);
    const frame = obj.userData.frame as { target: [number, number, number]; dist?: number; from?: [number, number, number]; fov?: number } | undefined;
    if (frame) {
      const target = new Vector3(...frame.target);
      if (frame.from) camera.position.set(...frame.from);
      else {
        const dir = target.clone().normalize();
        camera.position.copy(target).addScaledVector(dir, -(frame.dist ?? 0.5));
      }
      camera.fov = frame.fov ?? 40;
      camera.updateProjectionMatrix();
      camera.lookAt(target);
    }
  }
}

/** &from=x,y,z&at=x,y,z overrides the camera (debug views). */
function override(): void {
  const from = params.get('from');
  const at = params.get('at');
  if (!from || !at) return;
  camera.position.set(...(from.split(',').map(Number) as [number, number, number]));
  camera.fov = Number(params.get('fov') ?? 40);
  camera.updateProjectionMatrix();
  camera.lookAt(new Vector3(...(at.split(',').map(Number) as [number, number, number])));
}

async function main(): Promise<void> {
  if (view === 'list') {
    window.__list = worldGallery().map((e) => ({ id: e.id, states: e.states.map((s) => s.name) }));
    return;
  }
  try {
    build();
    override();
    await labelFontsReady();
    for (let i = 0; i < 3; i++) {
      tickKit(T + i * 0.001);
      renderer.render(scene, camera);
      await new Promise((r) => requestAnimationFrame(r));
    }
    tickKit(T);
    renderer.render(scene, camera);
    const probe: string[] = [];
    const want = params.get('probe');
    if (want) scene.traverse((o) => {
      if (o.name.includes(want)) probe.push(`${o.name} vis=${o.visible} world=${o.getWorldPosition(new Vector3()).toArray().map((v) => v.toFixed(3))} mat=${((o as Mesh).material as { name?: string } | undefined)?.name}`);
    });
    window.__info = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, probe, perf: (window as unknown as { __perf?: unknown }).__perf };
    window.__ready = true;
  } catch (error) {
    window.__error = String((error as Error)?.stack ?? error);
    window.__ready = true;
  }
}
void main();
