/**
 * Application state: signals only (PLAN "Настройки и store"). Features read and write
 * these; nothing else is shared between them.
 *
 * `settings` is remembered on this device (`gw.settings.v1`). It is loaded here through
 * a sanitizer, so a broken or outdated stored value never reaches the rest of the app,
 * and every later change is written back by bindPersist. Projects, runs and the world
 * are kept in IndexedDB by persist.ts; their owners load them into these signals.
 *
 * Who writes what: `captions` only src/feel/captions.ts; `input` only src/interact/;
 * `inboxTouched` the home view; `mode` the session code in src/app/boot/.
 */
import { signal, type Signal } from '@preact/signals-core';
import type {
  InputKind,
  LlmStatus,
  Mode,
  Project,
  ProjectId,
  PublicWorld,
  RunHandle,
  Seat,
  Settings,
  TimelineFilter,
  View,
  World,
} from '../agents/types';
import { bindPersist, load, type Sanitize } from './prefs';

export type { Mode, Settings, View } from '../agents/types';

/** One line of the caption rail. `key`: a line that is never folded away. */
export type CaptionLine = { source: string; text: string; key?: boolean };

export const KEYS = {
  settings: 'gw.settings.v1',
  ownerKey: 'gw.ownerKey',
  worldName: 'gw.worldName',
  seen: 'gw.seen',
} as const;

export const DWELL_MS = [600, 800, 1200] as const;

/** Sound and captions on; less motion when the system asks for it; dwell 800 ms. */
export function defaultSettings(): Settings {
  let lessMotion = false;
  try {
    lessMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    lessMotion = false;
  }
  return {
    sound: true,
    captions: true,
    highContrast: false,
    lessMotion,
    largeText: false,
    dwell: false,
    dwellMs: 800,
  };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

const SWITCHES = ['sound', 'captions', 'highContrast', 'lessMotion', 'largeText', 'dwell'] as const;

/**
 * Keeps every stored switch that is a boolean and a dwell time that is one of the three
 * offered; anything else takes its default. Unknown keys (older builds) are dropped.
 */
export const sanitizeSettings: Sanitize<Settings> = (raw) => {
  if (!isRecord(raw)) return undefined;
  const out = defaultSettings();
  for (const key of SWITCHES) {
    const value = raw[key];
    if (typeof value === 'boolean') out[key] = value;
  }
  if ((DWELL_MS as readonly unknown[]).includes(raw.dwellMs)) out.dwellMs = raw.dwellMs as Settings['dwellMs'];
  return out;
};

export type Store = {
  mode: Signal<Mode>;
  settings: Signal<Settings>;
  llm: Signal<LlmStatus | null>;
  world: Signal<World | null>;
  projects: Signal<Map<ProjectId, Project>>;
  activeProjectId: Signal<ProjectId | null>;
  activeRun: Signal<RunHandle | null>;
  view: Signal<View>;
  timelineFilter: Signal<TimelineFilter>;
  /** Key of the open contradiction pair. */
  openPair: Signal<string | null>;
  /** The last two lines; written only by src/feel/captions.ts. */
  captions: Signal<CaptionLine[]>;
  visiting: Signal<PublicWorld | null>;
  together: Signal<Seat[] | null>;
  /** Multiplier of recorded waits and of the display queue minimums; 1 by default. */
  pace: Signal<number>;
  /** Input kind of the last action; written by src/interact/. */
  input: Signal<InputKind>;
  /** Whether the person touched an envelope since it appeared; written by the home view. */
  inboxTouched: Signal<Record<string, boolean>>;
};

export const store: Store = {
  mode: signal<Mode>('desk'),
  settings: signal(load(KEYS.settings, defaultSettings(), sanitizeSettings)),
  llm: signal<LlmStatus | null>(null),
  world: signal<World | null>(null),
  projects: signal(new Map<ProjectId, Project>()),
  activeProjectId: signal<ProjectId | null>(null),
  activeRun: signal<RunHandle | null>(null),
  view: signal<View>('home'),
  timelineFilter: signal<TimelineFilter>({}),
  openPair: signal<string | null>(null),
  captions: signal<CaptionLine[]>([]),
  visiting: signal<PublicWorld | null>(null),
  together: signal<Seat[] | null>(null),
  pace: signal(1),
  input: signal<InputKind>('mouse'),
  inboxTouched: signal<Record<string, boolean>>({}),
};

bindPersist(store.settings, KEYS.settings, sanitizeSettings);
