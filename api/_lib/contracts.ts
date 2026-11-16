/**
 * Requests and answers of the three functions (PLAN "API"), shared by the server
 * (api/) and the typed clients (src/net/). Types only. The model exchange types live
 * in src/agents/types.ts and are re-exported here. Owner from package 01.5 on.
 *
 * Every answer is JSON; a refusal is `{ error: <code>, ... }`. Bodies are at most 4 MB.
 */
import type {
  CodeRecord,
  ExportSummary,
  JobKind,
  LlmRequest,
  PublicProject,
  PublicWorld,
} from '../../src/agents/types';

export type {
  ChatMessage,
  CodeKind,
  CodeRecord,
  ExportSummary,
  JsonSchema,
  LlmClient,
  LlmRequest,
  LlmResponse,
  LlmStatus,
  LlmTask,
  Provider,
  PublicProject,
  PublicWorld,
} from '../../src/agents/types';

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
  | 'too-many-tries'
  | 'too-many-polls'
  | 'storage-off'
  | 'storage-busy'
  | 'storage-readonly'
  | 'not-found'
  | 'private'
  | 'expired'
  | 'type'
  | 'forbidden'
  | 'conflict'
  | 'method'
  | 'server';

export type ApiError =
  | { error: 'rate-limited'; retryAfter: number }
  | { error: 'agents-offline'; need: 'key' | 'credit' | 'model' | 'fixture' }
  | { error: 'conflict'; current: number }
  | { error: Exclude<ApiErrorCode, 'rate-limited' | 'agents-offline' | 'conflict'> };

/** Failures the dev server and tests can ask for with the header `x-test-fail`. */
export type TestFail =
  | 'offline'
  | '429'
  | 'slow'
  | '503'
  | '401'
  | '404'
  | 'bad-output'
  | 'daily-cap'
  | 'storage-busy';

// ------------------------------------------------------------------ /api/llm

/** GET /api/llm answers LlmStatus. POST /api/llm takes everything but payload. */
export type LlmCallBody = Omit<LlmRequest, 'payload'>;

// ------------------------------------------------------------------ /api/code

export type ExportFile = { name: string; mime: string; base64: string };

/** POST /api/code; `files` and `visit` need the header x-owner-key. */
export type CreateCodeBody =
  | { kind: 'drop' }
  | { kind: 'files'; target: string }
  | { kind: 'visit'; target: string }
  | { kind: 'export'; title: string; summary: ExportSummary; files: ExportFile[] };
export type CreateCodeAnswer = { code: string; expiresAt: string };

/** GET /api/code/ice */
export type IceAnswer = { iceServers: RTCIceServerInit[]; relay: boolean };
/** RTCIceServer without depending on the DOM library on the server. */
export type RTCIceServerInit = { urls: string | string[]; username?: string; credential?: string };

/** GET /api/code/:code */
export type ReadCodeAnswer = CodeRecord;

/** POST /api/code/:code/close */
export type CloseCodeBody = { job: JobKind; goal?: string; files: { name: string; mime: string; bytes: number; url: string }[] };
export type OkAnswer = { ok: true };

// ------------------------------------------------------------------ /api/worlds

/** POST /api/worlds */
export type CreateWorldBody = { title?: string };
export type CreateWorldAnswer = { name: string; ownerKey: string };
/** GET /api/worlds/:name answers PublicWorld; PUT takes it with x-owner-key and if-match: <rev>. */
export type PutWorldBody = PublicWorld;
export type RevAnswer = { rev: number };
/** GET/PUT /api/worlds/:name/p/:slug */
export type PutProjectBody = PublicProject;

