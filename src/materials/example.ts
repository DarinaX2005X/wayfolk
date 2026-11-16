/**
 * Recognising a downloaded example (PLAN "Проект и материалы"): the example PDF prints
 * the same blockText lines, wraps only at spaces and adds a footer; the build reads that
 * PDF with the same readFile and keeps materialHash of the result as pdfTextHash. A file
 * someone uploads is the example when the materialHash of its read pages equals
 * pdfTextHash (the footer takes part on both sides). One changed word and it is not.
 */
import type { ExampleMeta, Page } from '../agents/types';
import { materialHash } from './normalize';

export async function matchExample(pages: readonly Page[], examples: readonly ExampleMeta[]): Promise<ExampleMeta | null> {
  if (!pages.length) return null;
  const hash = await materialHash(pages);
  return examples.find((e) => e.pdfTextHash === hash) ?? null;
}
