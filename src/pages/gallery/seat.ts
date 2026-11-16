/**
 * Two composed records of the gallery (task 01.3.5):
 *
 *   Seat frame     the home, the arc in the middle of a run and the growing plot, laid out
 *                  as design/frame-D-seat.png, seen from the seated eye, so a reviewer
 *                  compares one frame with the sketch. Built from the world kit
 *                  (src/kit/world/, package 01.2) when it is there.
 *   Bench layout   every bench object of LAYOUT from above, with its azimuth and distance,
 *                  in the ordinary and the narrow (glasses) variant side by side.
 */
import {
  Box3,
  BoxGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import type { App } from '../../app/boot/world';
import { COLOR, LAYOUT, SEAT, polar, type BenchItem, type Place } from '../../tokens/tokens';

type Label = { text: string; at: Vector3; kind: 'entry' | 'state' };
type Built = { labels: Label[]; dispose(): void; bounds: Box3 };

const ITEMS: BenchItem[] = ['inbox', 'firstStake', 'runCard', 'traySent', 'trayFool', 'voiceStone', 'modeSwitch', 'settingsTile', 'keyIsland', 'keySend'];
const NAMES: Record<BenchItem, string> = {
  inbox: 'Inbox',
  firstStake: 'First stake',
  runCard: 'Run card',
  traySent: 'Sent back',
  trayFool: 'Try to fool',
  voiceStone: 'Voice stone',
  modeSwitch: 'Void and Room',
  settingsTile: 'Settings',
  keyIsland: 'Island key',
  keySend: 'Send key',
};

function benchPlan(places: Record<BenchItem, Place>, labels: Label[], offsetX: number, title: string): Group {
  const g = new Group();
  const slab = new Mesh(new BoxGeometry(LAYOUT.bench.w, 0.01, LAYOUT.bench.d), new MeshBasicMaterial({ color: COLOR.slate }));
  slab.position.set(0, -0.005, -LAYOUT.bench.dist);
  g.add(slab);
  // Arcs of the hand zone, 0.45 and 0.62 m from the head.
  for (const r of [SEAT.handZone.min, SEAT.handZone.max]) {
    const ring = new Mesh(new RingGeometry(r - 0.002, r + 0.002, 96, 1, Math.PI / 2 - 0.62, 1.24), new MeshBasicMaterial({ color: COLOR.outline }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.001;
    g.add(ring);
  }
  const eye = new Mesh(new CircleGeometry(0.012, 24), new MeshBasicMaterial({ color: COLOR.cobalt }));
  eye.rotation.x = -Math.PI / 2;
  g.add(eye);
  for (const item of ITEMS) {
    const p = places[item];
    const at = polar(p.az, p.dist, 0);
    const color = item === 'firstStake' ? COLOR.cobalt : item === 'voiceStone' ? COLOR.slateEdge : COLOR.bone;
    const box = new Mesh(new BoxGeometry(p.w, Math.max(0.002, p.h), p.d), new MeshStandardMaterial({ color, roughness: 0.6, metalness: 0 }));
    box.position.set(at.x, Math.max(0.002, p.h) / 2 + 0.001, at.z);
    g.add(box);
    labels.push({ text: `${NAMES[item]} ${p.az}°, ${p.dist.toFixed(2)} m`, at: new Vector3(at.x + offsetX - p.w / 2, 0, at.z), kind: 'state' });
  }
  labels.push({ text: title, at: new Vector3(offsetX - LAYOUT.bench.w / 2, 0, -0.06), kind: 'entry' });
  g.position.x = offsetX;
  return g;
}

export async function buildBenchLayout(app: App, root: Group): Promise<Built> {
  void app;
  const labels: Label[] = [];
  const holder = new Group();
  holder.add(benchPlan(LAYOUT as unknown as Record<BenchItem, Place>, labels, -0.55, 'Quest: every object within ±32°'), benchPlan(LAYOUT.narrow, labels, 0.55, 'Glasses: narrow layout within ±26.5°'));
  // Seen from above: turn the plan up to face the overview camera and hang it on the wall.
  holder.rotation.x = Math.PI / 2;
  holder.position.set(0, 0.2, -2.2);
  root.add(holder);
  holder.updateWorldMatrix(true, true);
  // Labels were written in plan coordinates; carry them through the same turn.
  for (const l of labels) l.at.applyMatrix4(holder.matrix);
  root.updateWorldMatrix(true, true);
  const bounds = new Box3().setFromObject(root);
  return { labels, bounds, dispose: () => root.clear() };
}

type Kit = Record<string, unknown>;

async function loadKit(): Promise<Kit> {
  const kit: Kit = {};
  const mods = import.meta.glob('../../kit/world/**/*.ts') as Record<string, () => Promise<Record<string, unknown>>>;
  for (const load of Object.values(mods)) {
    const mod = await load().catch(() => null);
    if (mod) Object.assign(kit, mod);
  }
  return kit;
}

const call = <T>(fn: unknown, ...args: unknown[]): T | null => {
  if (typeof fn !== 'function') return null;
  try {
    return fn(...args) as T;
  } catch (error) {
    console.error('[gw] seat frame: a kit call failed', error);
    return null;
  }
};

const objectOf = (x: unknown): Object3D | null => {
  if (!x) return null;
  if ((x as Object3D).isObject3D) return x as Object3D;
  const r = (x as { root?: Object3D; handle?: Object3D }).root ?? (x as { handle?: Object3D }).handle;
  return r && r.isObject3D ? r : null;
};

/**
 * The seated frame mid-run (design/frame-D-seat.png): home plot and bench, the arc with
 * five stakes, four Extractors at their spots, the gate busy, a third of the plot laid.
 */
export async function buildSeatFrame(app: App, root: Group): Promise<Built> {
  const kit = await loadKit();
  const labels: Label[] = [];
  const missing: string[] = [];
  const add = (name: string, made: unknown, at?: (o: Object3D) => void): void => {
    const o = objectOf(made);
    if (!o) {
      missing.push(name);
      return;
    }
    at?.(o);
    if (!o.parent) root.add(o);
  };
  call(kit.createSky, app.world) ?? missing.push('sky');
  call(kit.createLight, app.world) ?? missing.push('light');
  add('home plot', call(kit.createHomePlot));
  const bench = call<{ root?: Object3D }>(kit.createBench);
  add('bench', bench);
  add('inbox', call(kit.createInbox), (o) => {
    const p = polar(LAYOUT.inbox.az, LAYOUT.inbox.dist, -SEAT.benchBelowEyes);
    o.position.set(p.x, p.y, p.z);
  });
  add('first stake', call(kit.createFirstStake), (o) => {
    const p = polar(LAYOUT.firstStake.az, LAYOUT.firstStake.dist, -SEAT.benchBelowEyes);
    o.position.set(p.x, p.y, p.z);
  });
  const path = call<{ root?: Object3D; setPlan?: (s: unknown[], o: unknown) => void; setStation?: (id: string, s: string, k: number) => void }>(kit.createPath);
  add('arc', path);
  try {
    path?.setPlan?.(
      [
        { id: 's1', step: 'read', label: 'Read', by: 'code' },
        { id: 's2', step: 'extract', label: 'Extract', by: 'model', role: 'extractor' },
        { id: 's3', step: 'verify', label: 'Check', by: 'code' },
        { id: 's4', step: 'reconcile', label: 'Reconcile', by: 'model', role: 'reconciler' },
        { id: 's5', step: 'assemble', label: 'Assemble', by: 'code' },
      ],
      { radius: LAYOUT.arc.dist, from: LAYOUT.arc.from, to: LAYOUT.arc.to },
    );
    path?.setStation?.('s1', 'done', 1);
    path?.setStation?.('s2', 'active', 0.5);
    path?.setStation?.('s3', 'active', 0.45);
  } catch (error) {
    console.error('[gw] seat frame: the arc did not take its plan', error);
  }
  const sector = call<{ root?: Object3D; setOutline?: (on: boolean) => void; setGrid?: (n: number) => void; layTile?: (i: number) => void }>(kit.createSector, { slot: 0, seed: 7 });
  add('growing plot', sector);
  try {
    sector?.setOutline?.(true);
    sector?.setGrid?.(128);
    for (let i = 0; i < 42; i++) sector?.layTile?.(i);
  } catch (error) {
    console.error('[gw] seat frame: the plot did not lay its tiles', error);
  }
  const pool = call<{ root?: Object3D; spawn?: (role: string, id?: string) => { moveTo?: (p: unknown) => void; work?: (on: boolean) => void } }>(kit.createInstruments, app.world, 6);
  add('instruments', pool);
  try {
    for (let i = 0; i < 4; i++) {
      const one = pool?.spawn?.('extractor', `call-${i}`);
      const spot = (path as unknown as { spot?: (s: string, i: number) => unknown })?.spot?.('s2', i);
      if (spot) one?.moveTo?.(spot);
      one?.work?.(true);
    }
  } catch (error) {
    console.error('[gw] seat frame: the instruments did not take their spots', error);
  }
  if (missing.length > 0) {
    labels.push({ text: `Not in the world kit yet: ${missing.join(', ')}`, at: new Vector3(-0.5, 0.2, -1.5), kind: 'entry' });
    // A plain stand-in of the slab keeps the frame readable meanwhile.
    if (missing.includes('bench')) {
      const slab = new Mesh(new BoxGeometry(LAYOUT.bench.w, LAYOUT.bench.h, LAYOUT.bench.d), new MeshStandardMaterial({ color: COLOR.slate, roughness: 0.6, metalness: 0 }));
      slab.position.set(0, -SEAT.benchBelowEyes - LAYOUT.bench.h / 2, -LAYOUT.bench.dist);
      root.add(slab);
    }
  }
  root.updateWorldMatrix(true, true);
  return { labels, bounds: new Box3().setFromObject(root), dispose: () => root.clear() };
}
