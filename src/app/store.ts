/**
 * Application state of Wayfolk: signals only. Features read and write these; nothing
 * else is shared between them.
 *
 * `settings` is remembered on this device (`wf.settings.v1`) through a sanitizer, so a
 * broken or outdated stored value never reaches the rest of the app.
 *
 * Who writes what: `captions` only src/feel/captions.ts; `input` only the hands and the
 * pointer; `mode` the session code in src/app/boot/; `phase` the first-minute flow
 * (src/app/flow/); `scene` the entry (src/app/entry/).
 */
import { signal, type Signal } from '@preact/signals-core';
import { bindPersist, load, type Sanitize } from './prefs';

/** desk: an ordinary browser without a session; void: inside the world; room: passthrough. */
export type Mode = 'desk' | 'void' | 'room';
export type InputKind = 'hand' | 'ray' | 'gaze' | 'dwell' | 'mouse';

export type Settings = {
  sound: boolean;
  captions: boolean;
  highContrast: boolean;
  lessMotion: boolean;
  largeText: boolean;
  dwell: boolean;
  dwellMs: 600 | 800 | 1200;
};

/** Where the first minute stands (src/app/flow/). */
export type Phase =
  | 'boot'
  | 'room'
  | 'clouds'
  | 'greet'
  | 'palm'
  | 'arrive'
  | 'talk'
  | 'place'
  | 'build'
  | 'goodnight'
  | 'free'
  | 'news'
  | 'farewell';

/** What the person sees around them: their room, the island, or the island small on the table. */
export type SceneLook = 'room' | 'entering' | 'island' | 'leaving' | 'table';

/** One line of the caption rail. `key`: a line that is never folded away. */
export type CaptionLine = { source: string; text: string; key?: boolean };

export type LlmStatusLike = { live: boolean; [k: string]: unknown };

export const KEYS = {
  settings: 'wf.settings.v1',
  ownerKey: 'wf.ownerKey',
  worldName: 'wf.worldName',
  seen: 'wf.seen',
} as const;

export const DWELL_MS = [600, 800, 1200] as const;

/** Sound and captions on; less motion when the system asks for it. */
export function defaultSettings(): Settings {
  let lessMotion = false;
  try {
    lessMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    lessMotion = false;
  }
  return { sound: true, captions: true, highContrast: false, lessMotion, largeText: false, dwell: false, dwellMs: 800 };
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const SWITCHES = ['sound', 'captions', 'highContrast', 'lessMotion', 'largeText', 'dwell'] as const;

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
  llm: Signal<LlmStatusLike | null>;
  /** The last two lines; written only by src/feel/captions.ts. */
  captions: Signal<CaptionLine[]>;
  /** Multiplier of waits in the flow; 1 by default, smaller in scenarios. */
  pace: Signal<number>;
  /** Input kind of the last action. */
  input: Signal<InputKind>;
  phase: Signal<Phase>;
  look: Signal<SceneLook>;
  /** Reply choices on offer right now (the bubbles by the hand, the buttons at the desk). */
  choices: Signal<string[]>;
  /** The resident the person is talking to, if any. */
  talkingTo: Signal<string | null>;
  /** True while the microphone records a clip. */
  listening: Signal<boolean>;
  /** The traveler or the line now on offer came from the prepared set, not a live model. */
  prepared: Signal<boolean>;
  /** The person has dragged and clicked at the desk: the controls hint can go. */
  deskUsed: Signal<boolean>;
  /** The live invite link, once made. */
  invite: Signal<string | null>;
  /** The last postcard link, once made. */
  postcard: Signal<{ url: string; image: string } | null>;
  /** Browser mode: the one next thing to do, shown by the page as a paper tag with an arrow. */
  cue: Signal<string | null>;
  /** Browser mode: the person has walked with the keys or the stick. */
  walked: Signal<boolean>;
  /** Browser mode: the person has hurried a long moment with a click. */
  hurried: Signal<boolean>;
  /** What the person just said (typed, or heard from the microphone), shown back to them. */
  heard: Signal<string | null>;
  /** Who is speaking now ('pip', a resident id), for the page to place the replies by them. */
  speaker: Signal<string | null>;
  /** The evening show now playing (src/app/evening.ts): a story by the fire, or a concert. */
  show: Signal<'story' | 'concert' | null>;
  /**
   * Browser mode, written every frame by src/app/desk/: where on the page the speaker and
   * the cue target are (CSS pixels; `on` false when behind the camera or off the page).
   * A plain object, not a signal, so the page reads it in its own animation frame.
   */
  points: { speaker: ScreenPoint; cue: ScreenPoint };
};

export type ScreenPoint = { x: number; y: number; on: boolean; /** the target's height on the page, px */ size: number };

export const store: Store = {
  mode: signal<Mode>('desk'),
  settings: signal(load(KEYS.settings, defaultSettings(), sanitizeSettings)),
  llm: signal<LlmStatusLike | null>(null),
  captions: signal<CaptionLine[]>([]),
  pace: signal(1),
  input: signal<InputKind>('mouse'),
  phase: signal<Phase>('boot'),
  look: signal<SceneLook>('island'),
  choices: signal<string[]>([]),
  talkingTo: signal<string | null>(null),
  listening: signal(false),
  postcard: signal<{ url: string; image: string } | null>(null),
  prepared: signal(false),
  invite: signal<string | null>(null),
  deskUsed: signal(false),
  cue: signal<string | null>(null),
  walked: signal(false),
  hurried: signal(false),
  heard: signal<string | null>(null),
  speaker: signal<string | null>(null),
  show: signal<'story' | 'concert' | null>(null),
  points: { speaker: { x: 0, y: 0, on: false, size: 0 }, cue: { x: 0, y: 0, on: false, size: 0 } },
};

bindPersist(store.settings, KEYS.settings, sanitizeSettings);
