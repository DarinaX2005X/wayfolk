import { describe, expect, it } from 'vitest';
import { Object3D, Raycaster, Vector3 } from '@iwsdk/core';
import { createSector, gridFor, MAX_CELLS } from '../../../src/kit/world/sector';
import { atTime } from '../../../src/kit/world/time';

/** A sector in a scene, stamped and updated at given times. */
function sectorAt(slot = 0, seed = 7) {
  const scene = new Object3D();
  const sector = createSector({ slot, seed });
  scene.add(sector.root);
  return { scene, sector };
}

describe('grid of a plot', () => {
  it('follows the rule of the plan', () => {
    expect(gridFor(119)).toMatchObject({ rows: 7, cols: 17, perTile: 1, tiles: 119 });
    expect(gridFor(4)).toMatchObject({ rows: 4, cols: 1, tiles: 4 });
    expect(gridFor(392)).toMatchObject({ rows: 13, cols: 31, perTile: 1, tiles: 392 });
    const big = gridFor(1000);
    expect(big.perTile).toBe(3);
    expect(big.tiles).toBe(334);
    expect(big.rows * big.cols).toBeGreaterThanOrEqual(big.tiles);
    expect(big.tiles).toBeLessThanOrEqual(MAX_CELLS);
  });
  it('makes tiles of about 10 × 8 cm for 119 units', () => {
    const g = gridFor(119);
    const radial = (2.16 - 1.46) / g.rows;
    const along = (1.81 * (42.6 * Math.PI)) / 180 / g.cols;
    expect(radial).toBeCloseTo(0.1, 2);
    expect(along).toBeGreaterThan(0.07);
    expect(along).toBeLessThan(0.09);
  });
});

describe('sector tiles', () => {
  it('keeps the number of a tile through close', () => {
    const { sector } = sectorAt(0, 3);
    atTime(0, () => {
      sector.setOutline(true);
      sector.setGrid(124);
    });
    for (let i = 0; i < 119; i++) atTime(100 + i * 90, () => sector.layTile(i));
    sector.update(20_000);
    const before = [0, 1, 16, 17, 60, 118].map((i) => sector.tilePosition(i).clone());
    before.forEach((p, k) => expect(sector.tileIndexAt({ point: p })).toBe([0, 1, 16, 17, 60, 118][k]));
    atTime(21_000, () => sector.close(119));
    sector.update(22_000);
    expect(sector.grid).toEqual({ rows: 7, cols: 17 });
    for (const i of [0, 1, 16, 17, 60, 118]) {
      const p = sector.tilePosition(i);
      expect(sector.tileIndexAt({ point: p })).toBe(i);
    }
    // By face of the merged plot: a ray straight down onto tile 60.
    const merged = sector.root.getObjectByName('sector:0:plot');
    expect(merged).toBeTruthy();
    const target = sector.tilePosition(60);
    const ray = new Raycaster(target.clone().add(new Vector3(0, 0.5, 0)), new Vector3(0, -1, 0));
    const hit = ray.intersectObject(merged!, false)[0];
    expect(hit).toBeTruthy();
    expect(sector.tileIndexAt({ object: merged!, faceIndex: hit.faceIndex ?? null, point: hit.point })).toBe(60);
  });

  it('is a function of time: the same stamps give the same picture', () => {
    const a = sectorAt(1, 9).sector;
    const b = sectorAt(1, 9).sector;
    for (const s of [a, b]) {
      atTime(0, () => s.setGrid(40));
      atTime(10, () => s.layTile(0));
      atTime(50, () => s.layRow(1, 12));
    }
    b.update(5000);
    a.update(130);
    b.update(130);
    const mesh = (s: typeof a) => s.root.getObjectByName(`sector:1:tiles`) as unknown as { instanceMatrix: { array: Float32Array }; count: number };
    expect(Array.from(mesh(a).instanceMatrix.array.slice(0, 13 * 16))).toEqual(Array.from(mesh(b).instanceMatrix.array.slice(0, 13 * 16)));
    expect(mesh(a).count).toBe(13);
  });

  it('lays a row in one wave of 200 ms', () => {
    const { sector } = sectorAt();
    atTime(0, () => sector.setGrid(60));
    atTime(1000, () => sector.layRow(0, 14));
    const mesh = sector.root.getObjectByName('sector:0:tiles') as unknown as { instanceMatrix: { array: Float32Array } };
    sector.update(1200);
    const settled = Array.from(mesh.instanceMatrix.array.slice(0, 15 * 16));
    sector.update(5000);
    expect(Array.from(mesh.instanceMatrix.array.slice(0, 15 * 16))).toEqual(settled);
  });

  it('handles 392 units, more than 392 and a plot of 4', () => {
    const { sector } = sectorAt(2);
    atTime(0, () => sector.setGrid(392));
    atTime(10, () => sector.layRow(0, 391));
    atTime(1000, () => sector.close(392));
    sector.update(3000);
    expect(sector.tiles).toBe(392);
    expect(sector.grid).toEqual({ rows: 13, cols: 31 });

    const big = sectorAt(3).sector;
    atTime(0, () => big.setGrid(1000));
    atTime(10, () => big.layRow(0, 999));
    atTime(1000, () => big.close(1000));
    big.update(3000);
    expect(big.perTile).toBe(3);
    expect(big.tiles).toBe(334);

    const small = sectorAt(4).sector;
    atTime(0, () => small.setGrid(4));
    for (let i = 0; i < 4; i++) atTime(10 + i, () => small.layTile(i));
    atTime(1000, () => small.close(4));
    small.update(3000);
    expect(small.grid).toEqual({ rows: 4, cols: 1 });
    expect(small.tileIndexAt({ point: small.tilePosition(3) })).toBe(3);
  });

  it('adds a course after the main tiles and numbers it after them', () => {
    const { sector } = sectorAt(5);
    atTime(0, () => sector.setGrid(30));
    atTime(1, () => sector.layRow(0, 29));
    atTime(500, () => sector.close(30));
    atTime(2000, () => sector.addCourse(3));
    sector.update(9000);
    expect(sector.tiles).toBe(33);
    expect(sector.tileIndexAt({ point: sector.tilePosition(31) })).toBe(31);
  });
});
