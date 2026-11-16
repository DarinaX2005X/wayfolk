/**
 * Helpers of the engine tests: a model that answers by a function of the request, the
 * run dependencies in memory, and a way to wait for a run.
 */
import { memoryLocks } from '../../src/agents/locks';
import { resetRunsForTests } from '../../src/agents/runner';
import { memoryRunStore } from '../../src/agents/store';
import type { Doc, LlmClient, LlmRequest, RunDeps, RunEvent, RunRecord } from '../../src/agents/types';
import { readFile } from '../../src/materials/read';
import { numberPages } from '../../src/materials/pages';

export type Answerer = (req: LlmRequest, user: string) => unknown;

/** A model that answers at once with whatever `answer` returns; every request is kept. */
export function fakeModel(answer: Answerer): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async status() {
      return { live: true, provider: 'fixtures', model: 'fake', audio: false, callsLeftToday: 99, runsLeftToday: 9 };
    },
    async call(req) {
      requests.push(req);
      const user = req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
      const json = answer(req, user);
      if (json instanceof Error) throw json;
      return { json, provider: 'fixtures', model: 'fake', ms: 5 };
    },
  };
}

/** Timers that run at once (pace 0 runs; asks time out at once). */
export const instantTimers = {
  set: (fn: () => void) => setTimeout(fn, 0) as unknown as number,
  clear: (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

export function deps(llm: LlmClient, extra: Partial<RunDeps> = {}): RunDeps {
  resetRunsForTests();
  let t = 0;
  return { llm, store: memoryRunStore(), now: () => (t += 1), locks: memoryLocks(), timers: instantTimers, ...extra };
}

export async function docsOf(files: Record<string, string>): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const [name, text] of Object.entries(files)) docs.push(await readFile(new Blob([text]), name));
  return numberPages(docs).docs;
}

export const of = <T extends RunEvent['type']>(r: RunRecord, type: T) => r.events.filter((e): e is Extract<RunEvent, { type: T }> => e.type === type);

/** The schema name of a request, read from its required keys. */
export function shape(req: LlmRequest): string {
  const keys = req.schema.required ?? [];
  if (keys.includes('steps')) return 'plan';
  if (keys.includes('fixes')) return 'fix';
  if (keys.includes('facts')) return 'facts';
  if (keys.includes('content')) return 'file';
  if (keys.includes('items')) return 'items';
  if (keys.includes('sections')) return 'sections';
  if (keys.includes('issues')) return 'review';
  if (keys.includes('rows')) return 'table';
  if (keys.includes('choice')) return 'decision';
  return 'unknown';
}

/** A planner step with every field empty, for writing plan answers in tests. */
export const pstep = (p: Partial<{ id: string; kind: string; title: string; does: string; uses: string[]; files: { path: string; purpose: string }[]; sections: string[]; required: { what: string; selector: string }[]; columns: { name: string; type: 'money' }[] }>) => ({
  id: 's1',
  kind: 'research',
  title: 'Step',
  does: 'Does a thing',
  uses: [],
  focus: '',
  files: [],
  sections: [],
  columns: [],
  options: [],
  criteria: [],
  required: [],
  done: [],
  ...p,
});

export const planAnswer = (p: Record<string, unknown>) => ({
  understood: 'The person wants a thing.',
  title: 'A project',
  deliverable: 'site',
  fit: 'yes',
  notDoable: '',
  instead: '',
  question: '',
  options: [],
  object: 'house',
  objectWhy: 'It is a place',
  windowFrom: '',
  windowTo: '',
  team: [],
  steps: [],
  ...p,
});
