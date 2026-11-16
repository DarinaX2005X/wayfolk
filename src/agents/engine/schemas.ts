/**
 * The flat JSON schemas of every model answer (strict structured output): no $ref or
 * anyOf, every field required (empty strings and lists stand for "none"), string enums
 * only. The proxy checks each answer against its schema before code reads it.
 */
import type { JsonSchema } from '../types';
import { OBJECT_IDS, PLANNER_KINDS } from './library';

const str = (description?: string): JsonSchema => ({ type: 'string', ...(description ? { description } : {}) });
const int = (description?: string): JsonSchema => ({ type: 'integer', ...(description ? { description } : {}) });
/** The limit goes into the words, not into maxItems: a long list is trimmed by code, not refused. */
const arr = (items: JsonSchema, most?: number, description?: string): JsonSchema => {
  const words = [description, most ? `At most ${most}.` : ''].filter(Boolean).join(' ');
  return { type: 'array', items, ...(words ? { description: words } : {}) };
};
const obj = (properties: Record<string, JsonSchema>, description?: string): JsonSchema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
  ...(description ? { description } : {}),
});
const oneOf = (values: readonly string[], description?: string): JsonSchema => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) });

export const PLAN_SCHEMA: JsonSchema = obj({
  understood: str('One sentence: what the person wants, in plain words'),
  title: str('Short project name, up to 40 characters'),
  deliverable: oneOf(['site', 'document', 'plan']),
  fit: oneOf(['yes', 'partly', 'no', 'unclear']),
  notDoable: str("What can't be done here; '' when everything can"),
  instead: str("The nearest thing these agents can make instead; '' when fit is yes"),
  question: str("One clarifying question, only when the goal can honestly be read in different ways; '' otherwise"),
  options: arr(str(), 4, '2–4 short answers to the question, the assumed one first; [] when no question'),
  object: oneOf(OBJECT_IDS, 'The island object that means this project'),
  objectWhy: str('Why this object, a few words'),
  windowFrom: str("For a plan: first day, YYYY-MM-DD; '' otherwise"),
  windowTo: str("For a plan: last day, YYYY-MM-DD; '' otherwise"),
  team: arr(str(), 12, 'People named in the goal or materials who can own work; [] when none'),
  steps: arr(
    obj({
      id: str('s1, s2, … in order'),
      kind: oneOf([...PLANNER_KINDS]),
      title: str('Station sign, up to 18 characters'),
      does: str('One line: what this step does for this project'),
      uses: arr(str(), 6, "Earlier step ids, or 'materials'"),
      focus: str("What to look for or focus on; '' when nothing special"),
      files: arr(obj({ path: str('Relative path, e.g. index.html, styles.css, app.js'), purpose: str() }), 8, 'write-code only; [] otherwise'),
      sections: arr(str(), 8, 'write-section only: section headings; [] otherwise'),
      columns: arr(obj({ name: str(), type: oneOf(['text', 'date', 'number', 'money', 'person', 'duration']) }), 4, 'make-plan only: extra columns beyond task, owner, start, end; [] otherwise'),
      options: arr(str(), 6, 'compare/decide only; [] otherwise'),
      criteria: arr(str(), 6, 'compare/decide only; [] otherwise'),
      required: arr(obj({ what: str(), selector: str('A CSS selector of an element written in index.html, e.g. #menu or form#order') }), 8, 'write-code with index.html only; [] otherwise'),
      done: arr(str(), 6, 'Up to six acceptance points'),
    }),
    12,
  ),
});

export const FACTS_SCHEMA: JsonSchema = obj({
  facts: arr(
    obj({
      claim: str('The fact in your words, short'),
      quote: str('The exact words from the page that say it, copied character for character'),
      page: int('The page number the quote stands on'),
    }),
    20,
  ),
});

export const TABLE_SCHEMA: JsonSchema = obj({
  rows: arr(
    obj({
      option: str(),
      criterion: str(),
      value: str('Short value of this option on this criterion'),
      quote: str("Exact words from the materials that back the value; '' when none"),
      page: int('Page of the quote; 0 when none'),
    }),
    36,
  ),
});

export const DECISION_SCHEMA: JsonSchema = obj({
  choice: str('The option chosen'),
  reasons: arr(obj({ text: str(), from: arr(str(), 6, 'Ids of the facts or rows this reason rests on') }), 6),
  risks: arr(str(), 4),
});

export const SECTIONS_SCHEMA: JsonSchema = obj({
  sections: arr(
    obj({
      heading: str(),
      text: str('The section text, plain paragraphs separated by blank lines'),
      from: arr(str(), 12, 'Ids of the facts this section uses; [] when none'),
    }),
    8,
  ),
});

export const FILE_SCHEMA: JsonSchema = obj({
  content: str('The whole file, ready to save'),
  summary: str('One line: what this file does'),
});

export const ITEMS_SCHEMA: JsonSchema = obj({
  items: arr(
    obj({
      id: str('i1, i2, …'),
      task: str(),
      owner: str('One person of the team'),
      start: str('YYYY-MM-DD'),
      end: str('YYYY-MM-DD'),
      depends: arr(str(), 4, 'Ids of items that must end first'),
      cells: arr(obj({ column: str(), value: str() }), 4, 'Values of the extra columns'),
    }),
    24,
  ),
  totals: arr(obj({ column: str(), value: str() }), 3, 'Totals of number or money columns; [] when none'),
});

export const REVIEW_SCHEMA: JsonSchema = obj({
  verdict: str('One or two sentences'),
  issues: arr(obj({ severity: oneOf(['minor', 'major']), about: str('What the issue is about: a file, a section, an item id'), text: str() }), 8),
});

/** The second look: the same unit, fixed, or withdrawn. */
export function fixSchema(unit: JsonSchema): JsonSchema {
  return obj({
    fixes: arr(
      obj({
        id: str('The id of the unit sent back'),
        action: oneOf(['fix', 'withdraw']),
        unit,
      }),
      24,
    ),
  });
}

export const UNIT_SCHEMAS = {
  findings: (FACTS_SCHEMA.properties!.facts as JsonSchema).items!,
  table: (TABLE_SCHEMA.properties!.rows as JsonSchema).items!,
  section: (SECTIONS_SCHEMA.properties!.sections as JsonSchema).items!,
  items: (ITEMS_SCHEMA.properties!.items as JsonSchema).items!,
  decision: DECISION_SCHEMA,
  files: obj({ content: str('The whole corrected file') }),
} as const;
