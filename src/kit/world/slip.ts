/**
 * The rejection slip (Grabbable). In the tray it is a slip 7.5 × 5 cm: on its face a
 * vermilion stamp ring and the short reason in two lines of up to 9 characters (DESIGN
 * "Причины отбраковки"). Taken and lifted it opens into a sheet 18 × 16 cm: `setOpen(k)`
 * unfolds it from quarters (bottom half first, then the right half); the open face has
 * room for the SlipSheet panel of 01.3 at `sheet`. Large text grows the sheet down to
 * 18 × 22 cm.
 *
 * Marks: the first stamp (always there), a second stamp ("Dropped"), a moss check
 * ("Fixed on a second look"), a punched hole (planted by code or the person's own test)
 * and an amber corner (corrected by code).
 *
 * Local frame: the open sheet lies flat face up (+y), x across, z down the page (+z is
 * the bottom edge, toward the person); origin at the centre of the open sheet.
 */
import { Object3D, type BufferGeometry } from '@iwsdk/core';
import type { CheckedItem, RejectReason } from '../../agents/types';
import { COLOR, MOTION, PANEL } from '../../tokens/tokens';
import { bevelBox, box, cylinder, flatRing, merge, placed, slab } from './geom';
import { makeGrabbable } from './grabbable';
import { createLabel } from './label';
import { part } from './materials';
import { animate, clamp01, easeInOut, lerp, lessMotion, now, progress } from './time';
import type { Slip, SlipMark } from './types';
import { Shape } from '@iwsdk/core';

/** Slip captions of DESIGN "Причины отбраковки": two lines of up to 9 characters. */
export const SLIP_CAPTION: Partial<Record<RejectReason, [string, string]>> = {
  'quote-not-found': ['Quote not', 'found'],
  'quote-altered': ['Quote', 'altered'],
  'quote-too-short': ['Quote too', 'short'],
  'date-mismatch': ['Wrong', 'date'],
  'weekday-mismatch': ['Wrong', 'weekday'],
  'date-out-of-range': ['Out of', 'range'],
  'unknown-actor': ['Unknown', 'person'],
  'unknown-guest': ['Not on', 'the list'],
  'wish-source-not-found': ['Source', 'not found'],
  'tag-fragment-not-found': ['Not in', 'essay'],
  'tag-type-unknown': ['Unknown', 'mark'],
};

/** True when a reason puts a slip into the tray (the others are fixed or merged by code). */
export function makesSlip(reason: RejectReason | undefined): boolean {
  return reason !== undefined && reason in SLIP_CAPTION;
}

const OPEN = { w: 0.18, h: 0.16, hLarge: 0.22 };
const FOLDED = { w: 0.075, d: 0.05 };
const T = 0.0005;

function markGeometry(mark: SlipMark, size: number): { g: BufferGeometry; key: 'vermilion' | 'moss' | 'slate' | 'amber' } {
  switch (mark) {
    case 'stamp':
      return { g: flatRing(size * 0.42, size * 0.05, 32), key: 'vermilion' };
    case 'second-stamp':
      return { g: merge([flatRing(size * 0.42, size * 0.05, 32), placed(box(size * 0.84, T, size * 0.1), [0, 0, 0], [0, 0.5, 0])]), key: 'vermilion' };
    case 'check':
      return {
        g: merge([placed(box(size * 0.38, T, size * 0.1), [-size * 0.16, 0, size * 0.08], [0, -0.8, 0]), placed(box(size * 0.7, T, size * 0.1), [size * 0.12, 0, -size * 0.02], [0, 0.85, 0])]),
        key: 'moss',
      };
    case 'hole':
      return { g: merge([cylinder(size * 0.16, size * 0.16, T * 1.2, 20), placed(flatRing(size * 0.18, size * 0.02, 20), [0, T, 0])]), key: 'slate' };
    case 'corner': {
      const s = new Shape();
      s.moveTo(0, 0);
      s.lineTo(size * 0.5, 0);
      s.lineTo(0, size * 0.5);
      s.lineTo(0, 0);
      return { g: slab(s, T), key: 'amber' };
    }
  }
}

export function createSlip(item: CheckedItem, opts: { caption?: [string, string] } = {}): Slip {
  const caption: [string, string] = opts.caption ?? SLIP_CAPTION[item.reason as RejectReason] ?? ['Sent', 'back'];
  const body = new Object3D();
  body.name = `slip:${item.id}:body`;
  const sheet = new Object3D();
  body.add(sheet);

  let large = false;
  const qw = OPEN.w / 2;
  const qh = (): number => (large ? OPEN.hLarge : OPEN.h) / 2;
  const panelGeo = bevelBox(qw - 0.0006, T, OPEN.h / 2 - 0.0006, 0.0002, 0.0015);
  const panelGeoLarge = bevelBox(qw - 0.0006, T, OPEN.hLarge / 2 - 0.0006, 0.0002, 0.0015);
  const panel = (name: string): ReturnType<typeof part> => part(panelGeo, 'paper', `slip:${name}`);
  // Top-left stays; top-right on hinge V1 (x = 0); bottom half on hinge H (z = 0) with
  // bottom-left and bottom-right on V2.
  const tl = panel('tl');
  const v1 = new Object3D();
  const tr = panel('tr');
  v1.add(tr);
  const h = new Object3D();
  const bl = panel('bl');
  const v2 = new Object3D();
  const br = panel('br');
  v2.add(br);
  h.add(bl, v2);
  sheet.add(tl, v1, h);

  // The face of the folded slip lives on the back of the bottom-left quarter: it comes
  // up when the bottom half folds over.
  const cover = new Object3D();
  cover.rotation.x = Math.PI;
  bl.add(cover);
  const coverSpec = PANEL.traySlip;
  // Two lines of up to 9 characters across the slip, under the stamp ring in the corner.
  const label = createLabel(`${caption[0]}
${caption[1]}`, { role: 'label', width: FOLDED.w - 0.008, eyeDist: coverSpec.eyeDist, lines: 2, color: COLOR.vermilionText, weight: 700 });
  label.rotation.x = -Math.PI / 2;
  label.position.set(0, 0.0006, FOLDED.d / 2 - 0.003 - label.scale.y / 2);
  cover.add(label);
  const face = new Object3D();
  tl.add(face);

  const marks = new Set<SlipMark>(['stamp']);
  const markMeshes = new Map<SlipMark, Object3D[]>();
  const placeMark = (mark: SlipMark): void => {
    if (markMeshes.has(mark)) return;
    const list: Object3D[] = [];
    // On the folded face (units of the folded slip) and on the open top-left quarter.
    for (const [parent, size, x, z] of [
      [cover, 0.015, -0.026, -0.015],
      [face, 0.024, -0.026, -0.022],
    ] as [Object3D, number, number, number][]) {
      const { g, key } = markGeometry(mark, size);
      const m = part(g, key, `slip:mark:${mark}`);
      let px: number = x;
      let pz: number = z;
      if (mark === 'second-stamp') {
        px += size * 0.25;
        pz += size * 0.2;
      } else if (mark === 'check') {
        px += size * 0.05;
        pz += size * 0.85;
      } else if (mark === 'hole') {
        px = -x * 1.05;
        pz = z;
      } else if (mark === 'corner') {
        px = parent === cover ? 0.0375 * 0.8 - size * 0.5 + 0.002 : qw / 2 - size * 0.5;
        pz = parent === cover ? -0.025 * 0.8 + 0.002 : -qh() / 2 + 0.001;
        m.rotation.y = -Math.PI / 2;
      }
      m.position.set(px, T + 0.0002 * (list.length + 1), pz);
      parent.add(m);
      list.push(m);
    }
    markMeshes.set(mark, list);
  };
  placeMark('stamp');

  const grab = makeGrabbable(`slip:${item.id}`, body, [FOLDED.w, 0.016, FOLDED.d], [0, 0.004, 0]);
  grab.handle.userData.target = `slip:${item.id}`;
  let openK = 0;
  let unfoldAt = -Infinity;
  let unfoldFrom = 0;
  let unfoldTo = 0;

  const layout = (k: number): void => {
    const half = qh();
    tl.geometry = br.geometry = bl.geometry = tr.geometry = large ? panelGeoLarge : panelGeo;
    tl.position.set(-qw / 2, 0, -half / 2);
    tr.position.set(qw / 2, 0, -half / 2);
    bl.position.set(-qw / 2, 0, half / 2);
    br.position.set(qw / 2, 0, half / 2);
    // Folded scale: the quarter (9 × 8) shrinks to the slip (7.5 × 5) at k = 0.
    const ks = clamp01(k / 0.18);
    const sx = lerp(FOLDED.w / qw, 1, ks);
    const sz = lerp(FOLDED.d / half, 1, ks);
    sheet.scale.set(sx, 1, sz);
    // The folded face keeps its own proportions while the sheet is scaled.
    cover.scale.set(1 / sx, 1, 1 / sz);
    cover.visible = k < 0.6;
    // Bottom half opens between 0.18 and 0.6, the right half between 0.6 and 1.
    const kh = easeInOut(clamp01((k - 0.18) / 0.42));
    const kv = easeInOut(clamp01((k - 0.6) / 0.4));
    h.rotation.x = -Math.PI * (1 - kh);
    h.position.y = 0.0012 * (1 - kh);
    v1.rotation.z = Math.PI * (1 - kv);
    v2.rotation.z = Math.PI * (1 - kv);
    v1.position.y = v2.position.y = 0.0006 * (1 - kv);
    // Folded: the stack sits centred where the slip lies, not at the quarter's corner.
    sheet.position.set((qw / 2) * sx * (1 - kv), 0, (half / 2) * sz * (1 - kh));
  };
  layout(0);

  const slip: Slip = {
    ...grab,
    root: grab.handle,
    item,
    caption,
    sheet: (() => {
      const anchor = new Object3D();
      anchor.name = `slip:${item.id}:sheet`;
      anchor.rotation.x = -Math.PI / 2;
      anchor.position.y = T + 0.001;
      sheet.add(anchor);
      return anchor;
    })(),
    get open() {
      return openK;
    },
    get marks() {
      return marks;
    },
    setOpen(k) {
      unfoldAt = -Infinity;
      openK = clamp01(k);
    },
    mark(mark) {
      marks.add(mark);
      placeMark(mark);
    },
    setLarge(on) {
      large = on;
    },
    unfold(on) {
      unfoldFrom = openK;
      unfoldTo = on ? 1 : 0;
      unfoldAt = now();
    },
    update(t) {
      if (unfoldAt > -Infinity) {
        const ms = lessMotion() ? 0 : unfoldTo > unfoldFrom ? MOTION.slip.openMs : MOTION.slip.closeMs;
        const k = progress(t, unfoldAt, ms);
        openK = lerp(unfoldFrom, unfoldTo, k);
        if (k >= 1) unfoldAt = -Infinity;
      }
      layout(openK);
    },
  };
  animate(slip);
  return slip;
}
