/**
 * The frame measure behind `window.__gw.perf.info()`: unique draw calls per eye,
 * triangles per eye and the split by budget zone (DESIGN "Бюджет отрисовки по зонам").
 *
 * renderer.info counts every call the renderer issued in the last frame. In an emulated
 * session IWER renders two views and three.js counts a call per view, so the count is
 * divided by `BUDGET.viewFactor` (measured by task 01.1.4) while presenting. The zone
 * split walks the scene itself (./zone.ts); the two totals must agree within two calls,
 * otherwise `mismatch` says by how much, because then a zone is hiding draws.
 */
import type { Camera, World } from '@iwsdk/core';
import { BUDGET } from '../../tokens/tokens';
import { countZones, type ZoneName } from './zone';

export type PerfInfo = {
  /** Unique draw calls per eye, from renderer.info. */
  calls: number;
  /** Triangles per eye. */
  triangles: number;
  /** Raw renderer.info of the last frame. */
  raw: { calls: number; triangles: number };
  /** Views per frame the raw numbers were divided by. */
  viewFactor: number;
  presenting: boolean;
  /** Unique calls per eye by zone, from the scene walk. */
  zones: Partial<Record<ZoneName, number>>;
  /** Sum of the zones. */
  counted: number;
  /** Null when the zone walk and renderer.info agree within two calls. */
  mismatch: string | null;
  /** Zones over their share of the budget, and the frame over its totals. */
  over: string[];
};

export function measure(world: World): PerfInfo {
  const renderer = world.renderer;
  const presenting = renderer.xr.isPresenting;
  const viewFactor = presenting ? BUDGET.viewFactor : 1;
  const raw = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  const cameras: Camera[] = presenting ? [...renderer.xr.getCamera().cameras] : [world.camera];
  const { zones, total } = countZones(world.scene, cameras.length ? cameras : [world.camera]);
  const calls = raw.calls / viewFactor;
  const triangles = raw.triangles / viewFactor;
  const mismatch = Math.abs(total - calls) > 2 ? `zones count ${total} calls, renderer.info ${calls} per eye` : null;
  const over: string[] = [];
  for (const [name, n] of Object.entries(zones)) {
    const share = (BUDGET.zones as Record<string, number>)[name];
    if (share === undefined) over.push(`${n} draws in no zone`);
    else if ((n ?? 0) > share) over.push(`${name}: ${n} of ${share}`);
  }
  if (calls > BUDGET.drawCalls) over.push(`frame: ${calls} calls of ${BUDGET.drawCalls}`);
  if (triangles > BUDGET.triangles) over.push(`frame: ${triangles} triangles of ${BUDGET.triangles}`);
  return { calls, triangles, raw, viewFactor, presenting, zones, counted: total, mismatch, over };
}
