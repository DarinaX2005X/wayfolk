/**
 * Three reply bubbles that float by the hand (DESIGN «Интерфейс в мире»): touch one with
 * a fingertip of either hand, or point at it and pinch. Without a tracked hand they
 * float in front of the person; at the desk the page shows the same choices as buttons
 * (store.choices) and a click on a bubble works too.
 */
import { Group, Mesh, Vector3, type Object3D } from '@iwsdk/core';
import { sound } from '../../feel/sound';
import { disposeBubble, makeBubble } from '../../kit/ui/bubble';
import { registerTest } from '../debug';
import type { App } from '../boot/world';
import { SIDES, type Hands, type Side } from './hands';

export type Replies = {
  /** Shows the choices; resolves with the chosen text (or null when hidden). */
  show(choices: string[], opts?: { side?: Side }): Promise<string | null>;
  hide(): void;
  readonly open: boolean;
  /** Picks a choice by index (desk buttons, tests). */
  pick(index: number): void;
  /** Bubble meshes, for the desk raycast. */
  meshes(): Object3D[];
  /** True while a pinch was taken by a bubble (other pinch users skip it). */
  consumed(side: Side): boolean;
};

const WIDTH = 0.12;

export function createReplies(app: App, hands: Hands): Replies {
  const group = new Group();
  group.name = 'replies';
  app.roots.fx.add(group);
  let bubbles: Mesh[] = [];
  let current: string[] = [];
  let resolve: ((v: string | null) => void) | null = null;
  let side: Side | undefined;
  let shownAt = 0;
  const taken: Record<Side, boolean> = { left: false, right: false };
  const head = new Vector3();
  const centre = new Vector3();
  const right = new Vector3();
  const local = new Vector3();
  const want = new Vector3();
  const hit = new Vector3();

  const finish = (value: string | null): void => {
    const r = resolve;
    resolve = null;
    app.store.choices.value = [];
    for (const b of bubbles) disposeBubble(b);
    bubbles = [];
    current = [];
    r?.(value);
  };

  const choose = (index: number): void => {
    const text = current[index];
    if (text === undefined || !resolve) return;
    const b = bubbles[index];
    b.getWorldPosition(hit);
    sound.play('tap', { at: hit });
    // A short pop before the bubbles go.
    const t0 = app.clock.now();
    const off = app.everyFrame((_dt, now) => {
      const k = (now - t0) / 160;
      b.scale.setScalar(1 + Math.sin(Math.min(1, k) * Math.PI) * 0.25);
      if (k >= 1) {
        off();
        finish(text);
      }
    });
  };

  const inside = (b: Mesh, p: Vector3, depth: number): boolean => {
    local.copy(p);
    b.worldToLocal(local);
    const g = b.geometry;
    g.computeBoundingBox();
    const box = g.boundingBox!;
    return local.x > box.min.x && local.x < box.max.x && local.y > box.min.y && local.y < box.max.y && Math.abs(local.z) < depth;
  };

  hands.onPinch((s, down, h) => {
    if (!down) {
      taken[s] = false;
      return;
    }
    if (!bubbles.length) return;
    // Point and pinch: the ray against each bubble's plane.
    for (let i = 0; i < bubbles.length; i += 1) {
      const b = bubbles[i];
      b.getWorldPosition(centre);
      b.getWorldDirection(right); // +Z of the bubble, toward the person
      const denom = right.dot(h.rayDir);
      if (Math.abs(denom) < 1e-4) continue;
      const t = right.dot(local.subVectors(centre, h.rayOrigin)) / denom;
      if (t <= 0 || t > 3) continue;
      hit.copy(h.rayOrigin).addScaledVector(h.rayDir, t);
      if (inside(b, hit, 0.02)) {
        taken[s] = true;
        choose(i);
        return;
      }
    }
  });

  // A small honest note under the bubbles when the traveler or the line is prepared.
  const note = makeBubble('prepared traveler', { width: 0.075, size: 34, tail: 'none', paper: '#f3e6cf', rim: '#d9bf98', ink: '#7a5a40' });
  note.name = 'replies:prepared';
  note.visible = false;
  group.add(note);

  app.everyFrame((dt, now) => {
    // At the desk the page shows the same choices as buttons.
    group.visible = app.store.mode.peek() !== 'desk';
    note.visible = bubbles.length > 0 && app.store.prepared.peek();
    if (!bubbles.length) return;
    const cam = app.world.camera;
    cam.updateWorldMatrix(true, false);
    cam.getWorldPosition(head);
    const hand = side ? hands.get(side) : hands.primary();
    if (hand?.tracked) {
      want.copy(hand.anchor.position);
      want.y += 0.1;
    } else {
      want.set(0, -0.2, -0.5).applyMatrix4(cam.matrixWorld);
    }
    // Spread across the line of sight.
    right.subVectors(want, head).setY(0).normalize();
    right.set(-right.z, 0, right.x);
    const a = 1 - Math.exp(-dt * 10);
    const n = bubbles.length;
    for (let i = 0; i < n; i += 1) {
      const b = bubbles[i];
      const offset = (i - (n - 1) / 2) * (WIDTH + 0.015);
      const lift = Math.abs(i - (n - 1) / 2) < 0.6 ? 0.03 : 0;
      centre.copy(want).addScaledVector(right, offset);
      centre.y += lift + Math.sin(now / 600 + i) * 0.004;
      if (b.userData.placed) b.position.lerp(centre, a);
      else {
        b.position.copy(centre);
        b.userData.placed = true;
      }
      b.lookAt(head);
      // Grow in.
      const k = Math.min(1, (now - shownAt) / 250 - i * 0.15);
      if (b.scale.x < 1 && k > 0) b.scale.setScalar(Math.max(0.01, k));
    }
    if (note.visible) {
      note.position.copy(want).y -= 0.045;
      note.lookAt(head);
    }
    // Touch with a fingertip of either hand (not in the first 400 ms, to avoid a stray touch).
    if (now - shownAt < 400 || !resolve) return;
    for (const s of SIDES) {
      const h = hands.get(s);
      if (!h.tracked) continue;
      for (let i = 0; i < bubbles.length; i += 1) {
        if (inside(bubbles[i], h.indexTip, 0.025)) {
          choose(i);
          return;
        }
      }
    }
  });

  registerTest('reply', (index: number) => choose(index));

  return {
    show(choices, opts) {
      if (resolve) finish(null);
      current = choices.slice(0, 4);
      side = opts?.side;
      shownAt = app.clock.now();
      bubbles = current.map((text, i) => {
        const b = makeBubble(text, { width: WIDTH, size: 46, tail: 'none', paper: '#fffaf0', rim: '#f0b46c' });
        b.name = `bubble:${i}`;
        b.scale.setScalar(0.01);
        group.add(b);
        return b;
      });
      app.store.choices.value = current;
      sound.play('paper');
      return new Promise((r) => {
        resolve = r;
      });
    },
    hide: () => finish(null),
    get open() {
      return resolve !== null;
    },
    pick: (i) => choose(i),
    meshes: () => bubbles,
    consumed: (s) => taken[s],
  };
}
