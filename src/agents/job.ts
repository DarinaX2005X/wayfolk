/**
 * What the runner gives a job, and the registry of jobs by kind of work. The runner
 * owns events, the store, the call queue, asks, timers and the lock; a job (case now,
 * seating and essays later) owns its stations and decisions. A package that adds a kind
 * of work calls registerJob from its own module; the runner never changes for it.
 */
import type {
  AgentRole,
  Answers,
  AnswerSet,
  ChatMessage,
  Doc,
  JobKind,
  JsonSchema,
  LlmResponse,
  LlmTask,
  Page,
  Project,
  RunEvent,
  RunRecord,
  RunStats,
  TileRef,
} from './types';

/** An event as a job writes it: the runner adds runId, seq and t. */
export type EventBody = RunEvent extends infer E ? (E extends unknown ? Omit<E, 'runId' | 'seq' | 't'> : never) : never;

/** What the runner keeps of a run's start, so a reload can continue it. */
export type StoredSpec = {
  project: Project;
  docs: Doc[];
  scope: 'full' | { pages: number[] };
  seed: boolean;
  pace: number;
  answerSet: AnswerSet | null;
};

export type CallSpec = {
  task: LlmTask;
  index: number;
  attempt?: number;
  /** Attempts in a row for bad output (default 2: one more question after a bad answer). */
  maxAttempts?: number;
  payload: unknown;
  messages: ChatMessage[];
  schema: JsonSchema;
  station: string;
  role: AgentRole;
  pages?: [number, number];
  /** Higher goes first among waiting calls (a second look before unstarted batches). */
  priority?: number;
  /** Problems of the answer; default: against the schema. */
  validate?(json: unknown): string[];
  /**
   * Changes a fresh answer before it is saved (never a cached one): a live recording
   * adds the fakes seeded by code here, so the saved call carries them and their indices.
   */
  transform?(json: unknown): { json: unknown; seeded?: number[] };
};

export type CallResult = { json: unknown; response: LlmResponse; attempt: number; cached: boolean };

export type AskSpec = { pair: [string, string]; question: string; options: { id: string; label: string }[] };

export type JobCtx = {
  readonly runId: string;
  readonly spec: StoredSpec;
  readonly project: Project;
  /** Documents with page numbers unique across the project. */
  readonly docs: Doc[];
  readonly pages: Page[];
  readonly answers: Answers;
  readonly seed: boolean;
  /** True when this run continues a stored one after a reload. */
  readonly resumed: boolean;
  /** Results of finished batches and steps, by key (read on resume). */
  readonly partial: Record<string, unknown>;
  readonly record: RunRecord;
  emit(event: EventBody): RunEvent;
  /** step-start once per station, even across a reload. */
  stepStart(station: string): void;
  stepEnd(station: string, summary: Record<string, number>): void;
  note(station: string, source: string, text: string, key?: boolean): void;
  /** Emits a tile event for a unit that became part of the result; returns its number. */
  tile(station: string, ref: TileRef): number;
  readonly tiles: number;
  call(spec: CallSpec): Promise<CallResult>;
  save(key: string, value: unknown): Promise<void>;
  /** Asks the person; resolves with the option id, or null when nobody answered in time. */
  ask(station: string, ask: AskSpec): { askId: string; answer: Promise<string | null> };
  /** Calls used so far (each attempt counts). */
  readonly calls: number;
  readonly callsByTask: Partial<Record<LlmTask, number>>;
  readonly modelMs: number;
  readonly budget: number;
  readonly cancelled: boolean;
  throwIfCancelled(): void;
  now(): number;
  /** A deterministic generator seeded by the run id. */
  rng(): number;
};

export type JobOutcome = { status: 'ready' | 'partial' | 'failed'; result: RunRecord['result']; stats: RunStats };
export type Job = (ctx: JobCtx) => Promise<JobOutcome>;

const jobs = new Map<string, Job>();

/** scope 'full' is the first run; 'late' adds pages to a finished result. */
export function registerJob(kind: JobKind, scope: 'full' | 'late', job: Job): void {
  jobs.set(`${kind}/${scope}`, job);
}

export function findJob(kind: JobKind, scope: 'full' | 'late'): Job | null {
  return jobs.get(`${kind}/${scope}`) ?? null;
}
