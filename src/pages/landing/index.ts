// One-line page of route / (package 01.1); 04.5 owns this folder and builds the page.
import type { RouteParams } from '../router';

export async function mount(root: HTMLElement, params: RouteParams): Promise<void> {
  const page = document.createElement('main');
  page.className = 'shell-note';
  const mark = document.createElement('img');
  mark.src = '/logo.svg';
  mark.alt = 'Groundwork';
  mark.className = 'shell-logo';
  const line = document.createElement('h1');
  line.textContent = 'Agents do the groundwork. Your world grows with every job.';
  page.append(mark, line);
  root.replaceChildren(page);
  void params;
}
