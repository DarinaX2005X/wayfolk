import { describe, expect, it } from 'vitest';
import { CATALOG, GIFT_PROPS, propsForTrade, resolveProp } from '../../src/world/catalog';
import { KIT_BOUNDS } from '../../src/world/kit-bounds';
import { PROC_PROPS, buildProp } from '../../src/world/props';
import { TRADES } from '../../src/mind/types';

describe('world catalog', () => {
  it('every item has a size and a source the world can build', () => {
    for (const item of Object.values(CATALOG)) {
      expect(item.footprint, item.id).toBeGreaterThan(0);
      expect(item.height, item.id).toBeGreaterThan(0);
      expect(item.name.length, item.id).toBeGreaterThan(0);
      if ('kit' in item.source) expect(KIT_BOUNDS[item.source.kit], item.id).toBeDefined();
      else expect(PROC_PROPS, item.id).toContain(item.source.proc);
    }
  });

  it('builds every procedural prop as painted geometry', () => {
    for (const id of PROC_PROPS) {
      const g = buildProp(id, 1);
      expect(g, id).not.toBeNull();
      expect(g!.getAttribute('position').count, id).toBeGreaterThan(0);
      expect(g!.getAttribute('color').itemSize, id).toBe(4);
    }
  });

  it('has the gifts and souvenirs the story needs', () => {
    for (const id of ['lantern', 'star-lamp', 'flower-pot', 'fruit-basket', 'telescope', 'fishing-rod', 'beehive', 'easel', 'teapot', 'books', 'map', 'bell', 'kite', 'shell']) {
      expect(GIFT_PROPS, id).toContain(id);
    }
  });

  it('understands plain words for props', () => {
    expect(resolveProp('Lantern')).toBe('lantern');
    expect(resolveProp('star lamp')).toBe('star-lamp');
    expect(resolveProp('fishing rod')).toBe('fishing-rod');
    expect(resolveProp('flowers')).toBe('flower-pot');
    expect(resolveProp('a spaceship')).toBeNull();
  });

  it('every trade likes some props', () => {
    for (const t of TRADES) expect(propsForTrade(t).length, t).toBeGreaterThan(0);
  });
});
