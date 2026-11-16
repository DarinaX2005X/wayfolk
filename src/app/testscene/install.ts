/**
 * The measuring scene of task 01.1.4, only with debug hooks on and `?testscene=1`: a
 * sphere on the arc, the bench slab and one uikit panel set in Atkinson ("Checking
 * quotes 124"). tests/xr/smoke.json opens it to compare renderer.info at the desk and in
 * an emulated session (the view factor), to check the zone count against renderer.info
 * and to look at the headset font. It adds nothing to a normal page.
 */
import { Mesh, MeshStandardMaterial, BoxGeometry, SphereGeometry, createSystem } from '@iwsdk/core';
import { Container, Text, reversePainterSortStable } from '@pmndrs/uikit';
import { COLOR, LAYOUT, TEXT, polar, textSizeFor } from '../../tokens/tokens';
import type { App } from '../boot/world';
import { debugEnabled, registerDebug } from '../debug';
import { zone } from '../perf/zone';

export const order = 1;

const panels: Container[] = [];
class TestPanelSystem extends createSystem({}) {
  update(delta: number): void {
    for (const panel of panels) panel.update(delta * 1000);
  }
}

export function install(app: App): void {
  if (!debugEnabled() || new URLSearchParams(location.search).get('testscene') !== '1') return;
  const { world, roots } = app;
  world.renderer.localClippingEnabled = true;
  world.renderer.setTransparentSort(reversePainterSortStable);

  // The slab of the bench: 0.9 × 0.45 m, 4 cm thick, top 0.32 m under the eyes.
  const slab = new Mesh(
    new BoxGeometry(LAYOUT.bench.w, LAYOUT.bench.h, LAYOUT.bench.d),
    new MeshStandardMaterial({ color: COLOR.slate, roughness: 0.6, metalness: 0 }),
  );
  slab.name = 'test:slab';
  slab.position.set(0, -0.32 - LAYOUT.bench.h / 2, -LAYOUT.bench.dist);
  roots.bench.add(zone(slab, 'sky-bench'));

  // A sphere at the middle station of the arc.
  const sphere = new Mesh(new SphereGeometry(0.06, 32, 16), new MeshStandardMaterial({ color: COLOR.bone, roughness: 0.45, metalness: 0 }));
  sphere.name = 'test:sphere';
  const at = polar(0, LAYOUT.arc.dist, -0.47 + 0.06);
  sphere.position.set(at.x, at.y, at.z);
  roots.arc.add(zone(sphere, 'arc'));

  // One panel above the far edge of the bench, text at the size of a station board line.
  const eye = 0.9;
  const size = textSizeFor('read', eye);
  const panel = new Container({
    sizeX: 0.42,
    sizeY: 0.12,
    pixelSize: 0.001,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLOR.bone,
    borderRadius: 14,
    padding: 10,
  });
  panel.name = 'test:panel';
  const head = new Text({ text: 'Checking quotes 124', fontSize: size * 1000, fontWeight: 700, color: COLOR.ink });
  const digits = new Text({ text: '1111 / 8888 / 0.5% / Q1 Il1 O0', fontSize: textSizeFor('label', eye) * 1000, color: COLOR.inkSoft });
  panel.add(head, digits);
  panel.position.set(0, -0.08, -eye);
  panels.push(panel);
  roots.ui.desk.add(zone(panel, 'bench-panels'));
  world.registerSystem(TestPanelSystem);
  registerDebug('testscene', { slab, sphere, panel, fontSize: size, largeFactor: TEXT.large });
}
