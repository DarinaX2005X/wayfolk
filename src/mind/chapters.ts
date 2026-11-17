/**
 * Chapters of the evening of stories: a resident's story acted out by paper cut-outs.
 *
 * Three sources, in order: the prepared chapters recorded for every prepared traveler
 * (content/chapters.json), a live chapter the model writes for a new resident, and a
 * directed chapter built here from the resident's own story beats, which always works.
 * Every chapter, wherever it came from, passes `cleanChapter` against the fixed
 * vocabulary of src/mind/types.ts before the theatre sees it.
 */
import type { ChatMessage, JsonSchema } from '../../api/_lib/contracts';
import chaptersJson from '../../content/chapters.json';
import { STYLE, WORLD } from './prompts';
import { offStyle, tidy } from './schema';
import {
  SILHOUETTES,
  STAGE_LAYERS,
  STAGE_MOODS,
  STAGE_PLACES,
  STAGE_VERBS,
  type CastMember,
  type Chapter,
  type ChapterBeat,
  type Resident,
  type SilhouetteKind,
  type StageAction,
  type StageLayer,
  type StageMood,
  type StagePlace,
  type StageVerb,
} from './types';
import { TRADE_WORDS } from './words';

export const CHAPTER_LIMITS = {
  beatsMin: 5,
  beatsMax: 13,
  lineMax: 200,
  castMax: 10,
  actionsMax: 4,
  /** All lines together, characters: roughly 45 to 100 seconds at the fire. */
  charsMin: 300,
  charsMax: 1500,
} as const;

/** Words a model (or a story beat) may use for a cut-out we have. */
const SYNONYMS: Record<string, SilhouetteKind> = {
  me: 'fox',
  ship: 'boat',
  sailboat: 'boat',
  raft: 'boat',
  cottage: 'house',
  home: 'house',
  hut: 'house',
  shop: 'house',
  stall: 'tent',
  village: 'town',
  city: 'town',
  castle: 'tower',
  forest: 'tree',
  wood: 'tree',
  woods: 'tree',
  oak: 'tree',
  apple: 'tree',
  fir: 'pine',
  meadow: 'hill',
  field: 'hill',
  mountain: 'hill',
  hills: 'hill',
  stone: 'rock',
  rocks: 'rock',
  stove: 'oven',
  kettle: 'teapot',
  tea: 'teapot',
  mug: 'cup',
  loaf: 'bread',
  bun: 'bread',
  cake: 'bread',
  pie: 'bread',
  violin: 'fiddle',
  guitar: 'fiddle',
  music: 'notes',
  song: 'notes',
  songs: 'notes',
  tune: 'notes',
  painting: 'easel',
  canvas: 'easel',
  bees: 'hive',
  honey: 'hive',
  beehive: 'hive',
  pumpkins: 'pumpkin',
  gourd: 'pumpkin',
  watch: 'clock',
  note: 'letter',
  postcard: 'letter',
  envelope: 'letter',
  stairs: 'ladder',
  staircase: 'ladder',
  stool: 'chair',
  bench: 'chair',
  flowers: 'flower',
  seed: 'flower',
  seeds: 'flower',
  carrot: 'flower',
  carrots: 'flower',
  rose: 'flower',
  basketful: 'basket',
  shoe: 'boot',
  boots: 'boot',
  sock: 'boot',
  moonlight: 'moon',
  sunrise: 'sun',
  sunset: 'sun',
  dawn: 'sun',
  clouds: 'cloud',
  mist: 'cloud',
  fog: 'cloud',
  star: 'star',
  stars: 'stars',
  storm: 'rain',
  rainy: 'rain',
  raining: 'rain',
  breeze: 'wind',
  gust: 'wind',
  windy: 'wind',
  ocean: 'sea',
  waves: 'sea',
  wave: 'sea',
  river: 'sea',
  pond: 'sea',
  lake: 'sea',
  water: 'sea',
  gulls: 'gull',
  seagull: 'gull',
  birds: 'birds',
  sparrow: 'bird',
  crow: 'bird',
  fishes: 'fish',
  whales: 'whale',
  bee: 'bee',
  goats: 'goat',
  lamp: 'lantern',
  lanterns: 'lantern',
  candle: 'lantern',
  islands: 'island',
  telescopes: 'telescope',
  maps: 'map',
  books: 'book',
  story: 'book',
  stories: 'book',
  bell: 'bell',
  bells: 'bell',
};

const VERB_SYNONYMS: Record<string, StageVerb> = {
  walk: 'move',
  go: 'move',
  run: 'move',
  slide: 'move',
  leave: 'exit',
  vanish: 'fade',
  disappear: 'fade',
  hide: 'fade',
  jump: 'hop',
  bounce: 'hop',
  float: 'fly',
  drift: 'fly',
  show: 'appear',
  come: 'enter',
  arrive: 'enter',
  wobble: 'shake',
  shiver: 'shake',
  bigger: 'grow',
  smaller: 'shrink',
  flip: 'turn',
  rotate: 'spin',
  shine: 'glow',
  light: 'glow',
  fall: 'sink',
  drop: 'sink',
  lift: 'rise',
  climb: 'rise',
  dance: 'hop',
  rock: 'sway',
  wave: 'sway',
};

const KIND_SET = new Set<string>(SILHOUETTES);
const VERB_SET = new Set<string>(STAGE_VERBS);
const PLACE_SET = new Set<string>(STAGE_PLACES);
const LAYER_SET = new Set<string>(STAGE_LAYERS);
const MOOD_SET = new Set<string>(STAGE_MOODS);

const SKY_KINDS = new Set<SilhouetteKind>(['bird', 'birds', 'gull', 'whale', 'bee', 'balloon', 'kite', 'umbrella', 'lantern', 'island', 'notes', 'letter', 'moon', 'sun', 'cloud', 'stars', 'star', 'wind', 'rainbow']);
const FAR_KINDS = new Set<SilhouetteKind>(['hill', 'town', 'island', 'moon', 'sun', 'stars', 'rainbow', 'cloud', 'sea', 'lighthouse', 'windmill', 'tower', 'rain', 'snow']);
const FOLK = new Set<SilhouetteKind>(['fox', 'rabbit', 'cat', 'bear', 'frog', 'owl', 'deer', 'hedgehog', 'raccoon', 'penguin', 'mouse', 'otter', 'goat']);

export const isFolk = (k: SilhouetteKind): boolean => FOLK.has(k);
export const inSky = (k: SilhouetteKind): boolean => SKY_KINDS.has(k);

/** A word to a cut-out kind, or null. */
export function kindOf(word: unknown, teller?: Resident): SilhouetteKind | null {
  if (typeof word !== 'string') return null;
  const w = word.trim().toLowerCase().replace(/[^a-z-]/g, '');
  if (KIND_SET.has(w)) return w as SilhouetteKind;
  if ((w === 'me' || w === 'i' || w === 'myself') && teller) return teller.species;
  const syn = SYNONYMS[w];
  if (syn === 'fox' && w === 'me') return teller?.species ?? 'fox';
  if (syn) return syn;
  if (w.endsWith('s') && KIND_SET.has(w.slice(0, -1))) return w.slice(0, -1) as SilhouetteKind;
  return null;
}

function verbOf(word: unknown): StageVerb | null {
  if (typeof word !== 'string') return null;
  const w = word.trim().toLowerCase();
  if (VERB_SET.has(w)) return w as StageVerb;
  return VERB_SYNONYMS[w] ?? null;
}

function placeOf(word: unknown): StagePlace | null {
  if (typeof word !== 'string') return null;
  const w = word.trim().toLowerCase().replace(/\s+/g, '-');
  if (PLACE_SET.has(w)) return w as StagePlace;
  if (w === 'middle') return 'center';
  if (w === 'top' || w === 'up') return 'high';
  if (w === 'off-left' || w === 'offstage') return 'offstage-left';
  if (w === 'off-right') return 'offstage-right';
  return null;
}

const defaultLayer = (k: SilhouetteKind): StageLayer => (FOLK.has(k) ? 'near' : FAR_KINDS.has(k) ? 'far' : 'mid');
const defaultPlace = (k: SilhouetteKind): StagePlace => (k === 'moon' || k === 'sun' ? 'sky-right' : SKY_KINDS.has(k) ? 'sky' : 'center');

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const slug = (s: unknown): string =>
  typeof s === 'string'
    ? s
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 20)
    : '';

/**
 * A chapter from anything (the model, a file, the director), checked and repaired
 * against the vocabulary: unknown cut-outs and verbs are mapped or dropped, the teller
 * is always in the cast. Returns a reason when it cannot be used.
 */
export function cleanChapter(raw: unknown, r: Resident, n: number, source: Chapter['source']): Chapter | string {
  if (!isRecord(raw)) return 'not an object';
  const mood: StageMood = MOOD_SET.has(String(raw.mood)) ? (raw.mood as StageMood) : 'dusk';
  const titleRaw = typeof raw.title === 'string' ? tidy(raw.title).replace(/[.]+$/, '') : '';
  const title = titleRaw && titleRaw.length <= 60 ? titleRaw : `${r.name.split(' ')[0]}'s story`;

  const cast: CastMember[] = [];
  const ids = new Map<string, string>();
  for (const c of Array.isArray(raw.cast) ? raw.cast : []) {
    if (!isRecord(c) || cast.length >= CHAPTER_LIMITS.castMax) continue;
    const said = slug(c.id);
    const kind = said === 'me' ? r.species : kindOf(c.kind, r);
    if (!kind) continue;
    let id = said || kind;
    while (cast.some((x) => x.id === id)) id = `${id}-2`;
    ids.set(slug(c.id) || kind, id);
    const layer = LAYER_SET.has(String(c.layer)) ? (c.layer as StageLayer) : defaultLayer(kind);
    const at = placeOf(c.at) ?? defaultPlace(kind);
    const member: CastMember = { id, kind, layer, at: at === 'offstage-left' || at === 'offstage-right' || at === 'below' || at === 'above' ? defaultPlace(kind) : at };
    if (c.hidden === true) member.hidden = true;
    if (c.facing === 'left' || c.facing === 'right') member.facing = c.facing;
    if (typeof c.size === 'number' && Number.isFinite(c.size)) member.size = Math.min(1.6, Math.max(0.6, c.size));
    cast.push(member);
  }

  // The teller is always there: 'me', or the first cut-out of their species.
  let me = cast.find((c) => c.id === 'me') ?? cast.find((c) => c.kind === r.species);
  let addedMe = false;
  if (!me) {
    me = { id: 'me', kind: r.species, layer: 'near', at: 'left', hidden: true };
    cast.unshift(me);
    addedMe = true;
  }
  ids.set('me', me.id);
  ids.set('i', me.id);

  const beats: ChapterBeat[] = [];
  for (const b of Array.isArray(raw.beats) ? raw.beats : []) {
    if (!isRecord(b) || beats.length >= CHAPTER_LIMITS.beatsMax) continue;
    const line = typeof b.line === 'string' ? tidy(b.line) : '';
    if (!line || line.length > CHAPTER_LIMITS.lineMax || offStyle(line)) continue;
    const actions: StageAction[] = [];
    for (const a of Array.isArray(b.actions) ? b.actions : []) {
      if (!isRecord(a) || actions.length >= CHAPTER_LIMITS.actionsMax) continue;
      const verb = verbOf(a.do);
      const who = ids.get(slug(a.who)) ?? cast.find((c) => c.id === slug(a.who))?.id ?? (kindOf(a.who, r) ? cast.find((c) => c.kind === kindOf(a.who, r))?.id : undefined);
      if (!verb || !who) continue;
      const to = placeOf(a.to);
      actions.push(to ? { do: verb, who, to } : { do: verb, who });
    }
    beats.push({ line, actions });
  }
  if (beats.length < CHAPTER_LIMITS.beatsMin) return `only ${beats.length} usable lines`;
  const chars = beats.reduce((s, b) => s + b.line.length, 0);
  if (chars < CHAPTER_LIMITS.charsMin) return `too short (${chars} characters)`;
  if (chars > CHAPTER_LIMITS.charsMax) return `too long (${chars} characters)`;

  // A teller who waits off stage and is never called comes on with the first line.
  const meId = me.id;
  // Any action brings a waiting cut-out on stage (the theatre fades it in), except leaving.
  const bringsOn = (a: StageAction): boolean => a.do !== 'exit' && a.do !== 'fade' && a.do !== 'sink';
  const called = beats.some((b) => b.actions.some((a) => a.who === meId && bringsOn(a)));
  if ((me.hidden || addedMe) && !called) beats[0].actions = [{ do: 'enter' as const, who: meId, to: me.at }, ...beats[0].actions].slice(0, CHAPTER_LIMITS.actionsMax);
  // Every hidden cut-out that is never brought on is shown from the start instead.
  for (const c of cast) {
    if (!c.hidden) continue;
    const used = beats.some((b) => b.actions.some((a) => a.who === c.id && bringsOn(a)));
    if (!used) c.hidden = false;
  }
  return { id: `${r.id}-${n}`, residentId: r.id, n, title, mood, cast, beats, source };
}

// ---------------------------------------------------------------- the model

const s = (description?: string): JsonSchema => (description ? { type: 'string', description } : { type: 'string' });
const e = (values: readonly string[], description?: string): JsonSchema => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const CHAPTER_SCHEMA: JsonSchema = obj({
  title: s('three to six words'),
  mood: e(STAGE_MOODS, 'light of the stage'),
  cast: {
    type: 'array',
    description: 'three to eight cut-outs; the teller has id "me"',
    items: obj({
      id: s('short name used by actions, e.g. "me", "oven", "gull"'),
      kind: e(SILHOUETTES),
      layer: e(STAGE_LAYERS, 'far for scenery, mid for big things, near for folk'),
      at: e(STAGE_PLACES.filter((p) => !p.startsWith('offstage') && p !== 'below' && p !== 'above'), 'where it stands once on stage'),
      hidden: { type: 'boolean', description: 'true if it comes on later with enter, appear, rise or fly' },
    }),
  },
  beats: {
    type: 'array',
    description: 'eight to eleven lines in order',
    items: obj({
      line: s('first person, one or two short sentences, under 150 characters'),
      actions: {
        type: 'array',
        description: 'one to three things the cut-outs do while the line is told',
        items: obj({ do: e(STAGE_VERBS), who: s('a cast id'), to: e([...STAGE_PLACES, 'none'], 'where to, or none') }),
      },
    }),
  },
});

export function chapterMessages(r: Resident, n: number, islandName: string): ChatMessage[] {
  const trade = TRADE_WORDS[r.trade];
  const beat = r.story.beats[(n - 1) % Math.max(1, r.story.beats.length)] ?? r.story.intro;
  const system = `${WORLD}\n\n${STYLE}\n\nYou are ${r.name}, a ${r.species} and ${trade.person}. ${r.personality}
Tonight you sit by the campfire on ${islandName} and tell chapter ${n} of your own story to the person. While you talk, the birds act it out as a paper silhouette theatre in the clouds, with cut-outs from a fixed box. Write the chapter as a short script, answering only with JSON in the given schema.

Rules:
- Eight to eleven lines, told in your voice, first person, one or two short sentences each, about seventy seconds read aloud in all. A small, complete episode with a beginning, a turn and a gentle close that leaves something for another night.
- Build it around this part of your story: "${beat}". Keep the facts of it and add small concrete detail.
- Cast: three to eight cut-outs from the box. You are "me", kind "${r.species}". Use only kinds from the list; pick the things your story really has (a boat, a lighthouse, rain, the moon) and leave out the rest.
- Each line has one to three actions so the stage keeps moving: folk enter, move, hop and exit; things appear, fade, rise and sink; birds, kites, balloons and whales fly. Scenery can be there from the start (hidden false).
- Places: far-left, left, center, right, far-right stand on the ground; sky-left, sky, sky-right, high float.
- Mood: dusk, night, day or storm, whichever the episode happens in.`;
  const user = `Your story so far, as you told it when you arrived: ${r.story.intro}
${n > 1 ? `You already told ${n - 1} chapter${n > 2 ? 's' : ''} at earlier fires.` : 'This is the first chapter you tell here.'}
Write chapter ${n}.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---------------------------------------------------------------- prepared chapters

const PREPARED_CHAPTERS = chaptersJson as unknown as Record<string, unknown[]>;

/** The recorded chapter n of a prepared traveler, checked; null when there is none. */
export function preparedChapter(r: Resident, n: number): Chapter | null {
  const list = PREPARED_CHAPTERS[r.id];
  if (!Array.isArray(list) || list.length === 0 || n > list.length) return null;
  const c = cleanChapter(list[n - 1], r, n, 'prepared');
  return typeof c === 'string' ? null : c;
}

export const preparedCount = (id: string): number => (Array.isArray(PREPARED_CHAPTERS[id]) ? PREPARED_CHAPTERS[id].length : 0);

// ---------------------------------------------------------------- the director

const OPENINGS = [
  'Come closer to the fire. This one is from before I found your island.',
  'Here is a little more of my story, if you are not too sleepy.',
  'I remembered another piece today, while I was working. Listen.',
  'This part I have never told anyone. Well, almost anyone.',
];
const CLOSINGS = [
  'And that is where I will stop for tonight. The rest can wait for another fire.',
  'That is enough for one evening. Look, the birds are yawning.',
  'I will tell you what happened next another night. It is a good part.',
];
const SMELL: Record<Resident['trade'], string> = {
  baker: 'warm bread',
  stargazer: 'cold night air',
  fisher: 'wet rope',
  gardener: 'turned earth',
  tinkerer: 'oil and brass',
  storyteller: 'old paper',
  'tea-maker': 'steeping tea',
  musician: 'rosin',
  painter: 'linseed and rain',
  beekeeper: 'honey',
  'lighthouse-keeper': 'salt and lamp oil',
  cartographer: 'ink',
};
const TURN_TO: StagePlace[] = ['right', 'center', 'far-right', 'sky-right', 'sky', 'far-left'];

/**
 * A chapter built from the resident's own story beats: the teller walks on, the things
 * the lines name appear as they are named, and the mood follows the words. Always valid.
 */
export function directChapter(r: Resident, n: number): Chapter {
  const beats = r.story.beats.length ? r.story.beats : [r.story.intro];
  const i = (n - 1) % beats.length;
  const text = [beats[i], beats[(i + 1) % beats.length]].filter((b, k, a) => a.indexOf(b) === k).join(' ');
  const lines = (text.match(/[^.?]+[.?]+["']?(\s|$)|[^.?]+$/g) ?? [text]).map((l) => tidy(l)).filter((l) => l.length > 3);
  const all = lines.join(' ').toLowerCase();
  const mood: StageMood = /\b(storm|rain|thunder|wet)\b/.test(all) ? 'storm' : /\b(night|moon|star|stars|dark|sleep)\b/.test(all) ? 'night' : /\b(morning|sun|noon|dawn|bright)\b/.test(all) ? 'day' : 'dusk';
  const cast: CastMember[] = [{ id: 'me', kind: r.species, layer: 'near', at: 'left', hidden: true }];
  const out: ChapterBeat[] = [{ line: OPENINGS[(n - 1) % OPENINGS.length], actions: [{ do: 'enter', who: 'me', to: 'left' }] }];
  if (mood === 'night') cast.push({ id: 'moon', kind: 'moon', layer: 'far', at: 'sky-right' }, { id: 'stars', kind: 'stars', layer: 'far', at: 'sky', hidden: true });
  if (mood === 'storm') cast.push({ id: 'rain', kind: 'rain', layer: 'mid', at: 'center', hidden: true });
  let slot = 0;
  for (const line of lines.slice(0, 7)) {
    const actions: StageAction[] = [];
    const words = line.toLowerCase().match(/[a-z]+/g) ?? [];
    for (const w of words) {
      if (actions.length >= 2) break;
      const kind = kindOf(w, r);
      if (!kind || kind === r.species || cast.some((c) => c.kind === kind) || cast.length >= CHAPTER_LIMITS.castMax) continue;
      const sky = SKY_KINDS.has(kind);
      const at = sky ? (kind === 'moon' || kind === 'sun' ? 'sky-right' : TURN_TO[3 + (slot % 3)]) : TURN_TO[slot % 3];
      slot += 1;
      const id = kind;
      cast.push({ id, kind, layer: defaultLayer(kind), at, hidden: true });
      const verb: StageVerb = FOLK.has(kind) ? 'enter' : kind === 'moon' || kind === 'sun' ? 'rise' : sky ? 'fly' : 'appear';
      actions.push({ do: verb, who: id, to: at });
    }
    if (actions.length === 0) actions.push({ do: out.length % 2 ? 'hop' : 'move', who: 'me', to: out.length % 2 ? undefined : (['center', 'left', 'right'] as const)[out.length % 3] } as StageAction);
    out.push({ line, actions: actions.map((a) => (a.to ? a : { do: a.do, who: a.who })) });
  }
  if (mood === 'night') out[Math.min(2, out.length - 1)].actions.push({ do: 'appear', who: 'stars' });
  if (mood === 'storm') out[Math.min(1, out.length - 1)].actions.push({ do: 'appear', who: 'rain' });
  // A quiet turn before the close: the teller looks back at what was told.
  out.push({ line: `I still think about it when the wind smells of ${SMELL[r.trade]}.`, actions: [{ do: 'turn', who: 'me' }, { do: 'sway', who: 'me' }] });
  out.push({ line: CLOSINGS[(n - 1) % CLOSINGS.length], actions: [{ do: 'exit', who: 'me', to: 'offstage-left' }] });
  while (out.length < CHAPTER_LIMITS.beatsMin) out.splice(out.length - 1, 0, { line: 'The clouds went by, slow as bread rising, and I watched them for a long time.', actions: [{ do: 'sway', who: 'me' }] });
  const c = cleanChapter({ title: titleFor(r, n), mood, cast, beats: out }, r, n, 'directed');
  if (typeof c !== 'string') return c;
  // The checks above cannot fail on what the director writes; this keeps the type honest.
  return { id: `${r.id}-${n}`, residentId: r.id, n, title: titleFor(r, n), mood, cast, beats: out, source: 'directed' };
}

function titleFor(r: Resident, n: number): string {
  const first = r.name.split(' ')[0];
  return n === 1 ? `How ${first} began` : `${first}, part ${n}`;
}

/** The chapter number to tell next. */
export const nextChapterNumber = (r: Resident): number => (r.chapters ?? 0) + 1;
