/**
 * The fan of notebooks on the bench (DESIGN "Веер тетрадей"): up to 24 notebooks along
 * an arc of 0.7 m, centre 0°, 0.50 m from the head, in order of their total score. Each
 * lies over the one before it, so of each one a strip of 2.9 cm shows: on it only the
 * total in figures (20 dmm) and two initials (14 dmm). The full name rises as a caption
 * over the notebook under the pointer and its two neighbours.
 *
 *   raise(ids, on)  lifts notebooks 3 cm: the ones an edit will touch
 *   reorder(ids)    moves the fan into a new order in 500 ms, 40 ms apart
 *   open(id)        takes the notebook out to the middle and opens it
 *
 * Notebooks waiting for the teacher carry an amber clip, a notebook too short to mark a
 * grey band; two similar essays are joined by the red thread. Built from data only.
 *
 * Root: the seated frame (the fan's own batch draws it).
 */
import { Object3D, Vector3 } from '@iwsdk/core';
import { COLOR, LAYOUT, SEAT, polar } from '../../tokens/tokens';
import { createBatch } from './batch';
import { bevelBox, box } from './geom';
import { createLabel } from './label';
import { part, type KitMat } from './materials';
import { attachShadow } from './shadow';
import { createThread } from './thread';
import { animate, easeBack, easeInOut, lessMotion, now, progress, rand } from './time';
import type { FanEssay, NotebookFan, ThreadView } from './types';

const NB = { w: 0.17, d: 0.22, h: 0.006 };
const STRIP = 0.029;
const RAISE = 0.03;
const ORDER_MS = 500;
const STAGGER = 40;
const TOP = -SEAT.benchBelowEyes;
const CENTER = LAYOUT.notebookFan.dist;
const TONE: KitMat[] = ['ochre', 'sage', 'steelMatte'];

type Book = {
  essay: FanEssay;
  node: Object3D;
  cover: Object3D;
  name: ReturnType<typeof createLabel>;
  from: number;
  to: number;
  movedAt: number;
  raised: boolean;
  raisedAt: number;
};

export function createNotebookFan(essays: FanEssay[]): NotebookFan {
  const root = new Object3D();
  root.name = 'kit:notebook-fan';
  const list = essays.slice(0, 24);
  const n = list.length;
  const coverGeo = bevelBox(NB.w, 0.0012, NB.d, 0.0004, 0.004);
  const pagesGeo = box(NB.w - 0.006, NB.h - 0.0026, NB.d - 0.005);
  const bandGeo = box(NB.w, 0.0004, 0.026);
  const clipGeo = box(0.01, 0.003, 0.03);

  /** Pose of the slot i of the fan: along the arc, each one a little higher. */
  const slotPose = (i: number, out: { pos: Vector3; yaw: number }): void => {
    const arcAngle = LAYOUT.notebookFan.arc / CENTER; // radians covered by the visible strips
    const a = n > 1 ? -arcAngle / 2 + (i / (n - 1)) * arcAngle - STRIP / 2 / CENTER : 0;
    const p = polar((a * 180) / Math.PI, CENTER, TOP + 0.0015 * i);
    out.pos.set(p.x, p.y, p.z);
    out.yaw = -a;
  };

  const books: Book[] = list.map((essay, i) => {
    const node = new Object3D();
    node.name = `notebook:${essay.id}`;
    node.userData.target = `notebook:${essay.id}`;
    const tone = TONE[Math.floor(rand(i, essay.initials.length) * 3) % 3];
    const back = part(coverGeo, tone, 'notebook:back');
    const pages = part(pagesGeo, 'paper', 'notebook:pages');
    pages.position.y = 0.0012;
    const hinge = new Object3D();
    hinge.position.set(-NB.w / 2, NB.h - 0.0012, 0);
    const cover = part(coverGeo, tone, 'notebook:cover');
    cover.position.x = NB.w / 2;
    hinge.add(cover);
    node.add(back, pages, hinge);
    // The visible strip: its left edge. Total near the person, initials above it.
    const total = createLabel(String(essay.total), { role: 'body', width: STRIP - 0.004, eyeDist: 0.59, weight: 700, lines: 1, align: 'center' });
    total.rotation.x = -Math.PI / 2;
    total.position.set(-NB.w / 2 + STRIP / 2, 0.0013, NB.d / 2 - 0.022);
    const initials = createLabel(essay.initials.slice(0, 2), { role: 'label', width: STRIP - 0.004, eyeDist: 0.59, lines: 1, align: 'center', color: COLOR.inkSoft });
    initials.rotation.x = -Math.PI / 2;
    initials.position.set(-NB.w / 2 + STRIP / 2, 0.0013, NB.d / 2 - 0.045);
    cover.add(total, initials);
    if (essay.review) {
      const clip = part(clipGeo, 'amber', 'notebook:clip');
      clip.position.set(-NB.w / 2 + STRIP / 2, 0.0006, -NB.d / 2 + 0.012);
      cover.add(clip);
    }
    if (essay.tooShort) {
      const band = part(bandGeo, 'outline', 'notebook:too-short');
      band.position.set(0, 0.0014, -0.02);
      cover.add(band);
    }
    const name = createLabel(essay.name ?? essay.initials, { role: 'label', width: 0.16, eyeDist: 0.55, lines: 1, weight: 700, align: 'center' });
    name.position.set(-NB.w / 2 + STRIP / 2, 0.05, NB.d / 2 - 0.03);
    name.visible = false;
    node.add(name);
    attachShadow(node, { height: NB.h, size: [NB.w, NB.d], strength: 0.5, rest: TOP + 0.0015 * i });
    root.add(node);
    return { essay, node, cover: hinge, name, from: i, to: i, movedAt: -Infinity, raised: false, raisedAt: -Infinity };
  });

  // Red threads between neighbouring similar essays.
  const threads: { a: Book; b: Book; view: ThreadView }[] = [];
  const similar = books.filter((b) => b.essay.similar);
  for (let i = 0; i + 1 < similar.length; i += 2) {
    const view = createThread({ eyeDist: 0.55 });
    root.add(view.root);
    threads.push({ a: similar[i], b: similar[i + 1], view });
  }

  let openId: string | null = null;
  let openAt = -Infinity;
  let hoverId: string | null = null;
  const pose = { pos: new Vector3(), yaw: 0 };
  const poseB = { pos: new Vector3(), yaw: 0 };
  const pa = new Vector3();
  const pb = new Vector3();

  const fan: NotebookFan = {
    root,
    raise(ids, on) {
      const t = now();
      let k = 0;
      for (const b of books) {
        if (!ids.includes(b.essay.id) || b.raised === on) continue;
        b.raised = on;
        b.raisedAt = t + k * STAGGER;
        k += 1;
      }
    },
    reorder(ids) {
      const t = now();
      ids.forEach((id, i) => {
        const b = books.find((x) => x.essay.id === id);
        if (!b || b.to === i) return;
        b.from = b.to;
        b.to = i;
        b.movedAt = t + i * STAGGER;
      });
    },
    open(id) {
      openId = id;
      openAt = now();
    },
    hover(id) {
      hoverId = id;
    },
    notebook(id) {
      return books.find((b) => b.essay.id === id)?.node ?? null;
    },
    update(t) {
      const reduced = lessMotion();
      const hoverIndex = hoverId ? books.find((b) => b.essay.id === hoverId)?.to ?? -9 : -9;
      for (const b of books) {
        const km = reduced ? 1 : easeInOut(progress(t, b.movedAt, ORDER_MS));
        slotPose(b.from, poseB);
        slotPose(b.to, pose);
        pose.pos.lerp(poseB.pos, 1 - km);
        pose.yaw += (poseB.yaw - pose.yaw) * (1 - km);
        const kr = reduced ? 1 : easeBack(progress(t, b.raisedAt, 220), 0.06);
        const lift = b.raised ? RAISE * kr : RAISE * (1 - kr) * (b.raisedAt > -Infinity ? 1 : 0);
        b.node.position.set(pose.pos.x, pose.pos.y + Math.max(0, lift), pose.pos.z);
        b.node.rotation.set(0, pose.yaw, 0);
        // Open: out to the middle in front, cover swings open.
        const isOpen = openId === b.essay.id;
        const ko = isOpen ? (reduced ? 1 : easeInOut(progress(t, openAt, 450))) : 0;
        if (ko > 0) {
          b.node.position.lerp(pa.set(0, TOP + 0.05, -0.42), ko);
          b.node.rotation.y = pose.yaw * (1 - ko);
        }
        b.cover.rotation.z = -Math.PI * 0.97 * Math.max(0, (ko - 0.4) / 0.6);
        b.name.visible = hoverIndex >= 0 && Math.abs(b.to - hoverIndex) <= 1;
      }
      for (const th of threads) {
        th.a.node.updateMatrix();
        th.b.node.updateMatrix();
        pa.set(-NB.w / 2 + STRIP / 2, 0.012, 0).applyMatrix4(th.a.node.matrix);
        pb.set(-NB.w / 2 + STRIP / 2, 0.012, 0).applyMatrix4(th.b.node.matrix);
        if (th.view.root.userData.set !== `${pa.toArray()}${pb.toArray()}`) {
          th.view.set({ a: pa, b: pb, label: 'Similar', state: 'open' });
          th.view.root.userData.set = `${pa.toArray()}${pb.toArray()}`;
        }
      }
    },
  };
  animate(fan);
  createBatch(root);
  return fan;
}
