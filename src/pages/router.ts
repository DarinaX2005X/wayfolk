/**
 * Routes of the single-page app. One index.html serves every address (vercel.json
 * rewrites, the Vite dev fallback); this module picks the page and loads it as its own
 * chunk, so the entry stays light and a page pays only for what it uses.
 *
 *   /                       landing   src/pages/landing/
 *   /app                    the work  src/pages/app/       (?run, ?answers, ?pace, ?debug, ?capture)
 *   /go, /go/<code>         phone     src/pages/go/
 *   /drop/<code>            files     src/pages/drop/
 *   /w/<world>[/<work>]     a world   src/pages/world/
 *   /j/<code>               join      src/pages/join/
 *   /x/<code>               export    src/pages/export/
 *   /gallery                states    src/pages/gallery/
 *
 * Each page module exports `mount(root, params)`. Pages are entered by a normal page
 * load: there is no in-app navigation, because the contract has no unmount.
 */

export type RouteName = 'landing' | 'app' | 'go' | 'drop' | 'world' | 'join' | 'export' | 'gallery';

export type RouteParams = {
  name: RouteName;
  /** Pathname as the browser gave it. */
  path: string;
  /** /go/<code>, /drop/<code>, /j/<code>, /x/<code>: the code, decoded; null where absent. */
  code: string | null;
  /** /w/<world>: the world name; /w/<world>/<work>: and the work slug. */
  world: string | null;
  work: string | null;
  /** Hash without the leading `#`. */
  hash: string;
  query: URLSearchParams;
};

export type PageModule = {
  mount(root: HTMLElement, params: RouteParams): Promise<void>;
};

const pages: Record<RouteName, () => Promise<PageModule>> = {
  landing: () => import('./landing/index'),
  app: () => import('./app/index'),
  go: () => import('./go/index'),
  drop: () => import('./drop/index'),
  world: () => import('./world/index'),
  join: () => import('./join/index'),
  export: () => import('./export/index'),
  gallery: () => import('./gallery/index'),
};

/** Decodes one path segment; a malformed escape is kept as typed rather than thrown. */
function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment).trim();
  } catch {
    return segment.trim();
  }
}

type Resolved = Pick<RouteParams, 'name' | 'code' | 'world' | 'work'>;

/**
 * Maps a pathname to a route. Trailing slashes and the letter case of the fixed parts do
 * not matter. Returns null when no page lives at the address.
 */
export function resolveRoute(pathname: string): Resolved | null {
  const parts = pathname.split('/').filter((part) => part !== '');
  const head = parts[0]?.toLowerCase();
  const none = { code: null, world: null, work: null };
  const arg = (i: number): string | null => {
    const value = parts[i] === undefined ? '' : decodeSegment(parts[i]);
    return value === '' ? null : value;
  };
  if (parts.length === 0 || (parts.length === 1 && head === 'index.html')) return { name: 'landing', ...none };
  if (parts.length === 1 && (head === 'app' || head === 'gallery')) return { name: head, ...none };
  if (head === 'go' && parts.length <= 2) return { name: 'go', ...none, code: arg(1) };
  if (parts.length === 2) {
    if (head === 'drop') return { name: 'drop', ...none, code: arg(1) };
    if (head === 'j') return { name: 'join', ...none, code: arg(1) };
    if (head === 'x') return { name: 'export', ...none, code: arg(1) };
  }
  if (head === 'w' && (parts.length === 2 || parts.length === 3)) {
    const world = arg(1);
    if (world) return { name: 'world', code: null, world, work: arg(2) };
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
  control.className = 'button button-primary';
  control.textContent = action.label;
  box.append(heading, control);
  root.replaceChildren(box);
}

/**
 * Reads the current address and mounts its page into `root` (default: `#app`).
 * An unknown address and a page that fails to load both end in a readable message
 * with one action instead of an empty field.
 */
export async function route(root: HTMLElement | null = document.getElementById('app')): Promise<void> {
  if (!root) throw new Error('route(): the page has no #app element to mount into');
  const found = resolveRoute(location.pathname);
  if (!found) {
    root.dataset.route = 'unknown';
    note(root, 'There is no page at this address', { label: 'Go to Groundwork', href: '/' });
    return;
  }
  const params: RouteParams = {
    ...found,
    path: location.pathname,
    hash: location.hash.replace(/^#/, ''),
    query: new URLSearchParams(location.search),
  };
  root.dataset.route = found.name;
  try {
    const page = await pages[found.name]();
    await page.mount(root, params);
  } catch (error) {
    console.error(`[gw] page "${found.name}" failed to start`, error);
    root.dataset.route = 'failed';
    note(root, 'This page did not load', { label: 'Load it again', run: () => location.reload() });
  }
}
