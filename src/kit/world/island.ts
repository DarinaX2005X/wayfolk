/**
 * The island: a ring of eight slots around the person's own plot (DESIGN "Кольцо
 * участков"). A finished job is a closed plot with its object on it and a vertical
 * label board above it; empty slots are a dashed `outline`. `rotateTo` turns the ring no
 * faster than 45° a second with an eased start and stop (dissolving instead with less
 * motion); the home plot does not turn. `scale` shrinks the whole island for the 1:6
 * table model in Room and for the world page.
 *
 * Draws: every closed plot, object, flag and board joins the island's batch; all labels
 * are one instanced mesh with the shared atlas; the empty slots are one instanced mesh.
 * Eight closed plots with objects come to five or six draws (budget 18).
 *
 * Frame: the island root sits at the head (eye height); slot s at rotation 0 stands at
 * azimuth 45°·s.
 */
import { InstancedMesh, Matrix4, Object3D, Quaternion, Vector3, Euler } from '@iwsdk/core';
import type { Plot } from '../../agents/types';
import { LAYOUT, PANEL, SEAT } from '../../tokens/tokens';
import { zone } from '../../app/perf/zone';
import { createBatch } from './batch';
import { createDome } from './dome';
import { bevelBox, box, cylinder, prep, torusArc } from './geom';
import { createLabel, setLabelText } from './label';
import { mat, part } from './materials';
import { createObject } from './objects/object';
import { createSector, RING, surfaceY } from './sector';
import { animate, atTime, easeInOut, lessMotion, now, progress } from './time';
import type { IslandView, ProjectObject, SectorView } from './types';

const MAX_SPEED = 45; // degrees a second
const OBJECT_R = LAYOUT.plotObject.dist;
const BOARD_Y = -SEAT.benchBelowEyes + LAYOUT.plotLabel.y + LAYOUT.plotLabel.h / 2;
const TILT = Math.atan2(RING.outerY - RING.innerY, RING.outer - RING.inner);
const SPAN = (RING.span * Math.PI) / 180;

type Slot = { plot: Plot; key: string; sector: SectorView; object: ProjectObject; holder: Object3D; board: Object3D; label: ReturnType<typeof createLabel>; dome: Object3D | null; staleMark: Object3D };

/** Words of a plot title on two lines of up to 22 characters, cut at a word with an ellipsis. */
function boardText(plot: Plot, visitor: boolean): string {
  if (visitor && plot.visibility === 'private') return 'Private';
  return plot.title;
}

/** Dashes around one empty slot (in the frame of the ring). */
function slotDashes(slot: number, out: Matrix4[]): void {
  const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (-slot * RING.slotDeg * Math.PI) / 180);
  const add = (r: number, a: number, along: 'r' | 'a'): void => {
    const pos = new Vector3(r * Math.sin(a), surfaceY(r) + 0.002, -r * Math.cos(a)).applyQuaternion(rot);
    const q = new Quaternion().setFromEuler(new Euler(TILT, -a, 0, 'YXZ')).premultiply(rot);
    const s = along === 'a' ? new Vector3(0.03, 1, 1) : new Vector3(1, 1, 0.03);
    out.push(new Matrix4().compose(pos, q, s));
  };
  const step = 0.05;
  const arc = (r: number): void => {
    const n = Math.max(2, Math.round((r * SPAN) / step));
    for (let i = 0; i < n; i++) add(r, -SPAN / 2 + (SPAN * (i + 0.5)) / n, 'a');
  };
  const side = (a: number): void => {
    const n = Math.max(2, Math.round((RING.outer - RING.inner) / step));
    for (let i = 0; i < n; i++) add(RING.inner + ((RING.outer - RING.inner) * (i + 0.5)) / n, a, 'r');
  };
  arc(RING.inner);
  arc(RING.outer);
  side(-SPAN / 2);
  side(SPAN / 2);
}

export function createIsland(scale = 1, opts: { visitor?: boolean } = {}): IslandView {
  const root = new Object3D();
  root.name = 'kit:island';
  root.scale.setScalar(scale);
  zone(root, 'ring');
  const ring = new Object3D();
  ring.name = 'island:ring';
  root.add(ring);
  const batch = createBatch(ring);
  const visitor = opts.visitor ?? false;

  const dashGeo = prep(box(1, 0.002, 0.005));
  const empty = new InstancedMesh(dashGeo, mat('outline'), 8 * 120);
  empty.name = 'island:empty';
  empty.frustumCulled = false;
  empty.count = 0;
  ring.add(empty);

  const slots = new Map<number, Slot>();
  let rotation = 0;
  let from = 0;
  let to = 0;
  let rotAt = -Infinity;
  let rotMs = 0;

  const boardGeo = bevelBox(PANEL.plotLabel.size.w + 0.008, PANEL.plotLabel.size.h + 0.008, 0.006, 0.0015, 0.006);
  const faceGeo = bevelBox(PANEL.plotLabel.size.w, PANEL.plotLabel.size.h, 0.002, 0.0006, 0.004);

  const refreshEmpty = (): void => {
    const list: Matrix4[] = [];
    for (let s = 0; s < 8; s++) if (!slots.has(s)) slotDashes(s, list);
    list.forEach((m, i) => empty.setMatrixAt(i, m));
    empty.count = list.length;
    empty.instanceMatrix.needsUpdate = true;
  };
  refreshEmpty();

  const build = (plot: Plot): Slot => {
    const units = Math.max(1, plot.tiles * Math.max(1, plot.perTile));
    const sector = createSector({ slot: plot.slot, seed: plot.seed });
    atTime(-1e7, () => {
      sector.setGrid(units);
      sector.layRow(0, units - 1);
      sector.close(units);
    });
    ring.add(sector.root);
    sector.update(0);

    // Object at the inner edge, on the tilted tiles, facing the person.
    const holder = new Object3D();
    holder.name = `island:slot:${plot.slot}`;
    holder.rotation.y = (-plot.slot * RING.slotDeg * Math.PI) / 180;
    ring.add(holder);
    const object = createObject(plot.object, { seed: plot.seed });
    const at = new Object3D();
    at.position.set(0, surfaceY(OBJECT_R) + 0.012 - 0.02, -OBJECT_R);
    at.rotation.set(TILT, 0, 0, 'YXZ');
    at.add(object.root);
    holder.add(at);
    object.setFlag(plot.flag === 'stale' ? 'stale' : plot.flag);

    // The label board above it on a slate rod: bone face with a slate rim, two lines.
    const board = new Object3D();
    board.position.set(0, BOARD_Y, -OBJECT_R - 0.02);
    const back = part(boardGeo, 'slate', 'island:board');
    back.position.y = -(PANEL.plotLabel.size.h + 0.008) / 2;
    const face = part(faceGeo, 'bone', 'island:board-face');
    face.position.set(0, -PANEL.plotLabel.size.h / 2, 0.006);
    const label = createLabel(boardText(plot, visitor), { role: 'label', width: PANEL.plotLabel.size.w - 0.03, eyeDist: PANEL.plotLabel.eyeDist, lines: 2, weight: 700 });
    label.position.set(-0.005, 0, 0.0085);
    const rodLen = BOARD_Y - PANEL.plotLabel.size.h / 2 - surfaceY(OBJECT_R + 0.02);
    const rod = part(cylinder(0.003, 0.003, rodLen, 8), 'slate', 'island:rod');
    rod.position.set(PANEL.plotLabel.size.w / 2 - 0.03, -PANEL.plotLabel.size.h / 2 - 0.004 - rodLen, -0.004);
    const staleMark = part(torusArc(0.011, 0.0025, Math.PI * 1.6), 'inkSoft', 'island:stale');
    staleMark.rotation.x = Math.PI / 2;
    staleMark.position.set(PANEL.plotLabel.size.w / 2 - 0.022, 0, 0.0085);
    staleMark.visible = plot.flag === 'stale';
    board.add(back, face, rod, staleMark);
    board.add(label);
    holder.add(board);

    let dome: Object3D | null = null;
    if (visitor && plot.visibility === 'private') {
      dome = createDome();
      dome.position.copy(at.position);
      dome.rotation.copy(at.rotation);
      holder.add(dome);
    }
    return { plot, key: `${plot.projectId}:${plot.tiles}:${plot.seed}:${plot.perTile}`, sector, object, holder, board, label, dome, staleMark };
  };

  const island: IslandView = {
    root,
    get rotation() {
      return rotation;
    },
    setPlots(plots) {
      const keep = new Set<number>();
      for (const plot of plots) {
        if (plot.slot < 0 || plot.slot > 7) continue;
        keep.add(plot.slot);
        const key = `${plot.projectId}:${plot.tiles}:${plot.seed}:${plot.perTile}`;
        const old = slots.get(plot.slot);
        if (old && old.key === key) {
          old.plot = plot;
          setLabelText(old.label, boardText(plot, visitor));
          old.object.setFlag(plot.flag === 'stale' ? 'stale' : plot.flag);
          old.staleMark.visible = plot.flag === 'stale';
          continue;
        }
        if (old) {
          old.sector.root.removeFromParent();
          old.holder.removeFromParent();
        }
        slots.set(plot.slot, build(plot));
      }
      for (const [slot, s] of slots) {
        if (keep.has(slot)) continue;
        s.sector.root.removeFromParent();
        s.holder.removeFromParent();
        slots.delete(slot);
      }
      refreshEmpty();
    },
    rotateTo(deg, ms = 0) {
      from = island.rotation;
      const t0 = now();
      // Unwrap to the nearest turn.
      let d = deg - from;
      while (d > 180) d -= 360;
      while (d < -180) d += 360;
      to = from + d;
      rotAt = t0;
      rotMs = Math.max(ms, (Math.abs(d) / MAX_SPEED) * 1000);
    },
    sector(slot) {
      return slots.get(slot)?.sector ?? null;
    },
    object(slot) {
      return slots.get(slot)?.object ?? null;
    },
    update(t) {
      const reduced = lessMotion();
      const k = progress(t, rotAt, rotMs);
      if (reduced && rotMs > 0) {
        // Dissolve: fade out, jump, fade in over the same time (at least 400 ms).
        const ms = Math.max(400, Math.min(rotMs, 800));
        const kk = progress(t, rotAt, ms);
        rotation = kk < 0.5 ? from : to;
        batch.setOpacity(kk >= 1 ? 1 : Math.abs(1 - 2 * kk));
      } else {
        rotation = from + (to - from) * easeInOut(k);
        batch.setOpacity(1);
      }
      ring.rotation.y = (-rotation * Math.PI) / 180;
    },
  };
  animate(island);
  return island;
}
