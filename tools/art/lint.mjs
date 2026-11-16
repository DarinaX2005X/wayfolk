// Checks the figures against the shape language of the library: a figure must look cut with scissors
// from one sheet and must be able to stand.
//
//   node tools/art/lint.mjs               the whole library, fails when one of the 60 is missing
//   node tools/art/lint.mjs sun moon      only these figures
//   node tools/art/lint.mjs --stats       adds a table of measurements
//
// Exit code 1 when a rule is broken.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  CUTOUT_DIR, GROUPS, PAPER_COLORS, SET_01, SET_02, allRings, bounds, distToRing, identOf, listCutoutIds, pairs,
  pointInRing, rayHit, readCutout, segmentsCross, signedArea,
} from './lib.mjs';

const RULE = {
  pointsMin: 12, // points per layer, holes count with their layer
  pointsMax: 60,
  detailsMax: 2,
  edgeMin: 3, // scissors do not make a shorter cut
  facetMin: 4, // facets of a curve, % of the figure height
  facetMax: 12,
  curveTurnMin: 4, // a vertex belongs to a curve when the outline turns by this many degrees…
  curveTurnMax: 55, // …a sharper turn is a corner
  thinMin: 3, // narrower paper tears
  gapMin: 3, // a narrower slit closes under the white cut edge
  spikeMinDeg: 18,
  baseShare: 0.3, // width of the base as a share of the figure width
  asymMin: 1.2, // the halves must differ at least by this much
  sizeMin: 18,
  sizeMax: 90,
};

const deg = (rad) => (rad * 180) / Math.PI;
const at = ([x, y]) => `(${Math.round(x * 10) / 10}, ${Math.round(y * 10) / 10})`;

function ringInfo(flat) {
  const p = pairs(flat);
  const n = p.length;
  const len = [];
  const turn = [];
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n], b = p[i], c = p[(i + 1) % n];
    len.push(Math.hypot(c[0] - b[0], c[1] - b[1]));
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    turn.push(deg(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)));
  }
  return { p, n, len, turn }; // len[i] is the edge i → i + 1, turn[i] the left turn at vertex i
}

function checkSimple(flat, label, errors) {
  const { p, n } = ringInfo(flat);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) {
        errors.push(`${label}: edges ${i} and ${j} cross`);
        return;
      }
    }
  }
}

function checkEdgesAndCurves(flat, label, errors) {
  const { p, n, len, turn } = ringInfo(flat);
  const onBase = (i) => p[i][1] <= 0.05 && p[(i + 1) % n][1] <= 0.05; // the straight cut of the base is not a facet
  for (let i = 0; i < n; i++) {
    if (len[i] < RULE.edgeMin - 0.05) errors.push(`${label}: edge from ${at(p[i])} is ${len[i].toFixed(1)}, shorter than ${RULE.edgeMin}`);
    if (turn[i] > 180 - RULE.spikeMinDeg) errors.push(`${label}: spike of ${(180 - turn[i]).toFixed(0)}° at ${at(p[i])}`);
  }
  const curved = (i) => Math.abs(turn[i]) >= RULE.curveTurnMin && Math.abs(turn[i]) <= RULE.curveTurnMax;
  // Walk the ring from a vertex that does not continue a run.
  let start = 0;
  while (start < n && curved(start) && curved((start + n - 1) % n) && Math.sign(turn[start]) === Math.sign(turn[(start + n - 1) % n])) start++;
  if (start === n) start = 0;
  let run = [];
  const closeRun = () => {
    if (run.length >= 3) {
      const facets = run.slice(0, -1).map((v) => len[v]);
      facets.forEach((l, k) => {
        if (onBase(run[k])) return;
        if (l < RULE.facetMin - 0.05 || l > RULE.facetMax + 0.05) {
          errors.push(`${label}: facet from ${at(p[run[k]])} of a curve is ${l.toFixed(1)}, allowed ${RULE.facetMin}…${RULE.facetMax}`);
        }
      });
      if (facets.length >= 5) {
        const turns = run.map((v) => Math.abs(turn[v]));
        const mean = facets.reduce((a, b) => a + b, 0) / facets.length;
        const even = (Math.max(...facets) - Math.min(...facets)) / mean < 0.08;
        const steady = Math.max(...turns) - Math.min(...turns) < 3;
        if (even && steady) errors.push(`${label}: the curve from ${at(p[run[0]])} to ${at(p[run.at(-1)])} is a ruler-perfect arc`);
      }
    }
    run = [];
  };
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    if (!curved(i)) {
      closeRun();
      continue;
    }
    if (run.length && Math.sign(turn[run.at(-1)]) !== Math.sign(turn[i])) closeRun();
    run.push(i);
  }
  closeRun();
}

// Narrowest paper and narrowest slit of one layer (outer ring with its holes).
function thickness(rings) {
  let thin = Infinity, gap = Infinity, thinAt = '', gapAt = '';
  rings.forEach((flat, ri) => {
    const { p, n, len } = ringInfo(flat);
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const dx = (b[0] - a[0]) / len[i], dy = (b[1] - a[1]) / len[i];
      const skip = new Set([`${ri}:${i}`, `${ri}:${(i + 1) % n}`, `${ri}:${(i + n - 1) % n}`]);
      const steps = Math.max(1, Math.round(len[i] / 1.5));
      for (let s = 0; s < steps; s++) {
        const t = ((s + 0.5) / steps) * len[i];
        const x = a[0] + dx * t, y = a[1] + dy * t;
        const inward = rayHit(x, y, -dy, dx, rings, skip); // the paper is on the left of every ring
        const outward = rayHit(x, y, dy, -dx, rings, skip);
        if (inward < thin) { thin = inward; thinAt = at([x, y]); }
        if (outward < gap) { gap = outward; gapAt = at([x, y]); }
      }
    }
  });
  return { thin, gap, thinAt, gapAt };
}

function baseOf(c) {
  const { p, n } = ringInfo(c.main);
  let left = Infinity, right = -Infinity, flat = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    if (a[1] <= 0.05 && b[1] <= 0.05) {
      left = Math.min(left, a[0], b[0]);
      right = Math.max(right, a[0], b[0]);
      flat += Math.abs(b[0] - a[0]);
    }
  }
  return { span: flat ? right - left : 0, flat };
}

function asymmetry(flat) {
  let worst = 0;
  for (const [x, y] of pairs(flat)) worst = Math.max(worst, distToRing(-x, y, flat));
  return worst;
}

function lintCutout(id) {
  const errors = [];
  let c;
  try {
    c = readCutout(id);
  } catch (err) {
    return { id, errors: [err.message], stats: null };
  }
  if (c.id !== id) errors.push(`id '${c.id}' differs from the file name`);
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id)) errors.push('id must be lower case words joined by hyphens');
  if (!c.comment.length || !c.comment[0].trim()) errors.push('the file must start with a comment that says what the figure is');
  if (typeof c.name !== 'string' || !/^[A-Z][A-Za-z ]+$/.test(c.name)) errors.push('name must be an English name with a capital');
  if (!GROUPS.includes(c.group)) errors.push(`unknown group '${c.group}'`);
  if (!Number.isInteger(c.defaultSize) || c.defaultSize < RULE.sizeMin || c.defaultSize > RULE.sizeMax) {
    errors.push(`defaultSize ${c.defaultSize} is outside ${RULE.sizeMin}…${RULE.sizeMax} mm`);
  }
  if (!PAPER_COLORS.includes(c.defaultPaper)) errors.push(`unknown defaultPaper '${c.defaultPaper}'`);
  if (!PAPER_COLORS.includes(c.defaultPaper2)) errors.push(`defaultPaper2 is missing or unknown: '${c.defaultPaper2}'`);
  if (c.defaultPaper2 === c.defaultPaper) errors.push('defaultPaper2 repeats defaultPaper');
  if (c.details.length > RULE.detailsMax) errors.push(`${c.details.length} detail layers, allowed ${RULE.detailsMax}`);

  const layers = [
    { label: 'main', rings: [c.main, ...c.holes] },
    ...c.details.map((d, i) => ({ label: `detail ${i + 1}`, rings: [d] })),
  ];
  for (const ring of allRings(c)) {
    if (!Array.isArray(ring) || ring.length % 2 || ring.some((v) => !Number.isFinite(v))) {
      return { id, errors: [...errors, 'a ring is not a flat list of x, y numbers'], stats: null };
    }
    if (ring.some((v) => Math.abs(v * 10 - Math.round(v * 10)) > 1e-6)) errors.push('coordinates must have one decimal (run fit.mjs)');
  }
  const b = bounds(allRings(c));
  if (b.minY !== 0 || b.maxY !== 100 || Math.abs(b.minX + b.maxX) > 0.11) {
    errors.push(`not normalised: y ${b.minY}…${b.maxY}, x ${b.minX}…${b.maxX} (run fit.mjs)`);
  }

  let thin = Infinity, gap = Infinity;
  for (const layer of layers) {
    const count = layer.rings.reduce((a, r) => a + r.length / 2, 0);
    if (count < RULE.pointsMin || count > RULE.pointsMax) {
      errors.push(`${layer.label}: ${count} points, allowed ${RULE.pointsMin}…${RULE.pointsMax}`);
    }
    layer.rings.forEach((ring, ri) => {
      const label = ri === 0 ? layer.label : `${layer.label} hole ${ri}`;
      if (ring.length < 6) {
        errors.push(`${label}: fewer than 3 points`);
        return;
      }
      const ccw = signedArea(ring) > 0;
      if (ccw !== (ri === 0)) errors.push(`${label}: wrong winding (run fit.mjs)`);
      checkSimple(ring, label, errors);
      checkEdgesAndCurves(ring, label, errors);
      if (ri > 0) {
        for (const [x, y] of pairs(ring)) {
          if (!pointInRing(x, y, layer.rings[0])) {
            errors.push(`${label}: lies outside its layer`);
            break;
          }
        }
      }
    });
    const t = thickness(layer.rings);
    if (t.thin < RULE.thinMin - 0.05) errors.push(`${layer.label}: paper is ${t.thin.toFixed(1)} wide at ${t.thinAt}, thinner than ${RULE.thinMin}`);
    if (t.gap < RULE.gapMin - 0.05) errors.push(`${layer.label}: slit is ${t.gap.toFixed(1)} wide at ${t.gapAt}, narrower than ${RULE.gapMin}`);
    thin = Math.min(thin, t.thin);
    gap = Math.min(gap, t.gap);
  }

  c.details.forEach((d, di) => {
    const { p, n } = ringInfo(d);
    for (let i = 0; i < n; i++) {
      const a = p[i], m = [(p[i][0] + p[(i + 1) % n][0]) / 2, (p[i][1] + p[(i + 1) % n][1]) / 2];
      for (const [x, y] of [a, m]) {
        const outside = !pointInRing(x, y, c.main) && distToRing(x, y, c.main) > 0.35;
        const inHole = c.holes.some((h) => pointInRing(x, y, h) && distToRing(x, y, h) > 0.35);
        if (outside || inHole) {
          errors.push(`detail ${di + 1}: sticks out of the main layer near ${at([x, y])}`);
          return;
        }
      }
    }
  });

  const base = baseOf(c);
  if (base.flat === 0) errors.push('no flat base: no edge lies on y = 0');
  else if (base.span < RULE.baseShare * b.w - 0.05) {
    errors.push(`base is ${base.span.toFixed(1)} wide, needs ${(RULE.baseShare * b.w).toFixed(1)} (30 % of the width ${b.w.toFixed(1)})`);
  }
  const asym = asymmetry(c.main);
  if (asym < RULE.asymMin) errors.push(`halves are mirror copies (largest difference ${asym.toFixed(1)}): looks ruled, not cut by hand`);

  return {
    id, errors,
    stats: {
      group: c.group, size: c.defaultSize, paper: `${c.defaultPaper}/${c.defaultPaper2}`,
      points: layers.map((l) => l.rings.reduce((a, r) => a + r.length / 2, 0)).join('+'),
      width: b.w.toFixed(0), base: `${Math.round((base.span / b.w) * 100)}%`, thin: thin.toFixed(1),
      gap: Number.isFinite(gap) ? gap.toFixed(1) : '-', asym: asym.toFixed(1),
    },
  };
}

const args = process.argv.slice(2);
const stats = args.includes('--stats');
const asked = args.filter((a) => !a.startsWith('--'));
const whole = asked.length === 0;
const ids = whole ? listCutoutIds() : asked;
const results = ids.map(lintCutout);
const problems = [];

if (whole) {
  const expected = [...SET_01, ...SET_02];
  const missing = expected.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !expected.includes(id));
  if (missing.length) problems.push(`not drawn yet (${missing.length}): ${missing.join(', ')}`);
  if (extra.length) problems.push(`not in the library list: ${extra.join(', ')}`);
  const names = new Map();
  for (const id of ids) {
    try {
      const { name } = readCutout(id);
      if (names.has(name)) problems.push(`name '${name}' is used by ${names.get(name)} and ${id}`);
      names.set(name, id);
    } catch {
      // reported per figure
    }
  }
  const listFile = path.join(CUTOUT_DIR, 'list.ts');
  if (!existsSync(listFile)) problems.push('src/content/cutouts/list.ts is missing');
  else {
    const text = readFileSync(listFile, 'utf8');
    for (const id of ids) {
      if (!new RegExp(`import \\{ ${identOf(id)} \\} from './${id}'`).test(text)) problems.push(`list.ts does not import ${id}`);
    }
  }
}

let failed = problems.length;
for (const r of results) {
  if (!r.errors.length) continue;
  failed += r.errors.length;
  console.log(`${r.id}`);
  for (const e of r.errors) console.log(`  ${e}`);
}
for (const p of problems) console.log(p);
if (stats) {
  console.table(Object.fromEntries(results.filter((r) => r.stats).map((r) => [r.id, r.stats])));
}
const clean = results.filter((r) => !r.errors.length).length;
console.log(`${clean} of ${results.length} figures pass${failed ? `, ${failed} problems` : ''}`);
process.exit(failed ? 1 : 0);
