/**
 * The envelope: a paper envelope 18 × 12 cm that the hand takes (Grabbable). Its label
 * has two lines of up to 25 characters (`EnvelopeSpec.lines`), text role `label` at
 * 0.59 m; both lines stand along the near edge, the strip that shows out of
 * the slot of the inbox block. Kinds differ by one printed detail: `sample` plain, `files` a dashed
 * field for what the phone will send, `late` a square tab of new pages, `code` five boxes
 * for the code. States: resting, held (lifts to 1.04), open (the flap swings back and
 * three sheets fan out of the top).
 *
 * Local frame of the body: the envelope lies flat, front up, x across (18 cm), z in depth
 * (12 cm, the label edge at +z, toward the person), origin at the centre of its underside.
 */
import { Object3D, Shape } from '@iwsdk/core';
import type { EnvelopeSpec } from '../../agents/types';
import { COLOR, MOTION, PANEL } from '../../tokens/tokens';
import { bevelBox, box, merge, placed, slab, tint } from './geom';
import { makeGrabbable } from './grabbable';
import { createLabel } from './label';
import { part } from './materials';
import { animate, clamp01, easeBack, easeOut, lessMotion, now, progress } from './time';
import type { Envelope, EnvelopeState } from './types';

export const ENVELOPE = { w: 0.18, d: 0.12, h: 0.004 };
const OPEN_MS = 600;

let paperGeo: ReturnType<typeof bevelBox> | null = null;
let flapGeo: ReturnType<typeof merge> | null = null;
let sheetGeo: ReturnType<typeof bevelBox> | null = null;

function geometries(): { paper: ReturnType<typeof bevelBox>; flap: ReturnType<typeof merge>; sheet: ReturnType<typeof bevelBox> } {
  paperGeo ??= bevelBox(ENVELOPE.w, ENVELOPE.h, ENVELOPE.d, 0.001, 0.003);
  // The flap on the back: a shallow triangle of thin paper, hinge along z = 0, apex at +z.
  if (!flapGeo) {
    const shape = new Shape();
    shape.moveTo(-ENVELOPE.w / 2 + 0.002, 0);
    shape.lineTo(ENVELOPE.w / 2 - 0.002, 0);
    shape.lineTo(0, -0.075);
    shape.lineTo(-ENVELOPE.w / 2 + 0.002, 0);
    flapGeo = tint(slab(shape, 0.0008), COLOR.paper);
  }
  sheetGeo ??= bevelBox(0.16, 0.0012, 0.1, 0.0004, 0.002);
  return { paper: paperGeo, flap: flapGeo, sheet: sheetGeo };
}

export function createEnvelope(spec: EnvelopeSpec, opts: { large?: boolean } = {}): Envelope {
  const g = geometries();
  const body = new Object3D();
  body.name = `envelope:${spec.id}:body`;
  const paper = part(g.paper, 'paper', 'envelope:paper');
  body.add(paper);

  // Flap on the back, hinged at the top edge, lying under the envelope.
  const hinge = new Object3D();
  hinge.position.set(0, 0, -ENVELOPE.d / 2);
  const flap = part(g.flap, 'paperShade', 'envelope:flap');
  flap.position.y = -0.001; // under the envelope, pointing toward +z
  hinge.add(flap);
  body.add(hinge);

  // Three sheets inside; on opening they rise out of the top edge in a fan.
  const sheets: Object3D[] = [];
  for (let i = 0; i < 3; i++) {
    const s = part(g.sheet, 'paper', `envelope:sheet:${i}`);
    s.position.set(0, ENVELOPE.h / 2, 0);
    s.visible = false;
    body.add(s);
    sheets.push(s);
  }

  // The label lies along the near edge (+z), the strip that shows out of the inbox slot.
  const spec2 = PANEL.envelopeLabel;
  const label = createLabel(`${spec.lines[0]}\n${spec.lines[1]}`, {
    role: 'label',
    width: spec2.size.w,
    eyeDist: spec2.eyeDist,
    lines: opts.large ? 4 : 2,
    large: opts.large,
  });
  label.rotation.x = -Math.PI / 2;
  const labelH = label.scale.y;
  label.position.set(0, ENVELOPE.h + 0.0006, ENVELOPE.d / 2 - 0.004 - labelH / 2);
  body.add(label);
  // The first line in bold would change the metrics: both lines share the role and weight.

  // The printed detail of the kind.
  if (spec.kind === 'files') {
    const dashes = [];
    const fw = 0.12;
    const fd = 0.035;
    const z = -ENVELOPE.d / 2 + 0.014 + fd / 2;
    for (let i = 0; i < 12; i++) {
      const x = -fw / 2 + (i + 0.5) * (fw / 12);
      dashes.push(placed(box(fw / 24, 0.0004, 0.0012), [x, 0, z - fd / 2]), placed(box(fw / 24, 0.0004, 0.0012), [x, 0, z + fd / 2]));
    }
    for (let i = 0; i < 4; i++) {
      const zz = z - fd / 2 + (i + 0.5) * (fd / 4);
      dashes.push(placed(box(0.0012, 0.0004, fd / 8), [-fw / 2, 0, zz]), placed(box(0.0012, 0.0004, fd / 8), [fw / 2, 0, zz]));
    }
    const field = part(merge(dashes), 'cobalt', 'envelope:field');
    field.position.y = ENVELOPE.h;
    body.add(field);
  } else if (spec.kind === 'late') {
    const tab = part(bevelBox(0.026, 0.0012, 0.03, 0.0004, 0.002), 'bone', 'envelope:tab');
    tab.position.set(ENVELOPE.w / 2 - 0.03, ENVELOPE.h * 0.5, -ENVELOPE.d / 2 - 0.008);
    body.add(tab);
  } else if (spec.kind === 'code') {
    const boxes = [];
    for (let i = 0; i < 5; i++) boxes.push(placed(bevelBox(0.016, 0.0008, 0.02, 0.0003, 0.002), [-0.045 + i * 0.0225, 0, 0]));
    const row = part(merge(boxes), 'boneShade', 'envelope:boxes');
    row.position.set(-0.012, ENVELOPE.h, -ENVELOPE.d / 2 + 0.025);
    body.add(row);
  }

  const grab = makeGrabbable(`envelope:${spec.id}`, body, [ENVELOPE.w, 0.024, ENVELOPE.d], [0, 0.006, 0]);
  const root = grab.handle;
  root.userData.target = `envelope:${spec.id}`;

  let state: EnvelopeState = 'rest';
  let stateAt = -Infinity;
  let previous: EnvelopeState = 'rest';

  const env: Envelope = {
    ...grab,
    root,
    spec,
    get state() {
      return state;
    },
    setState(next) {
      if (next === state) return;
      previous = state;
      state = next;
      stateAt = now();
    },
    update(t) {
      const reduced = lessMotion();
      // Held: lifts to 1.04 with the spring's overshoot; back to 1 on release.
      const kHold = reduced ? (t >= stateAt ? 1 : 0) : progress(t, stateAt, MOTION.spring.resultMs);
      let s = 1;
      if (state === 'held') s = 1 + (MOTION.spring.lift - 1) * easeBack(kHold, MOTION.spring.overshoot);
      else if (previous === 'held') s = MOTION.spring.lift + (1 - MOTION.spring.lift) * easeOut(kHold);
      body.scale.setScalar(s);
      // Open: the flap swings over the top (0.3 s), then the sheets fan out (0.3 s).
      const kOpen = state === 'open' ? (reduced ? 1 : progress(t, stateAt, OPEN_MS)) : 0;
      const flapK = easeOut(clamp01(kOpen / 0.5));
      hinge.rotation.x = -Math.PI * 0.92 * flapK;
      const fanK = easeOut(clamp01((kOpen - 0.4) / 0.6));
      // The sheets slide out over the far edge and stand up in a fan, toward the cutter.
      sheets.forEach((sheet, i) => {
        sheet.visible = kOpen > 0.4;
        const spread = (i - 1) * 0.22 * fanK;
        sheet.position.set(spread * 0.05, ENVELOPE.h / 2 + 0.002 * i + 0.03 * fanK, -0.05 * fanK - 0.004 * i);
        sheet.rotation.set(-1.0 * fanK, spread, 0, 'YXZ');
      });
      label.visible = true;
    },
  };
  animate(env);
  return env;
}
