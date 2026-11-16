import { describe, expect, it } from 'vitest';
import { createPreviewRoutes, PREVIEW_CSP } from '../../api/_lib/preview';
import { dedupe } from '../../src/agents/checks/dedupe';
import { uploadPreview } from '../../src/agents/engine/start';
import type { TaskResult } from '../../src/agents/types';

const env = () => ({ STORAGE_DRIVER: 'memory' }) as unknown as NodeJS.ProcessEnv;

describe('the preview route of live projects', () => {
  const routes = createPreviewRoutes({ env, files: () => null });
  const site = {
    title: 'Corner shop',
    files: [
      { path: 'index.html', text: '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><h1>Hi</h1><script src="js/app.js" defer></script></body></html>' },
      { path: 'styles.css', text: 'h1{color:brown}' },
      { path: 'js/app.js', text: 'localStorage.setItem("a","1")' },
    ],
  };

  it('stores the files and serves each with its type and a strict policy', async () => {
    const post = await routes.POST(new Request('http://localhost/api/r', { method: 'POST', body: JSON.stringify(site), headers: { 'content-type': 'application/json' } }));
    expect(post.status).toBe(200);
    const { code, url } = (await post.json()) as { code: string; url: string };
    expect(url).toBe(`/api/r/${code}/`);
    const page = await routes.GET(new Request(`http://localhost${url}`));
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(page.headers.get('content-security-policy')).toBe(PREVIEW_CSP);
    expect(PREVIEW_CSP).toMatch(/sandbox/);
    expect(PREVIEW_CSP).not.toMatch(/allow-same-origin/);
    const html = await page.text();
    expect(html).toContain('<h1>Hi</h1>');
    expect(html.indexOf('localStorage')).toBeLessThan(html.indexOf('<h1>'));
    const css = await routes.GET(new Request(`http://localhost/api/r/${code}/styles.css`));
    expect(css.headers.get('content-type')).toMatch(/^text\/css/);
    const js = await routes.GET(new Request(`http://localhost/api/r/${code.toLowerCase()}/js/app.js`));
    expect(js.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect((await routes.GET(new Request(`http://localhost/api/r/${code}/missing.js`))).status).toBe(404);
    expect((await routes.GET(new Request(`http://localhost/api/r/${code}/..%2Fsecret`))).status).toBe(404);
  });

  it('refuses paths outside the project, unknown types and a project without index.html', async () => {
    for (const files of [[{ path: '../x.html', text: '' }], [{ path: 'index.html', text: '' }, { path: 'run.exe', text: '' }], [{ path: 'page.html', text: '' }]]) {
      const res = await routes.POST(new Request('http://localhost/api/r', { method: 'POST', body: JSON.stringify({ title: 'x', files }), headers: { 'content-type': 'application/json' } }));
      expect(res.status).toBe(400);
    }
  });

  it('uploadPreview sends a live site and gives a sample its own address', async () => {
    const result = { deliverable: { kind: 'site', title: 'T', entry: 'index.html', files: site.files.map((f) => ({ ...f, mime: '', bytes: 0, checks: [], ok: true })), load: { ok: true, errors: [], required: [] }, preview: { code: null, sampleUrl: null }, version: 1 } } as unknown as TaskResult;
    const up = await uploadPreview(result, { fetch: (i, init) => (i.endsWith('/api/r') ? routes.POST(new Request('http://localhost' + i, init)) : Promise.reject(new Error(i))) });
    expect(up.url).toMatch(/^\/api\/r\/[A-Z2-9]{6}\/$/);
    const sample = structuredClone(result);
    if (sample.deliverable?.kind === 'site') sample.deliverable.preview.sampleUrl = '/samples/bakery-site/';
    expect((await uploadPreview(sample)).url).toBe('/samples/bakery-site/');
  });
});

describe('dedupe', () => {
  const line = 'Country sourdough loaf: $7.50 Seeded rye loaf: $8.00 Butter croissant: $3.75';
  it('keeps two prices read from one line of a price list', () => {
    const kept = [{ id: 'f1', page: 1, quote: line, claim: 'A country sourdough loaf costs $7.50.' }];
    expect(dedupe({ page: 1, quote: line, claim: 'A seeded rye loaf costs $8.00.' }, kept)).toBeNull();
  });
  it('merges the same fact said twice', () => {
    const kept = [{ id: 'f1', page: 1, quote: line, claim: 'A country sourdough loaf costs $7.50.' }];
    expect(dedupe({ page: 1, quote: 'Country sourdough loaf: $7.50', claim: 'The country sourdough loaf costs $7.50' }, kept)).toBe('f1');
  });
});
