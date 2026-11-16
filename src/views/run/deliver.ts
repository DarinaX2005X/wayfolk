/**
 * The finished work leaves the world: the preview of a site, and a short code that opens
 * any deliverable on a phone.
 *
 *   previewOf(result)   where the site can be opened: the sample's own copy
 *                       (/samples/<id>/) when it is there, else an upload to /api/r (a
 *                       short code, opens on any device), else a copy kept in this browser
 *   phoneLink(result)   a short code for the phone: the site itself, or a document or a
 *                       plan rendered as one page and uploaded the same way
 */
import type { Deliverable, TaskResult } from '../../agents/types';
import { uploadPreview } from '../../agents/engine/start';

export type Preview = { url: string; code: string | null; where: 'sample' | 'server' | 'browser' };

const cache = new WeakMap<object, Promise<Preview>>();

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'GET', cache: 'no-store' });
    const type = r.headers.get('content-type') ?? '';
    // The app's own fallback page answers every address with index.html: that is not the sample.
    return r.ok && type.includes('text/html') && !(await r.text()).includes('id="app"');
  } catch {
    return false;
  }
}

/** One self-contained HTML file: styles and scripts of the project inlined. */
export function inlineSite(d: Extract<Deliverable, { kind: 'site' }>): string {
  const files = new Map(d.files.map((f) => [f.path, f.text]));
  let html = files.get('index.html') ?? d.files.find((f) => /\.html?$/.test(f.path))?.text ?? '';
  html = html.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (m, href: string) => (files.has(href) ? `<style>\n${files.get(href)}\n</style>` : m));
  html = html.replace(/<script([^>]*)src="([^"]+\.m?js)"([^>]*)><\/script>/g, (m, a: string, src: string, b: string) => {
    if (!files.has(src)) return m;
    // An inline script runs at once: what `defer` waited for has to wait for DOMContentLoaded.
    const code = files.get(src)!.replace(/<\/script/gi, '<\\/script');
    return `<script${/type="module"/.test(a + b) ? ' type="module"' : ''}>\n${code}\n</script>`;
  });
  // Deferred scripts were in <head>; the inlined copy goes to the end of the body.
  const scripts: string[] = [];
  html = html.replace(/<head>([\s\S]*?)<\/head>/, (m, head: string) => `<head>${head.replace(/<script>[\s\S]*?<\/script>/g, (s) => (scripts.push(s), ''))}</head>`);
  return scripts.length ? html.replace('</body>', `${scripts.join('\n')}\n</body>`) : html;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A document or a plan as one readable page. */
export function pageOf(d: Deliverable): string {
  const style = `body{margin:0;background:#F6F4EF;color:#1E2421;font:17px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif}main{max-width:760px;margin:0 auto;padding:32px 20px 48px}h1{font-size:34px;line-height:1.1;margin:0 0 20px}h2{font-size:21px;margin:28px 0 8px}table{border-collapse:collapse;width:100%;font-size:15px}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #DDD6C8;vertical-align:top}th{color:#4E5753}td.n{font-variant-numeric:tabular-nums;white-space:nowrap}`;
  let body = '';
  if (d.kind === 'document') {
    body = d.sections.map((s) => `<h2>${esc(s.heading)}</h2>${s.text.split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('')}`).join('');
  } else if (d.kind === 'plan') {
    const extra = d.columns.map((c) => c.name);
    body =
      `<table><thead><tr><th>Task</th><th>Owner</th><th>Start</th><th>End</th>${extra.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>` +
      d.items.map((i) => `<tr><td>${esc(i.task)}</td><td>${esc(i.owner)}</td><td class="n">${esc(i.start)}</td><td class="n">${esc(i.end)}</td>${extra.map((c) => `<td class="n">${esc(i.cells[c] ?? '')}</td>`).join('')}</tr>`).join('') +
      '</tbody></table>' +
      (d.totals.length ? `<p>${d.totals.map((t) => `${esc(t.column)}: ${esc(t.value)}`).join(' · ')}</p>` : '');
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.title)}</title><style>${style}</style></head><body><main><h1>${esc(d.title)}</h1>${body}</main></body></html>`;
}

async function upload(title: string, files: { path: string; text: string }[]): Promise<{ code: string; url: string }> {
  const res = await fetch('/api/r', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, files }) });
  if (!res.ok) throw new Error(`preview upload refused (${res.status})`);
  return (await res.json()) as { code: string; url: string };
}

/** Where the site of this result opens. Never throws: the last way is a copy in this browser. */
export function previewOf(result: TaskResult): Promise<Preview> {
  const d = result.deliverable;
  let p = cache.get(result);
  if (p) return p;
  p = (async (): Promise<Preview> => {
    if (d?.kind !== 'site') throw new Error('preview: only a site opens as a page');
    if (d.preview.sampleUrl && (await exists(d.preview.sampleUrl))) return { url: d.preview.sampleUrl, code: null, where: 'sample' };
    try {
      const up = await uploadPreview({ ...result, deliverable: { ...d, preview: { code: null, sampleUrl: null } } });
      return { url: up.url, code: up.code || null, where: 'server' };
    } catch (error) {
      console.warn('[gw] the preview could not be uploaded; keeping a copy in this browser', error);
      const blob = new Blob([inlineSite(d)], { type: 'text/html' });
      return { url: URL.createObjectURL(blob), code: null, where: 'browser' };
    }
  })();
  cache.set(result, p);
  return p;
}

/** A short code that opens this result on a phone. Throws with a readable line when the server can't keep it. */
export async function phoneLink(result: TaskResult): Promise<{ code: string; url: string }> {
  const d = result.deliverable;
  if (!d) throw new Error('There is nothing to send yet.');
  try {
    if (d.kind === 'site') {
      const p = await previewOf(result);
      if (p.code) return { code: p.code, url: p.url };
      return await upload(d.title, d.files.map((f) => ({ path: f.path, text: f.text })));
    }
    return await upload(d.title, [{ path: 'index.html', text: pageOf(d) }]);
  } catch (error) {
    console.warn('[gw] phone link failed', error);
    throw new Error("The phone link needs the preview service, which didn't answer. Try again in a minute.");
  }
}

/** The address a phone opens for a code: short and typeable. */
export function phoneAddress(code: string): string {
  return `${location.host}/go/${code}`;
}
