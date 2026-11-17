/**
 * Creates world, life, mind (and live visits) in that order (PLAN «Контракты»). A module
 * whose `index.ts` exists is used; until then, or when its factory throws, a thin
 * stand-in from ./standin/ takes its place behind the same shape, so the first minute
 * always runs. `import.meta.glob` finds the modules when the app is built, so a missing
 * folder is not a build error.
 */
import { personName } from './name';
import { registerDebug } from './debug';
import { shareOrigin } from './origin';
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
  // Life reads the island through a few optional calls; the world names some differently.
  const w = world as WorldPort & Record<string, unknown>;
  const lifeWorld = {
    root: world.root,
    ready: world.ready,
    pier: world.pier,
    seat: world.seat,
    spots: () => world.spots(),
    heightAt: (x: number, z: number) => world.groundY?.(x, z) ?? world.groundAt?.(x, z) ?? 0,
    route: typeof w.route === 'function' ? (a: unknown, b: unknown) => (w.route as (a: unknown, b: unknown) => unknown[])(a, b) : undefined,
    perches: typeof w.perches === 'function' ? () => (w.perches as () => unknown[])() : undefined,
    benches: typeof w.benches === 'function' ? () => (w.benches as () => unknown[])() : undefined,
    radius: typeof w.radius === 'number' ? w.radius : undefined,
  };
  const life = await attempt<LifePort>('life', lifeMods, 'createLife', [app, lifeWorld], () => createStandinLife(app, world));
  const mind = await attempt<MindPort>('mind', mindMods, 'createMind', [{ demo: true }], () => createStandinMind());
  // Live presence is shared in the island's frame; avatars go into the island root.
  const liveApp = { world: app.world, space: world.root, everyFrame: app.everyFrame };
  const liveOpts = {
    name: personName(),
    linkBase: `${shareOrigin()}/island`,
    snapshot: () => mind.state ?? null,
    ground: (x: number, z: number) => world.groundY?.(x, z) ?? world.groundAt?.(x, z) ?? null,
  };
  const live = await attempt<LivePort>('live', liveMods, 'createLive', [liveApp, liveOpts], () => createStandinLive());
  registerDebug('modules', { world, life, mind, live, report });
  return { world, life, mind, live, report };
}
