/**
 * The three samples replay from their recordings with every check running: the run ends
 * ready, the planted mistakes are caught, the deliverable is whole, its ready redo works
 * offline, and what the build ships (texts, saved runs, public/samples) is current.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetRunsForTests } from '../../src/agents/runner';
import { checkProject } from '../../src/agents/checks/code/project';
import type { AnswerSet, RunEvent, SampleId, TaskResult } from '../../src/agents/types';
import { SAMPLES, sampleDocs } from '../../content/samples';
import { answersFor } from '../../content/answers';
import { runSample, runSampleRedo } from '../../content/answers/run';
import { publicFiles, textsModule } from '../../scripts/build-fixtures';

const ROOT = path.resolve(__dirname, '..', '..');

beforeEach(() => resetRunsForTests());

describe('sample texts', () => {
  it('texts.generated.ts is current (npm run fixtures)', () => {
    expect(readFileSync(path.join(ROOT, 'content/samples/texts.generated.ts'), 'utf8').replace(/\r\n/g, '\n')).toBe(textsModule());
  });

  it('every sample with files reads into pages', async () => {
    for (const s of SAMPLES) {
      const docs = await sampleDocs(s.id);
      expect(docs.length).toBe(s.files.length);
      for (const d of docs) expect(d.pages.length).toBeGreaterThan(0);
    }
  });
});

describe.each(SAMPLES.map((s) => [s.id, s] as const))('sample %s', (id: SampleId, meta) => {
  let set: AnswerSet;
  let result: TaskResult;
  let events: RunEvent[];

  beforeEach(async () => {
    if (set) return;
    set = await answersFor(id);
    const record = await runSample(id, set, { pace: 0 });
    expect(record.status).toBe('ready');
    result = record.result as TaskResult;
    events = record.events;
  });

  it('is a recording of the real model with the honest label', () => {
    expect(set.answers).toBe('recorded');
    expect(set.model).toBeTruthy();
    expect(result.label).toMatch(/^Recorded answers from a live run.*checks run now$/);
    expect(result.label).not.toMatch(/verified/i);
  });

  it('plans 4 to 12 stations, with the object and deliverable of the sample', () => {
    const plan = events.find((e) => e.type === 'plan');
    expect(plan?.type).toBe('plan');
    if (plan?.type !== 'plan') return;
    expect(plan.stations.length).toBeGreaterThanOrEqual(4);
    expect(plan.stations.length).toBeLessThanOrEqual(12);
    expect(plan.deliverable).toBe(meta.deliverable);
    expect(plan.object).toBe(meta.object);
  });

  it('catches every planted mistake (2 to 4) and ships none of them', () => {
    expect(result.stats.planted).toBeGreaterThanOrEqual(2);
    expect(result.stats.planted).toBeLessThanOrEqual(4);
    expect(result.stats.caught).toBe(result.stats.planted);
    const plantedItems = events.filter((e): e is Extract<RunEvent, { type: 'item' }> => e.type === 'item' && Boolean(e.item.planted));
    expect(plantedItems.length).toBeGreaterThan(0);
    for (const e of plantedItems) expect(e.item.status).not.toBe('accepted');
  });

  it('assembles a whole deliverable', () => {
    const d = result.deliverable!;
    expect(d.kind).toBe(meta.deliverable);
    if (d.kind === 'site') {
      expect(d.files[0].path).toBe('index.html');
      const pc = checkProject(d.files.map((f) => ({ path: f.path, text: f.text })), { required: result.plan.steps.flatMap((s) => s.args.required ?? []) });
      expect(pc.load.ok).toBe(true);
      expect(d.load.required.every((r) => r.found)).toBe(true);
      expect(d.preview.sampleUrl).toBe(`/samples/${id}/`);
    }
    if (d.kind === 'plan') {
      expect(d.items.length).toBeGreaterThanOrEqual(8);
      for (const t of d.totals) expect(t.ok).toBe(true);
      for (const i of d.items) {
        expect(i.end >= i.start).toBe(true);
        if (d.window) expect(i.end <= d.window.to && i.start >= d.window.from).toBe(true);
      }
    }
  });

  it('public/samples holds the same deliverable', () => {
    for (const f of publicFiles(result)) {
      expect(readFileSync(path.join(ROOT, 'public/samples', id, f.path), 'utf8').replace(/\r\n/g, '\n'), f.path).toBe(f.text.replace(/\r\n/g, '\n'));
    }
  });

  it('its ready redo runs offline', async () => {
    expect(set.redos?.length).toBe(1);
    const redo = await runSampleRedo(id, set, result, { pace: 0 });
    expect(redo?.status).toBe('ready');
    const r = redo!.result as TaskResult;
    expect(r.version).toBe(2);
    expect(r.cards.find((c) => c.stepId === set.redos![0].stepId)?.version).toBeGreaterThan(1);
  });
});
