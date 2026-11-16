/**
 * Recorded answers as a model client (PLAN "Записанные ответы, ключ ИИ, прокси и живой
 * прогон"). Only the model's answers are recorded; reading, checks and the result are
 * computed on every run, so a changed word in the materials changes the numbers.
 *
 *   - a call is found by task, number, attempt and redo key, and answered after
 *     ms × pace (pace 0: at once), with the provider of the record;
 *   - a recheck that was not recorded is not an error: the answer is an empty fix with
 *     `missing: true`, and the units sent back are dropped as 'not-recorded';
 *   - any other missing call is agents-offline with need 'fixture' (a redo with an
 *     instruction nobody recorded ends here: "Your own instruction needs the live model").
 * pause(on) stops the waits and skip() ends them (and every later one) at once.
 */
import { LlmError } from './llm-error';
import type { Timers } from './queue';
import type { AnswerSet, CallRecord, LlmClient, LlmResponse, LlmStatus } from './types';

export type RecordedClient = LlmClient & {
  readonly kind: 'recorded';
  readonly set: AnswerSet;
  pause(on: boolean): void;
  skip(): void;
  readonly paused: boolean;
};

export const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clear: (id) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
};

type Wait = { left: number; startedAt: number; id: number | null; done(): void };

export function recordedLlm(set: AnswerSet, opts: { pace?: number; timers?: Timers; now?: () => number } = {}): RecordedClient {
  const pace = opts.pace ?? 1;
  const timers = opts.timers ?? defaultTimers;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const byKey = new Map<string, CallRecord>();
  for (const c of set.calls) byKey.set(`${c.task}/${c.index}/${c.attempt}/${c.redo ?? ''}`, c);
  const model = set.model ?? (set.answers === 'scripted' ? 'scripted answers' : 'recorded answers');
  let paused = false;
  let skipping = false;
  const waits = new Set<Wait>();

  const arm = (w: Wait) => {
    w.startedAt = now();
    w.id = timers.set(() => {
      waits.delete(w);
      w.done();
    }, Math.max(0, w.left));
  };

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const w: Wait = { left: skipping ? 0 : ms * pace, startedAt: 0, id: null, done: resolve };
      waits.add(w);
      if (!paused || w.left === 0) arm(w);
    });

  const status = async (): Promise<LlmStatus> => ({
    live: false,
    provider: 'fixtures',
    model,
    audio: false,
    callsLeftToday: 0,
    runsLeftToday: 0,
  });

  return {
    kind: 'recorded',
    set,
    status,
    get paused() {
      return paused;
    },
    async call(req, callOpts): Promise<LlmResponse> {
      if (callOpts?.signal?.aborted) throw new LlmError('timeout');
      const record = byKey.get(`${req.task}/${req.index}/${req.attempt}/${req.redo ?? ''}`) ?? null;
      let json: unknown;
      let missing = false;
      if (record) {
        if (!record.ok) throw new LlmError('bad-output');
        json = structuredClone(record.json);
      } else if (req.task === 'recheck') {
        json = { fixes: [] };
        missing = true;
      } else {
        throw new LlmError('agents-offline', null, 'fixture');
      }
      const ms = record?.ms ?? 0;
      await wait(ms);
      return {
        json,
        provider: record?.provider ?? 'script',
        model: record?.model ?? model,
        ms,
        ...(record?.planted ? { planted: [...record.planted] } : {}),
        ...(record?.seeded ? { seeded: [...record.seeded] } : {}),
        ...(missing ? { missing } : {}),
      };
    },
    pause(on) {
      if (on === paused) return;
      paused = on;
      for (const w of waits) {
        if (on && w.id !== null) {
          timers.clear(w.id);
          w.id = null;
          w.left -= now() - w.startedAt;
        } else if (!on && w.id === null) arm(w);
      }
    },
    skip() {
      skipping = true;
      for (const w of waits) {
        if (w.id !== null) timers.clear(w.id);
        w.left = 0;
        arm(w);
      }
    },
  };
}

export function isRecordedClient(c: LlmClient): c is RecordedClient {
  return (c as Partial<RecordedClient>).kind === 'recorded';
}
