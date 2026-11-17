import { describe, expect, it } from 'vitest';
import { Scene } from '@iwsdk/core';
import type { HouseSpec } from '../../src/mind/types';
import { createWorld } from '../../src/world/index';
import { atHour } from '../../src/world/daylight';
import { LOTS, SEAT } from '../../src/world/land';
import { U } from '../../src/world/materials';
import { planHouse } from '../../src/world/recipes';

const spec = (id: string, recipe: HouseSpec['recipe']): HouseSpec => ({
  id,
  residentId: `r-${id}`,
  recipe,
  pos: { x: 0, z: -9 },
  rotY: 0,
  colors: { wall: '#f1e6d2', roof: '#3f6f5f', trim: '#a8452f' },
  props: ['teapot'],
  sign: 'Steep',
  builtAt: 0,
});

describe('seated view', () => {
  it('puts the first houses 7 to 12 m out, one front-left and one front-right', () => {
    const [a, b] = LOTS;
    for (const l of [a, b]) {
      const d = Math.hypot(l.x - SEAT.x, l.z - SEAT.z);
      expect(d).toBeGreaterThanOrEqual(7);
      expect(d).toBeLessThanOrEqual(12);
    }
    expect(Math.sign(a.x)).not.toBe(Math.sign(b.x));
    for (const l of LOTS) expect(Math.hypot(l.x - SEAT.x, l.z - SEAT.z)).toBeGreaterThanOrEqual(6);
  });
});

describe('yard life', () => {
  it('gives every house stepping stones and a few things round it', () => {
    for (const recipe of ['baker', 'tea-maker', 'gardener', 'tinkerer'] as const) {
      const plan = planHouse(spec(`y-${recipe}`, recipe));
      const yard = plan.pieces.filter((p) => p.name.startsWith('prop:yard-') || p.name === 'prop:crate-small' || p.name === 'prop:scarecrow');
      expect(plan.pieces.some((p) => p.name === 'prop:yard-stones')).toBe(true);
      expect(yard.length).toBeGreaterThanOrEqual(3);
      // nothing of the yard stands farther out than the house's free radius allows
      for (const p of yard) expect(Math.hypot(p.pos[0], p.pos[2])).toBeLessThan(plan.radius + 1.6);
    }
  });
});

describe('weather and sky events', () => {
  it('rains, clears with a rainbow, lights the fire, pulses and sends a whale and a star', async () => {
    const world = createWorld({ scene: new Scene() }, { kitUrl: 'missing.glb' });
    await world.ready;
    world.setTime(atHour(16));
    world.weather.set('rain');
    expect(world.weather.kind).toBe('rain');
    for (let i = 0; i < 400; i++) world.update(i * 50);
    expect(U.rain.value).toBeGreaterThan(0.9);
    expect(U.wet.value).toBeGreaterThan(0.9);
    world.weather.set('clear');
    for (let i = 400; i < 900; i++) world.update(i * 50);
    expect(U.rain.value).toBeLessThan(0.05);
    expect(world.root.getObjectByName('world:rainbow')?.visible).toBe(true);

    world.campfire(true);
    for (let i = 900; i < 960; i++) world.update(i * 50);
    expect(U.fire.value).toBeGreaterThan(0.5);
    expect(world.benches().length).toBeGreaterThanOrEqual(3);
    world.campfire(false);

    world.setPulse(0.8, 0.1);
    expect(U.pulse.value).toBeCloseTo(0.8);
    world.setPulse(0);

    const whale = world.skyWhale();
    expect(world.root.getObjectByName('world:sky-whale')).toBeTruthy();
    for (let i = 960; i < 2600; i++) world.update(i * 50);
    await whale;
    expect(world.root.getObjectByName('world:sky-whale')).toBeUndefined();

    world.setTime(atHour(23));
    const star = world.shootingStar();
    for (let i = 2600; i < 2700; i++) world.update(i * 50);
    const landed = await star;
    expect(landed.pos.distanceTo(world.seat.pos)).toBeLessThan(1.3);
    expect(landed.pos.y).toBeGreaterThan(world.seat.pos.y + 0.5);
    landed.release();
    expect(world.root.getObjectByName('world:star')).toBeUndefined();
  });
});
