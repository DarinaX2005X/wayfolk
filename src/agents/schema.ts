/**
 * Checking a model answer against its flat JSON schema before any code reads it, and
 * the request hash recorded with every call (PLAN "Трудный механизм"):
 * reqHash = first eight hex characters of SHA-256 of JSON.stringify({ task, messages, schema }).
 */
import type { ChatMessage, JsonSchema, LlmTask } from './types';
import { sha256Hex } from '../materials/normalize';

/** Problems of `value` against `schema` as readable paths; [] when it fits. */
export function schemaProblems(value: unknown, schema: JsonSchema, path = '$'): string[] {
  const out: string[] = [];
  const t = schema.type;
  if (t === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path} is not an object`];
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in obj)) out.push(`${path}.${key} is missing`);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in obj) out.push(...schemaProblems(obj[key], sub, `${path}.${key}`));
    }
    return out;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) return [`${path} is not an array`];
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push(`${path} has fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${path} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => out.push(...schemaProblems(v, schema.items!, `${path}[${i}]`)));
    return out;
  }
  if (t === 'string') {
    if (typeof value !== 'string') return [`${path} is not a string`];
    if (schema.enum && !schema.enum.includes(value)) return [`${path} "${value}" is not one of ${schema.enum.join(', ')}`];
    return out;
  }
  if (t === 'number' || t === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${path} is not a number`];
    if (t === 'integer' && !Number.isInteger(value)) return [`${path} is not an integer`];
    return out;
  }
  if (t === 'boolean' && typeof value !== 'boolean') return [`${path} is not a boolean`];
  return out;
}

export async function reqHash(task: LlmTask, messages: ChatMessage[], schema: JsonSchema): Promise<string> {
  return (await sha256Hex(JSON.stringify({ task, messages, schema }))).slice(0, 8);
}

/** Characters sent to the model: what the call card shows as "sent". */
export function messageChars(messages: readonly ChatMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') n += m.content.length;
    else for (const part of m.content) n += part.type === 'text' ? part.text.length : 0;
  }
  return n;
}
