// One-line page of route /w/<world> (package 01.1); 04.2 owns this folder and builds the page.
import type { RouteParams } from '../router';

export async function mount(root: HTMLElement, params: RouteParams): Promise<void> {
  const page = document.createElement('main');
  page.className = 'shell-note';
  const mark = document.createElement('img');
  mark.src = '/logo.svg';
  mark.alt = 'Groundwork';
  mark.className = 'shell-logo';
  const line = document.createElement('h1');
  line.textContent = params.work ? `${params.work} in ${params.world}` : `World ${params.world ?? ''}`;
  page.append(mark, line);
  root.replaceChildren(page);
  void params;
}
