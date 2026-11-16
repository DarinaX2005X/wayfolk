// One-line page of route /x/<code> (package 01.1); 02.4 owns this folder and builds the page.
import type { RouteParams } from '../router';

export async function mount(root: HTMLElement, params: RouteParams): Promise<void> {
  const page = document.createElement('main');
  page.className = 'shell-note';
  const mark = document.createElement('img');
  mark.src = '/logo.svg';
  mark.alt = 'Groundwork';
  mark.className = 'shell-logo';
  const line = document.createElement('h1');
  line.textContent = `Result for code ${params.code ?? ''}`;
  page.append(mark, line);
  root.replaceChildren(page);
  void params;
}
