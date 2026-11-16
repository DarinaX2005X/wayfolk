/**
 * The cutter (PLAN "Трудный механизм", step read): pages go to the extractor in batches
 * of pagesPerBatch = clamp(ceil(pages / 14), 6, 30). 64 pages give 6 per batch and 11
 * batches (the last is 61–64); 400 pages give 29 per batch and 14 batches.
 */
export type Batch = {
  /** Call number of the batch, from 1 (or from `firstIndex` for later pages). */
  index: number;
  /** First and last page number of the batch. */
  pages: [number, number];
  /** Every page number of the batch, in order. */
  numbers: number[];
};

export function pagesPerBatch(count: number): number {
  return Math.min(30, Math.max(6, Math.ceil(count / 14)));
}

/**
 * Pages are taken in the order given (sorted by number); a batch never mixes more than
 * pagesPerBatch pages. Page numbers need not be contiguous (late pages 65, 66).
 */
export function batchPages(pages: readonly ({ n: number } | number)[], firstIndex = 1): Batch[] {
  const numbers = pages.map((p) => (typeof p === 'number' ? p : p.n)).sort((a, b) => a - b);
  const size = pagesPerBatch(numbers.length);
  const out: Batch[] = [];
  for (let i = 0; i < numbers.length; i += size) {
    const part = numbers.slice(i, i + size);
    out.push({ index: firstIndex + out.length, pages: [part[0], part[part.length - 1]], numbers: part });
  }
  return out;
}
