/**
 * The action registry: how parallel packages call each other without editing each other's
 * files (PLAN "Подключение пакетов без общих файлов"). A feature registers what it can do
 * in its install.ts; a button or an envelope exists only for what is registered, so no
 * control of a deployed stage leads into a dead end.
 *
 *   registerAction('export', (projectId) => ...)    returns the function that unregisters
 *   runAction('export', projectId)                  always resolves with an ActionResult
 *   hasAction('export')                             whether to show the button at all
 */
import type { ProjectId } from '../agents/types';

/** `reason` is a ready English line for the caption under the button. */
export type ActionResult = { ok: true } | { ok: false; reason: string };

/** The fixed action names and their arguments. */
export type ActionArgs = {
  'open-work': [projectId: ProjectId];
  export: [projectId: ProjectId];
  share: [projectId: ProjectId];
  together: [projectId: ProjectId];
  'add-files': [projectId: ProjectId];
  rerun: [projectId: ProjectId];
  'remove-plot': [projectId: ProjectId];
  'visit-code': [code: string];
  'join-code': [code: string];
  'enter-code': [];
  'show-changes': [projectId: ProjectId, diff: unknown];
  'late-envelope': [projectId: ProjectId];
};
export type ActionName = keyof ActionArgs;

export type ActionFn<N extends ActionName> = (...args: ActionArgs[N]) => ActionResult | void | Promise<ActionResult | void>;

/** What an unregistered action answers. The stage check makes sure no person sees it. */
export const NOT_AVAILABLE = "This isn't available in this copy.";
/** What an action that threw answers; the error itself goes to the console. */
export const FAILED = "That didn't work. Try again.";

const registry = new Map<ActionName, ActionFn<ActionName>>();
const listeners = new Set<() => void>();

const changed = (): void => {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (error) {
      console.error('[gw] action listener failed', error);
    }
  }
};

/** Registers `fn` under `name`, replacing an earlier one. Returns the function that unregisters it. */
export function registerAction<N extends ActionName>(name: N, fn: ActionFn<N>): () => void {
  const entry = fn as unknown as ActionFn<ActionName>;
  registry.set(name, entry);
  changed();
  return () => {
    if (registry.get(name) === entry) {
      registry.delete(name);
      changed();
    }
  };
}

export function hasAction(name: ActionName): boolean {
  return registry.has(name);
}

/** Runs an action. Never throws: an unknown action or a failure becomes `{ ok: false, reason }`. */
export async function runAction<N extends ActionName>(name: N, ...args: ActionArgs[N]): Promise<ActionResult> {
  const fn = registry.get(name);
  if (!fn) return { ok: false, reason: NOT_AVAILABLE };
  try {
    const result = await fn(...(args as ActionArgs[ActionName]));
    return result ?? { ok: true };
  } catch (error) {
    console.error(`[gw] action "${name}" failed`, error);
    return { ok: false, reason: FAILED };
  }
}

/** Called whenever an action is registered or removed, so buttons can be rebuilt. */
export function onActionsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
