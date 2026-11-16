/**
 * The library of plot objects chosen by meaning, in the same material language as the
 * case stack, the cake and the notebooks: bone ceramic, paper, slate, the muted category
 * tones, vermilion only for what is open. Each builder makes one merged geometry with
 * baked colours from data alone:
 *
 *   house      a website or an app: walls, a slate roof, a window per checked part (up to 12)
 *   folder     documents: two covers and a sheet sticking out for every few documents
 *   globe      travel: a globe on its stand, a vermilion pin for each open point
 *   ledger     money: a thick book with ruled columns and a ribbon
 *   toolbox    fixes: a slate box with a bone handle and tools standing in it
 *   map        places: a map folded in panels with marked places
 *   letters    correspondence: a bone box with envelopes standing in it
 *   lamp       ideas: a desk lamp with a paper shade
 *   chart      analysis: a slate board on an easel with bars
 *
 * `units` is the number of checked units of the job (it sets the detail count), `open` the
 * points still open (they hang as vermilion tags or pins, as on the case stack).
 * Footprints stay within about 22 × 18 cm and heights within 0.20–0.38 m.
 */
import { Color, type BufferGeometry } from '@iwsdk/core';
import { COLOR } from '../../../tokens/tokens';
import { bevelBox, box, cylinder, lathe, merge, placed, sphere, tint, flatRing } from '../geom';
import { seeded } from '../time';

export type LibraryKind = 'house' | 'folder' | 'globe' | 'ledger' | 'toolbox' | 'map' | 'letters' | 'lamp' | 'chart';
export const LIBRARY_KINDS: readonly LibraryKind[] = ['house', 'folder', 'globe', 'ledger', 'toolbox', 'map', 'letters', 'lamp', 'chart'];
export type LibrarySpec = { kind: LibraryKind; units?: number; open?: number };
export type Built = { geometry: BufferGeometry; height: number; footprint: [number, number] };

const C = COLOR;
type V3 = [number, number, number];
const put = (g: BufferGeometry, color: string, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): BufferGeometry => tint(placed(g, at, rot, scale), color);

/** Vermilion tags hanging on short strings along a front edge (open points). */
function tags(open: number, width: number, y: number, z: number, rnd: () => number): BufferGeometry[] {
  const n = Math.min(Math.max(0, open), 8);
  const out: BufferGeometry[] = [];
  for (let k = 0; k < n; k++) {
    const x = -width / 2 + ((k + 0.5) / n) * width;
    out.push(put(box(0.0012, 0.012, 0.0012), C.vermilion, [x, y - 0.012, z]));
    out.push(put(bevelBox(0.02, 0.026, 0.0016, 0.0005, 0.002), C.vermilion, [x, y - 0.038, z + 0.001], [0, 0, (rnd() - 0.5) * 0.2]));
  }
  return out;
}

function house(units: number, open: number, rnd: () => number): Built {
  const w = 0.2;
  const d = 0.15;
  const h = 0.14;
  const parts: BufferGeometry[] = [put(bevelBox(w, h, d, 0.003, 0.004), C.bone)];
  // A gable roof of two slate slabs with a small overhang.
  const pitch = 0.62;
  const slope = (d / 2 + 0.02) / Math.cos(pitch);
  for (const s of [-1, 1]) parts.push(put(bevelBox(w + 0.03, 0.01, slope, 0.002), C.slate, [0, h + Math.sin(pitch) * slope * 0.5 - 0.004, (s * (d / 2 + 0.02)) / 2], [s * pitch, 0, 0]));
  parts.push(put(box(w + 0.03, 0.01, 0.012), C.slateEdge, [0, h + Math.tan(pitch) * (d / 2 + 0.02) - 0.006, 0]));
  // The gable ends: stacked bone strips narrowing to the ridge.
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) {
    const k = (i + 0.5) / 6;
    parts.push(put(box(0.006, (Math.tan(pitch) * (d / 2)) / 6, d * (1 - k) + 0.004), C.bone, [s * (w / 2 - 0.003), h + (i * Math.tan(pitch) * (d / 2)) / 6, 0]));
  }
  // Door and a window for every checked part (two rows of up to six on the front).
  parts.push(put(bevelBox(0.034, 0.064, 0.004, 0.001, 0.002), C.slate, [-0.05, 0.002, d / 2]));
  const windows = Math.max(1, Math.min(12, Math.round(units / 10)));
  for (let i = 0; i < windows; i++) {
    const row = Math.floor(i / 6);
    const col = i % 6;
    const x = -0.015 + col * 0.02;
    parts.push(put(bevelBox(0.014, 0.018, 0.003, 0.0008, 0.002), i % 3 === 0 ? C.highlight : C.paper, [x, 0.04 + row * 0.05, d / 2 + 0.0005]));
  }
  parts.push(...tags(open, w * 0.8, h, d / 2 + 0.006, rnd));
  return { geometry: merge(parts), height: h + Math.tan(pitch) * (d / 2 + 0.02) + 0.01, footprint: [w, d] };
}

function folder(units: number, open: number, rnd: () => number): Built {
  const w = 0.22;
  const sheets = Math.max(2, Math.min(24, Math.round(units / 6)));
  const parts: BufferGeometry[] = [];
  // A folder standing on its spine, leaning back, sheets showing above its top.
  const lean = -0.3;
  const thick = 0.004 + sheets * 0.0016;
  parts.push(put(bevelBox(w, 0.22, 0.0025, 0.0008, 0.006), C.category.ochre, [0, 0, -thick / 2], [lean, 0, 0]));
  parts.push(put(bevelBox(w, 0.2, 0.0025, 0.0008, 0.006), C.category.ochre, [0, 0, thick / 2], [lean, 0, 0]));
  parts.push(put(bevelBox(0.05, 0.016, 0.0025, 0.0008, 0.004), C.category.ochre, [-0.06, 0.218, -thick / 2 - 0.004], [lean, 0, 0]));
  for (let i = 0; i < sheets; i++) {
    const z = -thick / 2 + 0.002 + (i + 0.5) * 0.0016;
    const up = 0.2 + rnd() * 0.035;
    parts.push(put(box(w - 0.016 - rnd() * 0.01, up, 0.0011), i % 4 === 1 ? C.edge : C.paper, [(rnd() - 0.5) * 0.008, 0.004, z], [lean, 0, 0]));
  }
  parts.push(put(box(w + 0.01, 0.006, thick + 0.01), C.category.ochre, [0, 0, 0], [lean, 0, 0]));
  parts.push(...tags(open, w * 0.7, 0.2, 0.06, rnd));
  return { geometry: merge(parts), height: 0.24, footprint: [w, 0.12] };
}

function globe(units: number, open: number, rnd: () => number): Built {
  const r = 0.1;
  const cy = 0.16;
  const parts: BufferGeometry[] = [
    put(lathe([[0, 0], [0.07, 0], [0.072, 0.008], [0.03, 0.016], [0.012, 0.03], [0, 0.03]], 32), C.bone),
    put(cylinder(0.005, 0.006, cy - 0.03 - r * 0.6, 12), C.slate, [0, 0.03, 0]),
  ];
  // The ball: sea in steel with land in sage, by bands; a slate meridian ring around it.
  const ball = sphere(r, 32, 20);
  const pos = ball.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const sea = new Color(C.category.steel);
  const land = new Color(C.category.sage);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / r;
    const y = pos.getY(i) / r;
    const z = pos.getZ(i) / r;
    const n = Math.sin(x * 5.1 + 1.3) * Math.cos(y * 4.3) + Math.sin(z * 6.2 - y * 2.0) * 0.8;
    const c = n > 0.45 ? land : sea;
    col.set([c.r, c.g, c.b], i * 3);
  }
  ball.setAttribute('color', ball.attributes.color.clone());
  (ball.attributes.color.array as Float32Array).set(col);
  parts.push(placed(ball, [0, cy, 0], [0.4, 0, 0]));
  parts.push(put(flatRing(r + 0.008, 0.0025, 48), C.slate, [0, cy, 0], [Math.PI / 2 + 0.4, 0, 0]));
  // A pin for each open point; the travelled places as paper flags.
  const pins = Math.min(8, Math.max(0, open));
  for (let k = 0; k < pins + Math.min(4, Math.round(units / 30)); k++) {
    const a = rnd() * Math.PI * 2;
    const b = (rnd() - 0.3) * 1.2;
    const nx = Math.cos(b) * Math.sin(a);
    const ny = Math.sin(b);
    const nz = Math.cos(b) * Math.cos(a);
    const isOpen = k < pins;
    parts.push(put(cylinder(0.0012, 0.0012, 0.022, 6), C.slateEdge, [nx * r, cy + ny * r, nz * r], [Math.atan2(Math.hypot(nx, nz), ny) * 0, 0, 0]));
    parts.push(put(sphere(isOpen ? 0.006 : 0.004, 8, 6), isOpen ? C.vermilion : C.paper, [nx * (r + 0.02), cy + ny * (r + 0.02), nz * (r + 0.02)]));
  }
  return { geometry: merge(parts), height: cy + r + 0.012, footprint: [0.2, 0.2] };
}

function ledger(units: number, open: number, rnd: () => number): Built {
  const w = 0.2;
  const d = 0.26;
  const pages = Math.max(0.03, Math.min(0.09, 0.03 + units / 2000));
  const parts: BufferGeometry[] = [
    put(bevelBox(w, 0.006, d, 0.002, 0.006), C.slate),
    put(box(w - 0.012, pages, d - 0.01), C.paper, [0.004, 0.006, 0]),
    put(bevelBox(w, 0.006, d, 0.002, 0.006), C.slate, [0, 0.006 + pages, 0]),
    put(bevelBox(0.02, pages + 0.014, d + 0.002, 0.003, 0.004), C.slateEdge, [-w / 2 + 0.006, -0.001, 0]),
  ];
  // Ruled columns pressed into the cover, a label plate and a vermilion ribbon.
  for (let i = 0; i < 4; i++) parts.push(put(box(0.002, 0.0006, d - 0.06), C.slateEdge, [-0.04 + i * 0.03, 0.012 + pages, 0]));
  parts.push(put(bevelBox(0.09, 0.0012, 0.04, 0.0004, 0.003), C.bone, [0.02, 0.012 + pages, -0.07]));
  parts.push(put(box(0.008, 0.0008, 0.07), C.vermilion, [0.06, 0.0125 + pages, d / 2 + 0.02], [0.35, 0, 0]));
  // Tabs of the open entries on the right edge.
  for (let k = 0; k < Math.min(8, Math.max(0, open)); k++) parts.push(put(box(0.014, 0.0012, 0.012), C.vermilion, [w / 2 + 0.004, 0.006 + rnd() * pages, -d / 2 + 0.03 + k * 0.025]));
  // The ledger rests on a bone book stand, its cover turned to the person.
  const book = merge(parts);
  const tilt = 0.95;
  book.translate(0, 0, -d / 2);
  book.rotateX(tilt);
  book.translate(0, 0.02, d / 2 * Math.cos(tilt) * 0.5);
  const stand = [
    put(bevelBox(w * 0.8, 0.012, 0.16, 0.003, 0.006), C.bone, [0, 0, -0.04]),
    put(box(w * 0.7, 0.012, 0.03), C.bone, [0, 0.008, 0.035]),
    put(box(w * 0.5, Math.sin(tilt) * d * 0.8, 0.01), C.bone, [0, 0.01, -0.07], [-0.6, 0, 0]),
  ];
  return { geometry: merge([book, ...stand]), height: 0.02 + Math.sin(tilt) * d + (pages + 0.012) * Math.cos(tilt), footprint: [w, 0.18] };
}

function toolbox(units: number, open: number, rnd: () => number): Built {
  const w = 0.22;
  const d = 0.12;
  const h = 0.1;
  const parts: BufferGeometry[] = [
    put(bevelBox(w, h, d, 0.004, 0.006), C.slate),
    put(box(w - 0.012, 0.002, d - 0.012), C.slateEdge, [0, h - 0.004, 0]),
    // The handle: two posts and a bone grip.
    put(box(0.008, 0.07, 0.008), C.slateEdge, [-0.06, h, 0]),
    put(box(0.008, 0.07, 0.008), C.slateEdge, [0.06, h, 0]),
    put(cylinder(0.009, 0.009, 0.13, 16), C.bone, [-0.065, h + 0.07, 0], [0, 0, -Math.PI / 2]),
  ];
  // Tools standing in it: a bone wrench, a screwdriver with a terracotta grip, rulers.
  const tools = Math.max(2, Math.min(7, Math.round(units / 15)));
  for (let i = 0; i < tools; i++) {
    const x = -w / 2 + 0.02 + (i / Math.max(1, tools - 1)) * (w - 0.04);
    const z = (i % 2 ? 1 : -1) * 0.025;
    const tall = 0.05 + rnd() * 0.04;
    if (i % 3 === 0) {
      parts.push(put(box(0.008, tall, 0.004), C.bone, [x, h - 0.02, z], [0, 0, (rnd() - 0.5) * 0.3]));
      parts.push(put(flatRing(0.009, 0.003, 12), C.bone, [x, h - 0.02 + tall, z], [Math.PI / 2, 0, 0]));
    } else if (i % 3 === 1) {
      parts.push(put(cylinder(0.006, 0.006, 0.04, 8), C.category.terracotta, [x, h - 0.02, z]));
      parts.push(put(cylinder(0.0018, 0.0012, tall * 0.6, 6), C.slateEdge, [x, h + 0.02, z]));
    } else parts.push(put(box(0.016, tall, 0.002), C.paper, [x, h - 0.02, z], [0, 0.3, 0]));
  }
  parts.push(...tags(open, w * 0.8, h - 0.004, d / 2 + 0.003, rnd));
  return { geometry: merge(parts), height: h + 0.08, footprint: [w, d] };
}

function map(units: number, open: number, rnd: () => number): Built {
  const panels = 4;
  const pw = 0.06;
  const ph = 0.2;
  const parts: BufferGeometry[] = [];
  // A map folded like a screen, standing in a zigzag; each panel carries land and roads.
  for (let i = 0; i < panels; i++) {
    const a = i % 2 ? 0.35 : -0.35;
    const x = -((panels - 1) * pw * 0.94) / 2 + i * pw * 0.94;
    parts.push(put(box(pw, ph, 0.0015), C.paper, [x, 0, 0], [0, a, 0]));
    for (let k = 0; k < 3; k++) {
      const by = 0.02 + rnd() * (ph - 0.07);
      parts.push(put(box(pw * (0.4 + rnd() * 0.4), 0.03 + rnd() * 0.04, 0.0006), k === 1 ? C.category.steel : C.category.sage, [x + (rnd() - 0.5) * 0.02, by, 0.001], [0, a, 0]));
    }
    parts.push(put(box(pw * 0.9, 0.002, 0.0006), C.category.ochre, [x, 0.05 + i * 0.03, 0.0016], [0, a, 0.3]));
  }
  // Places marked: paper dots for visited ones, vermilion for open ones.
  const marks = Math.min(10, Math.max(0, open) + Math.round(units / 25));
  for (let k = 0; k < marks; k++) {
    const i = Math.floor(rnd() * panels);
    const x = -((panels - 1) * pw * 0.94) / 2 + i * pw * 0.94 + (rnd() - 0.5) * 0.03;
    parts.push(put(sphere(0.005, 8, 6), k < open ? C.vermilion : C.ink, [x, 0.03 + rnd() * (ph - 0.05), 0.006]));
  }
  parts.push(put(bevelBox(0.25, 0.008, 0.08, 0.002, 0.006), C.bone, [0, -0.008, 0]));
  return { geometry: merge(parts), height: ph, footprint: [0.25, 0.08] };
}

function letters(units: number, open: number, rnd: () => number): Built {
  const w = 0.2;
  const d = 0.13;
  const h = 0.08;
  const parts: BufferGeometry[] = [
    put(bevelBox(w, 0.006, d, 0.002, 0.006), C.bone),
    put(box(w, h, 0.005), C.bone, [0, 0, -d / 2 + 0.0025]),
    put(box(w, h, 0.005), C.bone, [0, 0, d / 2 - 0.0025]),
    put(box(0.005, h, d), C.bone, [-w / 2 + 0.0025, 0, 0]),
    put(box(0.005, h, d), C.bone, [w / 2 - 0.0025, 0, 0]),
  ];
  // Envelopes standing on their long edge, a little out of line; the open ones carry a vermilion stamp.
  const count = Math.max(3, Math.min(22, Math.round(units / 5)));
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + 0.012 + (i / Math.max(1, count - 1)) * (w - 0.024);
    const tall = 0.1 + rnd() * 0.02;
    const env = put(box(0.003, tall, 0.11), i % 5 === 2 ? C.edge : C.paper, [x, 0.006, (rnd() - 0.5) * 0.006], [0, 0, (rnd() - 0.5) * 0.12]);
    parts.push(env);
    if (i < Math.min(open, 8)) parts.push(put(box(0.0035, 0.014, 0.014), C.vermilion, [x, 0.006 + tall - 0.024, 0.035]));
  }
  return { geometry: merge(parts), height: 0.13, footprint: [w, d] };
}

function lamp(units: number, open: number, rnd: () => number): Built {
  const parts: BufferGeometry[] = [
    put(lathe([[0, 0], [0.08, 0], [0.082, 0.01], [0.06, 0.018], [0, 0.02]], 32), C.slate),
    put(cylinder(0.006, 0.007, 0.16, 12), C.slateEdge, [0, 0.02, 0]),
    put(sphere(0.011, 12, 8), C.slate, [0, 0.18, 0]),
    put(cylinder(0.005, 0.005, 0.09, 10), C.slateEdge, [0, 0.18, 0], [0.9, 0, 0]),
  ];
  // The paper shade at the end of the arm, a bone bulb inside it.
  const shade = lathe([[0.03, 0], [0.026, 0.012], [0.016, 0.05], [0.01, 0.06], [0.008, 0.062]], 32);
  parts.push(put(shade, C.paper, [0, 0.215, 0.08], [0.5, 0, 0]));
  parts.push(put(sphere(0.012, 12, 8), C.bone, [0, 0.235, 0.085]));
  // Ideas kept: paper notes under the lamp, one for every few units; the open ones vermilion.
  const notes = Math.min(9, Math.max(1, Math.round(units / 15)));
  for (let i = 0; i < notes; i++) parts.push(put(box(0.05, 0.0012, 0.05), i < open ? C.vermilion : i % 2 ? C.highlight : C.paper, [(rnd() - 0.5) * 0.08, 0.02 + i * 0.0014, 0.09 + (rnd() - 0.5) * 0.04], [0, (rnd() - 0.5) * 0.6, 0]));
  return { geometry: merge(parts), height: 0.3, footprint: [0.18, 0.22] };
}

function chart(units: number, open: number, rnd: () => number): Built {
  const w = 0.22;
  const h = 0.17;
  const parts: BufferGeometry[] = [];
  // An easel: two slate legs and a back leg; a slate board with a bone face.
  for (const s of [-1, 1]) parts.push(put(box(0.008, 0.3, 0.008), C.slateEdge, [s * 0.08, 0, 0], [-0.12, 0, s * -0.08]));
  parts.push(put(box(0.008, 0.29, 0.008), C.slateEdge, [0, 0, -0.07], [0.3, 0, 0]));
  parts.push(put(bevelBox(w + 0.016, h + 0.016, 0.008, 0.002, 0.006), C.slate, [0, 0.11, 0.02], [-0.12, 0, 0]));
  parts.push(put(box(w, h, 0.002), C.bone, [0, 0.118, 0.026], [-0.12, 0, 0]));
  // Bars from the data: one for each part, rising to the right; the open ones vermilion.
  const bars = Math.max(3, Math.min(10, Math.round(units / 12)));
  const bw = (w - 0.03) / bars;
  for (let i = 0; i < bars; i++) {
    const v = 0.25 + 0.75 * (((i + 1) / bars) * 0.7 + rnd() * 0.3);
    const isOpen = i >= bars - Math.min(open, bars);
    parts.push(put(box(bw * 0.7, (h - 0.03) * v, 0.003), isOpen ? C.vermilion : i % 2 ? C.category.steel : C.category.sage, [-w / 2 + 0.015 + (i + 0.5) * bw, 0.13, 0.03], [-0.12, 0, 0]));
  }
  parts.push(put(box(w - 0.02, 0.002, 0.003), C.ink, [0, 0.128, 0.03], [-0.12, 0, 0]));
  return { geometry: merge(parts), height: 0.3, footprint: [w, 0.14] };
}

const BUILDERS: Record<LibraryKind, (units: number, open: number, rnd: () => number) => Built> = { house, folder, globe, ledger, toolbox, map, letters, lamp, chart };

/** Builds a library object from its spec (seeded jitter only; every count comes from the data). */
export function libraryGeometry(spec: LibrarySpec, seed = 1): Built {
  const rnd = seeded(seed * 613 + LIBRARY_KINDS.indexOf(spec.kind));
  return BUILDERS[spec.kind](Math.max(0, spec.units ?? 60), Math.max(0, spec.open ?? 0), rnd);
}
