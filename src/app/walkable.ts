/**
 * Where a person may stand on the island: the top of the ground mesh (a grid of half-metre
 * cells, read once from its upward faces and drawn in a cell from the cliff edge), less the
 * houses and the tree trunks. Shared by walking in a page and moving in a headset.
 */
import { Box3, Vector3, type Mesh } from '@iwsdk/core';
import type { WorldPort } from './ports';

export type Walkable = {
  /** May the person stand at this point (world space)? */
  ok(x: number, z: number): boolean;
  /** Forget the grid (the island grew); it is read again on the next question. */
  reset(): void;
};

type Grid = { x0: number; z0: number; nx: number; nz: number; cell: number; cells: Uint8Array };

export function createWalkable(world: WorldPort, blocked: () => { x: number; z: number; r: number }[]): Walkable {
  let grid: Grid | null = null;
  let trees: { x: number; z: number }[] | null = null;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();

  const build = (): Grid | null => {
    const ground = (world as { ground?: Mesh }).ground;
    if (!ground?.isMesh || !ground.geometry?.attributes?.position) return null;
    ground.updateMatrixWorld(true);
    const box = new Box3().setFromObject(ground);
    if (box.isEmpty()) return null;
    const cell = 0.5;
    const x0 = box.min.x - cell;
    const z0 = box.min.z - cell;
    const nx = Math.ceil((box.max.x - box.min.x) / cell) + 3;
    const nz = Math.ceil((box.max.z - box.min.z) / cell) + 3;
    const raw = new Uint8Array(nx * nz);
    const pos = ground.geometry.attributes.position;
    const index = ground.geometry.index;
    const tris = index ? index.count / 3 : pos.count / 3;
    const m = ground.matrixWorld;
    for (let t = 0; t < tris; t += 1) {
      const ia = index ? index.getX(t * 3) : t * 3;
      const ib = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const ic = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m);
      b.fromBufferAttribute(pos, ib).applyMatrix4(m);
      c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      e1.cross(e2);
      const len = e1.length();
      // Only faces that look up (either winding): the top of the island, not its cliffs.
      if (len < 1e-9 || Math.abs(e1.y) / len < 0.6 || Math.max(a.y, b.y, c.y) < box.min.y + 0.05) continue;
      const i0 = Math.max(0, Math.floor((Math.min(a.x, b.x, c.x) - x0) / cell));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(a.x, b.x, c.x) - x0) / cell));
      const j0 = Math.max(0, Math.floor((Math.min(a.z, b.z, c.z) - z0) / cell));
      const j1 = Math.min(nz - 1, Math.floor((Math.max(a.z, b.z, c.z) - z0) / cell));
      for (let j = j0; j <= j1; j += 1) for (let i = i0; i <= i1; i += 1) raw[j * nx + i] = 1;
    }
    // A cell from the edge: nobody walks off the cliff.
    const cells = new Uint8Array(nx * nz);
    for (let j = 1; j < nz - 1; j += 1)
      for (let i = 1; i < nx - 1; i += 1) {
        const k = j * nx + i;
        cells[k] = raw[k] && raw[k - 1] && raw[k + 1] && raw[k - nx] && raw[k + nx] ? 1 : 0;
      }
    return { x0, z0, nx, nz, cell, cells };
  };

  const treeSpots = (): { x: number; z: number }[] => {
    if (trees) return trees;
    const list = (world as { perches?: () => { pos: Vector3; kind: string }[] }).perches?.() ?? [];
    const root = (world as { root?: { localToWorld(v: Vector3): Vector3 } }).root;
    trees = list
      .filter((p) => p.kind === 'tree')
      .map((p) => {
        const v = root ? root.localToWorld(p.pos.clone()) : p.pos;
        return { x: v.x, z: v.z };
      });
    return trees;
  };

  return {
    ok(x, z) {
      grid ??= build();
      if (grid) {
        const i = Math.floor((x - grid.x0) / grid.cell);
        const j = Math.floor((z - grid.z0) / grid.cell);
        if (i < 0 || j < 0 || i >= grid.nx || j >= grid.nz || !grid.cells[j * grid.nx + i]) return false;
      }
      for (const h of blocked()) if (Math.hypot(x - h.x, z - h.z) < h.r) return false;
      for (const t of treeSpots()) if (Math.hypot(x - t.x, z - t.z) < 0.55) return false;
      return true;
    },
    reset() {
      grid = null;
      trees = null;
    },
  };
}
