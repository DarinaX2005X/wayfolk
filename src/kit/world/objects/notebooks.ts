/**
 * The stack of school notebooks: one notebook 4 mm thick for every essay, about
 * 18 × 22 × 10 cm for 24, covers in three muted category tones, spines a little out of
 * line. A notebook that waits for the teacher's look carries an amber clip (up to six;
 * past that the last clip carries the number). Built from the ObjectSpec alone.
 */
import type { BufferGeometry } from '@iwsdk/core';
import { COLOR } from '../../../tokens/tokens';
import { bevelBox, box, merge, placed, tint } from '../geom';
import { seeded } from '../time';

export const NOTEBOOK = { w: 0.18, d: 0.22, h: 0.004, clips: 6 };
const TONES = [COLOR.category.ochre, COLOR.category.sage, COLOR.category.steel];

export function notebooksGeometry(spec: { count: number; review: number }, seed = 3): { geometry: BufferGeometry; height: number; numberClip: { at: [number, number, number]; count: number } | null } {
  const rnd = seeded(seed * 131 + spec.count);
  const count = Math.max(1, spec.count);
  // Stacks of more than 60 compress a little so the object keeps under 0.40 m.
  const pitch = Math.min(NOTEBOOK.h, 0.36 / count);
  const parts: BufferGeometry[] = [];
  const cover = bevelBox(NOTEBOOK.w, pitch * 0.32, NOTEBOOK.d, 0.0004, 0.004);
  const pages = box(NOTEBOOK.w - 0.006, pitch * 0.5, NOTEBOOK.d - 0.004);
  const clipsOn = new Set<number>();
  const review = Math.max(0, Math.min(spec.review, count));
  for (let k = 0; k < Math.min(review, NOTEBOOK.clips); k++) clipsOn.add(Math.floor(((k + 0.5) / Math.min(review, NOTEBOOK.clips)) * count));
  let numberClip: { at: [number, number, number]; count: number } | null = null;
  for (let i = 0; i < count; i++) {
    const y = i * pitch;
    const dx = (rnd() - 0.5) * 0.008;
    const dz = (rnd() - 0.5) * 0.006;
    const yaw = (rnd() - 0.5) * 0.06;
    const tone = TONES[Math.floor(rnd() * 3)];
    parts.push(tint(placed(cover, [dx, y, dz], [0, yaw, 0]), tone));
    parts.push(tint(placed(pages, [dx + 0.002, y + pitch * 0.32, dz], [0, yaw, 0]), COLOR.paper));
    parts.push(tint(placed(cover, [dx, y + pitch * 0.82, dz], [0, yaw, 0], [1, 0.55, 1]), tone));
    if (clipsOn.has(i)) {
      const x = dx + NOTEBOOK.w / 2 - 0.03;
      const z = dz + NOTEBOOK.d / 2 + 0.0008;
      parts.push(tint(placed(box(0.012, pitch + 0.003, 0.0016), [x, y - 0.0012, z]), COLOR.amber));
      parts.push(tint(placed(box(0.012, 0.0012, 0.016), [x, y + pitch + 0.0006, z - 0.008]), COLOR.amber));
      if (review > NOTEBOOK.clips && [...clipsOn].pop() === i) numberClip = { at: [x, y + pitch * 0.5, z + 0.002], count: review };
    }
  }
  return { geometry: merge(parts), height: count * pitch, numberClip };
}
