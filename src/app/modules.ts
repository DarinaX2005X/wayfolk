/**
 * Creates world, life, mind (and live visits) in that order (PLAN «Контракты»). A module
 * whose `index.ts` exists is used; until then, or when its factory throws, a thin
 * stand-in from ./standin/ takes its place behind the same shape, so the first minute
 * always runs. `import.meta.glob` finds the modules when the app is built, so a missing
 * folder is not a build error.
 */
import { registerDebug } from './debug';
import type { AppHandle, LifePort, LivePort, MindPort, ModuleReport, WorldPort } from './ports';
import { createStandinLife } from './standin/life';
import { createStandinLive } from './standin/live';
import { createStandinMind } from './standin/mind';
import { createStandinWorld } from './standin/world';

type Loader = () => Promise<unknown>;
const worldMods = import.meta.glob('../world/index.ts') as Record<string, Loader>;
const lifeMods = import.meta.glob('../life/index.ts') as Record<string, Loader>;
const mindMods = import.meta.glob('../mind/index.ts') as Record<string, Loader>;
const liveMods = import.meta.glob('../live/index.ts') as Record<string, Loader>;

export type Modules = { world: WorldPort; life: LifePort; mind: MindPort; live: LivePort; report: ModuleReport };

async function factory(mods: Record<string, Loader>, name: string): Promise<((...args: unknown[]) => unknown) | null> {
  const load = Object.values(mods)[0];
  if (!load) return null;
  const mod = (await load()) as Record<string, unknown>;
  const fn = mod[name] ?? (mod.default as Record<string, unknown> | undefined)?.[name];
  return typeof fn === 'function' ? (fn as (...args: unknown[]) => unknown) : null;
}

/** Skips the real modules (`?standin=world,life`), for comparing and for tests. */
function forcedStandins(): Set<string> {
  try {
    return new Set((new URLSearchParams(location.search).get('standin') ?? '').split(',').filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function createModules(app: AppHandle): Promise<Modules> {
  const report: ModuleReport = { world: 'standin', life: 'standin', mind: 'standin', live: 'standin', errors: [] };
  const skip = forcedStandins();
  const attempt = async <T>(key: keyof Omit<ModuleReport, 'errors'>, mods: Record<string, Loader>, name: string, args: unknown[], fallback: () => T): Promise<T> => {
    if (!skip.has(key)) {
      try {
        const make = await factory(mods, name);
        if (make) {
          const made = (await make(...args)) as T;
          if (made) {
            report[key] = 'real';
            return made;
          }
        }
      } catch (error) {
        console.error(`[wf] ${key} module failed to start; the stand-in takes its place`, error);
        report.errors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return fallback();
  };

  const world = await attempt<WorldPort>('world', worldMods, 'createWorld', [app], () => createStandinWorld(app));
  if (!world.root.parent) app.root.add(world.root);
  const life = await attempt<LifePort>('life', lifeMods, 'createLife', [app, world], () => createStandinLife(app, world));
  const mind = await attempt<MindPort>('mind', mindMods, 'createMind', [], () => createStandinMind());
  const live = await attempt<LivePort>('live', liveMods, 'createLive', [app], () => createStandinLive());
  registerDebug('modules', { world, life, mind, live, report });
  return { world, life, mind, live, report };
}
