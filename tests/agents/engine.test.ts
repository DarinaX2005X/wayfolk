import { beforeEach, describe, expect, it } from 'vitest';
import { equalityProblems } from '../../src/agents/checks/counters';
import { resetRunsForTests } from '../../src/agents/runner';
import { newTaskProject, redoStep, startTask } from '../../src/agents/engine/start';
import { applyEdits } from '../../src/agents/engine/edits';
import { exportFiles, toCsv, toIcs, toMarkdown } from '../../src/agents/engine/export';
import type { LlmRequest, TaskResult } from '../../src/agents/types';
import { deps, docsOf, fakeModel, of, planAnswer, pstep, shape } from './helpers';

beforeEach(() => resetRunsForTests());

const NOTES = `# Bakery notes

Tuesday to Friday: 7:00 am to 3:00 pm.
Closed on Mondays.

Butter croissant: $3.75
Country sourdough loaf: $7.50

Phone: (555) 014-2290
`;

const GOOD_HTML = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Bakery</title><link rel="stylesheet" href="styles.css"></head>
<body>
<header><h1>Bakery</h1><nav><a href="#menu">Menu</a> <a href="#hours">Hours</a></nav></header>
<main>
<section id="menu"><h2>Menu</h2><ul><li>Butter croissant $3.75</li><li>Country sourdough loaf $7.50</li></ul></section>
<section id="hours"><h2>Hours</h2><p>Tuesday to Friday, 7:00 am to 3:00 pm. Closed on Mondays.</p></section>
</main>
<footer>Call (555) 014-2290</footer>
</body>
</html>`;
const BROKEN_HTML = GOOD_HTML.replace('</section>\n<section id="hours">', '\n<section id="hours">').replace('$7.50', '$7.95');
const CSS = 'body { margin: 0; font-family: system-ui, sans-serif; }\nsection { padding: 2rem; }\n';

function siteModel(opts: { brokenHtml?: boolean; badQuote?: boolean } = {}) {
  return fakeModel((req: LlmRequest, user: string) => {
    const s = shape(req);
    if (s === 'plan')
      return planAnswer({
        title: 'Corner Bakery',
        steps: [
          pstep({ id: 's1', kind: 'research', title: 'Find facts', uses: ['materials'] }),
          pstep({ id: 's2', kind: 'write-code', title: 'Build page', uses: ['s1'], files: [{ path: 'index.html', purpose: 'The page' }, { path: 'styles.css', purpose: 'The look' }], required: [{ what: 'Menu', selector: '#menu' }, { what: 'Hours', selector: '#hours' }, { what: 'Contact', selector: 'footer' }] }),
          pstep({ id: 's3', kind: 'review', title: 'Review', uses: ['s2'] }),
          pstep({ id: 's4', kind: 'deploy', title: 'Deploy' }),
        ],
      });
    if (s === 'facts')
      return {
        facts: [
          { claim: 'Closed on Mondays', quote: 'Closed on Mondays.', page: 1 },
          { claim: 'A croissant is $3.75', quote: opts.badQuote ? 'Croissants cost $3.75 each' : 'Butter croissant: $3.75', page: 1 },
          { claim: 'A croissant is $3.75', quote: 'Butter croissant: $3.75', page: 1 },
        ],
      };
    if (s === 'file') {
      if (user.includes('Write the file index.html')) return { content: opts.brokenHtml ? BROKEN_HTML : GOOD_HTML, summary: 'The page' };
      return { content: CSS, summary: 'The look' };
    }
    if (s === 'fix') {
      if (user.includes('--- index.html ---')) return { fixes: [{ id: 'index.html', action: 'fix', unit: { content: GOOD_HTML } }] };
      const id = /--- (s\d+\.f\d+) ---/.exec(user)?.[1] ?? '';
      return { fixes: [{ id, action: 'fix', unit: { claim: 'The phone is (555) 014-2290', quote: 'Phone: (555) 014-2290', page: 1 } }] };
    }
    if (s === 'review') return { verdict: 'Clear and complete.', issues: [{ severity: 'minor', about: 'index.html', text: 'Add a map link.' }] };
    return new Error('unexpected ' + s);
  });
}

async function runSite(opts: Parameters<typeof siteModel>[0] = {}) {
  const model = siteModel(opts);
  const docs = await docsOf({ 'bakery-notes.md': NOTES });
  const project = newTaskProject({ text: 'Make a one-page site for my bakery from these notes', by: 'typed', links: [] });
  const h = await startTask(project, docs, deps(model), { today: '2026-11-16' });
  const record = await h.done;
  return { record, model, result: record.result as TaskResult, docs, project };
}

describe('the task engine on a site', () => {
  it('plans by code: read first, check after the code, assemble last, unknown steps left out', async () => {
    const { record } = await runSite();
    const plan = of(record, 'plan')[0];
    expect(plan.stations.map((s) => s.step)).toEqual(['read', 'research', 'write-code', 'check', 'review', 'assemble']);
    expect(plan.stations.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(plan.object).toBe('house');
    expect(plan.title).toBe('Corner Bakery');
    expect(of(record, 'note').some((n) => n.text.includes('"deploy", which isn\'t in the library'))).toBe(true);
    expect(record.result!.plan.steps.find((s) => s.kind === 'write-code')!.uses).toEqual(['s2']);
  });

  it('runs every step, checks facts and files, and assembles a working site', async () => {
    const { record, result } = await runSite();
    expect(record.status).toBe('ready');
    expect(of(record, 'step-start').map((e) => e.station)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    const d = result.deliverable!;
    expect(d.kind).toBe('site');
    if (d.kind !== 'site') return;
    expect(d.files.map((f) => f.path)).toEqual(['index.html', 'styles.css']);
    expect(d.load.ok).toBe(true);
    expect(d.load.required.every((r) => r.found)).toBe(true);
    // The duplicate fact is merged; the two others are checked.
    expect(result.stats.merged).toBe(1);
    expect(equalityProblems(result.stats)).toEqual([]);
    expect(result.reviews).toEqual([{ stepId: 's5', text: 'index.html: Add a map link.', severity: 'minor' }]);
    expect(result.label).toBe('Live run: the model answers now, code checks every answer');
    expect(of(record, 'tile').length).toBeGreaterThan(3);
    expect(of(record, 'card').some((c) => c.card.stepId === 's3' && c.card.state === 'done')).toBe(true);
  });

  it('sends a broken page and an invented quote back once, and keeps the fixed ones', async () => {
    const { record, result } = await runSite({ brokenHtml: true, badQuote: true });
    const items = of(record, 'item').map((e) => e.item);
    const page = items.filter((i) => i.unitId === 's3:index.html');
    expect(page.map((i) => i.status)).toEqual(['rejected', 'fixed']);
    expect(page[0].problems!.join(' ')).toMatch(/<section> on line \d+ is not closed/);
    expect(page[0].problems!.join(' ')).toContain('"$7.95" isn\'t in the materials');
    const quote = items.filter((i) => i.unitId === 's2.f2');
    expect(quote.map((i) => i.status)).toEqual(['rejected', 'fixed']);
    expect(quote[0].reason).toBe('quote-not-found');
    expect(result.stats.sentBack).toBe(2);
    expect(result.stats.fixed).toBe(2);
    expect(equalityProblems(result.stats)).toEqual([]);
    expect(of(record, 'call-start').filter((c) => c.task === 'recheck')).toHaveLength(2);
  });

  it('labels what code cannot check as reviewed by an agent', async () => {
    const { result } = await runSite();
    const review = result.cards.find((c) => c.kind === 'review')!;
    expect(review.agentOnly[0]).toBe('Clear and complete.');
    expect(result.units.filter((u) => u.kind === 'issue').every((u) => u.status === 'agent')).toBe(true);
    expect(result.units.filter((u) => u.kind === 'file').every((u) => u.checks.includes('parse'))).toBe(true);
  });

  it('redoes one step with an instruction and reruns only what changed after it', async () => {
    const { result, docs, project } = await runSite();
    const model = fakeModel((req, user) => {
      if (shape(req) === 'file') return user.includes('Write the file index.html') ? { content: GOOD_HTML.replace('<h1>Bakery</h1>', '<h1>Our bakery</h1>'), summary: 'Warmer page' } : { content: CSS, summary: 'The look' };
      if (shape(req) === 'review') return { verdict: 'Warmer now.', issues: [] };
      return new Error('unexpected ' + shape(req));
    });
    const h = await redoStep(project, result, 's3', 'Warmer headline', docs, deps(model), { today: '2026-11-16' });
    const r = await h.done;
    expect(r.status).toBe('ready');
    const ran = of(r, 'step-start').map((e) => e.station);
    expect(ran).toEqual(['s3', 's4', 's5', 's6']);
    expect(model.requests.every((q) => q.redo === `s3:${'' + (model.requests[0].redo ?? '').split(':')[1]}`)).toBe(true);
    const site = (r.result as TaskResult).deliverable!;
    expect(site.kind === 'site' && site.files[0].text.includes('Our bakery')).toBe(true);
    expect((r.result as TaskResult).stats.redos).toBe(1);
    expect((r.result as TaskResult).cards.find((c) => c.stepId === 's3')!.version).toBe(2);
  });
});

describe('the task engine on a plan', () => {
  const BRIEF = `# Launch brief

Launch on 9 February 2027. Work runs from 4 January 2027 to 19 February 2027.

Team: Maya Lindqvist (product), Sam Okoro (developer).

Budget: ads $1,500, gifts $400.
`;
  const items = [
    { id: 'i1', task: 'Beta', owner: 'Sam Okoro', start: '2027-01-11', end: '2027-01-24', depends: [], cells: [{ column: 'Cost', value: '$400' }] },
    { id: 'i2', task: 'Ads', owner: 'Maya', start: '2027-02-09', end: '2027-02-05', depends: ['i1'], cells: [{ column: 'Cost', value: '$1,500' }] },
    { id: 'i3', task: 'Party', owner: 'Jordan Blake', start: '2027-02-09', end: '2027-02-09', depends: [], cells: [{ column: 'Cost', value: '' }] },
  ];
  const model = () =>
    fakeModel((req, user) => {
      const s = shape(req);
      if (s === 'plan')
        return planAnswer({
          deliverable: 'plan',
          object: 'chart',
          windowFrom: '2027-01-04',
          windowTo: '2027-02-19',
          team: ['Maya Lindqvist', 'Sam Okoro'],
          steps: [
            pstep({ id: 's1', kind: 'research', uses: ['materials'] }),
            pstep({ id: 's2', kind: 'make-plan', title: 'Make plan', uses: ['s1'], columns: [{ name: 'Cost', type: 'money' }] }),
            pstep({ id: 's3', kind: 'review', uses: ['s2'] }),
          ],
        });
      if (s === 'facts') return { facts: [{ claim: 'Launch on 9 February 2027', quote: 'Launch on 9 February 2027.', page: 1 }] };
      if (s === 'items') return { items, totals: [{ column: 'Cost', value: '$2,000' }] };
      if (s === 'fix') {
        const ids = [...user.matchAll(/--- (s\d+\.i\d+) ---/g)].map((m) => m[1]);
        return {
          fixes: ids.map((id) =>
            id.endsWith('i2')
              ? { id, action: 'fix', unit: { ...items[1], start: '2027-02-01', end: '2027-02-14' } }
              : { id, action: 'withdraw', unit: items[2] },
          ),
        };
      }
      if (s === 'review') return { verdict: 'Fine.', issues: [] };
      return new Error('unexpected ' + s);
    });

  it('checks dates, owners and totals by code, and exports CSV and a calendar', async () => {
    const docs = await docsOf({ 'launch-brief.md': BRIEF });
    const project = newTaskProject({ text: 'Plan the launch: tasks, dates, owners', by: 'typed', links: [] });
    const r = await (await startTask(project, docs, deps(model()), { today: '2026-11-16' })).done;
    const result = r.result as TaskResult;
    const items2 = of(r, 'item').map((e) => e.item);
    expect(items2.find((i) => i.unitId === 's3.i2' && i.status === 'rejected')!.reason).toBe('date-order');
    expect(items2.find((i) => i.unitId === 's3.i3' && i.status === 'rejected')!.reason).toBe('owner-unknown');
    expect(items2.find((i) => i.unitId === 's3.i3' && i.status === 'dropped')!.dropCause).toBe('withdrawn');
    const total = items2.find((i) => i.reason === 'sum-mismatch')!;
    expect(total.status).toBe('corrected');
    const d = result.deliverable!;
    expect(d.kind).toBe('plan');
    if (d.kind !== 'plan') return;
    expect(d.items.map((i) => i.task)).toEqual(['Beta', 'Ads']);
    expect(d.totals[0]).toMatchObject({ column: 'Cost', value: '$1,900', stated: '$2,000', ok: false });
    expect(equalityProblems(result.stats)).toEqual([]);
    expect(toCsv(d).split('\r\n')[0]).toBe('Task,Owner,Start,End,Depends on,Cost');
    expect(toCsv(d)).toContain('Ads,Maya,2027-02-01,2027-02-14,Beta,"$1,500"');
    const ics = toIcs(d);
    expect(ics).toContain('DTSTART;VALUE=DATE:20270201');
    expect(ics).toContain('DTEND;VALUE=DATE:20270215');
    expect(toMarkdown(result)).toContain('code summed the items again');
    const files = await exportFiles(result);
    expect(files.map((f) => f.name.split('.').pop())).toEqual(['md', 'csv', 'ics']);
  });

  it('lets the person approve a card and edit a row, with the plan checks run again', async () => {
    const docs = await docsOf({ 'launch-brief.md': BRIEF });
    const project = newTaskProject({ text: 'Plan the launch', by: 'typed', links: [] });
    const r = await (await startTask(project, docs, deps(model()), { today: '2026-11-16' })).done;
    const result = r.result as TaskResult;
    const edited = applyEdits(result, [
      { id: 'e1', at: '', by: 'me', source: 'hand', kind: 'step-review', stepId: 's3', verdict: 'approved' },
      { id: 'e2', at: '', by: 'me', source: 'hand', kind: 'row-edit', rowId: 's3.i1', column: 'end', value: '2027-01-02' },
    ]);
    expect(edited.cards.find((c) => c.stepId === 's3')!.review).toBe('approved');
    const unit = edited.units.find((u) => u.id === 's3.i1')!;
    expect(unit.status).toBe('edited');
    expect(unit.warnings!.join(' ')).toContain('before it starts');
    expect(result.units.find((u) => u.id === 's3.i1')!.status).toBe('checked');
  });
});

describe('asks and declines', () => {
  it('asks the planner question, takes the assumed answer when nobody answers, and passes it on', async () => {
    const model = fakeModel((req) => {
      const s = shape(req);
      if (s === 'plan')
        return planAnswer({
          deliverable: 'document',
          object: 'letters',
          question: 'Who is it for?',
          options: ['Hikers', 'Office workers'],
          steps: [pstep({ id: 's1', kind: 'write-section', sections: ['Description'] }), pstep({ id: 's2', kind: 'review', uses: ['s1'] }), pstep({ id: 's3', kind: 'review', uses: ['s1'] })],
        });
      if (s === 'sections') return { sections: [{ heading: 'Description', text: 'A bottle for long walks.', from: [] }] };
      if (s === 'review') return { verdict: 'Good.', issues: [] };
      return new Error('unexpected ' + s);
    });
    const project = newTaskProject({ text: 'Describe a water bottle', by: 'typed', links: [] });
    const r = await (await startTask(project, [], deps(model), { today: '2026-11-16' })).done;
    const ask = of(r, 'ask')[0];
    expect(ask).toMatchObject({ question: 'Who is it for?', defaultId: 'o1', options: [{ id: 'o1', label: 'Hikers' }, { id: 'o2', label: 'Office workers' }] });
    expect(of(r, 'answer')[0]).toMatchObject({ optionId: null, by: 'timeout' });
    const writer = model.requests.find((q) => shape(q) === 'sections')!;
    expect(JSON.stringify(writer.messages)).toContain('Who is it for? → Hikers');
    const result = r.result as TaskResult;
    expect(result.deliverable?.kind).toBe('document');
    // Without materials nothing in the text can be checked: the label says so.
    expect(result.units.find((u) => u.kind === 'section')!.status).toBe('agent');
  });

  it('declines what the agents cannot do and says what they can make instead', async () => {
    const model = fakeModel(() => planAnswer({ fit: 'no', notDoable: 'booking flights', instead: 'a trip plan from your dates and budget', deliverable: 'plan' }));
    const project = newTaskProject({ text: 'Book me a flight to Lisbon', by: 'typed', links: [] });
    const r = await (await startTask(project, [], deps(model))).done;
    expect(r.status).toBe('declined');
    expect(of(r, 'note').map((n) => n.text).join(' ')).toContain('They can make a trip plan from your dates and budget instead');
  });

  it('stops honestly when the daily cap is reached', async () => {
    const err = Object.assign(new Error('cap'), { kind: 'http', status: 429, code: 'daily-cap', body: { error: 'daily-cap' } });
    const model = fakeModel(() => err);
    const project = newTaskProject({ text: 'Make a site', by: 'typed', links: [] });
    const r = await (await startTask(project, [], deps(model))).done;
    expect(r.status).toBe('failed');
    expect(of(r, 'error')[0].code).toBe('daily-cap');
  });
});
