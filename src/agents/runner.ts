/**
 * The runner (PLAN "Трудный механизм", 01.4.1): one run of a job as a stream of events.
 *
 *   - startRun waits for the project lock and for a stored running run; a run of the
 *     project already going in this tab is returned as is, one going in another tab
 *     makes startRun reject with RunLockedError;
 *   - every event gets seq and t (ms from the start, from deps.now) and goes to the
 *     subscribers at once; the store gets events in batches every 300 ms and right
 *     after each call-end, every model answer through saveCall and every finished batch
 *     through savePartial, so resumeRun continues from the first unfinished batch
 *     without repeating a call; t continues from the last saved event;
 *   - completions of parallel calls are handled one at a time, ordered by answer time,
 *     then by task and call number: with pace 0 two equal runs give the same events;
 *   - asks: the 20 s countdown starts at handle.shown(askId), or by itself 5 s after the
 *     ask event; pause stops the countdown and the waits of recorded answers;
 *   - a live run that hits an unrecoverable error falls back to deps.fallback (event
 *     'fallback') and goes on from the unfinished batches;
 *   - cancel stops new calls and ends the run with status 'cancelled'; finished batches
 *     stay saved. All timers go through deps.timers.
 */
import type { AskSpec, CallResult, CallSpec, EventBody, JobCtx, StoredSpec } from './job';
import { findJob } from './job';
import './jobs/case/install';
import { CancelledError, classifyError, LlmError, RunLockedError } from './llm-error';
import { defaultLocks } from './locks';
import { createLlmQueue, type LlmQueue, type Timers } from './queue';
import { defaultTimers, isRecordedClient, recordedLlm } from './recorded';
import { messageChars, reqHash, schemaProblems } from './schema';
import { emptyStats } from './checks/counters';
import { mulberry32 } from './checks/seed';
import { numberPages } from '../materials/pages';
import type {
  AnswerSet,
  CallRecord,
  LlmClient,
  LlmTask,
  ProjectId,
  RunDeps,
  RunEvent,
  RunHandle,
  RunRecord,
  RunSpec,
  RunErrorCode,
  RunStats,
  TileRef,
} from './types';

export const FLUSH_MS = 300;
export const ASK_TIMEOUT_MS = 20_000;
export const ASK_SELF_START_MS = 5_000;
export const CALL_BUDGET = 30;

const TASK_ORDER: Record<LlmTask, number> = { plan: 0, extract: 1, wishes: 1, mark: 1, recheck: 2, reconcile: 3, intent: 4 };

/** Runs of this page by project, so a second start returns the same handle. */
const active = new Map<ProjectId, Run>();
const starting = new Map<ProjectId, Promise<RunHandle>>();

export async function startRun(spec: RunSpec, deps: RunDeps): Promise<RunHandle> {
  const projectId = spec.project.id;
  const going = active.get(projectId);
  if (going && !going.finished) return going.handle;
  const pending = starting.get(projectId);
  if (pending) return pending;
  const p = (async () => {
    const running = await deps.store.findRunning(projectId);
    if (running) {
      const resumed = await resumeRun(running.id, deps);
      if (resumed) return resumed;
    }
    const release = await (deps.locks ?? defaultLocks()).acquire('gw-run-' + projectId);
    if (!release) throw new RunLockedError(projectId);
    const set = spec.answers === 'live' ? null : spec.answers;
    const stored: StoredSpec = {
      project: spec.project,
      docs: spec.docs,
      scope: spec.scope,
      seed: Boolean(spec.seed) && spec.answers === 'live',
      pace: spec.pace ?? 1,
      answerSet: set,
    };
    const record = newRecord(stored, deps);
    const run = new Run(record, stored, deps, release, false);
    active.set(projectId, run);
    await run.begin();
    return run.handle;
  })();
  starting.set(projectId, p);
  try {
    return await p;
  } finally {
    starting.delete(projectId);
  }
}

export async function resumeRun(runId: string, deps: RunDeps): Promise<RunHandle | null> {
  for (const run of active.values()) if (run.record.id === runId && !run.finished) return run.handle;
  const record = await deps.store.load(runId);
  if (!record || record.status !== 'running') return null;
  const stored = record.partial.spec as StoredSpec | undefined;
  if (!stored) return null;
  const release = await (deps.locks ?? defaultLocks()).acquire('gw-run-' + record.projectId);
  if (!release) throw new RunLockedError(record.projectId);
  const run = new Run(record, stored, deps, release, true);
  active.set(record.projectId, run);
  await run.begin();
  return run.handle;
}

/** Forget runs of this page (tests). */
export function resetRunsForTests(): void {
  active.clear();
  starting.clear();
}

function newId(): string {
  const alphabet = 'abcdefghjkmnpqrstvwxyz23456789';
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return 'r_' + [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function newRecord(spec: StoredSpec, deps: RunDeps): RunRecord {
  const set = spec.answerSet;
  return {
    id: newId(),
    job: spec.project.kind,
    ...(spec.project.example ? { example: spec.project.example } : {}),
    projectId: spec.project.id,
    scope: spec.scope === 'full' ? 'full' : 'late',
    startedAt: new Date().toISOString(),
    answers: set ? set.answers : 'live',
    provider: set ? (set.calls[0]?.provider ?? 'script') : null,
    model: set ? (set.model ?? null) : null,
    status: 'running',
    calls: [],
    events: [],
    partial: { spec },
    asks: {},
    result: null,
    stats: null,
  };
}

/** A timer that can stop and go on with what is left. */
class PausableTimer {
  private id: number | null = null;
  private left = 0;
  private startedAt = 0;
  private fn: (() => void) | null = null;
  constructor(
    private timers: Timers,
    private now: () => number,
  ) {}
  start(ms: number, fn: () => void, paused: boolean): void {
    this.clear();
    this.fn = fn;
    this.left = ms;
    if (!paused) this.arm();
  }
  private arm(): void {
    if (!this.fn) return;
    this.startedAt = this.now();
    const fn = this.fn;
    this.id = this.timers.set(() => {
      this.id = null;
      this.fn = null;
      fn();
    }, Math.max(0, this.left));
  }
  pause(): void {
    if (this.id === null) return;
    this.timers.clear(this.id);
    this.id = null;
    this.left -= this.now() - this.startedAt;
  }
  resume(): void {
    if (this.id === null && this.fn) this.arm();
  }
  clear(): void {
    if (this.id !== null) this.timers.clear(this.id);
    this.id = null;
    this.fn = null;
  }
  get running(): boolean {
    return this.fn !== null;
  }
}

type PendingAsk = {
  askId: string;
  resolve(optionId: string | null): void;
  options: string[];
  self: PausableTimer;
  countdown: PausableTimer;
};

class Run {
  readonly handle: RunHandle;
  finished = false;
  private seq: number;
  private t0: number;
  private lastT: number;
  private tileCount: number;
  private subscribers = new Set<(e: RunEvent) => void>();
  private pending: RunEvent[] = [];
  private flushTimer: number | null = null;
  private writes: Promise<void> = Promise.resolve();
  private timers: Timers;
  private client: LlmClient;
  private queue: LlmQueue<{ station: string; callId: string }>;
  private abort = new AbortController();
  private callCache = new Map<string, CallRecord>();
  private callsUsed = 0;
  private byTask: Partial<Record<LlmTask, number>> = {};
  private modelMs = 0;
  private fellBack = false;
  private cancelled = false;
  private paused = false;
  private asks = new Map<string, PendingAsk>();
  private gateQueue: { key: [number, number, number, number]; go(): void }[] = [];
  private drainArmed = false;
  private rng: () => number;
  private resolveDone!: (r: RunRecord) => void;
  readonly done: Promise<RunRecord>;
  private ctx: JobCtx;

  constructor(
    readonly record: RunRecord,
    private spec: StoredSpec,
    private deps: RunDeps,
    private release: () => void,
    private resumed: boolean,
  ) {
    this.timers = deps.timers ?? defaultTimers;
    const last = record.events[record.events.length - 1];
    this.seq = last ? last.seq + 1 : 0;
    this.lastT = last ? last.t : 0;
    this.t0 = deps.now() - this.lastT;
    this.tileCount = record.events.filter((e) => e.type === 'tile').length;
    for (const c of record.calls) this.callCache.set(c.callId, c);
    for (const e of record.events) {
      if (e.type === 'call-start') {
        this.byTask[e.task] = (this.byTask[e.task] ?? 0) + 1;
        this.callsUsed++;
      }
    }
    this.modelMs = record.calls.filter((c) => c.ok).reduce((s, c) => s + c.ms, 0);
    this.client = spec.answerSet ? recordedLlm(spec.answerSet, { pace: spec.pace, timers: this.timers, now: () => deps.now() }) : deps.llm;
    if (record.events.some((e) => e.type === 'fallback') && deps.fallback) {
      this.fellBack = true;
      this.client = recordedLlm(deps.fallback, { pace: spec.pace, timers: this.timers, now: () => deps.now() });
    }
    this.rng = mulberry32(hashSeed(record.id));
    this.queue = createLlmQueue({
      client: () => this.client,
      timers: this.timers,
      rng: this.rng,
      onWaiting: ({ tag, reason, retryInMs }) => this.emit({ type: 'waiting', station: tag.station, callId: tag.callId, reason, retryInMs }),
      onTwoStreams: () => this.emit({ type: 'note', station: 's2', source: 'Queue', text: 'The model asked us to slow down. Two calls at a time from now on.' }),
    });
    this.done = new Promise((r) => (this.resolveDone = r));
    this.ctx = this.makeCtx();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const run = this;
    this.handle = {
      id: record.id,
      record: () => run.record,
      subscribe(fn) {
        run.subscribers.add(fn);
        return () => run.subscribers.delete(fn);
      },
      answer: (askId, optionId, by) => run.answer(askId, optionId, by),
      shown: (askId) => run.shown(askId),
      pause: (on) => run.pause(on),
      get paused() {
        return run.paused;
      },
      skip: () => run.skip(),
      cancel: () => run.cancel(),
      done: this.done,
    };
  }

  /** Saves the record and starts the job; resolves once the run is under way. */
  async begin(): Promise<void> {
    if (!this.resumed) {
      await this.deps.store.save(this.record);
      const set = this.spec.answerSet;
      this.emit({
        type: 'run-start',
        job: this.record.job,
        ...(this.record.example ? { example: this.record.example } : {}),
        scope: this.record.scope,
        answers: this.record.answers,
        provider: this.record.provider,
        model: this.record.model,
        ...(set?.recordedAt ? { recordedAt: set.recordedAt } : {}),
        planted: set ? set.calls.reduce((n, c) => n + (c.planted?.length ?? 0), 0) : 0,
        seeded: set ? (set.seeded ?? set.calls.reduce((n, c) => n + (c.seeded?.length ?? 0), 0)) : this.spec.seed ? 5 : 0,
      });
    }
    void this.execute();
  }

  private async execute(): Promise<void> {
    const scope = this.spec.scope === 'full' ? 'full' : 'late';
    const job = findJob(this.record.job, scope);
    let status: RunRecord['status'] = 'failed';
    let stats: RunStats = this.record.stats ?? emptyStats(this.ctx.pages.length);
    try {
      if (!job) throw new LlmError('material');
      const out = await job(this.ctx);
      status = out.status;
      stats = out.stats;
      this.record.result = out.result;
    } catch (error) {
      if (error instanceof CancelledError || this.cancelled) status = 'cancelled';
      else {
        const code = error instanceof LlmError ? error.code : 'provider-error';
        if (!(error instanceof LlmError)) console.error('engine: the job stopped', error);
        this.emit({
          type: 'error',
          station: 's1',
          code: code === 'rate-limited' || code === 'provider-busy' ? 'provider-error' : code,
          retryable: false,
        });
        status = 'failed';
      }
    }
    for (const a of this.asks.values()) {
      a.self.clear();
      a.countdown.clear();
    }
    this.asks.clear();
    stats = { ...stats, calls: { ...this.byTask }, modelMs: this.modelMs, tiles: this.tileCount };
    this.record.status = status;
    this.record.stats = stats;
    this.emit({ type: 'run-end', status, calls: this.callsUsed, stats });
    this.finished = true;
    this.flush();
    try {
      await this.writes;
      await this.deps.store.save(this.record);
    } catch (error) {
      console.warn('engine: could not save the finished run', error);
    }
    this.release();
    if (active.get(this.record.projectId) === this) active.delete(this.record.projectId);
    this.resolveDone(this.record);
  }

  // ---------------------------------------------------------------- events and store

  emit(body: EventBody): RunEvent {
    const t = Math.max(this.lastT, Math.round(this.deps.now() - this.t0));
    this.lastT = t;
    const event = { runId: this.record.id, seq: this.seq++, t, ...body } as RunEvent;
    this.record.events.push(event);
    this.pending.push(event);
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch (error) {
        console.error('engine: a subscriber failed', error);
      }
    }
    if (event.type === 'call-end') this.flush();
    else if (this.flushTimer === null) this.flushTimer = this.timers.set(() => this.flush(), FLUSH_MS);
    return event;
  }

  private flush(): void {
    if (this.flushTimer !== null) {
      this.timers.clear(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.pending.length) return;
    const batch = this.pending.splice(0);
    this.write(() => this.deps.store.appendEvents(this.record.id, batch));
  }

  private write(op: () => Promise<void>): Promise<void> {
    this.writes = this.writes.then(op).catch((error) => {
      console.warn('engine: a run write failed; the run goes on in memory', error);
    });
    return this.writes;
  }

  // ---------------------------------------------------------------- calls

  /** Handles completions one at a time, ordered by (time, task, number, attempt). */
  private gate(key: [number, number, number, number]): Promise<void> {
    return new Promise((go) => {
      this.gateQueue.push({ key, go });
      this.armDrain();
    });
  }

  private armDrain(): void {
    if (this.drainArmed) return;
    this.drainArmed = true;
    this.timers.set(() => {
      this.drainArmed = false;
      if (!this.gateQueue.length) return;
      this.gateQueue.sort((a, b) => {
        for (let i = 0; i < 4; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
        return 0;
      });
      this.gateQueue.shift()!.go();
      if (this.gateQueue.length) this.armDrain();
    }, 0);
  }

  private fallbackPossible(): boolean {
    return this.record.answers === 'live' && !this.fellBack && Boolean(this.deps.fallback);
  }

  private async call(spec: CallSpec): Promise<CallResult> {
    const max = spec.maxAttempts ?? 2;
    let attempt = spec.attempt ?? 1;
    const first = attempt;
    for (;;) {
      this.throwIfCancelled();
      const callId = `${spec.task}/${spec.index}/${attempt}`;
      const cached = this.callCache.get(callId);
      if (cached?.ok) {
        const problems = (spec.validate ?? ((j) => schemaProblems(j, spec.schema)))(cached.json);
        if (!problems.length) {
          const response = { json: cached.json, provider: cached.provider, model: cached.model, ms: cached.ms,
            ...(cached.planted ? { planted: cached.planted } : {}), ...(cached.seeded ? { seeded: cached.seeded } : {}) };
          return { json: cached.json, response, attempt, cached: true };
        }
      }
      const req = {
        task: spec.task,
        index: spec.index,
        attempt,
        payload: spec.payload,
        messages: spec.messages,
        schema: spec.schema,
        runId: this.record.id,
      };
      this.callsUsed++;
      this.byTask[spec.task] = (this.byTask[spec.task] ?? 0) + 1;
      const tag = { station: spec.station, callId };
      const chars = messageChars(spec.messages);
      let response;
      try {
        response = await this.queue.call(req, {
          priority: spec.priority ?? 0,
          tag,
          signal: this.abort.signal,
          onStart: () =>
            this.emit({
              type: 'call-start',
              station: spec.station,
              callId,
              task: spec.task,
              role: spec.role,
              index: spec.index,
              attempt,
              ...(spec.pages ? { pages: spec.pages } : {}),
              chars,
            }),
        });
      } catch (raw) {
        if (raw instanceof CancelledError || this.cancelled) throw new CancelledError();
        const error = classifyError(raw);
        this.emit({ type: 'call-end', station: spec.station, callId, ms: 0, ok: false, code: error.code === 'rate-limited' || error.code === 'provider-busy' ? 'provider-error' : error.code });
        if (error.code === 'bad-output') {
          if (attempt - first + 1 < max) {
            attempt++;
            this.note(spec.station, roleName(spec.role), `${roleName(spec.role)} is asked to answer again.`);
            continue;
          }
          throw error;
        }
        if (this.fallbackPossible()) {
          this.switchToFallback(error.code === 'rate-limited' || error.code === 'provider-busy' ? 'provider-error' : error.code);
          attempt = spec.attempt ?? 1;
          continue;
        }
        throw error;
      }
      const problems = (spec.validate ?? ((j) => schemaProblems(j, spec.schema)))(response.json);
      if (!problems.length && spec.transform) {
        const changed = spec.transform(response.json);
        response = { ...response, json: changed.json, ...(changed.seeded?.length ? { seeded: changed.seeded } : {}) };
      }
      const record: CallRecord = {
        callId,
        task: spec.task,
        index: spec.index,
        attempt,
        reqHash: await reqHash(spec.task, spec.messages, spec.schema),
        ms: response.ms,
        ok: problems.length === 0,
        json: response.json,
        provider: response.provider,
        model: response.model,
        ...(response.planted ? { planted: response.planted } : {}),
        ...(response.seeded ? { seeded: response.seeded } : {}),
      };
      this.callCache.set(callId, record);
      const i = this.record.calls.findIndex((c) => c.callId === callId);
      if (i >= 0) this.record.calls[i] = record;
      else this.record.calls.push(record);
      void this.write(() => this.deps.store.saveCall(this.record.id, record));
      if (record.ok) this.modelMs += response.ms;
      const pace = this.spec.answerSet || this.fellBack ? this.spec.pace : 1;
      await this.gate([pace === 0 ? 0 : this.deps.now(), TASK_ORDER[spec.task], spec.index, attempt]);
      this.throwIfCancelled();
      if (!record.ok) {
        this.emit({ type: 'call-end', station: spec.station, callId, ms: response.ms, ok: false, code: 'bad-output' });
        if (attempt - first + 1 < max) {
          attempt++;
          this.note(spec.station, roleName(spec.role), `${roleName(spec.role)} is asked to answer again.`);
          continue;
        }
        throw new LlmError('bad-output');
      }
      this.emit({ type: 'call-end', station: spec.station, callId, ms: response.ms, ok: true, items: countItems(response.json) });
      return { json: response.json, response, attempt, cached: false };
    }
  }

  private switchToFallback(reason: RunErrorCode): void {
    this.fellBack = true;
    this.client = recordedLlm(this.deps.fallback as AnswerSet, { pace: this.spec.pace, timers: this.timers, now: () => this.deps.now() });
    if (this.paused && isRecordedClient(this.client)) this.client.pause(true);
    this.emit({ type: 'fallback', to: 'recorded', reason });
  }

  // ---------------------------------------------------------------- asks

  private ask(station: string, spec: AskSpec): { askId: string; answer: Promise<string | null> } {
    const askId = 'ask:' + spec.pair.join('|');
    const known = this.record.asks[askId];
    if (typeof known === 'string') return { askId, answer: Promise.resolve(known) };
    if (this.record.events.some((e) => e.type === 'answer' && e.askId === askId)) return { askId, answer: Promise.resolve(null) };
    const answer = new Promise<string | null>((resolve) => {
      const pending: PendingAsk = {
        askId,
        resolve,
        options: spec.options.map((o) => o.id),
        self: new PausableTimer(this.timers, () => this.deps.now()),
        countdown: new PausableTimer(this.timers, () => this.deps.now()),
      };
      this.asks.set(askId, pending);
      this.record.asks[askId] = null;
      this.emit({ type: 'ask', station, askId, pair: spec.pair, question: spec.question, options: spec.options, timeoutMs: ASK_TIMEOUT_MS });
      pending.self.start(ASK_SELF_START_MS, () => this.startCountdown(askId), this.paused);
    });
    return { askId, answer };
  }

  private startCountdown(askId: string): void {
    const a = this.asks.get(askId);
    if (!a || a.countdown.running) return;
    a.self.clear();
    a.countdown.start(ASK_TIMEOUT_MS, () => this.finishAsk(askId, null, 'timeout'), this.paused);
  }

  private finishAsk(askId: string, optionId: string | null, by: 'hand' | 'voice' | 'gaze' | 'mouse' | 'timeout'): void {
    const a = this.asks.get(askId);
    if (!a) return;
    a.self.clear();
    a.countdown.clear();
    this.asks.delete(askId);
    this.record.asks[askId] = optionId;
    this.emit({ type: 'answer', askId, optionId, by });
    a.resolve(optionId);
  }

  answer(askId: string, optionId: string, by: 'hand' | 'voice' | 'gaze' | 'mouse'): void {
    const a = this.asks.get(askId);
    if (!a || !a.options.includes(optionId)) return;
    this.finishAsk(askId, optionId, by);
  }

  shown(askId: string): void {
    this.startCountdown(askId);
  }

  // ---------------------------------------------------------------- control

  pause(on: boolean): void {
    if (on === this.paused) return;
    this.paused = on;
    if (isRecordedClient(this.client)) this.client.pause(on);
    for (const a of this.asks.values()) {
      if (on) {
        a.self.pause();
        a.countdown.pause();
      } else {
        a.self.resume();
        a.countdown.resume();
      }
    }
  }

  skip(): void {
    if (isRecordedClient(this.client)) this.client.skip();
  }

  cancel(): void {
    if (this.cancelled || this.finished) return;
    this.cancelled = true;
    this.abort.abort();
    this.queue.cancel();
    for (const a of [...this.asks.values()]) {
      a.self.clear();
      a.countdown.clear();
      a.resolve(null);
    }
    this.asks.clear();
    for (const g of this.gateQueue.splice(0)) g.go();
  }

  throwIfCancelled(): void {
    if (this.cancelled) throw new CancelledError();
  }

  private note(station: string, source: string, text: string, key?: boolean): void {
    this.emit({ type: 'note', station, source, text, ...(key ? { key } : {}) });
  }

  // ---------------------------------------------------------------- context for the job

  private makeCtx(): JobCtx {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const run = this;
    const numbered = numberPages(this.spec.docs);
    const started = new Set(this.record.events.filter((e) => e.type === 'step-start').map((e) => (e as { station: string }).station));
    const ended = new Set(this.record.events.filter((e) => e.type === 'step-end').map((e) => (e as { station: string }).station));
    return {
      runId: this.record.id,
      spec: this.spec,
      project: this.spec.project,
      docs: numbered.docs,
      pages: numbered.pages,
      answers: this.record.answers,
      seed: this.spec.seed,
      resumed: this.resumed,
      partial: this.record.partial,
      record: this.record,
      emit: (e) => run.emit(e),
      stepStart(station) {
        if (started.has(station)) return;
        started.add(station);
        run.emit({ type: 'step-start', station });
      },
      stepEnd(station, summary) {
        if (ended.has(station)) return;
        ended.add(station);
        run.emit({ type: 'step-end', station, summary });
      },
      note: (station, source, text, key) => run.note(station, source, text, key),
      tile(station, ref: TileRef) {
        const i = run.tileCount++;
        run.emit({ type: 'tile', station, i, ref });
        return i;
      },
      get tiles() {
        return run.tileCount;
      },
      call: (spec) => run.call(spec),
      save: (key, value) => {
        run.record.partial[key] = value;
        return run.write(() => run.deps.store.savePartial(run.record.id, key, value));
      },
      ask: (station, spec) => run.ask(station, spec),
      get calls() {
        return run.callsUsed;
      },
      get callsByTask() {
        return run.byTask;
      },
      get modelMs() {
        return run.modelMs;
      },
      budget: CALL_BUDGET,
      get cancelled() {
        return run.cancelled;
      },
      throwIfCancelled: () => run.throwIfCancelled(),
      now: () => run.deps.now(),
      rng: () => run.rng(),
    };
  }
}

const ROLE_NAMES: Record<string, string> = {
  planner: 'Planner',
  extractor: 'Extractor',
  reconciler: 'Reconciler',
  wishes: 'Wish reader',
  marker: 'Marker',
};
const roleName = (role: string) => ROLE_NAMES[role] ?? role;

/** Length of the first list in an answer: events, fixes, verdicts. */
function countItems(json: unknown): number | undefined {
  if (!json || typeof json !== 'object') return undefined;
  for (const v of Object.values(json as Record<string, unknown>)) if (Array.isArray(v)) return v.length;
  return undefined;
}

function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
