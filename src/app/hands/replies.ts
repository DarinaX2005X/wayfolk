/**
 * Quick replies and little menus as word clouds you poke (DESIGN «Интерфейс в мире»).
 *
 * Talking is by voice (and typing in a page); the clouds are the fallback. In a
 * conversation they drift in only after the person has been quiet for a while (`delay`),
 * and stay away while the person types or speaks (`hold()`). A menu (Pip's, the evening
 * offer) shows its clouds at once.
 *
 * In a headset the clouds float by the hand (or in front of the person without a tracked
 * hand): touch one with a fingertip, or point and pinch. In a page they float beside
 * whoever is speaking and a click pokes one. The page keeps the same choices as a list for
 * screen readers and the keyboard (store.choices), hidden from sight.
 */
import { Group, Mesh, Vector3, type Object3D } from '@iwsdk/core';
import { sound } from '../../feel/sound';
import { disposeBubble, makeBubble } from '../../kit/ui/bubble';
import { registerTest } from '../debug';
import type { App } from '../boot/world';
import { SIDES, type Hands, type Side } from './hands';

export type Replies = {
  /** Shows the choices; resolves with the chosen text (or null when hidden). */
  show(choices: string[], opts?: { side?: Side; delay?: number }): Promise<string | null>;
  hide(): void;
  readonly open: boolean;
  /** Picks a choice by index (the page's list, tests). */
  pick(index: number): void;
  /** Answers in the person's own words (typed or spoken); resolves show() with them. */
  answer(text: string): void;
  /** The person is typing or speaking: the clouds wait (and leave if they were out). */
  hold(): void;
  /** Cloud meshes that can be poked now, for the page's raycast. */
  meshes(): Object3D[];
  /** True while a pinch was taken by a cloud (other pinch users skip it). */
  consumed(side: Side): boolean;
  /** Where the page's clouds gather: the speaker's head, world space (null: in front). */
  anchorAt(fn: () => Vector3 | null): void;
};

/** Width of a cloud by the hand, metres. */
const HAND_W = 0.13;
/** Width of a cloud in a page, metres, at PAGE_D from the eye. */
const PAGE_W = 0.3;
const PAGE_D = 1.5;

export function createReplies(app: App, hands: Hands): Replies {
  const group = new Group();
  group.name = 'replies';
  app.roots.fx.add(group);
  let bubbles: Mesh[] = [];
  let current: string[] = [];
  let resolve: ((v: string | null) => void) | null = null;
  let side: Side | undefined;
  let shownAt = 0;
  /** When the clouds come out (application ms); Infinity while held back. */
  let outAt = 0;
  let delay = 0;
  let anchor: () => Vector3 | null = () => null;
  const taken: Record<Side, boolean> = { left: false, right: false };
  const head = new Vector3();
  const centre = new Vector3();
  const right = new Vector3();
  const up = new Vector3();
  const fwd = new Vector3();
  const local = new Vector3();
  const want = new Vector3();
  const hit = new Vector3();
  const desk = (): boolean => app.store.mode.peek() === 'desk';
  const pace = (): number => Math.max(0.05, app.store.pace.peek());
  const out = (): boolean => bubbles.length > 0 && app.clock.now() >= outAt;

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
    // A small puff before the clouds go.
    const t0 = app.clock.now();
    const base = b.scale.x;
    const off = app.everyFrame((_dt, now) => {
      const k = (now - t0) / 180;
      b.scale.setScalar(base * (1 + Math.sin(Math.min(1, k) * Math.PI) * 0.3));
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
    if (!out()) return;
    // Point and pinch: the ray against each cloud's plane.
    for (let i = 0; i < bubbles.length; i += 1) {
      const b = bubbles[i];
      b.getWorldPosition(centre);
      b.getWorldDirection(right); // +Z of the cloud, toward the person
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

  // A small honest note under the clouds when the traveler or the line is prepared.
  const note = makeBubble('prepared traveler', { width: 0.075, size: 34, tail: 'none', paper: '#f3e6cf', rim: '#d9bf98', ink: '#7a5a40' });
  note.name = 'replies:prepared';
  note.visible = false;
  group.add(note);

  app.everyFrame((dt, now) => {
    note.visible = !desk() && out() && app.store.prepared.peek();
    if (!bubbles.length) return;
    const cam = app.world.camera;
    cam.updateWorldMatrix(true, false);
    cam.getWorldPosition(head);
    const a = 1 - Math.exp(-dt * 10);
    const n = bubbles.length;
    const shown = now >= outAt;
    if (desk()) {
      // Beside the speaker, a step in front of them, in a gentle column that bobs.
      right.set(1, 0, 0).applyQuaternion(cam.quaternion);
      up.set(0, 1, 0).applyQuaternion(cam.quaternion);
      cam.getWorldDirection(fwd);
      const at = anchor();
      if (at) {
        want.copy(at).sub(head);
        if (want.dot(fwd) < 0.2) want.copy(fwd);
        want.normalize();
      } else want.copy(fwd).addScaledVector(up, -0.15).normalize();
      want.multiplyScalar(PAGE_D).add(head);
      // On the other side of the speaker from the page's answer box (which sits to their
      // right unless they stand at the right of the view).
      local.copy(want).project(cam);
      const sideK = local.x > 0.3 ? 1 : -1;
      for (let i = 0; i < n; i += 1) {
        const b = bubbles[i];
        centre.copy(want).addScaledVector(right, sideK * (0.36 + (i % 2) * 0.05)).addScaledVector(up, 0.1 - i * 0.135 + Math.sin(now / 700 + i * 1.3) * 0.006);
        if (b.userData.placed) b.position.lerp(centre, a);
        else {
          b.position.copy(centre);
          b.userData.placed = true;
        }
        b.quaternion.copy(cam.quaternion);
        const k = shown ? Math.min(1, (now - outAt) / 260 - i * 0.18) : 0;
        b.visible = k > 0;
        b.scale.setScalar(Math.max(0.01, k) * (PAGE_W / HAND_W));
      }
      return;
    }
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
    for (let i = 0; i < n; i += 1) {
      const b = bubbles[i];
      const offset = (i - (n - 1) / 2) * (HAND_W + 0.012);
      const lift = Math.abs(i - (n - 1) / 2) < 0.6 ? 0.03 : 0;
      centre.copy(want).addScaledVector(right, offset);
      centre.y += lift + Math.sin(now / 600 + i) * 0.005;
      if (b.userData.placed) b.position.lerp(centre, a);
      else {
        b.position.copy(centre);
        b.userData.placed = true;
      }
      b.lookAt(head);
      const k = shown ? Math.min(1, (now - outAt) / 260 - i * 0.15) : 0;
      b.visible = k > 0;
      b.scale.setScalar(Math.max(0.01, k));
    }
    if (note.visible) {
      note.position.copy(want).y -= 0.045;
      note.lookAt(head);
    }
    // Touch with a fingertip of either hand (not in the first 400 ms, to avoid a stray touch).
    if (!shown || now - outAt < 400 || !resolve) return;
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
  registerTest('repliesShown', () => out() && app.clock.now() - outAt > 500);

  return {
    show(choices, opts) {
      if (resolve) finish(null);
      current = choices.slice(0, 4);
      side = opts?.side;
      shownAt = app.clock.now();
      delay = (opts?.delay ?? 0) * pace();
      outAt = shownAt + delay;
      bubbles = current.map((text, i) => {
        const b = makeBubble(text, { width: HAND_W, size: 46, cloud: true, paper: '#fbf7f2', rim: '#e9dbe6', ink: '#3a2c22' });
        b.name = `bubble:${i}`;
        b.scale.setScalar(0.01);
        b.visible = false;
        group.add(b);
        return b;
      });
      app.store.choices.value = current;
      if (!delay) sound.play('paper');
      else
        app.clock.timers.set(() => {
          if (bubbles.length && app.clock.now() >= outAt) sound.play('paper');
        }, delay + 20);
      return new Promise((r) => {
        resolve = r;
      });
    },
    hide: () => finish(null),
    get open() {
      return resolve !== null;
    },
    pick: (i) => choose(i),
    answer(text) {
      const t = text.trim().slice(0, 200);
      if (!t || !resolve) return;
      sound.play('tap');
      finish(t);
    },
    hold() {
      // Quiet again only after a while: the clouds go back and wait.
      if (!resolve || !delay) return;
      outAt = app.clock.now() + delay;
      for (const b of bubbles) {
        b.visible = false;
        b.scale.setScalar(0.01);
      }
    },
    meshes: () => (out() ? bubbles : []),
    consumed: (s) => taken[s],
    anchorAt(fn) {
      anchor = fn;
    },
  };
}
