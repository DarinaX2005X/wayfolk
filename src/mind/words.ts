/**
 * Fixed vocabularies of the mind: house props the world catalog provides, what a loved
 * gift becomes in a house, souvenirs from trips, growth on the island, and plain words
 * for trades. World maps these ids to models (and may substitute the closest one).
 */
import type { GiftKind, Trade } from './types';

/** Prop ids of the world catalog that a house or the island may carry. */
export const HOUSE_PROPS = [
  'lantern', 'star-lamp', 'flower-pot', 'fruit-basket', 'telescope', 'fishing-rod', 'beehive',
  'easel', 'teapot', 'books', 'map', 'bell', 'kite', 'shell',
] as const;
export type HouseProp = (typeof HOUSE_PROPS)[number];

/** Souvenirs residents bring back from trips; each is also a placeable prop. */
export const SOUVENIRS = ['shell', 'bell', 'kite', 'map', 'teapot', 'lantern', 'books', 'flower-pot', 'star-lamp', 'fruit-basket'] as const;
export type Souvenir = (typeof SOUVENIRS)[number];

/** Island growth while the person is away. */
export const GROWTH_PROPS = ['flower-patch', 'fruit-tree', 'mushroom-ring', 'berry-bush'] as const;

/** The prop a loved gift becomes in the resident's house. */
export const GIFT_PROPS: Record<GiftKind, HouseProp> = {
  fruit: 'fruit-basket',
  star: 'star-lamp',
  flower: 'flower-pot',
  shell: 'shell',
  feather: 'kite',
  pebble: 'lantern',
  honey: 'beehive',
  tea: 'teapot',
  book: 'books',
  map: 'map',
  bell: 'bell',
  mushroom: 'flower-pot',
};

/** A gift box left at the person's door. */
export const DOOR_GIFT = 'gift-box';

export const GIFT_WORDS: Record<GiftKind, string> = {
  fruit: 'a ripe fruit',
  star: 'a fallen star',
  flower: 'a flower',
  shell: 'a shell',
  feather: 'a feather',
  pebble: 'a smooth pebble',
  honey: 'a jar of honey',
  tea: 'a pouch of tea',
  book: 'a little book',
  map: 'a folded map',
  bell: 'a small bell',
  mushroom: 'a mushroom',
};

export const TRADE_WORDS: Record<Trade, { person: string; place: string; work: string }> = {
  baker: { person: 'baker', place: 'bakery', work: 'baking' },
  stargazer: { person: 'stargazer', place: 'little observatory', work: 'watching the stars' },
  fisher: { person: 'cloud fisher', place: 'hut on stilts', work: 'fishing in the clouds' },
  gardener: { person: 'gardener', place: 'greenhouse', work: 'tending the garden' },
  tinkerer: { person: 'tinkerer', place: 'workshop', work: 'fixing small machines' },
  storyteller: { person: 'storyteller', place: 'book cottage', work: 'collecting stories' },
  'tea-maker': { person: 'tea maker', place: 'tea house', work: 'brewing tea' },
  musician: { person: 'musician', place: 'house with chimes', work: 'playing music' },
  painter: { person: 'painter', place: 'studio', work: 'painting' },
  beekeeper: { person: 'beekeeper', place: 'cottage with hives', work: 'looking after the bees' },
  'lighthouse-keeper': { person: 'lighthouse keeper', place: 'small lighthouse', work: 'keeping the light' },
  cartographer: { person: 'cartographer', place: 'map tower', work: 'drawing maps' },
};
