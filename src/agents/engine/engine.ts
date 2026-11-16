/**
 * The general task engine (PLAN "Трудный механизм: общий движок задачи").
 *
 *   1. Plan     one planner call; validatePlan checks it by code; one more call with the
 *               problems when it fails; a basic plan from the library when that fails too.
 *               Event `plan` with the stations, the object and the project name.
 *   2. Steps    in the order of their `uses`; steps whose inputs are ready run at the same
 *               time (the runner's queue keeps up to four calls going). Each model step's
 *               answer goes through the gate (gate.ts): checks by code, one second look for
 *               what failed, items and tiles. Code steps (read, check, assemble) need no model.
 *   3. Ask      when the planner has a question: an `ask` event, 20 s, then the assumed answer.
 *   4. Result   TaskResult with the deliverable (assemble.ts), cards, units, audit, stats.
 *
 * A redo (scope { redo, instruction }) starts from the previous result: the step runs
 * again with the person's instruction and its earlier answer, and later steps run again
 * only when what they use changed.
 */
import type { JobCtx, JobOutcome } from '../job';
import type {
  CheckedItem,
  ChatMessage,
  Doc,
  JsonSchema,
  LlmResponse,
  Page,
  Plan,
  PlanStep,
  RunStats,
  StepCard,
  StepResult,
  TaskResult,
  Unit,
} from '../types';
import { countUnits, emptyStats, type UnitTrack } from '../checks/counters';
import { LlmError } from '../llm-error';
import { hash6 } from '../../materials/normalize';
import { significance } from '../checks/significant';
import { runLabel } from '../label';
import { basicPlan, validatePlan, type PlanAnswer } from './plan-check';
import { plannerMessages, type StepInputs } from './prompts';
import { PLAN_SCHEMA, PLAN_SHAPE } from './schemas';
import { schemaProblems } from '../schema';
import { STEP_LIBRARY } from './library';
import { runStep } from './steps';
import { assemble } from './assemble';

export const STOPPING = new Set(['daily-cap', 'agents-offline', 'budget', 'offline']);

export type StepOutcome = { result: StepResult; units: Unit[]; summary: string; checked: string[]; agentOnly: string[]; counts?: Partial<StepCard['counts']> };

export class Engine {
  readonly goal: string;
  readonly docs: Doc[];
  readonly pages: Page[];
  readonly links: string[];
  readonly today: string;
  readonly hasMaterials: boolean;
  readonly sig: (t: string) => boolean;
  plan!: Plan;
  outputs = new Map<string, StepResult>();
  units: Unit[] = [];
  audit: CheckedItem[] = [];
  rejected: CheckedItem[] = [];
  reviews: TaskResult['reviews'] = [];
  answers: Record<string, string> = {};
  answerLines: { question: string; answer: string }[] = [];
  cards = new Map<string, StepCard>();
  /** Files of the code project so far, by path. */
  files = new Map<string, { text: string; stepId: string; summary: string }>();
  tracks = new Map<string, UnitTrack>();
  planted = 0;
  caught = 0;
  checkMs = 0;
  asked = 0;
  redos = 0;
  required = { total: 0, found: 0 };
  stepCalls = new Map<string, number>();
  stepMs = new Map<string, number>();
  /** The redo of this run: its key goes with every call, so recorded redos are found. */
  redo: { stepId: string; instruction: string; key: string } | null = null;
  fatal: LlmError | null = null;
  failed = new Set<string>();
  /** Called after a step finished well (a redo watches what changed). */
  onStepDone: ((step: PlanStep) => void) | null = null;

  constructor(readonly ctx: JobCtx) {
    const scope = ctx.spec.scope;
    this.goal = ctx.project.task?.text ?? ctx.project.goal ?? ctx.project.title;
    this.docs = ctx.docs;
    this.pages = ctx.pages;
    this.links = ctx.project.task?.links ?? [];
    this.today = ctx.spec.today;
    this.hasMaterials = this.pages.some((p) => p.text.trim().length > 0);
    this.sig = significance(this.pages);
    if (typeof scope === 'object' && 'redo' in scope) {
      const key = `${scope.redo}:${scope.preset ?? hash6(scope.instruction)}`;
      this.redo = { stepId: scope.redo, instruction: scope.instruction, key };
    }
  }

  // ---------------------------------------------------------------- bookkeeping for the gate

  track(t: UnitTrack, caught: number, planted: number): void {
    this.tracks.set(t.id, t);
    this.planted += planted;
    this.caught += caught;
  }

  retrack(id: string, final: UnitTrack['final']): void {
    const t = this.tracks.get(id);
    if (t) t.final = final;
  }

  emitItem(station: string, item: CheckedItem): void {
    if (item.status !== 'accepted') {
      const at = this.audit.findIndex((x) => x.id === item.id);
      if (at >= 0) this.audit[at] = item;
      else this.audit.push(item);
    }
    this.ctx.emit({ type: 'item', station, item });
  }

  reject(item: CheckedItem): void {
    this.rejected.push(item);
  }

  addCheckMs(ms: number): void {
    this.checkMs += Math.max(0, ms);
  }

  stepNo(step: PlanStep): number {
    return Number(step.id.slice(1)) || 0;
  }

  async call(
    step: PlanStep,
    k: number,
    task: 'step' | 'recheck',
    messages: ChatMessage[],
    schema: JsonSchema,
    opts: { what?: string; transform?: (json: unknown) => { json: unknown; planted?: number[]; notes?: string[] } } = {},
  ): Promise<{ json: unknown; response: LlmResponse }> {
    if (this.ctx.calls >= this.ctx.budget) throw new LlmError('budget');
    const r = await this.ctx.call({
      task,
      index: this.stepNo(step) * 100 + k,
      payload: null,
      messages,
      schema,
      station: step.id,
      role: STEP_LIBRARY[step.kind].role ?? 'writer',
      ...(opts.what ? { what: opts.what } : {}),
      ...(this.redo ? { redo: this.redo.key } : {}),
      ...(this.ctx.seed && task === 'step' && opts.transform ? { transform: opts.transform } : {}),
      priority: task === 'recheck' ? 1 : 0,
    });
    this.stepCalls.set(step.id, (this.stepCalls.get(step.id) ?? 0) + 1);
    this.stepMs.set(step.id, (this.stepMs.get(step.id) ?? 0) + r.response.ms);
    return r;
  }

  /** Notes planted into unit `i` of an answer. */
  plantedFor(response: LlmResponse, i: number): string[] {
    const idx = response.planted ?? [];
    const notes = response.plantedNotes ?? [];
    return idx.map((p, k) => (p === i ? (notes[k] ?? 'A planted mistake') : null)).filter((x): x is string => x !== null);
  }

  /** What a step reads: the outputs of its `uses`, the materials when it uses them, the person's answers. */
  inputsFor(step: PlanStep, extra: Partial<StepInputs> = {}): StepInputs {
    const inputs = step.uses
      .filter((u) => u !== 'materials')
      .map((u) => {
        const s = this.plan.steps.find((x) => x.id === u);
        const out = this.outputs.get(u);
        return { id: u, title: s?.title ?? u, text: out?.text ?? '' };
      })
      .filter((x) => x.text);
    return {
      goal: this.goal,
      plan: this.plan,
      step,
      inputs,
      pages: step.uses.includes('materials') ? this.pages : [],
      docs: this.docs,
      links: this.links,
      answers: this.answerLines,
      today: this.today,
      ...extra,
    };
  }

  /** Every kept unit's words, for number checks of later steps. */
  unitTexts(ids?: readonly string[]): string[] {
    const list = ids ? this.units.filter((u) => ids.includes(u.id)) : this.units;
    return list.flatMap((u) => [u.title, u.body, u.quote?.text ?? '', ...(u.cells ? Object.values(u.cells) : [])]).filter(Boolean);
  }

  /** Sources a number may come from: the goal, the materials, the person's answers. */
  baseSources(): string[] {
    return [this.goal, ...this.pages.map((p) => p.text), ...this.answerLines.map((a) => a.answer)];
  }

  card(step: PlanStep, patch: Partial<StepCard>): StepCard {
    const prev = this.cards.get(step.id);
    const card: StepCard = {
      stepId: step.id,
      kind: step.kind,
      title: step.title,
      state: 'waiting',
      review: 'none',
      summary: '',
      checked: [],
      agentOnly: [],
      counts: { units: 0, checked: 0, agent: 0, sentBack: 0, fixed: 0, dropped: 0 },
      calls: 0,
      ms: 0,
      version: 1,
      ...prev,
      ...patch,
    };
    this.cards.set(step.id, card);
    this.ctx.emit({ type: 'card', station: step.id, card });
    return card;
  }

  // ---------------------------------------------------------------- the run

  async run(): Promise<JobOutcome> {
    if (this.redo) return this.runRedo();
    const plan = await this.makePlan();
    this.plan = plan;
    this.emitPlan();
    if (plan.fit === 'no') {
      this.ctx.note('planner', 'Planner', `These agents can't do this: ${plan.notDoable || 'it needs something outside this workshop'}.${plan.instead ? ` They can make ${plan.instead} instead.` : ''}`, true);
      return { status: 'declined', result: this.result(null), stats: this.stats() };
    }
    if (plan.fit === 'partly' && plan.notDoable) this.ctx.note('planner', 'Planner', `Part of this can't be done here: ${plan.notDoable}`, true);
    await this.schedule(plan.steps, () => true);
    return this.finish();
  }

  private async makePlan(): Promise<Plan> {
    const ctxPlan = { docs: this.docs, links: this.links };
    const ask = async (index: number, problems?: string[]) =>
      this.ctx.call({
        task: 'plan',
        index,
        payload: null,
        messages: plannerMessages({ goal: this.goal, docs: this.docs, links: this.links, today: this.today, problems }),
        schema: PLAN_SCHEMA,
        validate: (json) => schemaProblems(json, PLAN_SHAPE),
        station: 'planner',
        role: 'planner',
        what: index === 1 ? 'the plan' : 'the plan again',
      });
    const first = await ask(1);
    let check = validatePlan(first.json, ctxPlan);
    let last = first.json as Partial<PlanAnswer>;
    if (check.problems.length) {
      this.ctx.note('planner', 'Planner', `The plan didn't pass the check: ${check.problems[0]}. The planner is asked again.`);
      const second = await ask(2, check.problems);
      last = second.json as Partial<PlanAnswer>;
      check = validatePlan(second.json, ctxPlan);
    }
    for (const n of check.notes) this.ctx.note('planner', 'Planner', n);
    if (check.plan && !check.problems.length) return check.plan;
    const deliverable = last?.deliverable === 'site' || last?.deliverable === 'plan' ? last.deliverable : 'document';
    const words = { site: 'a web page', document: 'a document', plan: 'a plan' }[deliverable];
    this.ctx.note('planner', 'Planner', `The planner's plan didn't pass the check. Using a basic plan for ${words}.`, true);
    return basicPlan(deliverable, { ...ctxPlan, goal: this.goal });
  }

  private emitPlan(): void {
    const p = this.plan;
    const lines = [
      p.understood,
      `${p.steps.length} steps, about ${p.calls} model calls`,
      ...p.checkable.map((c) => `Checked by code: ${c}`),
      ...p.agentOnly.map((c) => `Reviewed by an agent: ${c}`),
    ].filter(Boolean);
    this.ctx.emit({
      type: 'plan',
      stations: p.steps.map((s) => {
        const spec = STEP_LIBRARY[s.kind];
        return { id: s.id, step: s.kind, label: s.title, by: spec.by, ...(spec.role ? { role: spec.role } : {}), ...(spec.mechanism ? { mechanism: spec.mechanism } : {}), uses: s.uses, output: s.output };
      }),
      budget: this.ctx.budget,
      lines,
      tilesPlanned: p.tilesPlanned,
      object: p.object,
      title: p.title,
      deliverable: p.deliverable,
      fit: p.fit,
      understood: p.understood,
    });
    for (const s of p.steps) this.card(s, { state: 'waiting' });
  }

  /**
   * Runs the steps in the order of their uses; `shouldRun(step)` false reuses the previous
   * output (a redo). A step whose input failed is skipped; a stopping error (no credit,
   * daily cap, no calls left) stops new steps.
   */
  async schedule(steps: readonly PlanStep[], shouldRun: (step: PlanStep) => boolean): Promise<void> {
    const pending = new Map(steps.map((s) => [s.id, s]));
    const running = new Map<string, Promise<void>>();
    const done = new Set<string>();
    for (;;) {
      for (const s of [...pending.values()]) {
        const deps = s.uses.filter((u) => u !== 'materials');
        if (deps.some((u) => this.failed.has(u)) || this.fatal) {
          pending.delete(s.id);
          this.failed.add(s.id);
          this.card(s, { state: 'skipped', summary: this.fatal ? 'Not started: the run stopped' : 'Not started: a step it needs failed' });
          continue;
        }
        if (!deps.every((u) => done.has(u) || !steps.some((x) => x.id === u))) continue;
        pending.delete(s.id);
        const go = shouldRun(s) ? this.execute(s) : Promise.resolve();
        running.set(
          s.id,
          go.then(() => {
            running.delete(s.id);
            done.add(s.id);
          }),
        );
      }
      if (!running.size) break;
      await Promise.race(running.values());
    }
  }

  private async execute(step: PlanStep): Promise<void> {
    this.ctx.throwIfCancelled();
    this.ctx.stepStart(step.id);
    const t0 = this.ctx.now();
    const redoing = this.redo?.stepId === step.id;
    this.card(step, { state: redoing ? 'redoing' : 'running', ...(redoing ? { instruction: this.redo!.instruction } : {}) });
    try {
      const out = await runStep(this, step);
      const before = this.outputs.get(step.id);
      this.outputs.set(step.id, out.result);
      this.units = [...this.units.filter((u) => u.stepId !== step.id), ...out.units];
      const kept = out.units;
      const trackIds = [...this.tracks.values()].filter((t) => t.id.startsWith(step.id + '.') || t.id.startsWith(step.id + ':'));
      const counts: StepCard['counts'] = {
        units: trackIds.length,
        checked: kept.filter((u) => u.checks.length > 0).length,
        agent: kept.filter((u) => u.checks.length === 0).length,
        sentBack: trackIds.filter((t) => t.first === 'rejected').length,
        fixed: trackIds.filter((t) => t.final === 'fixed').length,
        dropped: trackIds.filter((t) => t.final === 'dropped').length,
        ...out.counts,
      };
      this.card(step, {
        state: 'done',
        summary: out.summary,
        checked: out.checked,
        agentOnly: out.agentOnly,
        counts,
        calls: this.stepCalls.get(step.id) ?? 0,
        ms: Math.max(this.stepMs.get(step.id) ?? 0, Math.round(this.ctx.now() - t0)),
        version: (this.cards.get(step.id)?.version ?? 0) + (before ? 1 : 0),
      });
      this.ctx.stepEnd(step.id, { units: counts.units, kept: kept.length, sentBack: counts.sentBack, fixed: counts.fixed, dropped: counts.dropped });
      await this.ctx.save(`step:${step.id}`, out.result);
      this.onStepDone?.(step);
    } catch (error) {
      if (this.ctx.cancelled) throw error;
      const code = error instanceof LlmError ? error.code : 'provider-error';
      if (!(error instanceof LlmError)) console.error('engine: a step failed', error);
      this.failed.add(step.id);
      this.ctx.emit({ type: 'error', station: step.id, code: code === 'rate-limited' || code === 'provider-busy' ? 'provider-error' : code, retryable: !STOPPING.has(code) });
      this.card(step, { state: 'failed', summary: failLine(code) });
      if (error instanceof LlmError && STOPPING.has(error.code)) {
        this.fatal = error;
        this.ctx.note(step.id, 'Run', failLine(error.code), true);
      }
      this.ctx.stepEnd(step.id, { failed: 1 });
    }
  }

  // ---------------------------------------------------------------- redo

  private async runRedo(): Promise<JobOutcome> {
    const prev = this.ctx.spec.previous;
    const redo = this.redo!;
    if (!prev) throw new LlmError('material');
    this.plan = prev.plan;
    const target = prev.plan.steps.find((s) => s.id === redo.stepId);
    if (!target || STEP_LIBRARY[target.kind].by !== 'model') {
      this.ctx.note('planner', 'Run', 'Only a step done by an agent can be redone.', true);
      return { status: 'failed', result: prev, stats: prev.stats };
    }
    this.redos = (prev.stats.redos ?? 0) + 1;
    // Start from what the previous run left.
    this.units = [...prev.units];
    this.audit = [...prev.audit];
    this.rejected = [...prev.rejected];
    this.reviews = [...prev.reviews];
    this.answers = { ...prev.answers };
    for (const [id, r] of Object.entries(prev.outputs)) this.outputs.set(id, r);
    for (const c of prev.cards) this.cards.set(c.stepId, { ...c });
    for (const q of prev.plan.steps.filter((s) => s.kind === 'ask')) {
      const a = prev.answers['ask:' + q.id];
      if (a) this.answerLines.push({ question: q.args.question?.text ?? q.does, answer: a });
    }
    for (const s of prev.plan.steps) {
      const files = (prev.outputs[s.id]?.data as { files?: { path: string; text: string; summary: string }[] } | undefined)?.files;
      for (const f of files ?? []) this.files.set(f.path, { text: f.text, stepId: s.id, summary: f.summary });
    }
    this.emitPlan();
    this.ctx.note(redo.stepId, 'You', `Redo "${target.title}": ${redo.instruction}`, true);
    // A later step runs again only when a step it uses handed on something different.
    const changed = new Set<string>();
    this.onStepDone = (s) => {
      if (prev.outputs[s.id]?.hash !== this.outputs.get(s.id)?.hash) changed.add(s.id);
    };
    await this.schedule(prev.plan.steps, (s) => {
      const go = s.id === redo.stepId || s.kind === 'assemble' || (s.kind !== 'read' && s.kind !== 'ask' && s.uses.some((u) => changed.has(u)));
      if (!go) {
        this.card(s, { state: 'done' });
        return false;
      }
      for (const id of [...this.tracks.keys()]) if (id.startsWith(s.id + '.') || id.startsWith(s.id + ':')) this.tracks.delete(id);
      for (const [path, f] of [...this.files]) if (f.stepId === s.id) this.files.delete(path);
      return true;
    });
    return this.finish();
  }

  // ---------------------------------------------------------------- result

  private async finish(): Promise<JobOutcome> {
    const assembled = this.plan.steps.find((s) => s.kind === 'assemble');
    const deliverable = assembled && this.outputs.get(assembled.id) ? assemble(this) : null;
    const status = this.failed.size || !deliverable ? 'partial' : 'ready';
    return { status, result: this.result(deliverable), stats: this.stats() };
  }

  result(deliverable: TaskResult['deliverable']): TaskResult {
    return {
      plan: this.plan,
      cards: this.plan.steps.map((s) => this.cards.get(s.id)).filter((c): c is StepCard => Boolean(c)),
      units: this.units,
      deliverable,
      open: [],
      audit: this.audit,
      rejected: this.rejected,
      reviews: this.reviews,
      outputs: Object.fromEntries(this.outputs),
      answers: this.answers,
      label: runLabel(this.ctx.answers, this.ctx.spec.answerSet),
      stats: this.stats(),
      version: (this.ctx.spec.previous?.version ?? 0) + 1,
    };
  }

  stats(): RunStats {
    const counts = countUnits([...this.tracks.values()]);
    const files = [...this.files.keys()].length;
    return {
      ...emptyStats(this.pages.length),
      ...counts,
      planted: this.planted,
      caught: this.caught,
      seeded: 0,
      calls: { ...this.ctx.callsByTask },
      modelMs: this.ctx.modelMs,
      checkMs: Math.round(this.checkMs),
      steps: this.plan?.steps.length ?? 0,
      files,
      required: this.required.total,
      requiredFound: this.required.found,
      asked: this.asked,
      tiles: this.ctx.tiles,
      redos: this.redos,
    };
  }
}

export function failLine(code: string): string {
  switch (code) {
    case 'daily-cap':
      return "Today's live runs are used up. The samples still run from their recordings.";
    case 'agents-offline':
      return 'The agents are offline: no model is reachable from here right now. The samples still run from their recordings.';
    case 'budget':
      return 'This run used all its model calls. What is done stays.';
    case 'offline':
      return 'No connection. What is done stays.';
    case 'bad-output':
      return 'The agent answered twice in a shape code could not read.';
    case 'timeout':
      return 'The model took too long to answer.';
    default:
      return 'The model provider refused this call.';
  }
}
