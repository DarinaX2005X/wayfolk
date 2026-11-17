/**
 * Records real model output once for the prepared set (content/travelers.json,
 * content/lines.json, content/islands.json). The raw answers go to a folder outside the
 * repository and are edited by hand before they become content; nothing here runs in the
 * app. Every call goes through the project's OpenRouter adapter with the same prompts and
 * schemas the app uses, and its `usage.cost` is added to a ledger that refuses to go past
 * the recording budget.
 *
 *   npx tsx content/tools/record.ts travelers <out.json> [model]
 *   npx tsx content/tools/record.ts lines <out.json> [model]
 *   npx tsx content/tools/record.ts probe [model]
 *
 * The key comes from .env.local (OPENROUTER_API_KEY) and is never printed.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatMessage, JsonSchema, LlmTask } from '../../api/_lib/contracts';
import { createOpenRouter } from '../../api/_lib/llm/openrouter';
import { parseModelJson, validate } from '../../api/_lib/llm/schema';
import { travelerMessages } from '../../src/mind/prompts';
import { TRAVELER_SCHEMA, travelerFromModel, type TravelerAsk } from '../../src/mind/schema';
import { SPECIES, TRADES, VEHICLES, type IslandState, type Species, type Trade } from '../../src/mind/types';
import { STYLE, WORLD } from '../../src/mind/prompts';
import { TRADE_WORDS } from '../../src/mind/words';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LEDGER = process.env.SPEND_LEDGER || path.resolve(ROOT, '..', 'archive', 'mind-rec', 'spend.json');
const LIMIT = 1.5;
const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5';

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

export async function call(what: string, model: string, task: LlmTask, messages: ChatMessage[], schema: JsonSchema, audio?: string, maxTokens = 1500) {
  const before = ledger();
  if (before.total >= LIMIT) throw new Error(`recording budget spent: ${before.total.toFixed(4)} USD`);
  const started = Date.now();
  const outcome = await adapter({ body: { task, index: 0, attempt: 0, messages, schema, audio, maxTokens }, model, fallbacks: [], signal: AbortSignal.timeout(60_000) });
  const ms = Date.now() - started;
  const usd = outcome.ok ? (outcome.usage.costUsd ?? 0) : (outcome.usage?.costUsd ?? 0);
  const after = ledger();
  after.total = Math.round((after.total + usd) * 1e7) / 1e7;
  after.calls += 1;
  after.entries.push({ at: new Date().toISOString(), what, model, usd, ms });
  writeFileSync(LEDGER, JSON.stringify(after, null, 1));
  if (!outcome.ok) return { ok: false as const, problem: outcome.kind, ms, usd };
  const value = parseModelJson(outcome.text ?? '');
  if (value === undefined) {
    writeFileSync(path.join(path.dirname(LEDGER), `fail-${Date.now()}.txt`), outcome.text ?? '');
    return { ok: false as const, problem: 'not JSON', ms, usd, text: outcome.text };
  }
  const problem = value === undefined ? 'not JSON' : validate(value, schema);
  return problem ? { ok: false as const, problem, ms, usd, text: outcome.text } : { ok: true as const, value, ms, usd };
}

const emptyIsland = (name: string): IslandState => ({
  id: 'rec', name, seed: 1, visibility: 'private', radius: 12, residents: [], houses: [], paths: [], props: [], events: [], createdAt: 0, lastVisit: 0,
});

/** 40 combinations: every trade three or four times, every species three or four times, vehicles spread. */
function plan(count: number): Omit<TravelerAsk, 'avoidNames'>[] {
  const out: Omit<TravelerAsk, 'avoidNames'>[] = [];
  const species = [...SPECIES];
  for (let i = 0; i < count; i += 1) {
    const trade = TRADES[i % TRADES.length] as Trade;
    const sp = species[(i * 5 + Math.floor(i / 12)) % species.length] as Species;
    out.push({ trade, species: sp, vehicle: VEHICLES[(i * 7 + 3) % VEHICLES.length] });
  }
  return out;
}

async function travelers(outFile: string, model: string, count: number) {
  const offset = Number(process.env.OFFSET || 0);
  const asks = process.env.PLAN
    ? process.env.PLAN.split(',').map((x) => {
        const [trade, species, vehicle] = x.split('/');
        return { trade: trade as Trade, species: species as Species, vehicle: vehicle as TravelerAsk['vehicle'] };
      })
    : plan(offset + count).slice(offset);
  const previous: { resident: { name: string } }[] = process.env.AVOID_FROM ? JSON.parse(readFileSync(process.env.AVOID_FROM, 'utf8')) : [];
  const names: string[] = previous.map((p) => p.resident.name);
  const results: unknown[] = [];
  const islands = ['Puddlewick', 'Lowtide Rock', 'Saltloaf', 'Brindle Isle'];
  for (let i = 0; i < asks.length; i += 4) {
    const batch = asks.slice(i, i + 4);
    const done = await Promise.all(
      batch.map(async (a, j) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const ask: TravelerAsk = { ...a, avoidNames: [...names] };
          const r = await call(`traveler ${a.trade}/${a.species}`, model, 'traveler', travelerMessages(ask, emptyIsland(islands[(i + j) % 4]), Date.UTC(2026, 10, 17, 17)), TRAVELER_SCHEMA);
          if (!r.ok) {
            console.log(`  ${a.trade}/${a.species}: ${r.problem} ${'text' in r ? JSON.stringify(String(r.text).slice(-160)) : ''}`);
            continue;
          }
          const resident = travelerFromModel(r.value, ask, `p-${a.trade}-${a.species}`, 0);
          if (typeof resident === 'string') {
            console.log(`  ${a.trade}/${a.species}: check: ${resident}`);
            continue;
          }
          console.log(`  ${resident.name} the ${a.species} ${a.trade} (${r.ms} ms, $${r.usd.toFixed(5)})`);
          return { resident, raw: r.value, ms: r.ms };
        }
        return null;
      }),
    );
    for (const d of done) {
      if (!d) continue;
      names.push(d.resident.name);
      results.push(d);
    }
    writeFileSync(outFile, JSON.stringify(results, null, 1));
  }
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  console.log(`${results.length} travelers -> ${outFile}; spent so far ${ledger().total.toFixed(4)} USD`);
}

const list = (min: number, max: number, description: string): JsonSchema => ({ type: 'array', description: min === max ? `exactly ${min}` : `${min} to ${max}`, items: { type: 'string', description } });
const LINES_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['greet', 'chat', 'stay', 'leave', 'giftLove', 'giftLike', 'hint', 'news', 'tripStory'],
  properties: {
    greet: list(3, 3, 'hello to a neighbor at the start of a talk, first person'),
    chat: list(4, 4, 'small talk about their trade today, first person'),
    stay: list(3, 3, 'answer when invited to live on the island: yes, and where could the house go'),
    leave: list(3, 3, 'friendly goodbye'),
    giftLove: list(3, 3, 'reaction to a gift they love, say where it will go in the house'),
    giftLike: list(3, 3, 'kind reaction to a gift that is not their favorite'),
    hint: list(3, 3, 'gentle hint that they have a secret, not telling it yet'),
    news: list(4, 4, 'third person news Pip tells about them, must contain {name}'),
    tripStory: list(3, 3, 'first person, back from visiting another island, must contain {island}'),
  },
};

async function lines(outFile: string, model: string) {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < TRADES.length; i += 4) {
    const batch = TRADES.slice(i, i + 4);
    await Promise.all(
      batch.map(async (trade) => {
        const t = TRADE_WORDS[trade];
        const messages: ChatMessage[] = [
          {
            role: 'system',
            content: `${WORLD}\n\n${STYLE}\n\nWrite short spoken lines for any resident who is a ${t.person} and lives in a ${t.place}. Each line one or two short sentences, under 25 words, works for any animal and any name. Answer only with JSON in the given schema.`,
          },
          { role: 'user', content: `Trade: ${t.person}. Place: ${t.place}. Work: ${t.work}.` },
        ];
        const r = await call(`lines ${trade}`, model, 'talk', messages, LINES_SCHEMA);
        if (r.ok) out[trade] = r.value;
        console.log(`  ${trade}: ${r.ok ? 'ok' : r.problem} (${r.ms} ms)`);
      }),
    );
  }
  writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(`lines -> ${outFile}; spent so far ${ledger().total.toFixed(4)} USD`);
}

const [mode, a, b] = process.argv.slice(2);
if (mode === 'travelers') await travelers(a, b || DEFAULT_MODEL, Number(process.env.COUNT || 40));
else if (mode === 'lines') await lines(a, b || DEFAULT_MODEL);
else if (mode === 'probe') {
  const model = a || DEFAULT_MODEL;
  const ask: TravelerAsk = { species: 'hedgehog', trade: 'tea-maker', vehicle: 'umbrella', avoidNames: [] };
  const r = await call('probe traveler', model, 'traveler', travelerMessages(ask, emptyIsland('Puddlewick'), Date.UTC(2026, 10, 17, 17)), TRAVELER_SCHEMA);
  console.log(JSON.stringify(r, null, 1));
  if (r.ok) console.log(travelerFromModel(r.value, ask, 'x', 0));
} else console.log('usage: record.ts travelers|lines|probe ...');
