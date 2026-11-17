/**
 * /p/<island>: a postcard opened on a phone. The island in 3D, turning slowly; drag to
 * turn it, pinch or scroll to come closer. Below, its name and who lives there, and a
 * way to the island itself.
 */
import { Box3, Vector3, type Mesh } from '@iwsdk/core';
import type { IslandState } from '../../mind/types';
import type { RouteParams } from '../router';
import './postcard.css';

const TEXT = {
  loading: 'Unfolding the postcard',
  missing: "This postcard's island could not be found. It may still be on its way.",
  visit: 'Visit Wayfolk',
  lives: (names: string[]) => (names.length ? `${names.join(', ')} ${names.length > 1 ? 'live' : 'lives'} here.` : 'Only the birds live here, for now.'),
  hint: 'Drag to turn the island.',
} as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function mount(root: HTMLElement, params: RouteParams): Promise<void> {
  const page = el('main', 'pc');
  const stage = el('div', 'pc-stage');
  const card = el('section', 'pc-card');
  const title = el('h1', 'pc-title', 'Wayfolk');
  const line = el('p', 'pc-line', TEXT.loading);
  const hint = el('p', 'pc-hint', TEXT.hint);
  const go = el('a', 'wf-button wf-primary', TEXT.visit);
  go.href = '/';
  card.append(title, line, hint, go);
  page.append(stage, card);
  root.replaceChildren(page);

  const { bootApp } = await import('../../app/boot/world');
  const app = await bootApp(stage);
  const { createModules } = await import('../../app/modules');
  const { world } = app;
  const mods = await createModules({
    world,
    scene: world.scene,
    camera: world.camera,
    renderer: world.renderer,
    root: app.roots.island,
    now: () => app.clock.now(),
    everyFrame: (fn) => app.everyFrame(fn),
    head: () => world.camera,
    pace: () => 1,
  });
  await Promise.race([mods.world.ready, new Promise((r) => setTimeout(r, 15000))]).catch(() => undefined);
  mods.world.setTime(new Date());

  let state: IslandState | null = null;
  try {
    if (mods.mind.visit && params.code) state = await mods.mind.visit(params.code);
  } catch (error) {
    console.warn('[wf] the postcard island did not load', error);
  }
  if (!state) {
    try {
      await mods.mind.load();
      if (mods.mind.state?.id === params.code) state = mods.mind.state;
    } catch {
      state = null;
    }
  }
  if (state) {
    title.textContent = state.name || 'Wayfolk';
    line.textContent = TEXT.lives(state.residents.map((r) => r.name));
    for (const h of state.houses) {
      try {
        mods.world.addHouse(h);
      } catch (error) {
        console.warn('[wf] a house could not be placed', error);
      }
    }
    for (const r of state.residents) {
      const h = state.houses.find((x) => x.id === r.houseId);
      try {
        mods.life.spawn(r, h ? { x: h.pos.x + Math.sin(h.rotY) * 2, z: h.pos.z + Math.cos(h.rotY) * 2 } : undefined);
      } catch (error) {
        console.warn('[wf] a resident could not be shown', error);
      }
    }
    try {
      mods.life.startDaily();
    } catch {
      // The island stays still.
    }
  } else {
    line.textContent = TEXT.missing;
  }

  // Orbit around the island's middle (the sky and the cloud sea do not count).
  const box = new Box3();
  mods.world.root.updateMatrixWorld(true);
  mods.world.root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry.computeBoundingSphere?.();
    if ((m.geometry.boundingSphere?.radius ?? 0) < 40) box.expandByObject(m);
  });
  const centre = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3());
  const span = box.isEmpty() ? 30 : Math.max(10, box.getSize(new Vector3()).length());
  let yaw = 0.6;
  let pitch = 0.42;
  let dist = span * 0.9;
  let auto = true;
  const cam = world.camera;
  cam.fov = 50;
  cam.updateProjectionMatrix();
  world.player.position.set(0, 0, 0);
  app.everyFrame((dt) => {
    if (auto) yaw += dt * 0.08;
    cam.position.set(centre.x + Math.sin(yaw) * Math.cos(pitch) * dist, centre.y + Math.sin(pitch) * dist, centre.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(centre);
  });
  const canvas = world.renderer.domElement;
  canvas.style.touchAction = 'none';
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  canvas.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.setPointerCapture(e.pointerId);
    auto = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) dist = Math.min(span * 2, Math.max(span * 0.25, dist * (pinch / d)));
      pinch = d;
    } else {
      yaw -= (e.clientX - p.x) * 0.006;
      pitch = Math.min(1.3, Math.max(0.08, pitch + (e.clientY - p.y) * 0.004));
    }
    p.x = e.clientX;
    p.y = e.clientY;
  });
  const up = (e: PointerEvent): void => {
    pointers.delete(e.pointerId);
    pinch = 0;
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      dist = Math.min(span * 2, Math.max(span * 0.25, dist * (1 + Math.sign(e.deltaY) * 0.08)));
    },
    { passive: false },
  );
  page.dataset.ready = 'yes';
}
