/**
 * Recorded answers as a model client (PLAN "Записанные ответы, ключ ИИ, прокси и живой
 * прогон"). Only the model's answers are recorded; reading, checks, candidates and the
 * result are computed on every run, so a changed word on a page changes the numbers.
 *
 *   - a call is found by task, number and attempt and answered after ms × pace
 *     (pace 0: at once), with the provider of the record;
 *   - reconcile takes from the whole recording the verdicts for the pair keys of its
 *     request payload; a pair the recording never judged gets 'unjudged';
 *   - a recheck that was not recorded is not an error: the answer is an empty fix with
 *     `missing: true`, and the batch's claims are dropped as 'not-recorded';
 *   - any other missing call is agents-offline with need 'fixture'.
 * pause(on) stops the waits and skip() ends them (and every later one) at once.
 */
import { LlmError } from './llm-error';
import type { Timers } from './queue';
import type { AnswerSet, CallRecord, LlmClient, LlmResponse, LlmStatus, ReconcileAnswer } from './types';

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
  for (const c of set.calls) byKey.set(`${c.task}/${c.index}/${c.attempt}`, c);
  // The dictionary of verdicts of the whole recording, by pair key.
  const verdicts = new Map<string, ReconcileAnswer['verdicts'][number]>();
  for (const c of set.calls) {
    if (c.task !== 'reconcile' || !c.ok) continue;
    for (const v of (c.json as Partial<ReconcileAnswer>)?.verdicts ?? []) if (v?.pairKey) verdicts.set(v.pairKey, v);
  }
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
      let record = byKey.get(`${req.task}/${req.index}/${req.attempt}`) ?? null;
      let json: unknown;
      let missing = false;
      if (req.task === 'reconcile') {
        const pairs = ((req.payload as { pairs?: { key: string }[] })?.pairs ?? []).map((p) => p.key);
        record = record ?? set.calls.find((c) => c.task === 'reconcile') ?? null;
        json = {
          verdicts: pairs.map(
            (key) =>
              verdicts.get(key) ?? { pairKey: key, verdict: 'unjudged', explanation: '', question: '', options: [] },
          ),
        };
      } else if (record) {
        if (!record.ok) throw new LlmError('bad-output');
        json = structuredClone(record.json);
      } else if (req.task === 'recheck') {
        json = { fixes: [], added: [] };
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
