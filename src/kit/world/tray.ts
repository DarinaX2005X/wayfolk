/**
 * Trays on the bench: bone, 16 × 11 cm (the long side in depth) with an 8 mm rim.
 * Slips land in a stack with a slight turn each, a counter tag stands at the far rim.
 * The "Try to fool the check" tray has its own small stamp head on a 5 cm post: it lives
 * after the run, when the gates on the arc are gone, and stamps the person's own tests.
 * Vermilion never lies on slate: slips always lie in the bone tray.
 */
import { Object3D, Vector3 } from '@iwsdk/core';
import { COLOR, LAYOUT } from '../../tokens/tokens';
import { bevelBox, box, cylinder, merge, placed, tint } from './geom';
import { followHandle } from './grabbable';
import { createLabel, setLabelText } from './label';
import { part } from './materials';
import { attachShadow } from './shadow';
import { animate, bump, lessMotion, now, progress, rand, easeOut } from './time';
import type { Slip, Tray } from './types';

const W = LAYOUT.traySent.w;
const D = LAYOUT.traySent.d;
const RIM = 0.008;
const FLOOR = 0.003;
const WALL = 0.004;
const SLIP_T = 0.0016;
const STAMP_MS = 90;
const LAND_MS = 260;

function trayGeometry(): ReturnType<typeof merge> {
  const bone = COLOR.bone;
  return merge([
    tint(bevelBox(W, FLOOR, D, 0.001, 0.008), bone),
    tint(placed(box(W, RIM, WALL), [0, FLOOR, -D / 2 + WALL / 2]), bone),
    tint(placed(box(W, RIM, WALL), [0, FLOOR, D / 2 - WALL / 2]), bone),
    tint(placed(box(WALL, RIM, D - 2 * WALL), [-W / 2 + WALL / 2, FLOOR, 0]), bone),
    tint(placed(box(WALL, RIM, D - 2 * WALL), [W / 2 - WALL / 2, FLOOR, 0]), bone),
    tint(placed(box(W - 2 * WALL, 0.0004, D - 2 * WALL), [0, FLOOR, 0]), COLOR.boneShade),
  ]);
}

export function createTray(kind: 'sent-back' | 'fool'): Tray {
  const root = new Object3D();
  root.name = `kit:tray:${kind}`;
  root.userData.target = `tray:${kind}`;
  const body = part(trayGeometry(), 'vcCeramic', `tray:${kind}`);
  root.add(body);
  attachShadow(body, { height: RIM + FLOOR, size: [W, D], rest: 0 });

  // The counter tag: a small bone tag standing on the far rim.
  const tag = new Object3D();
  tag.name = `tray:${kind}:count`;
  tag.userData.target = `tray:${kind}:count`;
  const tagBody = part(bevelBox(0.034, 0.024, 0.003, 0.0008, 0.003), 'bone', 'tray:tag');
  tag.add(tagBody);
  const tagText = createLabel('0', { role: 'label', width: 0.03, eyeDist: 0.5, weight: 700, lines: 1, align: 'center' });
  tagText.position.set(0, 0.012, 0.0018);
  tag.add(tagText);
  tag.position.set(0, FLOOR + RIM - 0.002, -D / 2 + WALL / 2);
  tag.rotation.x = -0.3;
  root.add(tag);

  // The fool tray's own stamp head on its post.
  const head = new Object3D();
  if (kind === 'fool') {
    const post = part(merge([cylinder(0.004, 0.005, 0.05, 12), placed(box(0.006, 0.006, 0.05), [0, 0.047, 0.022])]), 'slate', 'tray:post');
    post.position.set(W / 2 - 0.006, FLOOR, -D / 2 + 0.012);
    root.add(post);
    const block = part(merge([tint(bevelBox(0.026, 0.014, 0.026, 0.002, 0.003), COLOR.slate), tint(placed(box(0.022, 0.002, 0.022), [0, -0.002, 0]), COLOR.vermilion)]), 'vcSlate', 'tray:head');
    head.add(block);
    head.position.set(W / 2 - 0.006, FLOOR + 0.03, -D / 2 + 0.04);
    root.add(head);
  }

  const slips: Slip[] = [];
  const landedAt = new Map<Slip, number>();
  let stampAt = -Infinity;
  let stamped: Slip | null = null;
  const tmp = new Vector3();

  const stackPoint = (i: number, slip: Slip, out: Vector3): { pos: Vector3; yaw: number } => {
    const seed = slip.item.id.length * 31 + i;
    const yaw = (rand(seed, 1) - 0.5) * 0.22;
    out.set((rand(seed, 2) - 0.5) * 0.008, FLOOR + 0.0006 + i * SLIP_T, 0.012 + (rand(seed, 3) - 0.5) * 0.01);
    if (kind === 'fool') out.x -= 0.006;
    return { pos: out, yaw };
  };

  const tray: Tray = {
    root,
    kind,
    get count() {
      return slips.length;
    },
    slips() {
      return [...slips];
    },
    add(slip) {
      if (slips.includes(slip)) return;
      slips.push(slip);
      root.add(slip.handle, slip.proxy);
      landedAt.set(slip, now());
      slip.setOpen(0);
      setLabelText(tagText, String(slips.length));
    },
    remove(slip) {
      const i = slips.indexOf(slip);
      if (i < 0) return;
      slips.splice(i, 1);
      setLabelText(tagText, String(slips.length));
    },
    stamp(slip) {
      stamped = slip;
      stampAt = now();
    },
    update(t) {
      const reduced = lessMotion();
      slips.forEach((slip, i) => {
        if (slip.handle.parent !== root) return;
        const { pos, yaw } = stackPoint(i, slip, tmp);
        const k = reduced ? 1 : easeOut(progress(t, landedAt.get(slip) ?? -Infinity, LAND_MS));
        slip.handle.position.set(pos.x, pos.y + (1 - k) * 0.03, pos.z);
        slip.handle.rotation.set(0, yaw, 0);
        followHandle(slip);
      });
      if (kind === 'fool') {
        // The head comes down 15 mm in 90 ms and goes back up in 150 ms.
        const k = progress(t, stampAt, STAMP_MS + 150);
        const down = k * (STAMP_MS + 150) < STAMP_MS ? (k * (STAMP_MS + 150)) / STAMP_MS : 1 - (k * (STAMP_MS + 150) - STAMP_MS) / 150;
        head.position.y = FLOOR + 0.03 - 0.015 * (reduced ? 0 : Math.max(0, Math.min(1, down)) * (k < 1 ? 1 : 0));
        if (stamped && k >= STAMP_MS / (STAMP_MS + 150) && !stamped.marks.has('hole')) stamped.mark('hole');
      }
      void bump;
    },
  };
  animate(tray);
  return tray;
}
