/**
 * The answer schema of a model call (PLAN `JsonSchema`): checking that a value fits it,
 * the strict form OpenRouter needs, and reading JSON out of a model's text.
 *
 * The validator covers exactly the subset the contract allows: object (properties,
 * required, additionalProperties: false), array (items, minItems, maxItems), string
 * (enum), number, integer, boolean. A schema using anything else is refused when the
 * request is read, so a schema can never pass here by being misunderstood.
 */
import type { JsonSchema } from '../contracts';

const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean'] as const;
const KEYS = new Set(['type', 'description', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minItems', 'maxItems']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Null when `value` is a schema of the supported subset, otherwise where it is not. */
export function schemaProblem(value: unknown, path = '$', depth = 0): string | null {
  if (depth > 12) return `${path}: nested too deep`;
  if (!isRecord(value)) return `${path}: not an object`;
  for (const key of Object.keys(value)) if (!KEYS.has(key)) return `${path}: unsupported keyword ${key}`;
  if (!(TYPES as readonly unknown[]).includes(value.type)) return `${path}: unsupported type`;
  if (value.description !== undefined && typeof value.description !== 'string') return `${path}: description`;
  if (value.additionalProperties !== undefined && value.additionalProperties !== false) return `${path}: additionalProperties`;
  if (value.enum !== undefined && (!Array.isArray(value.enum) || value.enum.some((v) => typeof v !== 'string'))) return `${path}: enum`;
  for (const key of ['minItems', 'maxItems'] as const) {
    const n = value[key];
    if (n !== undefined && (!Number.isInteger(n) || (n as number) < 0)) return `${path}: ${key}`;
  }
  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) return `${path}: properties`;
    for (const [name, child] of Object.entries(value.properties)) {
      const problem = schemaProblem(child, `${path}.${name}`, depth + 1);
      if (problem) return problem;
    }
  }
  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some((r) => typeof r !== 'string')) return `${path}: required`;
  }
  if (value.items !== undefined) return schemaProblem(value.items, `${path}[]`, depth + 1);
  if (value.type === 'array' && value.items === undefined) return `${path}: array without items`;
  return null;
}

/** Null when `value` fits `schema`, otherwise the path and reason of the first misfit. */
export function validate(value: unknown, schema: JsonSchema, path = '$'): string | null {
  switch (schema.type) {
    case 'object': {
      if (!isRecord(value)) return `${path}: expected object`;
      for (const name of schema.required ?? []) {
        if (!Object.hasOwn(value, name)) return `${path}.${name}: missing`;
      }
      const properties = schema.properties ?? {};
      for (const [name, child] of Object.entries(value)) {
        const sub = properties[name];
        if (!sub) {
          if (schema.additionalProperties === false) return `${path}.${name}: not allowed`;
          continue;
        }
        const problem = validate(child, sub, `${path}.${name}`);
        if (problem) return problem;
      }
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${path}: expected array`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}: fewer than ${schema.minItems}`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path}: more than ${schema.maxItems}`;
      if (schema.items) {
        for (let i = 0; i < value.length; i += 1) {
          const problem = validate(value[i], schema.items, `${path}[${i}]`);
          if (problem) return problem;
        }
      }
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return `${path}: expected string`;
      if (schema.enum && !schema.enum.includes(value)) return `${path}: not one of the allowed values`;
      return null;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${path}: expected number`;
    case 'integer':
      return Number.isInteger(value) ? null : `${path}: expected integer`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${path}: expected boolean`;
  }
}

/**
 * The strict form for OpenRouter's `json_schema` mode: `additionalProperties: false` on
 * every object (strict mode requires it). A copy; the request's schema is not changed.
 */
export function strictSchema(schema: JsonSchema): JsonSchema {
  const out: JsonSchema = { ...schema };
  if (schema.type === 'object') {
    out.additionalProperties = false;
    if (schema.properties) {
      out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, strictSchema(v)]));
    }
  }
  if (schema.items) out.items = strictSchema(schema.items);
  return out;
}

/**
 * JSON out of a model's text. Models in JSON mode answer with bare JSON, but some wrap it
 * in a ``` fence or add a line before it; both are tolerated. Undefined when no JSON
 * value can be read.
 */
export function parseModelJson(textValue: string): unknown {
  const trimmed = textValue.trim();
  const attempts = [trimmed];
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  if (fenced) attempts.push(fenced[1].trim());
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (start >= 0 && end > start) attempts.push(trimmed.slice(start, end + 1));
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // next form
    }
  }
  return undefined;
}
