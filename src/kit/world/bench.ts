/**
 * The bench: a slate slab 0.9 × 0.45 m, 4 cm thick with a 4 mm chamfer and a slateEdge
 * rim, its top 0.32 m below the eyes and its centre 0.45 m ahead. Everything the hands
 * take lies on it. `slot(name)` gives the places of LAYOUT (or LAYOUT.narrow for the
 * glasses); objects attached to it stand on their slot, axis-aligned with the slab.
 *
 * `setService('side')` moves the voice stone, the mode cap and the settings tile into a
 * column at the right edge (the hall model and the notebook fan need the slab), and the
 * views add their keys ("Island", "Send to phone") with `addKey` without touching this file.
 *
 * The bench root is the seated frame itself (identity): slots are seat coordinates.
 */
import { Mesh, Object3D, Vector3, Color } from '@iwsdk/core';
import { COLOR, LAYOUT, SEAT, polar, type BenchItem, type Place } from '../../tokens/tokens';
import { zone } from '../../app/perf/zone';
import { bevelBox, tintBy } from './geom';
import { createLabel } from './label';
import { part } from './materials';
import { attachShadow } from './shadow';
import { animate, easeInOut, lessMotion, now, progress } from './time';
import type { Bench, BenchKey } from './types';
import { createBatch } from './batch';

const TOP = -SEAT.benchBelowEyes;
const SERVICE: BenchItem[] = ['voiceStone', 'modeSwitch', 'settingsTile'];
/** The side column: x at the right edge, forward distances near to far. */
const SIDE = { x: 0.418, z: { voiceStone: 0.33, modeSwitch: 0.45, settingsTile: 0.58 } as Record<string, number> };
const MOVE_MS = 420;

export function placeOf(name: BenchItem, narrow = false): Place {
  return (narrow ? LAYOUT.narrow : LAYOUT)[name];
}

/** Seat-frame point of a bench place (on the slab top). */
export function slotPoint(name: BenchItem, narrow = false, target = new Vector3()): Vector3 {
  const p = placeOf(name, narrow);
  const at = polar(p.az, p.dist, TOP + p.y);
  return target.set(at.x, at.y, at.z);
}

function slabMesh(): Mesh {
  const b = LAYOUT.bench;
  const g = bevelBox(b.w, b.h, b.d, 0.004, 0.006);
  const slate = new Color(COLOR.slate);
  const rim = new Color(COLOR.slateEdge);
  tintBy(g, (n) => (n.y > 0.98 ? slate : rim));
  const mesh = part(g, 'vcSlate', 'bench:slab');
  mesh.position.set(0, TOP - b.h, -b.dist);
  return mesh;
}

export function createBench(opts: { narrow?: boolean } = {}): Bench {
  const narrow = opts.narrow ?? false;
  const root = new Object3D();
  root.name = 'kit:bench';
  zone(root, 'sky-bench');
  const slab = slabMesh();
  root.add(slab);
  attachShadow(slab, { height: 0.04, size: [LAYOUT.bench.w, LAYOUT.bench.d], strength: 0.8, rest: slab.position.y });

  let service: 'default' | 'side' = 'default';
  let moveAt = -Infinity;
  const attached = new Map<BenchItem, Object3D>();
  const from = new Map<BenchItem, Vector3>();
  const keys = new Map<string, Object3D>();

  const target = (name: BenchItem, out = new Vector3()): Vector3 => {
    if (service === 'side' && SERVICE.includes(name)) return out.set(SIDE.x, TOP, -SIDE.z[name]);
    return slotPoint(name, narrow, out);
  };

  const tmp = new Vector3();
  const bench: Bench = {
    root,
    get service() {
      return service;
    },
    slot(name) {
      return target(name);
    },
    setService(mode) {
      if (mode === service) return;
      for (const name of SERVICE) {
        const obj = attached.get(name);
        if (obj) from.set(name, obj.position.clone());
      }
      service = mode;
      moveAt = now();
    },
    attach(name, obj) {
      attached.set(name, obj);
      obj.position.copy(target(name));
      if (!obj.parent) root.add(obj);
    },
    addKey(key: BenchKey) {
      bench.removeKey(key.id);
      const place = key.at === 'far-left' ? 'keyIsland' : 'keySend';
      const p = placeOf(place, narrow);
      const node = new Object3D();
      node.name = `key:${key.id}`;
      const body = part(bevelBox(p.w, p.h, p.d, 0.002, 0.006), 'bone', `key:${key.id}:body`);
      node.add(body);
      const label = createLabel(key.label, { role: 'flat', width: p.w - 0.012, eyeDist: p.eyeDist, weight: 700, lines: 1, align: 'center', color: COLOR.cobaltText });
      label.rotation.x = -Math.PI / 2;
      label.position.y = p.h + 0.0008;
      node.add(label);
      node.position.copy(slotPoint(place, narrow));
      node.userData.onSelect = key.onSelect;
      node.userData.target = key.id;
      attachShadow(node, { height: p.h, size: [p.w, p.d] });
      root.add(node);
      keys.set(key.id, node);
      return node;
    },
    removeKey(id) {
      const k = keys.get(id);
      if (k) {
        k.removeFromParent();
        keys.delete(id);
      }
    },
    key(id) {
      return keys.get(id) ?? null;
    },
    update(t) {
      const k = lessMotion() ? (t >= moveAt ? 1 : 0) : easeInOut(progress(t, moveAt, MOVE_MS));
      for (const name of SERVICE) {
        const obj = attached.get(name);
        if (!obj) continue;
        const start = from.get(name);
        target(name, tmp);
        if (start && k < 1) obj.position.lerpVectors(start, tmp, k);
        else obj.position.copy(tmp);
      }
    },
  };
  animate(bench);
  createBatch(root);
  return bench;
}
