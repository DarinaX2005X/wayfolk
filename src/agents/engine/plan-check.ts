/**
 * validatePlan: the planner's answer becomes a Plan only through code.
 *
 *   - steps only from the library; a step outside it is left out with a line
 *     ('Planner asked for a step called "deploy", which isn't in the library. Left out.');
 *   - code adds: read first when there are materials; ask after it when the planner has a
 *     question; check after the last write-code of a site; assemble last;
 *   - 4 to 12 steps after that; ids s1…sN in order; `uses` only point back, unknown ones
 *     are dropped; a model step with nothing to use gets the materials or the step before;
 *   - a site needs a write-code with index.html, a document a write-section, a plan a
 *     make-plan; file paths relative, no '..', known extensions, up to 12 files;
 *   - required parts of a page are "what" and a selector this code can read; others are
 *     left out with a line;
 *   - at most 30 calls by estimate; an object outside the kit gets the deliverable's default.
 * Problems mean the plan did not pass (the planner is asked once more with them); notes
 * are lines for the plan card.
 */
import type { DeliverableKind, Doc, ObjectId, Plan, PlanColumn, PlanStep, StepArgs, StepKind } from '../types';
import { schemaProblems } from '../schema';
import { parseSelector } from '../checks/code/html';
import { isIsoDate } from '../checks/dates';
import { CHECK_LINES, CODE_EXTENSIONS, DEFAULT_OBJECT, MAX_FILES, MAX_STEPS, MIN_STEPS, OBJECT_IDS, STEP_LIBRARY } from './library';
import { PLAN_SHAPE } from './schemas';

export type PlanAnswer = {
  understood: string;
  title: string;
  deliverable: DeliverableKind;
  fit: Plan['fit'];
  notDoable: string;
  instead: string;
  question: string;
  options: string[];
  object: string;
  objectWhy: string;
  windowFrom: string;
  windowTo: string;
  team: string[];
  steps: {
    id: string;
    kind: string;
    title: string;
    does: string;
    uses: string[];
    focus: string;
    files: { path: string; purpose: string }[];
    sections: string[];
    columns: { name: string; type: PlanColumn['type'] }[];
    options: string[];
    criteria: string[];
    required: { what: string; selector: string }[];
    done: string[];
  }[];
};

export type PlanCheck = { plan: Plan | null; problems: string[]; notes: string[] };
export const CALL_LIMIT = 30;
const RESERVE_CALLS = 6;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export function filePathProblem(path: string): string | null {
  if (!path || path.startsWith('/') || /\\/.test(path) || path.split('/').some((p) => p === '..' || p === '.' || p === '')) return `"${path}" is not a plain relative path`;
  if (!/^[\w./-]+$/.test(path)) return `"${path}" has characters a file path can't have`;
  if (!CODE_EXTENSIONS.some((e) => path.toLowerCase().endsWith(e))) return `"${path}" is not one of ${CODE_EXTENSIONS.join(' ')}`;
  return null;
}

/** Model calls a step will take by estimate (files: one each; research: one per 12 pages). */
export function stepCalls(step: Pick<PlanStep, 'kind' | 'args'>, pages: number): number {
  const spec = STEP_LIBRARY[step.kind];
  if (spec.by !== 'model') return 0;
  if (step.kind === 'write-code') return Math.max(1, step.args.files?.length ?? 1);
  if (step.kind === 'research') return Math.max(1, Math.ceil(pages / 12));
  return 1;
}

function makeStep(kind: StepKind, title: string, does: string, uses: string[], args: StepArgs = {}, done: string[] = []): PlanStep {
  const spec = STEP_LIBRARY[kind];
  return { id: '', kind, title: clip(title || spec.label, 18), does, uses, args, output: spec.output, checks: [...spec.checks], done };
}

export function validatePlan(answer: unknown, ctx: { docs: readonly Doc[]; links: readonly string[] }): PlanCheck {
  const problems: string[] = [];
  const notes: string[] = [];
  const shape = schemaProblems(answer, PLAN_SHAPE);
  if (shape.length) return { plan: null, problems: shape.slice(0, 6), notes };
  const a = answer as PlanAnswer;
  const hasMaterials = ctx.docs.some((d) => d.pages.length > 0);
  const pages = ctx.docs.reduce((n, d) => n + d.pages.length, 0);

  let object = a.object as ObjectId;
  if (!(OBJECT_IDS as string[]).includes(object)) {
    object = DEFAULT_OBJECT[a.deliverable];
    notes.push(`The planner picked an object the island doesn't have. Using a ${object}.`);
  }
  const window = isIsoDate(a.windowFrom) && isIsoDate(a.windowTo) && a.windowFrom <= a.windowTo ? { from: a.windowFrom, to: a.windowTo } : null;
  if (a.deliverable === 'plan' && !window && (a.windowFrom || a.windowTo)) notes.push("The plan's dates are not a readable window, so dates are checked only for order.");

  const base = {
    understood: a.understood.trim(),
    title: clip(a.title.trim() || 'Untitled project', 40),
    deliverable: a.deliverable,
    fit: a.fit,
    notDoable: a.notDoable.trim(),
    instead: a.instead.trim(),
    object,
    objectWhy: a.objectWhy.trim(),
    window,
    // A name, without the role the planner may add ("Maya Lindqvist (product lead)").
    team: [...new Set(a.team.map((t) => t.split(/\s*[(:]/)[0].trim()).filter(Boolean))],
  };
  if (a.fit === 'no') {
    return { plan: { ...base, steps: [], checkable: [], agentOnly: [], calls: 1, tilesPlanned: 0 }, problems, notes };
  }

  // Planner steps, in its order, with its ids kept for mapping `uses`.
  const known = new Set(Object.keys(STEP_LIBRARY));
  const taken: { from: string; step: PlanStep }[] = [];
  const looseRequired: { what: string; selector: string }[] = [];
  for (const s of a.steps) {
    if (!known.has(s.kind)) {
      notes.push(`Planner asked for a step called "${s.kind}", which isn't in the library. Left out.`);
      continue;
    }
    const kind = s.kind as StepKind;
    // Parts the page must have count wherever the planner wrote them (often on its check step).
    if (kind !== 'write-code') for (const r of s.required) if (parseSelector(r.selector)) looseRequired.push({ what: r.what.trim(), selector: r.selector.trim() });
    if (kind === 'read' || kind === 'assemble' || kind === 'check') continue; // code places these itself
    if (kind === 'ask' && taken.some((t) => t.step.kind === 'ask')) continue;
    const args: StepArgs = {};
    if (s.focus.trim()) args.focus = s.focus.trim();
    if (kind === 'write-code') {
      const files: { path: string; purpose: string }[] = [];
      for (const f of s.files) {
        const path = f.path.trim().replace(/^\.\//, '');
        const p = filePathProblem(path);
        if (p) problems.push(`Step "${s.title}": ${p}`);
        else if (!files.some((x) => x.path === path)) files.push({ path, purpose: f.purpose.trim() });
      }
      if (!files.length) problems.push(`Step "${s.title}" writes code but names no files`);
      args.files = files;
      const required: { what: string; selector: string }[] = [];
      for (const r of s.required) {
        if (!parseSelector(r.selector)) notes.push(`"${r.selector}" is not a selector code can read. "${r.what}" is left to the review.`);
        else required.push({ what: r.what.trim(), selector: r.selector.trim() });
      }
      if (required.length) args.required = required;
    }
    if (kind === 'write-section') args.sections = s.sections.map((x) => x.trim()).filter(Boolean);
    if (kind === 'make-plan' && taken.some((t) => t.step.kind === 'make-plan')) {
      problems.push('Two steps write plan items: use one make-plan step for the whole plan, so its items, dates and dependencies stay together');
    }
    // Task, owner, dates and dependencies are fields of every item, not extra columns.
    if (kind === 'make-plan' && s.columns.length) {
      const columns = s.columns.filter((c) => c.name.trim() && !/^(task|owner|start|end|depend|after|date)/i.test(c.name.trim())).map((c) => ({ name: c.name.trim(), type: c.type }));
      if (columns.length) args.columns = columns;
    }
    if ((kind === 'compare' || kind === 'decide') && s.options.length) args.options = s.options;
    if ((kind === 'compare' || kind === 'decide') && s.criteria.length) args.criteria = s.criteria;
    if (kind === 'ask') {
      const options = (s.options.length ? s.options : a.options).map((o) => o.trim()).filter(Boolean).slice(0, 4);
      const text = (a.question || s.does).trim();
      if (options.length < 2) continue;
      args.question = { text, options };
    }
    taken.push({ from: s.id, step: makeStep(kind, s.title, s.does, s.uses, args, s.done.slice(0, 6)) });
  }

  // Code's own steps.
  const steps: { from: string; step: PlanStep }[] = [];
  if (hasMaterials || ctx.links.length) steps.push({ from: 'read', step: makeStep('read', 'Read', 'Read the given files into numbered pages', []) });
  if (a.question.trim() && a.options.filter((o) => o.trim()).length >= 2 && !taken.some((t) => t.step.kind === 'ask')) {
    steps.push({ from: 'ask', step: makeStep('ask', 'Ask you', a.question.trim(), [], { question: { text: a.question.trim(), options: a.options.map((o) => o.trim()).filter(Boolean).slice(0, 4) } }) });
  }
  // Code steps of a site go page, then scripts, then styles, one after another: a script
  // sees the ids of the page, and the styles see every class the page and the scripts use.
  const codeAt = taken.map((t, i) => (t.step.kind === 'write-code' ? i : -1)).filter((i) => i >= 0);
  const sorted = codeAt.map((i) => taken[i]).sort((x, y) => codeRank(x.step) - codeRank(y.step));
  codeAt.forEach((at, k) => (taken[at] = sorted[k]));
  // An ask the planner placed goes right after read: everything else may depend on it.
  const askAt = taken.findIndex((t) => t.step.kind === 'ask');
  if (askAt >= 0) steps.push(taken.splice(askAt, 1)[0]);
  steps.push(...taken);
  if (a.deliverable === 'site') {
    const lastCode = steps.map((s) => s.step.kind).lastIndexOf('write-code');
    if (lastCode >= 0) steps.splice(lastCode + 1, 0, { from: 'check', step: makeStep('check', 'Check page', 'Check every file, link and required part by code', []) });
  }
  steps.push({ from: 'assemble', step: makeStep('assemble', 'Assemble', 'Put the deliverable together', []) });

  // Ids and uses.
  const idOf = new Map<string, string>();
  steps.forEach((s, i) => {
    s.step.id = `s${i + 1}`;
    if (s.from && !idOf.has(s.from)) idOf.set(s.from, s.step.id);
  });
  const askId = steps.find((s) => s.step.kind === 'ask')?.step.id;
  steps.forEach((s, i) => {
    const earlier = new Set(steps.slice(0, i).map((x) => x.step.id));
    const uses: string[] = [];
    for (const u of s.step.uses) {
      const key = u.trim();
      if (key === 'materials') {
        if (hasMaterials || ctx.links.length) uses.push('materials');
        continue;
      }
      const id = idOf.get(key) ?? (earlier.has(key) ? key : null);
      if (id && earlier.has(id) && !uses.includes(id)) uses.push(id);
    }
    const kind = s.step.kind;
    if (kind === 'check' || kind === 'assemble') {
      uses.push(...steps.slice(0, i).filter((x) => x.step.kind !== 'read' && x.step.kind !== 'check').map((x) => x.step.id).filter((id) => !uses.includes(id)));
    } else if (STEP_LIBRARY[kind].by === 'model') {
      if (askId && askId !== s.step.id && earlier.has(askId) && !uses.includes(askId)) uses.unshift(askId);
      if (kind === 'research' && (hasMaterials || ctx.links.length) && !uses.includes('materials')) uses.push('materials');
      if (kind === 'write-code') {
        const prev = steps.slice(0, i).map((x) => x.step).filter((x) => x.kind === 'write-code').at(-1);
        if (prev && !uses.includes(prev.id)) uses.push(prev.id);
      }
      const real = uses.filter((u) => u !== askId);
      if (real.length === 0) {
        if (hasMaterials) uses.push('materials');
        const before = steps
          .slice(0, i)
          .map((x) => x.step)
          .filter((x) => STEP_LIBRARY[x.kind].by === 'model');
        if (before.length) uses.push(before[before.length - 1].id);
      }
    }
    s.step.uses = uses;
  });
  const list = steps.map((s) => s.step);

  // What the deliverable needs.
  const kinds = list.map((s) => s.kind);
  if (a.deliverable === 'site') {
    if (!kinds.includes('write-code')) problems.push('A site needs at least one write-code step');
    const paths = list.flatMap((s) => s.args.files?.map((f) => f.path) ?? []);
    if (paths.length > MAX_FILES) problems.push(`${paths.length} files is more than ${MAX_FILES}`);
    if (new Set(paths).size !== paths.length) problems.push('Two steps write the same file');
    if (kinds.includes('write-code') && !paths.includes('index.html')) problems.push('A site needs an index.html');
    const htmlStep = list.find((s) => s.args.files?.some((f) => f.path === 'index.html'));
    // Every required part goes to the step that writes index.html: that is where it must stand.
    const pool = [...list.flatMap((s) => s.args.required ?? []), ...looseRequired];
    if (htmlStep && pool.length) htmlStep.args.required = pool.filter((r, k) => pool.findIndex((x) => x.selector === r.selector) === k).slice(0, 8);
    for (const s of list) if (s !== htmlStep && s.args.required) delete s.args.required;
  }
  if (a.deliverable === 'document' && !kinds.includes('write-section')) problems.push('A document needs at least one write-section step');
  if (a.deliverable === 'plan' && !kinds.includes('make-plan')) problems.push('A plan needs at least one make-plan step');
  if (list.length < MIN_STEPS) problems.push(`${list.length} steps is fewer than ${MIN_STEPS}`);
  if (list.length > MAX_STEPS) problems.push(`${list.length} steps is more than ${MAX_STEPS}`);
  const calls = 1 + list.reduce((n, s) => n + stepCalls(s, pages), 0);
  if (calls + RESERVE_CALLS > CALL_LIMIT) problems.push(`About ${calls} calls plus ${RESERVE_CALLS} for second looks is more than ${CALL_LIMIT}`);

  const checks = new Set(list.flatMap((s) => (STEP_LIBRARY[s.kind].by === 'model' || s.kind === 'check' ? s.checks : [])));
  if (!hasMaterials) {
    checks.delete('quote');
    checks.delete('numbers');
  }
  const agentOnly: string[] = [];
  if (kinds.includes('review')) agentOnly.push('The review is an agent reading the work, not a check');
  if (kinds.includes('decide')) agentOnly.push('The choice itself is a judgement');
  if (kinds.includes('write-section') || kinds.includes('write-code')) agentOnly.push('Tone, wording and design are judged by an agent');
  if (!hasMaterials && (kinds.includes('research') || kinds.includes('write-section'))) agentOnly.push('Facts without materials come from the model and are not checked');
  const tilesPlanned = list.reduce((n, s) => n + (s.kind === 'write-code' ? (s.args.files?.length ?? 1) : s.kind === 'write-section' ? Math.max(1, s.args.sections?.length ?? 1) : STEP_LIBRARY[s.kind].by === 'model' ? 6 : 0), 0);

  const plan: Plan = {
    ...base,
    steps: list,
    checkable: [...checks].map((c) => CHECK_LINES[c]),
    agentOnly,
    calls,
    tilesPlanned,
  };
  return { plan, problems, notes };
}

/** A basic plan for the deliverable, when the planner's plan didn't pass twice. */
export function basicPlan(deliverable: DeliverableKind, ctx: { docs: readonly Doc[]; links: readonly string[]; goal: string }): Plan {
  const hasMaterials = ctx.docs.some((d) => d.pages.length > 0);
  const steps: PlanAnswer['steps'] = [];
  const empty = { focus: '', files: [], sections: [], columns: [], options: [], criteria: [], required: [], done: [] };
  if (hasMaterials) steps.push({ ...empty, id: 'p1', kind: 'research', title: 'Find facts', does: 'Find the facts the work needs in the materials', uses: ['materials'] });
  if (deliverable === 'site') {
    steps.push({ ...empty, id: 'p2', kind: 'write-code', title: 'Build page', does: 'Write the page', uses: hasMaterials ? ['p1'] : [], files: [{ path: 'index.html', purpose: 'The page' }, { path: 'styles.css', purpose: 'The look' }, { path: 'app.js', purpose: 'What moves' }] });
  } else if (deliverable === 'document') {
    steps.push({ ...empty, id: 'p2', kind: 'write-section', title: 'Write', does: 'Write the document', uses: hasMaterials ? ['p1'] : [], sections: ['Summary', 'Details'] });
  } else {
    steps.push({ ...empty, id: 'p2', kind: 'make-plan', title: 'Make plan', does: 'Write the plan items', uses: hasMaterials ? ['p1'] : [] });
  }
  steps.push({ ...empty, id: 'p3', kind: 'review', title: 'Review', does: 'Read the work critically', uses: ['p2'] });
  const answer: PlanAnswer = {
    understood: ctx.goal,
    title: clip(ctx.goal, 40),
    deliverable,
    fit: 'yes',
    notDoable: '',
    instead: '',
    question: '',
    options: [],
    object: DEFAULT_OBJECT[deliverable],
    objectWhy: 'The default for this kind of result',
    windowFrom: '',
    windowTo: '',
    team: [],
    steps,
  };
  const r = validatePlan(answer, ctx);
  return r.plan!;
}

/** Order of code steps: one writing a page first, then scripts, then styles. */
export function fileRank(path: string): number {
  return /\.html?$/i.test(path) ? 0 : /\.css$/i.test(path) ? 2 : 1;
}

function codeRank(step: PlanStep): number {
  const files = step.args.files ?? [];
  return files.length ? Math.min(...files.map((f) => fileRank(f.path))) : 1;
}
