/**
 * The recordings of the samples, loaded on first use. The server imports only this
 * module (api/_routes.ts), so its bundle carries the answers and nothing else.
 */
import type { AnswerSet, SampleId } from '../../src/agents/types';

const SETS: Record<SampleId, () => Promise<{ default: unknown }>> = {
  'bakery-site': () => import('./bakery-site.live.json'),
  'habit-tracker': () => import('./habit-tracker.live.json'),
  'launch-plan': () => import('./launch-plan.live.json'),
};

export const isSample = (id: string): id is SampleId => Object.hasOwn(SETS, id);

const cache = new Map<SampleId, Promise<AnswerSet>>();

export function answersFor(id: SampleId): Promise<AnswerSet> {
  let p = cache.get(id);
  if (!p) {
    p = SETS[id]().then((m) => m.default as AnswerSet);
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

/** For setFixtureSource of the server: a recorded sample by its id. */
export async function fixtureSource(example: string, scope: 'full' | 'late'): Promise<AnswerSet | null> {
  if (scope !== 'full' || !isSample(example)) return null;
  return answersFor(example);
}
