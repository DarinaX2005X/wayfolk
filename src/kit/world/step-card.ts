/**
 * A step card: the paper card a checked unit becomes on its way from a station to its
 * tile (DESIGN "Плитка": the card travels to its cell in 300 ms, turns face down and
 * falls 4 cm in 200 ms). Generic for every plan: the face carries one short line (the
 * unit's label), the back is the tone of the tile it will be.
 *
 *   send(from, to, at?)  travels from a station to a tile, turns over and lands
 *   setText(text)        the line on its face
 *
 * Root in the seated frame; `from` and `to` are seated-frame points (tilePosition gives
 * world points: the caller converts).
 */
import { Object3D, Vector3 } from '@iwsdk/core';
import { COLOR, MOTION } from '../../tokens/tokens';
import { bevelBox, tint } from './geom';
import { createLabel, setLabelText } from './label';
import { part } from './materials';
import { animate, clamp01, drop, easeInOut, lessMotion, now } from './time';

export type StepCard = {
  root: Object3D;
  setText(text: string): void;
  /** Sends the card; returns the time in ms until it lies as a tile. */
  send(from: Vector3, to: Vector3): number;
  /** True once it has landed (the plot takes over and lays the tile). */
  landed(t?: number): boolean;
  update(t: number): void;
};

const CARD = { w: 0.05, d: 0.036, h: 0.0012 };

export function createStepCard(text = ''): StepCard {
  const root = new Object3D();
  root.name = 'kit:step-card';
  const body = new Object3D();
  root.add(body);
  const face = part(bevelBox(CARD.w, CARD.h, CARD.d, 0.0004, 0.003), 'paper', 'step-card:paper');
  const back = part(tint(bevelBox(CARD.w - 0.002, 0.0004, CARD.d - 0.002, 0.0001, 0.002), COLOR.ground.tile[0]), 'vcMatte', 'step-card:back');
  back.position.y = -0.0004;
  const label = createLabel(text || ' ', { role: 'label', width: CARD.w - 0.006, eyeDist: 1.3, lines: 2, align: 'center', color: COLOR.ink });
  label.rotation.x = -Math.PI / 2;
  label.position.y = CARD.h + 0.0004;
  body.add(face, back, label);
  root.visible = false;

  const from = new Vector3();
  const to = new Vector3();
  let at = -Infinity;
  const travel = MOTION.tile.travelMs;
  const fall = MOTION.tile.flipDropMs;

  const card: StepCard = {
    root,
    setText(t) {
      setLabelText(label, t || ' ');
    },
    send(a, b) {
      from.copy(a);
      to.copy(b);
      at = now();
      return travel + fall;
    },
    landed(t = now()) {
      return at > -Infinity && t >= at + travel + fall;
    },
    update(t) {
      if (at === -Infinity) return;
      const reduced = lessMotion();
      const k = reduced ? 1 : clamp01((t - at) / travel);
      const kf = reduced ? 1 : clamp01((t - at - travel) / fall);
      root.visible = kf < 1;
      // Along a low arc to 4 cm above the cell, then over and down.
      root.position.lerpVectors(from, to, easeInOut(k));
      root.position.y += 0.06 * Math.sin(Math.PI * k) + MOTION.tile.dropFrom * (1 - drop(kf));
      root.rotation.set(Math.PI * easeInOut(clamp01((t - at - travel * 0.6) / (travel * 0.4 + fall * 0.5))), Math.atan2(to.x - from.x, to.z - from.z), 0, 'YXZ');
    },
  };
  animate(card);
  return card;
}
