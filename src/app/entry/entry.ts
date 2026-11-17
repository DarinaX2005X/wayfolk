/**
 * The way in and the way out, as timelines over the cloud effect (./clouds.ts):
 *
 *   enter()   room (passthrough) -> clouds rise -> walls dissolve into the sunset ->
 *             the person is seated on the island -> the clouds part, the island is there
 *   leave()   clouds rise -> sunset -> the room comes back with the island small and
 *             glowing on the real table (or 0.5 m ahead at lap height without a table)
 *   back()    from the table into the island again
 *
 * Without passthrough (a VR session, the desk) the same reveal starts from the sunset.
 */
import { Box3, Group, PointLight, Vector3, type Mesh, type Object3D } from '@iwsdk/core';
import { sound } from '../../feel/sound';
import type { App } from '../boot/world';
import { registerDebug } from '../debug';
import type { Anchor, WorldPort } from '../ports';
import type { Rig } from '../rig';
import { createCloudFx, makeTableGlow } from './clouds';

export type Entry = {
  /** `at`: where to sit (a guest sits at a spot of the host's island, not at the seat). */
  enter(at?: Anchor): Promise<void>;
  leave(): Promise<void>;
  back(): Promise<void>;
  /** Whether the room shows through (AR with passthrough). */
  passthrough(): boolean;
};

const ease = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

export function createEntry(app: App, world: WorldPort, rig: Rig, extras: () => Object3D[]): Entry {
  const fx = createCloudFx();
  app.roots.fx.add(fx.root);
  const head = new Vector3();
  const box = new Box3();
  const size = new Vector3();
  let tableGlow: Mesh | null = null;
  const tableLight = new PointLight('#ffc27a', 0, 1.5, 2);
  tableLight.name = 'farewell:light';
  app.roots.fx.add(tableLight);
  // Big things (the sky, the cloud sea) stay home when the island goes on the table.
  const hiddenOnTable: Object3D[] = [];
  const islandHome = { pos: new Vector3(), scale: 1, rotY: 0 };
  const tablePivot = new Group();
  tablePivot.name = 'farewell:pivot';
  app.roots.fx.add(tablePivot);

  app.everyFrame(() => {
    const cam = app.world.camera;
    cam.updateWorldMatrix(true, false);
    cam.getWorldPosition(head);
    fx.follow(head, app.world.player.position.y);
  });

  const pace = (): number => Math.max(0.05, app.store.pace.peek());
  const tween = (ms: number, fn: (k: number) => void): Promise<void> =>
    new Promise((resolve) => {
      const t0 = app.clock.now();
      const total = ms * pace();
      fn(0);
      const off = app.everyFrame((_dt, now) => {
        const k = Math.min(1, (now - t0) / total);
        fn(k);
        if (k >= 1) {
          off();
          resolve();
        }
      });
    });

  const passthrough = (): boolean => {
    const session = app.world.renderer.xr.getSession();
    return !!session && session.environmentBlendMode !== 'opaque' && app.session.kind() === 'immersive-ar';
  };

  const showIsland = (on: boolean): void => {
    world.root.visible = on;
    for (const o of extras()) o.visible = on;
    // Passthrough needs a clear background.
    app.world.scene.background = null;
  };

  let seatAt: Anchor | null = null;
  const seatPerson = (): void => {
    rig.placeAt(seatAt ?? world.seat);
  };

  const entry: Entry = {
    passthrough,
    async enter(at) {
      seatAt = at ?? null;
      const room = passthrough();
      app.store.look.value = 'entering';
      sound.play('bloom');
      if (room) {
        showIsland(false);
        fx.veil = 0;
        fx.fill = 0;
        fx.rise = -1;
        // The clouds rise from the floor and fill the room.
        await tween(3200, (k) => {
          fx.rise = -1 + ease(k);
          fx.fill = ease(Math.min(1, k * 1.6));
        });
        // The walls dissolve from the floor up into the sunset.
        await tween(2600, (k) => {
          fx.veil = ease(k);
        });
      } else {
        fx.veil = 1;
        fx.fill = 1;
        fx.rise = 0;
        await tween(350, () => undefined);
      }
      // Seated on the island, still inside the cloud.
      seatPerson();
      showIsland(true);
      await tween(room ? 500 : 250, () => undefined);
      // The clouds part outward and down; the sky of the island is there.
      await tween(room ? 3400 : 2300, (k) => {
        fx.veil = 1 - ease(Math.min(1, k * 1.4));
        fx.rise = ease(k);
        fx.fill = 1 - ease(Math.max(0, k - 0.45) / 0.55);
      });
      fx.fill = 0;
      fx.veil = 0;
      app.store.look.value = 'island';
    },
    async leave() {
      app.store.look.value = 'leaving';
      sound.play('fold');
      fx.rise = 0.6;
      await tween(2200, (k) => {
        fx.fill = ease(k);
        fx.rise = 0.6 * (1 - ease(k));
        fx.veil = ease(Math.max(0, k - 0.3) / 0.7);
      });
      const room = passthrough();
      // The island shrinks onto the table.
      islandHome.pos.copy(world.root.position);
      islandHome.scale = world.root.scale.x;
      islandHome.rotY = world.root.rotation.y;
      hiddenOnTable.length = 0;
      world.root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || !o.visible) return;
        mesh.geometry.computeBoundingSphere?.();
        const r = mesh.geometry.boundingSphere?.radius ?? 0;
        const s = o.getWorldScale(size).x;
        if (r * s > 40) {
          o.visible = false;
          hiddenOnTable.push(o);
        }
      });
      for (const o of extras()) o.visible = false;
      const cam = app.world.camera;
      cam.getWorldPosition(head);
      const table = app.surfaces.find('table');
      const spot = new Vector3();
      if (room && table) spot.copy(table.center).add(new Vector3(0, 0.01, 0));
      else {
        spot.set(0, 0, -0.55).applyMatrix4(cam.matrixWorld);
        spot.y = head.y - 0.42;
      }
      // Fit the island (without the big things) into about 0.42 m.
      world.root.scale.setScalar(1);
      world.root.position.set(0, 0, 0);
      world.root.updateMatrixWorld(true);
      box.makeEmpty();
      world.root.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.isMesh && o.visible) box.expandByObject(o);
      });
      box.getSize(size);
      const span = Math.max(1, Math.min(60, Math.max(size.x, size.z)));
      const scale = 0.42 / span;
      const centre = box.getCenter(new Vector3());
      world.root.scale.setScalar(scale);
      world.root.position.set(spot.x - centre.x * scale, spot.y - box.min.y * scale + 0.005, spot.z - centre.z * scale);
      if (!tableGlow) {
        tableGlow = makeTableGlow();
        app.roots.fx.add(tableGlow);
      }
      tableGlow.position.copy(spot).add(new Vector3(0, 0.004, 0));
      tableGlow.scale.setScalar(0.7);
      tableGlow.visible = true;
      tableLight.position.copy(spot).add(new Vector3(0, 0.25, 0));
      world.root.visible = true;
      app.world.scene.background = null;
      await tween(2400, (k) => {
        fx.veil = 1 - ease(k);
        fx.fill = 1 - ease(k);
        fx.rise = ease(k);
        tableLight.intensity = ease(k) * 1.2;
      });
      fx.veil = 0;
      fx.fill = 0;
      app.store.look.value = 'table';
    },
    async back() {
      app.store.look.value = 'entering';
      await tween(1500, (k) => {
        fx.fill = ease(k);
        fx.veil = ease(k);
        fx.rise = 0;
      });
      world.root.scale.setScalar(islandHome.scale || 1);
      world.root.position.copy(islandHome.pos);
      world.root.rotation.y = islandHome.rotY;
      for (const o of hiddenOnTable) o.visible = true;
      hiddenOnTable.length = 0;
      if (tableGlow) tableGlow.visible = false;
      tableLight.intensity = 0;
      seatPerson();
      showIsland(true);
      await tween(2600, (k) => {
        fx.veil = 1 - ease(k);
        fx.rise = ease(k);
        fx.fill = 1 - ease(k);
      });
      fx.veil = 0;
      fx.fill = 0;
      app.store.look.value = 'island';
    },
  };
  registerDebug('entry', { fx, enter: entry.enter, leave: entry.leave, back: entry.back, passthrough });
  return entry;
}
