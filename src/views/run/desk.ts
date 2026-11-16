/**
 * The task line of the /app page at the desk (no headset): a field to type a task into
 * and, after a result, a link to open the site. It lives in the page's #command-slot; on
 * pages without the slot (the gallery) it does nothing.
 */
let onTask: ((text: string) => void) | null = null;
let field: HTMLInputElement | null = null;
let note: HTMLElement | null = null;
let linkRow: HTMLElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const deskInput = {
  mount(start: (text: string) => void, status: () => { live: boolean; line: string }): void {
    onTask = start;
    const slot = typeof document !== 'undefined' ? document.getElementById('command-slot') : null;
    if (!slot || slot.dataset.mounted) return;
    slot.dataset.mounted = '1';
    const form = el('form', 'app-task');
    form.setAttribute('aria-label', 'Give the agents a task');
    const label = el('label', 'visually-hidden', 'Task for the agents');
    label.htmlFor = 'task-field';
    field = el('input', 'app-task-field');
    field.id = 'task-field';
    field.placeholder = 'Type a task, for example "A one-page site for my bike repair shop"';
    field.autocomplete = 'off';
    const go = el('button', 'button button-primary app-task-go', 'Start');
    go.type = 'submit';
    note = el('p', 'app-task-note');
    note.setAttribute('aria-live', 'polite');
    linkRow = el('p', 'app-task-link');
    linkRow.hidden = true;
    form.append(label, field, go);
    slot.append(form, note, linkRow);
    const refresh = (): void => {
      const s = status();
      if (note) note.textContent = s.live ? '' : `${s.line} Take an envelope from the inbox to watch one.`;
    };
    refresh();
    setInterval(refresh, 5000);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = field?.value.trim() ?? '';
      if (!text) return;
      onTask?.(text);
      if (field) field.value = '';
    });
  },
  focus(): void {
    field?.focus();
  },
  /** A link that opens the result: shown on the page so the person can open it after leaving VR. */
  link(url: string, label: string): void {
    if (!linkRow) return;
    linkRow.replaceChildren();
    const a = el('a', 'button button-secondary', label);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    linkRow.append(a);
    linkRow.hidden = false;
  },
};
