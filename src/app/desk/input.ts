/**
 * Without a headset: drag with the mouse or a finger to look around; W A S D or the arrow
 * keys walk on the ground (left and right arrows turn); hold Space to speak while someone
 * is talking with you; click or tap a reply, a flag (glide there), Pip or a neighbour, or
 * the grass while a house is being placed. On a phone the page adds a small stick for
 * walking (src/pages/home/).
 *
 * All of it listens only while `store.mode` is 'desk'.
 */
import { Raycaster, Vector2, Vector3, type Mesh, type Object3D } from '@iwsdk/core';
import type { App } from '../boot/world';
import type { Glide } from '../hands/glide';
import type { Placement } from '../hands/place';
import type { Replies } from '../hands/replies';
import type { Voice } from '../hands/voice';
import type { Rig } from '../rig';
import type { Guide } from './guide';

export type DeskPick = { objects(): Object3D[]; pick(object: Object3D): void };

const typing = (): boolean => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
};

export function bindDesk(
  app: App,
  rig: Rig,
  replies: Replies,
  placement: Placement,
  glide: Glide,
  guide: Guide,
  voice: Voice,
  picks: DeskPick[] = [],
): void {
  const canvas = app.world.renderer.domElement;
  canvas.style.touchAction = 'none';
  const ray = new Raycaster();
  const ndc = new Vector2();
  let down: { x: number; y: number; yaw: number; pitch: number; id: number } | null = null;
  let moved = 0;
  const desk = (): boolean => app.store.mode.peek() === 'desk';

  const toNdc = (e: PointerEvent): void => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, app.world.camera);
  };

  const hitFirst = (objects: Object3D[]): number => {
    const hits = ray.intersectObjects(objects, false);
    return hits.length ? objects.indexOf(hits[0].object) : -1;
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (!desk()) return;
    down = { x: e.clientX, y: e.clientY, yaw: rig.lookYaw, pitch: rig.lookPitch, id: e.pointerId };
    moved = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!desk()) return;
    toNdc(e);
    if (placement.active) placement.aim(ray.ray);
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    moved = Math.max(moved, Math.hypot(dx, dy));
    if (moved > 30) app.store.deskUsed.value = true;
    if (moved > 6) guide.manual(5000);
    const k = e.pointerType === 'touch' ? 0.006 : 0.004;
    rig.look(down.yaw + dx * k, down.pitch + dy * k);
  });
  const up = (e: PointerEvent): void => {
    if (!down || e.pointerId !== down.id) return;
    down = null;
    if (moved > 6 || !desk()) return;
    app.store.input.value = 'mouse';
    toNdc(e);
    const bubbles = replies.meshes() as Mesh[];
    const b = hitFirst(bubbles);
    if (b >= 0) {
      replies.pick(b);
      return;
    }
    if (placement.active) {
      placement.aim(ray.ray);
      placement.confirm();
      return;
    }
    // Pip and the residents: the nearest hit among their whole models.
    let best: { d: number; pick: DeskPick; object: Object3D } | null = null;
    for (const p of picks) {
      for (const object of p.objects()) {
        if (!object) continue;
        const hit = ray.intersectObject(object, true)[0];
        if (hit && (!best || hit.distance < best.d)) best = { d: hit.distance, pick: p, object };
      }
    }
    if (best) {
      best.pick.pick(best.object);
      return;
    }
    const rings = glide.rings();
    const g = hitFirst([...rings, ...glide.beacons()]);
    if (g >= 0) {
      void glide.to(g % Math.max(1, rings.length));
      return;
    }
    // Anywhere else on the island: glide to the nearest flag when the click is close to one.
    const ground = ray.ray.direction.y < -0.02 ? -ray.ray.origin.y / ray.ray.direction.y : -1;
    if (ground > 0) {
      const p = ray.ray.at(ground, new Vector3());
      const i = glide.near(p);
      if (i >= 0) void glide.to(i);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => {
    down = null;
  });

  // Keys: walk, turn, hold Space to speak.
  const held = new Set<string>();
  let talking = false;
  const apply = (): void => {
    const f = (held.has('w') || held.has('arrowup') ? 1 : 0) - (held.has('s') || held.has('arrowdown') ? 1 : 0);
    const r = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
    const turn = (held.has('arrowright') ? 1 : 0) - (held.has('arrowleft') ? 1 : 0);
    guide.setWalk(f, r, turn);
  };
  const WALK = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
  window.addEventListener('keydown', (e) => {
    if (!desk() || typing() || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (WALK.has(key)) {
      e.preventDefault();
      held.add(key);
      app.store.deskUsed.value = true;
      apply();
      return;
    }
    if (key === ' ' && !e.repeat) {
      if (!app.store.talkingTo.peek()) return;
      e.preventDefault();
      talking = true;
      void voice.start();
    }
  });
  window.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (held.delete(key)) apply();
    if (key === ' ' && talking) {
      talking = false;
      voice.stop();
    }
  });
  window.addEventListener('blur', () => {
    held.clear();
    apply();
    if (talking) {
      talking = false;
      voice.stop();
    }
  });
}
