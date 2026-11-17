import { describe, expect, it } from 'vitest';
import { Scene } from '@iwsdk/core';
import { createWorld } from '../../src/world/index';
import { bridgePlank, neighbourIsland, ropeTube } from '../../src/world/neighbour';
import { branchChime, chimeCane, buildProp } from '../../src/world/props';
import { Vector3 } from '@iwsdk/core';

describe("a friend's island and its bridge", () => {
  it('builds a small dressed island with the bridge head on the ground at y = 0', async () => {
    const scene = new Scene();
    const world = createWorld({ scene }, { kitUrl: 'missing.glb' });
    await world.ready;
    const shape = neighbourIsland({ seed: 777, houses: [{ id: 'h1', recipe: 'baker', colors: { wall: '#f2dcc0', roof: '#c8553d', trim: '#7b4b2e' } }, { id: 'h2', recipe: 'gardener', colors: { wall: '#efe2c8', roof: '#3f6f5f', trim: '#8a5a3b' } }] });
    expect(Math.abs(shape.height(shape.head.x, shape.head.z))).toBeLessThan(1e-6);
    expect(shape.head.x).toBeLessThan(0);
    expect(shape.doors.length).toBe(2);
    expect(shape.stands.length).toBeGreaterThan(2);
    // dense but light: one geometry within the budget of a docked neighbour
    expect(shape.triangles).toBeGreaterThan(4000);
    expect(shape.triangles).toBeLessThan(45000);
    expect(bridgePlank(1).getAttribute('color').itemSize).toBe(4);
    expect(ropeTube([new Vector3(0, 0, 0), new Vector3(1, 0, 0), new Vector3(2, -0.2, 0)]).getAttribute('position').count).toBeGreaterThan(20);
  });

  it('lets other modules add ground, a crossing over a bridge, and clear room', async () => {
    const world = createWorld({ scene: new Scene() }, { kitUrl: 'missing.glb' });
    await world.ready;
    const far = { x: 30, z: 0 };
    const inside = (x: number, z: number): boolean => Math.hypot(x - far.x, z - far.z) < 5;
    world.addGround('test:far', (x, z) => (inside(x, z) ? 2.5 : null));
    expect(world.groundY(30, 0)).toBe(2.5);
    world.addCrossing('test', { x: 12, z: -6 }, { x: 25, z: 0 }, inside);
    const r = world.route({ x: 0, z: -3 }, { x: 30, z: 1 });
    const over = r.filter((p) => Math.abs((p.z + 6) - ((p.x - 12) * 6) / 13) < 0.3 && p.x > 12.5 && p.x < 24.5);
    expect(over.length).toBeGreaterThan(5);
    world.removeCrossing('test');
    world.removeGround('test:far');
    expect(world.groundY(30, 0)).not.toBe(2.5);
    const before = world.perches().length;
    world.clearSpace(-6, -21.8, 4);
    expect(world.perches().length).toBeLessThanOrEqual(before);
  });

  it('hangs chimes from a bent cane or a bough, never a post with an arm', () => {
    const cane = chimeCane();
    expect(cane.hang[0]).toBeGreaterThan(0.3);
    expect(cane.hang[1]).toBeGreaterThan(0.9);
    expect(buildProp('wind-chime', 3)?.getAttribute('position').count).toBeGreaterThan(100);
    expect(branchChime([0, 1.5, 0], [1, 1.7, 0]).getAttribute('position').count).toBeGreaterThan(100);
  });
});
