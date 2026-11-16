/**
 * The assembly table: the deliverable is put together by code from the kept units only.
 *
 *   site      every kept file of the write-code steps, with the whole project checked once
 *             more (LoadReport); a sample opens at /samples/<id>/, a live project after
 *             its files are uploaded (preview.code, see start.ts uploadPreview)
 *   document  the kept sections in plan order
 *   plan      the kept items, the window, the team, and totals summed by code
 */
import type { Deliverable, PlanColumn, PlanItem, SiteFile } from '../types';
import { checkProject, mimeOf } from '../checks/code/project';
import type { Engine } from './engine';
import type { Section } from './steps';

export function assemble(e: Engine): Deliverable | null {
  const plan = e.plan;
  const version = (e.ctx.spec.previous?.version ?? 0) + 1;
  if (plan.deliverable === 'site') {
    const files = [...e.files].map(([path, f]) => ({ path, text: f.text }));
    if (!files.length) return null;
    const required = plan.steps.flatMap((s) => s.args.required ?? []);
    const pc = checkProject(files, { required, ...(e.hasMaterials ? { sources: e.baseSources() } : {}) });
    const siteFiles: SiteFile[] = files.map((f) => {
      const c = pc.files.find((x) => x.path === f.path)!;
      return { path: f.path, mime: mimeOf(f.path), text: f.text, bytes: new TextEncoder().encode(f.text).length, checks: c.checks, ok: c.problems.length === 0 };
    });
    siteFiles.sort((a, b) => (a.path === 'index.html' ? -1 : b.path === 'index.html' ? 1 : a.path.localeCompare(b.path)));
    const sample = e.ctx.project.sample;
    return {
      kind: 'site',
      title: plan.title,
      entry: 'index.html',
      files: siteFiles,
      load: pc.load,
      preview: { code: null, sampleUrl: sample ? `/samples/${sample}/` : null },
      version,
    };
  }
  if (plan.deliverable === 'document') {
    const sections: Extract<Deliverable, { kind: 'document' }>['sections'] = [];
    for (const s of plan.steps) {
      if (s.kind !== 'write-section') continue;
      const data = e.outputs.get(s.id)?.data as { sections?: (Section & { id: string })[] } | undefined;
      for (const sec of data?.sections ?? []) {
        const unit = e.units.find((u) => u.id === sec.id);
        if (!unit) continue;
        const sources = (unit.from ?? [])
          .map((id) => e.units.find((u) => u.id === id))
          .filter((u) => u?.quote)
          .map((u) => {
            const q = u!.quote!;
            return 'docTitle' in q.source ? `"${q.text}" (${q.source.docTitle}, p. ${q.source.page})` : `"${q.text}" (${q.source.url})`;
          });
        sections.push({ id: sec.id, heading: unit.title, text: unit.body, units: [unit.id, ...(unit.from ?? [])], sources });
      }
    }
    return { kind: 'document', title: plan.title, sections, version };
  }
  const items: PlanItem[] = [];
  const totals: Extract<Deliverable, { kind: 'plan' }>['totals'] = [];
  const columns: PlanColumn[] = [];
  for (const s of plan.steps) {
    if (s.kind !== 'make-plan') continue;
    const data = e.outputs.get(s.id)?.data as { items?: PlanItem[]; totals?: typeof totals; columns?: PlanColumn[] } | undefined;
    items.push(...(data?.items ?? []).filter((i) => e.units.some((u) => u.id === i.id)));
    totals.push(...(data?.totals ?? []));
    for (const c of data?.columns ?? []) if (!columns.some((x) => x.name === c.name)) columns.push(c);
  }
  items.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return { kind: 'plan', title: plan.title, columns, items, totals, window: plan.window, team: plan.team, version };
}
