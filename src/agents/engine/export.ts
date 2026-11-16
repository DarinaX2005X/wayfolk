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
  const head = ['Task', 'Owner', 'Start', 'End', 'Depends on', 'Done when', ...extra];
  const byId = new Map(d.items.map((i) => [i.id, i.task]));
  const rows = d.items.map((i) => [i.task, i.owner, i.start, i.end, i.depends.map((x) => byId.get(x) ?? x).join('; '), i.done ?? '', ...extra.map((c) => i.cells[c] ?? '')]);
  for (const t of d.totals) rows.push(['Total', '', '', '', '', '', ...extra.map((c) => (c === t.column ? t.value : ''))]);
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
      `DESCRIPTION:${icsText(`Owner: ${i.owner}${i.done ? `\nDone when: ${i.done}` : ''}`)}`,
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

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DAY = 86_400_000;
const dayNo = (iso: string) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso: string) => (isIsoDate(iso) ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}` : iso);
const OWNER_HUES = [205, 152, 28, 340, 260, 95, 180, 5];

/**
 * A plan as one page a person opens in a browser: a timeline with a bar per item, coloured
 * by owner, and the table under it with the extra columns and totals. Self-contained (no
 * scripts, no fonts from elsewhere); `downloads` links the CSV and calendar files beside it.
 */
export function toPlanPage(result: TaskResult, downloads: { csv?: string; ics?: string } = {}): string {
  const d = result.deliverable;
  if (d?.kind !== 'plan') throw new Error('plan page: the deliverable is not a plan');
  const dated = d.items.filter((i) => isIsoDate(i.start) && isIsoDate(i.end));
  const from = d.window?.from ?? dated.map((i) => i.start).sort()[0] ?? '';
  const to = d.window?.to ?? dated.map((i) => i.end).sort().at(-1) ?? '';
  const span = isIsoDate(from) && isIsoDate(to) ? Math.max(1, dayNo(to) - dayNo(from) + 1) : 1;
  const owners = [...new Set([...d.team.map((t) => t.split(':')[0].trim()), ...d.items.map((i) => i.owner)])].filter(Boolean);
  const hue = (o: string) => OWNER_HUES[Math.max(0, owners.indexOf(o)) % OWNER_HUES.length];
  const pct = (iso: string) => ((dayNo(iso) - dayNo(from)) / span) * 100;
  // Week lines: every Monday inside the window.
  const weeks: string[] = [];
  if (isIsoDate(from)) {
    let t = dayNo(from);
    while (new Date(t * DAY).getUTCDay() !== 1) t++;
    for (; t <= dayNo(to); t += 7) weeks.push(new Date(t * DAY).toISOString().slice(0, 10));
  }
  const byId = new Map(d.items.map((i) => [i.id, i.task]));
  const extra = d.columns.map((c) => c.name);
  const bars = d.items
    .map((i) => {
      const ok = isIsoDate(i.start) && isIsoDate(i.end);
      const left = ok ? Math.max(0, pct(i.start)) : 0;
      const width = ok ? Math.max(0.8, ((dayNo(i.end) - dayNo(i.start) + 1) / span) * 100) : 0;
      return `<li><span class="task">${esc(i.task)}<small>${esc(i.owner)}, ${shortDate(i.start)} to ${shortDate(i.end)}</small></span><span class="lane"><span class="bar" style="left:${left.toFixed(2)}%;width:${Math.min(width, 100 - left).toFixed(2)}%;--h:${hue(i.owner)}"></span></span></li>`;
    })
    .join('\n');
  const rows = d.items
    .map((i) => `<tr><td>${esc(i.task)}${i.done ? `<small>Done when ${esc(i.done.replace(/^done when:?\s*/i, ''))}</small>` : ''}</td><td><span class="who" style="--h:${hue(i.owner)}"></span>${esc(i.owner)}</td><td class="num">${shortDate(i.start)}</td><td class="num">${shortDate(i.end)}</td><td>${esc(i.depends.map((x) => byId.get(x) ?? x).join(', '))}</td>${extra.map((c) => `<td class="num">${esc(i.cells[c] ?? '')}</td>`).join('')}</tr>`)
    .join('\n');
  const totals = d.totals
    .map((t) => `<tr class="total"><td colspan="5">Total ${esc(t.column)}</td>${extra.map((c) => `<td class="num">${c === t.column ? esc(t.value) : ''}</td>`).join('')}</tr>`)
    .join('\n');
  const legend = owners.map((o) => `<li><span class="who" style="--h:${hue(o)}"></span>${esc(o)}</li>`).join('');
  const links = [downloads.csv ? `<a href="${esc(downloads.csv)}" download>Download the table (CSV)</a>` : '', downloads.ics ? `<a href="${esc(downloads.ics)}" download>Add to a calendar (ICS)</a>` : ''].filter(Boolean).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)}</title>
<style>
:root{--bg:#f6f4ef;--ink:#1f2328;--soft:#5b616b;--line:#dedad1;--card:#fffdf8;--accent:#1d6b57}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-variant-numeric:tabular-nums}
main{max-width:1080px;margin:0 auto;padding:clamp(20px,4vw,48px) 16px 64px}
h1{font-size:clamp(28px,4vw,40px);line-height:1.15;margin:0 0 8px}
.lead{color:var(--soft);margin:0 0 20px;max-width:60ch}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;list-style:none;padding:0;margin:0 0 20px;font-size:14px}
.who{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px;background:hsl(var(--h) 55% 45%)}
.downloads{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 28px}
.downloads a{color:#fff;background:var(--accent);text-decoration:none;padding:9px 14px;border-radius:8px;font-weight:600;font-size:14px}
.downloads a:focus-visible,.downloads a:hover{background:#155343;outline:2px solid #155343;outline-offset:2px}
.timeline{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 20px 20px;margin-bottom:32px}
.scale{display:grid;grid-template-columns:minmax(150px,32%) 1fr;font-size:12px;color:var(--soft)}
.ticks{position:relative;height:20px}
.ticks span{position:absolute;transform:translateX(-50%);white-space:nowrap}
.timeline ul{list-style:none;margin:0;padding:0}
.timeline li{display:grid;grid-template-columns:minmax(150px,32%) 1fr;align-items:center;gap:12px;padding:7px 0}
.task{font-size:14px;font-weight:600;line-height:1.3}
.task small{display:block;font-weight:400;color:var(--soft);font-size:12px;margin-top:2px}
.lane{position:relative;height:18px;background:repeating-linear-gradient(90deg,transparent 0 calc(${(700 / span).toFixed(3)}% - 1px),var(--line) calc(${(700 / span).toFixed(3)}% - 1px) ${(700 / span).toFixed(3)}%);background-position-x:${weeks[0] && isIsoDate(from) ? pct(weeks[0]).toFixed(3) : 0}%;border-radius:4px}
.bar{position:absolute;top:2px;bottom:2px;border-radius:5px;background:hsl(var(--h) 55% 45%)}
h2{font-size:20px;margin:0 0 12px}
.table{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:14px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:10px 14px;vertical-align:top}
td small{display:block;color:var(--soft);font-size:13px;margin-top:2px;max-width:48ch}
th{font-size:13px;color:var(--soft);font-weight:600;border-bottom:1px solid var(--line)}
tbody tr:nth-child(even){background:#f9f7f1}
.num{white-space:nowrap}
.total td{font-weight:700;border-top:1px solid var(--line)}
footer{margin-top:28px;color:var(--soft);font-size:14px}
@media (max-width:640px){.timeline li,.scale{grid-template-columns:1fr}.scale>span:first-child{display:none}}
</style>
</head>
<body>
<main>
<h1>${esc(d.title)}</h1>
<p class="lead">${d.items.length} tasks${isIsoDate(from) ? ` from ${shortDate(from)} ${from.slice(0, 4)} to ${shortDate(to)} ${to.slice(0, 4)}` : ''}${owners.length ? `, shared by ${owners.length} ${owners.length === 1 ? 'person' : 'people'}` : ''}.</p>
<ul class="legend">${legend}</ul>
${links ? `<div class="downloads">${links}</div>` : ''}
<section class="timeline" aria-label="Timeline">
<div class="scale"><span></span><div class="ticks">${weeks.map((w) => `<span style="left:${pct(w).toFixed(2)}%">${shortDate(w)}</span>`).join('')}</div></div>
<ul>
${bars}
</ul>
</section>
<h2>All tasks</h2>
<div class="table"><table>
<thead><tr><th>Task</th><th>Owner</th><th>Start</th><th>End</th><th>After</th>${extra.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
<tbody>
${rows}
${totals}
</tbody>
</table></div>
<footer>${esc(honestLine(result))}</footer>
</main>
</body>
</html>
`;
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
    out.push({ name: `${name}.html`, mime: 'text/html', text: toPlanPage(result, { csv: `${name}.csv`, ics: `${name}.ics` }) });
  }
  if (d?.kind === 'site') for (const f of d.files) out.push({ name: `${name}/${f.path}`, mime: f.mime, text: f.text });
  return out;
}
