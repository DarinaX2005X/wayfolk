/**
 * What the runner gives a job, and the registry of jobs. The runner owns events, the
 * store, the call queue, asks, timers and the lock; the job (src/agents/engine/task.ts,
 * the one general task) owns its stations and decisions.
 */
import type {
  AgentRole,
  Answers,
  AnswerSet,
  ChatMessage,
  Doc,
  JsonSchema,
  LlmResponse,
  LlmTask,
  Page,
  Project,
  RunEvent,
  RunRecord,
  RunScope,
  RunStats,
  TaskResult,
  TileRef,
} from './types';

/** An event as a job writes it: the runner adds runId, seq and t. */
export type EventBody = RunEvent extends infer E ? (E extends unknown ? Omit<E, 'runId' | 'seq' | 't'> : never) : never;

/** What the runner keeps of a run's start, so a reload can continue it. */
export type StoredSpec = {
  project: Project;
  docs: Doc[];
  scope: RunScope;
  seed: boolean;
  pace: number;
  answerSet: AnswerSet | null;
  previous: TaskResult | null;
  /** 'YYYY-MM-DD': today for the plan's dates. */
  today: string;
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
  /** What the call works on, for the call card: a file path, 'fix 2 items'. */
  what?: string;
  pages?: [number, number];
  /** The key of a redo: recorded redos are found by it. */
  redo?: string;
  /** Higher goes first among waiting calls (a second look before steps not yet started). */
  priority?: number;
  /** Problems of the answer; default: against the schema. */
  validate?(json: unknown): string[];
  /**
   * Changes a fresh answer before it is saved (never a cached one): a recording of a
   * sample plants its mistakes here, so the saved call carries them and their indices.
   */
  transform?(json: unknown): { json: unknown; planted?: number[] };
};

export type CallResult = { json: unknown; response: LlmResponse; attempt: number; cached: boolean };

/** key: unique within the run; defaultId: taken when nobody answers in time. */
export type AskSpec = { key: string; question: string; options: { id: string; label: string }[]; defaultId: string };

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
  /** Results of finished steps, by key (read on resume). */
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

export type JobOutcome = { status: 'ready' | 'partial' | 'failed' | 'declined'; result: TaskResult | null; stats: RunStats };
export type Job = (ctx: JobCtx) => Promise<JobOutcome>;

let job: Job | null = null;

/** The engine registers its one job when src/agents/engine/task.ts is imported. */
export function registerJob(next: Job): void {
  job = next;
}

export function findJob(): Job | null {
  return job;
}
