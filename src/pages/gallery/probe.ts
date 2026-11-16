/**
 * Hands probe (task 01.3.1): the three hand actions of the product on plain bodies, in
 * the seated layout, before any view is built on them. Scenarios tests/xr/probe/*.json
 * drive it in the emulator and read `window.__gw.handProbe`.
 *
 * Bodies (seated frame, the bench top 0.32 m under the eyes):
 *   probe:cube    grey cube 5 cm on the slab, takeable (OneHandGrabbable on its handle)
 *   probe:plate   target plate 12 × 9 cm; a release within 8 cm pulls the cube onto it
 *   probe:bead    bead 3 cm on a 30 cm segment pointing at the seat; pull 15 cm commits
 *   probe:slip    slip 6 × 5 cm in a tray; lift 6 cm or turn 60° in the hand reveals it
 *   probe:button  button 44 mm at eye level straight ahead, for dwell
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Line,
  BufferGeometry,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import type { App } from '../../app/boot/world';
import { registerDebug } from '../../app/debug';
import { zone } from '../../app/perf/zone';
import { COLOR, MATERIAL, SEAT, polar } from '../../tokens/tokens';
import { onGrab, type Grabbable } from '../../interact/grab';
import { onPull } from '../../interact/pull';
import { onReveal } from '../../interact/reveal';
import { onSelect } from '../../interact/select';
import { target } from '../../interact/targets';
import { makeInteractable, now, whenAttached } from '../../interact/runtime';

export type ProbeEvent = { t: number; what: string; target: string; input?: string; hit?: string | null; why?: string; k?: number };

const TOP = -SEAT.benchBelowEyes;

const std = (color: string, roughness = 0.6): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness, metalness: 0 });

/** A takeable body: handle (moved by the grab), body (drawn) and proxy (hit by rays and the mouse). */
function takeable(name: string, body: Mesh, size: [number, number, number]): Grabbable & { handle: Group } {
  const handle = new Group();
  handle.name = name;
  body.name = `${name}:body`;
  handle.add(body);
  const proxy = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ visible: false }));
  proxy.name = `${name}:proxy`;
  return { handle, body, proxy };
}

export function buildHandsProbe(app: App, parent: Object3D): () => void {
  const root = zone(new Group(), 'reserve');
  root.name = 'probe';
  parent.add(root);
  const log: ProbeEvent[] = [];
  const add = (e: Omit<ProbeEvent, 't'>): void => {
    log.push({ t: Math.round(now()), ...e });
    if (log.length > 400) log.shift();
  };
  const offs: (() => void)[] = [];

  // ---- the slab, so the bodies lie on something
  const slab = new Mesh(new BoxGeometry(0.9, 0.04, 0.45), std(COLOR.slate, MATERIAL.slate.roughness));
  slab.position.set(0, TOP - 0.02, -0.45);
  slab.name = 'probe:slab';
  root.add(slab);

  // ---- (1) cube and plate
  const cubeAt = polar(-14, 0.47, TOP + 0.025);
  const cube = takeable('probe:cube', new Mesh(new BoxGeometry(0.05, 0.05, 0.05), std('#8C9296', 0.5)), [0.05, 0.05, 0.05]);
  cube.handle.position.set(cubeAt.x, cubeAt.y, cubeAt.z);
  root.add(cube.handle, cube.proxy);
  const plateAt = polar(14, 0.5, TOP + 0.002);
  const plate = new Mesh(new BoxGeometry(0.12, 0.004, 0.09), std(COLOR.bone, MATERIAL.bone.roughness));
  plate.position.set(plateAt.x, plateAt.y, plateAt.z);
  plate.name = 'probe:plate';
  root.add(plate);
  // The cube lands with its base on the plate.
  const plateSnap = new Group();
  plateSnap.position.set(0, 0.025, 0);
  plate.add(plateSnap);
  target('probe:cube', cube.proxy);
  target('probe:plate', plate);
  // The plate is a surface the emulated hand can be sent to (xr list-targets lists entities that answer input).
  whenAttached(plate, ({ world }) => makeInteractable(world, plate));
  offs.push(
    onGrab(cube, {
      snapTo: [{ target: plateSnap, radius: 0.08 }],
      onTake: (hand) => add({ what: 'grab', target: 'probe:cube', input: hand }),
      onDrop: (hit, why) => add({ what: 'drop', target: 'probe:cube', hit: hit ? 'probe:plate' : null, why }),
    }),
    // (2) the same object selected from afar through its proxy
    onSelect(cube.proxy, (input) => add({ what: 'select', target: 'probe:cube', input }), { nearOf: cube.handle }),
  );

  // ---- (3) bead on a segment toward the seat
  const beadFar = polar(0, 0.95, -0.12);
  const beadNear = polar(0, 0.65, -0.12);
  const segment = new Line(
    new BufferGeometry().setFromPoints([new Vector3(beadFar.x, beadFar.y, beadFar.z), new Vector3(beadNear.x, beadNear.y, beadNear.z)]),
    new LineBasicMaterial({ color: COLOR.vermilion }),
  );
  segment.name = 'probe:segment';
  const bead = new Mesh(new SphereGeometry(0.015, 20, 14), std(COLOR.vermilion, 0.5));
  bead.position.set(beadFar.x, beadFar.y, beadFar.z);
  bead.name = 'probe:bead';
  root.add(segment, bead);
  target('probe:bead', bead);
  let pullK = 0;
  offs.push(
    onPull(bead, {
      toward: 'seat',
      threshold: 0.15,
      onProgress: (k) => {
        pullK = Math.max(pullK, k);
      },
      onCommit: () => add({ what: 'pull-commit', target: 'probe:bead', k: pullK }),
      onCancel: () => {
        add({ what: 'pull-cancel', target: 'probe:bead', k: pullK });
        pullK = 0;
      },
    }),
  );

  // ---- (4) slip in a tray
  const trayAt = polar(26, 0.47, TOP + 0.004);
  const tray = new Mesh(new BoxGeometry(0.11, 0.008, 0.16), std(COLOR.bone, MATERIAL.bone.roughness));
  tray.position.set(trayAt.x, trayAt.y, trayAt.z);
  tray.name = 'probe:tray';
  root.add(tray);
  const slip = takeable('probe:slip', new Mesh(new BoxGeometry(0.06, 0.003, 0.05), std(COLOR.paper, MATERIAL.paper.roughness)), [0.06, 0.012, 0.05]);
  const stamp = new Mesh(new CylinderGeometry(0.009, 0.009, 0.0005, 24), std(COLOR.vermilion, 0.8));
  stamp.position.set(-0.015, 0.0018, 0);
  slip.body.add(stamp);
  slip.handle.position.set(trayAt.x, trayAt.y + 0.007, trayAt.z);
  root.add(slip.handle, slip.proxy);
  target('probe:slip', slip.proxy);
  let open = false;
  offs.push(
    onGrab(slip, {
      onTake: (hand) => add({ what: 'grab', target: 'probe:slip', input: hand }),
      onDrop: (hit, why) => add({ what: 'drop', target: 'probe:slip', hit: hit ? 'tray' : null, why }),
    }),
    onReveal(slip, {
      lift: 0.06,
      turnDeg: 60,
      onOpen: () => {
        open = true;
        slip.body.scale.set(1.6, 1, 1.6);
        add({ what: 'reveal-open', target: 'probe:slip' });
      },
      onClose: () => {
        open = false;
        slip.body.scale.set(1, 1, 1);
        add({ what: 'reveal-close', target: 'probe:slip' });
      },
    }),
  );

  // ---- (5) a 44 mm button at eye level, straight ahead
  const button = new Mesh(new CylinderGeometry(0.022, 0.022, 0.012, 32), std(COLOR.cobalt, 0.45));
  button.rotation.x = Math.PI / 2;
  const buttonAt = polar(0, 0.8, 0);
  button.position.set(buttonAt.x, buttonAt.y, buttonAt.z);
  button.name = 'probe:button';
  const plateBehind = new Mesh(new BoxGeometry(0.08, 0.08, 0.006), std(COLOR.bone, MATERIAL.bone.roughness));
  plateBehind.position.set(buttonAt.x, buttonAt.y, buttonAt.z - 0.008);
  root.add(plateBehind, button);
  target('probe:button', button);
  offs.push(onSelect(button, (input) => add({ what: 'select', target: 'probe:button', input })));

  const api = {
    log,
    reset: () => {
      log.length = 0;
      pullK = 0;
    },
    last: (what: string, name?: string) => [...log].reverse().find((e) => e.what === what && (!name || e.target === name)) ?? null,
    count: (what: string, name?: string) => log.filter((e) => e.what === what && (!name || e.target === name)).length,
    open: () => open,
    /** Where a body is now, seated frame (x right, y up, z back), metres. */
    at: (name: 'cube' | 'slip' | 'bead') => {
      const obj = name === 'cube' ? cube.handle : name === 'slip' ? slip.handle : bead;
      const p = obj.getWorldPosition(new Vector3());
      app.roots.seat.worldToLocal(p);
      return [p.x, p.y, p.z].map((n) => Math.round(n * 1000) / 1000);
    },
    plate: () => [plateAt.x, plateAt.y + 0.025, plateAt.z].map((n) => Math.round(n * 1000) / 1000),
    home: () => [cubeAt.x, cubeAt.y, cubeAt.z].map((n) => Math.round(n * 1000) / 1000),
  };
  registerDebug('handProbe', api);

  return () => {
    for (const off of offs) off();
    root.removeFromParent();
  };
}
