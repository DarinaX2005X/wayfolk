/**
 * The stage of a run in the world, driven by the engine's events (src/agents/types.ts
 * RunEvent): any plan becomes a trail of stations on the shelf, one lit instrument
 * walks out per open model call, code stations get their mechanism, every unit that
 * passes flies from its station as a small card and lands as a tile of the new plot,
 * and a verified tile lights its seams.
 *
 * Station signs are world labels on dark plates under one batch (a handful of draws
 * for up to twelve stations); each sign is a select target `station:<id>`.
 */
import { Object3D, Vector3, type Mesh } from '@iwsdk/core';
import type { AgentRole, MechanismKind as StepMechanism, Station } from '../../agents/types';
import type { App } from '../../app/boot/world';
import { zone } from '../../app/perf/zone';
import { createBatch } from '../../kit/world/batch';
import { bevelBox, box } from '../../kit/world/geom';
import { createInstruments } from '../../kit/world/instrument';
import { createLabel, setLabelText } from '../../kit/world/label';
import { part, proxyMesh, setMat, type KitMat } from '../../kit/world/materials';
import { createMechanism } from '../../kit/world/mechanism';
import { createPath } from '../../kit/world/path';
import { createSector } from '../../kit/world/sector';
import { createStepCard, type StepCard } from '../../kit/world/step-card';
import { animate, now } from '../../kit/world/time';
import type { Instrument, Mechanism, SectorView, StationState } from '../../kit/world/types';
import { COLOR, LAYOUT, PANEL } from '../../tokens/tokens';
import type { HomeScene } from '../scene';

export type SignState = 'pending' | 'active' | 'waiting' | 'asking' | 'error' | 'done' | 'redo';

type Sign = { id: string; node: Object3D; plate: Mesh; bar: Mesh; title: Mesh; count: Mesh; proxy: Mesh; state: SignState };

const SIGN = { w: 0.27, h: 0.066, d: 0.006 };
const BAR: Record<SignState, KitMat> = { pending: 'slateEdge', active: 'cobalt', waiting: 'amber', asking: 'amber', error: 'vermilion', done: 'moss', redo: 'cobalt' };
const PATH_STATE: Record<SignState, StationState> = { pending: 'pending', active: 'active', waiting: 'waiting', asking: 'asking', error: 'error', done: 'done', redo: 'active' };
const MECH: Record<StepMechanism, MechanismKindOfKit> = { cutter: 'cutter', gate: 'gate', assembly: 'assembly' };
type MechanismKindOfKit = 'cutter' | 'gate' | 'assembly';

export type Stage = ReturnType<typeof createStage>;

export function createStage(app: App, home: HomeScene) {
  const arc = app.roots.arc;
  const path = createPath();
  zone(path.root, 'arc');
  arc.add(path.root);
  const pool = createInstruments(app.world, 6);
  arc.add(pool.root);

  const signs = new Object3D();
  signs.name = 'run:signs';
  zone(signs, 'boards');
  arc.add(signs);
  createBatch(signs);

  const mechRoot = new Object3D();
  mechRoot.name = 'run:mechanisms';
  zone(mechRoot, 'arc');
  arc.add(mechRoot);
  createBatch(mechRoot);

  const cardsRoot = new Object3D();
  cardsRoot.name = 'run:cards';
  zone(cardsRoot, 'reserve');
  arc.add(cardsRoot);

  // ---- the meter: live numbers of the run in large type over the trail
  const meter = new Object3D();
  meter.name = 'run:meter';
  meter.visible = false;
  signs.add(meter);
  const METER = { dist: 1.36, y: -0.035, cells: [-0.36, -0.12, 0.12, 0.36] };
  const meterCells = [
    { value: '0/0', unit: 'steps done', color: COLOR.glass.text },
    { value: '0', unit: 'checks passed', color: COLOR.glass.okText },
    { value: '0', unit: 'sent back', color: COLOR.glass.dangerText },
    { value: '0', unit: 'agents at work', color: COLOR.glass.accentText },
  ].map((c, i) => {
    const cell = new Object3D();
    const x = METER.cells[i];
    const z = -Math.sqrt(METER.dist * METER.dist - x * x);
    cell.position.set(x, METER.y, z);
    cell.lookAt(0, METER.y, 0);
    const value = createLabel(c.value, { role: 'view', width: 0.2, eyeDist: METER.dist, weight: 700, lines: 1, color: c.color, align: 'center' });
    value.position.y = 0.022;
    const unit = createLabel(c.unit, { role: 'label', width: 0.2, eyeDist: METER.dist, weight: 400, lines: 1, color: COLOR.glass.soft, align: 'center' });
    unit.position.y = -0.03;
    cell.add(value, unit);
    meter.add(cell);
    return value;
  });
  const hairline = part(box(0.98, 0.0012, 0.0012), 'cobalt', 'run:meter-line');
  hairline.position.set(0, METER.y - 0.052, -METER.dist + 0.03);
  meter.add(hairline);

  let stations: Station[] = [];
  const bySign = new Map<string, Sign>();
  const mechanisms = new Map<string, Mechanism>();
  const byCall = new Map<string, { inst: Instrument; station: string }>();
  const spotsTaken = new Map<string, number>();
  let sector: SectorView | null = null;
  let slot = 0;
  const flying: { card: StepCard; tile: number; lit: boolean; at: number }[] = [];
  const spare: StepCard[] = [];

  const toArc = (world: Vector3): Vector3 => arc.worldToLocal(world);

  // ---- signs
  const makeSign = (s: Station, i: number): Sign => {
    const node = new Object3D();
    node.name = `sign:${s.id}`;
    const plate = part(bevelBox(SIGN.w, SIGN.h, SIGN.d, 0.0012, 0.006), 'slate', `sign:${s.id}:plate`);
    node.add(plate);
    // State: a thin bar along the bottom edge, cobalt while it works, green when done.
    const bar = part(box(SIGN.w - 0.012, 0.003, 0.0015), 'slateEdge', `sign:${s.id}:bar`);
    bar.position.set(0, -SIGN.h / 2 + 0.006, SIGN.d / 2 + 0.0008);
    node.add(bar);
    const eye = PANEL.stationBoard.eyeDist;
    const count = createLabel(String(i + 1).padStart(2, '0'), { role: 'label', width: 0.03, eyeDist: eye, weight: 700, lines: 1, color: COLOR.glass.soft, align: 'left' });
    count.position.set(-SIGN.w / 2 + 0.024, 0.004, SIGN.d / 2 + 0.001);
    node.add(count);
    const title = createLabel(s.label, { role: 'label', width: SIGN.w - 0.06, eyeDist: eye, weight: 700, lines: 1, color: COLOR.glass.text, align: 'left' });
    title.position.set(0.017, 0.004, SIGN.d / 2 + 0.001);
    node.add(title);
    const proxy = proxyMesh(box(SIGN.w, SIGN.h + 0.02, 0.02), `station:${s.id}`);
    node.add(proxy);
    signs.add(node);
    return { id: s.id, node, plate, bar, title, count, proxy, state: 'pending' };
  };

  const placeSign = (sign: Sign, point: Vector3): void => {
    sign.node.position.set(point.x, point.y + SIGN.h / 2 + 0.004, point.z);
    sign.node.lookAt(0, sign.node.position.y, 0);
  };

  const titleOf = (id: string): string => stations.find((s) => s.id === id)?.label ?? id;
  const setSign = (id: string, state: SignState, count?: string): void => {
    const sign = bySign.get(id);
    if (!sign) return;
    sign.state = state;
    setMat(sign.bar, BAR[state]);
    if (count !== undefined) setLabelText(sign.title, count ? `${titleOf(id)}  ${count}` : titleOf(id));
    const p = path.setStation(id, PATH_STATE[state]);
    placeSign(sign, p);
  };

  const spotFor = (station: string): Vector3 => {
    const n = spotsTaken.get(station) ?? 0;
    spotsTaken.set(station, n + 1);
    return path.spot(station, n % 4);
  };

  const stage = {
    path,
    pool,
    get stations() {
      return stations;
    },
    /** The numbers of the run over the trail. */
    meter(n: { steps: number; of: number; passed: number; sentBack: number; working: number } | null): void {
      meter.visible = n !== null;
      if (!n) return;
      setLabelText(meterCells[0], `${n.steps}/${n.of}`);
      setLabelText(meterCells[1], String(n.passed));
      setLabelText(meterCells[2], String(n.sentBack));
      setLabelText(meterCells[3], String(n.working));
    },
    sign(id: string): Object3D | null {
      return bySign.get(id)?.proxy ?? null;
    },
    signs(): { id: string; proxy: Object3D }[] {
      return [...bySign.values()].map((s) => ({ id: s.id, proxy: s.proxy }));
    },

    /** A new plan: the trail rises, signs hang, mechanisms stand at the code stations, the plot is outlined. */
    plan(list: Station[], tilesPlanned: number, freeSlot: number, seed: number): void {
      stage.clear();
      stations = list;
      path.setPlan(list, { radius: LAYOUT.arc.dist, from: LAYOUT.arc.from, to: LAYOUT.arc.to });
      list.forEach((s, i) => {
        const sign = makeSign(s, i);
        bySign.set(s.id, sign);
        placeSign(sign, path.setStation(s.id, 'pending'));
        if (s.by === 'code' && s.mechanism) {
          const m = createMechanism(MECH[s.mechanism]);
          const at = path.stake(s.id);
          m.root.position.set(at.x * 1.045, at.y - 0.042, at.z * 1.045);
          m.root.lookAt(0, m.root.position.y, 0);
          m.root.scale.setScalar(0.8);
          mechRoot.add(m.root);
          mechanisms.set(s.id, m);
        }
      });
      slot = freeSlot;
      sector = createSector({ slot, seed });
      home.island.root.children[0]?.add(sector.root);
      sector.setOutline(true);
      sector.setGrid(Math.max(8, tilesPlanned));
    },

    stepStart(id: string): void {
      setSign(id, 'active');
      mechanisms.get(id)?.setState('busy');
    },
    stepEnd(id: string, kept: number): void {
      setSign(id, 'done', kept > 0 ? String(kept) : '');
      mechanisms.get(id)?.setState('idle');
    },
    waiting(id: string): void {
      setSign(id, 'waiting');
      for (const c of byCall.values()) if (c.station === id) c.inst.sit(true);
    },
    asking(id: string, on: boolean): void {
      setSign(id, on ? 'asking' : 'done');
    },
    error(id: string): void {
      setSign(id, 'error');
      mechanisms.get(id)?.setState('error');
    },
    redo(id: string): void {
      setSign(id, 'redo');
    },

    callStart(callId: string, station: string, role: AgentRole, what?: string): void {
      const inst = pool.spawn(role, callId);
      const to = station === 'planner' || !bySign.has(station) ? path.parking(0) : spotFor(station);
      inst.moveTo(to);
      inst.carry('page', what ? what.slice(0, 12) : undefined);
      inst.setCall(callId);
      inst.work(true);
      byCall.set(callId, { inst, station });
    },
    callEnd(callId: string, ok: boolean): void {
      const c = byCall.get(callId);
      if (!c) return;
      byCall.delete(callId);
      c.inst.setCall(null);
      c.inst.work(false);
      c.inst.sit(false);
      if (!ok) c.inst.fail();
      else c.inst.hop();
      c.inst.carry(ok ? 'cards' : null);
      const n = spotsTaken.get(c.station) ?? 1;
      spotsTaken.set(c.station, Math.max(0, n - 1));
      // Back to the parking a moment later, unless a new call takes it first.
      const inst = c.inst;
      app.clock.timers.set(() => {
        if (inst.callId === null) inst.fold();
      }, 900);
    },

    /** The gate decided about one unit. */
    stamp(station: string, status: 'pass' | 'back' | 'fixed' | 'dropped'): void {
      const m = mechanisms.get(station);
      if (m) m.pulse(status === 'pass' || status === 'fixed' ? 'pass' : 'stamp');
    },

    /** One unit leaves its station as a card and lands as tile `i`. */
    tile(station: string, i: number, label: string, lit: boolean): void {
      if (!sector) return;
      const from = path.stake(station).clone();
      from.y += 0.03;
      const to = toArc(sector.tilePosition(i, new Vector3()));
      const card = spare.pop() ?? createStepCard();
      if (!card.root.parent) cardsRoot.add(card.root);
      card.setText(label);
      const ms = card.send(from, to);
      flying.push({ card, tile: i, lit, at: now() + ms });
    },

    /** The plot closes on the real count; the caller saves it to the island. */
    close(units: number): void {
      sector?.close(Math.max(1, units));
    },
    get slot() {
      return slot;
    },
    get sector() {
      return sector;
    },
    /** Leaves the shelf: stakes go down, instruments fold, signs and mechanisms go. */
    retract(): void {
      path.retract();
      for (const c of byCall.values()) c.inst.fold();
      byCall.clear();
      for (const s of bySign.values()) s.node.removeFromParent();
      bySign.clear();
      for (const m of mechanisms.values()) m.root.removeFromParent();
      mechanisms.clear();
    },
    /** Removes the run's own plot (the island has taken it over). */
    dropSector(): void {
      sector?.root.removeFromParent();
      sector = null;
    },
    clear(): void {
      stage.retract();
      stage.dropSector();
      spotsTaken.clear();
      for (const f of flying.splice(0)) {
        f.card.root.visible = false;
        spare.push(f.card);
      }
    },
    update(t: number): void {
      for (let k = flying.length - 1; k >= 0; k--) {
        const f = flying[k];
        if (t < f.at) continue;
        sector?.layTile(f.tile, f.lit);
        spare.push(f.card);
        flying.splice(k, 1);
      }
    },
  };
  animate({ root: cardsRoot, update: (t) => stage.update(t) });
  return stage;
}
