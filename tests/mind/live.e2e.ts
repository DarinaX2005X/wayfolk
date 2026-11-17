/**
 * One live end-to-end check against the real model, through the real proxy route and
 * the real mind (not part of `npm test`; it spends money):
 *
 *   npx tsx tests/mind/live.e2e.ts <clip.wav> [<clip2.wav>]
 *
 * It generates one traveler, talks to them with a recorded voice clip and with a touch
 * reply, gives a gift and asks for news while away. It prints the time to every answer
 * and the cost the provider reported (`usage.cost`). The key comes from .env.local and
 * is never printed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryKv } from '../../api/_lib/kv';
import { createLlmRoutes } from '../../api/_lib/llm/route';
import { createMind } from '../../src/mind/index';
import { createModelClient } from '../../src/mind/llm';
import { memoryStore } from '../../src/mind/store';
import { islandsServer } from './helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = readFileSync(path.join(ROOT, '.env.local'), 'utf8');
const key = envFile.split(/\r?\n/).find((l) => l.startsWith('OPENROUTER_API_KEY='))?.slice(19).trim().replace(/^"|"$/g, '') ?? '';
if (!key) throw new Error('no OPENROUTER_API_KEY in .env.local');

const env = {
  LLM_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: key,
  LLM_MODEL: process.env.LLM_MODEL ?? 'google/gemini-3.1-flash-lite',
  LLM_MODEL_TRAVELER: process.env.LLM_MODEL_TRAVELER ?? 'anthropic/claude-haiku-5.5',
  LLM_MODEL_EVENTS: process.env.LLM_MODEL_EVENTS ?? 'anthropic/claude-haiku-5.5',
  LLM_AUDIO_MODEL: process.env.LLM_AUDIO_MODEL ?? 'google/gemini-3.1-flash-lite',
  LLM_PROVIDER_SORT: 'latency',
  LLM_INSTANCE_COUNTERS: '1',
};

const costs: { task: string; model: string; usd: number; ms: number; status: number }[] = [];
const kv = createMemoryKv({ shared: false });
const llm = createLlmRoutes({ env: () => env, kv: () => kv, log: (line) => line.task && costs.push({ task: String(line.task), model: String(line.model), usd: Number(line.usd ?? 0), ms: Number(line.ms), status: Number(line.status) }) });
const islands = islandsServer(Date.now);

const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input), 'http://live.local');
  if (url.pathname === '/api/llm') {
    const request = new Request(url, { method: init?.method ?? 'GET', headers: { ...(init?.headers as Record<string, string>), 'x-real-ip': '127.0.0.1' }, body: init?.body });
    return request.method === 'POST' ? llm.POST(request) : llm.GET(request);
  }
  return islands.fetch(input, init);
}) as typeof fetch;

const runId = `live-${Date.now().toString(36)}`;
const model = createModelClient({ api: '', runId, fetch: fetchFn, now: Date.now });
const mind = createMind({ fetch: fetchFn, model, store: memoryStore() });
const wav = (file: string) => readFileSync(file).toString('base64');
const clips = process.argv.slice(2);

const t0 = Date.now();
await mind.load();
const first = await mind.nextTraveler();
console.log(`first traveler (prepared): ${first.name} the ${first.species} ${first.trade}`);
await mind.settle(first, { id: 'h-1', residentId: first.id, recipe: first.trade, pos: { x: 4, z: -2 }, rotY: 0, colors: first.house!.colors, props: [], sign: first.house!.sign, builtAt: 0 });

let started = Date.now();
const traveler = await mind.nextTraveler();
console.log(`\nlive traveler in ${Date.now() - started} ms, prepared=${traveler.prepared === true}`);
console.log(JSON.stringify({ name: traveler.name, species: traveler.species, trade: traveler.trade, vehicle: traveler.vehicle, tagline: traveler.tagline, personality: traveler.personality, intro: traveler.story.intro, beats: traveler.story.beats, secret: traveler.story.secret, likes: traveler.likes, house: traveler.house }, null, 1));

const hello = mind.greet(traveler.id);
console.log(`\ngreet (no call): ${hello.text}\n  choices: ${hello.choices.join(' | ')}`);
for (const clip of clips) {
  started = Date.now();
  const r = await mind.talk(traveler.id, { audio: wav(clip) });
  console.log(`\naudio turn (${path.basename(clip)}) in ${Date.now() - started} ms, prepared=${r.prepared === true}\n  heard: ${r.heard}\n  ${traveler.name}: ${r.text}\n  intent: ${r.intent}; choices: ${r.choices.join(' | ')}`);
}
started = Date.now();
const touch = await mind.talk(traveler.id, { text: hello.choices[0] });
console.log(`\ntouch turn in ${Date.now() - started} ms: ${touch.text}\n  intent: ${touch.intent}; choices: ${touch.choices.join(' | ')}`);
started = Date.now();
const stay = await mind.talk(traveler.id, { text: 'Would you like to stay with us?' });
console.log(`\ntyped "stay" in ${Date.now() - started} ms: ${stay.text} (intent ${stay.intent})`);
await mind.settle(traveler, { id: 'h-2', residentId: traveler.id, recipe: traveler.trade, pos: { x: -4, z: -2 }, rotY: 0, colors: traveler.house!.colors, props: [], sign: traveler.house!.sign, builtAt: 0 });
console.log(`memory: ${mind.state.residents[1].memory.map((m) => m.text).join(' / ')}`);

started = Date.now();
const gift = await mind.give(traveler.id, traveler.likes[1] as never);
console.log(`\ngift in ${Date.now() - started} ms: ${gift.text} (prop ${gift.prop}, prepared=${gift.prepared})`);

started = Date.now();
const news = await mind.whileAway(Date.now() + 9 * 3600_000);
console.log(`\nwhile away (9 h) in ${Date.now() - started} ms:`);
for (const e of news) console.log(`  [${e.kind}] ${e.text}${e.effect?.prop ? ` (${e.effect.prop})` : ''}`);

const total = costs.reduce((s, c) => s + c.usd, 0);
console.log(`\ncalls:`);
for (const c of costs) console.log(`  ${c.task} ${c.model} ${c.status} ${c.ms} ms $${c.usd.toFixed(6)}`);
console.log(`total ${total.toFixed(6)} USD, ${Date.now() - t0} ms`);
