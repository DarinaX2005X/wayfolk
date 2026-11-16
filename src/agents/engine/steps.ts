/**
 * What each kind of step does. Model steps call their agent, put every unit through the
 * gate (gate.ts) and hand on a text for later steps; code steps need no model.
 */
import type { CheckName, PlanItem, PlanStep, Unit } from '../types';
import { checkQuote } from '../checks/quote';
import { dedupe } from '../checks/dedupe';
import { checkNumbers, missingLine } from '../checks/numbers';
import { checkPlanItem, checkTotal } from '../checks/plan-table';
import { checkProject, type CodeFile } from '../checks/code/project';
import { hash6 } from '../../materials/normalize';
import { docOf } from '../../materials/pages';
import type { Engine, StepOutcome } from './engine';
import { runGate, type Candidate, type GateSpec, type Problem, type Verdict } from './gate';
import { fileExtra, fixMessages, stepMessages } from './prompts';
import { DECISION_SCHEMA, FACTS_SCHEMA, FILE_SCHEMA, fixSchema, ITEMS_SCHEMA, REVIEW_SCHEMA, SECTIONS_SCHEMA, TABLE_SCHEMA, UNIT_SCHEMAS } from './schemas';
import { plantFile, plantItems, plantSections } from './plant';
import { fileRank } from './plan-check';
import { CHECK_LINES } from './library';
import { headingProblems, hypeProblems, proseProblems, shoutProblems } from '../checks/prose';

export type Fact = { claim: string; quote: string; page: number };
export type Row = { option: string; criterion: string; value: string; quote: string; page: number };
export type Decision = { choice: string; reasons: { text: string; from: string[] }[]; risks: string[] };
export type Section = { heading: string; text: string; from: string[] };
export type FileData = { path: string; text: string; summary: string };
export type ItemData = { id: string; task: string; owner: string; start: string; end: string; depends: string[]; cells: { column: string; value: string }[]; done?: string };

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export async function runStep(e: Engine, step: PlanStep): Promise<StepOutcome> {
  switch (step.kind) {
    case 'read':
      return read(e, step);
    case 'ask':
      return ask(e, step);
    case 'research':
      return research(e, step);
    case 'compare':
      return compare(e, step);
    case 'decide':
      return decide(e, step);
    case 'write-section':
      return writeSections(e, step);
    case 'write-code':
      return writeCode(e, step);
    case 'make-plan':
      return makePlan(e, step);
    case 'review':
      return review(e, step);
    case 'check':
      return checkStep(e, step);
    case 'assemble':
      return assembleStep(e, step);
  }
}

function outcome(step: PlanStep, text: string, data: unknown, units: Unit[], summary: string, checked: string[], agentOnly: string[]): StepOutcome {
  return { result: { stepId: step.id, hash: hash6(text + JSON.stringify(data ?? null)), units: units.map((u) => u.id), text, data }, units, summary, checked, agentOnly };
}

function quoteSource(e: Engine, page: number): { docId: string; docTitle: string; page: number } {
  const p = e.pages.find((x) => x.n === page);
  const meta = p ? docOf(e.docs, p) : undefined;
  return { docId: meta?.id ?? '', docTitle: meta?.title ?? '', page };
}

/** Lines of the card's "Checked by code" column from the gate's numbers. */
function gateLines(e: Engine, step: PlanStep, noun: string): string[] {
  const tracks = [...e.tracks.values()].filter((t) => t.id.startsWith(step.id + '.') || t.id.startsWith(step.id + ':'));
  const checked = tracks.filter((t) => t.checked);
  if (!checked.length) return [];
  const out = [`${checked.length} ${noun} checked by code`];
  const sent = tracks.filter((t) => t.first === 'rejected');
  if (sent.length) out.push(`${sent.length} sent back: ${sent.filter((t) => t.final === 'fixed').length} fixed, ${sent.filter((t) => t.final === 'dropped').length} dropped`);
  const corrected = tracks.filter((t) => t.first === 'corrected').length;
  if (corrected) out.push(`${corrected} corrected by code`);
  const merged = tracks.filter((t) => t.first === 'merged').length;
  if (merged) out.push(`${merged} duplicates merged`);
  return out;
}

/** The fix call for a gate: one recheck call with every sent-back unit. */
function fixer<T>(e: Engine, step: PlanStep, noun: string, schemaUnit: Parameters<typeof fixSchema>[0], show: (d: T) => string, read: (raw: unknown) => T) {
  return async (sent: { c: Candidate<T>; verdict: Verdict<T> }[]) => {
    const out = new Map<string, T | 'withdraw' | 'missing' | 'budget'>();
    if (e.ctx.calls >= e.ctx.budget) {
      for (const s of sent) out.set(s.c.id, 'budget');
      return out;
    }
    const messages = fixMessages(
      e.inputsFor(step),
      sent.map((s) => ({ id: s.c.id, text: show(s.c.data), problems: s.verdict.problems.map((p) => p.text) })),
      noun,
    );
    const r = await e.call(step, 1, 'recheck', messages, fixSchema(schemaUnit), { what: `fix ${plural(sent.length, noun)}` });
    if (r.response.missing) {
      for (const s of sent) out.set(s.c.id, 'missing');
      e.ctx.note(step.id, 'Run', 'No second look in this recording.');
      return out;
    }
    const fixes = (r.json as { fixes: { id: string; action: 'fix' | 'withdraw'; unit: unknown }[] }).fixes;
    for (const s of sent) {
      // Models often answer with the short id ("i2" for "s3.i2"): the last part decides.
      const tail = (id: string) => id.split('.').pop();
      const f = fixes.find((x) => x.id === s.c.id) ?? fixes.find((x) => tail(x.id) === tail(s.c.id));
      if (!f) out.set(s.c.id, 'withdraw');
      else out.set(s.c.id, f.action === 'withdraw' ? 'withdraw' : read(f.unit));
    }
    return out;
  };
}

// ------------------------------------------------------------------ read and ask

async function read(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const total = e.pages.length;
  e.pages.forEach((_, i) => e.ctx.emit({ type: 'progress', station: step.id, done: i + 1, total, unit: 'pages' }));
  for (const d of e.docs) if (d.asset) e.ctx.note(step.id, 'Read', `${d.meta.title}: image kept as a file. Agents don't read pictures in this copy.`);
  if (e.links.length) e.ctx.note(step.id, 'Read', `${plural(e.links.length, 'link')} passed to the agents as addresses. Their pages are not read in this version.`);
  const text = e.docs.map((d) => `${d.meta.title}: pages ${d.meta.from}–${d.meta.to}`).join('\n');
  return outcome(step, text, null, [], `${plural(total, 'page')} from ${plural(e.docs.length, 'file')}`, [], []);
}

async function ask(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const q = step.args.question ?? { text: step.does, options: ['Yes', 'No'] };
  const options = q.options.map((label, i) => ({ id: `o${i + 1}`, label }));
  const { askId, answer } = e.ctx.ask(step.id, { key: step.id, question: q.text, options, defaultId: 'o1' });
  e.asked++;
  const picked = await answer;
  const chosen = options.find((o) => o.id === picked) ?? options[0];
  if (!picked) e.ctx.note(step.id, 'Ask', `No answer, so the agents used "${chosen.label}". You can change it on the step card.`);
  e.answers[askId] = chosen.label;
  e.answerLines.push({ question: q.text, answer: chosen.label });
  const unit: Unit = { id: `${step.id}.a`, stepId: step.id, kind: 'answer', title: q.text, body: chosen.label, status: 'agent', checks: [], version: 1 };
  return outcome(step, `${q.text} → ${chosen.label}`, { askId, answer: chosen.label }, [unit], picked ? `You chose "${chosen.label}"` : `Assumed "${chosen.label}"`, [], []);
}

// ------------------------------------------------------------------ research

function checkFact(e: Engine, c: Candidate<Fact>, kept: readonly Candidate<Fact>[]): Verdict<Fact> {
  const f = c.data;
  if (!e.hasMaterials) return { status: 'accepted', problems: [], checks: [] };
  const problems: Problem[] = [];
  const checks: CheckName[] = ['quote'];
  const q = checkQuote({ quote: f.quote, page: f.page }, e.pages, e.sig);
  const page = q.page;
  const data = q.status === 'corrected' ? { ...f, page, quote: q.quote } : f;
  if (q.status === 'rejected') {
    const words = q.reason === 'quote-too-short' ? 'The quote is too short to check' : q.reason === 'quote-altered' ? 'The quote changes a word that matters on that page' : `The quote is not on page ${f.page}`;
    problems.push({ reason: q.reason!, text: `${words}${q.diff?.source ? `. The nearest text there: "${q.diff.source}"` : ''}` });
  }
  const n = checkNumbers(f.claim, [q.status === 'rejected' ? '' : data.quote], { freeBelow: 2 });
  checks.push('numbers');
  for (const m of n.missing) problems.push({ reason: m.mention.kind === 'date' ? 'date-mismatch' : 'number-not-in-source', text: missingLine(m, 'its quote') });
  if (!problems.length) {
    const dup = dedupe({ page: data.page, quote: data.quote, claim: data.claim }, kept.map((k) => ({ id: k.id, page: k.data.page, quote: k.data.quote, claim: k.data.claim })));
    if (dup) return { status: 'merged', problems: [{ reason: 'duplicate', text: `The same fact as ${dup}` }], checks: [...checks, 'dedupe'], mergedInto: dup };
  }
  const ref = { docId: quoteSource(e, page).docId, page };
  if (problems.length) return { status: 'rejected', problems, checks, ref, ...(q.diff ? { diff: q.diff } : {}) };
  return { status: q.status === 'corrected' ? 'corrected' : 'accepted', problems: q.status === 'corrected' ? [{ reason: q.reason!, text: q.reason === 'quote-wrong-page' ? `The quote is on page ${page}, not ${f.page}` : 'The quote was reworded; the page text is kept' }] : [], checks: [...checks, 'dedupe'], data, ref, ...(q.spans ? { spans: q.spans } : {}), ...(q.found ? { found: q.found } : {}) };
}

async function research(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const pages = step.uses.includes('materials') ? e.pages : [];
  const batches: (typeof pages)[] = [];
  for (let i = 0; i < Math.max(1, pages.length); i += 12) batches.push(pages.slice(i, i + 12));
  const answers = await Promise.all(
    batches.map((b, k) =>
      e.call(step, k + 1, 'step', stepMessages(e.inputsFor(step, { pages: b })), FACTS_SCHEMA, { what: b.length ? `pages ${b[0].n}–${b[b.length - 1].n}` : 'facts' }),
    ),
  );
  const cands: Candidate<Fact>[] = [];
  answers.forEach((r) => {
    (r.json as { facts: Fact[] }).facts.slice(0, 20).forEach((f, i) => cands.push({ id: `${step.id}.f${cands.length + 1}`, data: f, planted: e.plantedFor(r.response, i) }));
  });
  const spec: GateSpec<Fact> = {
    station: step.id,
    kind: 'note',
    claim: (f) => f.claim,
    check: (c, kept) => checkFact(e, c, kept),
    fix: fixer(e, step, 'fact', UNIT_SCHEMAS.findings, (f) => `${f.claim}\nQuote (p. ${f.page}): "${f.quote}"`, (u) => u as Fact),
    unit: (c, status, checks) => ({
      id: c.id,
      stepId: step.id,
      kind: 'note',
      title: c.data.claim,
      body: c.data.claim,
      ...(e.hasMaterials && c.data.quote ? { quote: { text: c.data.quote, source: quoteSource(e, c.data.page) } } : {}),
      status,
      checks,
      version: 1,
    }),
  };
  const g = await runGate(e, spec, cands);
  const kept = g.kept.map((k) => k.unit);
  const text = g.kept.map((k) => `[${k.c.id}] ${k.c.data.claim}${k.c.data.quote ? ` — "${k.c.data.quote}" (p. ${k.c.data.page})` : ''}`).join('\n');
  const files = new Set(g.kept.map((k) => quoteSource(e, k.c.data.page).docId).filter(Boolean)).size;
  return outcome(
    step,
    text,
    { facts: g.kept.map((k) => ({ id: k.c.id, ...k.c.data })) },
    kept,
    `${plural(kept.length, 'fact')}${files ? ` from ${plural(files, 'file')}` : ''}`,
    e.hasMaterials ? [CHECK_LINES.quote, ...gateLines(e, step, 'facts')] : [],
    e.hasMaterials ? [] : ['Without materials these facts come from the model and are not checked'],
  );
}

// ------------------------------------------------------------------ compare and decide

async function compare(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const r = await e.call(step, 1, 'step', stepMessages(e.inputsFor(step)), TABLE_SCHEMA, { what: 'the table' });
  const cands: Candidate<Row>[] = (r.json as { rows: Row[] }).rows.slice(0, 36).map((row, i) => ({ id: `${step.id}.r${i + 1}`, data: row, planted: e.plantedFor(r.response, i) }));
  const sources = [...e.baseSources(), ...e.unitTexts()];
  const spec: GateSpec<Row> = {
    station: step.id,
    kind: 'row',
    claim: (d) => `${d.option} / ${d.criterion}: ${d.value}`,
    check: (c) => {
      const d = c.data;
      const problems: Problem[] = [];
      const checks: CheckName[] = [];
      let data = d;
      if (d.quote.trim() && e.hasMaterials) {
        checks.push('quote');
        const q = checkQuote({ quote: d.quote, page: d.page }, e.pages, e.sig);
        if (q.status === 'rejected') problems.push({ reason: q.reason!, text: `The quote is not on page ${d.page}` });
        else if (q.status === 'corrected') data = { ...d, page: q.page, quote: q.quote };
        const n = checkNumbers(d.value, [q.status === 'rejected' ? '' : data.quote, ...sources]);
        checks.push('numbers');
        for (const m of n.missing) problems.push({ reason: 'number-not-in-source', text: missingLine(m, 'the quote or the facts') });
      } else if (e.hasMaterials) {
        const n = checkNumbers(d.value, sources);
        if (n.matched.length || n.missing.length) checks.push('numbers');
        for (const m of n.missing) problems.push({ reason: 'number-not-in-source', text: missingLine(m, 'the materials') });
      }
      if (problems.length) return { status: 'rejected', problems, checks };
      return { status: data !== d ? 'corrected' : 'accepted', problems: [], checks, data };
    },
    fix: fixer(e, step, 'row', UNIT_SCHEMAS.table, (d) => `${d.option} / ${d.criterion}: ${d.value} (quote: "${d.quote}", p. ${d.page})`, (u) => u as Row),
    unit: (c, status, checks) => ({
      id: c.id,
      stepId: step.id,
      kind: 'row',
      title: `${c.data.option}: ${c.data.criterion}`,
      body: c.data.value,
      cells: { option: c.data.option, criterion: c.data.criterion, value: c.data.value },
      ...(c.data.quote ? { quote: { text: c.data.quote, source: quoteSource(e, c.data.page) } } : {}),
      status,
      checks,
      version: 1,
    }),
  };
  const g = await runGate(e, spec, cands);
  const text = g.kept.map((k) => `[${k.c.id}] ${k.c.data.option} / ${k.c.data.criterion}: ${k.c.data.value}${k.c.data.quote ? ` ("${k.c.data.quote}", p. ${k.c.data.page})` : ''}`).join('\n');
  const options = new Set(g.kept.map((k) => k.c.data.option)).size;
  return outcome(step, text, { rows: g.kept.map((k) => ({ id: k.c.id, ...k.c.data })) }, g.kept.map((k) => k.unit), `${plural(options, 'option')} on ${plural(new Set(g.kept.map((k) => k.c.data.criterion)).size, 'criterion', 'criteria')}`, gateLines(e, step, 'cells'), ['Which value matters more is a judgement']);
}

async function decide(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const r = await e.call(step, 1, 'step', stepMessages(e.inputsFor(step)), DECISION_SCHEMA, { what: 'the choice' });
  // A reason may rest on units, on a whole earlier step it uses, on the goal or the materials.
  const known = new Set([...e.units.map((u) => u.id), ...step.uses, 'goal']);
  const stepTexts = (ids: readonly string[]) => ids.map((id) => e.outputs.get(id)?.text ?? '').filter(Boolean);
  const spec: GateSpec<Decision> = {
    station: step.id,
    kind: 'decision',
    claim: (d) => d.choice,
    check: (c) => {
      const problems: Problem[] = [];
      for (const reason of c.data.reasons) {
        for (const id of reason.from) if (!known.has(id)) problems.push({ reason: 'from-unknown', text: `The reason "${reason.text.slice(0, 60)}" points at ${id}, which no step produced` });
        const n = checkNumbers(reason.text, [...e.unitTexts(reason.from), ...stepTexts(reason.from), ...e.baseSources()]);
        for (const m of n.missing) problems.push({ reason: 'number-not-in-source', text: missingLine(m, 'the facts it rests on') });
      }
      // The choice is a judgement: the label stays "Reviewed by an agent" even when its numbers pass.
      return problems.length ? { status: 'rejected', problems, checks: [] } : { status: 'accepted', problems: [], checks: [] };
    },
    fix: fixer(e, step, 'decision', UNIT_SCHEMAS.decision, (d) => JSON.stringify(d), (u) => u as Decision),
    unit: (c, status) => ({
      id: c.id,
      stepId: step.id,
      kind: 'decision',
      title: c.data.choice,
      body: c.data.reasons.map((x) => x.text).join('\n'),
      from: [...new Set(c.data.reasons.flatMap((x) => x.from))],
      status: status === 'fixed' ? 'fixed' : 'agent',
      checks: [],
      version: 1,
    }),
  };
  const g = await runGate(e, spec, [{ id: `${step.id}.d`, data: r.json as Decision, planted: e.plantedFor(r.response, 0) }]);
  const d = g.kept[0]?.c.data;
  const text = d ? `Choice: ${d.choice}\nReasons:\n${d.reasons.map((x) => `- ${x.text}`).join('\n')}\nRisks:\n${d.risks.map((x) => `- ${x}`).join('\n')}` : 'No choice passed the check.';
  return outcome(step, text, d ?? null, g.kept.map((k) => k.unit), d ? `Chose ${d.choice}` : 'No choice', ['Numbers in the reasons stand in the facts they cite'], ['The choice itself is a judgement']);
}

// ------------------------------------------------------------------ write

const QUOTED = /[“"]([^”"\n]{20,400})[”"]/g;

async function writeSections(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const r = await e.call(step, 1, 'step', stepMessages(e.inputsFor(step)), SECTIONS_SCHEMA, {
    what: (step.args.sections ?? []).join(', ') || 'the text',
    transform: (json) => {
      const p = plantSections(json as { sections: Section[] });
      return { json: p.json, planted: p.planted, notes: p.notes };
    },
  });
  const known = new Set(e.units.map((u) => u.id));
  const facts = e.units.filter((u) => u.kind === 'note' || u.kind === 'row');
  const cands: Candidate<Section>[] = (r.json as { sections: Section[] }).sections.slice(0, 8).map((s, i) => ({ id: `${step.id}.sec${i + 1}`, data: s, planted: e.plantedFor(r.response, i) }));
  const checkable = e.hasMaterials || facts.length > 0;
  const spec: GateSpec<Section> = {
    station: step.id,
    kind: 'section',
    claim: (s) => s.heading,
    check: (c) => {
      const s = c.data;
      // House rules of wording hold for every section, with or without materials.
      const house: Problem[] = [...headingProblems(s.heading), ...proseProblems(s.text)].map((text) => ({ reason: 'house-rule', text }));
      // Without materials or facts the content itself can't be checked: the label stays
      // "Reviewed by an agent" even though the wording rules ran.
      if (!checkable) return house.length ? { status: 'rejected', problems: house, checks: [] } : { status: 'accepted', problems: [], checks: [] };
      const problems: Problem[] = [...house];
      const checks: CheckName[] = ['numbers', 'house'];
      const from = s.from.filter((id) => known.has(id));
      for (const id of s.from) if (!known.has(id)) problems.push({ reason: 'from-unknown', text: `It cites ${id}, which no step produced` });
      const sources = [...e.baseSources(), ...e.unitTexts(from.length ? from : undefined)];
      const n = checkNumbers(`${s.heading}\n${s.text}`, sources);
      for (const m of n.missing) problems.push({ reason: 'number-not-in-source', text: missingLine(m, from.length ? 'the facts it cites or the materials' : 'the materials') });
      if (e.hasMaterials) {
        for (const m of s.text.matchAll(QUOTED)) {
          if (words(m[1]) < 5) continue;
          checks.push('quote');
          const q = checkQuote({ quote: m[1], page: e.pages[0].n }, e.pages, e.sig);
          if (q.status === 'rejected' && q.reason !== 'quote-too-short') problems.push({ reason: q.reason!, text: `"${m[1].slice(0, 80)}" is quoted, but the materials don't say it word for word` });
        }
      }
      return problems.length ? { status: 'rejected', problems, checks } : { status: 'accepted', problems: [], checks };
    },
    soft: ['house-rule'],
    fix: fixer(e, step, 'section', UNIT_SCHEMAS.section, (s) => `## ${s.heading}\n${s.text}\n(from: ${s.from.join(', ')})`, (u) => u as Section),
    unit: (c, status, checks) => ({ id: c.id, stepId: step.id, kind: 'section', title: c.data.heading, body: c.data.text, from: c.data.from.filter((id) => known.has(id)), status, checks, version: 1 }),
  };
  const g = await runGate(e, spec, cands);
  const text = g.kept.map((k) => `## ${k.c.data.heading}\n${k.c.data.text}`).join('\n\n');
  const total = g.kept.reduce((n, k) => n + words(k.c.data.text), 0);
  return outcome(
    step,
    text,
    { sections: g.kept.map((k) => ({ id: k.c.id, ...k.c.data })) },
    g.kept.map((k) => k.unit),
    `${plural(g.kept.length, 'section')}, ${plural(total, 'word')}`,
    checkable ? [CHECK_LINES.numbers, ...gateLines(e, step, 'sections')] : [],
    ['Tone and wording are judged by an agent', ...(checkable ? [] : ['Without materials the facts in the text come from the model'])],
  );
}

/** Files of the project as code checks them, with planned files not yet written standing empty. */
function projectFiles(e: Engine, own: ReadonlyMap<string, string>): CodeFile[] {
  const map = new Map<string, string>();
  for (const s of e.plan.steps) for (const f of s.args.files ?? []) map.set(f.path, '');
  for (const [p, f] of e.files) map.set(p, f.text);
  for (const [p, t] of own) map.set(p, t);
  return [...map].map(([path, text]) => ({ path, text }));
}

async function writeCode(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const files = step.args.files ?? [];
  const all = e.plan.steps.flatMap((s) => s.args.files ?? []);
  const required = step.args.required ?? [];
  const own = new Map<string, string>();
  const summaries = new Map<string, string>();
  const planted = new Map<string, string[]>();
  // Page, then scripts, then styles, one after another: each file sees the files already
  // written, so a script uses the page's ids and the styles cover every class in use.
  const ordered = [...files].sort((a, b) => fileRank(a.path) - fileRank(b.path));
  const written = () => [...[...e.files].map(([path, f]) => ({ path, text: f.text })), ...[...own].map(([path, text]) => ({ path, text }))].filter((w) => /\.(html?|m?js)$/i.test(w.path));
  const htmlNow = () => own.get('index.html') ?? e.files.get('index.html')?.text ?? [...own].find(([p]) => /\.html?$/i.test(p))?.[1] ?? '';
  const writeOne = async (f: { path: string; purpose: string }, k: number) => {
    const extra = fileExtra({ path: f.path, purpose: f.purpose, all, written: written().filter((w) => w.path !== f.path), required: f.path === 'index.html' ? required : [] });
    const r = await e.call(step, k, 'step', stepMessages(e.inputsFor(step), extra), FILE_SCHEMA, {
      what: f.path,
      transform: (json) => {
        const j = json as { content: string; summary: string };
        const p = plantFile(f.path, j.content, { materials: e.hasMaterials, html: htmlNow() });
        return { json: { ...j, content: p.value }, planted: p.notes.map(() => 0), notes: p.notes };
      },
    });
    const j = r.json as { content: string; summary: string };
    own.set(f.path, stripFence(j.content));
    summaries.set(f.path, j.summary);
    planted.set(f.path, e.plantedFor(r.response, 0));
  };
  // Call numbers stay those of the planner's file order, so recordings keep their keys.
  for (const f of ordered) await writeOne(f, files.indexOf(f) + 1);

  const sources = e.hasMaterials ? e.baseSources() : undefined;
  const check = (c: Candidate<FileData>, current: ReadonlyMap<string, string>): Verdict<FileData> => {
    const merged = new Map(current);
    merged.set(c.data.path, c.data.text);
    const pc = checkProject(projectFiles(e, merged), { required, house: true, ...(sources ? { sources } : {}) });
    const fc = pc.files.find((x) => x.path === c.data.path)!;
    const problems: Problem[] = fc.problems.map((p) => ({ reason: p.reason, text: p.text, ...(p.line ? { line: p.line } : {}) }));
    return problems.length ? { status: 'rejected', problems, checks: fc.checks, ref: { file: c.data.path, ...(problems[0].line ? { line: problems[0].line } : {}) } } : { status: 'accepted', problems: [], checks: fc.checks };
  };
  const current = new Map(own);
  const cands: Candidate<FileData>[] = files.filter((f) => own.has(f.path)).map((f) => ({ id: `${step.id}:${f.path}`, data: { path: f.path, text: own.get(f.path)!, summary: summaries.get(f.path) ?? '' }, planted: planted.get(f.path) ?? [] }));
  const spec: GateSpec<FileData> = {
    station: step.id,
    soft: ['house-rule'],
    kind: 'file',
    claim: (d) => d.path,
    check: (c) => check(c, current),
    fix: async (sent) => {
      const out = new Map<string, FileData | 'withdraw' | 'missing' | 'budget'>();
      await Promise.all(
        sent.map(async (s, i) => {
          if (e.ctx.calls >= e.ctx.budget) return out.set(s.c.id, 'budget');
          const others = [...current].filter(([p]) => p !== s.c.data.path).map(([path, text]) => ({ path, text }));
          const extra = fileExtra({ path: s.c.data.path, purpose: files.find((f) => f.path === s.c.data.path)?.purpose ?? '', all, written: others, required: s.c.data.path === 'index.html' ? required : [] });
          const messages = fixMessages(e.inputsFor(step), [{ id: s.c.data.path, text: s.c.data.text, problems: s.verdict.problems.map((p) => (p.line ? `Line ${p.line}: ${p.text}` : p.text)) }], 'file');
          messages[1] = { role: 'user', content: `${messages[1].content as string}\n\n${extra}\n\nAnswer with fixes[0].id "${s.c.data.path}" and the whole corrected file in unit.content.` };
          const r = await e.call(step, 50 + i, 'recheck', messages, fixSchema(UNIT_SCHEMAS.files), { what: `fix ${s.c.data.path}` });
          if (r.response.missing) {
            e.ctx.note(step.id, 'Run', 'No second look in this recording.');
            return out.set(s.c.id, 'missing');
          }
          const f = (r.json as { fixes: { id: string; action: string; unit: { content: string } }[] }).fixes[0];
          if (!f || f.action === 'withdraw') return out.set(s.c.id, 'withdraw');
          const fixed = { ...s.c.data, text: stripFence(f.unit.content) };
          current.set(fixed.path, fixed.text);
          out.set(s.c.id, fixed);
        }),
      );
      return out;
    },
    unit: (c, status, checks) => ({ id: c.id, stepId: step.id, kind: 'file', title: c.data.path, body: c.data.summary, path: c.data.path, status, checks, version: 1 }),
  };
  const g = await runGate(e, spec, cands);
  for (const kept of g.kept) e.files.set(kept.c.data.path, { text: kept.c.data.text, stepId: step.id, summary: kept.c.data.summary });
  const lines = g.kept.reduce((n, k) => n + k.c.data.text.split('\n').length, 0);
  const text = g.kept.map((k) => `--- ${k.c.data.path} (${k.c.data.summary}) ---\n${k.c.data.text}`).join('\n\n');
  return outcome(
    step,
    text,
    { files: g.kept.map((k) => k.c.data) },
    g.kept.map((k) => k.unit),
    `${plural(g.kept.length, 'file')}, ${plural(lines, 'line')}`,
    [CHECK_LINES.parse, CHECK_LINES.refs, ...(required.length ? [CHECK_LINES.required] : []), ...gateLines(e, step, 'files')],
    ['Design and wording are judged by an agent'],
  );
}

/** A model that wraps a file in a ``` fence: the fence is not part of the file. */
export function stripFence(s: string): string {
  const m = /^\s*```[\w-]*\n([\s\S]*?)\n```\s*$/.exec(s);
  return m ? m[1] : s;
}

// ------------------------------------------------------------------ plan items

/** Fewer items than this is not a plan: code asks for the whole plan once more. */
const MIN_ITEMS = 4;
const FIELD_COLUMN = /^(task|owner|start|end|depend|after|date)/i;

async function makePlan(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const ask = (k: number, extra = '') =>
    e.call(step, k, 'step', stepMessages(e.inputsFor(step), extra), ITEMS_SCHEMA, {
      what: k === 1 ? 'the plan items' : 'the plan items again',
      transform: (json) => {
        const p = plantItems(json as Parameters<typeof plantItems>[0], { window: e.plan.window, team: e.plan.team });
        return { json: p.json, planted: p.planted, notes: p.notes };
      },
    });
  let r = await ask(1);
  const first = (r.json as { items: ItemData[] }).items.length;
  if (first < MIN_ITEMS) {
    e.ctx.note(step.id, 'Run', `The plan came back with ${plural(first, 'item')}. Code asks for the whole plan again.`);
    r = await ask(2, `Your previous answer had only ${plural(first, 'item')}. A real plan here has 8 to 16 items that cover everything the goal and the materials ask for. Answer again with the whole plan.`);
  }
  const answer = r.json as { items: ItemData[]; totals: { column: string; value: string }[] };
  // An item id that already carries the step's prefix (a redo reads the earlier ids) keeps one.
  const prefix = step.id + '.';
  const own = (id: string) => {
    let x = id;
    while (x.startsWith(prefix)) x = x.slice(prefix.length);
    return x;
  };
  for (const it of answer.items) {
    it.id = own(it.id);
    it.depends = it.depends.map(own);
  }
  // Task, owner, dates and dependencies are fields of the item, not extra columns.
  for (const it of answer.items) it.cells = it.cells.filter((c) => !FIELD_COLUMN.test(c.column.trim()));
  const local = new Map(answer.items.map((it) => [it.id, `${step.id}.${it.id}`]));
  const toItem = (d: ItemData, id: string): PlanItem => ({
    id,
    task: d.task,
    owner: d.owner,
    start: d.start,
    end: d.end,
    depends: d.depends.map((x) => local.get(x) ?? x),
    cells: Object.fromEntries(d.cells.map((c) => [c.column, c.value])),
    ...(d.done?.trim() ? { done: d.done.trim() } : {}),
    units: [id],
  });
  const cands: Candidate<ItemData>[] = answer.items.slice(0, 24).map((it, i) => ({ id: `${step.id}.${it.id || 'i' + (i + 1)}`, data: it, planted: e.plantedFor(r.response, i) }));
  const current = new Map(cands.map((c) => [c.id, toItem(c.data, c.id)]));
  const moneyColumns = (step.args.columns ?? []).filter((c) => c.type === 'money').map((c) => c.name);
  const sources = e.hasMaterials ? e.baseSources() : [];
  const spec: GateSpec<ItemData> = {
    station: step.id,
    soft: ['house-rule'],
    kind: 'item',
    claim: (d) => `${d.task} (${d.owner}, ${d.start} to ${d.end})`,
    check: (c) => {
      const it = toItem(c.data, c.id);
      const problems: Problem[] = checkPlanItem(it, { all: [...current.values()], window: e.plan.window, team: e.plan.team, sources, moneyColumns });
      // House rules of a plan: a done-when for every item, task names without shouting or hype.
      const house = [
        ...((c.data.done ?? '').trim().split(/\s+/).filter(Boolean).length < 3 ? [`"${c.data.task}" has no done-when: one sentence that says how anyone can tell it is finished`] : []),
        ...shoutProblems(c.data.task, 'The task'),
        ...hypeProblems(c.data.task),
      ];
      for (const text of house) problems.push({ reason: 'house-rule', text });
      const checks: CheckName[] = ['plan-table', 'dates', 'house', ...(moneyColumns.length && sources.length ? (['numbers'] as CheckName[]) : [])];
      return problems.length ? { status: 'rejected', problems, checks } : { status: 'accepted', problems: [], checks };
    },
    fix: fixer(e, step, 'item', UNIT_SCHEMAS.items, (d) => JSON.stringify(d), (u) => {
      const d = u as ItemData;
      return d;
    }),
    unit: (c, status, checks) => {
      const it = toItem(c.data, c.id);
      current.set(c.id, it);
      return { id: c.id, stepId: step.id, kind: 'item', title: c.data.task, body: `${c.data.owner}: ${c.data.start} to ${c.data.end}`, cells: { task: it.task, owner: it.owner, start: it.start, end: it.end, ...it.cells }, status, checks, version: 1 };
    },
  };
  const g = await runGate(e, spec, cands);
  const items = g.kept.map((k) => toItem(k.c.data, k.c.id));
  const units = g.kept.map((k) => k.unit);
  // Totals: code sums the column again; a stated total that disagrees is corrected by code.
  const totals: { column: string; value: string; stated: string; ok: boolean }[] = [];
  answer.totals.forEach((t, i) => {
    const r2 = checkTotal(items, t.column, t.value);
    const id = `${step.id}.total-${i + 1}`;
    const plantedNotes = e.plantedFor(r.response, 1000 + i);
    const status = r2.ok ? 'accepted' : 'corrected';
    e.track({ id, first: status, final: status, checked: true, planted: plantedNotes.length > 0, seeded: false }, r2.ok ? 0 : plantedNotes.length, plantedNotes.length);
    const value = r2.ok ? t.value : formatLike(t.value, r2.sum);
    e.emitItem(step.id, {
      id,
      kind: 'row',
      station: step.id,
      status,
      ...(r2.ok ? {} : { reason: 'sum-mismatch' as const, problems: [`The stated total ${t.value} isn't the sum of the items. Code's sum is ${value}.`] }),
      claim: `Total ${t.column}: ${t.value}`,
      unitId: id,
      label: 'checked',
      checks: ['sums'],
      ...(plantedNotes.length ? { planted: true } : {}),
    });
    totals.push({ column: t.column, value, stated: t.value, ok: r2.ok });
    units.push({ id, stepId: step.id, kind: 'row', title: `Total ${t.column}`, body: value, status: r2.ok ? 'checked' : 'corrected', checks: ['sums'], version: 1 });
  });
  const owners = new Set(items.map((i) => i.owner)).size;
  const dates = items.flatMap((i) => [i.start, i.end]).filter(Boolean).sort();
  const text = items.map((i) => `[${i.id}] ${i.task} — ${i.owner}, ${i.start} to ${i.end}${i.depends.length ? `, after ${i.depends.join(', ')}` : ''}${Object.keys(i.cells).length ? ` (${Object.entries(i.cells).map(([k, v]) => `${k}: ${v}`).join('; ')})` : ''}`).join('\n') + (totals.length ? `\nTotals: ${totals.map((t) => `${t.column} ${t.value}`).join('; ')}` : '');
  return outcome(
    step,
    text,
    { items, totals, columns: step.args.columns ?? [] },
    units,
    `${plural(items.length, 'item')}, ${plural(owners, 'owner')}${dates.length ? `, ${dates[0]} to ${dates[dates.length - 1]}` : ''}`,
    [CHECK_LINES['plan-table'], ...(totals.length ? [CHECK_LINES.sums] : []), ...gateLines(e, step, 'items')],
    ['Whether the tasks are the right ones is judged by an agent'],
  );
}

/** '$12,400' written like the stated '$12,250'. */
function formatLike(stated: string, sum: string): string {
  const n = Number(sum);
  const text = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const m = /[\d][\d,]*(?:\.\d+)?/.exec(stated);
  return m ? stated.slice(0, m.index) + text + stated.slice(m.index + m[0].length) : text;
}

// ------------------------------------------------------------------ review, check, assemble

async function review(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const r = await e.call(step, 1, 'step', stepMessages(e.inputsFor(step)), REVIEW_SCHEMA, { what: 'a second reading' });
  const a = r.json as { verdict: string; issues: { severity: 'minor' | 'major'; about: string; text: string }[] };
  const issues = a.issues.slice(0, 8);
  for (const i of issues) e.reviews.push({ stepId: step.id, text: `${i.about ? i.about + ': ' : ''}${i.text}`, severity: i.severity });
  for (const i of issues.filter((x) => x.severity === 'major')) e.ctx.note(step.id, 'Reviewer', `${i.about ? i.about + ': ' : ''}${i.text}`);
  const units: Unit[] = issues.map((i, k) => ({ id: `${step.id}.i${k + 1}`, stepId: step.id, kind: 'issue', title: i.about || 'Issue', body: i.text, status: 'agent', checks: [], version: 1 }));
  const major = issues.filter((x) => x.severity === 'major').length;
  const text = `${a.verdict}\n${issues.map((i) => `- (${i.severity}) ${i.about}: ${i.text}`).join('\n')}`;
  return outcome(step, text, a, units, `${plural(issues.length, 'issue')}${major ? ` (${major} major)` : ''}`, [], [a.verdict, ...issues.map((i) => `${i.severity === 'major' ? 'Major' : 'Minor'}: ${i.about ? i.about + ': ' : ''}${i.text}`)]);
}

async function checkStep(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const t0 = e.ctx.now();
  const files = [...e.files].map(([path, f]) => ({ path, text: f.text }));
  const required = e.plan.steps.flatMap((s) => s.args.required ?? []);
  const pc = checkProject(files, { required, house: true, ...(e.hasMaterials ? { sources: e.baseSources() } : {}) });
  e.addCheckMs(e.ctx.now() - t0);
  const units: Unit[] = [];
  e.required = { total: pc.load.required.length, found: pc.load.required.filter((r) => r.found).length };
  pc.load.required.forEach((r, i) => {
    const id = `${step.id}.e${i + 1}`;
    e.ctx.emit({ type: 'progress', station: step.id, done: i + 1, total: pc.load.required.length, unit: 'checks' });
    const first = r.found ? 'accepted' : 'rejected';
    e.track({ id, first, final: r.found ? 'accepted' : 'dropped', checked: true, planted: false, seeded: false }, 0, 0);
    e.emitItem(step.id, { id, kind: 'element', station: step.id, status: r.found ? 'accepted' : 'dropped', ...(r.found ? {} : { reason: 'required-missing' as const, dropCause: 'failed-again' as const, problems: [`${r.what}: nothing matches ${r.selector}`] }), claim: r.what, unitId: id, label: 'checked', checks: ['required'], ref: { file: 'index.html' } });
    if (r.found) {
      units.push({ id, stepId: step.id, kind: 'element', title: r.what, body: r.selector, status: 'checked', checks: ['required'], version: 1 });
      e.ctx.tile(step.id, { kind: 'element', id });
    }
  });
  const external = [...new Set(pc.files.flatMap((f) => f.external))];
  const problems = pc.load.errors.length;
  const checked = [
    `${plural(files.length, 'file')} parsed`,
    `${pc.load.required.filter((r) => r.found).length} of ${plural(pc.load.required.length, 'required part')} found`,
    problems ? `${plural(problems, 'problem')} left: ${pc.load.errors.slice(0, 3).map((x) => `${x.file}: ${x.text}`).join('; ')}` : 'No broken references, links or files',
  ];
  const agentOnly = external.length ? [`${plural(external.length, 'outside link')} not checked: needs the server`] : [];
  return outcome(step, checked.join('\n'), { load: pc.load, external }, units, problems ? `${plural(problems, 'problem')} left` : 'Everything checks out', checked, agentOnly);
}

async function assembleStep(e: Engine, step: PlanStep): Promise<StepOutcome> {
  const kind = e.plan.deliverable;
  const summary =
    kind === 'site'
      ? `${plural(e.files.size, 'file')}, ready to open`
      : kind === 'document'
        ? `${plural(e.units.filter((u) => u.kind === 'section').length, 'section')}`
        : `${plural(e.units.filter((u) => u.kind === 'item').length, 'plan item')}`;
  const checked = e.units.filter((u) => u.checks.length).length;
  const agent = e.units.filter((u) => u.checks.length === 0 && u.kind !== 'answer').length;
  return outcome(step, summary, null, [], summary, [`${plural(checked, 'part')} checked by code`], agent ? [`${plural(agent, 'part')} reviewed by an agent`] : []);
}
