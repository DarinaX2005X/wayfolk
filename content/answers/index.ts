/**
 * The registry of recorded answers: one recording of the real model per sample
 * (content/answers/<id>.live.json, written once by `npm run record -- <id>`), with the
 * mistakes code planted into it. A run of a sample replays the model's answers and runs
 * every check on the device, so its caption is "Recorded answers from a live run, checks
 * run now".
 *
 *   answersFor(id)        the recording of a sample (loaded on first use)
 *   exampleDocs(id)       the sample's materials (src/app/docs.ts reads them from here)
 *   fixtureSource         the same sets for the server's `fixtures` provider
 *
 * The saved copy of each run (<id>.events.json) is the emergency path of replay.ts:
 * eventsFor(id).
 */
import type { Doc, ExampleId, RunEvent, SampleId } from '../../src/agents/types';
import { isSample } from './sets';

export { answersFor, fixtureSource, isSample } from './sets';

const EVENTS: Record<SampleId, () => Promise<{ default: unknown }>> = {
  'bakery-site': () => import('./bakery-site.events.json'),
  'habit-tracker': () => import('./habit-tracker.events.json'),
  'launch-plan': () => import('./launch-plan.events.json'),
};

export async function eventsFor(id: SampleId): Promise<RunEvent[]> {
  return (await EVENTS[id]()).default as RunEvent[];
}

export async function exampleDocs(id: ExampleId): Promise<Doc[]> {
  if (!isSample(id)) throw new Error(`samples: no sample ${id}`);
  const { sampleDocs } = await import('../samples');
  return sampleDocs(id);
}
