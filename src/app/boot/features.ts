/**
 * Features of the product plug in without edits to shared files (PLAN "Подключение
 * пакетов без общих файлов"). Each feature folder has an `install.ts`:
 *
 *   export const order = 20;                    // lower installs first; core is 0
 *   export function install(app: App): void | Promise<void> { ... }
 *
 * Folders searched at build time: src/app/<feature>/, src/views/<view>/ and src/voice,
 * src/export, src/late, src/drop, src/world, src/public-world, src/social, src/access,
 * src/onboarding. They run by `order`, then by folder name. The required features
 * (`core`, order 0, and `home`, order 10) must succeed; any other feature that throws is
 * reported and skipped, so one broken tool does not take the whole scene down.
 */
import { registerDebug } from '../debug';
import type { App } from './world';

export type FeatureModule = {
  order: number;
  install(app: App): void | Promise<void>;
};

export type FeatureReport = {
  installed: string[];
  failed: { name: string; error: string }[];
};

/**
 * Folder of a module path (as import.meta.glob gives it from src/app/boot/), relative to
 * src/: '../core/install.ts' -> 'app/core', '../../views/run/install.ts' -> 'views/run'.
 */
export function nameOf(path: string): string {
  const parts = ['app', 'boot'];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  parts.pop();
  return parts.join('/');
}

function isFeature(mod: unknown): mod is FeatureModule {
  const m = mod as Partial<FeatureModule> | null;
  return typeof m?.install === 'function' && typeof m.order === 'number' && Number.isFinite(m.order);
}

/** Sorted by `order`, then by name, so the sequence never depends on file listing order. */
export function sortFeatures(modules: Record<string, unknown>): { name: string; feature: FeatureModule }[] {
  const list: { name: string; feature: FeatureModule }[] = [];
  for (const [path, mod] of Object.entries(modules)) {
    const name = nameOf(path);
    if (!isFeature(mod)) {
      throw new Error(`src/${name}/install.ts must export "order" (a number) and "install" (a function)`);
    }
    list.push({ name, feature: mod });
  }
  return list.sort((a, b) => a.feature.order - b.feature.order || a.name.localeCompare(b.name));
}

/**
 * The install order of PLAN "Подключение пакетов без общих файлов". A feature whose
 * `order` differs is still installed by its own number, with a warning in the console.
 */
export const ORDER: Readonly<Record<string, number>> = {
  'app/core': 0,
  world: 5,
  'views/home': 10,
  'views/run': 20,
  'views/check': 30,
  'views/timeline': 40,
  'views/seating': 41,
  'views/essays': 42,
  voice: 50,
  export: 55,
  late: 60,
  drop: 61,
  'public-world': 70,
  social: 71,
  access: 80,
  onboarding: 90,
};

/** Features nothing works without. Their failure stops the boot. */
export const REQUIRED = new Set(['app/core', 'views/home']);

/** Every install.ts the plan allows, found when the app is built. */
export function featureModules(): Record<string, unknown> {
  return {
    ...import.meta.glob('../*/install.ts', { eager: true }),
    ...import.meta.glob('../../views/*/install.ts', { eager: true }),
    ...import.meta.glob(
      [
        '../../voice/install.ts',
        '../../export/install.ts',
        '../../late/install.ts',
        '../../drop/install.ts',
        '../../world/install.ts',
        '../../public-world/install.ts',
        '../../social/install.ts',
        '../../access/install.ts',
        '../../onboarding/install.ts',
      ],
      { eager: true },
    ),
  };
}

export async function installFeatures(app: App, modules: Record<string, unknown> = featureModules()): Promise<FeatureReport> {
  const report: FeatureReport = { installed: [], failed: [] };
  for (const { name, feature } of sortFeatures(modules)) {
    const planned = ORDER[name];
    if (planned !== undefined && planned !== feature.order) {
      console.warn(`[gw] feature "${name}" has order ${feature.order}, the plan gives ${planned}`);
    }
    try {
      await feature.install(app);
      report.installed.push(name);
    } catch (error) {
      if (REQUIRED.has(name)) throw error;
      console.error(`[gw] feature "${name}" failed to install and was skipped`, error);
      report.failed.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  registerDebug('features', report);
  return report;
}
