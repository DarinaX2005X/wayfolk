/**
 * Answer schemas of the case job for the model (PLAN "Контракты"): flat, without $ref
 * and anyOf, optional values as required strings that may be empty, string enums only.
 * The OpenRouter adapter adds additionalProperties: false to every object; it is set here
 * too, so the scripted answers are checked the same way. The closed lists of the plan
 * (topics and fact fields) go into the schema as enums. Party names stay free text: a
 * name outside the case must reach the actor check (unknown-actor), not fail the schema.
 */
import type { CasePlan, JsonSchema } from '../../types';

const str = (description?: string, values?: readonly string[]): JsonSchema => ({
  type: 'string',
  ...(description ? { description } : {}),
  ...(values && values.length ? { enum: [...values] } : {}),
});
const obj = (properties: Record<string, JsonSchema>, description?: string): JsonSchema => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const list = (items: JsonSchema, description?: string, maxItems?: number): JsonSchema => ({
  type: 'array',
  ...(description ? { description } : {}),
  items,
  ...(maxItems ? { maxItems } : {}),
});

export const FACT_TYPES = ['date', 'amount', 'time', 'yesno', 'presence'] as const;

export function planSchema(): JsonSchema {
  return obj({
    parties: list(
      obj({
        id: str('Short lower-case id, e.g. "mark"'),
        name: str('Full name as written in the documents'),
        role: str('Role in the case, e.g. "Tenant"'),
        aliases: list(str(), 'Other ways the documents name this person: surname, title and surname, role words'),
      }),
      'People and organisations who act in the documents',
      12,
    ),
    topics: list(str(), 'Short lower-case topic words', 10),
    fields: list(
      obj({
        id: str('topic.name, e.g. "keys.returned_on"'),
        topic: str('One of the topics'),
        type: str('Kind of value', FACT_TYPES),
        question: str('The question the field answers, e.g. "When were the keys returned?"'),
      }),
      'Facts the documents may disagree about',
      12,
    ),
  });
}

export function eventSchema(plan: CasePlan): JsonSchema {
  return obj({
    kind: str('record: a document of its own time; account: a later explanation', ['record', 'account']),
    date: str('ISO date YYYY-MM-DD of the event, or "" when there is none'),
    time: str('HH:MM in 24 hours, or ""'),
    actors: list(str('A name of a party as the plan gives it'), 'Parties who take part'),
    label: str('Up to three words'),
    summary: str('One sentence: what happened'),
    quote: str('The exact words from the page, copied character for character'),
    page: { type: 'integer', description: 'The page number in [p. N] where the quote stands' },
    topic: str('One of the topics', plan.topics),
    facts: list(
      obj({
        field: str('A fact field id', plan.fields.map((f) => f.id)),
        type: str('The type of that field', FACT_TYPES),
        value: str('ISO date, number, HH:MM, yes or no, here or away'),
        basis: str('literal: the value is written in the quote; derived: worked out from words like "two weeks ago"', ['literal', 'derived']),
        subject: str('For presence: the party id who was here or away; otherwise ""'),
        from: str('For yes/no and presence: ISO date the value starts, or ""'),
        to: str('For yes/no and presence: ISO date the value ends, or ""'),
      }),
      'Facts of the plan this quote states',
    ),
  });
}

export function extractSchema(plan: CasePlan): JsonSchema {
  return obj({ events: list(eventSchema(plan), 'Events found on these pages') });
}

export function recheckSchema(plan: CasePlan): JsonSchema {
  return obj({
    fixes: list(
      obj({
        claimId: str('The id of a sent-back claim'),
        action: str('fix: give the right quote, page, date and actors; withdraw: the claim cannot be supported', ['fix', 'withdraw']),
        quote: str('Exact words from the page, or "" to keep'),
        page: { type: 'integer', description: 'Page number, or 0 to keep' },
        date: str('ISO date, or "" to keep'),
        actors: list(str('A name of a party as the plan gives it'), 'Actors, or [] to keep'),
      }),
    ),
    added: list(eventSchema(plan), 'New events from the uncovered dated passages, only if they are real events'),
  });
}

export function reconcileSchema(): JsonSchema {
  return obj({
    verdicts: list(
      obj({
        pairKey: str('The key of the pair as given'),
        verdict: str('contradiction: both cannot be true; explained: both can be true; unsure: a person must decide', [
          'contradiction',
          'explained',
          'unsure',
        ]),
        explanation: str('One or two sentences that name both values and their sources'),
        question: str('For unsure only: one short question to the person; otherwise ""'),
        options: list(str(), 'For unsure only: two short answers, the one that makes it a conflict first; otherwise []', 2),
      }),
    ),
  });
}
