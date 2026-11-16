/**
 * The shared domain contract of Groundwork (PLAN "Контракты"): projects and their
 * materials, runs and their events, the results of the three kinds of work, the island
 * and its notes, codes, sync messages of the seating for two, intents and settings.
 *
 * Types only, no code: the same file is read by the browser, by Node scripts and by the
 * server functions (api/_lib/contracts.ts re-exports the model exchange types from here).
 * Owner from package 01.4 on; a change of a shared type is described in a package report
 * and made by the integration package of the stage.
 *
 * The island and sync types (World, Plot, Note, Seat, Op, SyncMsg, ...) are part of the
 * same contract because Project, Intent and the API refer to them; src/world/types.ts
 * and src/social/types.ts re-export them from here instead of declaring their own.
 */

// ------------------------------------------------------------------ project and materials

export type JobKind = 'case' | 'seating' | 'essays';
export type ExampleId = 'harbor-street' | 'wedding' | 'class-9b';
/** 'p_' + 12 base32 characters, for example 'p_k7qm2r9tz4vx'. */
export type ProjectId = string;

export type Project = {
  id: ProjectId;
  kind: JobKind;
  /** 'Harbor Street, Unit 4B' */
  title: string;
  /** 'Find where the stories don't match' */
  goal: string;
  example?: ExampleId;
  sample: boolean;
  /** 'harbor-street' */
  slug: string;
  /** ISO time. */
  createdAt: string;
  updatedAt: string;
  /** Grows with every edit. */
  rev: number;
  /** "Review due" counts from here. */
  firstRunAt: string | null;
  visibility: 'private' | 'public';
  status: 'draft' | 'running' | 'ready' | 'partial' | 'stale' | 'failed';
  materials: MaterialRef[];
  /** sha256 of the normalized text of all pages. */
  materialHash: string;
  runId: string | null;
  /** The first run and every later load of pages. */
  passes: number;
  /** EssaysPublic only on a project made from a public copy (fromPublic). */
  result: CaseResult | SeatingResult | EssaysResult | EssaysPublic | null;
  edits: Edit[];
  notes: Note[];
};

export type MaterialRef = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  pages?: number;
  sha256: string;
  source: 'example' | 'drop' | 'late';
  addedAt: string;
  readAt: string | null;
};

export type DocKind =
  | 'lease'
  | 'email'
  | 'messages'
  | 'log'
  | 'statement'
  | 'report'
  | 'letter'
  | 'receipt'
  | 'notice'
  | 'essay'
  | 'file';

/** author: id of a party. */
export type DocMeta = { id: string; title: string; kind: DocKind; from: number; to: number; date?: string; author?: string };
export type Block = { k: 'head' | 'p' | 'msg' | 'row' | 'clause' | 'sig'; text: string; who?: string; at?: string };
/** n counts from 1; text = blocks.map(blockText).join('\n') (src/materials/text.ts). */
export type Page = { docId: string; n: number; text: string; blocks?: Block[] };
export type Doc = { meta: DocMeta; pages: Page[]; scanned?: boolean };

export type ExampleMeta = {
  id: ExampleId;
  kind: JobKind;
  title: string;
  goal: string;
  /** The two lines of the envelope label. */
  label: [string, string];
  materialHash: string;
  /** materialHash of the pages read from the example's PDF by the same readFile. */
  pdfTextHash?: string;
};

export type Edit = {
  id: string;
  at: string;
  by: 'me' | 'guest';
  source: 'hand' | 'voice' | 'gaze' | 'mouse' | 'phone' | 'calibration';
} & (
  | { kind: 'pair-review'; key: string; verdict: 'kept' | 'dismissed' | 'reopened' | 'cleared' } // cleared: "Undo"; reopened: opened again after a late page resolved it
  | { kind: 'ask-answer'; askId: string; optionId: string }
  | { kind: 'event-restore'; itemId: string } // a dropped item brought back: "Not verified, added by you"
  | { kind: 'seat-move'; guestId: string; tableId: string; party: boolean }
  | { kind: 'seat-lock'; guestId: string; locked: boolean }
  | { kind: 'wish-add'; wish: Wish }
  | { kind: 'wish-answer'; questionId: string; option: string }
  | { kind: 'guest-coming'; guestId: string; coming: boolean }
  | { kind: 'tag-price'; tagType: string; minor: number; major: number } // this mistake costs this much in the whole class
  | { kind: 'tag-dismiss'; tagId: string } // this fragment is not a mistake
  | { kind: 'score-override'; essayId: string; criterion: string; delta: number; reason: string } // one essay only
  | { kind: 'anchor-marks'; essayId: string; marks: Record<string, number> } // the teacher's marks on an anchor essay
);

// ------------------------------------------------------------------ run and events

/** Only the roles that call the model. */
export type AgentRole = 'planner' | 'extractor' | 'reconciler' | 'wishes' | 'marker';
export type StepKind = 'read' | 'extract' | 'verify' | 'reconcile' | 'assemble' | 'wishes' | 'solve' | 'mark' | 'calibrate';
/**
 * case:     s1 read 'Read' code; s2 extract 'Extract' model extractor; s3 verify 'Check' code;
 *           s4 reconcile 'Reconcile' model reconciler; s5 assemble 'Assemble' code
 * seating:  s1 read 'Read'; s2 wishes 'Wishes' model wishes; s3 verify 'Check'; s4 solve 'Seat'
 * essays:   s1 read 'Read'; s2 mark 'Mark' model marker; s3 verify 'Check'; s4 calibrate 'Calibrate' code; s5 assemble 'Assemble'
 * late case pages: s1 read, s2 extract, s3 verify 'Check' (the reconcile call shows at s3)
 */
export type Station = { id: string; step: StepKind; label: string; by: 'model' | 'code'; role?: AgentRole };
export type LlmTask = 'plan' | 'extract' | 'recheck' | 'reconcile' | 'wishes' | 'mark' | 'intent';
export type Provider = 'openrouter' | 'gemini' | 'fixtures';
export type Answers = 'live' | 'recorded' | 'scripted';
export type TileRef = { kind: 'event' | 'guest' | 'tag'; id: string };

/** t: ms from the start of the run. */
export type RunEvent = { runId: string; seq: number; t: number } & (
  | {
      type: 'run-start';
      job: JobKind;
      example?: ExampleId;
      scope: 'full' | 'late';
      answers: Answers;
      provider: Provider | 'script' | null;
      model: string | null;
      recordedAt?: string;
      planted: number;
      seeded: number;
    }
  | { type: 'plan'; stations: Station[]; budget: number; lines: string[]; tilesPlanned: number } // lines: lines of the plan board
  | { type: 'step-start'; station: string }
  | {
      type: 'progress';
      station: string;
      done: number;
      total: number;
      unit: 'pages' | 'batches' | 'claims' | 'pairs' | 'guests' | 'wishes' | 'swaps' | 'essays' | 'tags';
    }
  | {
      type: 'call-start';
      station: string;
      callId: string;
      task: LlmTask;
      role: AgentRole;
      index: number;
      attempt: number;
      pages?: [number, number];
      chars: number;
    }
  | { type: 'call-end'; station: string; callId: string; ms: number; ok: boolean; items?: number; code?: RunErrorCode }
  | { type: 'waiting'; station: string; callId?: string; reason: 'rate-limited' | 'provider-busy' | 'offline'; retryInMs: number }
  | { type: 'item'; station: string; item: CheckedItem }
  | { type: 'tile'; station: string; i: number; ref: TileRef } // i: tile number in laying order, from zero
  | {
      type: 'ask';
      station: string;
      askId: string;
      pair: [string, string];
      question: string;
      options: { id: string; label: string }[];
      timeoutMs: number;
    }
  | { type: 'answer'; askId: string; optionId: string | null; by: 'hand' | 'voice' | 'gaze' | 'mouse' | 'timeout' }
  | { type: 'note'; station: string; source: string; text: string; key?: boolean } // a caption line; key: never folded
  | { type: 'fallback'; to: 'recorded'; reason: RunErrorCode }
  | { type: 'step-end'; station: string; summary: Record<string, number> }
  | { type: 'error'; station: string; code: RunErrorCode; retryable: boolean; pages?: [number, number] }
  | { type: 'run-end'; status: 'ready' | 'partial' | 'failed' | 'cancelled'; calls: number; stats: RunStats }
);

export type RunErrorCode =
  | 'agents-offline'
  | 'provider-error'
  | 'timeout'
  | 'bad-output'
  | 'budget'
  | 'daily-cap'
  | 'material'
  | 'offline';

/**
 * First check of a claim: accepted | corrected | merged | rejected; after the second
 * look the same id: fixed | dropped. quote-wrong-page and quote-reworded give corrected;
 * quote-altered and quote-not-found give rejected.
 */
export type CheckedItem = {
  id: string;
  kind: 'claim' | 'fact' | 'pair' | 'guest' | 'wish' | 'tag' | 'score';
  status: 'accepted' | 'corrected' | 'merged' | 'rejected' | 'fixed' | 'dropped';
  reason?: RejectReason;
  dropCause?: 'withdrawn' | 'failed-again' | 'budget' | 'not-recorded' | 'seeded';
  claim: string;
  eventId?: string;
  batch?: number;
  planted?: boolean;
  seeded?: boolean;
  ref?: { docId: string; page: number };
  found?: { page: number; text: string };
  /** The model's words, the nearest text of the page, numbers of the words that differ. */
  diff?: { claim: string; source: string; marks?: { claim: number[]; source: number[] } };
  /** Where the quote stands on the page: for highlighting. */
  spans?: QuoteSpan[];
  /** Only for kind 'pair'. */
  pairKey?: string;
  verdict?: 'contradiction' | 'explained' | 'unsure' | 'unjudged';
};

/** Offsets in the text of a block of the page. */
export type QuoteSpan = { blockIndex: number; start: number; end: number };

export type RejectReason =
  | 'quote-not-found'
  | 'quote-altered'
  | 'quote-wrong-page'
  | 'quote-reworded'
  | 'quote-too-short'
  | 'date-mismatch'
  | 'weekday-mismatch'
  | 'date-out-of-range'
  | 'unknown-actor'
  | 'duplicate'
  | 'fact-not-in-quote'
  | 'pair-unsupported'
  | 'unknown-guest'
  | 'ambiguous-guest'
  | 'wish-source-not-found'
  | 'wish-conflict'
  | 'wish-impossible'
  | 'tag-fragment-not-found'
  | 'tag-type-unknown'
  | 'score-sum-mismatch'
  | 'score-out-of-range'
  | 'points-without-sentence';

/**
 * modelMs: sum of ms of all calls; caught and seeded as defined next to the equality of
 * numbers in PLAN; tiles: number of tile events. For seating and essays `claims` counts
 * wishes and tags, `events` counts accepted wishes and tags.
 */
export type RunStats = {
  pages: number;
  pagesUnread: number[];
  calls: Partial<Record<LlmTask, number>>;
  modelMs: number;
  checkMs: number;
  claims: number;
  matched: number;
  corrected: number;
  merged: number;
  sentBack: number;
  fixed: number;
  dropped: number;
  added: number;
  events: number;
  factsChecked: number;
  factsRemoved: number;
  pairs: number;
  contradictions: number;
  explained: number;
  asked: number;
  planted: number;
  seeded: number;
  caught: number;
  tiles: number;
  coverage: { datedPassages: number; covered: number; pagesWithoutEvents: number[] };
};

/** provider 'script': the answer was written by the author of the example. */
export type CallRecord = {
  callId: string;
  task: LlmTask;
  index: number;
  attempt: number;
  reqHash: string;
  ms: number;
  ok: boolean;
  json: unknown;
  provider: Provider | 'script';
  model: string;
  planted?: number[];
};

export type AnswerSet = {
  example: ExampleId;
  scope: 'full' | 'late';
  answers: 'scripted' | 'recorded';
  recordedAt?: string;
  model?: string;
  seeded?: number;
  materialHash: string;
  calls: CallRecord[];
};

export type RunRecord = {
  id: string;
  job: JobKind;
  example?: ExampleId;
  projectId: ProjectId;
  scope: 'full' | 'late';
  startedAt: string;
  answers: Answers;
  provider: Provider | 'script' | null;
  model: string | null;
  status: 'running' | 'ready' | 'partial' | 'failed' | 'cancelled';
  calls: CallRecord[];
  events: RunEvent[];
  /** Results of finished batches and steps by key. */
  partial: Record<string, unknown>;
  asks: Record<string, string | null>;
  result: CaseResult | SeatingResult | EssaysResult | null;
  stats: RunStats | null;
};

export type ChatMessage = {
  role: 'system' | 'user';
  content: string | ({ type: 'text'; text: string } | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } })[];
};

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

export type LlmStatus = {
  live: boolean;
  provider: Provider;
  model: string;
  audio: boolean;
  callsLeftToday: number;
  runsLeftToday: number;
};

/**
 * payload stays on the client (recordedLlm picks reconcile verdicts by it); everything
 * else goes to the server. audio: base64 WAV without a data-URI prefix.
 */
export type LlmRequest = {
  task: LlmTask;
  index: number;
  attempt: number;
  payload: unknown;
  messages: ChatMessage[];
  schema: JsonSchema;
  audio?: string;
  fixture?: string;
  runId?: string;
};

export type LlmResponse = { json: unknown; provider: Provider | 'script'; model: string; ms: number };
export type LlmClient = {
  status(): Promise<LlmStatus>;
  call(req: LlmRequest, opts?: { signal?: AbortSignal }): Promise<LlmResponse>;
};

export type RunStore = {
  load(runId: string): Promise<RunRecord | null>;
  findRunning(projectId: ProjectId): Promise<RunRecord | null>;
  save(record: RunRecord): Promise<void>;
  appendEvents(runId: string, events: RunEvent[]): Promise<void>;
  saveCall(runId: string, call: CallRecord): Promise<void>;
  savePartial(runId: string, key: string, value: unknown): Promise<void>;
};

/** acquire resolves null when another tab holds the lock. */
export type LockManager = { acquire(name: string): Promise<(() => void) | null> };

/** now and timers are replaced by frame-by-frame capture and by tests. */
export type RunDeps = {
  llm: LlmClient;
  store: RunStore;
  now(): number;
  fallback?: AnswerSet;
  locks?: LockManager;
  timers?: { set(fn: () => void, ms: number): number; clear(id: number): void };
};

export type RunSpec = {
  project: Project;
  docs: Doc[];
  scope: 'full' | { pages: number[] };
  answers: 'live' | AnswerSet;
  seed?: boolean;
  pace?: number;
};

export type RunHandle = {
  id: string;
  record(): RunRecord;
  subscribe(fn: (e: RunEvent) => void): () => void;
  answer(askId: string, optionId: string, by: 'hand' | 'voice' | 'gaze' | 'mouse'): void;
  /** The ask card stood up: the 20 s countdown starts here. */
  shown(askId: string): void;
  pause(on: boolean): void;
  readonly paused: boolean;
  skip(): void;
  cancel(): void;
  done: Promise<RunRecord>;
};

// ------------------------------------------------------------------ case result

/** { id: 'mark', name: 'Mark Ellison', role: 'Tenant', aliases: ['Mr Ellison', 'the tenant'] } */
export type Party = { id: string; name: string; role: string; aliases: string[] };
/** { id: 'keys.returned_on', topic: 'keys', type: 'date', question: 'When were the keys returned?' } */
export type FactField = { id: string; topic: string; type: 'date' | 'amount' | 'time' | 'yesno' | 'presence'; question: string };
/** Values: ISO date, a number as a string, 'HH:MM', 'yes' | 'no', 'here' | 'away'. */
export type Fact = {
  field: string;
  type: FactField['type'];
  value: string;
  basis: 'literal' | 'derived';
  subject?: string;
  from?: string;
  to?: string;
};
/** The model's answer: empty strings instead of missing values. */
export type ExtractedEvent = {
  kind: 'record' | 'account';
  date: string;
  time: string;
  actors: string[];
  label: string;
  summary: string;
  quote: string;
  page: number;
  topic: string;
  facts: Fact[];
};
/**
 * lane: id of the party on whose lane the event stands: the author of the document
 * (DocMeta.author) when that is a party of the case, otherwise the first actor.
 */
export type CaseEvent = {
  id: string;
  kind: 'record' | 'account';
  at: string | null;
  precision: 'day' | 'minute';
  saidAt: string;
  actors: string[];
  lane: string;
  label: string;
  summary: string;
  quote: string;
  source: { docId: string; docTitle: string; page: number };
  topic: string;
  facts: Fact[];
  status: 'verified' | 'corrected' | 'fixed' | 'added' | 'restored';
  pass: number;
};
/** key: the two event ids in alphabetical order joined by '|'. */
export type Contradiction = {
  key: string;
  a: string;
  b: string;
  topic: string;
  field: string;
  label: string;
  kind: 'direct' | 'judgment';
  values: [string, string];
  explanation: string;
  origin: 'agents' | 'you' | 'late-pages';
  state: 'open' | 'resolved';
  resolvedBy?: { docId: string; page: number };
  supports: { eventId: string; side: 'a' | 'b' }[];
  review: 'open' | 'kept' | 'dismissed';
};
export type Explained = { key: string; a: string; b: string; reason: string; by: 'agents' | 'you' };
export type OpenAsk = { askId: string; pair: [string, string]; question: string; options: { id: string; label: string }[] };
export type Deadline = { id: string; kind: 'document' | 'review'; date: string; label: string; source?: { docId: string; page: number } };
export type CaseResult = {
  parties: Party[];
  topics: string[];
  fields: FactField[];
  docs: DocMeta[];
  events: CaseEvent[];
  contradictions: Contradiction[];
  explained: Explained[];
  open: OpenAsk[];
  /** Everything that was not simply accepted: corrected, merged, fixed, dropped, removed facts. */
  audit: CheckedItem[];
  /** The part of audit that ended dropped; only these can be restored by an event-restore edit. */
  rejected: CheckedItem[];
  window: { from: string; to: string };
  deadlines: Deadline[];
  stats: RunStats;
};
export type TimelineFilter = { parties?: string[]; from?: string; to?: string; contradictionsOnly?: boolean; topic?: string };

// ------------------------------------------------------------------ seating result

export type Guest = {
  id: string;
  name: string;
  party: string;
  side: 'bride' | 'groom' | 'both';
  group: string;
  relation: string;
  age: 'child' | 'adult' | 'senior';
  needs: string[];
  diet: string[];
  notes: string;
  coming: boolean;
};
/** Round tables; metres from the far left corner. */
export type Table = { id: string; label: string; seats: number; x: number; y: number; row: number };
export type Rect = { x: number; y: number; w: number; d: number };
export type Hall = {
  width: number;
  depth: number;
  tables: Table[];
  stage: Rect;
  exit: { x: number; y: number };
  dance: Rect;
  /** Tables right in front of the stage, in the example ['t2', 't3']. */
  frontTables: string[];
};
export type Who =
  | { ref: 'name'; text: string }
  | { ref: 'group'; group: string }
  | { ref: 'side'; side: string }
  | { ref: 'age'; age: string };
export type Wish = {
  id: string;
  kind: 'apart' | 'together' | 'near' | 'far' | 'at-table';
  who: Who[];
  guests: string[];
  target?: 'exit' | 'stage' | 'dance' | { row: number } | { tables: string[] };
  strength: 'must' | 'prefer';
  source: { kind: 'letter' | 'note' | 'voice' | 'hand' | 'phone'; text: string };
  status: 'met' | 'partly' | 'broken' | 'needs-you' | 'impossible' | 'replaced';
  reason?: string;
};
export type Question = { id: string; wishId: string; text: string; options: string[] };
export type Seating = { assign: Record<string, { table: string; seat: number }>; locked: string[]; cost: number; iters: number };
export type SeatingResult = {
  guests: Guest[];
  hall: Hall;
  wishes: Wish[];
  questions: Question[];
  aliases: Record<string, string>;
  seating: Seating;
  rejected: CheckedItem[];
  stats: RunStats;
};
/** maxIters 40000 in the product; solveSeating is pure and deterministic by seed and maxIters. */
export type SolveInput = {
  guests: Guest[];
  hall: Hall;
  wishes: Wish[];
  locked: string[];
  previous?: Seating;
  seed: number;
  maxIters: number;
};

// ------------------------------------------------------------------ essays result

/** { id: 'evidence', name: 'Evidence', max: 6, ... } */
export type Criterion = { id: string; name: string; max: number; descriptors: string[] };
/** { type: 'evidence-vague', criterion: 'evidence', label: 'Vague evidence', price: { minor: 1, major: 2 } } */
export type TagSpec = { type: string; criterion: string; label: string; price: { minor: number; major: number } };
/** alias 'Student 07': only the alias goes to the model. Sentence ids look like 'e07.s12'. */
export type Essay = {
  id: string;
  student: string;
  alias: string;
  words: number;
  tooShort: boolean;
  sentences: { id: string; text: string }[];
};
export type ErrorTag = {
  id: string;
  essayId: string;
  type: string;
  severity: 'minor' | 'major';
  sentenceIds: string[];
  quote: string;
  note: string;
  status: 'active' | 'dismissed' | 'rejected';
};
export type EssayScore = {
  essayId: string;
  total: number;
  max: number;
  review: ('no-evidence' | 'sum-fixed' | 'similar' | 'too-short')[];
  byCriterion: Record<string, { score: number; max: number; modelSaid: number | null; override: number }>;
};
export type Feedback = { essayId: string; strength: { sentenceId: string; text: string }; revise: { tagId: string; advice: string }[] };
export type SimilarPair = { a: string; b: string; shared: [string, string][]; overlap: number };
/** The teacher's marks by criterion. */
export type Anchor = { essayId: string; marks: Record<string, number> };
/** essays and points: how many essays and points the rule changed. */
export type PriceRule = {
  tagType: string;
  minor: number;
  major: number;
  source: 'calibration' | 'hand' | 'voice';
  essays: number;
  points: number;
  editId: string;
};
export type EssaysResult = {
  title: string;
  rubric: Criterion[];
  specs: TagSpec[];
  essays: Essay[];
  tags: ErrorTag[];
  scores: EssayScore[];
  feedback: Feedback[];
  similar: SimilarPair[];
  anchors: Anchor[];
  rules: PriceRule[];
  classErrors: { type: string; label: string; essays: number }[];
  rejected: CheckedItem[];
  stats: RunStats;
};

// ------------------------------------------------------------------ model answer shapes (flat schemas)

/** wishes: the model's answer to one call. target.value: '', '1' or 't2,t3'. */
export type WishesAnswer = {
  wishes: {
    kind: 'apart' | 'together' | 'near' | 'far' | 'at-table';
    strength: 'must' | 'prefer';
    sourceText: string;
    who: { ref: 'name' | 'group' | 'side' | 'age'; value: string }[];
    target: { kind: 'none' | 'exit' | 'stage' | 'dance' | 'row' | 'tables'; value: string };
  }[];
};
/** mark: the model's answer to one call (one or two essays). */
export type MarkAnswer = {
  essays: {
    essayId: string;
    tags: { type: string; severity: 'minor' | 'major'; sentenceIds: string[]; quote: string; note: string }[];
    modelScores: { criterion: string; score: number }[];
    strength: { sentenceId: string };
    advice: { tagIndex: number; advice: string }[];
  }[];
};
/** recheck of essays. */
export type EssaysRecheckAnswer = {
  fixes: { tagRef: string; action: 'fix' | 'withdraw'; sentenceIds: string[]; quote: string }[];
};
/** recheck of the case. */
export type CaseRecheckAnswer = {
  fixes: { claimId: string; action: 'fix' | 'withdraw'; quote: string; page: number; date: string; actors: string[] }[];
  added: ExtractedEvent[];
};
/** reconcile: verdicts joined to candidates by pairKey. */
export type ReconcileAnswer = {
  verdicts: { pairKey: string; verdict: 'contradiction' | 'explained' | 'unsure'; explanation: string }[];
};
/** baseline.ts: the single comparison request to a chat. */
export type BaselineAnswer = {
  contradictions: { topic: string; a: { quote: string; page: number }; b: { quote: string; page: number } }[];
};

// ------------------------------------------------------------------ island, notes, codes

export type World = { name: string; title: string; createdAt: string; rev: number; plots: Plot[]; rotation: number; onServer: boolean };
/**
 * slot 0..7; slot 0 at rotation 0 stands in front of the person. tileRefs in laying
 * order; tile j carries tileRefs[j * perTile].
 */
export type Plot = {
  projectId: ProjectId;
  slug: string;
  slot: number;
  kind: JobKind;
  title: string;
  sample: boolean;
  visibility: 'private' | 'public';
  object: ObjectSpec;
  doneAt: string;
  tiles: number;
  perTile: number;
  seed: number;
  tileRefs: TileRef[];
  passes: number;
  open: number;
  total: number;
  flag: 'none' | 'pages' | 'deadline' | 'guest' | 'question' | 'stale';
};
/** notebooks.review: how many notebooks carry a clip. */
export type ObjectSpec =
  | { kind: 'case-stack'; pages: number; open: number; closed: number }
  | { kind: 'cake'; rows: number; tablesPerRow: number[] }
  | { kind: 'notebooks'; count: number; review: number };
export type Note = {
  id: string;
  projectId: ProjectId;
  at: string;
  by: 'late-pages' | 'deadline' | 'guest';
  kind: 'pages-arrived' | 'pages-read' | 'deadline' | 'guest-changes';
  text: string;
  read: boolean;
  diff?: { events: string[]; contradictions: string[]; resolved: string[]; rejected: number; pages: number };
};
/** Private plots carry only the first five fields. */
export type PublicWorld = {
  name: string;
  title: string;
  rev: number;
  plots: (Pick<Plot, 'slot' | 'kind' | 'visibility' | 'tiles' | 'seed'> &
    Partial<Pick<Plot, 'slug' | 'title' | 'object' | 'doneAt' | 'sample'>>)[];
};
/** Seating: names replaced by initials, no wishes. */
export type PublicProject = {
  world: string;
  slug: string;
  kind: JobKind;
  title: string;
  updatedAt: string;
  rev: number;
  result: CaseResult | SeatingResult | EssaysPublic;
  pages?: Page[];
};
export type EssaysPublic = {
  title: string;
  rubric: Criterion[];
  distribution: { total: number; essays: number }[];
  classErrors: EssaysResult['classErrors'];
  essays: number;
};

/** First letter of a code: D, F, W, X; J codes live only in PeerJS. */
export type CodeKind = 'drop' | 'files' | 'visit' | 'export';
/**
 * A code is a kind letter and 4 characters from 'ABCDEFGHJKMNPQRSTVWXYZ23456789',
 * for example 'X4KM7'.
 */
export type CodeRecord = {
  code: string;
  kind: CodeKind;
  createdAt: string;
  expiresAt: string;
  closed: boolean;
  /** visit: '<world>' or '<world>/<slug>'; files: the title of the case for the page. */
  target?: string;
  /** job: the kind of work chosen as the goal on the phone. */
  job?: JobKind;
  goal?: string;
  title?: string;
  summary?: ExportSummary;
  /** export: address of the Blob object with files { name, mime, base64 }[]. */
  bundleUrl?: string;
  /** text: a guest list pasted on the phone. */
  files: { name: string; mime: string; bytes: number; url?: string; text?: string }[];
};
export type SummarySide = { who: string; date: string; quote: string; doc: string; page: number };
export type ExportSummary =
  | {
      kind: 'case';
      headline: string;
      rows: { issue: string; a: SummarySide; b: SummarySide; type: 'Direct conflict' | 'Needs judgment'; review: string }[];
    }
  | { kind: 'seating'; headline: string; tables: { label: string; guests: string[] }[] }
  | {
      kind: 'essays';
      headline: string;
      rows: { student: string; total: number; max: number; review: string }[];
      classErrors: { label: string; essays: number }[];
    };
/** Each line up to 25 characters. */
export type EnvelopeSpec = {
  id: string;
  kind: 'sample' | 'files' | 'late' | 'code';
  lines: [string, string];
  example?: ExampleId;
  projectId?: ProjectId;
  job?: JobKind;
};

// ------------------------------------------------------------------ seating for two

/** name up to 12 characters, 'Guest' by default. */
export type Seat = { role: 'owner' | 'guest'; device: 'headset' | 'desktop' | 'phone'; name: string };
export type Op =
  | { kind: 'seat-move'; guestId: string; tableId: string; party: boolean }
  | { kind: 'seat-lock'; guestId: string; locked: boolean }
  | { kind: 'wish-add'; wish: Wish }
  | { kind: 'wish-answer'; questionId: string; option: string }
  | { kind: 'guest-coming'; guestId: string; coming: boolean }
  | { kind: 'undo' };
export type SyncMsg =
  | { t: 'hello'; seat: Seat; rev: number }
  | { t: 'state'; project: Project; rev: number }
  | { t: 'op'; id: string; base: number; op: Op } // guest to owner
  | {
      t: 'applied';
      id: string;
      rev: number;
      op: Op;
      by: Seat['role'];
      changes: Record<string, { table: string; seat: number }>;
      wishes: Record<string, Wish['status']>;
      text: string; // owner to everyone; text for captions
    }
  | { t: 'rejected'; id: string; reason: 'stale' | 'locked' | 'held' | 'invalid'; text: string }
  | { t: 'hold'; guestId: string; on: boolean }
  | { t: 'focus'; itemId: string | null }
  | { t: 'ray'; origin: number[]; dir: number[] }
  | { t: 'away' }
  | { t: 'back' }
  | { t: 'bye' };

// ------------------------------------------------------------------ settings, modes, views

export type Settings = {
  sound: boolean;
  captions: boolean;
  highContrast: boolean;
  lessMotion: boolean;
  largeText: boolean;
  dwell: boolean;
  dwellMs: 600 | 800 | 1200;
};
/** desk: an ordinary browser without a session. */
export type Mode = 'desk' | 'void' | 'room';
export type View = 'home' | 'run' | 'timeline' | 'seating' | 'essays' | 'visit';
export type InputKind = 'hand' | 'ray' | 'gaze' | 'dwell' | 'mouse';

// ------------------------------------------------------------------ intents and commands

export type Intent =
  | { kind: 'timeline-filter'; filter: TimelineFilter }
  | { kind: 'timeline-reset' }
  | { kind: 'open-page'; page: number }
  | { kind: 'pair-next' }
  | { kind: 'pair-prev' }
  | { kind: 'pair-review'; verdict: 'kept' | 'dismissed' }
  | { kind: 'run'; action: 'stop' | 'skip' | 'live' | 'explain-last' }
  | { kind: 'answer'; optionId: string }
  | { kind: 'summary' } // "what is this case about": a line from the counters
  | { kind: 'seat-wish'; wish: Omit<Wish, 'id' | 'status' | 'guests'> }
  | { kind: 'seat-move'; guest: string; table: string }
  | { kind: 'seat-explain'; guest: string }
  | { kind: 'guest-coming'; guest: string; coming: boolean }
  | { kind: 'undo' }
  | { kind: 'essay-open'; student: string }
  | { kind: 'essays-show-tag'; tagType: string }
  | { kind: 'tag-price'; tagType: string; minor: number; major?: number }
  | { kind: 'tag-dismiss' }
  | { kind: 'score-override'; criterion: string; delta: number }
  | { kind: 'island'; action: 'back' | 'show' | 'whats-new' | 'next-note' | 'turn-left' | 'turn-right'; target?: string }
  | { kind: 'mode'; mode: 'void' | 'room' }
  | { kind: 'export' }
  | { kind: 'recenter' }
  | { kind: 'setting'; key: keyof Settings; value: boolean | number }
  | { kind: 'onboarding'; action: 'skip' | 'again' }
  | { kind: 'clarify'; question: string; options: string[] } // "Which Rosa?"
  | { kind: 'none'; reply: string }; // off topic: what this view can do

/** Student names stay on the device: only the alias goes to the model. */
export type VoiceContext = {
  view: View;
  parties?: Party[];
  topics?: string[];
  window?: { from: string; to: string };
  guests?: Pick<Guest, 'id' | 'name' | 'group' | 'side' | 'relation'>[];
  tables?: string[];
  plots?: { slug: string; title: string }[];
  students?: { alias: string; name: string }[];
  tagTypes?: { type: string; label: string }[];
  criteria?: string[];
  ask?: OpenAsk;
};

/**
 * apply returns a caption line or a clarification; after the person picks, the
 * dispatcher calls apply again with pick. commands(): buttons of the fan; say goes
 * through parseCommand.
 */
export type IntentHandler = {
  view: View | '*';
  kinds: Intent['kind'][];
  context(): VoiceContext;
  commands(): { label: string; say: string }[];
  apply(intent: Intent, pick?: string): Promise<string | { clarify: { question: string; options: string[] } }>;
};
