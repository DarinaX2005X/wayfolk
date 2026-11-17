/**
 * Requests and answers of the Wayfolk functions, shared by the server (api/) and the
 * client of the mind module (src/mind/). Types only. Owner: mind package.
 *
 *   /api/llm       one model call behind the spending guard
 *   /api/islands   public islands: publish, list, read, mailbox, visiting residents
 *
 * Every answer is JSON; a refusal is `{ error: <code>, ... }`.
 */
import type { GiftKind, IslandSummary, MailItem, Resident } from '../../src/mind/types';

// ------------------------------------------------------------------ errors

export type ApiErrorCode =
  | 'bad-request'
  | 'too-big'
  | 'bad-output'
  | 'rate-limited'
  | 'daily-cap'
  | 'provider-error'
  | 'agents-offline'
  | 'provider-busy'
  | 'timeout'
  | 'too-many'
  | 'storage-off'
  | 'storage-busy'
  | 'storage-readonly'
  | 'not-found'
  | 'forbidden'
  | 'conflict'
  | 'method'
  | 'server';

export type ApiError =
  | { error: 'rate-limited'; retryAfter: number }
  | { error: 'agents-offline'; need: 'key' | 'credit' | 'model' }
  | { error: 'conflict'; current: number }
  | { error: Exclude<ApiErrorCode, 'rate-limited' | 'agents-offline' | 'conflict'> };

/** Failures the dev server and tests can ask for with the header `x-test-fail`. */
export type TestFail = 'offline' | '429' | 'slow' | '503' | '401' | '404' | 'bad-output' | 'daily-cap' | 'storage-busy';

// ------------------------------------------------------------------ /api/llm

/** What the mind asks the model for. Each task may have its own model (LLM_MODEL_<TASK>). */
export type LlmTask = 'traveler' | 'talk' | 'events' | 'gift' | 'trip' | 'chapter';

/** `off` spends nothing and answers `agents-offline`; `fixtures` is read as `off`. */
export type Provider = 'openrouter' | 'gemini' | 'off';

export type ChatMessage = {
  role: 'system' | 'user';
  content: string | ({ type: 'text'; text: string } | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } })[];
};

/** The subset of JSON Schema a model answer is checked against (api/_lib/llm/schema.ts). */
export type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: JsonSchema;
  enum?: string[];
  minItems?: number;
  maxItems?: number;
};

/** POST /api/llm. `audio`: base64 WAV attached to the last user message. */
export type LlmCallBody = {
  task: LlmTask;
  index: number;
  attempt: number;
  messages: ChatMessage[];
  schema: JsonSchema;
  audio?: string;
  /** The session of the app; visitors' paid calls must carry it. */
  runId?: string;
  /** Upper bound of the answer, tokens. */
  maxTokens?: number;
};

/** POST /api/llm answers this; `json` fits the request's schema. */
export type LlmResponse = { json: unknown; provider: Provider; model: string; ms: number };

/** GET /api/llm. */
export type LlmStatus = {
  live: boolean;
  provider: Provider;
  model: string;
  audio: boolean;
  callsLeftToday: number;
  runsLeftToday: number;
};

// ------------------------------------------------------------------ /api/islands

/** A resident as other people see it: no memory of the owner, no trip details. */
export type PublicResident = Omit<Resident, 'memory' | 'trip' | 'from'>;

/** The part of an island that is published. Built by `publicSnapshot` in src/mind/island-check.ts. */
export type PublicIsland = {
  id: string;
  name: string;
  seed: number;
  radius: number;
  residents: PublicResident[];
  houses: import('../../src/mind/types').HouseSpec[];
  paths: [string, string][];
  props: import('../../src/mind/types').PlacedProp[];
  createdAt: number;
};

/** A resident of another island staying here for a while. */
export type Guest = { resident: PublicResident; fromId: string; fromName: string; arrivedAt: number; leavesAt: number };

/** GET /api/islands */
export type ListIslandsAnswer = { islands: IslandSummary[] };
/** POST /api/islands { island } -> 201; PUT /api/islands/:id { island } with x-owner-key -> 200 { rev } */
export type PublishBody = { island: PublicIsland };
export type PublishAnswer = { id: string; ownerKey: string; rev: number };
export type RevAnswer = { rev: number };
/** GET /api/islands/:id */
export type ReadIslandAnswer = { island: PublicIsland; guests: Guest[]; updatedAt: number; demo?: boolean };
/** POST /api/islands/:id/mail -> 201 { id } */
export type MailBody = { from: string; fromIsland?: string; kind: 'gift' | 'note'; item?: GiftKind; text: string };
/** GET /api/islands/:id/mail with x-owner-key */
export type MailAnswer = { mail: MailItem[] };
/** POST /api/islands/:id/guests -> 201 { leavesAt } */
export type GuestBody = { resident: PublicResident; fromId: string; fromName: string; stayMs: number };
export type GuestAnswer = { leavesAt: number };

/** GET /api/code/ice (kept for a later live visit between two headsets). */
export type IceAnswer = { iceServers: RTCIceServerInit[]; relay: boolean };
/** RTCIceServer without depending on the DOM library on the server. */
export type RTCIceServerInit = { urls: string | string[]; username?: string; credential?: string };
