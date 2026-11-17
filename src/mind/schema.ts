/**
 * What the model must answer, as JSON Schema (the subset api/_lib/llm/schema.ts checks),
 * and the domain checks that schema cannot express: lengths, sentences, colors, names
 * that repeat, words outside the house style. A model answer becomes a Resident, a Reply
 * or events only through these functions.
 */
import type { JsonSchema } from '../../api/_lib/contracts';
import { LIMITS } from './check';
import { GIFT_KINDS, SPECIES, TRADES, VEHICLES, type GiftKind, type Intent, type Resident, type Species, type Trade, type Vehicle } from './types';
import { GROWTH_PROPS, HOUSE_PROPS, SOUVENIRS } from './words';

export const INTENTS: Intent[] = ['stay', 'leave', 'chat', 'gift', 'secret', 'trip'];
export const MOODS = ['happy', 'shy', 'sad', 'curious', 'excited'] as const;
const TIMBRES = ['soft', 'bright', 'croaky', 'warm'];

const s = (description?: string): JsonSchema => (description ? { type: 'string', description } : { type: 'string' });
const n = (description: string): JsonSchema => ({ type: 'number', description });
const e = (values: readonly string[], description?: string): JsonSchema => ({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const TRAVELER_SCHEMA: JsonSchema = obj({
  name: s('one or two short words, easy to say aloud'),
  species: e(SPECIES),
  trade: e(TRADES),
  vehicle: e(VEHICLES),
  tagline: s('at most six words for a name card'),
  personality: s('two sentences: how they talk, and one habit or quirk'),
  voice: obj({ pitch: n('0.7 to 1.4, higher for small animals'), rate: n('0.8 to 1.25'), timbre: e(TIMBRES) }),
  colors: obj({ main: s('#rrggbb fur or feather color'), accent: s('#rrggbb accent: scarf, apron, hat') }),
  likes: { type: 'array', items: e(GIFT_KINDS), description: 'two or three' },
  story: obj({
    intro: s('first words on the pier, first person, at most two sentences'),
    beats: { type: 'array', items: s('one story beat, first person, one or two short sentences'), description: 'four to six beats' },
    secret: s('one or two sentences, tender or funny'),
  }),
  house: obj({
    wall: s('#rrggbb'),
    roof: s('#rrggbb'),
    trim: s('#rrggbb'),
    sign: s('one to three words on the door sign'),
    props: { type: 'array', items: e(HOUSE_PROPS), description: 'one to three' },
  }),
});

export const REPLY_SCHEMA: JsonSchema = obj({
  heard: s('what the person said, written out; empty if nothing could be heard'),
  text: s('your answer, in character, at most two short sentences'),
  intent: e(INTENTS, 'what the person wants'),
  mood: e(MOODS),
  choices: { type: 'array', items: s('a short reply the person could say next, 2 to 6 words'), description: 'exactly three' },
  choiceIntents: { type: 'array', items: e(INTENTS), description: 'exactly three, same order as choices' },
  toldBeat: { type: 'boolean' },
  toldSecret: { type: 'boolean' },
  remember: s('one short note worth remembering about the person, or empty'),
});

export const EVENTS_SCHEMA: JsonSchema = obj({
  events: {
    type: 'array',
    description: 'as many as asked',
    items: obj({
      kind: e(['news', 'gift', 'growth']),
      resident: s('name of the resident it is about'),
      text: s('what Pip tells the person, one or two short sentences'),
      prop: e(['none', 'gift-box', ...GROWTH_PROPS]),
    }),
  },
  trips: {
    type: 'array',
    items: obj({ resident: s('name'), story: s('what they tell about the trip, first person, two sentences'), souvenir: e(SOUVENIRS) }),
  },
});

export const GIFT_SCHEMA: JsonSchema = obj({ text: s('your reaction, in character, at most two short sentences'), mood: e(MOODS) });

export const TRIP_SCHEMA: JsonSchema = obj({ story: s('first person, two sentences about the trip'), souvenir: e(SOUVENIRS) });

// ------------------------------------------------------------------ house style checks

/** Words that make a character generic or break the world. */
const OFF_STYLE = /\b(mystical|whimsical|ancient|realm|tapestry|embark|delve|testament|journey of|artificial intelligence|chatbot|language model|instagram|youtube|tiktok|disney|pokemon|harry potter|google|amazon)\b/i;
const NAME = /^[A-Z][A-Za-z'’-]{1,13}( [A-Z][A-Za-z'’-]{1,11})?$/;
const COMMON_NAMES = /^(max|buddy|bella|luna|charlie|lucy|daisy|milo|coco|oliver|leo|bob|sam|tom)$/i;

/** House style fixes that need no retry: no exclamation marks, tidy spaces, straight quotes. */
export function tidy(text: string): string {
  return text
    .replace(/!+/g, '.')
    .replace(/\.\.+/g, '.')
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,?;:])/g, '$1')
    .trim();
}

/** The first `n` sentences of a text (a model sometimes runs on). */
export function firstSentences(text: string, n = 2): string {
  const parts = text.match(/[^.?]+[.?]+["']?(\s|$)|[^.?]+$/g) ?? [text];
  return parts.slice(0, n).join('').trim();
}

export const sentences = (text: string): number => (text.match(/[.?]+(\s|$)/g) ?? []).length || 1;

export function offStyle(text: string): string | null {
  const m = OFF_STYLE.exec(text);
  return m ? m[0] : null;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export type TravelerAsk = { species: Species; trade: Trade; vehicle: Vehicle; avoidNames: string[] };

type Raw = Record<string, any>;

/**
 * A model's traveler as a Resident, or the reason it does not fit. `ask` is what was
 * requested; species, trade and vehicle must match it, the name must be new.
 */
export function travelerFromModel(value: unknown, ask: TravelerAsk, id: string, now: number): Resident | string {
  const v = value as Raw;
  if (!v || typeof v !== 'object') return 'not an object';
  if (v.species !== ask.species || v.trade !== ask.trade || v.vehicle !== ask.vehicle) return 'species, trade or vehicle differ from the request';
  const name = tidy(String(v.name ?? '')).replace(/\.$/, '');
  if (!NAME.test(name) || COMMON_NAMES.test(name)) return `name "${name}" is not a good name`;
  if (ask.avoidNames.some((other) => other.toLowerCase() === name.toLowerCase() || other.split(' ')[0].toLowerCase() === name.split(' ')[0].toLowerCase())) return `name "${name}" repeats`;
  const story = v.story as Raw;
  const intro = tidy(String(story?.intro ?? ''));
  const beats = Array.isArray(story?.beats) ? story.beats.map((b: unknown) => tidy(String(b))) : [];
  const secret = tidy(String(story?.secret ?? ''));
  const personality = tidy(String(v.personality ?? ''));
  const tagline = tidy(String(v.tagline ?? '')).replace(/\.$/, '');
  if (!intro || intro.length > 300 || sentences(intro) > 3) return 'intro too long';
  if (beats.length < LIMITS.beatsMin) return 'beats count';
  if (beats.length > LIMITS.beatsMax) beats.length = LIMITS.beatsMax;
  if (beats.some((b: string) => !b || b.length > 300 || sentences(b) > 3)) return 'a beat is too long';
  if (!secret || secret.length > 300) return 'secret';
  if (!personality || personality.length > 280) return 'personality';
  if (!tagline || tagline.split(' ').length > 7) return 'tagline';
  const all = [name, intro, ...beats, secret, personality, tagline].join(' ');
  const off = offStyle(all);
  if (off) return `off style: ${off}`;
  const voice = v.voice as Raw;
  const colors = v.colors as Raw;
  const house = v.house as Raw;
  for (const c of [colors?.main, colors?.accent, house?.wall, house?.roof, house?.trim]) if (typeof c !== 'string' || !HEX.test(c)) return 'a color is not #rrggbb';
  const likes = (Array.isArray(v.likes) ? v.likes : []).filter((l: unknown): l is GiftKind => (GIFT_KINDS as unknown[]).includes(l));
  if (likes.length < 1) return 'likes';
  const sign = tidy(String(house?.sign ?? '')).replace(/\.$/, '');
  if (!sign || sign.length > 22) return 'sign';
  const props = (Array.isArray(house?.props) ? house.props : []).filter((p: unknown) => (HOUSE_PROPS as readonly unknown[]).includes(p)).slice(0, 3);
  return {
    id,
    name,
    species: ask.species,
    trade: ask.trade,
    vehicle: ask.vehicle,
    personality,
    voice: {
      pitch: clamp(Number(voice?.pitch) || 1, 0.6, 1.5),
      rate: clamp(Number(voice?.rate) || 1, 0.75, 1.3),
      timbre: TIMBRES.includes(voice?.timbre) ? voice.timbre : 'warm',
    },
    colors: { main: colors.main.toLowerCase(), accent: colors.accent.toLowerCase() },
    story: { intro, beats, secret, revealed: 0 },
    likes: [...new Set<GiftKind>(likes)].slice(0, 3),
    memory: [],
    arrivedAt: now,
    tagline,
    house: { colors: { wall: house.wall.toLowerCase(), roof: house.roof.toLowerCase(), trim: house.trim.toLowerCase() }, sign, props: [...new Set<string>(props)] },
  };
}

export type ModelReply = {
  heard: string;
  text: string;
  intent: Intent;
  mood: (typeof MOODS)[number];
  choices: string[];
  choiceIntents: Intent[];
  toldBeat: boolean;
  toldSecret: boolean;
  remember: string;
};

/** A model's reply, tidied, or the reason it does not fit. */
export function replyFromModel(value: unknown): ModelReply | string {
  const v = value as Raw;
  if (!v || typeof v !== 'object') return 'not an object';
  const text = firstSentences(tidy(String(v.text ?? '')), 2);
  if (!text) return 'empty text';
  if (text.length > 260) return 'text too long';
  if (offStyle(text)) return 'off style';
  const choices = (Array.isArray(v.choices) ? v.choices : []).map((c: unknown) => tidy(String(c)).replace(/\.$/, '')).filter((c: string) => c && c.length <= 48).slice(0, 3);
  if (choices.length < 2) return 'choices';
  const intents = Array.isArray(v.choiceIntents) ? v.choiceIntents : [];
  const choiceIntents = choices.map((_: string, i: number) => (INTENTS.includes(intents[i]) ? intents[i] : 'chat')) as Intent[];
  return {
    heard: tidy(String(v.heard ?? '')).slice(0, 300),
    text,
    intent: INTENTS.includes(v.intent) ? v.intent : 'chat',
    mood: (MOODS as readonly string[]).includes(v.mood) ? v.mood : 'happy',
    choices,
    choiceIntents,
    toldBeat: v.toldBeat === true,
    toldSecret: v.toldSecret === true,
    remember: tidy(String(v.remember ?? '')).slice(0, 140),
  };
}
