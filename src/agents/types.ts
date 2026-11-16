/**
 * The shared domain contract of Groundwork (PLAN "Контракты", general engine).
 *
 * One kind of work: a task. A person gives a goal in words, optionally with files and
 * links; the planner turns it into 4–12 steps from the step library; the runner executes
 * them as a stream of events; code checks every unit it can before the person sees it;
 * the result is a real deliverable (a site or web app, a document, a plan) and an object
 * on the island.
 *
 * Types only, no code: the same file is read by the browser, by Node scripts and by the
 * server functions (api/_lib/contracts.ts re-exports the model exchange types from here).
 *
 * The section "Legacy" at the end keeps the types of the removed case, seating and essays
 * pipelines that the view still imports. The engine no longer produces them; the view
 * moves to TaskResult and the integration package deletes that section.
 */

// ------------------------------------------------------------------ task, project, materials

export type SampleId = 'bakery-site' | 'habit-tracker' | 'launch-plan';
/** site: a site or a web app with a preview; document: sections; plan: dated items with owners. */
export type DeliverableKind = 'site' | 'document' | 'plan';
/** 'p_' + 12 base32 characters, for example 'p_k7qm2r9tz4vx'. */
export type ProjectId = string;

/** What the engine is given. files: already read into pages (src/materials/read.ts). */
export type Task = { goal: string; files: Doc[]; links: string[] };
export type TaskInput = { text: string; by: 'voice' | 'typed' | 'phone' | 'sample'; links: string[] };

export type Project = {
  id: ProjectId;
  /** The planner's short project name ('Marlow Street Bakery'). */
  title: string;
  task: TaskInput;
  sample?: SampleId;
  slug: string;
  createdAt: string;
  updatedAt: string;
  /** Grows with every edit. */
  rev: number;
  firstRunAt: string | null;
  visibility: 'private' | 'public';
  status: 'draft' | 'planning' | 'running' | 'ready' | 'partial' | 'stale' | 'failed' | 'declined';
  materials: MaterialRef[];
  /** sha256 of the normalized text of all pages. */
  materialHash: string;
  runId: string | null;
  passes: number;
  result: TaskResult | LegacyResult | null;
  edits: Edit[];
  notes: Note[];
  /** @deprecated legacy fields of the removed pipelines; the view moves to `task` and `sample`. */
  kind?: JobKind;
  goal?: string;
  example?: ExampleId;
};

export type MaterialRef = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  pages?: number;
  sha256: string;
  source: 'sample' | 'drop' | 'link' | 'added' | 'example' | 'late';
  url?: string;
  addedAt: string;
  readAt: string | null;
};

export type DocKind =
  | 'notes'
  | 'brief'
  | 'table'
  | 'email'
  | 'page'
  | 'web'
  | 'file'
  | 'image'
  // kinds of the removed case documents, still drawn by the material sheets
  | 'lease'
  | 'messages'
  | 'log'
  | 'statement'
  | 'report'
  | 'letter'
  | 'receipt'
  | 'notice'
  | 'essay';

export type DocMeta = { id: string; title: string; kind: DocKind; from: number; to: number; date?: string; url?: string; author?: string };
export type Block = { k: 'head' | 'p' | 'msg' | 'row' | 'item' | 'clause' | 'sig'; text: string; who?: string; at?: string };
/** n counts from 1 across the project; text = blocks.map(blockText).join('\n') (src/materials/text.ts). noText: a scanned PDF page. */
export type Page = { docId: string; n: number; text: string; blocks?: Block[]; noText?: boolean };
/** asset: an image kept as a file; agents don't read pictures. */
export type Doc = {
  meta: DocMeta;
  pages: Page[];
  scanned?: boolean;
  asset?: { mime: string; bytes: number; width: number; height: number; data: Blob | string };
};

export type SampleMeta = {
  id: SampleId;
  title: string;
  /** The goal as the person would say it. */
  task: string;
  /** Two lines of the mailbox envelope, each up to 25 characters. */
  label: [string, string];
  deliverable: DeliverableKind;
  object: ObjectId;
  materialHash: string;
};

// ------------------------------------------------------------------ step library and plan

export type StepKind =
  | 'ask'
  | 'read'
  | 'research'
  | 'compare'
  | 'decide'
  | 'write-section'
  | 'write-code'
  | 'make-plan'
  | 'review'
  | 'check'
  | 'assemble';
/** Roles that call the model; the instruments of the view are drawn by role. */
export type AgentRole = 'planner' | 'researcher' | 'analyst' | 'writer' | 'builder' | 'reviewer' | LegacyRole;
/** What a step hands on. */
export type OutputKind = 'answer' | 'pages' | 'findings' | 'table' | 'decision' | 'section' | 'files' | 'items' | 'critique' | 'checks' | 'deliverable';
export type CheckName =
  | 'quote'
  | 'numbers'
  | 'dates'
  | 'sums'
  | 'schema'
  | 'parse'
  | 'refs'
  | 'required'
  | 'links'
  | 'plan-table'
  | 'dedupe';
export type MechanismKind = 'cutter' | 'gate' | 'assembly';

export type StepSpec = {
  kind: StepKind;
  by: 'model' | 'code' | 'human';
  role?: AgentRole;
  mechanism?: MechanismKind;
  /** Default title of the station sign, up to 14 characters. */
  label: string;
  /** One line for the planner. */
  does: string;
  output: OutputKind;
  unit: UnitKind;
  checks: CheckName[];
};

export type PlanColumn = { name: string; type: 'text' | 'date' | 'number' | 'money' | 'person' | 'duration' };
export type StepArgs = {
  focus?: string;
  /** write-code: the files of this step; the first .html is index.html. */
  files?: { path: string; purpose: string }[];
  /** write-section: headings of the sections this step writes. */
  sections?: string[];
  /** make-plan: extra columns beyond task, owner, start, end, depends. */
  columns?: PlanColumn[];
  /** compare and decide. */
  options?: string[];
  criteria?: string[];
  /** write-code: parts the page must have, as "what" and a CSS selector. */
  required?: { what: string; selector: string }[];
  /** ask. */
  question?: { text: string; options: string[] };
};
export type PlanStep = {
  /** s1 … s12 in order. */
  id: string;
  kind: StepKind;
  /** The station sign, up to 18 characters. */
  title: string;
  does: string;
  /** Earlier step ids, or 'materials'. */
  uses: string[];
  args: StepArgs;
  output: OutputKind;
  checks: CheckName[];
  /** Up to six acceptance points in the planner's words. */
  done: string[];
};
/** The world kit's object kinds. */
export type ObjectId = 'house' | 'folder' | 'globe' | 'ledger' | 'toolbox' | 'map' | 'letters' | 'lamp' | 'chart' | 'case-stack' | 'cake' | 'notebooks';
export type Plan = {
  understood: string;
  /** Short project name, up to 40 characters. */
  title: string;
  deliverable: DeliverableKind;
  fit: 'yes' | 'partly' | 'no' | 'unclear';
  notDoable: string;
  instead: string;
  object: ObjectId;
  objectWhy: string;
  /** The window of a plan ('' when none was stated). */
  window: { from: string; to: string } | null;
  /** People named in the goal or the materials (owners of plan items). */
  team: string[];
  steps: PlanStep[];
  /** Lines for the plan card: what code will check and what only an agent reads. */
  checkable: string[];
  agentOnly: string[];
  /** Estimated model calls. */
  calls: number;
  tilesPlanned: number;
};

// ------------------------------------------------------------------ run and events

export type LlmTask = 'plan' | 'step' | 'recheck' | 'intent' | 'dictate' | LegacyLlmTask;
export type Provider = 'openrouter' | 'gemini' | 'fixtures';
export type Answers = 'live' | 'recorded' | 'scripted';
export type UnitKind = 'answer' | 'page' | 'note' | 'row' | 'decision' | 'section' | 'file' | 'item' | 'issue' | 'element';
export type TileRef = { kind: UnitKind | LegacyTileKind; id: string };
/** id equals PlanStep.id; the planner on the parking is not a station. */
export type Station = {
  id: string;
  step: StepKind | LegacyStepKind;
  label: string;
  by: 'model' | 'code' | 'human';
  role?: AgentRole;
  mechanism?: MechanismKind;
  uses?: string[];
  output?: OutputKind;
};

export type RunScope = 'full' | { redo: string; instruction: string; preset?: string } | { pages: number[] };

/** t: ms from the start of the run. */
export type RunEvent = { runId: string; seq: number; t: number } & (
  | {
      type: 'run-start';
      sample?: SampleId;
      scope: RunScope;
      answers: Answers;
      provider: Provider | 'script' | null;
      model: string | null;
      recordedAt?: string;
      /** Mistakes code planted into the recorded answers; seeded: fakes added to a live run. */
      planted: number;
      seeded: number;
      /** The caption line under the run ("Recorded answers from a live run, checks run now"). */
      label: string;
    }
  | {
      type: 'plan';
      stations: Station[];
      budget: number;
      lines: string[];
      tilesPlanned: number;
      object: ObjectId;
      title: string;
      deliverable: DeliverableKind;
      fit: Plan['fit'];
      understood: string;
    }
  | { type: 'step-start'; station: string }
  | { type: 'progress'; station: string; done: number; total: number; unit: 'pages' | 'units' | 'files' | 'checks' | 'rows' | 'calls' }
  | {
      type: 'call-start';
      station: string;
      callId: string;
      task: LlmTask;
      role: AgentRole;
      index: number;
      attempt: number;
      /** What this call works on: a file path, a section heading, 'fix 2 items'. */
      what?: string;
      pages?: [number, number];
      chars: number;
    }
  | { type: 'call-end'; station: string; callId: string; ms: number; ok: boolean; items?: number; code?: RunErrorCode }
  | { type: 'waiting'; station: string; callId?: string; reason: 'rate-limited' | 'provider-busy' | 'offline'; retryInMs: number }
  | { type: 'item'; station: string; item: CheckedItem }
  | { type: 'tile'; station: string; i: number; ref: TileRef }
  | { type: 'card'; station: string; card: StepCard }
  | {
      type: 'ask';
      station: string;
      askId: string;
      question: string;
      options: { id: string; label: string }[];
      defaultId: string;
      timeoutMs: number;
    }
  | { type: 'answer'; askId: string; optionId: string | null; by: 'hand' | 'voice' | 'gaze' | 'mouse' | 'guest' | 'timeout' }
  | { type: 'note'; station: string; source: string; text: string; key?: boolean }
  | { type: 'fallback'; to: 'recorded'; reason: RunErrorCode }
  | { type: 'step-end'; station: string; summary: Record<string, number> }
  | { type: 'error'; station: string; code: RunErrorCode; retryable: boolean; pages?: [number, number] }
  | { type: 'run-end'; status: 'ready' | 'partial' | 'failed' | 'cancelled' | 'declined'; calls: number; stats: RunStats }
);

export type RunErrorCode = 'agents-offline' | 'provider-error' | 'timeout' | 'bad-output' | 'budget' | 'daily-cap' | 'material' | 'offline';

/**
 * One decision of the gate about one unit. First check: accepted | corrected | merged |
 * rejected; after the second look the same id: fixed | dropped.
 */
export type CheckedItem = {
  id: string;
  kind: UnitKind | LegacyItemKind;
  station?: string;
  status: 'accepted' | 'corrected' | 'merged' | 'rejected' | 'fixed' | 'dropped';
  reason?: RejectReason;
  /** All problems code found, readable: '"$4.75" isn't in the notes. They say $4.50.' */
  problems?: string[];
  dropCause?: 'withdrawn' | 'failed-again' | 'budget' | 'not-recorded' | 'seeded';
  claim: string;
  unitId?: string;
  /** checked: code checked it; agent: nothing code can check ("Reviewed by an agent"). */
  label?: 'checked' | 'agent';
  checks?: CheckName[];
  batch?: number;
  /** A mistake code planted into the recorded answers; seeded: a fake added to a live run. */
  planted?: boolean;
  seeded?: boolean;
  ref?: { docId: string; page: number } | { file: string; line?: number } | { url: string };
  found?: { text: string; page?: number };
  diff?: { claim: string; source: string; marks?: { claim: number[]; source: number[] } };
  spans?: QuoteSpan[];
  /** @deprecated legacy case fields. */
  eventId?: string;
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
  | 'duplicate'
  | 'number-not-in-source'
  | 'sum-mismatch'
  | 'schema-mismatch'
  | 'parse-error'
  | 'missing-file'
  | 'missing-asset'
  | 'element-missing'
  | 'required-missing'
  | 'broken-link'
  | 'date-order'
  | 'date-out-of-range'
  | 'order-broken'
  | 'owner-unknown'
  | 'from-unknown'
  | 'step-unknown'
  | 'agent-redo'
  | LegacyReason;

/**
 * The numbers of the gate and of the work sheet:
 *   units    = matched + corrected + merged + sentBack
 *   sentBack = fixed + dropped
 *   kept     = matched + corrected + fixed
 * Units of the agent only (nothing to check) are counted in `agentOnly`, inside `matched`.
 */
export type RunStats = {
  pages: number;
  calls: Partial<Record<LlmTask, number>>;
  modelMs: number;
  checkMs: number;
  steps: number;
  units: number;
  matched: number;
  corrected: number;
  merged: number;
  sentBack: number;
  fixed: number;
  dropped: number;
  kept: number;
  agentOnly: number;
  checked: number;
  files: number;
  required: number;
  requiredFound: number;
  asked: number;
  planted: number;
  seeded: number;
  caught: number;
  tiles: number;
  redos: number;
  /** @deprecated legacy case numbers, kept 0. */
  pagesUnread?: number[];
  claims?: number;
  events?: number;
  added?: number;
};

/** provider 'script': written by hand. redo: the key of a ready redo ('s4:warmer'). */
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
  /** Indices (into the answer's list) of mistakes code planted into this answer. */
  planted?: number[];
  seeded?: number[];
  redo?: string;
  /** USD of this call as the provider billed it (recordings only). */
  usd?: number;
};

/** example: the sample id (the name is kept for the dev server's fixture reader). */
export type AnswerSet = {
  example: SampleId | string;
  scope: 'full' | 'late';
  answers: 'scripted' | 'recorded';
  recordedAt?: string;
  model?: string;
  seeded?: number;
  materialHash: string;
  /** Ready redos recorded with the set: step id, preset key and the instruction. */
  redos?: { stepId: string; preset: string; instruction: string }[];
  calls: CallRecord[];
};

export type RunRecord = {
  id: string;
  sample?: SampleId;
  projectId: ProjectId;
  scope: RunScope;
  startedAt: string;
  answers: Answers;
  provider: Provider | 'script' | null;
  model: string | null;
  status: 'running' | 'ready' | 'partial' | 'failed' | 'cancelled' | 'declined';
  calls: CallRecord[];
  events: RunEvent[];
  /** Results of finished steps by key (read on resume). */
  partial: Record<string, unknown>;
  asks: Record<string, string | null>;
  result: TaskResult | null;
  stats: RunStats | null;
  /** @deprecated */
  job?: JobKind;
  example?: ExampleId;
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
 * payload and redo stay on the client (recordedLlm finds ready redos by redo); everything
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
  redo?: string;
};

export type LlmResponse = {
  json: unknown;
  provider: Provider | 'script';
  model: string;
  ms: number;
  planted?: number[];
  seeded?: number[];
  missing?: boolean;
};
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

export type RunDeps = {
  llm: LlmClient;
  store: RunStore;
  now(): number;
  fallback?: AnswerSet;
  locks?: LockManager;
  timers?: { set(fn: () => void, ms: number): number; clear(id: number): void };
};

/**
 * One run. answers: 'live' calls the model; an AnswerSet replays it. seed: a live run
 * plants mistakes by code into fresh answers (recording of samples). previous: the result
 * a redo starts from.
 */
export type RunSpec = {
  project: Project;
  docs: Doc[];
  scope: RunScope;
  answers: 'live' | AnswerSet;
  seed?: boolean;
  pace?: number;
  previous?: TaskResult;
  /** Today, for plans: 'YYYY-MM-DD' (default: the clock's date). */
  today?: string;
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

// ------------------------------------------------------------------ task result

/** A piece of a step's output that the gate decides about and that may become a tile. */
export type Unit = {
  id: string;
  stepId: string;
  kind: UnitKind;
  title: string;
  body: string;
  quote?: { text: string; source: { docId: string; docTitle: string; page: number } | { url: string } };
  /** Units this one rests on (fact ids of a section, rows a row depends on). */
  from?: string[];
  /** Numbers and dates that passed the numbers check. */
  values?: { label: string; value: string }[];
  /** File units: the path. Row units: the cells. */
  path?: string;
  cells?: Record<string, string>;
  status: 'checked' | 'corrected' | 'fixed' | 'agent' | 'restored' | 'edited';
  checks: CheckName[];
  version: number;
};

export type StepCard = {
  stepId: string;
  kind: StepKind;
  title: string;
  state: 'waiting' | 'running' | 'done' | 'redoing' | 'stale' | 'failed' | 'skipped';
  review: 'none' | 'approved' | 'redo';
  /** A line from the counters: '9 facts from 1 file'. */
  summary: string;
  /** Lines of the two columns "Checked by code" and "Reviewed by an agent". */
  checked: string[];
  agentOnly: string[];
  counts: { units: number; checked: number; agent: number; sentBack: number; fixed: number; dropped: number };
  calls: number;
  ms: number;
  instruction?: string;
  version: number;
};

export type SiteFile = { path: string; mime: string; text: string; bytes: number; checks: CheckName[]; ok: boolean };
export type LoadReport = {
  ok: boolean;
  errors: { kind: 'parse-error' | 'element-missing' | 'missing-asset' | 'missing-file' | 'broken-link' | 'required-missing'; text: string; file?: string; line?: number }[];
  required: { what: string; selector: string; found: boolean }[];
};
export type PlanItem = {
  id: string;
  task: string;
  owner: string;
  start: string;
  end: string;
  depends: string[];
  cells: Record<string, string>;
  units: string[];
};
export type Deliverable =
  | {
      kind: 'site';
      title: string;
      entry: 'index.html';
      files: SiteFile[];
      load: LoadReport;
      /** sampleUrl: '/samples/<id>/' for a sample; code: the short code of an uploaded live project. */
      preview: { code: string | null; sampleUrl: string | null };
      version: number;
    }
  | { kind: 'document'; title: string; sections: { id: string; heading: string; text: string; units: string[]; sources: string[] }[]; version: number }
  | {
      kind: 'plan';
      title: string;
      columns: PlanColumn[];
      items: PlanItem[];
      totals: { column: string; value: string; stated: string; ok: boolean }[];
      window: { from: string; to: string } | null;
      team: string[];
      version: number;
    };
export type OpenAsk = { askId: string; question: string; options: { id: string; label: string }[]; defaultId?: string; pair?: [string, string] };
/** What a finished step handed on: kept so a redo can tell what changed downstream. */
export type StepResult = { stepId: string; hash: string; units: string[]; text: string; files?: SiteFile[] };
export type TaskResult = {
  plan: Plan;
  cards: StepCard[];
  units: Unit[];
  deliverable: Deliverable | null;
  open: OpenAsk[];
  /** Everything that was not simply accepted. */
  audit: CheckedItem[];
  /** The part of audit that ended dropped; a unit-restore edit can bring one back. */
  rejected: CheckedItem[];
  /** Agent-only critique of review steps. */
  reviews: { stepId: string; text: string; severity: 'minor' | 'major' }[];
  outputs: Record<string, StepResult>;
  /** Answers to asks, by ask id. */
  answers: Record<string, string>;
  /** The caption of the run: "Recorded answers from a live run, checks run now". */
  label: string;
  stats: RunStats;
  version: number;
};

export type Edit = {
  id: string;
  at: string;
  by: 'me' | 'guest';
  byName?: string;
  source: 'hand' | 'voice' | 'gaze' | 'mouse' | 'phone' | 'calibration';
} & (
  | { kind: 'step-review'; stepId: string; verdict: 'approved' | 'cleared' }
  | { kind: 'step-redo'; stepId: string; instruction: string; preset?: string; runId: string }
  | { kind: 'ask-answer'; askId: string; optionId: string }
  | { kind: 'unit-restore'; itemId: string }
  | { kind: 'unit-edit'; unitId: string; text: string }
  | { kind: 'row-edit'; rowId: string; column: string; value: string }
  // legacy edits of the removed pipelines
  | { kind: 'pair-review'; key: string; verdict: 'kept' | 'dismissed' | 'reopened' | 'cleared' }
  | { kind: 'event-restore'; itemId: string }
  | { kind: 'seat-move'; guestId: string; tableId: string; party: boolean }
  | { kind: 'seat-lock'; guestId: string; locked: boolean }
  | { kind: 'wish-add'; wish: Wish }
  | { kind: 'wish-answer'; questionId: string; option: string }
  | { kind: 'guest-coming'; guestId: string; coming: boolean }
  | { kind: 'tag-price'; tagType: string; minor: number; major: number }
  | { kind: 'tag-dismiss'; tagId: string }
  | { kind: 'score-override'; essayId: string; criterion: string; delta: number; reason: string }
  | { kind: 'anchor-marks'; essayId: string; marks: Record<string, number> }
);

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
/** The kit's own shapes; the library kinds (house, folder, …) are LibrarySpec of src/kit/world/objects/library.ts. */
export type ObjectSpec =
  | { kind: 'case-stack'; pages: number; open: number; closed: number }
  | { kind: 'cake'; rows: number; tablesPerRow: number[] }
  | { kind: 'notebooks'; count: number; review: number };
export type Note = {
  id: string;
  projectId: ProjectId;
  at: string;
  by: 'late-pages' | 'deadline' | 'guest' | 'agents';
  kind: 'pages-arrived' | 'pages-read' | 'deadline' | 'guest-changes' | 'redo-done';
  text: string;
  read: boolean;
  diff?: { events: string[]; contradictions: string[]; resolved: string[]; rejected: number; pages: number };
};
/** Private plots carry only the first five fields. */
export type PublicWorld = {
  name: string;
  title: string;
  rev: number;
  plots: (Pick<Plot, 'slot' | 'kind' | 'visibility' | 'tiles' | 'seed'> & Partial<Pick<Plot, 'slug' | 'title' | 'object' | 'doneAt' | 'sample'>>)[];
};
export type PublicProject = {
  world: string;
  slug: string;
  kind: JobKind;
  title: string;
  updatedAt: string;
  rev: number;
  result: TaskResult | CaseResult | SeatingResult | EssaysPublic;
  pages?: Page[];
};

/** First letter of a code: D, F, W, X, R (a site preview); J codes live only in PeerJS. */
export type CodeKind = 'drop' | 'files' | 'visit' | 'export';
export type CodeRecord = {
  code: string;
  kind: CodeKind;
  createdAt: string;
  expiresAt: string;
  closed: boolean;
  target?: string;
  job?: JobKind;
  goal?: string;
  title?: string;
  summary?: ExportSummary;
  bundleUrl?: string;
  files: { name: string; mime: string; bytes: number; url?: string; text?: string }[];
};
export type SummarySide = { who: string; date: string; quote: string; doc: string; page: number };
export type ExportSummary =
  | { kind: 'task'; headline: string; deliverable: DeliverableKind; lines: string[] }
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
  sample?: SampleId;
  example?: ExampleId;
  projectId?: ProjectId;
  job?: JobKind;
};

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
export type View = 'home' | 'run' | 'result' | 'timeline' | 'seating' | 'essays' | 'visit';
export type InputKind = 'hand' | 'ray' | 'gaze' | 'dwell' | 'mouse';

// ------------------------------------------------------------------ seating for two (sync)

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
  | { t: 'op'; id: string; base: number; op: Op }
  | {
      t: 'applied';
      id: string;
      rev: number;
      op: Op;
      by: Seat['role'];
      changes: Record<string, { table: string; seat: number }>;
      wishes: Record<string, Wish['status']>;
      text: string;
    }
  | { t: 'rejected'; id: string; reason: 'stale' | 'locked' | 'held' | 'invalid'; text: string }
  | { t: 'hold'; guestId: string; on: boolean }
  | { t: 'focus'; itemId: string | null }
  | { t: 'ray'; origin: number[]; dir: number[] }
  | { t: 'away' }
  | { t: 'back' }
  | { t: 'bye' };

// ------------------------------------------------------------------ intents and commands

export type Intent =
  | { kind: 'step-approve'; stepId?: string }
  | { kind: 'step-redo'; stepId?: string; instruction: string }
  | { kind: 'timeline-filter'; filter: TimelineFilter }
  | { kind: 'timeline-reset' }
  | { kind: 'open-page'; page: number }
  | { kind: 'pair-next' }
  | { kind: 'pair-prev' }
  | { kind: 'pair-review'; verdict: 'kept' | 'dismissed' }
  | { kind: 'run'; action: 'stop' | 'skip' | 'live' | 'explain-last' }
  | { kind: 'answer'; optionId: string }
  | { kind: 'summary' }
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
  | { kind: 'clarify'; question: string; options: string[] }
  | { kind: 'none'; reply: string };

export type VoiceContext = {
  view: View;
  steps?: { id: string; title: string }[];
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

export type IntentHandler = {
  view: View | '*';
  kinds: Intent['kind'][];
  context(): VoiceContext;
  commands(): { label: string; say: string }[];
  apply(intent: Intent, pick?: string): Promise<string | { clarify: { question: string; options: string[] } }>;
};

// ------------------------------------------------------------------ Legacy
// Types of the removed case, seating and essays pipelines. Nothing in src/agents produces
// them any more; they stay only while the view still imports them.

/** @deprecated the general engine has one kind of work: 'task'. */
export type JobKind = 'task' | 'case' | 'seating' | 'essays';
/** @deprecated use SampleId. */
export type ExampleId = SampleId | 'harbor-street' | 'wedding' | 'class-9b';
export type LegacyRole = 'extractor' | 'reconciler' | 'wishes' | 'marker';
export type LegacyStepKind = 'extract' | 'verify' | 'reconcile' | 'wishes' | 'solve' | 'mark' | 'calibrate';
export type LegacyLlmTask = 'extract' | 'reconcile' | 'wishes' | 'mark';
export type LegacyTileKind = 'event' | 'guest' | 'tag';
export type LegacyItemKind = 'claim' | 'fact' | 'pair' | 'guest' | 'wish' | 'tag' | 'score';
export type LegacyReason =
  | 'unknown-actor'
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
export type LegacyResult = CaseResult | SeatingResult | EssaysResult | EssaysPublic;
export type ExampleMeta = {
  id: ExampleId;
  kind: JobKind;
  title: string;
  goal: string;
  label: [string, string];
  materialHash: string;
  pdfTextHash?: string;
};

export type Party = { id: string; name: string; role: string; aliases: string[] };
export type FactField = { id: string; topic: string; type: 'date' | 'amount' | 'time' | 'yesno' | 'presence'; question: string };
export type Fact = { field: string; type: FactField['type']; value: string; basis: 'literal' | 'derived'; subject?: string; from?: string; to?: string };
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
  audit: CheckedItem[];
  rejected: CheckedItem[];
  window: { from: string; to: string };
  deadlines: Deadline[];
  stats: RunStats;
};
export type TimelineFilter = { parties?: string[]; from?: string; to?: string; contradictionsOnly?: boolean; topic?: string };

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
export type Table = { id: string; label: string; seats: number; x: number; y: number; row: number };
export type Rect = { x: number; y: number; w: number; d: number };
export type Hall = { width: number; depth: number; tables: Table[]; stage: Rect; exit: { x: number; y: number }; dance: Rect; frontTables: string[] };
export type Who = { ref: 'name'; text: string } | { ref: 'group'; group: string } | { ref: 'side'; side: string } | { ref: 'age'; age: string };
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

export type Criterion = { id: string; name: string; max: number; descriptors: string[] };
export type TagSpec = { type: string; criterion: string; label: string; price: { minor: number; major: number } };
export type Essay = { id: string; student: string; alias: string; words: number; tooShort: boolean; sentences: { id: string; text: string }[] };
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
export type Anchor = { essayId: string; marks: Record<string, number> };
export type PriceRule = { tagType: string; minor: number; major: number; source: 'calibration' | 'hand' | 'voice'; essays: number; points: number; editId: string };
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
export type EssaysPublic = {
  title: string;
  rubric: Criterion[];
  distribution: { total: number; essays: number }[];
  classErrors: EssaysResult['classErrors'];
  essays: number;
};
