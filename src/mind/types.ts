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

export interface P2 { x: number; z: number }

export interface Voice { pitch: number; rate: number; timbre: 'soft' | 'bright' | 'croaky' | 'warm' }

export interface Story {
  intro: string;      // what they say when they step onto the pier
  beats: string[];    // story continues one beat per visit
  secret: string;     // revealed after enough visits / the right gift / at night
  revealed: number;   // how many beats have been shown
}

export interface Trip { to: string; toName: string; leftAt: number; returnsAt: number; story?: string; souvenir?: string }

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
}

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
}

export type Intent = 'stay' | 'leave' | 'chat' | 'gift' | 'secret' | 'trip';

export interface Reply { text: string; choices: string[]; intent: Intent; mood?: 'happy' | 'shy' | 'sad' | 'curious' | 'excited' }
