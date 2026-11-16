/**
 * Shared helpers of the engine tests: manual timers, running Willow Lane with verdicts
 * keyed by the real event ids, and waiting for events.
 */
import { checkQuote } from '../../src/agents/checks/quote';
import { significance } from '../../src/agents/checks/significant';
import { candidates } from '../../src/agents/jobs/case/candidates';
import { eventId } from '../../src/agents/jobs/case/verify';
import { memoryLocks } from '../../src/agents/locks';
import { resetRunsForTests, startRun } from '../../src/agents/runner';
import { memoryRunStore } from '../../src/agents/store';
import type { CaseEvent, ExtractedEvent, LlmClient, Page, RunDeps, RunEvent, RunHandle } from '../../src/agents/types';
import { willowClaims, willowDocs, willowPages, willowPlan, willowProject, willowSet, WILLOW_VERDICTS } from './fixtures/willow';

/** Timers that fire only when the test moves time. */
export function manualTimers() {
  let t = 0;
  let id = 1;
  const due = new Map<number, { at: number; fn: () => void; order: number }>();
  let order = 0;
  const timers = {
    set(fn: () => void, ms: number) {
      const n = id++;
      due.set(n, { at: t + Math.max(0, ms), fn, order: order++ });
      return n;
    },
    clear(n: number) {
      due.delete(n);
    },
  };
  /** Moves time by `ms`, firing due timers in order and letting promises settle between them. */
  async function advance(ms: number): Promise<void> {
    const end = t + ms;
    for (;;) {
      await settle();
      let pick: [number, { at: number; fn: () => void; order: number }] | null = null;
      for (const entry of due) if (entry[1].at <= end && (!pick || entry[1].at < pick[1].at || (entry[1].at === pick[1].at && entry[1].order < pick[1].order))) pick = entry;
      if (!pick) break;
      due.delete(pick[0]);
      t = Math.max(t, pick[1].at);
      pick[1].fn();
    }
    t = end;
    await settle();
  }
  return { timers, now: () => t, advance, pending: () => due.size };
}

/** Lets every queued promise and I/O callback run. */
export async function settle(rounds = 5): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

/** The event id a claim becomes, as the gate computes it. */
export function idOf(claim: ExtractedEvent, pages: Page[] = willowPages()): string {
  const q = checkQuote(claim, pages, significance(willowPlan.parties));
  return eventId(q.page, q.quote);
}

/** Willow Lane verdicts keyed by the real pair keys of the given pages. */
export function willowVerdicts(pages: Page[] = willowPages()) {
  const claims = willowClaims();
  const events = [claims[1], claims[3], claims[4]].map((c) => ({ id: idOf(c, pages), facts: c.facts, at: c.date || null }) as unknown as CaseEvent);
  const pairs = candidates(events, willowPlan.fields);
  return WILLOW_VERDICTS.map((v) => {
    const pair = pairs.find((p) => p.field === v.field)!;
    return { pairKey: pair.key, verdict: v.verdict, explanation: v.explanation, question: v.question ?? '', options: v.options ?? [] };
  });
}

export function deps(over: Partial<RunDeps> = {}): RunDeps & { store: ReturnType<typeof memoryRunStore> } {
  return {
    llm: { status: async () => { throw new Error('no live model in this test'); }, call: async () => { throw new Error('no live model in this test'); } } as LlmClient,
    store: memoryRunStore(),
    now: () => performance.now(),
    locks: memoryLocks(),
    ...over,
  } as RunDeps & { store: ReturnType<typeof memoryRunStore> };
}

/** Runs Willow Lane on scripted answers at pace 0; `answer` is given to the question as soon as it comes. */
export async function runWillow(opts: { pages?: Page[]; answer?: string | null; recheck?: boolean } = {}) {
  resetRunsForTests();
  const pages = opts.pages ?? willowPages();
  const set = willowSet(willowVerdicts(willowPages()), { recheck: opts.recheck });
  const d = deps();
  const h = await startRun({ project: willowProject(), docs: willowDocs(pages), scope: 'full', answers: set, pace: 0 }, d);
  if (opts.answer) h.subscribe((e) => e.type === 'ask' && setImmediate(() => h.answer(e.askId, opts.answer!, 'mouse')));
  else h.subscribe((e) => e.type === 'ask' && h.shown(e.askId));
  const record = await h.done;
  return { record, handle: h, deps: d };
}

export function waitFor(h: RunHandle, test: (e: RunEvent) => boolean): Promise<RunEvent> {
  const seen = h.record().events.find(test);
  if (seen) return Promise.resolve(seen);
  return new Promise((resolve) => {
    const off = h.subscribe((e) => {
      if (test(e)) {
        off();
        resolve(e);
      }
    });
  });
}
