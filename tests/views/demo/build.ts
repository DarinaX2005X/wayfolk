/**
 * Records the written answers of the three samples as AnswerSets the app replays through
 * the real engine (every check runs in the browser), plus a saved event stream of each
 * full run for the emergency replay. Run after the engine changes:
 *
 *   npx tsx tests/views/demo/build.ts
 *
 * Writes src/views/run/demo/<sample>.answers.json and <sample>.events.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryLocks } from '../../../src/agents/locks';
import { memoryRunStore } from '../../../src/agents/store';
import { resetRunsForTests } from '../../../src/agents/runner';
import { newTaskProject, redoStep, startTask } from '../../../src/agents/engine/start';
import { materialHash } from '../../../src/materials/normalize';
import type { AnswerSet, CallRecord, LlmClient, LlmRequest, RunEvent, SampleId, TaskResult } from '../../../src/agents/types';
import { sampleDocs, sampleMeta } from '../../../content/samples';
import * as B from './bakery';
import * as O from './others';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = path.join(ROOT, 'src/views/run/demo');
export const TODAY = '2026-11-16';

/** The redo presets of the step card, as the person sees them. */
export const PRESETS = [
  { preset: 'shorter', instruction: 'Make it shorter' },
  { preset: 'style', instruction: 'Different style' },
  { preset: 'again', instruction: 'Try again' },
] as const;

function shape(req: LlmRequest): string {
  const keys = req.schema.required ?? [];
  if (keys.includes('steps')) return 'plan';
  if (keys.includes('fixes')) return 'fix';
  if (keys.includes('facts')) return 'facts';
  if (keys.includes('content')) return 'file';
  if (keys.includes('items')) return 'items';
  if (keys.includes('sections')) return 'sections';
  if (keys.includes('issues')) return 'review';
  if (keys.includes('choice')) return 'decision';
  return 'unknown';
}

const userText = (req: LlmRequest): string => req.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
const redoOf = (user: string): string | null => /asks you to redo it: "([^"]+)"/.exec(user)?.[1] ?? null;

/** Seconds a call of this kind takes, roughly what the recorded model took. */
const MS: Record<string, number> = { plan: 3400, facts: 4200, sections: 5200, file: 6100, fix: 2600, review: 3800, decision: 3000, items: 5600 };

function bakery(req: LlmRequest, user: string): unknown {
  const s = shape(req);
  const redo = redoOf(user);
  if (s === 'plan') return B.BAKERY_PLAN;
  if (s === 'facts') return { facts: redo === 'Make it shorter' ? B.BAKERY_FACTS_SHORT : B.BAKERY_FACTS };
  if (s === 'sections') return { sections: (redo === 'Make it shorter' ? B.BAKERY_SECTIONS_SHORT : redo === 'Different style' ? B.BAKERY_SECTIONS_STYLE : B.BAKERY_SECTIONS).map((x) => ({ ...x, from: [] })) };
  if (s === 'file') {
    const short = redo === 'Make it shorter' || /Baked on site from 4 am/.test(user);
    const style = redo === 'Different style' || /Good morning from the corner/.test(user);
    if (user.includes('Write the file index.html')) {
      // First answer forgets the cake orders part the plan asked for.
      const first = !redo && !user.includes('Make it') && !user.includes('Different') && !user.includes('Try again');
      return { content: B.bakeryHtml({ order: !first, short, style }), summary: 'The one page: hours, menu, the story, cakes, contact' };
    }
    return { content: B.bakeryCss({ style }), summary: 'Cream and dark brown, readable on a phone' };
  }
  if (s === 'fix') {
    if (user.includes('--- index.html ---')) {
      const short = /Baked on site from 4 am/.test(user);
      const style = /Good morning from the corner/.test(user);
      return { fixes: [{ id: 'index.html', action: 'fix', unit: { content: B.bakeryHtml({ short, style }) } }] };
    }
    const ids = [...user.matchAll(/--- (s\d+\.[\w.-]+) ---\nProblems found by code:\n([\s\S]*?)What you gave:\n([^\n]*)/g)];
    return {
      fixes: ids.map((m) => {
        const gave = m[3];
        const fix = /latte/i.test(gave) ? B.BAKERY_FACT_FIXES.latte : /baked/i.test(gave) ? B.BAKERY_FACT_FIXES.baked : null;
        return fix ? { id: m[1], action: 'fix', unit: fix } : { id: m[1], action: 'withdraw', unit: { claim: '', quote: '', page: 1 } };
      }),
    };
  }
  if (s === 'review') return B.BAKERY_REVIEW;
  throw new Error(`bakery: unexpected ${s}`);
}

function habit(req: LlmRequest, user: string): unknown {
  const s = shape(req);
  const redo = redoOf(user);
  if (s === 'plan') return O.HABIT_PLAN;
  if (s === 'decision') return O.HABIT_DECISION;
  if (s === 'file') {
    if (user.includes('Write the file index.html')) return { content: O.HABIT_HTML, summary: 'The app page' };
    if (user.includes('Write the file styles.css')) return { content: O.HABIT_CSS, summary: 'A calm look that works on a phone' };
    return { content: redo ? O.HABIT_JS : O.HABIT_JS_BROKEN, summary: 'Habits, ticks, streaks, local storage' };
  }
  if (s === 'fix') return { fixes: [{ id: 'app.js', action: 'fix', unit: { content: O.HABIT_JS } }] };
  if (s === 'review') return O.HABIT_REVIEW;
  throw new Error(`habit: unexpected ${s}`);
}

function launch(req: LlmRequest, user: string): unknown {
  const s = shape(req);
  const redo = redoOf(user);
  if (s === 'plan') return O.LAUNCH_PLAN;
  if (s === 'facts') return { facts: O.LAUNCH_FACTS };
  if (s === 'items') {
    const items = redo === 'Make it shorter' ? O.LAUNCH_ITEMS.filter((i) => !['i6', 'i12'].includes(i.id)).map((i) => ({ ...i, depends: i.depends.filter((d) => d !== 'i6' && d !== 'i12') })) : O.LAUNCH_ITEMS;
    return { items, totals: O.LAUNCH_TOTALS };
  }
  if (s === 'fix') {
    const ids = [...user.matchAll(/--- (s\d+\.[\w.-]+) ---/g)].map((m) => m[1]);
    return { fixes: ids.map((id) => ({ id, action: 'fix', unit: O.LAUNCH_FACT_FIX })) };
  }
  if (s === 'review') return O.LAUNCH_REVIEW;
  throw new Error(`launch: unexpected ${s}`);
}

const MODELS: Record<SampleId, (req: LlmRequest, user: string) => unknown> = { 'bakery-site': bakery, 'habit-tracker': habit, 'launch-plan': launch };

function writtenModel(sample: SampleId): LlmClient {
  const answer = MODELS[sample];
  let n = 0;
  return {
    async status() {
      return { live: false, provider: 'fixtures', model: 'written answers', audio: false, callsLeftToday: 0, runsLeftToday: 0 };
    },
    async call(req) {
      const json = answer(req, userText(req));
      const s = shape(req);
      // A little spread so parallel calls don't end on the same frame.
      const ms = Math.round((MS[s] ?? 3000) * (0.85 + ((n++ * 37) % 30) / 100));
      return { json: structuredClone(json), provider: 'script', model: 'written answers', ms };
    },
  };
}

const instant = { set: (fn: () => void) => setTimeout(fn, 0) as unknown as number, clear: (id: number) => clearTimeout(id as unknown as ReturnType<typeof setTimeout>) };

async function record(sample: SampleId): Promise<void> {
  resetRunsForTests();
  const meta = sampleMeta(sample);
  const docs = await sampleDocs(sample);
  const hash = await materialHash(docs.flatMap((d) => d.pages));
  let t = 0;
  const deps = { llm: writtenModel(sample), store: memoryRunStore(), now: () => (t += 1), locks: memoryLocks(), timers: instant };
  const project = newTaskProject({ text: meta.task, by: 'sample', links: [] }, { sample, title: meta.title, id: `p_demo${sample.replace(/-/g, '')}`.slice(0, 14) });
  const h = await startTask(project, docs, deps, { today: TODAY });
  const full = await h.done;
  if (full.status !== 'ready') throw new Error(`${sample}: run ended ${full.status}: ${full.events.filter((e) => e.type === 'error' || e.type === 'note').map((e) => JSON.stringify(e)).join('\n')}`);
  const result = full.result as TaskResult;
  const calls: CallRecord[] = full.calls.map((c) => ({ ...c, provider: 'script', model: 'written answers' }));
  const redos: AnswerSet['redos'] = [];
  const redoable = result.plan.steps.filter((s) => ['research', 'write-section', 'write-code', 'make-plan'].includes(s.kind));
  for (const s of redoable) {
    for (const p of PRESETS) {
      resetRunsForTests();
      const rh = await redoStep({ ...project, result }, result, s.id, p.instruction, docs, { ...deps, store: memoryRunStore() }, { preset: p.preset, today: TODAY });
      const rr = await rh.done;
      if (rr.status !== 'ready') {
        console.warn(`${sample}: redo ${s.id}:${p.preset} ended ${rr.status}; left out`);
        continue;
      }
      redos.push({ stepId: s.id, preset: p.preset, instruction: p.instruction });
      for (const c of rr.calls) calls.push({ ...c, provider: 'script', model: 'written answers', redo: c.redo ?? `${s.id}:${p.preset}` });
    }
  }
  const set: AnswerSet = { example: sample, scope: 'full', answers: 'scripted', recordedAt: TODAY, model: 'written answers', materialHash: hash, redos, calls };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${sample}.answers.json`), JSON.stringify(set));
  const events: RunEvent[] = full.events;
  writeFileSync(path.join(OUT, `${sample}.events.json`), JSON.stringify({ events, result }));
  const kinds = new Map<string, number>();
  for (const e of events) kinds.set(e.type, (kinds.get(e.type) ?? 0) + 1);
  console.log(`${sample}: ${result.plan.steps.length} steps (${result.plan.steps.map((s) => s.title).join(', ')}), ${calls.length} calls, ${redos.length} redos, tiles ${result.stats.tiles}, sent back ${result.stats.sentBack}, deliverable ${result.deliverable?.kind}`);
  console.log('  events', Object.fromEntries(kinds));
}

for (const id of (process.argv.slice(2).length ? process.argv.slice(2) : ['bakery-site', 'habit-tracker', 'launch-plan']) as SampleId[]) {
  await record(id);
}
