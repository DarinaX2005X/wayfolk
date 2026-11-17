// One table: how every Species from src/mind/types.ts is built, and what each Trade wears.
// Residents are built in code (src/life/resident.ts) from these plans, so every species
// has its own model; `model` names the plan actually used and would name a stand-in if a
// species ever had to borrow another one's body.
import type { Species, Trade } from '../mind/types';

export type Ears = 'pointy' | 'cat' | 'long' | 'round' | 'mouse' | 'small' | 'tufts' | 'deer' | 'none';
export type Snout = 'pointy' | 'button' | 'round' | 'wide' | 'beak';
export type Tail = 'bushy' | 'ringed' | 'puff' | 'curl' | 'thin' | 'flat' | 'stub' | 'fan' | 'none';
export type Mark = 'belly' | 'mask' | 'spots' | 'spines' | 'face-disc' | 'tuxedo' | 'socks' | 'brow';
export type Arms = 'paws' | 'wings' | 'flippers';
export type Feet = 'paws' | 'webbed' | 'talons';
export type Eyes = 'dot' | 'big' | 'bulge' | 'owl';

export interface BodyPlan {
  model: Species;
  ears: Ears;
  snout: Snout;
  tail: Tail;
  marks: Mark[];
  arms: Arms;
  feet: Feet;
  eyes: Eyes;
  /** Size multipliers: head radius, body girth, overall height. */
  head: number;
  body: number;
  height: number;
  antlers?: boolean;
  whiskers?: boolean;
  /** Default colours when a resident brings none. light: muzzle and belly; dark: tips, nose, mask. */
  colors: { main: string; accent: string; light: string; dark: string };
  /** One word for how the species moves: changes walk bounce and idle. */
  gait: 'trot' | 'hop' | 'waddle' | 'pad' | 'scurry';
}

export const SPECIES_PLAN: Record<Species, BodyPlan> = {
  fox: { model: 'fox', ears: 'pointy', snout: 'pointy', tail: 'bushy', marks: ['belly', 'socks'], arms: 'paws', feet: 'paws', eyes: 'dot', head: 1, body: 1, height: 1, whiskers: false, colors: { main: '#e9813f', accent: '#3f6e8c', light: '#fff4e6', dark: '#4a2c22' }, gait: 'trot' },
  rabbit: { model: 'rabbit', ears: 'long', snout: 'button', tail: 'puff', marks: ['belly'], arms: 'paws', feet: 'paws', eyes: 'big', head: 1.02, body: 0.95, height: 0.95, colors: { main: '#efe3d3', accent: '#d9677a', light: '#fffaf3', dark: '#6b5047' }, gait: 'hop' },
  cat: { model: 'cat', ears: 'cat', snout: 'button', tail: 'curl', marks: ['belly', 'socks'], arms: 'paws', feet: 'paws', eyes: 'big', head: 1, body: 0.95, height: 0.97, whiskers: true, colors: { main: '#9aa3ad', accent: '#e0a43a', light: '#f4f1ec', dark: '#3c3f47' }, gait: 'pad' },
  bear: { model: 'bear', ears: 'round', snout: 'round', tail: 'stub', marks: ['belly'], arms: 'paws', feet: 'paws', eyes: 'dot', head: 1.05, body: 1.18, height: 1.08, colors: { main: '#a06a43', accent: '#c7413b', light: '#e8c9a2', dark: '#3b2418' }, gait: 'waddle' },
  frog: { model: 'frog', ears: 'none', snout: 'wide', tail: 'none', marks: ['belly'], arms: 'paws', feet: 'webbed', eyes: 'bulge', head: 1.08, body: 1.02, height: 0.9, colors: { main: '#76b54a', accent: '#e9a23b', light: '#e9f5c8', dark: '#2f4d22' }, gait: 'hop' },
  owl: { model: 'owl', ears: 'tufts', snout: 'beak', tail: 'fan', marks: ['face-disc', 'belly'], arms: 'wings', feet: 'talons', eyes: 'owl', head: 1.04, body: 1.05, height: 0.98, colors: { main: '#8c6a4f', accent: '#3d5a80', light: '#f1e2c8', dark: '#3a2a20' }, gait: 'waddle' },
  deer: { model: 'deer', ears: 'deer', snout: 'round', tail: 'puff', marks: ['spots', 'belly'], arms: 'paws', feet: 'paws', eyes: 'big', head: 0.98, body: 0.95, height: 1.05, antlers: true, colors: { main: '#c48a52', accent: '#5b8f5a', light: '#fbefdc', dark: '#4b3122' }, gait: 'trot' },
  hedgehog: { model: 'hedgehog', ears: 'small', snout: 'pointy', tail: 'none', marks: ['spines', 'belly'], arms: 'paws', feet: 'paws', eyes: 'dot', head: 0.98, body: 1.05, height: 0.88, colors: { main: '#d9b48c', accent: '#b5523b', light: '#f7e6cf', dark: '#5a4032' }, gait: 'scurry' },
  raccoon: { model: 'raccoon', ears: 'round', snout: 'pointy', tail: 'ringed', marks: ['mask', 'belly', 'brow'], arms: 'paws', feet: 'paws', eyes: 'dot', head: 1, body: 1.02, height: 1, whiskers: true, colors: { main: '#8e8f94', accent: '#d98c3a', light: '#efeee9', dark: '#2e2f35' }, gait: 'pad' },
  penguin: { model: 'penguin', ears: 'none', snout: 'beak', tail: 'fan', marks: ['tuxedo'], arms: 'flippers', feet: 'webbed', eyes: 'dot', head: 0.98, body: 1.1, height: 1, colors: { main: '#2f3b52', accent: '#e8574a', light: '#fbf8f2', dark: '#1b2232' }, gait: 'waddle' },
  mouse: { model: 'mouse', ears: 'mouse', snout: 'pointy', tail: 'thin', marks: ['belly'], arms: 'paws', feet: 'paws', eyes: 'big', head: 1, body: 0.88, height: 0.86, whiskers: true, colors: { main: '#b9a89a', accent: '#5a8fc4', light: '#f6ede6', dark: '#4b3d36' }, gait: 'scurry' },
  otter: { model: 'otter', ears: 'small', snout: 'round', tail: 'flat', marks: ['belly'], arms: 'paws', feet: 'webbed', eyes: 'dot', head: 0.97, body: 1.02, height: 1.02, whiskers: true, colors: { main: '#7b5235', accent: '#e3b23c', light: '#ead2b3', dark: '#3a2416' }, gait: 'pad' },
};

/** The plan for a species; an unknown name gets the closest friendly body (a cat). */
export function planFor(species: string): BodyPlan {
  return (SPECIES_PLAN as Record<string, BodyPlan>)[species] ?? SPECIES_PLAN.cat;
}

export type Gear =
  | 'chef-hat' | 'apron' | 'pointed-hat' | 'rain-hat' | 'straw-hat' | 'goggles' | 'glasses' | 'scarf'
  | 'headscarf' | 'beret' | 'bow-tie' | 'top-hat' | 'wide-hat' | 'cap' | 'backpack' | 'tool-belt' | 'paint-apron';

/** What each trade wears: a hat or something on the face, and one thing on the body. */
export const TRADE_GEAR: Record<Trade, Gear[]> = {
  baker: ['chef-hat', 'apron'],
  stargazer: ['pointed-hat', 'scarf'],
  fisher: ['rain-hat'],
  gardener: ['straw-hat', 'apron'],
  tinkerer: ['goggles', 'tool-belt'],
  storyteller: ['glasses', 'scarf'],
  'tea-maker': ['headscarf', 'apron'],
  musician: ['top-hat', 'bow-tie'],
  painter: ['beret', 'paint-apron'],
  beekeeper: ['wide-hat'],
  'lighthouse-keeper': ['cap', 'scarf'],
  cartographer: ['backpack', 'glasses'],
};

export function gearFor(trade: string): Gear[] {
  return (TRADE_GEAR as Record<string, Gear[]>)[trade] ?? [];
}

/** What a resident does at work, for the daily life and the work emote. */
export const TRADE_WORK: Record<Trade, 'stir' | 'hammer' | 'water' | 'fish' | 'paint' | 'read' | 'play' | 'look-up' | 'sweep'> = {
  baker: 'stir',
  stargazer: 'look-up',
  fisher: 'fish',
  gardener: 'water',
  tinkerer: 'hammer',
  storyteller: 'read',
  'tea-maker': 'stir',
  musician: 'play',
  painter: 'paint',
  beekeeper: 'water',
  'lighthouse-keeper': 'sweep',
  cartographer: 'read',
};
