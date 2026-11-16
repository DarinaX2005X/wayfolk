/**
 * The Void / Room switch: a bone cap 6 cm across and 3 cm high on a bone base. Between
 * cap and base a band of sky shows in the Void (the five sky stops, zenith at the top);
 * in Room the band is empty bone. A pinch turns the cap half a turn: the notch on its
 * rim shows that it turned.
 */
import { Color, Object3D } from '@iwsdk/core';
import { SKY } from '../../tokens/tokens';
import { cylinder, lathe, placed, bevelBox, tintBy } from './geom';
import { part } from './materials';
import { attachShadow } from './shadow';
import { animate, easeBack, lessMotion, now, progress } from './time';
import type { ModeSwitch } from './types';

const R = 0.03;
const H = 0.03;
const TURN_MS = 420;

function skyBand(): ReturnType<typeof cylinder> {
  const g = cylinder(R * 0.94, R * 0.94, 0.008, 32, true);
  const stops = SKY.stops.map((s) => ({ el: s.el, c: new Color(s.color) }));
  const out = new Color();
  return tintBy(g, (_n, p) => {
    // Map the band's height (0..8 mm) to elevations +30° .. −20°.
    const el = 30 - (1 - p.y / 0.008) * 50;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i];
      const b = stops[i + 1];
      if (el <= a.el && el >= b.el) return out.copy(b.c).lerp(a.c, (el - b.el) / (a.el - b.el));
    }
    return el > 0 ? stops[0].c : stops[4].c;
  });
}

export function createModeSwitch(): ModeSwitch {
  const root = new Object3D();
  root.name = 'kit:mode-switch';
  root.userData.target = 'mode-switch';
  const base = part(cylinder(R, R * 1.02, 0.008, 32), 'bone', 'mode-switch:base');
  root.add(base);
  const band = part(skyBand(), 'vcCeramic', 'mode-switch:band');
  band.position.y = 0.008;
  const empty = part(cylinder(R * 0.94, R * 0.94, 0.008, 32, true), 'boneShade', 'mode-switch:empty');
  empty.position.y = 0.008;
  empty.visible = false;
  root.add(band, empty);
  const cap = new Object3D();
  cap.position.y = 0.016;
  const shell = part(
    lathe(
      [
        [R * 0.9, 0],
        [R * 0.97, 0],
        [R, 0.002],
        [R, H - 0.024],
        [R * 0.97, H - 0.019],
        [R * 0.85, H - 0.0165],
        [R * 0.55, H - 0.0155],
        [0, H - 0.015],
      ],
      36,
    ),
    'bone',
    'mode-switch:cap',
  );
  cap.add(shell);
  const notch = part(placed(bevelBox(0.008, 0.004, 0.006, 0.001), [0, 0.0005, R - 0.002]), 'boneShade', 'mode-switch:notch');
  cap.add(notch);
  root.add(cap);
  attachShadow(base, { height: H, size: [2 * R, 2 * R], rest: 0 });

  let mode: 'void' | 'room' = 'void';
  let turnAt = -Infinity;
  let turns = 0;
  const sw: ModeSwitch = {
    root,
    get mode() {
      return mode;
    },
    setMode(next) {
      if (next === mode) return;
      mode = next;
      turns += 1;
      turnAt = now();
    },
    update(t) {
      const k = lessMotion() ? (t >= turnAt ? 1 : 0) : easeBack(progress(t, turnAt, TURN_MS), 0.05);
      cap.rotation.y = Math.PI * (turns - 1 + k) * (turns > 0 ? 1 : 0);
      band.visible = mode === 'void';
      empty.visible = mode === 'room';
    },
  };
  animate(sw);
  return sw;
}
