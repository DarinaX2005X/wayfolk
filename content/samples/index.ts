/**
 * The three samples of the mailbox. Their materials are the files in this folder
 * (content/samples/<id>/*.md); `texts.generated.ts` holds the same texts as a module so
 * the browser, the tests and Node scripts read them alike (scripts/build-fixtures.ts
 * writes it; tests/content checks it is current).
 */
import type { Doc, Project, SampleId, SampleMeta } from '../../src/agents/types';
import { newTaskProject } from '../../src/agents/engine/start';
import { readFile } from '../../src/materials/read';
import { numberPages } from '../../src/materials/pages';
import { SAMPLE_TEXTS } from './texts.generated';

export type Sample = Omit<SampleMeta, 'materialHash'> & { files: string[]; links: string[] };

export const SAMPLES: Sample[] = [
  {
    id: 'bakery-site',
    title: 'Marlow Street Bakery',
    task: 'Make a one-page site for a neighborhood bakery from these notes',
    label: ['A bakery site', 'from notes, 1 file'],
    deliverable: 'site',
    object: 'house',
    files: ['bakery-notes.md'],
    links: [],
  },
  {
    id: 'habit-tracker',
    title: 'Habit tracker',
    task: 'Build a small habit tracker web app: add habits, tick them off each day, see your streaks, and keep everything in local storage',
    label: ['A habit tracker app', 'from one sentence'],
    deliverable: 'site',
    object: 'toolbox',
    files: [],
    links: [],
  },
  {
    id: 'launch-plan',
    title: 'Fernway launch plan',
    task: 'Plan the launch of this habit tracker: tasks, dates, owners',
    label: ['A launch plan', 'from a brief, 1 file'],
    deliverable: 'plan',
    object: 'chart',
    files: ['launch-brief.md'],
    links: [],
  },
];

export const SAMPLE_IDS = SAMPLES.map((s) => s.id);

export function sampleMeta(id: SampleId): Sample {
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) throw new Error(`samples: no sample ${id}`);
  return s;
}

/** The day the samples were recorded: their plans are dated from it. */
export const SAMPLE_TODAY = '2026-11-16';

/** The sample's project, the same on every device (its id is fixed). */
export function sampleProject(id: SampleId, now?: Date): Project {
  const meta = sampleMeta(id);
  return newTaskProject({ text: meta.task, by: 'sample', links: meta.links }, { sample: id, id: `p_sample${id.replace(/-/g, '').slice(0, 6)}`, title: meta.title, ...(now ? { now } : {}) });
}

/** The sample's materials, read by the same code as a person's files. */
export async function sampleDocs(id: SampleId): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const name of sampleMeta(id).files) {
    const text = SAMPLE_TEXTS[`${id}/${name}`];
    if (text === undefined) throw new Error(`samples: ${id}/${name} is missing from texts.generated.ts (run npm run fixtures)`);
    docs.push(await readFile(new Blob([text], { type: 'text/markdown' }), name));
  }
  return numberPages(docs).docs;
}
