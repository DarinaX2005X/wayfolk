/**
 * Runs a sample from its recording, the same way on a device, in Node scripts and in
 * tests: the recorded answers of the model, every check run now.
 *
 *   runSample(id, set, { pace: 0 })               the full run
 *   runSampleRedo(id, set, previous, { pace: 0 })  its ready redo
 */
import { memoryLocks } from '../../src/agents/locks';
import { memoryRunStore } from '../../src/agents/store';
import { redoStep, startTask } from '../../src/agents/engine/start';
import type { Timers } from '../../src/agents/queue';
import type { AnswerSet, LlmClient, RunDeps, RunRecord, SampleId, TaskResult } from '../../src/agents/types';
import { SAMPLE_TODAY, sampleDocs, sampleProject } from '../samples';

const noModel: LlmClient = {
  async status() {
    return { live: false, provider: 'fixtures', model: 'none', audio: false, callsLeftToday: 0, runsLeftToday: 0 };
  },
  async call() {
    throw new Error('samples: a recorded run asked the live model');
  },
};

/**
 * A clock that jumps: a timer fires as soon as nothing else is left to do, and the time
 * moves to its moment. A run at pace 1 on it has the timing of the real run and takes
 * no time (the saved copy of a run is made this way).
 */
export function virtualClock(): { now(): number; timers: Timers } {
  let now = 0;
  let seq = 0;
  let armed = false;
  const queue = new Map<number, { at: number; fn: () => void }>();
  const pump = () => {
    armed = false;
    let next: [number, { at: number; fn: () => void }] | null = null;
    for (const e of queue) if (!next || e[1].at < next[1].at) next = e;
    if (!next) return;
    queue.delete(next[0]);
    now = Math.max(now, next[1].at);
    next[1].fn();
    arm();
  };
  const arm = () => {
    if (armed || !queue.size) return;
    armed = true;
    setTimeout(pump, 0);
  };
  return {
    now: () => now,
    timers: {
      set(fn, ms) {
        const id = ++seq;
        queue.set(id, { at: now + Math.max(0, ms), fn });
        arm();
        return id;
      },
      clear(id) {
        queue.delete(id);
      },
    },
  };
}

type ReplayOpts = { pace?: number; virtual?: boolean };

function replayDeps(opts: ReplayOpts): RunDeps {
  const clock = opts.virtual ? virtualClock() : null;
  return {
    llm: noModel,
    store: memoryRunStore(),
    now: clock ? clock.now : () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    locks: memoryLocks(),
    ...(clock ? { timers: clock.timers } : {}),
  };
}

export async function runSample(id: SampleId, set: AnswerSet, opts: ReplayOpts = {}): Promise<RunRecord> {
  const h = await startTask(sampleProject(id), await sampleDocs(id), replayDeps(opts), { answers: set, pace: opts.pace ?? 0, today: SAMPLE_TODAY });
  return h.done;
}

export async function runSampleRedo(id: SampleId, set: AnswerSet, previous: TaskResult, opts: ReplayOpts = {}): Promise<RunRecord | null> {
  const ready = set.redos?.[0];
  if (!ready) return null;
  const h = await redoStep(sampleProject(id), previous, ready.stepId, ready.instruction, await sampleDocs(id), replayDeps(opts), {
    answers: set,
    pace: opts.pace ?? 0,
    today: SAMPLE_TODAY,
    preset: ready.preset,
  });
  return h.done;
}
