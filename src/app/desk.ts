/**
 * Without a headset: drag with the mouse or a finger to look around from the seat; click
 * or tap a reply bubble, a glowing ring (glide there), or the ground while a house is
 * being placed. The page also shows the reply choices as buttons (store.choices).
 */
import { Raycaster, Vector2, type Mesh, type Object3D } from '@iwsdk/core';
import type { App } from './boot/world';
import type { Glide } from './hands/glide';
import type { Placement } from './hands/place';
import type { Replies } from './hands/replies';
import type { Rig } from './rig';

export function bindDesk(app: App, rig: Rig, replies: Replies, placement: Placement, glide: Glide): void {
  const canvas = app.world.renderer.domElement;
  canvas.style.touchAction = 'none';
  const ray = new Raycaster();
  const ndc = new Vector2();
  let down: { x: number; y: number; yaw: number; pitch: number; id: number } | null = null;
  let moved = 0;

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
    if (app.store.mode.peek() !== 'desk') return;
    down = { x: e.clientX, y: e.clientY, yaw: rig.lookYaw, pitch: rig.lookPitch, id: e.pointerId };
    moved = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (app.store.mode.peek() !== 'desk') return;
    toNdc(e);
    if (placement.active) placement.aim(ray.ray);
    if (!down || e.pointerId !== down.id) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    moved = Math.max(moved, Math.hypot(dx, dy));
    const k = (e.pointerType === 'touch' ? 0.006 : 0.004);
    rig.look(down.yaw + dx * k, down.pitch + dy * k);
  });
  const up = (e: PointerEvent): void => {
    if (!down || e.pointerId !== down.id) return;
    down = null;
    if (moved > 6 || app.store.mode.peek() !== 'desk') return;
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
    const rings = glide.rings();
    const g = hitFirst(rings);
    if (g >= 0) void glide.to(g);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', () => {
    down = null;
  });
  // Arrow keys look around too.
  window.addEventListener('keydown', (e) => {
    if (app.store.mode.peek() !== 'desk') return;
    const step = 0.08;
    if (e.key === 'ArrowLeft') rig.look(rig.lookYaw + step, rig.lookPitch);
    else if (e.key === 'ArrowRight') rig.look(rig.lookYaw - step, rig.lookPitch);
    else if (e.key === 'ArrowUp') rig.look(rig.lookYaw, rig.lookPitch + step);
    else if (e.key === 'ArrowDown') rig.look(rig.lookYaw, rig.lookPitch - step);
  });
}
