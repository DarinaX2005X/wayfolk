/**
 * The case job (PLAN "Трудный механизм"): plan, read, extract with streaming checks,
 * second look, reconcile, the question to the person and assembly; and the same
 * machinery for late pages (01.4.5: read, extract, check, one reconcile call, no second
 * look, resolution by code).
 *
 * Every batch is checked as soon as its answer arrives; a batch with sent-back claims
 * gets its second look at once, ahead of batches not yet started. Finished batches are
 * saved (`batch:<b>`, then `recheck:<b>`), so a reload continues from the first
 * unfinished one; emitting is idempotent by item id and status, so a batch checked
 * again after a reload does not lay its tiles twice.
 */
import type { CallResult, JobCtx, JobOutcome } from '../../job';
import { CancelledError, LlmError } from '../../llm-error';
import { schemaProblems } from '../../schema';
import type {
  CaseEvent,
  CasePlan,
  CaseResult,
  CheckedItem,
  Contradiction,
  Explained,
  ExtractedEvent,
  FactField,
  Note,
  OpenAsk,
  Page,
  Party,
  RejectReason,
  Station,
} from '../../types';
import { batchPages, type Batch } from '../../../materials/batches';
import { normalizeText, sha256Hex } from '../../../materials/normalize';
import { caseWindow, findDatedPassages, longDate } from '../../checks/date';
import type { ClaimTrack } from '../../checks/counters';
import { countClaims } from '../../checks/counters';
import { passageCovered, type AcceptedQuote } from '../../checks/coverage';
import type { Kept } from '../../checks/dedupe';
import { seedClaims, SEED_KINDS, type SeedKind } from '../../checks/seed';
import { assembleCase } from './assemble';
import { candidates, pairBatches, type Candidate } from './candidates';
import { byTime } from './edits';
import {
  extractMessages,
  planMessages,
  planPayload,
  recheckMessages,
  reconcileMessages,
  type ExtractPayload,
  type PairSide,
  type PromptContext,
  type ReconcilePayload,
  type RecheckPayload,
} from './prompts';
import { askOptions, askQuestion, fieldLabel, makeContradiction, MAX_ASKS, OPTION_CONFLICT, type PairVerdict } from './reconcile';
import { lateNote } from './late';
import { resolveContradictions } from './resolve';
import { extractSchema, planSchema, reconcileSchema, recheckSchema, FACT_TYPES } from './schemas';
import { checkEnv, fillEvent, partiesInText, verifyClaim, type CheckEnv, type ClaimVerdict } from './verify';

export const STATIONS: Station[] = [
  { id: 's1', step: 'read', label: 'Read', by: 'code' },
  { id: 's2', step: 'extract', label: 'Extract', by: 'model', role: 'extractor' },
  { id: 's3', step: 'verify', label: 'Check', by: 'code' },
  { id: 's4', step: 'reconcile', label: 'Reconcile', by: 'model', role: 'reconciler' },
  { id: 's5', step: 'assemble', label: 'Assemble', by: 'code' },
];
export const LATE_STATIONS: Station[] = STATIONS.slice(0, 3);

export const MAX_RECHECKS = 6;
export const MAX_UNCOVERED = 8;
export const TILES_MAX = 392;

type ClaimState = ClaimTrack & {
  batch: number;
  claim: ExtractedEvent;
  reason?: RejectReason;
  found: string;
  eventId?: string;
  /** The item of the first check of a sent-back claim: the tray sheet keeps its diff. */
  item?: CheckedItem;
};

type BatchState = {
  batch: number;
  pages: [number, number];
  claims: ClaimState[];
  events: CaseEvent[];
  accepted: AcceptedQuote[];
  audit: CheckedItem[];
  restorable: Record<string, ExtractedEvent>;
  unread: number[];
};

type PlanState = { plan: CasePlan; dropped: string[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const short = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/** The extract answer with every optional value present (the author's scripted answers may omit empty ones). */
function fillAnswer(json: unknown): { events: ExtractedEvent[] } {
  const events = (json as { events?: unknown })?.events;
  return { events: Array.isArray(events) ? events.map((e) => fillEvent(e as Partial<ExtractedEvent>)) : [] };
}
function fillRecheck(json: unknown): { fixes: { claimId: string; action: 'fix' | 'withdraw'; quote: string; page: number; date: string; actors: string[] }[]; added: ExtractedEvent[] } {
  const j = (json ?? {}) as { fixes?: unknown; added?: unknown };
  const fixes = Array.isArray(j.fixes) ? (j.fixes as Record<string, unknown>[]) : [];
  return {
    fixes: fixes.map((f) => ({
      claimId: String(f.claimId ?? ''),
      action: f.action === 'fix' ? 'fix' : 'withdraw',
      quote: typeof f.quote === 'string' ? f.quote : '',
      page: typeof f.page === 'number' ? f.page : 0,
      date: typeof f.date === 'string' ? f.date : '',
      actors: Array.isArray(f.actors) ? (f.actors as string[]) : [],
    })),
    added: fillAnswer({ events: j.added }).events,
  };
}

/** The planner's answer cleaned: ids, aliases, fields of known types; parties not in the documents left out. */
export function cleanPlan(json: unknown, material: string): PlanState {
  const j = (json ?? {}) as Partial<CasePlan>;
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parties: Party[] = [];
  for (const p of Array.isArray(j.parties) ? j.parties : []) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) continue;
    let id = slug(typeof p.id === 'string' && p.id ? p.id : p.name.split(/\s+/)[0]);
    while (parties.some((x) => x.id === id)) id += '-2';
    parties.push({
      id,
      name: p.name.trim(),
      role: typeof p.role === 'string' ? p.role.trim() : '',
      aliases: [...new Set((Array.isArray(p.aliases) ? p.aliases : []).filter((a): a is string => typeof a === 'string' && a.trim() !== '').map((a) => a.trim()))],
    });
  }
  const present = new Set(partiesInText(parties, material).map((p) => p.id));
  const dropped = parties.filter((p) => !present.has(p.id)).map((p) => p.name);
  const topics = [...new Set((Array.isArray(j.topics) ? j.topics : []).filter((t): t is string => typeof t === 'string').map((t) => t.trim().toLowerCase()).filter(Boolean))];
  const fields: FactField[] = [];
  for (const f of Array.isArray(j.fields) ? j.fields : []) {
    if (!f || typeof f.id !== 'string' || !f.id.trim() || !(FACT_TYPES as readonly string[]).includes(f.type)) continue;
    if (fields.some((x) => x.id === f.id)) continue;
    const topic = typeof f.topic === 'string' && f.topic.trim() ? f.topic.trim().toLowerCase() : f.id.split('.')[0];
    if (!topics.includes(topic)) topics.push(topic);
    fields.push({ id: f.id.trim(), topic, type: f.type, question: typeof f.question === 'string' ? f.question : '' });
  }
  return { plan: { parties: parties.filter((p) => present.has(p.id)), topics, fields }, dropped };
}

/** Which batch each fake kind waits for: spread over the run. */
function seedSchedule(batches: number): Map<SeedKind, number> {
  return new Map(SEED_KINDS.map((k, i) => [k, Math.max(1, Math.round(((i + 1) * batches) / (SEED_KINDS.length + 1)))]));
}

export class CaseRun {
  private late: boolean;
  private stations: Station[];
  private plan!: CasePlan;
  private env!: CheckEnv;
  private pctx!: PromptContext;
  private batches: Batch[] = [];
  private states = new Map<number, BatchState>();
  private kept: Kept[] = [];
  private events = new Map<string, CaseEvent>();
  private fresh = new Set<string>();
  private extracted = 0;
  private claimsSeen = 0;
  private checkMs = 0;
  private rechecks = 0;
  private skippedForBudget = 0;
  private notRecordedNoted = false;
  private firstRejectNoted: boolean;
  private stopped: LlmError | null = null;
  private emitted: Set<string>;
  private tiled: Set<string>;
  private seedWait = new Map<SeedKind, number>();
  private old: CaseResult | null;
  private pass: number;
  private pagesRead: Page[] = [];

  constructor(private ctx: JobCtx) {
    this.late = ctx.spec.scope !== 'full';
    this.stations = this.late ? LATE_STATIONS : STATIONS;
    this.old = this.late ? ((ctx.project.result as CaseResult | null) ?? null) : null;
    this.pass = this.old ? Math.max(1, ...this.old.events.map((e) => e.pass)) + 1 : 1;
    const ev = ctx.record.events;
    this.firstRejectNoted = ev.some((e) => e.type === 'note' && e.key && e.source === 'Check');
    this.emitted = new Set(ev.filter((e) => e.type === 'item').map((e) => (e.type === 'item' ? `${e.item.id}:${e.item.status}` : '')));
    this.tiled = new Set(ev.filter((e) => e.type === 'tile').map((e) => (e.type === 'tile' ? e.ref.id : '')));
  }

  // ---------------------------------------------------------------- events

  private item(station: string, item: CheckedItem): void {
    const key = `${item.id}:${item.status}`;
    if (this.emitted.has(key)) return;
    this.emitted.add(key);
    this.ctx.emit({ type: 'item', station, item });
  }

  private tile(event: CaseEvent): void {
    if (this.tiled.has(event.id)) return;
    this.tiled.add(event.id);
    this.ctx.tile('s3', { kind: 'event', id: event.id });
  }

  private checkNote(text: string, reject: boolean): void {
    const key = reject && !this.firstRejectNoted;
    if (key) this.firstRejectNoted = true;
    this.ctx.note('s3', 'Check', text, key || undefined);
  }

  // ---------------------------------------------------------------- run

  async run(): Promise<JobOutcome> {
    const ctx = this.ctx;
    await this.planStep();
    this.readStep();
    await this.extractStep();
    let contradictions: Contradiction[] = [];
    let explained: Explained[] = [];
    let open: OpenAsk[] = [];
    let asked = 0;
    let pairs = 0;
    let reconcileCalls = 0;
    if (!this.stopped) {
      const r = await this.reconcileStep();
      ({ contradictions, explained, open, asked, pairs, reconcileCalls } = r);
    }
    ctx.throwIfCancelled();
    return this.late
      ? this.finishLate({ contradictions, explained, open, asked, pairs, reconcileCalls })
      : this.finishFull({ contradictions, explained, open, asked, pairs, reconcileCalls });
  }

  // ---------------------------------------------------------------- plan

  private async planStep(): Promise<void> {
    const ctx = this.ctx;
    const allText = ctx.pages.map((p) => p.text).join('\n');
    if (this.late) {
      if (!this.old) throw new LlmError('material');
      this.plan = { parties: this.old.parties, topics: this.old.topics, fields: this.old.fields };
    } else {
      let state = ctx.partial.plan as PlanState | undefined;
      if (!state) {
        const payload = planPayload(ctx.project.goal, ctx.docs);
        const r = await ctx.call({
          task: 'plan',
          index: 1,
          payload,
          messages: planMessages(payload),
          schema: planSchema(),
          station: 's1',
          role: 'planner',
        });
        state = cleanPlan(r.json, allText);
        for (const name of state.dropped) ctx.note('s1', 'Planner', `Planner named "${name}", who isn't in the documents. Left out.`);
        await ctx.save('plan', state);
      }
      this.plan = state.plan;
    }
    const window = caseWindow(ctx.pages, Object.fromEntries(ctx.docs.map((d) => [d.meta.id, d.meta.date])));
    this.env = checkEnv(this.plan, ctx.docs, ctx.pages, window);
    this.pctx = { plan: this.plan, docs: ctx.docs, pages: ctx.pages, goal: ctx.project.goal };

    // Pages to read: all, or the late pages not read before (known by the hash of their text).
    let read = ctx.pages;
    if (this.late) {
      const scope = new Set((ctx.spec.scope as { pages: number[] }).pages);
      const known = new Set(Object.values(this.old?.pageHashes ?? {}));
      read = [];
      for (const p of ctx.pages.filter((x) => scope.has(x.n))) {
        if (!known.has(await sha256Hex(normalizeText(p.text)))) read.push(p);
      }
    }
    this.pagesRead = read;
    // Later pages continue the call numbers of the result (extract/12 after 11 batches).
    const first = this.late ? (this.old?.indices?.batch ?? batchPages(ctx.pages.filter((p) => !read.includes(p))).length) + 1 : 1;
    this.batches = batchPages(read, first);

    if (this.late && this.old) {
      for (const e of this.old.events) {
        this.events.set(e.id, e);
        this.kept.push({ id: e.id, page: e.source.page, quote: e.quote });
      }
    }

    if (!ctx.record.events.some((e) => e.type === 'plan')) {
      const budget = this.late ? 1 + this.batches.length + 1 : Math.min(ctx.budget, 1 + this.batches.length + Math.min(MAX_RECHECKS, this.batches.length) + 3);
      const docsRead = new Set(read.map((p) => p.docId)).size;
      const per = this.batches[0]?.numbers.length ?? 0;
      const lines = this.late
        ? [plural(read.length, 'new page', 'new pages'), `Read against ${plural(this.events.size, 'checked event', 'checked events')}`, `Up to ${plural(budget, 'model call', 'model calls')}`]
        : [
            `${plural(read.length, 'page', 'pages')} in ${plural(docsRead, 'document', 'documents')}`,
            `${plural(this.plan.parties.length, 'person', 'people')}, ${plural(this.plan.topics.length, 'topic', 'topics')}`,
            `${plural(this.batches.length, 'batch', 'batches')} of ${plural(per, 'page', 'pages')}`,
            `Up to ${plural(budget, 'model call', 'model calls')}`,
          ];
      ctx.emit({ type: 'plan', stations: this.stations, budget, lines, tilesPlanned: Math.min(TILES_MAX, read.length * 2) });
    }
    if (ctx.seed && !this.late) this.seedWait = seedSchedule(this.batches.length);
  }

  // ---------------------------------------------------------------- read

  private readStep(): void {
    const ctx = this.ctx;
    ctx.stepStart('s1');
    if (!ctx.record.events.some((e) => e.type === 'step-end' && e.station === 's1')) {
      this.pagesRead.forEach((_, i) => ctx.emit({ type: 'progress', station: 's1', done: i + 1, total: this.pagesRead.length, unit: 'pages' }));
    }
    ctx.stepEnd('s1', { pages: this.pagesRead.length, batches: this.batches.length });
  }

  // ---------------------------------------------------------------- extract, check, second look

  private async extractStep(): Promise<void> {
    const ctx = this.ctx;
    ctx.stepStart('s2');
    ctx.stepStart('s3');
    // Restore finished batches first (synchronously), so dedupe sees them before new answers.
    for (const b of this.batches) {
      const saved = (ctx.partial[`recheck:${b.index}`] ?? ctx.partial[`batch:${b.index}`]) as BatchState | undefined;
      if (saved) this.restore(saved);
    }
    if (!this.batches.length) this.endExtract();
    await Promise.all(this.batches.map((b) => this.batch(b)));
    if (this.skippedForBudget) {
      ctx.note('s3', 'Check', `Call budget reached. ${plural(this.skippedForBudget, 'second look was', 'second looks were')} skipped.`, true);
    }
    const counts = countClaims(this.tracks());
    ctx.stepEnd('s3', {
      claims: counts.claims,
      matched: counts.matched,
      corrected: counts.corrected,
      merged: counts.merged,
      sentBack: counts.sentBack,
      fixed: counts.fixed,
      dropped: counts.dropped,
      planted: counts.planted,
      seeded: counts.seeded,
      caught: counts.caught,
    });
  }

  private restore(st: BatchState): void {
    this.states.set(st.batch, st);
    for (const e of st.events) {
      this.events.set(e.id, e);
      this.fresh.add(e.id);
      this.kept.push({ id: e.id, page: e.source.page, quote: e.quote });
      this.tiled.add(e.id);
    }
    this.claimsSeen += st.claims.filter((c) => c.origin === 'extract' && !c.seeded).length;
  }

  private tracks(): ClaimTrack[] {
    return [...this.states.values()].sort((a, b) => a.batch - b.batch).flatMap((s) => s.claims);
  }

  private endExtract(): void {
    const counts = countClaims(this.tracks());
    this.ctx.stepEnd('s2', { calls: this.ctx.callsByTask.extract ?? 0, claims: counts.claims });
  }

  private async batch(b: Batch): Promise<void> {
    const ctx = this.ctx;
    let st = this.states.get(b.index);
    const done = Boolean(ctx.partial[`recheck:${b.index}`]);
    if (!st) {
      let got: { claims: { claim: ExtractedEvent; planted: boolean; seeded: boolean; id: string }[]; unread: number[] };
      try {
        got = await this.extract(b);
      } catch (error) {
        if (error instanceof CancelledError) throw error;
        if (!(error instanceof LlmError)) throw error;
        this.stopped = this.stopped ?? error;
        ctx.emit({ type: 'error', station: 's2', code: error.code === 'rate-limited' || error.code === 'provider-busy' ? 'provider-error' : error.code, retryable: true, pages: b.pages });
        got = { claims: [], unread: b.numbers };
      }
      ctx.throwIfCancelled();
      st = this.check(b, got.claims, got.unread);
      this.states.set(b.index, st);
      await ctx.save(`batch:${b.index}`, st);
    }
    this.extracted++;
    ctx.emit({ type: 'progress', station: 's2', done: this.extracted, total: this.batches.length, unit: 'batches' });
    if (this.extracted === this.batches.length) this.endExtract();
    if (!done) {
      const after = await this.secondLook(st);
      if (after) {
        this.states.set(b.index, after);
        await ctx.save(`recheck:${b.index}`, after);
      }
    }
  }

  private async extract(b: Batch): Promise<{ claims: { claim: ExtractedEvent; planted: boolean; seeded: boolean; id: string }[]; unread: number[] }> {
    const schema = extractSchema(this.plan);
    const validate = (j: unknown) => schemaProblems(fillAnswer(j), schema);
    const read = (r: CallResult, prefix: string) => {
      const events = fillAnswer(r.json).events;
      const planted = new Set(r.response.planted ?? []);
      const seeded = new Set(r.response.seeded ?? []);
      return events.map((claim, i) => ({ claim, planted: planted.has(i), seeded: seeded.has(i), id: `${prefix}-${i + 1}` }));
    };
    const payload: ExtractPayload = { batch: b.index, pages: b.pages };
    try {
      const r = await this.ctx.call({
        task: 'extract',
        index: b.index,
        payload,
        messages: extractMessages(payload, this.pctx),
        schema,
        station: 's2',
        role: 'extractor',
        pages: b.pages,
        validate,
        ...(this.ctx.seed ? { transform: (j: unknown) => this.seedInto(b.index, j) } : {}),
      });
      return { claims: read(r, `c${b.index}`), unread: [] };
    } catch (error) {
      if (!(error instanceof LlmError) || error.code !== 'bad-output' || b.numbers.length < 2) {
        if (error instanceof LlmError && error.code === 'bad-output') {
          this.ctx.emit({ type: 'error', station: 's2', code: 'bad-output', retryable: false, pages: b.pages });
          this.ctx.note('s2', 'Extractor', `${pagesWord(b.pages)} couldn't be read.`, true);
          return { claims: [], unread: b.numbers };
        }
        throw error;
      }
    }
    // Two bad answers: the batch is split in half and read by two calls.
    const mid = Math.ceil(b.numbers.length / 2);
    const halves = [b.numbers.slice(0, mid), b.numbers.slice(mid)];
    const claims: { claim: ExtractedEvent; planted: boolean; seeded: boolean; id: string }[] = [];
    const unread: number[] = [];
    this.ctx.note('s2', 'Extractor', `${pagesWord(b.pages)} are split in two and read again.`);
    for (let k = 0; k < 2; k++) {
      const pages: [number, number] = [halves[k][0], halves[k][halves[k].length - 1]];
      const half: ExtractPayload = { batch: b.index, pages };
      try {
        const r = await this.ctx.call({
          task: 'extract',
          index: b.index,
          attempt: 3 + k,
          maxAttempts: 1,
          payload: half,
          messages: extractMessages(half, this.pctx),
          schema,
          station: 's2',
          role: 'extractor',
          pages,
          validate,
        });
        claims.push(...read(r, `c${b.index}${'ab'[k]}`));
      } catch (error) {
        if (!(error instanceof LlmError) || error.code !== 'bad-output') throw error;
        this.ctx.emit({ type: 'error', station: 's2', code: 'bad-output', retryable: false, pages });
        this.ctx.note('s2', 'Extractor', `${pagesWord(pages)} couldn't be read.`, true);
        unread.push(...halves[k]);
      }
    }
    return { claims, unread };
  }

  /** Live recording: the fakes of this batch are added to the model's answer before it is saved. */
  private seedInto(batch: number, json: unknown): { json: unknown; seeded?: number[] } {
    const kinds = [...this.seedWait].filter(([, at]) => at <= batch).map(([k]) => k);
    if (!kinds.length) return { json };
    const events = fillAnswer(json).events;
    const fakes = seedClaims(events, this.ctx.pages, this.plan.parties, () => this.ctx.rng(), {
      kinds,
      window: this.env.window,
      docDates: this.env.docDates,
    });
    for (const f of fakes) this.seedWait.delete(f.kind);
    if (!fakes.length) return { json };
    const seeded = fakes.map((_, i) => events.length + i);
    return { json: { ...(json as object), events: [...events, ...fakes.map((f) => f.claim)] }, seeded };
  }

  /** The gate for one batch answer: every claim in order, with its item, tile and caption line. */
  private check(b: Batch, claims: { claim: ExtractedEvent; planted: boolean; seeded: boolean; id: string }[], unread: number[]): BatchState {
    const t0 = this.ctx.now();
    const st: BatchState = { batch: b.index, pages: b.pages, claims: [], events: [], accepted: [], audit: [], restorable: {}, unread };
    for (const c of claims) {
      this.ctx.throwIfCancelled();
      const v = verifyClaim(c.id, c.claim, this.env, this.kept, { batch: b.index, planted: c.planted, seeded: c.seeded, pass: this.pass, status: 'verified' });
      const track: ClaimState = {
        id: c.id,
        origin: 'extract',
        first: v.status,
        final: v.status,
        planted: c.planted,
        seeded: c.seeded,
        factsChecked: v.factsChecked,
        factsRemoved: v.factsRemoved,
        event: false,
        batch: b.index,
        claim: c.claim,
        ...(v.item.reason ? { reason: v.item.reason } : {}),
        found: v.item.found?.text ?? v.item.diff?.source ?? '',
        ...(v.status === 'rejected' ? { item: v.item } : {}),
      };
      if (!c.seeded) this.claimsSeen++;
      this.take(st, track, v, c.seeded);
      if (this.late && v.status === 'rejected' && !c.seeded) {
        track.final = 'dropped';
        const dropped: CheckedItem = { ...v.item, status: 'dropped' };
        this.item('s3', dropped);
        st.audit.push(dropped);
        st.restorable[c.id] = c.claim;
      }
      st.claims.push(track);
      this.ctx.emit({ type: 'progress', station: 's3', done: this.claimsSeen, total: this.claimsSeen, unit: 'claims' });
    }
    this.checkMs += this.ctx.now() - t0;
    return st;
  }

  /** Records one decision of the gate: the item, the event and its tile, the caption line. */
  private take(st: BatchState, track: ClaimState, v: ClaimVerdict, seeded: boolean): void {
    const item: CheckedItem = seeded && v.status === 'rejected' ? { ...v.item, dropCause: 'seeded' } : v.item;
    this.item('s3', item);
    if (v.status === 'accepted' || v.status === 'corrected') {
      if (seeded) {
        this.ctx.note('s3', 'Check', 'A fake added by code passed the check. It stays out of the result.');
        st.audit.push({ ...item, status: 'dropped', dropCause: 'seeded' });
        return;
      }
      const e = v.event!;
      for (const f of v.factItems) {
        this.item('s3', f);
        st.audit.push(f);
      }
      this.events.set(e.id, e);
      this.fresh.add(e.id);
      this.kept.push({ id: e.id, page: e.source.page, quote: e.quote });
      st.events.push(e);
      st.accepted.push({ page: e.source.page, spans: v.spans });
      track.event = true;
      track.eventId = e.id;
      this.tile(e);
      if (v.status === 'corrected') {
        st.audit.push(item);
        this.checkNote(correctionLine(v, track.claim), false);
      }
      for (const f of v.factItems) this.checkNote(`${f.claim.split(':')[0]} ${f.claim.split(': ')[1]} is not in the quote on page ${e.source.page}. The fact is removed; the event stays.`, false);
      return;
    }
    if (v.status === 'merged') {
      st.audit.push(item);
      return;
    }
    if (seeded) {
      st.audit.push({ ...item, status: 'dropped', dropCause: 'seeded' });
      this.ctx.note('s3', 'Check', `A fake added by code to test the check was caught: ${rejectLine(v, track.claim)}`);
      return;
    }
    this.checkNote(`${rejectLine(v, track.claim)} ${this.late ? 'Not used.' : 'Sent back.'}`, true);
  }

  /** The second look for a batch with sent-back claims; null when there is nothing to send. */
  private async secondLook(st: BatchState): Promise<BatchState | null> {
    const ctx = this.ctx;
    const sent = st.claims.filter((c) => !c.seeded && c.first === 'rejected' && c.final === 'rejected');
    if (!sent.length) return null;
    const next: BatchState = { ...st, claims: st.claims.map((c) => ({ ...c })), audit: [...st.audit], events: [...st.events], accepted: [...st.accepted], restorable: { ...st.restorable } };
    const drop = (dropCause: CheckedItem['dropCause'], reason?: RejectReason) => {
      for (const c of next.claims.filter((x) => sent.some((s) => s.id === x.id))) this.drop(next, c, dropCause, reason);
    };
    const reserve = 1; // the reconcile call never goes without budget
    if (this.rechecks >= MAX_RECHECKS || ctx.calls + 1 + reserve > ctx.budget) {
      this.skippedForBudget++;
      drop('budget');
      return next;
    }
    this.rechecks++;
    const uncovered = this.uncoveredOf(next);
    const payload: RecheckPayload = {
      batch: st.batch,
      pages: st.pages,
      claims: sent.map((c) => ({ claimId: c.id, reason: c.reason ?? 'quote-not-found', found: c.found })),
      uncovered,
    };
    const byId = Object.fromEntries(sent.map((c) => [c.id, { quote: c.claim.quote, page: c.claim.page, date: c.claim.date, actors: c.claim.actors }]));
    const schema = recheckSchema(this.plan);
    let r: CallResult;
    try {
      r = await ctx.call({
        task: 'recheck',
        index: st.batch,
        payload,
        messages: recheckMessages(payload, this.pctx, byId),
        schema,
        station: 's3',
        role: 'extractor',
        pages: st.pages,
        priority: 1,
        validate: (j) => schemaProblems(fillRecheck(j), schema),
      });
    } catch (error) {
      if (error instanceof LlmError && error.code === 'bad-output') {
        drop('failed-again');
        return next;
      }
      throw error;
    }
    ctx.throwIfCancelled();
    if (r.response.missing) {
      if (!this.notRecordedNoted) {
        this.notRecordedNoted = true;
        ctx.note('s3', 'Check', 'No second look in this recording.');
      }
      drop('not-recorded');
      return next;
    }
    const t0 = ctx.now();
    const answer = fillRecheck(r.json);
    for (const c of next.claims.filter((x) => sent.some((s) => s.id === x.id))) {
      const fix = answer.fixes.find((f) => f.claimId === c.id);
      if (!fix || fix.action === 'withdraw') {
        this.drop(next, c, 'withdrawn');
        continue;
      }
      const claim: ExtractedEvent = {
        ...c.claim,
        quote: fix.quote || c.claim.quote,
        page: fix.page || c.claim.page,
        date: fix.date || c.claim.date,
        actors: fix.actors.length ? fix.actors : c.claim.actors,
      };
      const v = verifyClaim(c.id, claim, this.env, this.kept, { batch: st.batch, planted: c.planted, pass: this.pass, status: 'fixed' });
      if (v.status === 'accepted' || v.status === 'corrected') {
        const e = v.event!;
        c.final = 'fixed';
        c.event = true;
        c.eventId = e.id;
        c.factsChecked = v.factsChecked;
        c.factsRemoved = v.factsRemoved;
        const item: CheckedItem = { ...v.item, status: 'fixed' };
        this.item('s3', item);
        next.audit.push(item);
        for (const f of v.factItems) {
          this.item('s3', f);
          next.audit.push(f);
        }
        this.events.set(e.id, e);
        this.fresh.add(e.id);
        this.kept.push({ id: e.id, page: e.source.page, quote: e.quote });
        next.events.push(e);
        next.accepted.push({ page: e.source.page, spans: v.spans });
        this.tile(e);
        ctx.note('s3', 'Check', `Fixed on the second look: "${short(e.quote, 50)}", page ${e.source.page}.`);
      } else {
        this.drop(next, c, 'failed-again', v.item.reason ?? 'duplicate', v.item);
      }
    }
    answer.added.forEach((claim, i) => {
      const id = `c${st.batch}-r${i + 1}`;
      const v = verifyClaim(id, claim, this.env, this.kept, { batch: st.batch, pass: this.pass, status: 'added' });
      const track: ClaimState = {
        id,
        origin: 'recheck',
        first: v.status,
        final: v.status === 'rejected' ? 'dropped' : v.status,
        planted: false,
        seeded: false,
        factsChecked: v.factsChecked,
        factsRemoved: v.factsRemoved,
        event: false,
        batch: st.batch,
        claim,
        found: '',
        ...(v.item.reason ? { reason: v.item.reason } : {}),
      };
      this.item('s3', v.item);
      if (v.status === 'accepted' || v.status === 'corrected') {
        const e = v.event!;
        for (const f of v.factItems) {
          this.item('s3', f);
          next.audit.push(f);
        }
        this.events.set(e.id, e);
        this.fresh.add(e.id);
        this.kept.push({ id: e.id, page: e.source.page, quote: e.quote });
        next.events.push(e);
        next.accepted.push({ page: e.source.page, spans: v.spans });
        track.event = true;
        track.eventId = e.id;
        this.tile(e);
        ctx.note('s3', 'Check', `Added on the second look: "${short(e.quote, 50)}", page ${e.source.page}.`);
      } else {
        next.audit.push({ ...v.item, ...(v.status === 'rejected' ? { status: 'dropped' as const, dropCause: 'failed-again' as const } : {}) });
      }
      next.claims.push(track);
    });
    this.checkMs += ctx.now() - t0;
    return next;
  }

  private drop(st: BatchState, c: ClaimState, dropCause: CheckedItem['dropCause'], reason?: RejectReason, from?: CheckedItem): void {
    c.final = 'dropped';
    const item: CheckedItem = {
      ...(from ?? c.item ?? { id: c.id, kind: 'claim', claim: c.claim.quote, batch: c.batch, ...(c.planted ? { planted: true } : {}) }),
      status: 'dropped',
      ...(reason ?? c.reason ? { reason: reason ?? c.reason } : {}),
      ...(dropCause ? { dropCause } : {}),
    } as CheckedItem;
    this.item('s3', item);
    st.audit = st.audit.filter((i) => !(i.id === c.id && i.kind === 'claim'));
    st.audit.push(item);
    st.restorable[c.id] = c.claim;
  }

  /** Dated passages of the batch's pages that no accepted quote touches (up to 8). */
  private uncoveredOf(st: BatchState): string[] {
    const accepted: AcceptedQuote[] = [...this.states.values()].flatMap((s) => s.accepted);
    const out: string[] = [];
    for (const p of this.ctx.pages.filter((x) => x.n >= st.pages[0] && x.n <= st.pages[1])) {
      for (const d of findDatedPassages(p, this.env.docDates[p.docId])) {
        if (!passageCovered(d, accepted)) out.push(d.text);
        if (out.length >= MAX_UNCOVERED) return out;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- reconcile

  private async reconcileStep(): Promise<{ contradictions: Contradiction[]; explained: Explained[]; open: OpenAsk[]; asked: number; pairs: number; reconcileCalls: number }> {
    const ctx = this.ctx;
    const station = this.late ? 's3' : 's4';
    if (!this.late) ctx.stepStart('s4');
    const all = [...this.events.values()].sort(byTime);
    const fresh = this.late ? new Set([...this.fresh]) : undefined;
    const pairs = candidates(all, this.plan.fields, fresh);
    ctx.emit({ type: 'progress', station, done: 0, total: pairs.length, unit: 'pairs' });
    const left = ctx.budget - ctx.calls;
    let chunks = pairBatches(pairs, this.late ? 1 : 3);
    if (chunks.length > left) chunks = left >= 1 ? pairBatches(pairs, 1) : [];
    if (pairs.length && !chunks.length) ctx.note(station, 'Reconciler', 'Call budget reached. The pairs were not compared.', true);
    const first = this.late ? (this.old?.indices?.reconcile ?? 0) + 1 : 1;
    const byKey = new Map<string, Candidate>(pairs.map((p) => [p.key, p]));
    const contradictions: Contradiction[] = [];
    const explained: Explained[] = [];
    const asks: { ask: OpenAsk; answer: Promise<string | null>; c: Candidate }[] = [];
    let judged = 0;
    let readingNoted = ctx.record.events.some((e) => e.type === 'note' && e.source === 'Reconciler');
    const handle = (verdicts: PairVerdict[], chunk: Candidate[]) => {
      for (const c of chunk) {
        const v: PairVerdict = verdicts.find((x) => x.pairKey === c.key) ?? { pairKey: c.key, verdict: 'unjudged', explanation: '' };
        judged++;
        this.item(station, {
          id: `p:${c.key}`,
          kind: 'pair',
          status: 'accepted',
          claim: `${fieldLabel(c.field)}: ${c.values[0]} or ${c.values[1]}`,
          pairKey: c.key,
          verdict: v.verdict,
          ...(v.explanation ? { diff: { claim: v.explanation, source: '' } } : {}),
        });
        ctx.emit({ type: 'progress', station, done: judged, total: pairs.length, unit: 'pairs' });
        if (v.verdict === 'contradiction') {
          contradictions.push(makeContradiction(c, all, this.plan.fields, v.explanation, this.late ? 'late-pages' : 'agents'));
          if (!readingNoted) {
            readingNoted = true;
            ctx.note(station, 'Reconciler', "Both quotes are checked. Whether they conflict is the model's reading.");
          }
        } else if (v.verdict === 'explained') {
          explained.push({ key: c.key, a: c.a, b: c.b, reason: v.explanation, by: 'agents' });
        } else if (v.verdict === 'unsure') {
          const question = askQuestion(v, c);
          const options = askOptions(v);
          const open: OpenAsk = { askId: '', pair: [c.a, c.b], question, options };
          if (asks.length < MAX_ASKS) {
            const { askId, answer } = ctx.ask(station, { pair: [c.a, c.b], question, options });
            asks.push({ ask: { ...open, askId }, answer, c });
          } else {
            asks.push({ ask: { ...open, askId: 'ask:' + c.key }, answer: Promise.resolve(null), c });
          }
        } else {
          ctx.note(station, 'Reconciler', `Not compared in this recording: ${fieldLabel(c.field).toLowerCase()}, ${c.values[0]} or ${c.values[1]}.`);
        }
      }
    };
    const schema = reconcileSchema();
    let failed = false;
    await Promise.all(
      chunks.map(async (chunk, i) => {
        const index = first + i;
        const saved = ctx.partial[`reconcile:${index}`] as PairVerdict[] | undefined;
        if (saved) return handle(saved, chunk);
        const payload: ReconcilePayload = { pairs: chunk.map((c) => this.pairPayload(c, all)) };
        try {
          const r = await ctx.call({
            task: 'reconcile',
            index,
            payload,
            messages: reconcileMessages(payload, this.pctx),
            schema,
            station,
            role: 'reconciler',
            validate: (j) => schemaProblems(withoutUnjudged(j), schema),
          });
          const verdicts = ((r.json as { verdicts?: PairVerdict[] })?.verdicts ?? []).filter((v) => byKey.has(v.pairKey));
          handle(verdicts, chunk);
          await ctx.save(`reconcile:${index}`, verdicts);
        } catch (error) {
          if (error instanceof CancelledError || !(error instanceof LlmError)) throw error;
          failed = true;
          ctx.emit({ type: 'error', station, code: error.code === 'rate-limited' || error.code === 'provider-busy' ? 'provider-error' : error.code, retryable: true });
          handle([], chunk);
        }
      }),
    );
    if (failed) this.stopped = this.stopped ?? new LlmError('provider-error');
    for (const c of pairs.filter((p) => !chunks.flat().includes(p))) handle([], [c]);
    const asked = Math.min(asks.length, MAX_ASKS);
    if (!this.late) ctx.stepEnd('s4', { pairs: pairs.length, contradictions: contradictions.length, explained: explained.length, asked });
    const open: OpenAsk[] = [];
    const answers = await Promise.all(asks.map((a) => a.answer));
    asks.forEach((a, i) => {
      const optionId = answers[i];
      if (optionId === null) return open.push(a.ask);
      const label = a.ask.options.find((o) => o.id === optionId)?.label ?? optionId;
      if (optionId === OPTION_CONFLICT) contradictions.push(makeContradiction(a.c, all, this.plan.fields, `You answered "${label}": ${a.ask.question}`, 'you'));
      else explained.push({ key: a.c.key, a: a.c.a, b: a.c.b, reason: `You answered "${label}": ${a.ask.question}`, by: 'you' });
    });
    const order = new Map(pairs.map((p, i) => [p.key, i]));
    contradictions.sort((x, y) => (order.get(x.key) ?? 0) - (order.get(y.key) ?? 0));
    explained.sort((x, y) => (order.get(x.key) ?? 0) - (order.get(y.key) ?? 0));
    return { contradictions, explained, open, asked, pairs: pairs.length, reconcileCalls: chunks.length };
  }

  private pairPayload(c: Candidate, all: readonly CaseEvent[]): ReconcilePayload['pairs'][number] {
    const side = (id: string, value: string): PairSide => {
      const e = all.find((x) => x.id === id)!;
      return { event: id, quote: e.quote, page: e.source.page, doc: e.source.docTitle, kind: e.kind, date: e.at, value };
    };
    const field = this.plan.fields.find((f) => f.id === c.field);
    return { key: c.key, field: c.field, question: field?.question ?? '', a: side(c.a, c.values[0]), b: side(c.b, c.values[1]) };
  }

  // ---------------------------------------------------------------- finish

  private collect() {
    const states = [...this.states.values()].sort((a, b) => a.batch - b.batch);
    return {
      events: states.flatMap((s) => s.events),
      audit: states.flatMap((s) => s.audit),
      restorable: Object.assign({}, ...states.map((s) => s.restorable)) as Record<string, ExtractedEvent>,
      accepted: states.flatMap((s) => s.accepted),
      unread: [...states.flatMap((s) => s.unread), ...this.batches.filter((b) => !this.states.has(b.index)).flatMap((b) => b.numbers)],
      tracks: states.flatMap((s) => s.claims),
    };
  }

  private async pageHashes(pages: readonly Page[], unread: readonly number[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const p of pages) if (!unread.includes(p.n)) out[String(p.n)] = await sha256Hex(normalizeText(p.text));
    return out;
  }

  private async finishFull(r: { contradictions: Contradiction[]; explained: Explained[]; open: OpenAsk[]; asked: number; pairs: number; reconcileCalls: number }): Promise<JobOutcome> {
    const ctx = this.ctx;
    ctx.stepStart('s5');
    const c = this.collect();
    const result = assembleCase({
      plan: this.plan,
      docs: ctx.docs,
      pages: ctx.pages,
      events: c.events,
      contradictions: r.contradictions,
      explained: r.explained,
      open: r.open,
      audit: c.audit,
      restorable: c.restorable,
      tracks: c.tracks,
      accepted: c.accepted,
      window: this.env.window,
      pairs: r.pairs,
      asked: r.asked,
      pagesUnread: c.unread,
      checkMs: this.checkMs,
      firstRunAt: ctx.project.firstRunAt ?? ctx.record.startedAt,
      indices: { batch: this.batches[this.batches.length - 1]?.index ?? 0, reconcile: r.reconcileCalls },
      pageHashes: await this.pageHashes(ctx.pages, c.unread),
    });
    result.stats = { ...result.stats, calls: { ...ctx.callsByTask }, modelMs: ctx.modelMs, tiles: ctx.tiles };
    ctx.stepEnd('s5', { events: result.events.length, tiles: ctx.tiles });
    const anyRead = c.unread.length < ctx.pages.length;
    const status = this.stopped || c.unread.length ? (anyRead ? 'partial' : 'failed') : 'ready';
    return { status, result, stats: result.stats };
  }

  private async finishLate(r: { contradictions: Contradiction[]; explained: Explained[]; open: OpenAsk[]; asked: number; pairs: number; reconcileCalls: number }): Promise<JobOutcome> {
    const ctx = this.ctx;
    const old = this.old!;
    const c = this.collect();
    const fresh = c.events;
    const all = [...old.events, ...fresh];
    const docs = mergeDocs(old.docs, ctx.docs.map((d) => d.meta));
    const res = resolveContradictions(old.contradictions, all, fresh, docs);
    const unreadAll = [...old.stats.pagesUnread, ...c.unread];
    const accepted: AcceptedQuote[] = [...c.accepted];
    // Coverage over every page: the old accepted quotes are found again on their pages.
    const lateOnly = assembleCase({
      plan: this.plan,
      docs: ctx.docs,
      pages: this.pagesRead,
      events: fresh,
      contradictions: r.contradictions,
      explained: r.explained,
      open: r.open,
      audit: c.audit,
      restorable: c.restorable,
      tracks: c.tracks,
      accepted,
      window: this.env.window,
      pairs: r.pairs,
      asked: r.asked,
      pagesUnread: c.unread,
      checkMs: this.checkMs,
      firstRunAt: ctx.project.firstRunAt ?? ctx.record.startedAt,
      indices: { batch: this.batches[this.batches.length - 1]?.index ?? old.indices?.batch ?? 0, reconcile: (old.indices?.reconcile ?? 0) + r.reconcileCalls },
      pageHashes: {},
    });
    const runStats = { ...lateOnly.stats, calls: { ...ctx.callsByTask }, modelMs: ctx.modelMs, tiles: ctx.tiles, pages: this.pagesRead.length };
    const sum = (k: keyof ReturnType<typeof countClaims>) => (old.stats[k] as number) + (runStats[k] as number);
    const merged: CaseResult = {
      ...old,
      docs,
      events: all.sort(byTime),
      contradictions: [...res.contradictions, ...r.contradictions],
      explained: [...old.explained, ...r.explained],
      open: [...old.open, ...r.open],
      audit: [...old.audit, ...c.audit],
      rejected: [...old.rejected, ...lateOnly.rejected],
      window: this.env.window ?? old.window,
      deadlines: [...lateOnly.deadlines.filter((d) => d.kind === 'document'), ...old.deadlines.filter((d) => d.kind === 'review')],
      indices: lateOnly.indices,
      pageHashes: { ...old.pageHashes, ...(await this.pageHashes(this.pagesRead, c.unread)) },
      restorable: { ...old.restorable, ...lateOnly.restorable },
      stats: {
        ...old.stats,
        pages: old.stats.pages + this.pagesRead.length,
        pagesUnread: unreadAll,
        claims: sum('claims'),
        matched: sum('matched'),
        corrected: sum('corrected'),
        merged: sum('merged'),
        sentBack: sum('sentBack'),
        fixed: sum('fixed'),
        dropped: sum('dropped'),
        added: sum('added'),
        events: all.length,
        factsChecked: sum('factsChecked'),
        factsRemoved: sum('factsRemoved'),
        planted: sum('planted'),
        seeded: sum('seeded'),
        caught: sum('caught'),
        pairs: old.stats.pairs + r.pairs,
        contradictions: res.contradictions.length + r.contradictions.length,
        explained: old.stats.explained + r.explained.length,
        asked: old.stats.asked + r.asked,
        tiles: old.stats.tiles + ctx.tiles,
        coverage: {
          datedPassages: old.stats.coverage.datedPassages + lateOnly.stats.coverage.datedPassages,
          covered: old.stats.coverage.covered + lateOnly.stats.coverage.covered,
          pagesWithoutEvents: [...old.stats.coverage.pagesWithoutEvents, ...lateOnly.stats.coverage.pagesWithoutEvents],
        },
      },
    };
    const note = lateNote(ctx.project.id, ctx.record.id, this.pagesRead.length, fresh.map((e) => e.id), r.contradictions.map((x) => x.key), res.resolved, c.audit.filter((i) => i.kind === 'claim' && i.status === 'dropped').length, new Date().toISOString());
    await ctx.save('note', note);
    ctx.note('s3', 'Check', note.text, true);
    const status = this.stopped || c.unread.length ? 'partial' : 'ready';
    return { status, result: merged, stats: runStats };
  }
}

function mergeDocs(old: readonly CaseResult['docs'][number][], add: readonly CaseResult['docs'][number][]): CaseResult['docs'] {
  const out = [...old];
  for (const d of add) if (!out.some((x) => x.id === d.id)) out.push(d);
  return out;
}

function pagesWord(p: [number, number]): string {
  return p[0] === p[1] ? `Page ${p[0]}` : `Pages ${p[0]}–${p[1]}`;
}

function withoutUnjudged(json: unknown): unknown {
  const v = (json as { verdicts?: { verdict?: string }[] })?.verdicts;
  return Array.isArray(v) ? { ...(json as object), verdicts: v.filter((x) => x?.verdict !== 'unjudged').map((x) => ({ question: '', options: [], ...x })) } : json;
}

function rejectLine(v: ClaimVerdict, claim: ExtractedEvent): string {
  const q = `"${short(claim.quote, 60)}"`;
  const page = claim.page;
  switch (v.item.reason) {
    case 'quote-not-found':
      return `${q} is not on page ${page} or anywhere in this file.`;
    case 'quote-altered':
      return `${q} is not what page ${page} says.`;
    case 'quote-too-short':
      return `${q} is too short to check.`;
    case 'unknown-actor':
      return `${v.detail ?? 'A participant is not in this case'}.`;
    case 'date-mismatch':
    case 'weekday-mismatch':
    case 'date-out-of-range':
      return `${v.detail ?? `${longDate(claim.date)} does not fit`}.`;
    default:
      return `${q} did not pass the check.`;
  }
}

function correctionLine(v: ClaimVerdict, claim: ExtractedEvent): string {
  if (v.item.reason === 'quote-wrong-page') return `The quote is on page ${v.event!.source.page}, not page ${claim.page}. Page corrected.`;
  const n = (v.item.diff?.marks?.claim.length ?? 0) + (v.item.diff?.marks?.source.length ?? 0);
  return `${plural(Math.max(1, Math.ceil(n / 2)), 'small word differs', 'small words differ')} from page ${v.event!.source.page}. The page's own words are kept.`;
}

export async function runCase(ctx: JobCtx): Promise<JobOutcome> {
  return new CaseRun(ctx).run();
}

