/**
 * The model proxy as the mind uses it: per-task and audio models, the session and voice
 * limits of the spending guard, the off switch, and the request OpenRouter receives.
 */
import { describe, expect, it } from 'vitest';
import type { LlmCallBody } from '../../api/_lib/contracts';
import { createMemoryKv } from '../../api/_lib/kv';
import { createOpenRouter } from '../../api/_lib/llm/openrouter';
import type { ProviderCall } from '../../api/_lib/llm/provider';
import { createLlmRoutes } from '../../api/_lib/llm/route';
import { REPLY_SCHEMA } from '../../src/mind/schema';
import { clock } from './helpers';

const ENV = {
  LLM_PROVIDER: 'openrouter',
  OPENROUTER_API_KEY: 'sk-or-test',
  LLM_MODEL: 'cheap/text',
  LLM_MODEL_TRAVELER: 'good/writer',
  LLM_AUDIO_MODEL: 'cheap/ears',
  LLM_RUN_CALLS: '5',
  LLM_VOICE_CALLS_PER_ADDRESS: '3',
  LLM_DAILY_RUNS_PER_ADDRESS: '2',
};

const reply = { heard: 'hi', text: 'Hello there.', intent: 'chat', mood: 'happy', choices: ['a', 'b', 'c'], choiceIntents: ['chat', 'stay', 'leave'], toldBeat: false, toldSecret: false, remember: '' };

function setup(env: Record<string, string> = ENV, shared = true) {
  const time = clock();
  const kv = createMemoryKv({ now: time.now, shared });
  const seen: ProviderCall[] = [];
  const routes = createLlmRoutes({
    env: () => env,
    kv: () => kv,
    now: time.now,
    log: () => undefined,
    adapters: { openrouter: () => async (call) => (seen.push(call), { ok: true, text: JSON.stringify(reply), model: call.model, usage: { costUsd: 0.0004 } }) },
  });
  const post = (body: Partial<LlmCallBody>, ip = '10.0.0.1') =>
    routes.POST(
      new Request('https://w.test/api/llm', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-real-ip': ip },
        body: JSON.stringify({ task: 'talk', index: 0, attempt: 0, messages: [{ role: 'user', content: 'hi' }], schema: REPLY_SCHEMA, runId: 'run-a', ...body }),
      }),
    );
  return { routes, post, seen, kv };
}

describe('/api/llm for the mind', () => {
  it('picks the task model, the audio model for voice, and the default otherwise', async () => {
    const { post, seen } = setup();
    expect((await post({ task: 'traveler' })).status).toBe(200);
    expect((await post({ task: 'talk', audio: 'UklGRiQAAABXQVZF' })).status).toBe(200);
    const answer = await post({ task: 'talk', maxTokens: 300 });
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { json: unknown }).json).toEqual(reply);
    expect(seen.map((c) => c.model)).toEqual(['good/writer', 'cheap/ears', 'cheap/text']);
    expect(seen[2].body.maxTokens).toBe(300);
  });

  it('is off without a provider, and says so in its status', async () => {
    const { post, routes } = setup({ ...ENV, LLM_PROVIDER: 'fixtures' });
    const r = await post({});
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ error: 'agents-offline', need: 'key' });
    const status = (await (await routes.GET(new Request('https://w.test/api/llm'))).json()) as { live: boolean; provider: string };
    expect(status).toMatchObject({ live: false, provider: 'off' });
  });

  it('needs a session id, and limits calls per session, sessions and voice per address', async () => {
    const { post } = setup();
    expect((await post({ runId: undefined })).status).toBe(400);
    for (let i = 0; i < 5; i += 1) expect((await post({ index: i })).status).toBe(200);
    expect((await post({ index: 5 })).status).toBe(429);
    expect((await post({ runId: 'run-b' })).status).toBe(200);
    expect((await post({ runId: 'run-c' })).status).toBe(429);
    const voice = (runId: string) => post({ runId, audio: 'UklGRiQAAABXQVZF' }, '10.0.0.9');
    expect((await voice('v1')).status).toBe(200);
    expect((await voice('v1')).status).toBe(200);
    expect((await voice('v1')).status).toBe(200);
    expect((await voice('v1')).status).toBe(429);
  });

  it('refuses visitors without shared counters unless instance counters are allowed', async () => {
    expect((await setup(ENV, false).post({})).status).toBe(503);
    expect((await setup({ ...ENV, LLM_INSTANCE_COUNTERS: '1' }, false).post({})).status).toBe(200);
  });

  it('refuses tasks it does not know', async () => {
    const { post } = setup();
    expect((await post({ task: 'extract' as never })).status).toBe(400);
    expect((await post({ maxTokens: 99999 })).status).toBe(400);
  });
});

describe('OpenRouter request', () => {
  it('asks for strict JSON, no hidden reasoning, a token bound, and sends audio as input_audio', async () => {
    let sent: Record<string, any> = {};
    const adapter = createOpenRouter({
      key: 'sk-or-test',
      fetch: (async (_url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ model: 'cheap/ears', choices: [{ message: { content: JSON.stringify(reply) } }], usage: { cost: 0.0002 } }), { status: 200 });
      }) as never,
    });
    const out = await adapter({
      body: { task: 'talk', index: 0, attempt: 0, messages: [{ role: 'system', content: 'x' }, { role: 'user', content: 'hi' }], schema: REPLY_SCHEMA, audio: 'UklGRiQAAABXQVZF', maxTokens: 300 },
      model: 'cheap/ears',
      fallbacks: [],
      signal: AbortSignal.timeout(1000),
    });
    expect(out).toMatchObject({ ok: true, model: 'cheap/ears', usage: { costUsd: 0.0002 } });
    expect(sent.reasoning).toEqual({ enabled: false });
    expect(sent.max_tokens).toBe(300);
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.messages[1].content[1]).toEqual({ type: 'input_audio', input_audio: { data: 'UklGRiQAAABXQVZF', format: 'wav' } });
  });
});
