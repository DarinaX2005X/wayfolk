/**
 * Routes of the single-page app. One index.html serves every address (vercel.json
 * rewrites, the Vite dev fallback); this module picks the page and loads it as its own
 * chunk, so the entry stays light.
 *
 *   /, /island        the landing page with the island behind it   src/pages/home/
 *   /p/<island>       a postcard: the island in 3D on a phone       src/pages/postcard/
 *
 * Each page module exports `mount(root, params)`.
 */

export type RouteName = 'home' | 'postcard';

export type RouteParams = {
  name: RouteName;
  path: string;
  /** /p/<id>: the island id, decoded. */
  code: string | null;
  hash: string;
  query: URLSearchParams;
};

export type PageModule = {
  mount(root: HTMLElement, params: RouteParams): Promise<void>;
};

const pages: Record<RouteName, () => Promise<PageModule>> = {
  home: () => import('./home/index'),
  postcard: () => import('./postcard/index'),
};

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return segment.trim();
  }
}

/** Maps a pathname to a route, or null when no page lives there. */
export function resolveRoute(pathname: string): Pick<RouteParams, 'name' | 'code'> | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  const head = parts[0]?.toLowerCase();
  if (parts.length === 0 || (parts.length === 1 && (head === 'index.html' || head === 'island' || head === 'app'))) return { name: 'home', code: null };
  if (head === 'p' && parts.length === 2) {
    const code = decodeSegment(parts[1]);
    if (code) return { name: 'postcard', code };
  }
  return null;
}

function note(root: HTMLElement, title: string, action: { label: string; href?: string; run?: () => void }): void {
  const box = document.createElement('main');
  box.className = 'shell-note';
  const heading = document.createElement('h1');
  heading.textContent = title;
  let control: HTMLElement;
  if (action.href !== undefined) {
    const link = document.createElement('a');
    link.href = action.href;
    control = link;
  } else {
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => action.run?.());
    control = button;
  }
  control.className = 'wf-button wf-primary';
  control.textContent = action.label;
  box.append(heading, control);
  root.replaceChildren(box);
}

export async function route(root: HTMLElement | null = document.getElementById('app')): Promise<void> {
  if (!root) throw new Error('route(): the page has no #app element to mount into');
  const found = resolveRoute(location.pathname);
  if (!found) {
    root.dataset.route = 'unknown';
    note(root, 'There is no page at this address', { label: 'Go to the island', href: '/' });
    return;
  }
  const params: RouteParams = { ...found, path: location.pathname, hash: location.hash.replace(/^#/, ''), query: new URLSearchParams(location.search) };
  root.dataset.route = found.name;
  try {
    const page = await pages[found.name]();
    await page.mount(root, params);
  } catch (error) {
    console.error(`[wf] page "${found.name}" failed to start`, error);
    root.dataset.route = 'failed';
    note(root, 'This page did not load', { label: 'Load it again', run: () => location.reload() });
  }
}
