/**
 * Entries of the state gallery for the world kit (PLAN "Набор ремесла": worldGallery).
 * The gallery page of 01.3 renders every state with the camera from the seat; each
 * built object stands where it stands in the product (seated frame) and carries a camera
 * hint in `userData.frame` ({ target, dist } or { target, from }, metres, seated frame).
 *
 * States that are moments of a movement loop: they replay their stamps every period, so
 * the gallery shows the movement itself and a frame at any time is reproducible.
 */
import { Object3D, Vector3 } from '@iwsdk/core';
import type { CheckedItem, EnvelopeSpec, ObjectSpec, Plot, Station } from '../../agents/types';
import type { App } from '../../app/boot/world';
import type { World } from '@iwsdk/core';
import { LAYOUT, SEAT, polar } from '../../tokens/tokens';
import { createBench, slotPoint } from './bench';
import { createDome } from './dome';
import { createEnvelope } from './envelope';
import { createFirstStake } from './first-stake';
import { createGhostHand } from './ghost-hand';
import { placeGrabbable } from './grabbable';
import { createHomePlot } from './home';
import { createInbox } from './inbox';
import { createInstruments } from './instrument';
import { createIsland } from './island';
import { createMechanism } from './mechanism';
import { createModeSwitch } from './mode-switch';
import { createNotebookFan } from './notebook-fan';
import { createObject } from './objects/object';
import { LIBRARY_KINDS, type LibraryKind } from './objects/library';
import { createStepCard } from './step-card';
import { createPairTags } from './pair-tags';
import { createPath, arcPoint, SHELF } from './path';
import { createSector, surfaceY } from './sector';
import { createSettingsTile } from './settings-tile';
import { createSky } from './sky';
import { createLight } from './light';
import { createSlip } from './slip';
import { createThread } from './thread';
import { createToken } from './token';
import { createTray } from './tray';
import { animate, atTime, now } from './time';
import { createVoiceStone } from './voice-stone';
import type { CarryKind, MechanismKind, ObjectFlag, SlipMark, ThreadState } from './types';

export type GalleryCtx = { world: World | null; app: App | null };
export type GalleryEntry = { id: string; title: string; states: { name: string; build(ctx: GalleryCtx): Object3D | HTMLElement }[] };

const TOP = -SEAT.benchBelowEyes;
type V3 = [number, number, number];

/** Runs `fn` long enough ago that every movement it starts has settled. */
const past = <T>(fn: () => T): T => atTime(now() - 60_000, fn);

function framed(obj: Object3D, target: V3, dist = 0.5, from?: V3, fov?: number): Object3D {
  obj.userData.frame = { target, dist, from, fov };
  return obj;
}

/** Replays `run(start)` at the start of every period: a movement that loops. */
function loop(group: Object3D, period: number, run: (start: number) => void): void {
  let last = Number.NaN;
  animate({
    root: group,
    update(t) {
      const cycle = Math.floor(t / period);
      if (cycle === last) return;
      last = cycle;
      atTime(cycle * period, () => run(cycle * period));
    },
  });
}

const group = (name: string): Object3D => {
  const g = new Object3D();
  g.name = `gallery:${name}`;
  return g;
};

const p3 = (v: Vector3): V3 => [v.x, v.y, v.z];

const CASE: Station[] = [
  { id: 's1', step: 'read', label: 'Read', by: 'code' },
  { id: 's2', step: 'extract', label: 'Extract', by: 'model', role: 'extractor' },
  { id: 's3', step: 'verify', label: 'Check', by: 'code' },
  { id: 's4', step: 'reconcile', label: 'Reconcile', by: 'model', role: 'reconciler' },
  { id: 's5', step: 'assemble', label: 'Assemble', by: 'code' },
];

/** A generic plan of n steps (any task runs through one engine). */
const plan = (n: number): Station[] => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, step: i % 3 === 1 ? 'extract' : 'read', label: `Step ${i + 1}`, by: i % 3 === 1 ? 'model' : 'code' }));

const ENVELOPES: EnvelopeSpec[] = [
  { id: 'harbor', kind: 'sample', lines: ['Harbor Street, Unit 4B', '64 pages, 12 documents'], example: 'harbor-street', job: 'case' },
  { id: 'wedding', kind: 'sample', lines: ['Wedding', '84 guests, a wish letter'], example: 'wedding', job: 'seating' },
  { id: 'class', kind: 'sample', lines: ['Class 9B', '24 essays, 2 marked'], example: 'class-9b', job: 'essays' },
  { id: 'files', kind: 'files', lines: ['Your files', 'Send them from your phone'] },
  { id: 'late', kind: 'late', lines: ['2 late pages', 'Dana Whitlock, sample'] },
  { id: 'code', kind: 'code', lines: ['Enter a code', 'Visit or join'] },
];

const item = (id: string, reason: CheckedItem['reason']): CheckedItem => ({ id, kind: 'claim', status: 'rejected', reason, claim: 'I handed both sets of keys to Dana on 2 March' });

const PLOTS = (): Plot[] => {
  const base = { sample: true, visibility: 'public' as const, doneAt: '2026-11-14T10:00:00Z', tileRefs: [], passes: 1, perTile: 1 };
  return [
    { ...base, projectId: 'p0', slug: 'harbor-street', slot: 0, kind: 'case', title: 'Harbor Street, Unit 4B', object: { kind: 'case-stack', pages: 64, open: 6, closed: 1 }, tiles: 119, seed: 4, open: 6, total: 7, flag: 'none' },
    { ...base, projectId: 'p1', slug: 'wedding', slot: 1, kind: 'seating', title: 'Wedding at Port Maren', object: { kind: 'cake', rows: 3, tablesPerRow: [4, 4, 3] }, tiles: 84, seed: 8, open: 1, total: 23, flag: 'question' },
    { ...base, projectId: 'p2', slug: 'class-9b', slot: 2, kind: 'essays', title: 'Class 9B', object: { kind: 'notebooks', count: 24, review: 3 }, tiles: 72, seed: 12, open: 3, total: 24, flag: 'deadline' },
    { ...base, projectId: 'p3', slug: 'deposit', slot: 3, kind: 'case', title: 'Dana Whitlock, deposit dispute', object: { kind: 'case-stack', pages: 30, open: 2, closed: 3 }, tiles: 46, seed: 21, open: 2, total: 5, flag: 'pages' },
    { ...base, projectId: 'p4', slug: 'reunion', slot: 4, kind: 'seating', title: 'Reunion dinner', object: { kind: 'cake', rows: 2, tablesPerRow: [5, 3] }, tiles: 40, seed: 33, open: 0, total: 9, flag: 'guest' },
    { ...base, projectId: 'p5', slug: 'class-10a', slot: 5, kind: 'essays', title: 'Class 10A, unseen poetry', object: { kind: 'notebooks', count: 78, review: 9 }, tiles: 392, seed: 41, open: 9, total: 78, flag: 'stale' },
    { ...base, projectId: 'p6', slug: 'lease', slot: 6, kind: 'case', title: 'Pierline lease review', object: { kind: 'case-stack', pages: 400, open: 13, closed: 5 }, tiles: 1000, perTile: 3, seed: 55, open: 13, total: 18, flag: 'none' },
    { ...base, projectId: 'p7', slug: 'gala', slot: 7, kind: 'seating', title: 'School gala', sample: false, visibility: 'private', object: { kind: 'cake', rows: 4, tablesPerRow: [3, 3, 3, 2] }, tiles: 120, seed: 61, open: 0, total: 14, flag: 'none' },
  ];
};

/** A place at the arc's shelf for things standing on it. */
const shelfAt = (deg: number, r: number = LAYOUT.arc.rows.inner): Vector3 => arcPoint(deg, r);

function mechanismEntry(): GalleryEntry {
  const kinds: { kind: MechanismKind; pulse: Parameters<ReturnType<typeof createMechanism>['pulse']>[0] }[] = [
    { kind: 'cutter', pulse: 'cut' },
    { kind: 'gate', pulse: 'stamp' },
    { kind: 'assembly', pulse: 'lay' },
    { kind: 'solver', pulse: 'count' },
    { kind: 'scale', pulse: 'weigh' },
  ];
  const states: GalleryEntry['states'] = (['idle', 'busy', 'error'] as const).map((state) => ({
    name: state,
    build() {
      const g = group(`mechanisms-${state}`);
      kinds.forEach(({ kind, pulse }, i) => {
        const m = createMechanism(kind);
        const a = -26 + i * 13;
        const at = shelfAt(a);
        m.root.position.copy(at);
        m.root.rotation.y = (-a * Math.PI) / 180;
        past(() => m.setState(state));
        if (state === 'busy') loop(g, kind === 'scale' ? 1600 : 900, () => m.pulse(kind === 'gate' && i % 2 ? 'pass' : pulse));
        g.add(m.root);
      });
      return framed(g, [0, -0.45, -1.27], 0, [0, 0, 0]);
    },
  }));
  states.push({
    name: 'gate pass',
    build() {
      const g = group('gate-pass');
      const m = createMechanism('gate');
      m.root.position.copy(shelfAt(0));
      g.add(m.root);
      loop(g, 1200, () => {
        m.pulse('pass');
        atTime(now() + 500, () => m.pulse('stamp'));
      });
      return framed(g, [0, -0.43, -1.27], 0.45);
    },
  });
  return { id: 'mechanisms', title: 'Mechanisms of the arc', states };
}

function instrumentEntry(): GalleryEntry {
  const line = (name: string, setup: (pool: ReturnType<typeof createInstruments>, path: ReturnType<typeof createPath>, g: Object3D) => void) => ({
    name,
    build() {
      const g = group(`instruments-${name}`);
      const path = createPath();
      past(() => path.setPlan(CASE));
      const pool = createInstruments(null);
      g.add(path.root, pool.root);
      setup(pool, path, g);
      return framed(g, [-0.2, -0.43, -1.3], 0, [0, 0, 0]);
    },
  });
  const carries: CarryKind[] = ['page', 'cards', 'spool', 'slips', 'pencil'];
  return {
    id: 'instruments',
    title: 'Walking instruments',
    states: [
      line('folded at the parking', () => {}),
      line('every load', (pool, path) => {
        carries.forEach((kind, i) => {
          const inst = past(() => pool.spawn(i === 2 ? 'reconciler' : i === 4 ? 'marker' : 'extractor', `c${i}`));
          past(() => {
            inst.moveTo(path.lane(-20 + i * 9));
            inst.carry(kind, kind === 'page' ? '1–6' : undefined);
            inst.hover(i === 0);
          });
        });
      }),
      line('work, sit, hop, fail', (pool, path, g) => {
        const [work, sit, hop, fail] = [0, 1, 2, 3].map((i) => past(() => pool.spawn('extractor', `w${i}`)));
        past(() => {
          work.moveTo(path.spot('s2', 0));
          work.carry('page', '7–12');
          work.face(path.spot('s2', 0).clone().setZ(path.spot('s2', 0).z + 0.1));
          work.work(true);
          sit.moveTo(path.spot('s2', 1));
          sit.carry('page');
          sit.sit(true);
          hop.moveTo(path.spot('s2', 2));
          hop.carry('cards');
          fail.moveTo(path.spot('s2', 3));
          fail.carry('page');
          fail.fail();
        });
        loop(g, 1400, () => hop.hop());
      }),
      line('walking to Extract and Reconcile', (pool, path, g) => {
        let all = [0, 1, 2, 3, 4, 5].map((i) => past(() => pool.spawn(i < 4 ? 'extractor' : 'reconciler', `w${i}`)));
        loop(g, 3200, (start) => {
          atTime(start - 4000, () => all.forEach((w) => w.fold()));
          atTime(start, () => {
            all = [0, 1, 2, 3, 4, 5].map((i) => pool.spawn(i < 4 ? 'extractor' : 'reconciler', `w${i}`));
            all.forEach((w, i) => {
              w.moveTo(i < 4 ? path.spot('s2', i) : path.spot('s4', i - 4));
              w.carry(i < 4 ? 'page' : 'spool');
            });
          });
        });
      }),
    ],
  };
}

function sectorEntry(): GalleryEntry {
  const s = (name: string, run: (sector: ReturnType<typeof createSector>, g: Object3D) => void) => ({
    name,
    build() {
      const g = group(`sector-${name}`);
      const sector = createSector({ slot: 0, seed: 5 });
      g.add(sector.root);
      run(sector, g);
      return framed(g, [0, -0.38, -1.8], 0, [0, 0, 0]);
    },
  });
  const lay = (sector: ReturnType<typeof createSector>, planned: number, n: number, close: boolean) =>
    past(() => {
      sector.setOutline(true);
      sector.setGrid(planned);
      if (n > 0) sector.layRow(0, n - 1);
      if (close) sector.close(n);
    });
  return {
    id: 'sector',
    title: 'Plot of tiles',
    states: [
      s('outline', (sector) => lay(sector, 124, 0, false)),
      s('a third laid', (sector) => lay(sector, 124, 41, false)),
      s('laying, live', (sector, g) =>
        loop(g, 9000, (start) => {
          sector.clear(0);
          sector.setOutline(true);
          sector.setGrid(124);
          for (let i = 0; i < 60; i++) atTime(start + 300 + i * 90, () => sector.layTile(i));
          atTime(start + 6000, () => sector.layRow(60, 79));
        }),
      ),
      s('closing 119', (sector, g) =>
        loop(g, 4000, (start) => {
          sector.clear(0);
          sector.setOutline(true);
          sector.setGrid(124);
          sector.layRow(0, 118);
          atTime(start + 1500, () => sector.close(119));
        }),
      ),
      s('closed 119', (sector) => lay(sector, 124, 119, true)),
      s('closed 392', (sector) => lay(sector, 392, 392, true)),
      s('closed 1000 (3 per tile)', (sector) => lay(sector, 1000, 1000, true)),
      s('plot of 4', (sector) => lay(sector, 4, 4, true)),
      s('with a new course', (sector) => {
        lay(sector, 124, 119, true);
        past(() => sector.addCourse(3));
      }),
      s('bordered', (sector) => {
        lay(sector, 124, 119, true);
        past(() => sector.setState('bordered'));
      }),
      s('clearing', (sector, g) =>
        loop(g, 3000, (start) => {
          atTime(start - 10_000, () => {
            sector.setGrid(124);
            sector.layRow(0, 118);
          });
          atTime(start + 600, () => sector.clear(1400));
        }),
      ),
    ],
  };
}

function pathEntry(): GalleryEntry {
  const s = (name: string, run: (path: ReturnType<typeof createPath>, g: Object3D) => void) => ({
    name,
    build() {
      const g = group(`path-${name}`);
      const path = createPath();
      const pool = createInstruments(null);
      g.add(path.root, pool.root);
      run(path, g);
      return framed(g, [0, -0.4, -1.3], 0, [0, 0, 0]);
    },
  });
  return {
    id: 'path',
    title: 'Run arc',
    states: [
      s('plan rising', (path, g) => loop(g, 2600, () => path.setPlan(CASE))),
      s('plan', (path) => past(() => path.setPlan(CASE))),
      s('running', (path) =>
        past(() => {
          path.setPlan(CASE);
          path.setStation('s1', 'done');
          path.setStation('s2', 'active', 0.6);
          path.setStation('s3', 'active', 0.4);
        }),
      ),
      s('waiting', (path) =>
        past(() => {
          path.setPlan(CASE);
          path.setStation('s1', 'done');
          path.setStation('s2', 'waiting');
        }),
      ),
      s('asking', (path) =>
        past(() => {
          path.setPlan(CASE);
          ['s1', 's2', 's3'].forEach((id) => path.setStation(id, 'done'));
          path.setStation('s4', 'asking');
        }),
      ),
      s('error', (path) =>
        past(() => {
          path.setPlan(CASE);
          path.setStation('s1', 'done');
          path.setStation('s2', 'error');
        }),
      ),
      s('done', (path) =>
        past(() => {
          path.setPlan(CASE);
          CASE.forEach((st) => path.setStation(st.id, 'done'));
        }),
      ),
      s('eight stations', (path) => past(() => path.setPlan(plan(8)))),
      s('twelve stations', (path) =>
        past(() => {
          path.setPlan(plan(12));
          plan(12).forEach((st, i) => path.setStation(st.id, i < 5 ? 'done' : i === 5 ? 'active' : 'pending'));
        }),
      ),
      s('four stations', (path) => past(() => path.setPlan(CASE.slice(0, 4)))),
      s('three stations', (path) => past(() => path.setPlan(CASE.slice(0, 3)))),
      s('retracting', (path, g) =>
        loop(g, 2400, (start) => {
          atTime(start - 5000, () => path.setPlan(CASE));
          atTime(start + 400, () => path.retract());
        }),
      ),
    ],
  };
}

function objectEntry(): GalleryEntry {
  const specs: { name: string; spec: ObjectSpec }[] = [
    { name: 'case stack, 64 pages, 6 open', spec: { kind: 'case-stack', pages: 64, open: 6, closed: 0 } },
    { name: 'case stack, 64 pages, 5 closed', spec: { kind: 'case-stack', pages: 64, open: 0, closed: 5 } },
    { name: 'case stack, 400 pages, 6 open', spec: { kind: 'case-stack', pages: 400, open: 6, closed: 0 } },
    { name: 'case stack, 400 pages, 14 open', spec: { kind: 'case-stack', pages: 400, open: 14, closed: 5 } },
    { name: 'cake, three rows', spec: { kind: 'cake', rows: 3, tablesPerRow: [4, 4, 3] } },
    { name: 'notebooks, 24', spec: { kind: 'notebooks', count: 24, review: 3 } },
    { name: 'notebooks, 78', spec: { kind: 'notebooks', count: 78, review: 9 } },
  ];
  const at = new Vector3(0, surfaceY(1.7) - 0.008, -1.7);
  const states: GalleryEntry['states'] = specs.map(({ name, spec }) => ({
    name,
    build() {
      const g = group(`object-${name}`);
      const o = createObject(spec);
      o.root.position.copy(at);
      g.add(o.root);
      return framed(g, [at.x, at.y + 0.12, at.z], 0.85);
    },
  }));
  const flags: (ObjectFlag | 'stale')[] = ['pages', 'deadline', 'guest', 'question', 'stale'];
  states.push(
    {
      name: 'growing',
      build() {
        const g = group('object-growing');
        const o = createObject({ kind: 'case-stack', pages: 64, open: 6, closed: 0 });
        o.root.position.copy(at);
        g.add(o.root);
        loop(g, 2200, () => o.setState('growing'));
        return framed(g, [at.x, at.y + 0.12, at.z], 0.85);
      },
    },
    {
      name: 'selected with buttons',
      build() {
        const g = group('object-selected');
        const o = createObject({ kind: 'cake', rows: 3, tablesPerRow: [4, 4, 3] });
        o.root.position.copy(at);
        past(() => {
          o.setButtons([
            { id: 'open', label: 'Open' },
            { id: 'rerun', label: 'Run again' },
            { id: 'share', label: 'Share' },
            { id: 'more', label: 'More' },
          ]);
          o.setState('selected', true);
        });
        g.add(o.root);
        return framed(g, [at.x, at.y + 0.1, at.z + 0.1], 1.0);
      },
    },
    {
      name: 'every flag',
      build() {
        const g = group('object-flags');
        flags.forEach((flag, i) => {
          const o = createObject({ kind: 'notebooks', count: 12, review: 0 });
          const a = ((-28 + i * 14) * Math.PI) / 180;
          o.root.position.set(1.7 * Math.sin(a), surfaceY(1.7), -1.7 * Math.cos(a));
          o.root.rotation.y = -a;
          past(() => o.setFlag(flag, flag === 'deadline'));
          if (flag === 'stale') past(() => o.setState('stale', true));
          g.add(o.root);
        });
        return framed(g, [0, -0.3, -1.7], 0, [0, 0, 0]);
      },
    },
  );
  return { id: 'objects', title: 'Objects of the three jobs', states };
}

function libraryEntry(): GalleryEntry {
  const at = new Vector3(0, surfaceY(1.7) - 0.008, -1.7);
  const one = (kind: LibraryKind, units: number, open: number) => ({
    name: `${kind}, ${units} units, ${open} open`,
    build() {
      const g = group(`library-${kind}-${units}`);
      const o = createObject({ kind, units, open });
      o.root.position.copy(at);
      g.add(o.root);
      return framed(g, [at.x, at.y + 0.12, at.z], 0.85);
    },
  });
  return {
    id: 'library',
    title: 'Objects chosen by meaning',
    states: [
      ...LIBRARY_KINDS.map((k) => one(k, 60, 2)),
      ...LIBRARY_KINDS.map((k) => one(k, 300, 0)),
      {
        name: 'all on the ring',
        build() {
          const g = group('library-ring');
          LIBRARY_KINDS.forEach((kind, i) => {
            const o = createObject({ kind, units: 80, open: i % 3 });
            const a = ((-60 + i * 15) * Math.PI) / 180;
            o.root.position.set(1.7 * Math.sin(a), surfaceY(1.7), -1.7 * Math.cos(a));
            o.root.rotation.y = -a;
            g.add(o.root);
          });
          return framed(g, [0, -0.3, -1.7], 0, [0, 0, 0], 80);
        },
      },
    ],
  };
}

function stepCardEntry(): GalleryEntry {
  return {
    id: 'step-card',
    title: 'Step card on its way to a tile',
    states: [
      {
        name: 'flying to the plot',
        build() {
          const g = group('step-card');
          const sector = createSector({ slot: 0, seed: 5 });
          g.add(sector.root);
          past(() => {
            sector.setOutline(true);
            sector.setGrid(60);
            sector.layRow(0, 9);
          });
          const cards = [0, 1, 2].map((i) => {
            const c = createStepCard(['Keys returned', 'Rent paid', 'Notice served'][i]);
            g.add(c.root);
            return c;
          });
          loop(g, 1800, (start) => {
            cards.forEach((c, i) =>
              atTime(start + i * 160, () => {
                const to = sector.tilePosition(10 + i);
                c.send(arcPoint(0, LAYOUT.arc.rows.inner).setY(-0.42), to);
              }),
            );
          });
          return framed(g, [0, -0.42, -1.5], 0, [0, 0, 0], 50);
        },
      },
    ],
  };
}

export function worldGallery(): GalleryEntry[] {
  const benchPoint = (name: Parameters<typeof slotPoint>[0]): Vector3 => slotPoint(name);
  return [
    {
      id: 'sky',
      title: 'Sky, light and home plot',
      states: (['void', 'dissolving', 'room'] as const).map((mode) => ({
        name: mode,
        build(ctx: GalleryCtx) {
          const g = group(`sky-${mode}`);
          const sky = createSky(ctx.world);
          const light = createLight(ctx.world);
          const home = createHomePlot();
          home.position.set(0, -0.55, 0);
          g.add(sky.root, light.root, home);
          if (mode === 'room') past(() => sky.setMode('room'));
          if (mode === 'dissolving') loop(g, 2400, () => sky.setMode(sky.mode === 'void' ? 'room' : 'void'));
          return framed(g, [0, -0.1, -1], 0, [0, 0, 0]);
        },
      })),
    },
    {
      id: 'bench',
      title: 'Bench with the objects of entry',
      states: (['home', 'pin down', 'side service', 'work view keys', 'narrow glasses'] as const).map((name) => ({
        name,
        build() {
          const g = group(`bench-${name}`);
          const bench = createBench({ narrow: name === 'narrow glasses' });
          g.add(bench.root);
          const inbox = createInbox();
          bench.attach('inbox', inbox.root);
          past(() => {
            inbox.offer(ENVELOPES.slice(0, 4));
            inbox.setPin(name !== 'pin down');
          });
          bench.attach('firstStake', createFirstStake());
          bench.attach('voiceStone', createVoiceStone().root);
          bench.attach('modeSwitch', createModeSwitch().root);
          bench.attach('settingsTile', createSettingsTile());
          const sent = createTray('sent-back');
          bench.attach('traySent', sent.root);
          if (name === 'side service') past(() => bench.setService('side'));
          if (name === 'work view keys') {
            bench.addKey({ id: 'island', label: 'Island', at: 'far-left' });
            bench.addKey({ id: 'export', label: 'Send to phone', at: 'far-right' });
            sent.root.visible = false;
          } else {
            const fool = createTray('fool');
            bench.attach('trayFool', fool.root);
          }
          return framed(g, [0, TOP, -0.45], 0, [0, 0, 0], 75);
        },
      })),
    },
    {
      id: 'inbox',
      title: 'Inbox block',
      states: (['empty, pin down', 'pin up, envelopes', 'fanned', 'one taken'] as const).map((name) => ({
        name,
        build() {
          const g = group(`inbox-${name}`);
          const inbox = createInbox();
          inbox.root.position.copy(benchPoint('inbox'));
          g.add(inbox.root);
          past(() => {
            if (name !== 'empty, pin down') {
              inbox.offer(ENVELOPES.slice(0, 4));
              inbox.setPin(true);
            }
            if (name === 'fanned') inbox.setFan(true);
            if (name === 'one taken') {
              const env = inbox.take('harbor');
              if (env) {
                env.handle.position.set(0.1, 0.1, 0.12);
                env.handle.rotation.set(0.9, 0.25, 0);
                env.setState('held');
              }
            }
          });
          if (name === 'pin up, envelopes') loop(g, 2000, () => inbox.setPin(true));
          const p = benchPoint('inbox');
          return framed(g, [p.x, p.y + 0.04, p.z], 0.42);
        },
      })),
    },
    {
      id: 'envelope',
      title: 'Envelopes',
      states: [
        ...ENVELOPES.map((spec) => ({
          name: `${spec.kind}: ${spec.lines[0]}`,
          build() {
            const g = group(`envelope-${spec.id}`);
            const env = createEnvelope(spec);
            placeGrabbable(env, g);
            env.handle.position.set(0, TOP, -0.45);
            return framed(g, [0, TOP, -0.45], 0.3);
          },
        })),
        ...(['held', 'open', 'large text'] as const).map((state) => ({
          name: state,
          build() {
            const g = group(`envelope-${state}`);
            const env = createEnvelope(ENVELOPES[0], { large: state === 'large text' });
            placeGrabbable(env, g);
            env.handle.position.set(0, TOP + (state === 'held' ? 0.1 : 0), -0.45);
            if (state === 'held') past(() => env.setState('held'));
            if (state === 'open') loop(g, 2200, () => env.setState(env.state === 'open' ? 'rest' : 'open'));
            return framed(g, [0, TOP + 0.03, -0.45], 0.35);
          },
        })),
      ],
    },
    {
      id: 'small',
      title: 'First stake, mode cap, voice stone, settings tile',
      states: [
        { name: 'first stake', build: () => framed(onBench(createFirstStake(), 'firstStake'), p3(benchPoint('firstStake')), 0.3) },
        ...(['void', 'room', 'turning'] as const).map((mode) => ({
          name: `mode cap: ${mode}`,
          build() {
            const sw = createModeSwitch();
            const g = onBench(sw.root, 'modeSwitch');
            if (mode === 'room') past(() => sw.setMode('room'));
            if (mode === 'turning') loop(g, 1600, () => sw.setMode(sw.mode === 'void' ? 'room' : 'void'));
            return framed(g, p3(benchPoint('modeSwitch')), 0.22);
          },
        })),
        ...(['idle', 'listening low', 'listening high', 'thinking', 'dim', 'nudge'] as const).map((state) => ({
          name: `voice stone: ${state}`,
          build() {
            const vs = createVoiceStone();
            const g = onBench(vs.root, 'voiceStone');
            past(() => {
              if (state === 'listening low') vs.setState('listening', 0.2);
              if (state === 'listening high') vs.setState('listening', 0.9);
              if (state === 'thinking') vs.setState('thinking');
              if (state === 'dim') vs.setState('dim');
            });
            if (state === 'nudge') loop(g, 1400, () => vs.nudge());
            return framed(g, p3(benchPoint('voiceStone')), 0.22);
          },
        })),
        { name: 'settings tile', build: () => framed(onBench(createSettingsTile(), 'settingsTile'), p3(benchPoint('settingsTile')), 0.22) },
        { name: 'token', build: () => framed(onBench(createToken('Ayasha'), 'firstStake'), p3(benchPoint('firstStake')), 0.25) },
      ],
    },
    {
      id: 'trays',
      title: 'Trays and slips',
      states: [
        ...(['sent back, empty', 'sent back, six', 'fool, stamping'] as const).map((name) => ({
          name,
          build() {
            const kind = name.startsWith('fool') ? 'fool' : 'sent-back';
            const tray = createTray(kind);
            const g = onBench(tray.root, kind === 'fool' ? 'trayFool' : 'traySent');
            const reasons: CheckedItem['reason'][] = ['quote-not-found', 'quote-altered', 'date-mismatch', 'unknown-actor', 'weekday-mismatch', 'quote-too-short'];
            if (name === 'sent back, six') past(() => reasons.forEach((r, i) => tray.add(createSlip(item(`s${i}`, r)))));
            if (kind === 'fool') {
              const probes: [string, string][] = [
                ['Change a', 'key word'],
                ['Wrong', 'date'],
                ['Wrong', 'person'],
                ['Wrong', 'page'],
              ];
              const slips = probes.map((c, i) => createSlip(item(`f${i}`, 'quote-altered'), { caption: c }));
              past(() => slips.forEach((s) => tray.add(s)));
              loop(g, 1500, () => tray.stamp(slips[slips.length - 1]));
            }
            const p = benchPoint(kind === 'fool' ? 'trayFool' : 'traySent');
            return framed(g, [p.x, p.y + 0.02, p.z], 0.3);
          },
        })),
        ...(['folded', 'half open', 'open', 'opening', 'large text'] as const).map((name) => ({
          name: `slip ${name}`,
          build() {
            const g = group(`slip-${name}`);
            const slip = createSlip(item('one', 'quote-not-found'));
            placeGrabbable(slip, g);
            slip.handle.position.set(0, TOP + 0.08, -0.4);
            slip.handle.rotation.x = 0.9;
            if (name === 'half open') slip.setOpen(0.5);
            if (name === 'open' || name === 'large text') slip.setOpen(1);
            if (name === 'large text') slip.setLarge(true);
            if (name === 'opening') loop(g, 1400, () => slip.unfold(slip.open < 0.5));
            return framed(g, [0, TOP + 0.08, -0.4], 0.38);
          },
        })),
        {
          name: 'slip marks',
          build() {
            const g = group('slip-marks');
            const marks: SlipMark[][] = [['stamp'], ['stamp', 'second-stamp'], ['stamp', 'check'], ['stamp', 'hole'], ['stamp', 'corner']];
            marks.forEach((m, i) => {
              const slip = createSlip(item(`m${i}`, i === 4 ? 'quote-wrong-page' : 'quote-altered'));
              placeGrabbable(slip, g);
              slip.handle.position.set(-0.18 + i * 0.09, TOP, -0.42);
              m.forEach((k) => slip.mark(k));
            });
            return framed(g, [0, TOP, -0.42], 0.42);
          },
        },
        {
          name: 'slip marks, open',
          build() {
            const g = group('slip-marks-open');
            const marks: SlipMark[][] = [['stamp', 'second-stamp'], ['stamp', 'check'], ['stamp', 'hole', 'corner']];
            marks.forEach((m, i) => {
              const slip = createSlip(item(`o${i}`, 'quote-altered'));
              placeGrabbable(slip, g);
              slip.handle.position.set(-0.2 + i * 0.2, TOP, -0.45);
              slip.setOpen(1);
              m.forEach((k) => slip.mark(k));
            });
            return framed(g, [0, TOP, -0.45], 0.55);
          },
        },
      ],
    },
    sectorEntry(),
    pathEntry(),
    mechanismEntry(),
    {
      id: 'pair-tags',
      title: 'Paired tags of the reconcile station',
      states: (['open', 'judged', 'released'] as const).map((name) => ({
        name,
        build() {
          const g = group(`pairs-${name}`);
          const tags = createPairTags();
          tags.root.position.copy(shelfAt(13, (SHELF.inner + SHELF.outer) / 2));
          tags.root.rotation.y = (-13 * Math.PI) / 180;
          g.add(tags.root);
          const keys = Array.from({ length: 14 }, (_, i) => ({ key: `e${i}|e${i + 20}` }));
          past(() => tags.set(keys));
          if (name !== 'open') {
            const verdicts = ['contradiction', 'explained', 'explained', 'contradiction', 'unsure', 'explained', 'contradiction', 'explained', 'unjudged', 'contradiction', 'explained', 'contradiction', 'explained', 'contradiction'] as const;
            past(() => keys.forEach((k, i) => tags.mark(k.key, verdicts[i])));
          }
          if (name === 'released') loop(g, 1800, (start) => {
            tags.set(keys);
            ['contradiction', 'explained', 'explained', 'contradiction'].forEach((v, i) => atTime(start - 1000, () => tags.mark(keys[i].key, v as 'contradiction')));
            atTime(start + 300, () => tags.release());
          });
          const p = shelfAt(13, 1.33);
          return framed(g, [p.x, p.y, p.z], 0.55);
        },
      })),
    },
    instrumentEntry(),
    objectEntry(),
    libraryEntry(),
    stepCardEntry(),
    {
      id: 'island',
      title: 'Island of eight plots',
      states: (['eight closed', 'turning', 'visitor', 'model 1:6'] as const).map((name) => ({
        name,
        build() {
          const g = group(`island-${name}`);
          const island = createIsland(name === 'model 1:6' ? 1 / 6 : 1, { visitor: name === 'visitor' });
          g.add(island.root);
          island.setPlots(PLOTS());
          if (name === 'turning') loop(g, 4000, () => island.rotateTo(island.rotation === 0 ? -90 : 0));
          if (name === 'model 1:6') {
            const p = polar(LAYOUT.roomIsland.az, LAYOUT.roomIsland.dist, TOP);
            island.root.position.set(p.x, TOP + 0.08, p.z);
            return framed(g, [p.x, TOP, p.z], 0.75);
          }
          return framed(g, [0, -0.2, -1.8], 0, name === 'visitor' ? [0, 0.4, 0.3] : [0, 0, 0]);
        },
      })),
    },
    {
      id: 'fan',
      title: 'Fan of notebooks',
      states: (['even', 'eight raised', 'one open', 'hover'] as const).map((name) => ({
        name,
        build() {
          const g = group(`fan-${name}`);
          const names = ['Ava Brennan', 'Theo Marsh', 'Nadia Ruiz', 'Owen Pike', 'Lena Holt', 'Ravi Shah', 'Maya Lund', 'Jonah Reed', 'Iris Vale', 'Felix Moor', 'Zara Quinn', 'Eli Stone', 'Mira Cole', 'Noah Frye', 'Ada Lowe', 'Sam Okafor', 'Ivy Chen', 'Leo Barros', 'Nina Kask', 'Omar Haddad', 'Ruth Ames', 'Tom Ilves', 'Uma Dar', 'Kai Sorensen'];
          const essays = names.map((n, i) => ({
            id: `e${i}`,
            name: n,
            initials: n
              .split(' ')
              .map((w) => w[0])
              .join(''),
            total: 6 + ((i * 7) % 17),
            max: 24,
            review: i % 8 === 3,
            similar: i === 5 || i === 6,
            tooShort: i === 0,
          }));
          essays.sort((a, b) => a.total - b.total);
          const fan = createNotebookFan(essays);
          g.add(fan.root);
          if (name === 'eight raised') past(() => fan.raise(essays.slice(4, 12).map((e) => e.id), true));
          if (name === 'one open') past(() => fan.open(essays[10].id));
          if (name === 'hover') past(() => fan.hover(essays[12].id));
          return framed(g, [0, TOP, -0.5], 0, [0, 0, 0]);
        },
      })),
    },
    {
      id: 'thread',
      title: 'Red thread',
      states: (['open', 'taut', 'kept', 'dismissed', 'resolved', 'reopened', 'added', 'new', 'pulled'] as ThreadState[] | string[]).map((state) => ({
        name: state,
        build() {
          const g = group(`thread-${state}`);
          const thread = createThread({ eyeDist: 0.6 });
          g.add(thread.root);
          const a = new Vector3(-0.16, -0.05, -0.62);
          const b = new Vector3(0.16, -0.02, -0.6);
          const s = (state === 'pulled' ? 'open' : state) as ThreadState;
          const note = s === 'resolved' ? 'Resolved by page 65' : undefined;
          thread.set({ a, b, label: 'Keys', state: s, note });
          if (state === 'pulled') thread.setPull(0.6);
          if (state === 'new') loop(g, 1500, () => thread.set({ a, b, label: 'Keys', state: 'new' }));
          return framed(g, [0, -0.08, -0.6], 0.5);
        },
      })),
    },
    {
      id: 'dome-hand',
      title: 'Dome and ghost hand',
      states: [
        {
          name: 'dome over a private plot',
          build() {
            const g = group('dome');
            const o = createObject({ kind: 'cake', rows: 3, tablesPerRow: [4, 4, 3] });
            const at = new Vector3(0, surfaceY(1.7), -1.7);
            o.root.position.copy(at);
            const d = createDome();
            d.position.copy(at);
            g.add(o.root, d);
            return framed(g, [at.x, at.y + 0.18, at.z], 1.0);
          },
        },
        ...(['carry', 'pull', 'pinch', 'lift'] as const).map((gesture) => ({
          name: `ghost hand: ${gesture}`,
          build() {
            const g = group(`hand-${gesture}`);
            const hand = createGhostHand();
            g.add(hand.root);
            const from = benchPoint('inbox').add(new Vector3(0, 0.05, 0.06));
            const to = benchPoint('firstStake').add(new Vector3(0, 0.03, 0));
            past(() => hand.show(gesture, from, gesture === 'carry' ? to : undefined));
            return framed(g, [(from.x + to.x) / 2, TOP + 0.08, (from.z + to.z) / 2], 0.55);
          },
        })),
      ],
    },
  ];

  function onBench(obj: Object3D, name: Parameters<typeof slotPoint>[0]): Object3D {
    const g = group(`bench-${name}`);
    obj.position.copy(benchPoint(name));
    g.add(obj);
    return g;
  }
}
