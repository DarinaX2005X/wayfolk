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
export interface MailItem { id: string; at: number; from: string; fromIsland?: string; kind: 'gift' | 'note'; item?: GiftKind; text: string }

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
