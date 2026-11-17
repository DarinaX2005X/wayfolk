// The build schedule, pure and unit tested: which birds carry which piece, when they
// pick it up at the cloud edge and when it lands, so pieces land in assembly order and
// the whole build (gather, carry, finish) takes 12–20 seconds.

export interface Carry {
  index: number;
  /** Bird slots (indices into the flock) carrying this piece. */
  birds: number[];
  /** Piece rises out of the clouds and the birds take it. */
  pick: number;
  /** Piece is released above its place. */
  land: number;
  /** Squash and settle are over. */
  settle: number;
}

export interface BuildSchedule {
  items: Carry[];
  /** Birds fly out to the cloud edge before the first pick. */
  gather: number;
  /** Start of the finish (window light, smoke, birds circle). */
  finish: number;
  total: number;
}

export const MIN_TOTAL = 12;
export const MAX_TOTAL = 20;
const GATHER = 1.6;
const FINISH = 3.2;
const SETTLE = 0.55;
const RETURN = 1.2;

/** Birds a piece needs by its size (bounding radius, metres). */
export function birdsFor(radius: number, flock: number): number {
  const want = radius < 0.55 ? 1 : radius < 1.2 ? 2 : 3;
  return Math.max(1, Math.min(want, flock));
}

/**
 * sizes: bounding radius of each piece in assembly order; flock: birds available.
 */
export function planBuild(sizes: number[], flock: number): BuildSchedule {
  const n = sizes.length;
  const birds = Math.max(1, flock);
  if (n === 0) return { items: [], gather: 0, finish: 0, total: 0 };
  // Aim for a total that grows with the piece count, within the bounds.
  const target = Math.min(MAX_TOTAL, Math.max(MIN_TOTAL, 9 + n * 0.55));
  const span = target - GATHER - FINISH - SETTLE;
  // Flight time of one carry and the launch gap between pieces.
  let carry = Math.min(3.4, Math.max(1.6, span * 0.42));
  let gap = n > 1 ? (span - carry) / (n - 1) : 0;
  if (n === 1) carry = Math.max(carry, span);
  gap = Math.max(0.12, gap);

  const freeAt = new Array<number>(birds).fill(GATHER - 0.4);
  const items: Carry[] = [];
  let lastLand = 0;
  for (let i = 0; i < n; i++) {
    const need = birdsFor(sizes[i], birds);
    let pick = GATHER + i * gap;
    // Birds that are free by then; if too few, wait for the earliest ones.
    const order = freeAt.map((t, k) => ({ t, k })).sort((a, b) => a.t - b.t);
    const chosen = order.slice(0, need);
    const ready = Math.max(...chosen.map((c) => c.t));
    pick = Math.max(pick, ready);
    let land = pick + carry;
    land = Math.max(land, lastLand + 0.12); // never land before the previous piece
    lastLand = land;
    for (const c of chosen) freeAt[c.k] = land + RETURN;
    items.push({ index: i, birds: chosen.map((c) => c.k).sort((a, b) => a - b), pick, land, settle: land + SETTLE });
  }
  let finish = items[items.length - 1].settle;
  let total = finish + FINISH;
  if (total > MAX_TOTAL || total < MIN_TOTAL) {
    // Too many pieces for the flock: compress; too few: stretch so the moment is not rushed.
    const goal = total > MAX_TOTAL ? MAX_TOTAL - 0.01 : MIN_TOTAL + 0.01;
    const k = (goal - FINISH - SETTLE) / items[items.length - 1].land;
    for (const it of items) {
      it.pick *= k;
      it.land *= k;
      it.settle = it.land + SETTLE;
    }
    finish = items[items.length - 1].settle;
    total = finish + FINISH;
  }
  return { items, gather: Math.min(GATHER, items[0].pick), finish, total };
}
