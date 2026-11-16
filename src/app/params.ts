/**
 * Parameters of the page /app (task 01.1.3). They exist only where debug hooks are on
 * (dev, the scenario build, `?debug=1`; src/app/debug.ts); on the deployment without
 * `debug=1` the page ignores them and behaves as a person opening it would see it.
 *
 *   run=<example>              starts that example at once, without the envelope
 *   answers=scripted|recorded  which answer set of the registry to use; recorded (the
 *                              real model's run) is the default when it exists. A real
 *                              live run is never started by a parameter, only by the
 *                              "Run it live" button.
 *   pace=<number>              multiplies recorded waits and display minimums (0.25 in scenarios)
 *   capture=1                  frozen clock, stepped by the capture tool
 */
import type { ExampleId } from '../agents/types';

export type AppParams = {
  run: ExampleId | null;
  answers: 'scripted' | 'recorded' | null;
  pace: number;
  capture: boolean;
  debug: boolean;
};

const EXAMPLES: readonly ExampleId[] = ['harbor-street', 'wedding', 'class-9b'];

/** Reads the parameters; with `enabled` false only the defaults come back. */
export function parseAppParams(search: string, enabled: boolean): AppParams {
  const q = new URLSearchParams(search);
  const params: AppParams = { run: null, answers: null, pace: 1, capture: false, debug: q.get('debug') === '1' };
  if (!enabled) return params;
  const run = q.get('run');
  if (run && (EXAMPLES as readonly string[]).includes(run)) params.run = run as ExampleId;
  const answers = q.get('answers');
  if (answers === 'scripted' || answers === 'recorded') params.answers = answers;
  const pace = Number(q.get('pace'));
  // 0 is allowed (no waits at all); anything else must be a sane positive factor.
  if (q.has('pace') && Number.isFinite(pace) && pace >= 0 && pace <= 10) params.pace = pace;
  params.capture = q.get('capture') === '1';
  return params;
}
