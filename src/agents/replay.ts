/**
 * The emergency path only (PLAN "Записанные ответы…"): when the engine threw on an
 * example, the view plays the saved copy of a run (content/runs/harbor-street.events.json)
 * with the caption "Showing a saved copy of this run. The checks could not start on this
 * device." Events go out at their recorded times; pause holds them, skip sends the rest.
 */
import type { Timers } from './queue';
import { defaultTimers } from './recorded';
import type { RunEvent, RunHandle, RunRecord } from './types';

export function replayRun(events: readonly RunEvent[], opts: { timers?: Timers; now?: () => number; pace?: number } = {}): RunHandle {
  const timers = opts.timers ?? defaultTimers;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const pace = opts.pace ?? 1;
  const list = [...events].sort((a, b) => a.seq - b.seq);
  const start = list.find((e) => e.type === 'run-start');
  const end = list.find((e) => e.type === 'run-end');
  const record: RunRecord = {
    id: list[0]?.runId ?? 'replay',
    job: start?.type === 'run-start' ? start.job : 'case',
    ...(start?.type === 'run-start' && start.example ? { example: start.example } : {}),
    projectId: '',
    scope: start?.type === 'run-start' ? start.scope : 'full',
    startedAt: new Date().toISOString(),
    answers: start?.type === 'run-start' ? start.answers : 'recorded',
    provider: start?.type === 'run-start' ? start.provider : null,
    model: start?.type === 'run-start' ? start.model : null,
    status: 'running',
    calls: [],
    events: [],
    partial: {},
    asks: {},
    result: null,
    stats: null,
  };
  const subscribers = new Set<(e: RunEvent) => void>();
  let i = 0;
  let paused = false;
  let skipping = false;
  let cancelled = false;
  let timer: number | null = null;
  let clock = 0;
  let wallAt = now();
  let resolveDone!: (r: RunRecord) => void;
  const done = new Promise<RunRecord>((r) => (resolveDone = r));

  const send = (e: RunEvent) => {
    record.events.push(e);
    for (const fn of subscribers) fn(e);
  };
  const finish = (status: RunRecord['status']) => {
    record.status = status;
    record.stats = end?.type === 'run-end' ? end.stats : null;
    resolveDone(record);
  };
  const step = () => {
    timer = null;
    if (paused || cancelled) return;
    clock += (now() - wallAt) / (pace || 1);
    wallAt = now();
    while (i < list.length && (skipping || pace === 0 || list[i].t <= clock)) send(list[i++]);
    if (i >= list.length) return finish(end?.type === 'run-end' ? end.status : 'ready');
    timer = timers.set(step, Math.max(0, (list[i].t - clock) * pace));
  };
  timer = timers.set(step, 0);

  return {
    id: record.id,
    record: () => record,
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    answer() {},
    shown() {},
    pause(on) {
      if (on === paused) return;
      paused = on;
      if (on && timer !== null) {
        timers.clear(timer);
        timer = null;
        clock += (now() - wallAt) / (pace || 1);
      }
      wallAt = now();
      if (!on) timer = timers.set(step, 0);
    },
    get paused() {
      return paused;
    },
    skip() {
      skipping = true;
      if (timer !== null) timers.clear(timer);
      timer = timers.set(step, 0);
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      if (timer !== null) timers.clear(timer);
      finish('cancelled');
    },
    done,
  };
}
