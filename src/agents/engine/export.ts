/**
 * Exports of a deliverable, as files a person keeps:
 *
 *   document  Markdown (.md) and Word (.docx, through the `docx` package), with the sources
 *             of every section and the honest label of the run
 *   plan      CSV (.csv, one row per item) and a calendar (.ics, one all-day event per item)
 *   site      the project files themselves, and a small README.md
 *
 * Every export ends with the same counts as the result ("31 parts checked by code,
 * 4 reviewed by an agent"); the word "verified" is never used.
 */
import type { Deliverable, TaskResult } from '../types';
import { addDays, isIsoDate } from '../checks/dates';

export type ExportFile = { name: string; mime: string; text?: string; bytes?: Uint8Array };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project';

export function honestLine(result: TaskResult): string {
  const s = result.stats;
  const parts = [`${s.checked} part${s.checked === 1 ? '' : 's'} checked by code`, `${s.agentOnly} reviewed by an agent`];
  if (s.sentBack) parts.push(`${s.sentBack} sent back (${s.fixed} fixed, ${s.dropped} dropped)`);
  return `${parts.join(', ')}. ${result.label}.`;
}

export function toMarkdown(result: TaskResult): string {
  const d = result.deliverable;
  const out: string[] = [];
  if (!d) return `# ${result.plan.title}\n\nNo deliverable yet.\n`;
  out.push(`# ${d.title}`);
  if (d.kind === 'document') {
    for (const s of d.sections) {
      out.push(`## ${s.heading}`, s.text);
      if (s.sources.length) out.push('Sources:\n' + s.sources.map((x) => `- ${x}`).join('\n'));
    }
  } else if (d.kind === 'plan') {
    if (d.window) out.push(`From ${d.window.from} to ${d.window.to}. Team: ${d.team.join(', ') || 'not named'}.`);
    const extra = d.columns.map((c) => c.name);
    out.push(['| Task | Owner | Start | End | ' + extra.join(' | ') + (extra.length ? ' |' : ''), '|---|---|---|---|' + extra.map(() => '---|').join('')].join('\n') + '\n' + d.items.map((i) => `| ${i.task} | ${i.owner} | ${i.start} | ${i.end} | ${extra.map((c) => i.cells[c] ?? '').join(' | ')}${extra.length ? ' |' : ''}`).join('\n'));
    for (const t of d.totals) out.push(`Total ${t.column}: ${t.value}${t.ok ? '' : ` (the agent wrote ${t.stated}; code summed the items again)`}`);
  } else {
    out.push(`A ${d.files.length}-file web project. Open index.html in a browser.`, d.files.map((f) => `- ${f.path} (${f.bytes} bytes)`).join('\n'));
  }
  if (result.reviews.length) out.push('## Review notes (an agent\'s reading)', result.reviews.map((r) => `- ${r.severity === 'major' ? '**Major:** ' : ''}${r.text}`).join('\n'));
  out.push('---', `_${honestLine(result)}_`);
  return out.join('\n\n') + '\n';
}

const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCsv(d: Extract<Deliverable, { kind: 'plan' }>): string {
  const extra = d.columns.map((c) => c.name);
  const head = ['Task', 'Owner', 'Start', 'End', 'Depends on', ...extra];
  const byId = new Map(d.items.map((i) => [i.id, i.task]));
  const rows = d.items.map((i) => [i.task, i.owner, i.start, i.end, i.depends.map((x) => byId.get(x) ?? x).join('; '), ...extra.map((c) => i.cells[c] ?? '')]);
  for (const t of d.totals) rows.push(['Total', '', '', '', '', ...extra.map((c) => (c === t.column ? t.value : ''))]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const icsDate = (iso: string) => iso.replace(/-/g, '');

/** One all-day event per item (DTEND is the day after the end, as the format wants). */
export function toIcs(d: Extract<Deliverable, { kind: 'plan' }>, stamp = '20260101T000000Z'): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Groundwork//Plan//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsText(d.title)}`];
  for (const i of d.items) {
    if (!isIsoDate(i.start) || !isIsoDate(i.end)) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${i.id}-${slug(d.title)}@groundwork`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(i.start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(i.end, 1))}`,
      `SUMMARY:${icsText(i.task)}`,
      `DESCRIPTION:${icsText(`Owner: ${i.owner}`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  // Lines of the format are folded at 75 octets.
  return lines.map((l) => (l.length > 74 ? l.match(/.{1,74}/g)!.join('\r\n ') : l)).join('\r\n') + '\r\n';
}

/** A Word file of a document (or of any deliverable as its Markdown text). */
export async function toDocx(result: TaskResult): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import('docx');
  const d = result.deliverable;
  const children: InstanceType<typeof Paragraph>[] = [new Paragraph({ text: d?.title ?? result.plan.title, heading: HeadingLevel.TITLE })];
  const para = (text: string) => text.split(/\n\s*\n/).map((p) => new Paragraph({ children: [new TextRun(p.replace(/\n/g, ' '))] }));
  if (d?.kind === 'document') {
    for (const s of d.sections) {
      children.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }), ...para(s.text));
      if (s.sources.length) {
        children.push(new Paragraph({ children: [new TextRun({ text: 'Sources', bold: true })] }));
        for (const src of s.sources) children.push(new Paragraph({ text: src, bullet: { level: 0 } }));
      }
    }
  } else {
    for (const block of toMarkdown(result).split('\n\n').slice(1)) children.push(...para(block.replace(/[#*_|]/g, '')));
  }
  children.push(new Paragraph({ children: [new TextRun({ text: honestLine(result), italics: true })] }));
  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}

/** Every export of a result. */
export async function exportFiles(result: TaskResult): Promise<ExportFile[]> {
  const d = result.deliverable;
  const name = slug(d?.title ?? result.plan.title);
  const out: ExportFile[] = [{ name: `${name}.md`, mime: 'text/markdown', text: toMarkdown(result) }];
  if (d?.kind === 'document') out.push({ name: `${name}.docx`, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: await toDocx(result) });
  if (d?.kind === 'plan') {
    out.push({ name: `${name}.csv`, mime: 'text/csv', text: toCsv(d) });
    out.push({ name: `${name}.ics`, mime: 'text/calendar', text: toIcs(d) });
  }
  if (d?.kind === 'site') for (const f of d.files) out.push({ name: `${name}/${f.path}`, mime: f.mime, text: f.text });
  return out;
}
