/**
 * A generated case of any length for the runner's mechanics (batches, queue, budget,
 * resume): one meter reading per page, one claim per page, and a fake model client that
 * answers from the request and can fail on purpose.
 */
import { LlmError } from '../../../src/agents/llm-error';
import type { CasePlan, Doc, ExtractedEvent, LlmClient, LlmRequest, LlmResponse, Page, Project } from '../../../src/agents/types';
import { blockText } from '../../../src/materials/text';

export function meterDocs(pages: number): Doc[] {
  const list: Page[] = [];
  for (let n = 1; n <= pages; n++) {
    const blocks = [
      { k: 'head' as const, text: `Meter log of Ada Stone, page ${n}` },
      { k: 'p' as const, text: `On ${day(n)} March 2026 the meter read ${1000 + n * 7} units.` },
    ];
    list.push({ docId: 'log', n, text: blocks.map(blockText).join('\n'), blocks });
  }
  return [{ meta: { id: 'log', title: 'Meter log', kind: 'log', from: 1, to: pages, date: '2026-03-01' }, pages: list }];
}

const day = (n: number) => 1 + ((n - 1) % 28);

export const meterPlan: CasePlan = {
  parties: [{ id: 'ada', name: 'Ada Stone', role: 'Tenant', aliases: ['Ada'] }],
  topics: ['meter'],
  fields: [],
};

export function meterClaim(n: number, broken = false): ExtractedEvent {
  return {
    kind: 'record',
    date: `2026-03-${String(day(n)).padStart(2, '0')}`,
    time: '',
    actors: ['Ada Stone'],
    label: 'Reading',
    summary: 'The meter was read.',
    quote: broken ? `On ${day(n)} March 2026 the meter showed nothing at all` : `On ${day(n)} March 2026 the meter read ${1000 + n * 7} units`,
    page: n,
    topic: 'meter',
    facts: [],
  };
}

export function meterProject(id = 'p_meter'): Project {
  return {
    id, kind: 'case', title: 'Meter', goal: 'Check the readings', sample: false, slug: 'meter', createdAt: '', updatedAt: '', rev: 1,
    firstRunAt: null, visibility: 'private', status: 'draft', materials: [], materialHash: '', runId: null, passes: 0, result: null, edits: [], notes: [],
  };
}

export type FakeCall = { task: string; index: number; attempt: number; pages?: [number, number] };

/**
 * A model client that answers from the request. `fail(req)` may throw or return 'bad' for
 * an answer that does not fit the schema; `broken(page)` makes the claim of that page wrong.
 */
export function fakeModel(opts: {
  fail?: (req: LlmRequest, n: number) => Error | 'bad' | null;
  broken?: (page: number) => boolean;
  delay?: (req: LlmRequest) => Promise<void>;
  recheck?: 'withdraw' | 'fix';
} = {}): LlmClient & { calls: FakeCall[]; inFlight: number; maxInFlight: number } {
  const calls: FakeCall[] = [];
  const self = {
    calls,
    inFlight: 0,
    maxInFlight: 0,
    async status() {
      return { live: true, provider: 'openrouter' as const, model: 'fake', audio: false, callsLeftToday: 100, runsLeftToday: 3 };
    },
    async call(req: LlmRequest): Promise<LlmResponse> {
      const payload = req.payload as { pages?: [number, number]; claims?: { claimId: string }[]; pairs?: { key: string }[] };
      calls.push({ task: req.task, index: req.index, attempt: req.attempt, ...(payload?.pages ? { pages: payload.pages } : {}) });
      self.inFlight++;
      self.maxInFlight = Math.max(self.maxInFlight, self.inFlight);
      try {
        await (opts.delay?.(req) ?? Promise.resolve());
        const f = opts.fail?.(req, calls.length);
        if (f instanceof Error) throw f;
        let json: unknown;
        if (f === 'bad') json = { nothing: true };
        else if (req.task === 'plan') json = meterPlan;
        else if (req.task === 'extract') {
          const [a, b] = payload.pages!;
          const events: ExtractedEvent[] = [];
          for (let n = a; n <= b; n++) events.push(meterClaim(n, opts.broken?.(n)));
          json = { events };
        } else if (req.task === 'recheck') {
          json = {
            fixes: (payload.claims ?? []).map((c) => {
              const page = Number(/^c(\d+)/.exec(c.claimId)?.[1] ?? 0);
              void page;
              return { claimId: c.claimId, action: opts.recheck === 'fix' ? 'fix' : 'withdraw', quote: '', page: 0, date: '', actors: [] };
            }),
            added: [],
          };
        } else json = { verdicts: (payload.pairs ?? []).map((p) => ({ pairKey: p.key, verdict: 'explained', explanation: 'x', question: '', options: [] })) };
        return { json, provider: 'openrouter', model: 'fake', ms: 10 };
      } finally {
        self.inFlight--;
      }
    },
  };
  return self;
}

export const offline = () => new LlmError('agents-offline', null, 'credit');
