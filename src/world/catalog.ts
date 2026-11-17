/**
 * The catalog of everything the world can place: nature, village pieces for distant islands,
 * and props. Props are what gifts and souvenirs become, what HouseSpec.props names and what
 * addProp(kind) accepts. Kit items come from KayKit (CC0, baked into kit.glb with vertex
 * colours); proc items are built in code (props.ts) in the same chunky style.
 *
 * Sizes are in metres after `scale`. `footprint` is the radius kept free around the item.
 */
import { KIT_BOUNDS } from './kit-bounds';

export type ItemKind = 'nature' | 'building' | 'prop';

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  /** Short plain name for captions ("a star lamp"). */
  name: string;
  tags: string[];
  /** Kit piece id in kit.glb, or a procedural builder in props.ts. */
  source: { kit: string } | { proc: string };
  /** Uniform scale applied to the kit piece (proc items are authored in metres). */
  scale: number;
  /** Radius in metres kept free around the item on the ground. */
  footprint: number;
  /** Height in metres. */
  height: number;
  /** Can be given as a gift or brought back as a souvenir. */
  gift?: boolean;
  /** Has a part that glows at night (lantern glass, lamp). */
  glow?: boolean;
  /** Trades that love this item (used by recipes for house props and by mind for likes). */
  trades?: string[];
}

type Def = Omit<CatalogItem, 'footprint' | 'height'> & { footprint?: number; height?: number };

function kitSize(id: string, scale: number): { footprint: number; height: number } {
  const b = KIT_BOUNDS[id];
  if (!b) return { footprint: 0.4, height: 0.5 };
  const w = Math.max(b[3] - b[0], b[5] - b[2]) * scale;
  return { footprint: Math.round(w * 0.5 * 100) / 100, height: Math.round((b[4] - Math.min(0, b[1])) * scale * 100) / 100 };
}

const kit = (id: string, kind: ItemKind, name: string, scale: number, tags: string[], extra: Partial<Def> = {}): Def => ({
  id, kind, name, scale, tags, source: { kit: id }, ...extra,
});
const proc = (id: string, name: string, footprint: number, height: number, tags: string[], extra: Partial<Def> = {}): Def => ({
  id, kind: 'prop', name, scale: 1, tags, source: { proc: id }, footprint, height, ...extra,
});

const DEFS: Def[] = [
  // Nature
  kit('tree-round-a', 'nature', 'a round tree', 3.6, ['tree', 'green']),
  kit('tree-round-b', 'nature', 'a round tree', 3.4, ['tree', 'green']),
  kit('trees-a-small', 'nature', 'a little grove', 2.6, ['tree', 'grove']),
  kit('trees-a-medium', 'nature', 'a grove', 2.8, ['tree', 'grove']),
  kit('trees-b-small', 'nature', 'a little grove', 2.8, ['tree', 'grove']),
  kit('trees-b-medium', 'nature', 'a grove', 2.8, ['tree', 'grove']),
  kit('trees-b-large', 'nature', 'a grove', 3.0, ['tree', 'grove']),
  kit('pine-yellow-large', 'nature', 'a golden pine', 0.62, ['tree', 'autumn']),
  kit('pine-yellow-medium', 'nature', 'a golden pine', 0.62, ['tree', 'autumn']),
  kit('pine-orange-large', 'nature', 'an amber pine', 0.6, ['tree', 'autumn']),
  kit('pine-orange-medium', 'nature', 'an amber pine', 0.6, ['tree', 'autumn']),
  kit('pine-orange-small', 'nature', 'a small amber pine', 0.6, ['tree', 'autumn']),
  kit('rock-a', 'nature', 'a flat stone', 4, ['rock']),
  kit('rock-b', 'nature', 'a stone', 4, ['rock']),
  kit('rock-c', 'nature', 'a boulder', 4, ['rock']),
  kit('rock-d', 'nature', 'a stone', 4, ['rock']),
  kit('rock-e', 'nature', 'a long stone', 4, ['rock']),
  kit('waterlily', 'nature', 'a water lily', 3, ['water']),
  kit('waterplant', 'nature', 'reeds', 3, ['water']),
  kit('cloud-big', 'nature', 'a cloud', 1, ['cloud']),
  kit('cloud-small', 'nature', 'a cloud', 1, ['cloud']),
  // Village pieces (mostly for the islands on the horizon)
  kit('bld-home-a', 'building', 'a cottage', 4, ['village']),
  kit('bld-home-b', 'building', 'a cottage', 4, ['village']),
  kit('bld-windmill', 'building', 'a windmill', 4, ['village']),
  kit('bld-tower', 'building', 'a tower', 4, ['village']),
  kit('bld-church', 'building', 'a chapel', 4, ['village']),
  kit('bld-tavern', 'building', 'an inn', 4, ['village']),
  kit('bld-well', 'building', 'a well', 2.2, ['village']),
  kit('bld-market', 'building', 'a market', 4, ['village']),
  kit('bld-watermill', 'building', 'a watermill', 4, ['village']),
  kit('hills-trees-a', 'nature', 'wooded hills', 6, ['hill']),
  kit('hills-trees-b', 'nature', 'wooded hills', 6, ['hill']),
  kit('mountain-a', 'nature', 'a peak', 6, ['hill']),
  kit('mountain-b', 'nature', 'a peak', 6, ['hill']),
  kit('hill-a', 'nature', 'a hill', 6, ['hill']),
  kit('hill-b', 'nature', 'a hill', 6, ['hill']),
  kit('bridge', 'building', 'a bridge', 2.2, ['village']),
  kit('fence-wood', 'prop', 'a fence', 1.6, ['fence']),
  // Props from the kit
  kit('lantern', 'prop', 'a lantern', 0.62, ['light'], { gift: true, glow: true, trades: ['lighthouse-keeper', 'stargazer', 'tea-maker'] }),
  kit('lantern-hanging', 'prop', 'a hanging lantern', 0.45, ['light'], { glow: true, trades: ['tea-maker'] }),
  kit('post-lantern', 'prop', 'a lamp post', 0.62, ['light', 'path'], { glow: true }),
  kit('candle', 'prop', 'candles', 0.5, ['light', 'small'], { gift: true, glow: true, trades: ['storyteller', 'musician'] }),
  kit('books', 'prop', 'a stack of books', 0.9, ['small', 'paper'], { gift: true, trades: ['storyteller', 'cartographer'] }),
  kit('book', 'prop', 'a book', 0.9, ['small', 'paper'], { gift: true, trades: ['storyteller'] }),
  kit('barrel', 'prop', 'a barrel', 4, ['storage'], { trades: ['fisher', 'baker', 'tinkerer'] }),
  kit('bucket-water', 'prop', 'a bucket of water', 3.6, ['small'], { trades: ['fisher', 'gardener'] }),
  kit('bucket', 'prop', 'a bucket', 3.6, ['small'], { trades: ['gardener'] }),
  kit('crate-big', 'prop', 'a crate', 3.6, ['storage'], { trades: ['tinkerer', 'baker'] }),
  kit('crate-small', 'prop', 'a small crate', 3.6, ['storage'], { trades: ['tinkerer'] }),
  kit('crate-open', 'prop', 'an open crate', 3.2, ['storage'], { trades: ['tinkerer'] }),
  kit('sack', 'prop', 'a sack of flour', 4, ['storage'], { trades: ['baker', 'gardener'] }),
  kit('wheelbarrow', 'prop', 'a wheelbarrow', 3.4, ['garden'], { trades: ['gardener'] }),
  kit('ladder', 'prop', 'a ladder', 2.6, ['tool'], { trades: ['tinkerer', 'painter'] }),
  kit('lumber', 'prop', 'a pile of planks', 2.4, ['storage'], { trades: ['tinkerer'] }),
  kit('stones', 'prop', 'a pile of stones', 2.4, ['storage']),
  kit('flag-yellow', 'prop', 'a yellow flag', 3.6, ['flag'], { gift: true, trades: ['cartographer'] }),
  kit('flag-red', 'prop', 'a red flag', 3.6, ['flag'], { trades: ['cartographer'] }),
  kit('flag-blue', 'prop', 'a blue flag', 3.6, ['flag'], { trades: ['fisher'] }),
  kit('tent', 'prop', 'a little tent', 2.6, ['camp']),
  kit('lamp-standing', 'prop', 'a floor lamp', 0.55, ['light'], { glow: true, trades: ['storyteller'] }),
  kit('lamp-table', 'prop', 'a table lamp', 0.5, ['light', 'small'], { gift: true, glow: true, trades: ['storyteller', 'cartographer'] }),
  kit('cactus', 'prop', 'a potted cactus', 0.7, ['plant', 'small'], { gift: true, trades: ['gardener'] }),
  kit('chair', 'prop', 'a chair', 0.55, ['furniture'], { trades: ['tea-maker'] }),
  kit('stool', 'prop', 'a stool', 0.55, ['furniture'], { trades: ['painter', 'musician'] }),
  kit('table-small', 'prop', 'a little table', 0.55, ['furniture'], { trades: ['tea-maker'] }),
  kit('table-low', 'prop', 'a low table', 0.5, ['furniture'], { trades: ['tea-maker'] }),
  kit('armchair', 'prop', 'an armchair', 0.5, ['furniture'], { trades: ['storyteller'] }),
  kit('rug', 'prop', 'a rug', 0.55, ['furniture', 'flat'], { gift: true, trades: ['tea-maker', 'storyteller'] }),
  kit('rug-stripes', 'prop', 'a striped rug', 0.55, ['furniture', 'flat'], { gift: true }),
  kit('frame-standing', 'prop', 'a picture', 0.9, ['small', 'art'], { gift: true, trades: ['painter'] }),
  kit('shelf', 'prop', 'a shelf', 0.6, ['furniture'], { trades: ['storyteller', 'tea-maker'] }),
  kit('pillow', 'prop', 'a cushion', 0.55, ['small', 'soft'], { gift: true }),
  kit('crate-tomatoes', 'prop', 'a crate of tomatoes', 0.36, ['food', 'garden'], { gift: true, trades: ['gardener'] }),
  kit('crate-carrots', 'prop', 'a crate of carrots', 0.36, ['food', 'garden'], { gift: true, trades: ['gardener'] }),
  kit('crate-buns', 'prop', 'a tray of buns', 0.36, ['food'], { gift: true, trades: ['baker'] }),
  kit('crate-lettuce', 'prop', 'a crate of greens', 0.36, ['food', 'garden'], { trades: ['gardener'] }),
  kit('jar-a', 'prop', 'a jar', 0.45, ['small'], { gift: true, trades: ['beekeeper', 'tea-maker'] }),
  kit('jar-b', 'prop', 'a tall jar', 0.45, ['small'], { trades: ['beekeeper', 'tea-maker'] }),
  kit('pot', 'prop', 'a cooking pot', 0.4, ['small', 'kitchen'], { trades: ['baker'] }),
  kit('stew-pot', 'prop', 'a pot of stew', 0.5, ['small', 'kitchen'], { gift: true, trades: ['baker'] }),
  kit('bowl', 'prop', 'a bowl', 0.35, ['small', 'kitchen'], { trades: ['tea-maker'] }),
  kit('table-round', 'prop', 'a laid table', 0.5, ['furniture'], { trades: ['tea-maker', 'baker'] }),
  kit('bench', 'prop', 'a bench', 0.8, ['furniture'], { trades: ['storyteller', 'musician'] }),
  kit('fence', 'prop', 'a fence', 0.42, ['fence']),
  kit('fence-gate', 'prop', 'a garden gate', 0.42, ['fence']),
  kit('fence-pillar', 'prop', 'a fence post', 0.42, ['fence']),
  kit('pumpkin', 'prop', 'a pumpkin', 0.6, ['food', 'garden'], { gift: true, trades: ['gardener'] }),
  kit('pumpkin-small', 'prop', 'a small pumpkin', 0.6, ['food', 'garden'], { gift: true, trades: ['gardener'] }),
  kit('arch', 'prop', 'a garden arch', 0.55, ['garden']),
  kit('post', 'prop', 'a post', 0.55, ['path']),
  kit('stepping-stones', 'prop', 'stepping stones', 0.6, ['path', 'flat']),
  // Props built in code
  proc('star-lamp', 'a star lamp', 0.3, 1.3, ['light'], { gift: true, glow: true, trades: ['stargazer'] }),
  proc('flower-pot', 'a flower pot', 0.25, 0.55, ['plant', 'small'], { gift: true, trades: ['gardener', 'painter', 'tea-maker'] }),
  proc('fruit-basket', 'a basket of fruit', 0.3, 0.4, ['food', 'small'], { gift: true, trades: ['gardener', 'baker'] }),
  proc('telescope', 'a telescope', 0.45, 1.5, ['tool'], { gift: true, trades: ['stargazer', 'cartographer', 'lighthouse-keeper'] }),
  proc('fishing-rod', 'a fishing rod', 0.35, 1.9, ['tool'], { gift: true, trades: ['fisher'] }),
  proc('beehive', 'a beehive', 0.35, 0.85, ['garden'], { gift: true, trades: ['beekeeper', 'gardener'] }),
  proc('easel', 'an easel', 0.4, 1.6, ['art', 'tool'], { gift: true, trades: ['painter'] }),
  proc('teapot', 'a teapot', 0.18, 0.28, ['small', 'kitchen'], { gift: true, trades: ['tea-maker'] }),
  proc('map', 'a map on a stand', 0.4, 1.3, ['paper'], { gift: true, trades: ['cartographer', 'storyteller'] }),
  proc('bell', 'a bell', 0.4, 1.7, ['sound'], { gift: true, trades: ['musician', 'lighthouse-keeper'] }),
  proc('kite', 'a kite', 0.4, 1.4, ['toy'], { gift: true, trades: ['cartographer', 'musician'] }),
  proc('shell', 'a big shell', 0.25, 0.25, ['small', 'sea'], { gift: true, trades: ['fisher', 'lighthouse-keeper'] }),
  proc('wind-chime', 'a wind chime', 0.3, 1.8, ['sound'], { gift: true, trades: ['musician'] }),
  proc('mailbox', 'a mailbox', 0.3, 1.2, ['post']),
  proc('bread-oven', 'a little bread oven', 0.7, 1.1, ['kitchen'], { trades: ['baker'] }),
  proc('anvil', 'an anvil', 0.35, 0.6, ['tool'], { trades: ['tinkerer'] }),
  proc('gear', 'a brass gear', 0.35, 0.7, ['tool', 'small'], { gift: true, trades: ['tinkerer'] }),
  proc('tea-table', 'a tea table', 0.6, 0.6, ['furniture'], { trades: ['tea-maker'] }),
  proc('drum', 'a drum', 0.3, 0.55, ['sound'], { gift: true, trades: ['musician'] }),
  proc('globe', 'a globe', 0.25, 0.6, ['small', 'paper'], { gift: true, trades: ['cartographer', 'stargazer'] }),
  proc('honey-jar', 'a jar of honey', 0.12, 0.22, ['small', 'food'], { gift: true, trades: ['beekeeper', 'baker', 'tea-maker'] }),
  proc('net', 'a drying net', 0.6, 1.5, ['sea'], { trades: ['fisher'] }),
  proc('bush', 'a bush', 0.6, 0.8, ['plant']),
  proc('flower-bed', 'a flower bed', 0.6, 0.35, ['plant', 'garden'], { gift: true, trades: ['gardener', 'beekeeper'] }),
  proc('sunflower', 'sunflowers', 0.3, 1.4, ['plant'], { gift: true, trades: ['gardener', 'painter', 'beekeeper'] }),
  proc('scarecrow', 'a scarecrow', 0.4, 1.7, ['garden'], { trades: ['gardener'] }),
  proc('signpost', 'a signpost', 0.3, 1.5, ['path']),
  proc('stone-lamp', 'a stone lamp', 0.3, 0.9, ['light'], { glow: true, gift: true, trades: ['tea-maker'] }),
  proc('crystal', 'a glowing crystal', 0.2, 0.5, ['small', 'light'], { gift: true, glow: true, trades: ['stargazer', 'tinkerer'] }),
];

/** Every placeable item by id. */
export const CATALOG: Record<string, CatalogItem> = Object.fromEntries(
  DEFS.map((d) => {
    const size = 'kit' in d.source ? kitSize(d.source.kit, d.scale) : { footprint: d.footprint ?? 0.4, height: d.height ?? 0.5 };
    const item: CatalogItem = {
      ...d,
      footprint: d.footprint ?? size.footprint,
      height: d.height ?? size.height,
    };
    return [d.id, item];
  }),
);

/** Words people (and the model) use for props, mapped to catalog ids. */
export const PROP_ALIASES: Record<string, string> = {
  'lamp': 'lantern',
  'star': 'star-lamp',
  'star lamp': 'star-lamp',
  'starlamp': 'star-lamp',
  'flowers': 'flower-pot',
  'flower': 'flower-pot',
  'flowerpot': 'flower-pot',
  'flower pot': 'flower-pot',
  'fruit': 'fruit-basket',
  'basket': 'fruit-basket',
  'fruit basket': 'fruit-basket',
  'rod': 'fishing-rod',
  'fishing rod': 'fishing-rod',
  'hive': 'beehive',
  'bees': 'beehive',
  'tea': 'teapot',
  'tea pot': 'teapot',
  'book': 'books',
  'chime': 'wind-chime',
  'chimes': 'wind-chime',
  'wind chime': 'wind-chime',
  'seashell': 'shell',
  'honey': 'honey-jar',
  'bread': 'crate-buns',
  'buns': 'crate-buns',
  'painting': 'frame-standing',
  'picture': 'frame-standing',
  'candles': 'candle',
  'cushion': 'pillow',
  'carpet': 'rug',
  'tomatoes': 'crate-tomatoes',
  'carrots': 'crate-carrots',
  'pumpkins': 'pumpkin',
  'sunflowers': 'sunflower',
  'map stand': 'map',
};

/** Resolves a prop word or id to a catalog id, or null if the world does not know it. */
export function resolveProp(kind: string): string | null {
  const k = kind.trim().toLowerCase();
  if (CATALOG[k]) return k;
  const dashed = k.replace(/\s+/g, '-');
  if (CATALOG[dashed]) return dashed;
  if (PROP_ALIASES[k]) return PROP_ALIASES[k];
  const single = k.endsWith('s') ? k.slice(0, -1) : k;
  if (CATALOG[single]) return single;
  if (PROP_ALIASES[single]) return PROP_ALIASES[single];
  return null;
}

/** Ids of items that can be gifts or souvenirs. */
export const GIFT_PROPS: string[] = Object.values(CATALOG).filter((i) => i.gift).map((i) => i.id);

/** Props a trade likes, in catalog order. */
export function propsForTrade(trade: string): string[] {
  return Object.values(CATALOG).filter((i) => i.kind === 'prop' && i.trades?.includes(trade)).map((i) => i.id);
}

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG[id];
}
