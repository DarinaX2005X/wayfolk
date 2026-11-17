import { describe, expect, it } from 'vitest';
import { Scene } from '@iwsdk/core';
import type { HouseSpec } from '../../src/mind/types';
import { createWorld } from '../../src/world/index';
import { atHour } from '../../src/world/daylight';
import { wind } from '../../src/world/wind';

const spec = (id: string, x: number, z: number, rotY: number): HouseSpec => ({
  id,
  residentId: `r-${id}`,
  recipe: 'tea-maker',
  pos: { x, z },
  rotY,
  colors: { wall: '#f1e6d2', roof: '#3f6f5f', trim: '#a8452f' },
  props: ['teapot'],
  sign: 'Steep',
  builtAt: 0,
});

describe('createWorld', () => {
  it('builds the island and answers the contract', async () => {
    const scene = new Scene();
    const world = createWorld({ scene }, { kitUrl: 'missing.glb' });
    await world.ready;
    expect(world.root.parent).toBe(scene);
    world.setTime(atHour(19));
    expect(world.sky.glow).toBeGreaterThanOrEqual(0);

    const spot = world.validSpot({ x: 1, z: -9 });
    expect(spot.ok).toBe(true);
    const steps = world.buildPlan(spec('h1', spot.snapped.x, spot.snapped.z, spot.rotY));
    expect(steps.length).toBeGreaterThan(8);
    expect(steps[0].stage).toBe('foundation');
    for (const s of steps) {
      expect(s.object3d.parent).toBeTruthy();
      expect(s.object3d.visible).toBe(false);
      expect(s.object3d.position.distanceTo(s.target.pos)).toBeLessThan(1e-6);
    }
    world.finishHouse('h1');
    expect(world.house('h1')?.built).toBe(true);
    // a second house cannot stand on the first
    expect(world.validSpot({ x: spot.snapped.x, z: spot.snapped.z }).snapped.distanceTo(spot.snapped)).toBeGreaterThan(4);

    const next = world.suggestSpot();
    world.addHouse(spec('h2', next.snapped.x, next.snapped.z, next.rotY));
    const line = world.addPath('h1', 'h2');
    expect(line.length).toBeGreaterThan(2);
    expect(world.path('h2', 'h1')?.length).toBe(line.length);
    const r = world.route({ x: 0, z: -2 }, { x: next.snapped.x, z: next.snapped.z });
    expect(r.length).toBeGreaterThanOrEqual(2);

    const prop = world.addProp('lantern', { x: -3, z: -4 });
    expect(prop?.userData.kind).toBe('lantern');
    expect(world.addProp('a spaceship', { x: 0, z: -5 })).toBeNull();

    world.setHorizon([{ id: 'maple', name: 'Maple Rock' }]);
    expect(world.horizon('maple')?.pos.length()).toBeGreaterThan(80);
    expect(world.spots().map((s) => s.id)).toEqual(expect.arrayContaining(['seat', 'pier', 'house:h1']));
    expect(world.perches().length).toBeGreaterThan(5);
    expect(world.benches()[0].pos.z).toBeGreaterThan(0);
    expect(world.cloudY).toBeLessThan(-5);
    expect(world.pier.walk.length).toBeGreaterThan(3);
    expect(world.stats().houses).toBe(2);
    world.update(1000);
  });

  it('wind is the same on the CPU at the same place and time', () => {
    wind.update(12);
    const a = wind.sample({ x: 1, y: 0, z: -3 });
    const b = wind.sample({ x: 1, y: 0, z: -3 }, 12);
    expect(a.distanceTo(b)).toBeLessThan(1e-9);
    expect(a.length()).toBeGreaterThan(0);
    const g = wind.gust(1, -3);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
  });
});
