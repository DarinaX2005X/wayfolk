/**
 * A thin stand-in for `createMind` (src/mind/), used only until the mind module lands:
 * one prepared traveler, a scripted conversation, the island kept in localStorage.
 */
import type { HouseSpec, IslandState, Reply, Resident, WorldEvent } from '../../mind/types';
import type { MindPort } from '../ports';

const KEY = 'wf.standin.island';

export const FIRST_TRAVELER: Resident = {
  id: 'r-tamsin',
  name: 'Tamsin',
  species: 'hedgehog',
  trade: 'baker',
  vehicle: 'balloon',
  personality: 'A small hedgehog baker who hums while she works and worries her bread is never quite brown enough.',
  voice: { pitch: 1.3, rate: 1.1, timbre: 'warm' },
  colors: { main: '#b8865b', accent: '#e9724c' },
  story: {
    intro: "Oh, an island with a bench. I'm Tamsin. I bake, mostly, and I've been looking for a place with a good wind for my oven.",
    beats: ['My grandmother baked bread on a ship that never landed.', 'I still have her starter. It is very old and a little grumpy.'],
    secret: 'At night she bakes one small loaf for the stars, and leaves it on the roof.',
    revealed: 0,
  },
  likes: ['flower', 'fruit', 'star'],
  memory: [],
  arrivedAt: 0,
  prepared: true,
};

function emptyIsland(): IslandState {
  const now = Date.now();
  return {
    id: `i-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Your island',
    seed: Math.floor(Math.random() * 1e9),
    visibility: 'private',
    radius: 13,
    residents: [],
    houses: [],
    paths: [],
    props: [],
    events: [],
    createdAt: now,
    lastVisit: 0,
  };
}

export function createStandinMind(): MindPort {
  let state: IslandState = emptyIsland();
  const turns = new Map<string, number>();

  const save = (): void => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // A private window keeps the island for this visit only.
    }
  };

  const mind: MindPort = {
    get state() {
      return state;
    },
    async load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) state = JSON.parse(raw) as IslandState;
      } catch {
        state = emptyIsland();
      }
      return state;
    },
    save,
    async reset() {
      state = emptyIsland();
      turns.clear();
      save();
      return state;
    },
    nextTraveler() {
      const r = { ...FIRST_TRAVELER, arrivedAt: Date.now() };
      state.pending = r;
      return r;
    },
    async talk(id, input) {
      const n = (turns.get(id) ?? 0) + 1;
      turns.set(id, n);
      const said = (input.text ?? '').toLowerCase();
      if (/stay|home|live here/.test(said) || (input.audio && n >= 2)) {
        return { text: "Really? I'd love that. Show me where, and I'll fetch my oven.", choices: [], intent: 'stay', mood: 'happy' } satisfies Reply;
      }
      if (n === 1) {
        return {
          text: 'The wind up here smells like warm crusts. Is that just me?',
          choices: ['Where did you come from?', 'What do you bake?', 'Would you like to stay?'],
          intent: 'chat',
          mood: 'curious',
        };
      }
      return {
        text: 'From a cloud town that drifted too far north. Everything there tasted of snow.',
        choices: ['Would you like to stay?', 'Tell me about your oven', 'Safe travels'],
        intent: 'chat',
      };
    },
    settle(resident: Resident, spec: HouseSpec) {
      state.residents = [...state.residents.filter((r) => r.id !== resident.id), { ...resident, houseId: spec.id }];
      state.houses = [...state.houses.filter((h) => h.id !== spec.id), spec];
      state.pending = undefined;
      save();
    },
    whileAway(now) {
      const events: WorldEvent[] = [];
      const first = state.residents[0];
      if (first && state.lastVisit && now - state.lastVisit > 60_000) {
        events.push({ at: now, kind: 'news', residentId: first.id, text: `${first.name} baked something round and left it by your bench.` });
      }
      state.lastVisit = now;
      save();
      return events;
    },
    give(id, item) {
      const r = state.residents.find((x) => x.id === id) ?? state.pending;
      const loved = r?.likes.includes(item);
      return { text: loved ? 'For me? It will go right by the window.' : 'Thank you. I will find a spot for it.', prop: loved ? item : undefined };
    },
    publicIslands() {
      return [
        { id: 'pub-lanterns', name: 'Lantern Rock' },
        { id: 'pub-orchard', name: 'Orchard Drift' },
      ];
    },
    async publish() {
      return { id: state.id };
    },
    liveAI: false,
  };
  return mind;
}
