import { describe, expect, it } from 'vitest';
import { HOUSE_R, ISLETS, LOTS, Land, PIER, SEAT, faceSeat } from '../../src/world/land';

describe('placement', () => {
  it('has room for twelve houses with the islets', () => {
    const land = new Land();
    const free = LOTS.filter((l) => !land.blocked(l.x, l.z, HOUSE_R));
    expect(free.length).toBeGreaterThanOrEqual(9);
    expect(LOTS.length).toBeGreaterThanOrEqual(12);
  });

  it('keeps the seat, the pier and the edge free', () => {
    const land = new Land();
    expect(land.blocked(SEAT.x, SEAT.z - 1)).toBeTruthy();
    expect(land.blocked((PIER.base.x + PIER.end.x) / 2, (PIER.base.z + PIER.end.z) / 2)).toBeTruthy();
    expect(land.blocked(0, -60)).toBeTruthy();
  });

  it('snaps a wish to free ground and faces the seat', () => {
    const land = new Land();
    const s = land.findSpot(SEAT.x + 0.5, SEAT.z - 2, HOUSE_R);
    expect(s.ok).toBe(true);
    expect(land.blocked(s.x, s.z, HOUSE_R)).toBeNull();
    // the house front (+z turned by rotY) points at the seat
    const fx = Math.sin(s.rotY);
    const fz = Math.cos(s.rotY);
    const tx = SEAT.x - s.x;
    const tz = SEAT.z - s.z;
    const l = Math.hypot(tx, tz);
    expect(fx * (tx / l) + fz * (tz / l)).toBeGreaterThan(0.99);
    expect(faceSeat(0, -10)).toBeCloseTo(0, 5);
  });

  it('keeps houses apart once one stands', () => {
    const land = new Land();
    const lot = LOTS[0];
    land.pads.push({ x: lot.x, z: lot.z, r: 2, h: land.height(lot.x, lot.z), id: 'a' });
    expect(land.blocked(lot.x + 1, lot.z, HOUSE_R)).toBe('next to a house');
    const s = land.findSpot(lot.x + 1, lot.z, HOUSE_R);
    expect(s.ok).toBe(true);
    expect(Math.hypot(s.x - lot.x, s.z - lot.z)).toBeGreaterThan(4.9);
  });

  it('grows with islets joined by bridges', () => {
    const land = new Land();
    const first = ISLETS[0];
    expect(land.inside(first.cx, first.cz)).toBe(false);
    expect(land.grow()?.id).toBe(first.id);
    expect(land.inside(first.cx, first.cz)).toBe(true);
    expect(land.blocked(first.cx, first.cz, HOUSE_R)).toBeNull();
    for (let i = 1; i < ISLETS.length; i++) land.grow();
    expect(land.grow()).toBeNull();
  });

  it('gives finite ground everywhere on the island', () => {
    const land = new Land();
    for (const l of LOTS.slice(0, 8)) {
      const h = land.height(l.x, l.z);
      expect(Number.isFinite(h)).toBe(true);
      expect(Math.abs(h)).toBeLessThan(4);
    }
  });
});
