/**
 * Props built in code, in metres, origin on the ground at the centre, front toward +z.
 * Same chunky style as the KayKit pieces: few faces, bevelled boxes, warm flat colours.
 */
import { Color, type BufferGeometry } from '@iwsdk/core';
import { M, MAT, ball, blob, build, cbox, cone, cyl, dome, gear, hull, lathe, paint, place, rng, surfaceAlpha, type Hex, type PaintOpts } from './geo';

type Part = [BufferGeometry, Hex, PaintOpts?];
const GLOW: PaintOpts = { glow: true, shade: 0 };

function flowerHead(x: number, y: number, z: number, petal: Hex, size = 0.07): Part[] {
  return [
    [place(ball(size, 6, 4), [x, y, z], [0, 0, 0], [1, 0.55, 1]), petal, { shade: 0 }],
    [place(ball(size * 0.45, 5, 3), [x, y + size * 0.35, z]), '#f4c542', { shade: 0 }],
  ];
}

/**
 * A wind chime that cannot read as a post with something hanging off an arm: a bamboo cane
 * growing out of a planter, bending over like a reed in a long soft arc, with a few leaves
 * along it and the chime hanging from its tip. `hang` is the tip (the ring's centre).
 */
export function chimeCane(height = 1.55, reach = 0.42): { parts: Part[]; hang: [number, number, number] } {
  const parts: Part[] = [
    [lathe([[0.0, 0], [0.13, 0], [0.16, 0.2], [0.19, 0.22], [0.19, 0.27], [0.0, 0.27]], 12), MAT.terracotta, { mat: M.brick }],
    [place(cyl(0.16, 0.16, 0.02, 12), [0, 0.25, 0]), MAT.soil, { shade: 0 }],
    [place(blob(0.13, 1, 4, 0.2, 0.6), [0.02, 0.3, -0.03]), MAT.leafDark, { smooth: true, mat: M.leaf }],
  ];
  // the cane: segments along a curve that rises straight and then arcs over toward +x
  const pts: [number, number, number][] = [];
  const n = 12;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const bend = Math.pow(Math.max(0, (t - 0.45) / 0.55), 1.6);
    pts.push([reach * bend, 0.26 + (height - 0.26) * (t - 0.18 * bend * bend), 0]);
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    const r = 0.022 - i * 0.0011;
    parts.push([place(cyl(r * 0.92, r, len + 0.004, 6), [a[0], a[1], a[2]], [0, 0, -Math.atan2(dx, dy)]), i % 3 === 2 ? '#a9a259' : '#c2b56a', { mat: M.bark, shade: 0.1 }]);
    if (i % 3 === 2) parts.push([place(cyl(r * 1.25, r * 1.25, 0.018, 6), [b[0], b[1] - 0.01, b[2]], [0, 0, -Math.atan2(dx, dy)]), '#8f8746', { mat: M.bark }]);
  }
  // long narrow leaves off the joints
  for (const [i, side] of [[4, 1], [6, -1], [8, 1], [10, -1]] as [number, number][]) {
    const p = pts[i];
    parts.push([place(blob(0.05, 1, 20 + i, 0.08, 0.25), [p[0] + 0.07, p[1] + 0.02, p[2] + side * 0.05], [0.3 * side, 0.4 * side, -0.6], [2.2, 1, 0.8]), MAT.leaf, { smooth: true, mat: M.leaf, flutter: 'all' }]);
  }
  const tip = pts[n];
  const hang: [number, number, number] = [tip[0], tip[1] - 0.16, tip[2]];
  parts.push([place(cyl(0.004, 0.004, 0.16, 3), [tip[0], tip[1] - 0.16, tip[2]]), MAT.rope]);
  parts.push([place(cyl(0.085, 0.085, 0.03, 12), [hang[0], hang[1] - 0.03, hang[2]]), MAT.woodLight, { mat: M.plank }]);
  return { parts, hang };
}

/** Five resting chime tubes and their strings under a ring at `hang`. */
export function chimeTubes(hang: [number, number, number], metal: Hex = '#b7d0d6'): Part[] {
  const parts: Part[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const len = 0.26 - i * 0.025;
    const x = hang[0] + Math.cos(a) * 0.06;
    const z = hang[2] + Math.sin(a) * 0.06;
    parts.push([place(cyl(0.003, 0.003, 0.06, 3), [x, hang[1] - 0.09, z]), MAT.rope]);
    parts.push([place(cyl(0.013, 0.013, len, 8), [x, hang[1] - 0.09 - len, z]), metal, { shade: 0.1, mat: M.metal }]);
  }
  // the wind catcher: a small wooden leaf on a thread
  parts.push([place(cyl(0.002, 0.002, 0.34, 3), [hang[0], hang[1] - 0.37, hang[2]]), MAT.rope]);
  parts.push([place(blob(0.04, 1, 3, 0.05, 0.3), [hang[0], hang[1] - 0.42, hang[2]], [Math.PI / 2, 0, 0], [1, 1.5, 1]), MAT.woodLight, { smooth: true, mat: M.plank }]);
  return parts;
}

/** A chime hanging from a tree's low branch: the bough from the trunk, the cord, the tubes. */
export function branchChime(trunk: [number, number, number], hang: [number, number, number]): BufferGeometry {
  const dx = hang[0] - trunk[0];
  const dz = hang[2] - trunk[2];
  const len = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);
  const lift = 0.22;
  const parts: Part[] = [];
  // a bough leaving the trunk and rising a little, thinning toward the tip
  const n = 5;
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const y0 = trunk[1] + lift * Math.sin(t0 * Math.PI * 0.5);
    const y1 = trunk[1] + lift * Math.sin(t1 * Math.PI * 0.5);
    const seg = Math.hypot((t1 - t0) * len, y1 - y0);
    const pitch = Math.atan2(y1 - y0, (t1 - t0) * len);
    const g = cyl(0.055 - i * 0.008, 0.06 - i * 0.008, seg + 0.01, 7);
    g.rotateX(Math.PI / 2 - pitch);
    g.rotateY(yaw);
    g.translate(trunk[0] + dx * t0, y0, trunk[2] + dz * t0);
    parts.push([g, MAT.woodDark, { mat: M.bark }]);
  }
  parts.push([place(blob(0.16, 1, 31, 0.2, 0.7), [trunk[0] + dx * 0.75, trunk[1] + lift + 0.08, trunk[2] + dz * 0.75]), MAT.leaf, { smooth: true, mat: M.leaf }]);
  const top = trunk[1] + lift;
  const cord = top - hang[1];
  parts.push([place(cyl(0.004, 0.004, cord, 3), [hang[0], hang[1], hang[2]]), MAT.rope]);
  parts.push([place(cyl(0.085, 0.085, 0.03, 12), [hang[0], hang[1] - 0.03, hang[2]]), MAT.woodLight, { mat: M.plank }]);
  parts.push(...chimeTubes(hang));
  return build(parts);
}

const BUILDERS: Record<string, (seed: number) => Part[]> = {
  'star-lamp': () => [
    [cyl(0.035, 0.05, 1.1, 6), MAT.woodDark],
    [place(cyl(0.12, 0.14, 0.06, 8), [0, 0, 0]), MAT.stoneDark],
    [place(hull(star(0.17, 0.08, 0.06)), [0, 1.2, 0]), '#ffd66b', GLOW],
    [place(cbox(0.3, 0.03, 0.03, 0.01), [0, 1.08, 0]), MAT.brass],
  ],
  'flower-pot': (s) => {
    const r = rng(s);
    const parts: Part[] = [
      [lathe([[0.0, 0], [0.13, 0], [0.17, 0.22], [0.2, 0.24], [0.2, 0.28], [0.0, 0.28]], 10), MAT.terracotta],
      [place(cyl(0.17, 0.17, 0.02, 10), [0, 0.26, 0]), MAT.soil, { shade: 0 }],
      [place(blob(0.16, 1, s, 0.2, 0.8), [0, 0.38, 0]), MAT.leaf],
    ];
    const petals = ['#f06a6a', '#f7d046', '#f4f0e8', '#f39b5a'];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + r();
      parts.push(...flowerHead(Math.cos(a) * 0.12, 0.46 + r() * 0.06, Math.sin(a) * 0.12, petals[i % petals.length]));
    }
    return parts;
  },
  'fruit-basket': (s) => {
    const r = rng(s);
    const parts: Part[] = [
      [lathe([[0, 0], [0.2, 0], [0.27, 0.16], [0.28, 0.18], [0, 0.18]], 10), MAT.straw],
      [place(cbox(0.03, 0.22, 0.03, 0.01), [0, 0.18, 0], [0, 0, 0]), MAT.woodLight],
    ];
    const fruit = ['#e2513b', '#f29b38', '#9ccc46', '#e2513b', '#f2c53d', '#c23b5a'];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const rr = i === 6 ? 0 : 0.14;
      parts.push([place(ball(0.075, 7, 5), [Math.cos(a) * rr, 0.2 + (i === 6 ? 0.06 : 0) + r() * 0.02, Math.sin(a) * rr]), fruit[i % fruit.length], { shade: 0.3 }]);
    }
    return parts;
  },
  telescope: () => [
    ...tripod(0.9, MAT.woodDark),
    [place(cyl(0.07, 0.1, 0.9, 10), [0, 0.95, 0], [-0.9, 0, 0]), MAT.brass],
    [place(cyl(0.11, 0.11, 0.08, 10), [0, 1.33, -0.33], [-0.9, 0, 0]), MAT.woodDark],
    [place(cyl(0.05, 0.05, 0.12, 8), [0, 0.92, 0.36], [-0.9, 0, 0]), MAT.iron],
  ],
  'fishing-rod': () => [
    [place(cyl(0.012, 0.025, 1.9, 5), [0, 0, 0], [0.25, 0, 0]), MAT.woodLight],
    [place(cyl(0.004, 0.004, 1.2, 3), [0, 0.6, 0.47]), '#e9e2d0'],
    [place(cyl(0.05, 0.05, 0.05, 8), [0, 0.3, 0.07], [0, 0, Math.PI / 2]), MAT.iron],
    [place(ball(0.035, 6, 4), [0, 0.58, 0.47]), MAT.red, { shade: 0 }],
    [place(cyl(0.16, 0.13, 0.22, 10), [0.25, 0, 0.1]), MAT.wood],
    [place(cyl(0.15, 0.15, 0.01, 10), [0.25, 0.18, 0.1]), MAT.sea, { shade: 0 }],
  ],
  beehive: () => [
    [cbox(0.5, 0.25, 0.5, 0.03), MAT.woodDark],
    [lathe([[0, 0], [0.24, 0], [0.27, 0.12], [0.26, 0.26], [0.22, 0.4], [0.14, 0.5], [0.04, 0.55], [0, 0.56]], 10), MAT.straw, { shade: 0.3 }],
    ...[0.1, 0.22, 0.34, 0.45].map((y, i): Part => [place(cyl(0.27 - i * 0.03, 0.27 - i * 0.03, 0.025, 12), [0, 0.25 + y, 0]), '#b88c3a']),
    [place(cbox(0.1, 0.07, 0.04, 0.01), [0, 0.32, 0.24]), '#3d2a1c', { shade: 0 }],
  ],
  easel: () => [
    [place(cbox(0.05, 1.6, 0.05, 0.01), [-0.3, 0, 0.12], [0, 0, -0.12]), MAT.wood],
    [place(cbox(0.05, 1.6, 0.05, 0.01), [0.3, 0, 0.12], [0, 0, 0.12]), MAT.wood],
    [place(cbox(0.05, 1.5, 0.05, 0.01), [0, 0, -0.35], [0.28, 0, 0]), MAT.wood],
    [place(cbox(0.7, 0.05, 0.1, 0.01), [0, 0.6, 0.12]), MAT.woodDark],
    [place(cbox(0.66, 0.5, 0.04, 0.01), [0, 0.65, 0.12], [-0.08, 0, 0]), MAT.cream, { shade: 0 }],
    [place(cbox(0.3, 0.2, 0.01, 0.005), [-0.1, 0.8, 0.15], [-0.08, 0, 0]), '#6aa6d6', { shade: 0 }],
    [place(cbox(0.22, 0.14, 0.01, 0.005), [0.12, 0.72, 0.15], [-0.08, 0, 0]), '#f2a65a', { shade: 0 }],
    [place(cbox(0.4, 0.06, 0.01, 0.005), [0, 0.68, 0.152], [-0.08, 0, 0]), '#6db35a', { shade: 0 }],
  ],
  teapot: () => [
    [lathe([[0, 0], [0.09, 0], [0.12, 0.05], [0.12, 0.11], [0.09, 0.16], [0.05, 0.17], [0, 0.17]], 10), '#4f8f8b'],
    [place(cyl(0.04, 0.05, 0.03, 8), [0, 0.165, 0]), '#3f7471'],
    [place(ball(0.018, 5, 4), [0, 0.2, 0]), MAT.brass],
    [place(cyl(0.015, 0.03, 0.12, 6), [0.13, 0.07, 0], [0, 0, -0.9]), '#4f8f8b'],
    [place(cbox(0.02, 0.1, 0.02, 0.005), [-0.13, 0.05, 0], [0, 0, 0.3]), '#3f7471'],
  ],
  map: () => [
    ...tripod(1.0, MAT.woodDark),
    [place(cbox(0.8, 0.6, 0.04, 0.01), [0, 0.75, 0.05], [-0.25, 0, 0]), MAT.woodDark],
    [place(cbox(0.74, 0.54, 0.02, 0.005), [0, 0.78, 0.08], [-0.25, 0, 0]), MAT.paper, { shade: 0 }],
    [place(cbox(0.25, 0.18, 0.005, 0.002), [-0.12, 0.92, 0.07], [-0.25, 0, 0]), '#8fbf7a', { shade: 0 }],
    [place(cbox(0.2, 0.22, 0.005, 0.002), [0.15, 0.85, 0.05], [-0.25, 0, 0]), '#8fbf7a', { shade: 0 }],
    [place(cbox(0.3, 0.1, 0.005, 0.002), [0.05, 1.05, 0.0], [-0.25, 0, 0]), '#7fb7d4', { shade: 0 }],
    [place(cyl(0.04, 0.04, 0.82, 8), [0.41, 1.1, 0.0], [0, 0, Math.PI / 2]), MAT.paper],
  ],
  bell: () => [
    [place(cbox(0.08, 1.6, 0.08, 0.02), [-0.4, 0, 0]), MAT.woodDark],
    [place(cbox(0.08, 1.6, 0.08, 0.02), [0.4, 0, 0]), MAT.woodDark],
    [place(cbox(1.0, 0.1, 0.12, 0.02), [0, 1.55, 0]), MAT.wood],
    [place(gableRoof(1.1, 0.5, 0.25), [0, 1.65, 0]), MAT.red],
    [place(lathe([[0, 0], [0.24, 0], [0.22, 0.04], [0.16, 0.12], [0.14, 0.3], [0.1, 0.36], [0, 0.38]], 12), [0, 1.08, 0]), MAT.brass, { shade: 0.35 }],
    [place(ball(0.05, 6, 4), [0, 1.04, 0]), MAT.iron],
    [place(cyl(0.006, 0.006, 0.8, 3), [0.1, 0.4, 0.06]), MAT.rope],
  ],
  kite: () => [
    [place(cbox(0.03, 1.2, 0.03, 0.01), [0, 0, 0], [0.15, 0, 0]), MAT.woodLight],
    [place(hull([[0, 0.42, 0], [0.32, 0, 0], [0, -0.62, 0], [-0.32, 0, 0], [0, 0, 0.03]]), [0, 1.2, 0.2], [0.35, 0, 0.15]), '#e8603c', { shade: 0 }],
    [place(hull([[0, 0.42, 0.031], [0.32, 0, 0.031], [0, 0, 0.06], [0, 0, 0.031]]), [0, 1.2, 0.2], [0.35, 0, 0.15]), '#f6c64b', { shade: 0 }],
    ...[0, 1, 2, 3].map((i): Part => [place(cbox(0.08, 0.05, 0.01, 0.005), [0.04 * i, 0.55 - i * 0.14, 0.35 + i * 0.02], [0, 0, 0.6 * (i % 2 ? 1 : -1)]), i % 2 ? '#6ab0d8' : '#e8603c', { shade: 0 }]),
  ],
  shell: () => {
    const parts: Part[] = [];
    for (let i = 0; i < 7; i++) {
      const a = -0.9 + i * 0.3;
      parts.push([place(cbox(0.06, 0.03, 0.26, 0.01), [Math.sin(a) * 0.09, 0, Math.cos(a) * 0.09 - 0.08], [-0.25, a, 0]), i % 2 ? '#f3c7b0' : '#f7dccb']);
    }
    parts.push([place(cbox(0.08, 0.06, 0.06, 0.015), [0, 0, -0.12]), '#e8a98f']);
    return parts;
  },
  'wind-chime': () => [...chimeCane().parts, ...chimeTubes(chimeCane().hang)],
  mailbox: () => [
    [cbox(0.08, 1.0, 0.08, 0.02), MAT.woodDark],
    [place(cbox(0.3, 0.22, 0.42, 0.03), [0, 0.98, 0]), MAT.red],
    [place(cyl(0.15, 0.15, 0.42, 10, false), [0, 1.18, -0.21], [Math.PI / 2, 0, 0], [1, 1, 1]), MAT.red],
    [place(cbox(0.03, 0.18, 0.03, 0.01), [0.17, 1.1, 0.1]), MAT.brass],
    [place(cbox(0.06, 0.1, 0.01, 0.005), [0.17, 1.24, 0.1]), MAT.brass],
  ],
  'bread-oven': () => [
    [cbox(1.3, 0.5, 1.2, 0.05), MAT.stone],
    [place(dome(0.6, 10, 4), [0, 0.5, 0], [0, 0, 0], [1, 0.8, 1]), MAT.terracotta, {}],
    [place(cbox(0.36, 0.3, 0.1, 0.02), [0, 0.55, 0.55]), '#2b1d16', { shade: 0 }],
    [place(cbox(0.3, 0.24, 0.12, 0.02), [0, 0.57, 0.56]), '#ff9a3d', { glow: true, shade: 0 }],
    [place(cyl(0.09, 0.11, 0.4, 6), [0.2, 0.85, -0.25]), MAT.stoneDark],
  ],
  anvil: () => [
    [cbox(0.3, 0.32, 0.3, 0.03), MAT.woodDark],
    [place(cbox(0.2, 0.12, 0.16, 0.02), [0, 0.32, 0]), MAT.iron],
    [place(cbox(0.42, 0.12, 0.2, 0.03), [0.04, 0.44, 0]), MAT.iron],
    [place(cone(0.08, 0.2, 6), [0.32, 0.5, 0], [0, 0, -Math.PI / 2]), MAT.iron],
  ],
  gear: () => [
    [place(cbox(0.3, 0.12, 0.2, 0.02), [0, 0, 0]), MAT.woodDark],
    ...gear(0.3, 0.06, 9).map((g): Part => [place(g, [0, 0.42, 0]), MAT.brass, { shade: 0.1 }]),
  ],
  'tea-table': () => [
    [cbox(1.0, 0.08, 0.7, 0.02), MAT.woodDark],
    ...[[-0.42, -0.27], [0.42, -0.27], [-0.42, 0.27], [0.42, 0.27]].map(([x, z]): Part => [place(cbox(0.06, 0.3, 0.06, 0.01), [x, 0.08, z]), MAT.woodDark]),
    [place(cbox(1.1, 0.06, 0.8, 0.02), [0, 0.38, 0]), MAT.wood],
    [place(lathe([[0, 0], [0.09, 0], [0.12, 0.05], [0.12, 0.11], [0.09, 0.16], [0, 0.17]], 10), [0.15, 0.44, 0]), '#4f8f8b'],
    [place(cyl(0.04, 0.035, 0.06, 8), [-0.15, 0.44, 0.1]), MAT.cream],
    [place(cyl(0.04, 0.035, 0.06, 8), [-0.25, 0.44, -0.1]), MAT.cream],
    [place(cbox(0.6, 0.06, 0.5, 0.02), [0, 0.0, 0.7]), '#c75b4a'],
  ],
  drum: () => [
    [cyl(0.25, 0.25, 0.4, 12), MAT.red],
    [place(cyl(0.26, 0.26, 0.04, 12), [0, 0.38, 0]), MAT.cream, { shade: 0 }],
    [place(cyl(0.26, 0.26, 0.04, 12), [0, 0, 0]), MAT.woodDark],
    [place(cyl(0.012, 0.012, 0.35, 4), [0.12, 0.42, 0], [0, 0, 1.2]), MAT.woodLight],
  ],
  globe: () => [
    [cyl(0.14, 0.18, 0.06, 8), MAT.woodDark],
    [place(cyl(0.025, 0.025, 0.25, 6), [0, 0.06, 0]), MAT.brass],
    [place(ball(0.17, 12, 8), [0, 0.42, 0]), '#5aa1c9', { shade: 0 }],
    [place(blob(0.08, 0, 4, 0.2), [0.08, 0.48, 0.1]), '#83b85f', { shade: 0 }],
    [place(blob(0.07, 0, 5, 0.2), [-0.1, 0.36, 0.08]), '#83b85f', { shade: 0 }],
  ],
  'honey-jar': () => [
    [lathe([[0, 0], [0.08, 0], [0.09, 0.03], [0.09, 0.13], [0.06, 0.16], [0, 0.16]], 10), MAT.honey, { shade: 0.1 }],
    [place(cyl(0.065, 0.065, 0.04, 10), [0, 0.15, 0]), MAT.cloth],
    [place(cyl(0.01, 0.01, 0.15, 4), [0.04, 0.18, 0], [0, 0, 0.5]), MAT.woodLight],
  ],
  net: () => [
    [place(cbox(0.08, 1.5, 0.08, 0.02), [-0.6, 0, 0]), MAT.woodDark],
    [place(cbox(0.08, 1.5, 0.08, 0.02), [0.6, 0, 0]), MAT.woodDark],
    [place(cbox(1.3, 0.06, 0.06, 0.02), [0, 1.42, 0]), MAT.wood],
    [place(hull([[-0.58, 1.4, 0], [0.58, 1.4, 0], [0.5, 0.5, 0.08], [-0.5, 0.45, 0.08], [0, 0.35, 0.12], [0, 1.4, 0.03]]), [0, 0, 0]), '#7a6f5a', { shade: 0.2 }],
    [place(ball(0.06, 6, 4), [0.3, 0.7, 0.12]), '#f0a35a', { shade: 0 }],
    [place(ball(0.06, 6, 4), [-0.25, 0.9, 0.1]), '#f0a35a', { shade: 0 }],
  ],
  bush: (s) => [
    [place(blob(0.55, 2, s, 0.16, 0.75), [0, 0.35, 0]), MAT.leaf, { shade: 0.4, smooth: true }],
    [place(blob(0.4, 2, s + 1, 0.16, 0.8), [0.4, 0.3, 0.15]), MAT.leafLight, { shade: 0.4, smooth: true }],
    [place(blob(0.34, 2, s + 2, 0.16, 0.8), [-0.38, 0.24, 0.1]), MAT.leafDark, { shade: 0.4, smooth: true }],
    [place(blob(0.3, 1, s + 3, 0.16, 0.8), [0.05, 0.58, -0.2]), MAT.leafLight, { shade: 0.3, smooth: true }],
  ],
  'flower-bed': (s) => {
    const r = rng(s);
    const parts: Part[] = [
      [cbox(1.2, 0.18, 0.6, 0.04), MAT.woodDark],
      [place(cbox(1.1, 0.04, 0.5, 0.02), [0, 0.16, 0]), MAT.soil, { shade: 0 }],
    ];
    const petals = ['#f06a6a', '#f7d046', '#f4f0e8', '#f39b5a', '#e86a9a'];
    for (let i = 0; i < 9; i++) {
      const x = -0.45 + (i % 5) * 0.22 + r() * 0.05;
      const z = i < 5 ? -0.1 : 0.12;
      parts.push([place(cyl(0.01, 0.01, 0.2, 3), [x, 0.18, z]), MAT.leafDark]);
      parts.push([place(blob(0.07, 0, i + s, 0.2), [x, 0.26, z]), MAT.leaf]);
      parts.push(...flowerHead(x, 0.36, z, petals[i % petals.length], 0.06));
    }
    return parts;
  },
  sunflower: (s) => {
    const r = rng(s);
    const parts: Part[] = [];
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.22 + r() * 0.05;
      const h = 1.0 + r() * 0.35;
      parts.push([place(cyl(0.018, 0.024, h, 5), [x, 0, 0]), MAT.leafDark]);
      parts.push([place(cbox(0.16, 0.02, 0.08, 0.01), [x + 0.06, h * 0.5, 0], [0, 0, -0.4]), MAT.leaf]);
      parts.push([place(cyl(0.16, 0.16, 0.03, 10), [x, h, 0.02], [1.35, 0, 0]), '#f6c330', { shade: 0 }]);
      parts.push([place(cyl(0.08, 0.08, 0.04, 8), [x, h + 0.01, 0.05], [1.35, 0, 0]), '#6b4524', { shade: 0 }]);
    }
    return parts;
  },
  scarecrow: () => [
    [cbox(0.06, 1.5, 0.06, 0.015), MAT.woodDark],
    [place(cbox(0.9, 0.06, 0.06, 0.015), [0, 1.1, 0]), MAT.woodDark],
    [place(hull([[-0.22, 0.75, -0.1], [0.22, 0.75, -0.1], [-0.22, 0.75, 0.1], [0.22, 0.75, 0.1], [-0.2, 1.25, -0.1], [0.2, 1.25, -0.1], [-0.2, 1.25, 0.1], [0.2, 1.25, 0.1]]), [0, 0, 0]), '#5a7fb0'],
    [place(ball(0.14, 8, 6), [0, 1.42, 0]), MAT.cloth],
    [place(cone(0.26, 0.22, 10), [0, 1.5, 0]), MAT.straw],
    [place(cbox(0.2, 0.1, 0.1, 0.02), [-0.42, 1.06, 0]), MAT.straw],
    [place(cbox(0.2, 0.1, 0.1, 0.02), [0.42, 1.06, 0]), MAT.straw],
  ],
  signpost: () => [
    [cbox(0.08, 1.5, 0.08, 0.02), MAT.woodDark],
    [place(cbox(0.6, 0.16, 0.04, 0.02), [0.2, 1.22, 0], [0, 0, 0.05]), MAT.woodLight],
    [place(cbox(0.55, 0.15, 0.04, 0.02), [-0.18, 0.98, 0.0], [0, 0.6, -0.05]), MAT.woodLight],
  ],
  'stone-lamp': () => [
    [cbox(0.3, 0.12, 0.3, 0.03), MAT.stoneDark],
    [place(cyl(0.07, 0.09, 0.4, 6), [0, 0.12, 0]), MAT.stone],
    [place(cbox(0.28, 0.2, 0.28, 0.02), [0, 0.52, 0]), MAT.stone],
    [place(cbox(0.2, 0.14, 0.3, 0.01), [0, 0.55, 0]), '#ffcf7a', GLOW],
    [place(hull([[-0.24, 0, -0.24], [0.24, 0, -0.24], [-0.24, 0, 0.24], [0.24, 0, 0.24], [0, 0.18, 0]]), [0, 0.72, 0]), MAT.stoneDark],
  ],
  crystal: () => [
    [place(blob(0.16, 0, 3, 0.25, 0.6), [0, 0.06, 0]), MAT.stoneDark],
    [place(hull([[0, 0.5, 0], [0.08, 0.1, 0.05], [-0.07, 0.1, 0.06], [0.0, 0.1, -0.08], [0, 0.05, 0]]), [0, 0, 0]), '#8fe0e0', GLOW],
    [place(hull([[0.1, 0.32, 0.05], [0.14, 0.06, 0.02], [0.06, 0.06, 0.1], [0.16, 0.06, 0.1]]), [0, 0, 0]), '#a8e8d8', GLOW],
  ],
};

function star(r: number, inner: number, t: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const rr = i % 2 ? inner : r;
    pts.push([Math.cos(a) * rr, Math.sin(a) * rr, t / 2], [Math.cos(a) * rr, Math.sin(a) * rr, -t / 2]);
  }
  // A star is not convex; the hull of its points makes a rounded pentagon, which reads as a
  // soft star lamp at this size.
  return pts;
}

function tripod(h: number, color: Hex): Part[] {
  return [0, 1, 2].map((i): Part => {
    const a = (i / 3) * Math.PI * 2;
    return [place(cbox(0.04, h, 0.04, 0.01), [Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22], [-Math.sin(a) * 0.22, 0, Math.cos(a) * 0.22]), color];
  });
}

function gableRoof(w: number, d: number, h: number): BufferGeometry {
  return hull([
    [-w / 2, 0, -d / 2], [-w / 2, 0, d / 2], [-w / 2, h, 0],
    [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [w / 2, h, 0],
  ]);
}

/**
 * A rounded boulder with a mossy top: smooth normals, flattened base, warm grey stone,
 * moss where the surface faces up. Size is the radius in metres.
 */
export function mossyRock(size: number, seed: number, moss = 0.75): BufferGeometry {
  const r = rng(seed);
  const g = blob(1, 2, seed, 0.22, 0.55 + r() * 0.25);
  const pos = g.getAttribute('position');
  // stretch a little and sink the bottom so it sits in the ground
  const sx = 0.8 + r() * 0.5;
  const sz = 0.8 + r() * 0.4;
  for (let i = 0; i < pos.count; i++) {
    let y = pos.getY(i);
    if (y < -0.15) y = -0.15 + (y + 0.15) * 0.3;
    pos.setXYZ(i, pos.getX(i) * sx * size, (y + 0.15) * size, pos.getZ(i) * sz * size);
  }
  const geo = paint(g, '#a69c8e', { mat: M.rock, shade: 0.3 }, true);
  const nor = geo.getAttribute('normal');
  const col = geo.getAttribute('color');
  const stone = new Color(r() < 0.5 ? '#a69c8e' : '#9a9184');
  const mossC = new Color(r() < 0.5 ? '#6f9a3e' : '#7fa548');
  const c = new Color();
  for (let i = 0; i < col.count; i++) {
    const ny = nor.getY(i);
    const k = Math.max(0, Math.min(1, (ny - 0.35) / 0.4)) * moss;
    const y = geo.getAttribute('position').getY(i) / size;
    c.copy(stone).multiplyScalar(0.7 + 0.3 * Math.min(1, y * 1.5 + 0.2)).lerp(mossC, k);
    col.setXYZW(i, c.r, c.g, c.b, surfaceAlpha(k > 0.5 ? M.grass : M.rock));
  }
  return geo;
}

/** Builds a procedural prop by id (catalog source `proc`), or null if unknown. */
export function buildProp(id: string, seed = 1): BufferGeometry | null {
  const fn = BUILDERS[id];
  if (!fn) return null;
  return build(fn(seed));
}

export const PROC_PROPS = Object.keys(BUILDERS);
