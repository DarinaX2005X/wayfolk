/**
 * Records the prepared chapters of the evening of stories once (content/chapters.json):
 * for every prepared traveler, chapters 1..N written by the model with the same prompt and
 * schema the app uses live (src/mind/chapters.ts), each checked by `cleanChapter` against
 * the vocabulary before it is kept. Nothing here runs in the app. Spend goes to the same
 * ledger as content/tools/record.ts and stops at its limit.
 *
 *   npx tsx content/tools/chapters.ts [chaptersPerTraveler=2] [model]
 *
 * The key comes from .env.local (OPENROUTER_API_KEY) and is never printed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOpenRouter } from '../../api/_lib/llm/openrouter';
import { parseModelJson, validate } from '../../api/_lib/llm/schema';
import { CHAPTER_SCHEMA, chapterMessages, cleanChapter } from '../../src/mind/chapters';
import { PREPARED } from '../../src/mind/prepared';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'content', 'chapters.json');
const LEDGER = process.env.SPEND_LEDGER || path.resolve(ROOT, '..', 'archive', 'mind-rec', 'spend.json');
const LIMIT = 1.5;

function key(): string {
  const text = readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const line = text.split(/\r?\n/).find((l) => l.startsWith('OPENROUTER_API_KEY='));
  const value = line?.slice('OPENROUTER_API_KEY='.length).trim().replace(/^"|"$/g, '') ?? '';
  if (!value) throw new Error('OPENROUTER_API_KEY is not in .env.local');
  return value;
}

type Ledger = { total: number; calls: number; entries: { at: string; what: string; model: string; usd: number; ms: number }[] };
const ledger = (): Ledger => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { total: 0, calls: 0, entries: [] });
const adapter = createOpenRouter({ key: key() });

async function write(what: string, model: string, messages: ReturnType<typeof chapterMessages>): Promise<unknown | null> {
  if (ledger().total >= LIMIT) throw new Error('recording budget spent');
  const started = Date.now();
  const outcome = await adapter({ body: { task: 'chapter', index: 0, attempt: 0, messages, schema: CHAPTER_SCHEMA, maxTokens: 2200 }, model, fallbacks: [], signal: AbortSignal.timeout(90_000) });
  const usd = outcome.ok ? (outcome.usage.costUsd ?? 0) : (outcome.usage?.costUsd ?? 0);
  const after = ledger();
  after.total = Math.round((after.total + usd) * 1e7) / 1e7;
  after.calls += 1;
  after.entries.push({ at: new Date().toISOString(), what, model, usd, ms: Date.now() - started });
  writeFileSync(LEDGER, JSON.stringify(after, null, 1));
  if (!outcome.ok) return null;
  const value = parseModelJson(outcome.text ?? '');
  if (value === undefined || validate(value, CHAPTER_SCHEMA)) return null;
  return value;
}

const per = Number(process.argv[2] ?? 2) || 2;
const model = process.argv[3] ?? 'anthropic/claude-haiku-5.5';
const book: Record<string, unknown[]> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};

const jobs: { r: (typeof PREPARED)[number]; n: number }[] = [];
for (const r of PREPARED) for (let n = 1; n <= per; n += 1) if (!book[r.id]?.[n - 1]) jobs.push({ r, n });
console.log(`${jobs.length} chapters to write with ${model}`);

async function one(job: { r: (typeof PREPARED)[number]; n: number }): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await write(`chapter ${job.r.id} ${job.n}`, model, chapterMessages(job.r, job.n, 'the island'));
    const c = raw ? cleanChapter(raw, job.r, job.n, 'prepared') : 'no answer';
    if (typeof c === 'string') {
      console.log(`  ${job.r.id} ${job.n}: ${c}`);
      continue;
    }
    const { title, mood, cast, beats } = c;
    const list = (book[job.r.id] ??= []);
    list[job.n - 1] = { title, mood, cast, beats };
    console.log(`  ${job.r.id} ${job.n}: "${title}", ${beats.length} lines`);
    return;
  }
}

for (let i = 0; i < jobs.length; i += 4) {
  await Promise.all(jobs.slice(i, i + 4).map(one));
  writeFileSync(OUT, `${JSON.stringify(book, null, 1)}\n`);
}
console.log(`spent so far ${ledger().total.toFixed(4)} USD`);
