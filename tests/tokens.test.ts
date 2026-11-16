/**
 * Tokens against DESIGN: the generated CSS matches tokens.ts, every contrast pair is
 * recomputed with the WCAG 2.1 formula (passing pairs pass, forbidden pairs stay below
 * their threshold), the seated bench holds together in the ordinary and the narrow
 * layout, and every panel holds the text DESIGN promises in ordinary and large text.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BENCH_TOGETHER,
  BUDGET,
  CATEGORY_ORDER,
  CATEGORY_SHAPE,
  COLOR,
  CONTRAST,
  HAND_ITEMS,
  LAYOUT,
  NARROW_MAX_AZ,
  PANEL,
  SEAT,
  TEXT,
  charsPerLine,
  dmmToMeters,
  lineHeightFor,
  narrowAz,
  polar,
  textSizeFor,
  type BenchItem,
  type PanelSpec,
  type Place,
} from '../src/tokens/tokens';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------- WCAG 2.1

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('tokens.css', () => {
  it('is generated from tokens.ts and up to date', async () => {
    const builder = (await import(pathToFileURL(path.join(ROOT, 'scripts/build-tokens.mjs')).href)) as {
      loadTokens(): Promise<unknown>;
      renderTokensCss(tokens: unknown): string;
    };
    const expected = builder.renderTokensCss(await builder.loadTokens());
    const onDisk = (await readFile(path.join(ROOT, 'src/tokens/tokens.css'), 'utf8')).replace(/\r\n/g, '\n');
    expect(onDisk, 'src/tokens/tokens.css is stale: run "npm run tokens"').toBe(expected);
  });

  it('names every colour of DESIGN', async () => {
    const css = await readFile(path.join(ROOT, 'src/tokens/tokens.css'), 'utf8');
    for (const hex of [COLOR.void.zenith, COLOR.ground.tile[2], COLOR.slate, COLOR.cobalt, COLOR.hc.cobalt, COLOR.category.steel]) {
      expect(css).toContain(hex);
    }
    expect(css).toContain('--role-action: var(--color-action)');
    expect(css).toMatch(/--font-family: 'Atkinson Hyperlegible Next'/);
  });
});

describe('contrast pairs of DESIGN', () => {
  it.each(CONTRAST.map((p) => [`${p.fg} on ${p.bg} (${p.use})`, p] as const))('%s', (_name, pair) => {
    const ratio = contrast(pair.fg, pair.bg);
    // DESIGN copied its ratios from a script to two decimals.
    expect(ratio).toBeCloseTo(pair.ratio, 1);
    if (pair.pass) expect(ratio).toBeGreaterThanOrEqual(pair.min);
    else expect(ratio).toBeLessThan(pair.min);
  });

  it('keeps the six forbidden pairs forbidden', () => {
    const forbidden = CONTRAST.filter((p) => !p.pass).map((p) => `${p.fg}/${p.bg}`);
    for (const [fg, bg] of [
      [COLOR.cobaltText, COLOR.glass.face],
      [COLOR.vermilionText, COLOR.glass.face],
      [COLOR.mossText, COLOR.glass.face],
      [COLOR.ink, COLOR.glass.face],
      [COLOR.outline, COLOR.ground.tile[0]],
      [COLOR.amber, COLOR.bone],
    ]) {
      expect(forbidden).toContain(`${fg}/${bg}`);
    }
  });

  it('gives every category colour its own shape', () => {
    expect(new Set(CATEGORY_ORDER.map((c) => CATEGORY_SHAPE[c])).size).toBe(4);
  });
});

// ---------------------------------------------------------------- layout

type Rect = { x0: number; x1: number; z0: number; z1: number };
/** Footprint on the slab: x right, z forward (the head is at the origin). */
function rect(p: Place): Rect {
  const a = (p.az * Math.PI) / 180;
  const x = p.dist * Math.sin(a);
  const z = p.dist * Math.cos(a);
  return { x0: x - p.w / 2, x1: x + p.w / 2, z0: z - p.d / 2, z1: z + p.d / 2 };
}
const overlaps = (a: Rect, b: Rect): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const SLAB: Rect = {
  x0: -LAYOUT.bench.w / 2,
  x1: LAYOUT.bench.w / 2,
  z0: LAYOUT.bench.dist - LAYOUT.bench.d / 2,
  z1: LAYOUT.bench.dist + LAYOUT.bench.d / 2,
};

function checkBench(places: Record<BenchItem, Place>, maxAz: number, handZone: boolean): string[] {
  const problems: string[] = [];
  const items = Object.keys(places) as BenchItem[];
  for (const item of items) {
    const p = places[item];
    const r = rect(p);
    if (r.x0 < SLAB.x0 - 1e-9 || r.x1 > SLAB.x1 + 1e-9 || r.z0 < SLAB.z0 - 1e-9 || r.z1 > SLAB.z1 + 1e-9) {
      problems.push(`${item} leaves the slab`);
    }
    if (Math.abs(p.az) > maxAz + 1e-9) problems.push(`${item} at ${p.az}° is outside ±${maxAz}°`);
    // Height rule at the far edge: nothing on the slab covers the caption rail.
    const limit = LAYOUT.heightRule.a + LAYOUT.heightRule.b * r.z1;
    if (p.y + p.h > limit + 1e-9) problems.push(`${item} is ${p.h} m tall, the rule allows ${limit.toFixed(3)} m`);
    if (HAND_ITEMS.includes(item)) {
      const down = (Math.atan2(SEAT.benchBelowEyes - p.y - p.h, p.dist) * 180) / Math.PI;
      if (down > 35 + 1e-9) problems.push(`${item} is seen ${down.toFixed(1)}° down, more than 35°`);
      if (handZone && (p.dist < SEAT.handZone.min - 1e-9 || p.dist > SEAT.handZone.max + 1e-9)) {
        problems.push(`${item} at ${p.dist} m is outside the hand zone`);
      }
    }
  }
  for (const group of BENCH_TOGETHER) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (overlaps(rect(places[group[i]]), rect(places[group[j]]))) problems.push(`${group[i]} overlaps ${group[j]}`);
      }
    }
  }
  return problems;
}

const benchOf = (source: Record<string, unknown>): Record<BenchItem, Place> => {
  const out = {} as Record<BenchItem, Place>;
  for (const group of BENCH_TOGETHER) for (const item of group) out[item] = source[item] as Place;
  return out;
};

describe('seated layout', () => {
  it('keeps the ordinary bench on the slab, apart, low enough and within ±32°', () => {
    expect(checkBench(benchOf(LAYOUT), 32, true)).toEqual([]);
  });

  it('keeps the narrow bench the same way, within ±26.5°, near the pulled-in azimuths', () => {
    expect(checkBench(LAYOUT.narrow, NARROW_MAX_AZ, false)).toEqual([]);
    expect(narrowAz(30)).toBe(24);
    expect(narrowAz(-30)).toBe(-24);
    expect(narrowAz(14)).toBe(14);
    for (const item of Object.keys(LAYOUT.narrow) as BenchItem[]) {
      const target = narrowAz((LAYOUT as unknown as Record<BenchItem, Place>)[item].az);
      // the search keeps each object within 7° of its rule azimuth (the first stake moves most)
      expect(Math.abs(LAYOUT.narrow[item].az - target), item).toBeLessThanOrEqual(7);
    }
  });

  it('records the distance to the eyes of every object on the slab', () => {
    // 0.50 m ahead on the slab is 0.59 m from the eyes (DESIGN).
    expect(LAYOUT.inbox.eyeDist).toBeCloseTo(Math.hypot(0.5, 0.32 - 0.0375), 3);
    expect(Math.hypot(0.5, SEAT.benchBelowEyes)).toBeCloseTo(0.594, 3);
  });

  it('puts points around the head with polar(): azimuth 0 ahead, positive to the right', () => {
    const ahead = polar(0, 1.3, -0.47);
    expect(ahead.x).toBeCloseTo(0, 9);
    expect(ahead.z).toBeCloseTo(-1.3, 9);
    expect(polar(90, 1, 0).x).toBeCloseTo(1, 9);
  });

  it('spreads the stations symmetrically within the arc', () => {
    for (const list of Object.values(LAYOUT.arc.stations)) {
      expect(list.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 9);
      for (const az of list) expect(Math.abs(az)).toBeLessThanOrEqual(LAYOUT.arc.to);
    }
  });

  it('fills the frame budget exactly with its zones', () => {
    const sum = Object.values(BUDGET.zones).reduce((a, b) => a + b, 0);
    expect(sum).toBe(BUDGET.drawCalls);
    expect([1, 2]).toContain(BUDGET.viewFactor);
  });
});

// ---------------------------------------------------------------- panels

/** Lines a panel needs for its text, and whether every line fits in width. */
function need(spec: PanelSpec, box: { w: number; h: number }, large: boolean): { height: number; problems: string[] } {
  const problems: string[] = [];
  let height = spec.reserve ?? 0;
  for (const line of (large && spec.largeLines) || spec.lines) {
    const cpl = charsPerLine(line.role, box.w, spec.eyeDist, large);
    let count = line.count;
    if (line.flow) {
      count = Math.ceil((line.chars * line.count) / cpl);
    } else if (cpl < line.chars) {
      const wrapped = Math.ceil(line.chars / cpl);
      if (!line.wrap || wrapped > line.wrap) problems.push(`${line.role} ${line.chars} chars: only ${cpl} fit`);
      count = line.count * wrapped;
    }
    height += count * lineHeightFor(line.role, spec.eyeDist, large);
  }
  for (const row of spec.rows ?? []) {
    const width = row.parts.reduce((w, p) => w + p.chars * textSizeFor(p.role, spec.eyeDist, large) * TEXT.charWidth, 0);
    if (width > box.w + 1e-9) problems.push(`row ${row.parts.map((p) => p.role).join('+')} is ${width.toFixed(3)} m wide`);
  }
  if (height > box.h + 1e-6) problems.push(`needs ${height.toFixed(3)} m of height, has ${box.h}`);
  return { height, problems };
}

describe('panels hold their text', () => {
  it('derives sizes from the formulas of DESIGN', () => {
    // 16 dmm at 0.40 m: a capital 6.4 mm, a font size of 9.14 mm, 39 characters in 18 cm.
    expect(dmmToMeters(16, 0.4)).toBeCloseTo(0.0064, 6);
    expect(textSizeFor('read', 0.4)).toBeCloseTo(0.0064 / 0.7, 6);
    expect(charsPerLine('read', 0.18, 0.4)).toBe(39);
    expect(textSizeFor('read', 0.4, true) / textSizeFor('read', 0.4)).toBeCloseTo(1.25, 9);
  });

  it.each(Object.entries(PANEL))('%s in ordinary and in large text', (_name, spec) => {
    expect(need(spec, spec.size, false).problems).toEqual([]);
    expect(need(spec, spec.large, true).problems).toEqual([]);
  });

  it('keeps every line within the 48-character limit', () => {
    for (const spec of Object.values(PANEL) as PanelSpec[]) for (const line of [...spec.lines, ...(spec.largeLines ?? [])]) expect(line.chars).toBeLessThanOrEqual(TEXT.maxLine);
  });
});
