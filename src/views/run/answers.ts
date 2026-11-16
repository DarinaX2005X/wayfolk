/**
 * Where a sample's answers come from, best first:
 *
 *   1. a recording of the real model (content/answers/<sample>.live.json, written by the
 *      engine package with `npm run record`): replayed through the engine, checks run now;
 *   2. the written answers of this view (./demo/<sample>.answers.json, from
 *      tests/views/demo/build.ts): the same engine and checks, answers written by hand;
 *   3. the saved event stream of a full run (./demo/<sample>.events.json): only when the
 *      engine itself can't start on this device.
 *
 * All three load lazily, as their own chunks.
 */
import type { AnswerSet, RunEvent, SampleId, TaskResult } from '../../agents/types';

type Loader<T> = () => Promise<T>;

const live = import.meta.glob<AnswerSet>('../../../content/answers/*.live.json', { import: 'default' }) as Record<string, Loader<AnswerSet>>;
const written = import.meta.glob<AnswerSet>('./demo/*.answers.json', { import: 'default' }) as Record<string, Loader<AnswerSet>>;
const saved = import.meta.glob<{ events: RunEvent[]; result: TaskResult }>('./demo/*.events.json', { import: 'default' }) as Record<
  string,
  Loader<{ events: RunEvent[]; result: TaskResult }>
>;

const find = <T>(map: Record<string, Loader<T>>, suffix: string): Loader<T> | null => {
  const key = Object.keys(map).find((k) => k.endsWith(suffix));
  return key ? map[key] : null;
};

export type SampleAnswers = { set: AnswerSet; kind: 'recorded' | 'written' };

/** Every answer set this sample has, in the order to try them. `prefer` puts one kind first. */
export async function answerChain(sample: SampleId, prefer: 'recorded' | 'written' | null = null): Promise<SampleAnswers[]> {
  const out: SampleAnswers[] = [];
  const rec = find(live, `/${sample}.live.json`);
  if (rec) {
    try {
      const set = await rec();
      if (set?.calls?.length) out.push({ set, kind: 'recorded' });
    } catch (error) {
      console.error('[gw] the recording of this sample could not be read', error);
    }
  }
  const own = find(written, `/${sample}.answers.json`);
  if (own) {
    try {
      out.push({ set: await own(), kind: 'written' });
    } catch (error) {
      console.error('[gw] the written answers of this sample could not be read', error);
    }
  }
  if (prefer === 'written') out.sort((a, b) => (a.kind === 'written' ? -1 : 0) - (b.kind === 'written' ? -1 : 0));
  return out;
}

export async function savedRun(sample: SampleId): Promise<{ events: RunEvent[]; result: TaskResult } | null> {
  const load = find(saved, `/${sample}.events.json`);
  return load ? load() : null;
}
