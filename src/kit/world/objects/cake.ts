/**
 * The wedding cake: one tier for every row of tables, wider at the bottom, and one bone
 * rosette on each tier for every table in that row. Built from the ObjectSpec alone.
 */
import type { BufferGeometry } from '@iwsdk/core';
import { COLOR } from '../../../tokens/tokens';
import { cylinder, lathe, merge, placed, sphere, tint } from '../geom';

export function cakeGeometry(spec: { rows: number; tablesPerRow: number[] }): { geometry: BufferGeometry; height: number } {
  const rows = Math.max(1, Math.min(6, spec.rows));
  const parts: BufferGeometry[] = [];
  const tierH = Math.min(0.1, 0.32 / rows);
  const r0 = 0.11;
  const shrink = Math.min(0.026, (r0 - 0.035) / Math.max(1, rows - 1));
  parts.push(tint(cylinder(r0 + 0.02, r0 + 0.022, 0.006, 48), COLOR.boneShade));
  let y = 0.006;
  for (let i = 0; i < rows; i++) {
    const r = r0 - i * shrink;
    // A soft-edged tier: straight side, rounded top edge.
    parts.push(
      tint(
        placed(
          lathe(
            [
              [0, 0],
              [r, 0],
              [r, tierH - 0.008],
              [r - 0.003, tierH - 0.002],
              [r - 0.008, tierH],
              [0, tierH],
            ],
            48,
          ),
          [0, y, 0],
        ),
        COLOR.bone,
      ),
    );
    // A thin piped band at the foot of the tier.
    parts.push(tint(placed(cylinder(r + 0.002, r + 0.002, 0.005, 48), [0, y, 0]), COLOR.paper));
    const tables = Math.max(0, spec.tablesPerRow[i] ?? 0);
    for (let k = 0; k < tables; k++) {
      const a = (k / Math.max(1, tables)) * Math.PI * 2 + i * 0.4;
      parts.push(tint(placed(sphere(0.0075, 10, 6), [Math.sin(a) * (r + 0.002), y + tierH * 0.55, Math.cos(a) * (r + 0.002)], [0, 0, 0], [1, 0.8, 1]), COLOR.paper));
    }
    y += tierH;
  }
  parts.push(tint(placed(sphere(0.012, 14, 8), [0, y + 0.006, 0]), COLOR.paper));
  return { geometry: merge(parts), height: y + 0.018 };
}
