/**
 * Configuration of the model proxy, read from the environment per request (PROJECT
 * "Команды разработки и доставки" lists the variables). No model name is written in
 * code: it comes from LLM_MODEL (a comma separated list; the first is the main one) or
 * GEMINI_MODEL, and goes back in every answer.
 *
 * LLM_PROVIDER defaults to `fixtures`: a deployment where the provider was forgotten
 * spends nothing and says `live: false`, instead of quietly spending the key.
 */
import type { Provider } from '../contracts';
import { list, num, text, type Env } from '../env';

export type LlmConfig = {
  provider: Provider;
  /** Set when LLM_PROVIDER names something unknown. */
  providerProblem: string | null;
  key: string;
  models: string[];
  /** Model for calls with audio; empty means none is set (status `audio: false`). */
  audioModels: string[];
  /** Prices in USD per million tokens, when the provider gives no cost. */
  priceIn: number;
  priceOut: number;
  /** Limits in micro-dollars (whole millionths of a dollar: counters are integers). */
  dailyMicros: number;
  totalMicros: number;
  reserveMicros: number;
  estCallMicros: number;
  runCalls: number;
  runsPerAddress: number;
  voicePerAddress: number;
  devToken: string;
  /** Key of the address hash: counters per address never hold the address itself. */
  addressSalt: string;
  /** Address of the deployment for OpenRouter attribution; empty when unknown. */
  siteUrl: string;
};

const PROVIDERS: Provider[] = ['openrouter', 'gemini', 'fixtures'];

export const micros = (usd: number): number => Math.round(usd * 1_000_000);

export function readLlmConfig(env: Env): LlmConfig {
  const named = text(env, 'LLM_PROVIDER').toLowerCase();
  const known = (PROVIDERS as string[]).includes(named);
  const provider: Provider = known ? (named as Provider) : 'fixtures';
  const models =
    provider === 'gemini' ? (list(env, 'GEMINI_MODEL').length ? list(env, 'GEMINI_MODEL') : list(env, 'LLM_MODEL')) : list(env, 'LLM_MODEL');
  const production = text(env, 'VERCEL_PROJECT_PRODUCTION_URL');
  return {
    provider,
    providerProblem: named && !known ? `unknown LLM_PROVIDER ${named}` : null,
    key: provider === 'openrouter' ? text(env, 'OPENROUTER_API_KEY') : provider === 'gemini' ? text(env, 'GEMINI_API_KEY') : '',
    models: provider === 'fixtures' ? ['recorded'] : models,
    audioModels: list(env, 'LLM_AUDIO_MODEL'),
    priceIn: num(env, 'LLM_PRICE_IN', 0),
    priceOut: num(env, 'LLM_PRICE_OUT', 0),
    dailyMicros: micros(num(env, 'LLM_DAILY_USD', 0.2)),
    totalMicros: micros(num(env, 'LLM_TOTAL_USD', 6)),
    reserveMicros: micros(num(env, 'LLM_RUN_RESERVE_USD', 0.08)),
    estCallMicros: Math.max(1, micros(num(env, 'LLM_EST_CALL_USD', 0.004))),
    runCalls: Math.floor(num(env, 'LLM_RUN_CALLS', 32)),
    runsPerAddress: Math.floor(num(env, 'LLM_DAILY_RUNS_PER_ADDRESS', 2)),
    voicePerAddress: Math.floor(num(env, 'LLM_VOICE_CALLS_PER_ADDRESS', 40)),
    devToken: text(env, 'LLM_DEV_TOKEN'),
    addressSalt: 'groundwork-llm',
    siteUrl: production ? `https://${production}` : '',
  };
}

/** Whether this provider calls a real model (and so spends money). */
export const paid = (provider: Provider): boolean => provider === 'openrouter' || provider === 'gemini';
