/**
 * The `fixtures` provider (LLM_PROVIDER=fixtures): answers from recorded `AnswerSet`s,
 * so the live path of the product (queue, refusals with x-test-fail, the switch to
 * recorded answers) is exercised without spending the key.
 *
 * A request carries `fixture: '<example>/<full|late>/<task>/<index>/<attempt>'`. The
 * answer is the `CallRecord` with that task, index and attempt, sent at once with the
 * recorded `ms`: the client keeps the time. For `reconcile` the whole recorded verdict
 * dictionary goes back; the client picks the pairs of its request with the same code as
 * `recordedLlm` (the `payload` never reaches the server). A record that was itself a
 * failed call answers as bad output. No key or no record: 503 `agents-offline`,
 * `need: 'fixture'`.
 *
 * Where the sets come from is injected (`setFixtureSource`):
 *   - the deployment: content/answers/index.ts once package 01.7 creates it (its
 *     `answersFor(example, scope)` gives the recording of the real model when its
 *     material matches, otherwise the scripted set). Until then the bundle has no sets.
 *   - the dev server: the JSON files of content/answers/ read from disk on each request
 *     (tools/dev-api/plugin.ts), so a rebuilt set is used without restarting.
 *   - tests: a synthetic set.
 */
import type { AnswerSet, CallRecord } from '../../../src/agents/types';
import { FIXTURE_KEY } from './request';
import type { Outcome, ProviderAdapter } from './provider';

export type FixtureSource = (example: string, scope: 'full' | 'late') => Promise<AnswerSet | null>;

let source: FixtureSource = async () => null;

export function setFixtureSource(next: FixtureSource): void {
  source = next;
}

/** A source over a fixed list of sets (tests, and the dev server's files). */
export function fixtureList(sets: AnswerSet[]): FixtureSource {
  return async (example, scope) => {
    const matching = sets.filter((set) => set.example === example && set.scope === scope);
    // A recording of the real model goes first, as the registry of 01.7 does.
    return matching.find((set) => set.answers === 'recorded') ?? matching[0] ?? null;
  };
}

export function findRecord(set: AnswerSet, task: string, index: number, attempt: number): CallRecord | null {
  return set.calls.find((call) => call.task === task && call.index === index && call.attempt === attempt) ?? null;
}

/** `own`: a source for this adapter only; otherwise the one set by `setFixtureSource`, read per call. */
export function createFixtures(own?: FixtureSource): ProviderAdapter {
  return async ({ body }): Promise<Outcome> => {
    const match = body.fixture ? FIXTURE_KEY.exec(body.fixture) : null;
    if (!match) return { ok: false, kind: 'offline', need: 'fixture' };
    const [, example, scope, task, index, attempt] = match;
    const set = await (own ?? source)(example, scope as 'full' | 'late');
    const record = set ? findRecord(set, task, Number(index), Number(attempt)) : null;
    if (!record) return { ok: false, kind: 'offline', need: 'fixture' };
    if (!record.ok) return { ok: false, kind: 'bad-output' };
    return { ok: true, json: record.json, model: 'recorded', usage: {}, ms: record.ms };
  };
}
