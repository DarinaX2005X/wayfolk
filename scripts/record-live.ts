/**
 * Live runs against the real model, through the same proxy the deployment runs
 * (api/_lib/llm/route.ts with LLM_PROVIDER=openrouter and the key of .env.local, which is
 * never printed). Each call's cost comes from the provider's `usage.cost` and is added to
 * a spend ledger outside the repository; the script refuses to start once the ledger is
 * over its limit.
 *
 *   npm run record -- <sample>              record a sample once: the full run with the
 *                                           planted mistakes, then its ready redo; writes
 *                                           content/answers/<sample>.live.json
 *   npm run record -- --task "<goal>" [--file <path>]...   a fresh live task, printed
 *   npm run record -- --redo <sample>       record only the ready redo again, on top of the
 *                                           recorded full run (replayed, no cost)
 *   npm run record -- --spend               the ledger
 *   npm run record -- --replay [<sample>]   each sample from its recording at pace 0, every
 *                                           check run now: stations, counts, caught mistakes
 *
 * Environment: LLM_MODEL (default below), SPEND_LEDGER, SPEND_LIMIT_USD (default 1.50).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlmRoutes } from '../api/_lib/llm/route';
import { memoryLocks } from '../src/agents/locks';
import { memoryRunStore } from '../src/agents/store';
import { newTaskProject, redoStep, startTask } from '../src/agents/engine/start';
import { materialHash } from '../src/materials/normalize';
import { readFile } from '../src/materials/read';
import { numberPages } from '../src/materials/pages';
import type { AnswerSet, Doc, LlmClient, RunDeps, RunEvent, RunRecord, SampleId, TaskResult } from '../src/agents/types';
import { SAMPLE_TODAY, sampleDocs, sampleProject } from '../content/samples';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MODEL = process.env.LLM_MODEL || 'deepseek/deepseek-v4.1-flash';
const LEDGER = process.env.SPEND_LEDGER || path.resolve(ROOT, '..', '.groundwork-spend.json');
const LIMIT = Number(process.env.SPEND_LIMIT_USD || 1.5);
export const TODAY = SAMPLE_TODAY;

/** Ready redos recorded with each sample: they work offline. */
export const READY_REDOS: Record<SampleId, { kind: string; preset: string; instruction: string }> = {
  'bakery-site': { kind: 'write-code', preset: 'warmer', instruction: 'Make it feel warmer: add a short welcome line under the bakery name and softer, rounder cards for the menu.' },
  'habit-tracker': { kind: 'write-code', preset: 'dark', instruction: 'Add a light and dark theme switch, and remember the choice.' },
  'launch-plan': { kind: 'make-plan', preset: 'longer-beta', instruction: 'Give the beta one more week, and move what depends on it.' },
};

type Ledger = { total: number; entries: { at: string; what: string; model: string; calls: number; usd: number }[] };

function readLedger(): Ledger {
  return existsSync(LEDGER) ? (JSON.parse(readFileSync(LEDGER, 'utf8')) as Ledger) : { total: 0, entries: [] };
}

function addSpend(what: string, calls: number, usd: number): Ledger {
  const l = readLedger();
  l.entries.push({ at: new Date().toISOString(), what, model: MODEL, calls, usd: Math.round(usd * 1e6) / 1e6 });
  l.total = Math.round(l.entries.reduce((n, e) => n + e.usd, 0) * 1e6) / 1e6;
  writeFileSync(LEDGER, JSON.stringify(l, null, 2));
  return l;
}

function loadKey(): string {
  const file = path.join(ROOT, '.env.local');
  const line = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('OPENROUTER_API_KEY='));
  const key = line ? line.slice('OPENROUTER_API_KEY='.length).trim().replace(/^"|"$/g, '') : '';
  if (!key) throw new Error('No OPENROUTER_API_KEY in .env.local');
  return key;
}

/** A model client over the proxy's own handler, with the cost of every call counted. */
export function liveClient(): LlmClient & { spent(): number; calls(): number } {
  const key = loadKey();
  let usd = 0;
  let calls = 0;
  const env = { ...process.env, LLM_PROVIDER: 'openrouter', LLM_MODEL: MODEL, OPENROUTER_API_KEY: key, STORAGE_DRIVER: 'memory', LLM_DEV_TOKEN: 'local-recording', LLM_RUN_CALLS: '80' };
  const routes = createLlmRoutes({
    env: () => env,
    deadlineMs: 240_000,
    log: (line) => {
      if (typeof line.usd === 'number') usd += line.usd;
      if (line.task) {
        calls++;
        const status = line.status === 200 ? '' : ` status ${String(line.status)}${line.problem ? ` (${String(line.problem)})` : ''}`;
        console.log(`  call ${String(line.task).padEnd(7)} ${String(line.ms).padStart(6)} ms  $${(Number(line.usd) || 0).toFixed(6)}${status}`);
      }
    },
  });
  return {
    spent: () => usd,
    calls: () => calls,
    async status() {
      return { live: true, provider: 'openrouter', model: MODEL, audio: false, callsLeftToday: 99, runsLeftToday: 9 };
    },
    async call(req, opts) {
      const { payload: _p, redo: _r, ...body } = req;
      void _p;
      void _r;
      const started = Date.now();
      const res = await routes.POST(
        new Request('http://localhost/api/llm', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-dev-token': 'local-recording', 'x-dev-budget': 'recordings' },
          body: JSON.stringify(body),
          signal: opts?.signal,
        }),
      );
      const value = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw { kind: 'http', status: res.status, code: value.error, body: value };
      return { json: value.json, provider: 'openrouter', model: String(value.model ?? MODEL), ms: Number(value.ms ?? Date.now() - started) };
    },
  };
}

function runDeps(llm: LlmClient): RunDeps {
  return { llm, store: memoryRunStore(), now: () => performance.now(), locks: memoryLocks() };
}

export function printRun(record: RunRecord, title: string): void {
  const result = record.result as TaskResult | null;
  const plan = record.events.find((e): e is Extract<RunEvent, { type: 'plan' }> => e.type === 'plan');
  console.log(`\n== ${title}: ${record.status}`);
  if (plan) {
    console.log(`   "${plan.title}" -> ${plan.deliverable}, object ${plan.object}`);
    console.log(`   stations: ${plan.stations.map((s) => `${s.id} ${s.label} (${s.step})`).join(' | ')}`);
  }
  if (!result) return;
  const s = result.stats;
  console.log(`   calls ${Object.entries(s.calls).map(([k, v]) => `${k} ${v}`).join(', ')}; model ${Math.round(s.modelMs / 1000)} s; checks ${s.checkMs} ms; tiles ${s.tiles}`);
  console.log(`   units ${s.units} = matched ${s.matched} + corrected ${s.corrected} + merged ${s.merged} + sent back ${s.sentBack} (fixed ${s.fixed}, dropped ${s.dropped}); kept ${s.kept}: checked ${s.checked}, agent ${s.agentOnly}`);
  console.log(`   planted mistakes ${s.planted}, caught ${s.caught}`);
  for (const e of record.events) {
    if (e.type === 'item' && e.item.status !== 'accepted') console.log(`     ${e.station} ${e.item.status.padEnd(9)} ${e.item.unitId ?? e.item.id}${e.item.planted ? ' [planted]' : ''}: ${(e.item.problems ?? [e.item.reason ?? '']).join(' / ').slice(0, 160)}`);
    if (e.type === 'error') console.log(`     ${e.station} ERROR ${e.code}`);
    if (e.type === 'note' && e.source !== 'Run') console.log(`     note ${e.station}: ${e.text.slice(0, 160)}`);
  }
  const d = result.deliverable;
  if (d?.kind === 'site') console.log(`   site: ${d.files.map((f) => `${f.path} ${f.bytes} B${f.ok ? '' : ' (problems)'}`).join(', ')}; load ok ${d.load.ok}; required ${d.load.required.filter((r) => r.found).length}/${d.load.required.length}`);
  if (d?.kind === 'document') console.log(`   document: ${d.sections.map((x) => x.heading).join(' | ')}`);
  if (d?.kind === 'plan') console.log(`   plan: ${d.items.length} items, ${d.window?.from} to ${d.window?.to}, totals ${d.totals.map((t) => `${t.column} ${t.value}${t.ok ? '' : ` (stated ${t.stated})`}`).join('; ')}`);
}

function guard(): void {
  const l = readLedger();
  if (l.total >= LIMIT) throw new Error(`The spend ledger is at $${l.total.toFixed(4)}, over the limit of $${LIMIT}. Not starting.`);
  console.log(`Ledger so far: $${l.total.toFixed(4)} of $${LIMIT}. Model: ${MODEL}`);
}

async function recordSample(id: SampleId): Promise<void> {
  guard();
  const docs = await sampleDocs(id);
  const llm = liveClient();
  const project = sampleProject(id);
  const h = await startTask(project, docs, runDeps(llm), { today: TODAY, plant: true, pace: 0 });
  const record = await h.done;
  printRun(record, `${id} (recording)`);
  const set: AnswerSet = {
    example: id,
    scope: 'full',
    answers: 'recorded',
    recordedAt: new Date().toISOString().slice(0, 10),
    model: MODEL,
    seeded: 0,
    materialHash: await materialHash(docs.flatMap((d) => d.pages)),
    calls: record.calls.map((c) => ({ ...c })),
    redos: [],
  };
  const result = record.result as TaskResult | null;
  const ready = READY_REDOS[id];
  const step = result?.plan.steps.find((s) => s.kind === ready.kind);
  if (record.status === 'ready' && result && step) {
    const h2 = await redoStep(project, result, step.id, ready.instruction, docs, runDeps(llm), { today: TODAY, preset: ready.preset, pace: 0 });
    const r2 = await h2.done;
    printRun(r2, `${id} redo ${step.id} "${ready.preset}"`);
    if (r2.status === 'ready') {
      set.calls.push(...r2.calls);
      set.redos = [{ stepId: step.id, preset: ready.preset, instruction: ready.instruction }];
    }
  }
  const out = path.join(ROOT, 'content', 'answers', `${id}.live.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(set, null, 1) + '\n');
  const l = addSpend(`record ${id}`, llm.calls(), llm.spent());
  console.log(`\nWrote ${path.relative(ROOT, out)}. This recording: ${llm.calls()} calls, $${llm.spent().toFixed(6)}. Ledger: $${l.total.toFixed(6)}.`);
}

/** Records only the ready redo again, on top of the recorded full run (replayed, no cost). */
async function recordRedo(id: SampleId): Promise<void> {
  guard();
  const { runSample } = await import('../content/answers/run');
  const file = path.join(ROOT, 'content', 'answers', `${id}.live.json`);
  const set = JSON.parse(readFileSync(file, 'utf8')) as AnswerSet;
  const first = await runSample(id, set, { pace: 0 });
  const result = first.result as TaskResult | null;
  const ready = READY_REDOS[id];
  const step = result?.plan.steps.find((s) => s.kind === ready.kind);
  if (first.status !== 'ready' || !result || !step) throw new Error(`${id}: the recorded run ended ${first.status}`);
  const llm = liveClient();
  const h = await redoStep(sampleProject(id), result, step.id, ready.instruction, await sampleDocs(id), runDeps(llm), { today: TODAY, preset: ready.preset, pace: 0 });
  const r2 = await h.done;
  printRun(r2, `${id} redo ${step.id} "${ready.preset}"`);
  const l = addSpend(`record redo ${id}`, llm.calls(), llm.spent());
  if (r2.status !== 'ready') throw new Error(`${id}: the redo ended ${r2.status}; the set is unchanged`);
  set.calls = [...set.calls.filter((c) => !c.redo), ...r2.calls];
  set.redos = [{ stepId: step.id, preset: ready.preset, instruction: ready.instruction }];
  writeFileSync(file, JSON.stringify(set, null, 1) + '\n');
  console.log(`\nWrote ${path.relative(ROOT, file)}. This redo: ${llm.calls()} calls, $${llm.spent().toFixed(6)}. Ledger: $${l.total.toFixed(6)}.`);
}

async function liveTask(goal: string, files: string[]): Promise<void> {
  guard();
  const docs: Doc[] = [];
  for (const f of files) docs.push(await readFile(new Blob([readFileSync(f)]), path.basename(f)));
  const llm = liveClient();
  const project = newTaskProject({ text: goal, by: 'typed', links: [] });
  const h = await startTask(project, numberPages(docs).docs, runDeps(llm), { today: TODAY });
  const record = await h.done;
  printRun(record, 'live task');
  const result = record.result as TaskResult | null;
  if (result?.deliverable?.kind === 'document') for (const s of result.deliverable.sections) console.log(`\n## ${s.heading}\n${s.text}\nSources: ${s.sources.join(' | ')}`);
  const outDir = process.env.LIVE_OUT;
  if (outDir) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'live-task.json'), JSON.stringify({ record }, null, 1));
  }
  const l = addSpend(`live task: ${goal.slice(0, 60)}`, llm.calls(), llm.spent());
  console.log(`\nThis run: ${llm.calls()} calls, $${llm.spent().toFixed(6)}. Ledger: $${l.total.toFixed(6)}.`);
}

async function replay(ids: SampleId[]): Promise<void> {
  const { answersFor } = await import('../content/answers');
  const { runSample, runSampleRedo } = await import('../content/answers/run');
  for (const id of ids) {
    const set = await answersFor(id);
    const t0 = performance.now();
    const record = await runSample(id, set, { pace: 0 });
    printRun(record, `${id} (replay, pace 0, ${Math.round(performance.now() - t0)} ms)`);
    const result = record.result as TaskResult | null;
    if (result) {
      const r2 = await runSampleRedo(id, set, result, { pace: 0 });
      if (r2) printRun(r2, `${id} ready redo "${set.redos?.[0]?.preset}"`);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--');
  if (args[0] === '--spend') {
    console.log(JSON.stringify(readLedger(), null, 2));
    return;
  }
  if (args[0] === '--replay') return replay(args[1] ? [args[1] as SampleId] : (['bakery-site', 'habit-tracker', 'launch-plan'] as SampleId[]));
  if (args[0] === '--redo') return recordRedo(args[1] as SampleId);
  if (args[0] === '--task') {
    const files: string[] = [];
    for (let i = 2; i < args.length; i++) if (args[i] === '--file') files.push(args[++i]);
    return liveTask(args[1], files);
  }
  const id = args[0] as SampleId;
  if (!['bakery-site', 'habit-tracker', 'launch-plan'].includes(id)) throw new Error('usage: npm run record -- <bakery-site|habit-tracker|launch-plan> | --task "<goal>" [--file <path>] | --spend');
  return recordSample(id);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
