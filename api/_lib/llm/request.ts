/**
 * Reading `POST /api/llm`: `{ task, index, attempt, messages, schema, audio?, runId?,
 * maxTokens? }`. Everything is checked before a counter moves or a provider is called;
 * unknown fields are dropped.
 */
import type { ChatMessage, JsonSchema, LlmCallBody, LlmTask } from '../contracts';
import { isRecord } from '../http';
import { schemaProblem } from './schema';

export const TASKS: readonly LlmTask[] = ['traveler', 'talk', 'events', 'gift', 'trip'];
const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_MESSAGES = 16;

export type ParsedRequest = { ok: true; body: LlmCallBody } | { ok: false; problem: string };

function parseMessage(value: unknown, i: number): ChatMessage | string {
  if (!isRecord(value)) return `messages[${i}]: not an object`;
  if (value.role !== 'system' && value.role !== 'user') return `messages[${i}].role`;
  if (typeof value.content === 'string') return { role: value.role, content: value.content };
  if (!Array.isArray(value.content) || value.content.length === 0) return `messages[${i}].content`;
  const parts: Exclude<ChatMessage['content'], string> = [];
  for (const part of value.content) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      parts.push({ type: 'text', text: part.text });
    } else if (
      isRecord(part) &&
      part.type === 'input_audio' &&
      isRecord(part.input_audio) &&
      typeof part.input_audio.data === 'string' &&
      BASE64.test(part.input_audio.data) &&
      part.input_audio.format === 'wav'
    ) {
      parts.push({ type: 'input_audio', input_audio: { data: part.input_audio.data, format: 'wav' } });
    } else {
      return `messages[${i}].content: unsupported part`;
    }
  }
  return { role: value.role, content: parts };
}

export function parseLlmRequest(value: unknown): ParsedRequest {
  if (!isRecord(value)) return { ok: false, problem: 'body is not an object' };
  const { task, index, attempt } = value;
  if (typeof task !== 'string' || !(TASKS as readonly string[]).includes(task)) return { ok: false, problem: 'task' };
  if (!Number.isInteger(index) || (index as number) < 0) return { ok: false, problem: 'index' };
  if (!Number.isInteger(attempt) || (attempt as number) < 0) return { ok: false, problem: 'attempt' };
  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > MAX_MESSAGES) {
    return { ok: false, problem: 'messages' };
  }
  const messages: ChatMessage[] = [];
  for (let i = 0; i < value.messages.length; i += 1) {
    const message = parseMessage(value.messages[i], i);
    if (typeof message === 'string') return { ok: false, problem: message };
    messages.push(message);
  }
  if (!messages.some((m) => m.role === 'user')) return { ok: false, problem: 'messages: no user message' };
  const problem = schemaProblem(value.schema);
  if (problem) return { ok: false, problem: `schema ${problem}` };
  const body: LlmCallBody = {
    task: task as LlmTask,
    index: index as number,
    attempt: attempt as number,
    messages,
    schema: value.schema as JsonSchema,
  };
  if (value.audio !== undefined) {
    if (typeof value.audio !== 'string' || value.audio.length === 0 || !BASE64.test(value.audio)) return { ok: false, problem: 'audio' };
    body.audio = value.audio;
  }
  if (value.maxTokens !== undefined) {
    if (!Number.isInteger(value.maxTokens) || (value.maxTokens as number) < 16 || (value.maxTokens as number) > 4000) return { ok: false, problem: 'maxTokens' };
    body.maxTokens = value.maxTokens as number;
  }
  if (value.runId !== undefined) {
    if (typeof value.runId !== 'string' || !RUN_ID.test(value.runId)) return { ok: false, problem: 'runId' };
    body.runId = value.runId;
  }
  return { ok: true, body };
}

/**
 * Messages with the request's audio attached to the last user message as an
 * `input_audio` part, unless a message already carries audio.
 */
export function withAudio(body: LlmCallBody): ChatMessage[] {
  const hasAudio = body.messages.some((m) => typeof m.content !== 'string' && m.content.some((p) => p.type === 'input_audio'));
  if (!body.audio || hasAudio) return body.messages;
  const last = body.messages.map((m) => m.role).lastIndexOf('user');
  return body.messages.map((message, i) => {
    if (i !== last) return message;
    const parts = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : [...message.content];
    parts.push({ type: 'input_audio', input_audio: { data: body.audio!, format: 'wav' } });
    return { role: message.role, content: parts };
  });
}

/** Whether the call carries audio, either way. */
export const hasAudio = (body: LlmCallBody): boolean =>
  Boolean(body.audio) || body.messages.some((m) => typeof m.content !== 'string' && m.content.some((p) => p.type === 'input_audio'));
