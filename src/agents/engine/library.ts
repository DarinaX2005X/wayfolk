/**
 * The step library: every station a plan may have. The planner picks from it; code
 * checks the plan against it (plan-check.ts) and fills each step's output kind and
 * checks from here, so a plan cannot invent a step or skip a check.
 */
import type { CheckName, DeliverableKind, ObjectId, StepKind, StepSpec } from '../types';

export const STEP_LIBRARY: Record<StepKind, StepSpec> = {
  ask: {
    kind: 'ask',
    by: 'human',
    label: 'Ask',
    does: 'Ask the person one question with 2–4 options when the goal can be read in different ways',
    output: 'answer',
    unit: 'answer',
    checks: [],
  },
  read: {
    kind: 'read',
    by: 'code',
    mechanism: 'cutter',
    label: 'Read',
    does: 'Read the given files into numbered pages (code, always first when there are files)',
    output: 'pages',
    unit: 'page',
    checks: [],
  },
  research: {
    kind: 'research',
    by: 'model',
    role: 'researcher',
    label: 'Find facts',
    does: 'Find facts in the materials, each with a word-for-word quote and its page',
    output: 'findings',
    unit: 'note',
    checks: ['quote', 'numbers', 'dates', 'dedupe'],
  },
  compare: {
    kind: 'compare',
    by: 'model',
    role: 'analyst',
    label: 'Compare',
    does: 'Compare options against criteria in a table, each cell backed by a quote when the materials have one',
    output: 'table',
    unit: 'row',
    checks: ['quote', 'numbers'],
  },
  decide: {
    kind: 'decide',
    by: 'model',
    role: 'analyst',
    label: 'Decide',
    does: 'Choose one option with reasons that point at earlier facts or rows',
    output: 'decision',
    unit: 'decision',
    checks: ['numbers'],
  },
  'write-section': {
    kind: 'write-section',
    by: 'model',
    role: 'writer',
    label: 'Write',
    does: 'Write sections of a document; every number must come from the facts or materials',
    output: 'section',
    unit: 'section',
    checks: ['numbers', 'quote', 'links'],
  },
  'write-code': {
    kind: 'write-code',
    by: 'model',
    role: 'builder',
    label: 'Build',
    does: 'Write the files of a web page or web app (index.html first, then CSS and JS)',
    output: 'files',
    unit: 'file',
    checks: ['parse', 'refs', 'required', 'links', 'numbers'],
  },
  'make-plan': {
    kind: 'make-plan',
    by: 'model',
    role: 'analyst',
    label: 'Make plan',
    does: 'Write plan items with a task, an owner from the team, start and end dates, and dependencies',
    output: 'items',
    unit: 'item',
    checks: ['plan-table', 'dates', 'sums', 'numbers'],
  },
  review: {
    kind: 'review',
    by: 'model',
    role: 'reviewer',
    label: 'Review',
    does: 'Read earlier output as a critical colleague and list what is weak or missing (agent judgement)',
    output: 'critique',
    unit: 'issue',
    checks: [],
  },
  check: {
    kind: 'check',
    by: 'code',
    mechanism: 'gate',
    label: 'Check',
    does: 'Check the whole result by code: pages parse, links and files resolve, required parts are there',
    output: 'checks',
    unit: 'element',
    checks: ['parse', 'refs', 'required', 'links'],
  },
  assemble: {
    kind: 'assemble',
    by: 'code',
    mechanism: 'assembly',
    label: 'Assemble',
    does: 'Put the deliverable together (code, always last)',
    output: 'deliverable',
    unit: 'item',
    checks: ['sums'],
  },
};

export const STEP_KINDS = Object.keys(STEP_LIBRARY) as StepKind[];
/** Kinds the planner may choose; read, check and assemble are also added by code. */
export const PLANNER_KINDS: StepKind[] = ['ask', 'research', 'compare', 'decide', 'write-section', 'write-code', 'make-plan', 'review', 'check'];

/** The island objects by meaning, for the planner. */
export const OBJECTS: { id: ObjectId; means: string }[] = [
  { id: 'house', means: 'a site, a shop, a place, a home page' },
  { id: 'toolbox', means: 'an app or a tool that does something' },
  { id: 'chart', means: 'a plan, a launch, a schedule, numbers over time' },
  { id: 'ledger', means: 'a budget, accounts, a list of costs or records' },
  { id: 'folder', means: 'a document, a report, an application' },
  { id: 'letters', means: 'a letter, an email, a description or a pitch' },
  { id: 'globe', means: 'travel, a market, anything about the world' },
  { id: 'map', means: 'a route, a trip, places to go' },
  { id: 'lamp', means: 'an idea, research, an explainer' },
  { id: 'notebooks', means: 'study notes, lessons, a course' },
  { id: 'cake', means: 'a party, an event, a celebration' },
  { id: 'case-stack', means: 'a pile of papers worked through, a review of documents' },
];
export const OBJECT_IDS = OBJECTS.map((o) => o.id);

export const DEFAULT_OBJECT: Record<DeliverableKind, ObjectId> = { site: 'house', document: 'folder', plan: 'chart' };

/** What each check means, in the words of the plan card. */
export const CHECK_LINES: Record<CheckName, string> = {
  quote: 'Every quote stands word for word on its page',
  numbers: 'Every price, date and number stands in the materials',
  dates: 'Dates are real dates and match their quote',
  sums: 'Totals are summed again by code',
  schema: 'Every answer of the model fits its schema',
  parse: 'Every HTML, CSS, JS and JSON file parses',
  refs: 'Every file, image and script the code points at exists',
  required: 'The page has every part the plan asked for',
  links: 'Links inside the project lead somewhere',
  'plan-table': 'Plan items end after they start, stay in the window, have a known owner',
  dedupe: 'The same fact is not counted twice',
};

/** Words of a call's role, for captions ("Builder is asked to answer again"). */
export const ROLE_TITLE: Record<string, string> = {
  planner: 'Planner',
  researcher: 'Researcher',
  analyst: 'Analyst',
  writer: 'Writer',
  builder: 'Builder',
  reviewer: 'Reviewer',
};

export const MAX_STEPS = 12;
export const MIN_STEPS = 4;
export const MAX_FILES = 12;
export const CODE_EXTENSIONS = ['.html', '.css', '.js', '.mjs', '.json', '.svg', '.md', '.txt', '.webmanifest'];
