/**
 * The case stack: one sheet for every two pages (64 pages → 32 sheets of 1.5 mm, a little
 * air and a seeded jitter between them, about 21 × 15 × 13 cm), tied crosswise with red
 * thread and a knot on top. Every open contradiction hangs a vermilion tag on the stack
 * (up to 12; past that the last tag carries the number), every closed one is a moss knot
 * on the thread. Built from the ObjectSpec alone.
 */
import { Color, type BufferGeometry } from '@iwsdk/core';
import { COLOR } from '../../../tokens/tokens';
import { bevelBox, box, merge, placed, sphere, tint } from '../geom';
import { seeded } from '../time';

export const STACK = { w: 0.21, d: 0.15, sheet: 0.0015, gap: 0.0025, maxH: 0.38, tags: 12 };

export function stackHeight(pages: number): number {
  const sheets = Math.max(1, Math.ceil(pages / 2));
  return sheets * Math.min(STACK.sheet + STACK.gap, STACK.maxH / sheets);
}

export function caseStackGeometry(spec: { pages: number; open: number; closed: number }, seed = 1): { geometry: BufferGeometry; height: number; numberTag: { at: [number, number, number]; count: number } | null } {
  const rnd = seeded(seed * 977 + spec.pages);
  const sheets = Math.max(1, Math.ceil(spec.pages / 2));
  const pitch = Math.min(STACK.sheet + STACK.gap, STACK.maxH / sheets);
  const height = sheets * pitch;
  const parts: BufferGeometry[] = [];
  const sheet = bevelBox(STACK.w, STACK.sheet, STACK.d, 0.0004, 0.002);
  const paper = new Color(COLOR.paper);
  const edge = new Color(COLOR.edge);
  for (let i = 0; i < sheets; i++) {
    const g = placed(sheet, [(rnd() - 0.5) * 0.006, i * pitch, (rnd() - 0.5) * 0.005], [0, (rnd() - 0.5) * 0.05, 0]);
    tint(g, i % 3 === 1 ? edge : paper);
    parts.push(g);
  }
  // Between the loose sheets the stack shows a shaded core, so it reads as one block.
  parts.push(tint(placed(box(STACK.w - 0.012, height - 0.002, STACK.d - 0.012), [0, 0.001, 0]), COLOR.boneShade));
  // Red thread crosswise: over the top and down the four sides, 4 mm wide.
  const red = COLOR.vermilion;
  const t = 0.004;
  const top = height + 0.0008;
  parts.push(tint(placed(box(STACK.w + 0.004, 0.0015, t), [0, top, 0]), red));
  parts.push(tint(placed(box(t, 0.0015, STACK.d + 0.004), [0, top, 0]), red));
  for (const s of [-1, 1]) {
    parts.push(tint(placed(box(0.0015, height, t), [s * (STACK.w / 2 + 0.0015), 0, 0]), red));
    parts.push(tint(placed(box(t, height, 0.0015), [0, 0, s * (STACK.d / 2 + 0.0015)]), red));
  }
  parts.push(tint(placed(sphere(0.008, 12, 8), [0, top + 0.004, 0], [0, 0, 0], [1.3, 0.7, 1]), red));
  parts.push(tint(placed(sphere(0.005, 10, 6), [0.009, top + 0.002, 0.004]), red));
  // Tags of open contradictions on short strings around the top edge of the stack.
  const open = Math.max(0, spec.open);
  const shown = Math.min(open, STACK.tags);
  const ring = (k: number, n: number): { x: number; z: number; yaw: number } => {
    // Around the perimeter, front and sides first (the person sees the front).
    const order = [0.5, 0.3, 0.7, 0.15, 0.85, 0.05, 0.95, 0.4, 0.6, 0.22, 0.78, 0.1];
    const u = order[k % order.length] + Math.floor(k / order.length) * 0.03;
    void n;
    // u 0..1 runs left side → front → right side.
    if (u < 0.2) return { x: -STACK.w / 2 - 0.004, z: -STACK.d / 2 + (u / 0.2) * STACK.d, yaw: Math.PI / 2 };
    if (u > 0.8) return { x: STACK.w / 2 + 0.004, z: STACK.d / 2 - ((u - 0.8) / 0.2) * STACK.d, yaw: -Math.PI / 2 };
    return { x: -STACK.w / 2 + ((u - 0.2) / 0.6) * STACK.w, z: STACK.d / 2 + 0.004, yaw: 0 };
  };
  let numberTag: { at: [number, number, number]; count: number } | null = null;
  for (let k = 0; k < shown; k++) {
    const p = ring(k, shown);
    const y = height - 0.012 - (k % 3) * 0.006;
    parts.push(tint(placed(box(0.0012, 0.012, 0.0012), [p.x, y, p.z]), red));
    const tag = placed(bevelBox(0.022, 0.03, 0.0016, 0.0005, 0.002), [p.x + Math.sin(p.yaw) * 0.001, y - 0.03, p.z + Math.cos(p.yaw) * 0.001], [0.05 * (rnd() - 0.5), p.yaw, 0.12 * (rnd() - 0.5)]);
    const last = k === shown - 1 && open > STACK.tags;
    tint(tag, last ? COLOR.paper : COLOR.vermilion);
    if (last) numberTag = { at: [p.x, y - 0.015, p.z + 0.002], count: open };
    parts.push(tag);
  }
  // Moss knots of closed contradictions along the thread on top.
  const closed = Math.min(Math.max(0, spec.closed), STACK.tags);
  for (let k = 0; k < closed; k++) {
    const along = (k + 1) / (closed + 1) - 0.5;
    const x = k % 2 === 0 ? along * STACK.w * 0.9 : 0;
    const z = k % 2 === 0 ? 0 : along * STACK.d * 0.9;
    parts.push(tint(placed(sphere(0.0045, 10, 6), [x, top + 0.002, z], [0, 0, 0], [1.2, 0.8, 1]), COLOR.moss));
  }
  return { geometry: merge(parts), height: height + 0.008, numberTag };
}
