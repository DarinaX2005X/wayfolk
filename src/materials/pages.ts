/**
 * Pages of a project as one numbered list. Page numbers are what the model cites
 * ("[p. 23]"), so they must be unique across documents: the example numbers its pages
 * through all twelve documents; own files are numbered from 1 each, and are given
 * running numbers here (document ranges follow).
 */
import type { Doc, DocMeta, Page } from '../agents/types';

export type NumberedDocs = { docs: Doc[]; pages: Page[] };

export function numberPages(docs: readonly Doc[]): NumberedDocs {
  const all = docs.flatMap((d) => d.pages);
  const increasing = all.every((p, i) => i === 0 || p.n > all[i - 1].n);
  if (increasing) return { docs: [...docs], pages: all };
  let next = 1;
  const out = docs.map((d) => {
    const pages = d.pages.map((p) => ({ ...p, n: next++ }));
    const meta: DocMeta = { ...d.meta, from: pages[0]?.n ?? next, to: pages[pages.length - 1]?.n ?? next - 1 };
    return { ...d, meta, pages };
  });
  return { docs: out, pages: out.flatMap((d) => d.pages) };
}

/** The document a page belongs to. */
export function docOf(docs: readonly Doc[], page: Page): DocMeta | undefined {
  return docs.find((d) => d.meta.id === page.docId)?.meta;
}
