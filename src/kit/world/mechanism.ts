/**
 * Slate mechanisms of the arc (DESIGN "Механизмы"): code has no figures, it is machinery
 * fixed on the shelf. No ring, no legs. Each pulse moves one part from an engine event:
 *
 *   cutter    a plate with a bone knife; pulse('cut') brings the knife down
 *   gate      two posts and a crossbar of 11 cm, a bone stamp head with a vermilion face
 *             under it; pulse('stamp') drops the head 15 mm in 90 ms, pulse('pass') slides a card under the bar
 *   assembly  a plate with a frame holding a sample tile; pulse('lay') sets the tile into the frame
 *   solver    a plate with a row of eight bone beads; pulse('count') moves the next bead over
 *   scale     a plate with a beam and two bone weights (code's score and the teacher's); pulse('weigh') rocks it
 *
 * States: idle, busy, error (a greyer tone and a vermilion plate on the front).
 * Origin at the centre of the plate's footprint on the shelf; +z faces the person.
 */
import { Object3D } from '@iwsdk/core';
import { COLOR } from '../../tokens/tokens';
import { bevelBox, box, cylinder, merge, placed, sphere, tint } from './geom';
import { part, setMat } from './materials';
import { attachShadow } from './shadow';
import { animate, clamp01, easeInOut, easeOut, lessMotion, now } from './time';
import type { Mechanism, MechanismKind, MechanismPulse } from './types';

const PLATE = { w: 0.11, h: 0.014, d: 0.08 };
type Pulse = { kind: MechanismPulse; at: number; n: number };

/** Displacement 0..1 of a strike that goes down in `down` ms and back in `up` ms. */
function strike(t: number, at: number, down: number, up: number): number {
  const dt = t - at;
  if (dt < 0 || dt > down + up) return 0;
  if (dt < down) return easeOut(dt / down);
  return 1 - easeInOut((dt - down) / up);
}

export function createMechanism(kind: MechanismKind): Mechanism {
  const root = new Object3D();
  root.name = `kit:mechanism:${kind}`;
  const plate = part(bevelBox(PLATE.w, PLATE.h, PLATE.d, 0.004, 0.006), 'slate', `${kind}:plate`);
  root.add(plate);
  attachShadow(plate, { height: 0.08, size: [PLATE.w, PLATE.d], rest: 0 });
  const errorPlate = part(bevelBox(0.03, 0.01, 0.003, 0.001, 0.002), 'vermilion', `${kind}:error`);
  errorPlate.position.set(0, 0.002, PLATE.d / 2 + 0.0015);
  errorPlate.visible = false;
  root.add(errorPlate);
  const y0 = PLATE.h;
  const pulses: Pulse[] = [];
  let count = 0;
  let state: 'idle' | 'busy' | 'error' = 'idle';
  let animateParts: (t: number, last: (k: MechanismPulse) => Pulse | null, reduced: boolean) => void = () => {};
  const slateParts: ReturnType<typeof part>[] = [plate];

  if (kind === 'cutter') {
    const post = part(placed(bevelBox(0.014, 0.05, 0.014, 0.002), [0, 0, 0]), 'slate', 'cutter:post');
    post.position.set(-PLATE.w / 2 + 0.012, y0, -PLATE.d / 2 + 0.014);
    root.add(post);
    slateParts.push(post);
    const hinge = new Object3D();
    hinge.position.set(-PLATE.w / 2 + 0.012, y0 + 0.042, -PLATE.d / 2 + 0.014);
    const knife = part(
      merge([tint(placed(bevelBox(0.092, 0.012, 0.003, 0.0008), [0.05, -0.006, 0.022], [0, -0.35, 0]), COLOR.bone), tint(placed(box(0.012, 0.006, 0.03), [0.004, -0.003, 0.012]), COLOR.boneShade)]),
      'vcCeramic',
      'cutter:knife',
    );
    hinge.add(knife);
    root.add(hinge);
    const guide = part(placed(box(0.06, 0.002, 0.05), [0.01, 0, 0.008]), 'slateEdge', 'cutter:bed');
    guide.position.y = y0;
    root.add(guide);
    animateParts = (t, last, reduced) => {
      const p = last('cut');
      hinge.rotation.x = reduced ? 0 : -0.28 + 0.28 * (p ? strike(t, p.at, 70, 160) : 0);
    };
  } else if (kind === 'gate') {
    const postGeo = bevelBox(0.012, 0.085, 0.012, 0.002);
    const left = part(postGeo, 'slate', 'gate:post');
    const right = part(postGeo, 'slate', 'gate:post');
    left.position.set(-0.055, y0, 0);
    right.position.set(0.055, y0, 0);
    const bar = part(bevelBox(0.124, 0.012, 0.016, 0.002), 'slate', 'gate:bar');
    bar.position.set(0, y0 + 0.085, 0);
    root.add(left, right, bar);
    slateParts.push(left, right, bar);
    const head = new Object3D();
    const headBody = part(
      merge([
        tint(placed(cylinder(0.003, 0.003, 0.018, 8), [0, 0.012, 0]), COLOR.slateEdge),
        tint(bevelBox(0.026, 0.016, 0.02, 0.002, 0.003), COLOR.bone),
        tint(placed(box(0.022, 0.002, 0.016), [0, -0.0015, 0]), COLOR.vermilion),
      ]),
      'vcCeramic',
      'gate:head',
    );
    head.add(headBody);
    root.add(head);
    const card = part(bevelBox(0.04, 0.0012, 0.03, 0.0004, 0.002), 'paper', 'gate:card');
    root.add(card);
    animateParts = (t, last, reduced) => {
      const s = last('stamp');
      // Rest: the face 30 mm above the plate; a stamp drops it 15 mm in 90 ms.
      head.position.set(0, y0 + 0.052 - (reduced ? 0 : 0.015 * (s ? strike(t, s.at, 90, 150) : 0)), 0);
      const p = last('pass');
      const k = p ? clamp01((t - p.at) / 300) : 1;
      card.visible = p !== null && k < 1;
      card.position.set(0, y0 + 0.001, 0.05 - 0.1 * easeInOut(k));
    };
  } else if (kind === 'assembly') {
    const frame = part(
      merge([
        placed(box(0.07, 0.008, 0.006), [0, 0, -0.03]),
        placed(box(0.07, 0.008, 0.006), [0, 0, 0.03]),
        placed(box(0.006, 0.008, 0.054), [-0.032, 0, 0]),
        placed(box(0.006, 0.008, 0.054), [0.032, 0, 0]),
      ]),
      'bone',
      'assembly:frame',
    );
    frame.position.y = y0;
    root.add(frame);
    const tile = part(bevelBox(0.056, 0.008, 0.052, 0.002, 0.002), 'vcMatte', 'assembly:tile');
    tint(tile.geometry, COLOR.ground.tile[0]);
    root.add(tile);
    animateParts = (t, last, reduced) => {
      const p = last('lay');
      const k = p ? clamp01((t - p.at) / 220) : 1;
      tile.position.y = y0 + 0.001 + (reduced ? 0 : 0.025 * (1 - easeOut(k)) * (k < 1 ? 1 : 0));
    };
  } else if (kind === 'solver') {
    const rod = part(placed(cylinder(0.002, 0.002, 0.096, 8), [0, 0, 0], [0, 0, Math.PI / 2]), 'slateEdge', 'solver:rod');
    rod.position.set(0.048, y0 + 0.02, 0);
    const ends = part(merge([placed(box(0.006, 0.026, 0.01), [-0.05, 0, 0]), placed(box(0.006, 0.026, 0.01), [0.05, 0, 0])]), 'slate', 'solver:ends');
    ends.position.y = y0;
    root.add(rod, ends);
    slateParts.push(ends);
    const beadGeo = sphere(0.0058, 12, 8);
    const beads = Array.from({ length: 8 }, (_, i) => {
      const b = part(beadGeo, 'bone', `solver:bead:${i}`);
      b.scale.set(0.8, 1, 1);
      root.add(b);
      return b;
    });
    animateParts = (t, _last, reduced) => {
      // Beads 0..moved-1 sit on the right; the latest one travels in 160 ms.
      const moved = count % 9;
      const p = pulses[pulses.length - 1];
      beads.forEach((b, i) => {
        const left = -0.04 + i * 0.0105;
        const right = 0.04 - (7 - i) * 0.0105;
        let x = i >= 8 - moved ? right : left;
        if (p && i === 8 - moved && !reduced) x = left + (right - left) * easeInOut(clamp01((t - p.at) / 160));
        b.position.set(x, y0 + 0.02, 0);
      });
    };
  } else {
    const post = part(placed(bevelBox(0.008, 0.06, 0.008, 0.0015), [0, 0, 0]), 'slate', 'scale:post');
    post.position.y = y0;
    root.add(post);
    slateParts.push(post);
    const beam = new Object3D();
    beam.position.y = y0 + 0.058;
    const bar = part(placed(bevelBox(0.096, 0.005, 0.006, 0.001), [0, 0, 0]), 'slateEdge', 'scale:beam');
    beam.add(bar);
    const weightGeo = merge([placed(cylinder(0.0008, 0.0008, 0.018, 4), [0, -0.018, 0]), placed(cylinder(0.009, 0.01, 0.014, 16), [0, -0.032, 0])]);
    const wl = part(weightGeo, 'bone', 'scale:weight-code');
    const wr = part(weightGeo, 'bone', 'scale:weight-teacher');
    wl.position.x = -0.044;
    wr.position.x = 0.044;
    beam.add(wl, wr);
    root.add(beam);
    animateParts = (t, last, reduced) => {
      const p = last('weigh');
      const dt = p ? (t - p.at) / 1000 : 9;
      const a = reduced || dt > 1.2 ? 0 : 0.14 * Math.exp(-dt * 3.2) * Math.sin(dt * 14);
      beam.rotation.z = a;
      wl.rotation.z = -a;
      wr.rotation.z = -a;
    };
  }
  root.traverse((o) => {
    if ((o as { isMesh?: boolean }).isMesh) {
      o.userData.mechanism = kind;
    }
  });

  const last = (k: MechanismPulse): Pulse | null => {
    for (let i = pulses.length - 1; i >= 0; i--) if (pulses[i].kind === k) return pulses[i];
    return null;
  };

  const mech: Mechanism = {
    root,
    kind,
    get state() {
      return state;
    },
    pulse(p) {
      count += p === 'count' ? 1 : 0;
      pulses.push({ kind: p, at: now(), n: count });
      if (pulses.length > 12) pulses.shift();
    },
    setState(next) {
      state = next;
      for (const m of slateParts) setMat(m, next === 'error' ? 'slateEdge' : 'slate');
      errorPlate.visible = next === 'error';
    },
    update(t) {
      animateParts(t, last, lessMotion());
    },
  };
  animate(mech);
  return mech;
}
