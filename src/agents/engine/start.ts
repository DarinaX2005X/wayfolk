/**
 * What the view calls to run work (the general engine's front door):
 *
 *   newTaskProject(input)            a draft Project for a goal said or typed
 *   startTask(project, docs, deps)   a live run (or a replay of an AnswerSet): RunHandle
 *   redoStep(...)                    "Redo this differently: …" on one step card
 *   readyRedos(set)                  the redos a sample's recording holds (work offline)
 *   liveAvailability(status)         whether a live run can start, and the honest line if not
 *   uploadPreview(deliverable)       a live site's files to /api/r, for a short preview link
 *   applyEdits (./edits.ts) and exportFiles (./export.ts) read and export a result.
 */
import type { AnswerSet, Doc, LlmStatus, Project, RunDeps, RunHandle, SampleId, TaskInput, TaskResult } from '../types';
import { startRun } from '../runner';
import { hash6 } from '../../materials/normalize';
import './task';

const ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';

export function newProjectId(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  return 'p_' + [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function newTaskProject(input: TaskInput, opts: { id?: string; now?: Date; sample?: SampleId; title?: string } = {}): Project {
  const at = (opts.now ?? new Date()).toISOString();
  const title = opts.title ?? (input.text.length > 40 ? input.text.slice(0, 39).trimEnd() + '…' : input.text);
  return {
    id: opts.id ?? newProjectId(),
    title,
    task: input,
    ...(opts.sample ? { sample: opts.sample } : {}),
    slug: (opts.sample ?? title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project',
    createdAt: at,
    updatedAt: at,
    rev: 0,
    firstRunAt: null,
    visibility: 'private',
    status: 'draft',
    materials: [],
    materialHash: '',
    runId: null,
    passes: 0,
    result: null,
    edits: [],
    notes: [],
  };
}

export type StartOptions = {
  /** 'live' calls the model through deps.llm; an AnswerSet replays a recording. */
  answers?: 'live' | AnswerSet;
  pace?: number;
  today?: string;
  /** Plant the sample mistakes into fresh answers (recording a sample only). */
  plant?: boolean;
};

export function startTask(project: Project, docs: Doc[], deps: RunDeps, opts: StartOptions = {}): Promise<RunHandle> {
  return startRun({ project, docs, scope: 'full', answers: opts.answers ?? 'live', pace: opts.pace, today: opts.today, seed: opts.plant }, deps);
}

/**
 * Runs one step again with the person's instruction; later steps run again only when what
 * they use changed. On a recording, only the ready redos (readyRedos) have answers: pass
 * their `preset`. Your own instruction on a sample needs the live model.
 */
export function redoStep(
  project: Project,
  previous: TaskResult,
  stepId: string,
  instruction: string,
  docs: Doc[],
  deps: RunDeps,
  opts: StartOptions & { preset?: string } = {},
): Promise<RunHandle> {
  return startRun(
    {
      project,
      docs,
      scope: { redo: stepId, instruction, ...(opts.preset ? { preset: opts.preset } : {}) },
      answers: opts.answers ?? 'live',
      pace: opts.pace,
      today: opts.today,
      previous,
    },
    deps,
  );
}

/** The ready redos of a recording: these run offline. */
export function readyRedos(set: AnswerSet | null): { stepId: string; preset: string; instruction: string }[] {
  return set?.redos ?? [];
}

/** Whether a redo with this instruction has recorded answers. */
export function redoRecorded(set: AnswerSet | null, stepId: string, instruction: string, preset?: string): boolean {
  const key = `${stepId}:${preset ?? hash6(instruction)}`;
  return Boolean(set?.calls.some((c) => c.redo === key));
}

export const OWN_REDO_LINE = 'Your own instruction needs the live model. The ready ones work offline.';

/** Whether a live run can start now, with the line to show at the button. */
export function liveAvailability(status: LlmStatus | null): { live: boolean; line: string } {
  if (!status) return { live: false, line: 'Checking whether the agents are online…' };
  if (!status.live) return { live: false, line: 'Live runs are off right now. The three samples run from their recordings, with every check running here.' };
  if (status.runsLeftToday <= 0) return { live: false, line: "Today's live runs are used up. The three samples still run from their recordings." };
  return { live: true, line: `${status.runsLeftToday} live run${status.runsLeftToday === 1 ? '' : 's'} left today for everyone.` };
}

/**
 * Uploads a live site's files for a preview link: { code, url } where url is
 * '/api/r/<code>/'. A sample needs none: it opens at /samples/<id>/.
 */
export async function uploadPreview(
  result: TaskResult,
  opts: { fetch?: (input: string, init?: RequestInit) => Promise<Response>; base?: string } = {},
): Promise<{ code: string; url: string }> {
  const d = result.deliverable;
  if (d?.kind !== 'site') throw new Error('preview: only a site has a preview');
  if (d.preview.sampleUrl) return { code: '', url: d.preview.sampleUrl };
  const doFetch = opts.fetch ?? ((i: string, init?: RequestInit) => fetch(i, init));
  const res = await doFetch(`${opts.base ?? ''}/api/r`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: d.title, files: d.files.map((f) => ({ path: f.path, text: f.text })) }),
  });
  if (!res.ok) throw new Error(`preview: the server refused (${res.status})`);
  return (await res.json()) as { code: string; url: string };
}
