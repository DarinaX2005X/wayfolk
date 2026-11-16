/**
 * Draw budget of the world kit (DESIGN "Бюджет отрисовки по зонам"), counted the way the
 * frame measure counts it: one call per visible mesh with a visible material (an instanced
 * or batched mesh is one call).
 */
import { describe, expect, it } from 'vitest';
import { Object3D, type Material, type Mesh } from '@iwsdk/core';
import type { Plot, Station } from '../../../src/agents/types';
import { createBench } from '../../../src/kit/world/bench';
import { createFirstStake } from '../../../src/kit/world/first-stake';
import { createHomePlot } from '../../../src/kit/world/home';
import { createInbox } from '../../../src/kit/world/inbox';
import { createInstruments } from '../../../src/kit/world/instrument';
import { createIsland } from '../../../src/kit/world/island';
import { createModeSwitch } from '../../../src/kit/world/mode-switch';
import { createPath } from '../../../src/kit/world/path';
import { createSettingsTile } from '../../../src/kit/world/settings-tile';
import { createSky } from '../../../src/kit/world/sky';
import { atTime, tickKit } from '../../../src/kit/world/time';
import { createVoiceStone } from '../../../src/kit/world/voice-stone';
import { createTray } from '../../../src/kit/world/tray';
import { createSlip } from '../../../src/kit/world/slip';

type Drawable = Mesh & { isInstancedMesh?: boolean; isBatchedMesh?: boolean; count?: number; _instanceInfo?: { active: boolean; visible: boolean }[] };

function calls(root: Object3D): { total: number; names: string[] } {
  root.updateMatrixWorld(true);
  const names: string[] = [];
  root.traverseVisible((o) => {
    const m = o as Drawable;
    if (!m.isMesh) return;
    const material = m.material as Material | Material[];
    if (Array.isArray(material) || material.visible === false) return;
    if (m.isInstancedMesh && m.count === 0) return;
    if (m.isBatchedMesh && !(m._instanceInfo ?? []).some((i) => i.active && i.visible)) return;
    names.push(m.name);
  });
  return { total: names.length, names };
}

const T = 100_000;

describe('draw budget', () => {
  it('sky, home plot and bench with every object stay within 10 draws', () => {
    const scene = new Object3D();
    const sky = createSky(null);
    const home = createHomePlot();
    const bench = createBench();
    scene.add(sky.root, home, bench.root);
    const inbox = createInbox();
    bench.attach('inbox', inbox.root);
    atTime(T - 1000, () => {
      inbox.offer([
        { id: 'a', kind: 'sample', lines: ['Harbor Street, Unit 4B', '64 pages, 12 documents'] },
        { id: 'b', kind: 'sample', lines: ['Wedding', '84 guests, a wish letter'] },
        { id: 'c', kind: 'files', lines: ['Your files', 'Send them from your phone'] },
      ]);
      inbox.setPin(true);
    });
    bench.attach('firstStake', createFirstStake());
    bench.attach('voiceStone', createVoiceStone().root);
    bench.attach('modeSwitch', createModeSwitch().root);
    bench.attach('settingsTile', createSettingsTile());
    const tray = createTray('sent-back');
    bench.attach('traySent', tray.root);
    atTime(T - 500, () => tray.add(createSlip({ id: 's', kind: 'claim', status: 'rejected', reason: 'quote-altered', claim: 'x' })));
    tickKit(T);
    const { total, names } = calls(scene);
    expect(total, names.join(', ')).toBeLessThanOrEqual(10);
  });

  it('a ring of eight closed plots with objects, flags and boards stays within 18 draws', () => {
    const scene = new Object3D();
    const island = createIsland(1);
    scene.add(island.root);
    const plots: Plot[] = Array.from({ length: 8 }, (_, slot) => ({
      projectId: `p${slot}`,
      slug: `p${slot}`,
      slot,
      kind: (['case', 'seating', 'essays'] as const)[slot % 3],
      title: `Plot number ${slot} with a long name that wraps`,
      sample: false,
      visibility: 'public',
      object: slot % 3 === 0 ? { kind: 'case-stack', pages: 64, open: 6, closed: 2 } : slot % 3 === 1 ? { kind: 'cake', rows: 3, tablesPerRow: [4, 4, 3] } : { kind: 'notebooks', count: 24, review: 3 },
      doneAt: '2026-11-14T10:00:00Z',
      tiles: 60 + slot * 40,
      perTile: 1,
      seed: slot * 7,
      tileRefs: [],
      passes: 1,
      open: 1,
      total: 4,
      flag: (['none', 'pages', 'deadline', 'guest', 'question', 'stale', 'none', 'pages'] as const)[slot],
    }));
    island.setPlots(plots);
    tickKit(T);
    const { total, names } = calls(scene);
    expect(total, names.join(', ')).toBeLessThanOrEqual(18);
  });

  it('six walking instruments with loads draw with at most six calls', () => {
    const scene = new Object3D();
    const path = createPath();
    const pool = createInstruments(null);
    scene.add(pool.root);
    const stations: Station[] = ['s1', 's2', 's3', 's4', 's5'].map((id) => ({ id, step: 'read', label: id, by: 'code' }));
    atTime(0, () => path.setPlan(stations));
    const kinds = ['page', 'cards', 'spool', 'slips', 'pencil', 'page'] as const;
    for (let i = 0; i < 6; i++) {
      const inst = atTime(T - 400, () => pool.spawn('extractor', `c${i}`));
      atTime(T - 400, () => {
        inst.moveTo(path.lane(-20 + i * 8));
        inst.carry(kinds[i], i === 0 ? '1–6' : undefined);
        if (i === 1) inst.sit(true);
      });
    }
    tickKit(T);
    const { total, names } = calls(pool.root);
    expect(total, names.join(', ')).toBeLessThanOrEqual(6);
    expect(pool.lit()).toBe(6);
  });

  it('keeps every bench object under the height rule', () => {
    const bench = createBench();
    const objects: [Parameters<typeof bench.slot>[0], Object3D][] = [
      ['inbox', createInbox().root],
      ['firstStake', createFirstStake()],
      ['voiceStone', createVoiceStone().root],
      ['modeSwitch', createModeSwitch().root],
      ['settingsTile', createSettingsTile()],
      ['traySent', createTray('sent-back').root],
      ['trayFool', createTray('fool').root],
    ];
    for (const [name, obj] of objects) {
      bench.attach(name, obj);
      tickKit(T);
      obj.updateMatrixWorld(true);
      // The rule of DESIGN: at forward distance z nothing is taller than 0.32 − 0.474 z.
      obj.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh || o.userData.proxy || o.userData.label) return;
        m.geometry.computeBoundingBox();
        const box = m.geometry.boundingBox!.clone().applyMatrix4(m.matrixWorld);
        const top = box.max.y + 0.32;
        const far = -box.min.z;
        expect(top, `${name} ${m.name}`).toBeLessThanOrEqual(0.32 - 0.474 * far + 0.001);
      });
    }
  });
});
