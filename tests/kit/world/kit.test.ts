import { describe, expect, it } from 'vitest';
import { Object3D, type Mesh } from '@iwsdk/core';
import type { RejectReason, Station } from '../../../src/agents/types';
import { caseStackGeometry } from '../../../src/kit/world/objects/case-stack';
import { cakeGeometry } from '../../../src/kit/world/objects/cake';
import { notebooksGeometry } from '../../../src/kit/world/objects/notebooks';
import { createObject } from '../../../src/kit/world/objects/object';
import { createPath } from '../../../src/kit/world/path';
import { createSector } from '../../../src/kit/world/sector';
import { createSlip, SLIP_CAPTION } from '../../../src/kit/world/slip';
import { layoutLabel } from '../../../src/kit/world/label';
import { createPairTags } from '../../../src/kit/world/pair-tags';
import { createThread } from '../../../src/kit/world/thread';
import { worldGallery } from '../../../src/kit/world/gallery';
import { atTime, tickKit } from '../../../src/kit/world/time';
import { Vector3 } from '@iwsdk/core';

const CASE: Station[] = ['s1', 's2', 's3', 's4', 's5'].map((id) => ({ id, step: 'read', label: id, by: 'code' }));

describe('objects are made from data', () => {
  it('stack grows with pages and carries tags by open contradictions', () => {
    const a = caseStackGeometry({ pages: 64, open: 6, closed: 0 });
    const b = caseStackGeometry({ pages: 400, open: 6, closed: 5 });
    expect(a.height).toBeGreaterThan(0.12);
    expect(a.height).toBeLessThan(0.15);
    expect(b.height).toBeGreaterThan(a.height);
    expect(b.height).toBeLessThanOrEqual(0.4);
    expect(a.numberTag).toBeNull();
    expect(caseStackGeometry({ pages: 64, open: 13, closed: 0 }).numberTag?.count).toBe(13);
    // Different data, different geometry: 6 open tags vs 0 add vertices.
    const none = caseStackGeometry({ pages: 64, open: 0, closed: 0 });
    expect(a.geometry.attributes.position.count).toBeGreaterThan(none.geometry.attributes.position.count);
  });
  it('cake has a tier per row and notebooks a notebook per essay', () => {
    expect(cakeGeometry({ rows: 3, tablesPerRow: [4, 4, 3] }).height).toBeGreaterThan(cakeGeometry({ rows: 2, tablesPerRow: [4, 4] }).height);
    const n24 = notebooksGeometry({ count: 24, review: 3 });
    expect(n24.height).toBeCloseTo(0.096, 3);
    expect(notebooksGeometry({ count: 78, review: 9 }).numberClip?.count).toBe(9);
  });
  it('an object grows, is selected with four buttons and takes every flag', () => {
    const scene = new Object3D();
    const o = createObject({ kind: 'notebooks', count: 24, review: 2 });
    scene.add(o.root);
    atTime(0, () => o.setState('growing'));
    o.update(150);
    const body = o.root.children[0];
    expect(body.scale.y).toBeGreaterThan(0.1);
    expect(body.scale.y).toBeLessThan(1);
    o.update(5000);
    expect(body.scale.y).toBeCloseTo(1, 5);
    expect(o.buttonPoints()).toHaveLength(4);
    for (const flag of ['pages', 'deadline', 'guest', 'question', 'stale', 'none'] as const) o.setFlag(flag);
  });
});

describe('arc', () => {
  it('a new plan first takes the old stakes away', () => {
    const scene = new Object3D();
    const path = createPath();
    scene.add(path.root);
    atTime(0, () => path.setPlan(CASE));
    path.update(2000);
    const stakes = () => path.root.children.filter((c) => c.name.startsWith('stake:')).length;
    expect(stakes()).toBe(5);
    atTime(3000, () => path.setPlan(CASE.slice(0, 3)));
    path.update(3100);
    expect(stakes()).toBe(8);
    path.update(6000);
    expect(stakes()).toBe(3);
    expect(path.angle('s2')).toBe(0);
  });
  it('stations take the angles of the layout and the board point is 0.165 m below the eyes', () => {
    const path = createPath();
    atTime(0, () => path.setPlan(CASE));
    expect(CASE.map((s) => path.angle(s.id))).toEqual([-26, -13, 0, 13, 26]);
    const board = path.setStation('s3', 'active', 0.5);
    expect(board.y).toBeCloseTo(-0.165, 3);
    expect(path.parking(0).distanceTo(path.parking(1))).toBeCloseTo(0.075, 3);
  });
  it('layRow across a row boundary lays every tile in it', () => {
    const sector = createSector({ slot: 0, seed: 1 });
    const scene = new Object3D();
    scene.add(sector.root);
    atTime(0, () => sector.setGrid(119));
    atTime(10, () => sector.layRow(0, 14));
    atTime(20, () => sector.layRow(15, 20)); // row 0 has 17 tiles
    sector.update(2000);
    expect(sector.tiles).toBe(21);
    expect(sector.tileIndexAt({ point: sector.tilePosition(18) })).toBe(18);
  });
  it('pair tags answer each judgement and release the contradictions', () => {
    const tags = createPairTags();
    const scene = new Object3D();
    scene.add(tags.root);
    atTime(0, () => tags.set([{ key: 'a|b' }, { key: 'c|d' }, { key: 'e|f' }]));
    atTime(10, () => {
      tags.mark('a|b', 'contradiction');
      tags.mark('c|d', 'explained');
      tags.mark('e|f', 'unsure');
    });
    expect(atTime(20, () => tags.release())).toEqual(['a|b']);
    tags.update(5000);
    expect(tags.root.children.filter((c) => c.visible)).toHaveLength(2);
  });
});

describe('paper', () => {
  it('slip captions fit two lines of 9 characters', () => {
    for (const [reason, caption] of Object.entries(SLIP_CAPTION) as [RejectReason, [string, string]][]) {
      expect(caption[0].length, reason).toBeLessThanOrEqual(9);
      expect(caption[1].length, reason).toBeLessThanOrEqual(9);
    }
  });
  it('a slip opens from quarters into an 18 × 16 cm sheet', () => {
    const slip = createSlip({ id: 'x', kind: 'claim', status: 'rejected', reason: 'quote-not-found', claim: 'x' });
    const scene = new Object3D();
    scene.add(slip.handle);
    const width = () => {
      scene.updateMatrixWorld(true);
      let min = Infinity;
      let max = -Infinity;
      slip.body.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh || !m.name.startsWith('slip:') || m.name.includes('mark')) return;
        m.geometry.computeBoundingBox();
        const b = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
        min = Math.min(min, b.min.x);
        max = Math.max(max, b.max.x);
      });
      return max - min;
    };
    slip.setOpen(0);
    slip.update(0);
    expect(width()).toBeLessThan(0.08);
    slip.setOpen(1);
    slip.update(0);
    expect(width()).toBeCloseTo(0.18, 2);
    slip.mark('second-stamp');
    slip.mark('check');
    expect([...slip.marks]).toEqual(['stamp', 'second-stamp', 'check']);
  });
  it('a long plot title is cut at a word with an ellipsis', () => {
    const l = layoutLabel('Pierline Property Management lease review for the second floor', { role: 'label', width: 0.4, eyeDist: 1.7, lines: 2 });
    expect(l.lines).toHaveLength(2);
    expect(l.lines[1].endsWith('…')).toBe(true);
    expect(l.cut).toBe(true);
  });
  it('the thread follows its bead and pulls toward the seat', () => {
    const t = createThread();
    const scene = new Object3D();
    scene.add(t.root);
    t.set({ a: new Vector3(-0.2, 0, -1), b: new Vector3(0.2, 0, -1), label: 'Keys', state: 'open' });
    const rest = t.bead.position.clone();
    t.setPull(1);
    expect(rest.distanceTo(t.bead.position)).toBeCloseTo(0.15, 5);
    expect(t.bead.position.z).toBeGreaterThan(rest.z);
    t.update(0);
  });
});

describe('gallery', () => {
  it('builds every state of every entry without a world', () => {
    const scene = new Object3D();
    let n = 0;
    for (const entry of worldGallery()) {
      for (const state of entry.states) {
        const obj = state.build({ world: null, app: null }) as Object3D;
        scene.add(obj);
        expect(obj.userData.frame, `${entry.id} / ${state.name}`).toBeTruthy();
        n += 1;
      }
    }
    tickKit(100_000);
    tickKit(103_000);
    expect(n).toBeGreaterThan(80);
  });
});

describe('general plans and the library of objects', () => {
  it('stations spread over the arc for plans of 4 to 12 steps', async () => {
    const { stationAngles, boardDrop } = await import('../../../src/kit/world/path');
    for (let n = 4; n <= 12; n++) {
      const a = stationAngles(n);
      expect(a).toHaveLength(n);
      expect(Math.min(...a)).toBeGreaterThanOrEqual(-31);
      expect(Math.max(...a)).toBeLessThanOrEqual(31);
      for (let i = 1; i < n; i++) expect(a[i] - a[i - 1]).toBeGreaterThanOrEqual(5);
    }
    expect(stationAngles(5)).toEqual([-26, -13, 0, 13, 26]);
    expect(boardDrop(1, 12)).toBeGreaterThan(0);
    expect(boardDrop(1, 5)).toBe(0);
    const path = createPath();
    const plan12: Station[] = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, step: 'read', label: `Step ${i}`, by: 'code' }));
    atTime(0, () => path.setPlan(plan12));
    expect(path.root.children.filter((c) => c.name.startsWith('stake:'))).toHaveLength(12);
  });
  it('every library object is built from its data', async () => {
    const { LIBRARY_KINDS, libraryGeometry } = await import('../../../src/kit/world/objects/library');
    for (const kind of LIBRARY_KINDS) {
      const small = libraryGeometry({ kind, units: 20, open: 0 });
      const big = libraryGeometry({ kind, units: 400, open: 6 });
      expect(small.height, kind).toBeGreaterThan(0.08);
      expect(big.height, kind).toBeLessThanOrEqual(0.4);
      expect(big.geometry.attributes.position.count, kind).toBeGreaterThan(small.geometry.attributes.position.count);
      const o = createObject({ kind, units: 60, open: 2 });
      expect(o.root.children.length).toBeGreaterThan(0);
    }
  });
});
