/**
 * Pages of a project (`app.docs(project)`), from wherever they live:
 *
 *   an example     from the build: `exampleDocs(example)` of content/answers/index.ts
 *                  (the registry of recorded answers, package 01.7); loaded on first use
 *   own files      from IndexedDB, store `docs` (written when a file is read)
 *   someone else's from what `provideDocs(projectId, docs)` was given (a visit, the
 *                  seating for two); never stored
 *
 * The loader of examples is found at build time, so this module builds before the
 * registry exists; until then an example has no pages and says so.
 */
import type { Doc, ExampleId, Project, ProjectId } from '../agents/types';
import type { Persist } from './persist';

type ExampleSource = (example: ExampleId) => Promise<Doc[]>;

/** content/answers/index.ts, when it exists, exports `exampleDocs`. */
const registries = import.meta.glob<{ exampleDocs?: ExampleSource }>('../../content/answers/index.ts');

let exampleSource: ExampleSource | null = null;

/** Sets where example pages come from (tests and the registry itself may call it). */
export function setExampleSource(source: ExampleSource | null): void {
  exampleSource = source;
}

async function loadExample(example: ExampleId): Promise<Doc[]> {
  if (!exampleSource) {
    const load = Object.values(registries)[0];
    const mod = load ? await load() : null;
    if (typeof mod?.exampleDocs !== 'function') {
      throw new Error(`docs: no pages for the example "${example}" in this build (content/answers/index.ts exports no exampleDocs)`);
    }
    exampleSource = mod.exampleDocs;
  }
  return exampleSource(example);
}

export type DocsSource = {
  docs(project: Project): Promise<Doc[]>;
  provideDocs(projectId: ProjectId, docs: Doc[]): void;
};

export function createDocs(storage: () => Promise<Persist>): DocsSource {
  const provided = new Map<ProjectId, Doc[]>();
  const examples = new Map<ExampleId, Promise<Doc[]>>();

  return {
    async docs(project) {
      const given = provided.get(project.id);
      if (given) return given;
      if (project.example) {
        let pages = examples.get(project.example);
        if (!pages) {
          pages = loadExample(project.example);
          examples.set(project.example, pages);
          // A failed load is not cached: the next call tries again.
          pages.catch(() => examples.delete(project.example!));
        }
        return pages;
      }
      return (await storage()).docs.load(project.id);
    },
    provideDocs(projectId, docs) {
      provided.set(projectId, docs);
    },
  };
}
