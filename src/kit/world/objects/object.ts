/**
 * The object of a plot (DESIGN "Предметы проектов"), made from its ObjectSpec only: the
 * case stack, the cake, the stack of notebooks. States: growing (rises in 900 ms with a
 * settle), ready, selected (a cobalt ring of 4 mm on the tiles around it and four bone
 * buttons at its foot), stale. A flag on a pin says what is new by its shape: pages a
 * square, deadline a pennant, guest a circle, question an amber diamond; amber only for
 * the question and a review due in two days or less. A paper tag 6 × 9 cm of the work
 * sheet leans against its front.
 *
 * Origin at the centre of the base; +z faces the person (the island turns it so).
 */
import { Object3D, Shape, Vector3, type BufferGeometry, type Mesh } from '@iwsdk/core';
import type { ObjectSpec } from '../../../agents/types';
import { COLOR, MOTION } from '../../../tokens/tokens';
import { bevelBox, cylinder, flatRing, merge, placed, slab, tint, torusArc } from '../geom';
import { createLabel, measureLabel, setLabelText } from '../label';
import { part } from '../materials';
import { attachShadow, setShadowHeight } from '../shadow';
import { animate, easeBack, lessMotion, now, progress, clamp01 } from '../time';
import type { ObjectFlag, ObjectState, ProjectObject } from '../types';
import { caseStackGeometry, STACK } from './case-stack';
import { cakeGeometry } from './cake';
import { notebooksGeometry, NOTEBOOK } from './notebooks';

const GROW_MS = MOTION.bloom.growMs;
const RING_R = 0.2;

function footprint(spec: ObjectSpec): [number, number] {
  if (spec.kind === 'case-stack') return [STACK.w, STACK.d];
  if (spec.kind === 'notebooks') return [NOTEBOOK.w, NOTEBOOK.d];
  return [0.26, 0.26];
}

function flagShape(flag: ObjectFlag | 'stale'): BufferGeometry | null {
  const s = new Shape();
  switch (flag) {
    case 'pages':
      s.moveTo(0, 0);
      s.lineTo(0.034, 0);
      s.lineTo(0.034, 0.034);
      s.lineTo(0, 0.034);
      break;
    case 'deadline':
      s.moveTo(0, 0);
      s.lineTo(0.05, 0.016);
      s.lineTo(0, 0.032);
      break;
    case 'guest':
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const x = 0.018 + Math.cos(a) * 0.018;
        const y = 0.018 + Math.sin(a) * 0.018;
        if (i === 0) s.moveTo(x, y);
        else s.lineTo(x, y);
      }
      break;
    case 'question':
      s.moveTo(0.02, 0);
      s.lineTo(0.04, 0.02);
      s.lineTo(0.02, 0.04);
      s.lineTo(0, 0.02);
      break;
    case 'stale':
      return merge([torusArc(0.014, 0.0032, Math.PI * 1.55), placed(cylinder(0.0001, 0.0065, 0.009, 3), [0.014, 0.0, -0.002], [Math.PI / 2, 0, 0])]);
    default:
      return null;
  }
  const g = slab(s, 0.003);
  // Stand the flag up: the shape was laid in x–z, turn it into x–y.
  g.rotateX(Math.PI / 2);
  return g;
}

export function createObject(spec: ObjectSpec, opts: { seed?: number } = {}): ProjectObject {
  const root = new Object3D();
  root.name = `kit:object:${spec.kind}`;
  const body = new Object3D();
  root.add(body);
  let height = 0.1;
  let numberAt: { at: [number, number, number]; count: number } | null = null;
  let geometry: BufferGeometry;
  let key: 'vcMatte' | 'vcCeramic' = 'vcMatte';
  if (spec.kind === 'case-stack') {
    const r = caseStackGeometry(spec, opts.seed ?? 1);
    geometry = r.geometry;
    height = r.height;
    numberAt = r.numberTag;
  } else if (spec.kind === 'cake') {
    const r = cakeGeometry(spec);
    geometry = r.geometry;
    height = r.height;
    key = 'vcCeramic';
  } else {
    const r = notebooksGeometry(spec, opts.seed ?? 3);
    geometry = r.geometry;
    height = r.height;
    numberAt = r.numberClip;
  }
  const mesh: Mesh = part(geometry, key, `object:${spec.kind}`);
  body.add(mesh);
  if (numberAt) {
    const label = createLabel(String(numberAt.count), { role: 'label', width: 0.03, eyeDist: 1.7, weight: 700, lines: 1, align: 'center', color: COLOR.vermilionText });
    label.position.set(...numberAt.at);
    label.scale.multiplyScalar(0.55);
    body.add(label);
  }
  const [fw, fd] = footprint(spec);
  attachShadow(body, { height, size: [fw, fd], rest: 0 });

  // The paper tag of the work sheet, leaning against the front.
  const tag = new Object3D();
  tag.name = 'object:tag';
  const tagBody = part(merge([tint(bevelBox(0.06, 0.0015, 0.09, 0.0004, 0.004), COLOR.paper), tint(placed(flatRing(0.0035, 0.0008, 12), [0, 0.0015, -0.036]), COLOR.edge)]), 'vcMatte', 'object:tag');
  tagBody.rotation.x = -1.3;
  tag.add(tagBody);
  tag.position.set(-fw / 2 + 0.04, 0.002, fd / 2 + 0.025);
  root.add(tag);

  // Selected: a cobalt ring on the tiles around, four bone buttons at the foot.
  const ring = part(flatRing(RING_R, 0.002, 64), 'cobalt', 'object:ring');
  ring.position.y = 0.003;
  ring.visible = false;
  root.add(ring);
  const buttonsRoot = new Object3D();
  root.add(buttonsRoot);
  let buttons: { id: string; node: Object3D }[] = [];

  // The flag on its pin, at the back right.
  const flagRoot = new Object3D();
  flagRoot.position.set(fw / 2 - 0.02, 0, -fd / 2 + 0.02);
  const pin = part(cylinder(0.0025, 0.0025, height + 0.1, 8), 'slate', 'object:pin');
  flagRoot.add(pin);
  let flagMesh: Mesh | null = null;
  flagRoot.visible = false;
  root.add(flagRoot);

  let state: ObjectState = 'ready';
  let stateAt = -Infinity;
  let selected = false;
  let selectedAt = -Infinity;
  let stale = false;
  let currentFlag: ObjectFlag | 'stale' = 'none';

  const obj: ProjectObject = {
    root,
    spec,
    tag,
    height,
    setState(next, on = true) {
      if (next === 'selected') {
        selected = on;
        selectedAt = now();
        return;
      }
      if (next === 'stale') {
        // Stale: the refresh mark stands on the pin unless another flag is up.
        stale = on;
        if (on && currentFlag === 'none') obj.setFlag('stale');
        if (!on && currentFlag === 'stale') obj.setFlag('none');
        return;
      }
      state = next;
      stateAt = now();
    },
    setFlag(flag, urgent = false) {
      currentFlag = flag;
      if (flagMesh) {
        flagMesh.removeFromParent();
        flagMesh = null;
      }
      const g = flag === 'none' ? null : flagShape(flag);
      flagRoot.visible = g !== null;
      if (!g) return;
      const amber = flag === 'question' || (flag === 'deadline' && urgent);
      flagMesh = part(g, amber ? 'amber' : 'bone', `object:flag:${flag}`);
      flagMesh.position.set(0.0025, height + 0.1 - (flag === 'stale' ? 0.02 : 0.04), 0);
      if (flag === 'stale') flagMesh.rotation.x = Math.PI / 2;
      flagRoot.add(flagMesh);
    },
    setButtons(list) {
      buttonsRoot.clear();
      buttons = list.slice(0, 4).map((b, i) => {
        const node = new Object3D();
        node.name = `object-button:${b.id}`;
        node.userData.target = `object-button:${b.id}`;
        // A button 60 mm high for a ray at this distance, as wide as its label needs.
        const textW = measureLabel(b.label, { role: 'label', eyeDist: 1.6, weight: 700 });
        const w = Math.max(0.1, textW + 0.024);
        const plate = part(bevelBox(w, 0.06, 0.008, 0.002, 0.012), 'bone', 'object:button');
        plate.position.y = -0.03;
        node.add(plate);
        const label = createLabel(b.label, { role: 'label', width: w - 0.012, eyeDist: 1.6, lines: 1, align: 'center', color: COLOR.cobaltText, weight: 700 });
        label.position.set(0, 0, 0.0085);
        node.add(label);
        const p = obj.buttonPoints()[i];
        node.position.copy(p);
        node.rotation.x = -0.35;
        buttonsRoot.add(node);
        return { id: b.id, node };
      });
      void setLabelText;
    },
    buttonPoints() {
      // A row in front of the object, toward the person, 15 cm apart, curving back at the ends.
      return [-1.5, -0.5, 0.5, 1.5].map((k) => new Vector3(k * 0.15, 0.06, fd / 2 + 0.1 - Math.abs(k) * 0.025));
    },
    update(t) {
      const reduced = lessMotion();
      // Growing: rises out of the plot in 900 ms with a settle.
      const k = state === 'growing' ? (reduced ? (t >= stateAt ? 1 : 0) : easeBack(progress(t, stateAt, GROW_MS), 0.08)) : 1;
      const grow = Math.max(0.001, k);
      body.scale.set(1, grow, 1);
      setShadowHeight(body, height * clamp01(k));
      ring.visible = selected;
      const ks = reduced ? 1 : progress(t, selectedAt, 220);
      ring.scale.setScalar(selected ? 0.9 + 0.1 * ks : 1);
      buttonsRoot.visible = selected && buttons.length > 0;
      buttonsRoot.position.y = selected && !reduced ? -0.02 * (1 - ks) : 0;
      void stale;
    },
  };
  animate(obj);
  return obj;
}
