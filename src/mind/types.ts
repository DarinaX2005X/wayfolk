// Shared data contract for Wayfolk. Owner: mind module. Other modules import, never redefine.
// Extend by adding optional fields; do not rename or remove without telling every module.

export type Trade =
  | 'baker' | 'stargazer' | 'fisher' | 'gardener' | 'tinkerer' | 'storyteller'
  | 'tea-maker' | 'musician' | 'painter' | 'beekeeper' | 'lighthouse-keeper' | 'cartographer';

export const TRADES: Trade[] = [
  'baker', 'stargazer', 'fisher', 'gardener', 'tinkerer', 'storyteller',
  'tea-maker', 'musician', 'painter', 'beekeeper', 'lighthouse-keeper', 'cartographer',
];

// Life maps each species to a model and may substitute the closest available one.
export type Species =
  | 'fox' | 'rabbit' | 'cat' | 'bear' | 'frog' | 'owl'
  | 'deer' | 'hedgehog' | 'raccoon' | 'penguin' | 'mouse' | 'otter';

export const SPECIES: Species[] = [
  'fox', 'rabbit', 'cat', 'bear', 'frog', 'owl', 'deer', 'hedgehog', 'raccoon', 'penguin', 'mouse', 'otter',
];

export type Vehicle = 'balloon' | 'paper-boat' | 'kite' | 'cloud-whale' | 'umbrella' | 'lantern';

export const VEHICLES: Vehicle[] = ['balloon', 'paper-boat', 'kite', 'cloud-whale', 'umbrella', 'lantern'];

/** What the person can hand to a resident. `Resident.likes` holds values of this list. */
export type GiftKind =
  | 'fruit' | 'star' | 'flower' | 'shell' | 'feather' | 'pebble' | 'honey' | 'tea' | 'book' | 'map' | 'bell' | 'mushroom';

export const GIFT_KINDS: GiftKind[] = ['fruit', 'star', 'flower', 'shell', 'feather', 'pebble', 'honey', 'tea', 'book', 'map', 'bell', 'mushroom'];

export interface P2 { x: number; z: number }

export interface Voice { pitch: number; rate: number; timbre: 'soft' | 'bright' | 'croaky' | 'warm' }

export interface Story {
  intro: string;      // what they say when they step onto the pier
  beats: string[];    // story continues one beat per visit
  secret: string;     // revealed after enough visits / the right gift / at night
  revealed: number;   // how many beats have been shown
}

export interface Trip { to: string; toName: string; leftAt: number; returnsAt: number; story?: string; souvenir?: string; met?: string[] }

export interface Resident {
  id: string;
  name: string;
  species: Species;
  trade: Trade;
  vehicle: Vehicle;
  personality: string;         // one or two sentences, used in prompts
  voice: Voice;
  colors: { main: string; accent: string };
  story: Story;
  likes: string[];             // gift kinds they love
  memory: { at: number; text: string }[];
  houseId?: string;
  trip?: Trip;
  arrivedAt: number;
  prepared?: boolean;          // came from the prepared set, not generated live
  tagline?: string;            // a few words for the name card
  house?: HousePlan;           // what their house should look like (recipe = trade)
  visits?: number;             // conversations on separate visits
  lastTalkAt?: number;
  secretKnown?: boolean;       // the secret has been told to the person
  chapters?: number;           // chapters of their story told at the evening fire
  lastChapterAt?: number;
  from?: { islandId: string; islandName: string; returnsAt: number }; // a guest from another island
}

/** The model's (or the prepared set's) choice for a resident's house; app copies it into HouseSpec. */
export interface HousePlan { colors: { wall: string; roof: string; trim: string }; sign: string; props: string[] }

export interface HouseSpec {
  id: string;
  residentId: string;
  recipe: Trade;
  pos: P2;
  rotY: number;
  colors: { wall: string; roof: string; trim: string };
  props: string[];             // prop ids from the world catalog
  sign?: string;
  builtAt: number;
}

export type EventKind = 'news' | 'gift' | 'growth' | 'trip-return' | 'visitor' | 'secret';

export interface WorldEvent {
  at: number;
  kind: EventKind;
  residentId?: string;
  text: string;
  effect?: { prop?: string; at?: P2 };
  seen?: boolean;
}

export interface PlacedProp { id: string; kind: string; pos: P2; rotY?: number; from?: string }

export interface IslandState {
  id: string;
  name: string;
  seed: number;
  visibility: 'private' | 'public';
  radius: number;
  residents: Resident[];
  houses: HouseSpec[];
  paths: [string, string][];   // ids of houses, 'pier' or 'seat'
  props: PlacedProp[];
  events: WorldEvent[];
  createdAt: number;
  lastVisit: number;
  pending?: Resident;          // traveler waiting at the pier
  met?: string[];              // ids of travelers already met (no repeats)
  visitors?: Resident[];       // residents of other islands visiting right now
  mail?: MailItem[];           // gifts and notes left in this island's mailbox
  published?: { id: string; ownerKey: string; rev: number; at: number };
}

/** A gift or note left in an island's mailbox by someone visiting it. */
export interface MailItem { id: string; at: number; from: string; fromIsland?: string; kind: 'gift' | 'note'; item?: GiftKind; text: string; read?: boolean }

/** One island on the horizon. */
export interface IslandSummary {
  id: string;
  name: string;
  residents: number;
  houses: number;
  updatedAt: number;
  demo?: boolean;
  faces: { name: string; species: Species; trade: Trade; main: string }[];
}

export type Intent = 'stay' | 'leave' | 'chat' | 'gift' | 'secret' | 'trip';

export interface Reply {
  text: string;
  choices: string[];
  intent: Intent;
  mood?: 'happy' | 'shy' | 'sad' | 'curious' | 'excited';
  heard?: string;              // what the person said (transcribed from audio), for subtitles
  choiceIntents?: Intent[];    // the intent of each choice, same order
  secret?: boolean;            // this reply tells the secret
  prepared?: boolean;          // an offline line, not a live model answer
  ms?: number;                 // time to the answer
}

export interface GiveResult { text: string; prop?: string; loved: boolean; secret?: string; prepared?: boolean }

// ------------------------------------------------------------------ evening of stories
// A chapter of a resident's story, acted out as a paper silhouette theatre in the clouds.
// The mind writes it (prepared, live or directed from the story beats); src/mind/chapters.ts
// checks every chapter against this fixed vocabulary before the theatre plays it.

/** Cut-out silhouettes the theatre can draw. */
export const SILHOUETTES = [
  // folk
  'fox', 'rabbit', 'cat', 'bear', 'frog', 'owl', 'deer', 'hedgehog', 'raccoon', 'penguin', 'mouse', 'otter',
  'bird', 'birds', 'gull', 'fish', 'whale', 'bee', 'goat',
  // ways to travel
  'balloon', 'paper-boat', 'boat', 'kite', 'umbrella', 'lantern',
  // places
  'house', 'town', 'tower', 'lighthouse', 'windmill', 'bridge', 'island', 'hill', 'tree', 'pine', 'rock', 'tent',
  // things
  'oven', 'teapot', 'cup', 'bread', 'book', 'map', 'telescope', 'fiddle', 'easel', 'hive', 'pumpkin', 'clock',
  'key', 'letter', 'ladder', 'chair', 'net', 'flower', 'basket', 'notes', 'bell', 'boot',
  // sky and weather
  'moon', 'sun', 'cloud', 'stars', 'star', 'rain', 'snow', 'wind', 'rainbow', 'sea',
] as const;
export type SilhouetteKind = (typeof SILHOUETTES)[number];

/** Depth of a cut-out: far ones are small and hazy, near ones dark and sharp. */
export const STAGE_LAYERS = ['far', 'mid', 'near'] as const;
export type StageLayer = (typeof STAGE_LAYERS)[number];

/** Named places on the stage. Ground places stand on the front row; sky places float. */
export const STAGE_PLACES = [
  'far-left', 'left', 'center', 'right', 'far-right',
  'sky-left', 'sky', 'sky-right', 'high',
  'offstage-left', 'offstage-right', 'below', 'above',
] as const;
export type StagePlace = (typeof STAGE_PLACES)[number];

/** What a cut-out can do during a line. */
export const STAGE_VERBS = [
  'enter', 'exit', 'move', 'fly', 'appear', 'fade', 'rise', 'sink',
  'hop', 'sway', 'shake', 'grow', 'shrink', 'turn', 'spin', 'glow',
] as const;
export type StageVerb = (typeof STAGE_VERBS)[number];

export const STAGE_MOODS = ['dusk', 'night', 'day', 'storm'] as const;
export type StageMood = (typeof STAGE_MOODS)[number];

export interface CastMember {
  id: string;                  // short name used by the actions, e.g. 'me', 'oven'
  kind: SilhouetteKind;
  layer: StageLayer;
  at: StagePlace;              // where it stands when it is on stage
  hidden?: boolean;            // waits off stage until 'enter' or 'appear'
  facing?: 'left' | 'right';   // folk face right unless told
  size?: number;               // 0.6 .. 1.6, 1 by default
}

export interface StageAction { do: StageVerb; who: string; to?: StagePlace }

export interface ChapterBeat {
  line: string;                // what the teller says, first person, one or two sentences
  actions: StageAction[];      // what happens on stage while they say it (0..4)
}

export interface Chapter {
  id: string;
  residentId: string;
  n: number;                   // chapter number, from 1
  title: string;
  mood: StageMood;
  cast: CastMember[];
  beats: ChapterBeat[];
  source?: 'prepared' | 'live' | 'directed';
}
