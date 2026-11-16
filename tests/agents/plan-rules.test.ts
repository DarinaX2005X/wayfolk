import { describe, expect, it } from 'vitest';
import { validatePlan } from '../../src/agents/engine/plan-check';
import { newTaskProject, startTask } from '../../src/agents/engine/start';
import type { TaskResult } from '../../src/agents/types';
import { deps, docsOf, fakeModel, planAnswer, pstep, shape } from './helpers';

describe('plan rules', () => {
  it('orders code steps page, scripts, styles, and runs them one after another', () => {
    const v = validatePlan(
      planAnswer({
        steps: [
          pstep({ id: 'a', kind: 'write-code', title: 'Markup', files: [{ path: 'index.html', purpose: 'Page' }], required: [{ what: 'List', selector: '#list' }] }),
          pstep({ id: 'b', kind: 'write-code', title: 'Style', uses: ['a'], files: [{ path: 'styles.css', purpose: 'Look' }] }),
          pstep({ id: 'c', kind: 'write-code', title: 'Logic', uses: ['a'], files: [{ path: 'app.js', purpose: 'Behaviour' }] }),
          pstep({ id: 'd', kind: 'review', title: 'Review', uses: ['b', 'c'] }),
        ],
      }),
      { docs: [], links: [] },
    );
    expect(v.problems).toEqual([]);
    const code = v.plan!.steps.filter((s) => s.kind === 'write-code');
    expect(code.map((s) => s.args.files![0].path)).toEqual(['index.html', 'app.js', 'styles.css']);
    expect(code[1].uses).toContain(code[0].id);
    expect(code[2].uses).toContain(code[1].id);
  });

  it('wants one make-plan step, and no extra columns for the fields every item has', () => {
    const v = validatePlan(
      planAnswer({
        deliverable: 'plan',
        object: 'chart',
        team: ['Ann'],
        steps: [
          pstep({ id: 'a', kind: 'make-plan', columns: [{ name: 'Owner', type: 'money' }, { name: 'Cost', type: 'money' }] }),
          pstep({ id: 'b', kind: 'make-plan', uses: ['a'] }),
          pstep({ id: 'c', kind: 'review', uses: ['b'] }),
          pstep({ id: 'd', kind: 'review', uses: ['c'] }),
        ],
      }),
      { docs: [], links: [] },
    );
    expect(v.problems.some((p) => /one make-plan step/.test(p))).toBe(true);
  });

  it('asks again once when a plan comes back with too few items', async () => {
    const item = (n: number) => ({ id: `i${n}`, task: `Task ${n}`, owner: 'Ann Lee', start: '2027-01-0' + n, end: '2027-01-0' + n, depends: [], cells: [{ column: 'Owner', value: 'Ann Lee' }], done: 'It is finished and shown to the team' });
    let asked = 0;
    const model = fakeModel((req) => {
      const s = shape(req);
      if (s === 'plan')
        return planAnswer({
          deliverable: 'plan',
          object: 'chart',
          windowFrom: '2027-01-01',
          windowTo: '2027-01-31',
          team: ['Ann Lee'],
          steps: [pstep({ id: 's1', kind: 'make-plan', title: 'Plan' }), pstep({ id: 's2', kind: 'review', uses: ['s1'] }), pstep({ id: 's3', kind: 'review', title: 'Again', uses: ['s2'] })],
        });
      if (s === 'items') return ++asked === 1 ? { items: [item(1)], totals: [] } : { items: [1, 2, 3, 4, 5].map(item), totals: [] };
      if (s === 'review') return { verdict: 'Fine.', issues: [] };
      return new Error('unexpected ' + s);
    });
    const project = newTaskProject({ text: 'Plan my month: tasks and dates', by: 'typed', links: [] });
    const r = await (await startTask(project, await docsOf({}), deps(model), { today: '2026-12-20' })).done;
    expect(asked).toBe(2);
    const d = (r.result as TaskResult).deliverable!;
    expect(d.kind === 'plan' && d.items.length).toBe(5);
    expect(d.kind === 'plan' && d.items.every((i) => !('Owner' in i.cells))).toBe(true);
  });
});
