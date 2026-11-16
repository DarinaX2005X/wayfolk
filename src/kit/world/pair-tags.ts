/**
 * Paired tags at the reconcile station (DESIGN "Парные бирки сверки"): for every
 * candidate pair two joined paper tags 4 × 3 cm lie on the shelf, up to fourteen pairs in
 * two rows 6 cm apart. A judgement answers on the pair: "contradiction" pulls the two
 * tags together and ties them with red thread, "explained" moves them apart with a moss
 * check, "unsure" colours the pair amber, "unjudged" greys it. `release()` sends the
 * contradiction tags off to the project object, where they become its red tags.
 *
 * Origin at the centre of the group on the shelf; x along the shelf, +z toward the person.
 */
import { Object3D, Vector3 } from '@iwsdk/core';
import { bevelBox, box, merge, placed, flatRing } from './geom';
import { part, setMat } from './materials';
import { animate, easeInOut, easeOut, lessMotion, now, progress, clamp01 } from './time';
import type { PairTags, PairVerdict } from './types';

const TAG = { w: 0.04, d: 0.03, h: 0.0015 };
const STEP = 0.06;
const PER_ROW = 7;
const MOVE_MS = 320;
const FLY_MS = 700;

type Pair = { key: string; base: Vector3; node: Object3D; a: ReturnType<typeof part>; b: ReturnType<typeof part>; tie: ReturnType<typeof part>; check: ReturnType<typeof part>; verdict: PairVerdict | null; at: number; released: number };

export function createPairTags(): PairTags {
  const root = new Object3D();
  root.name = 'kit:pair-tags';
  const tagGeo = bevelBox(TAG.w, TAG.h, TAG.d, 0.0004, 0.003);
  const stringGeo = box(0.0012, 0.0008, 0.012);
  const tieGeo = merge([placed(flatRing(0.026, 0.0012, 28), [0, 0, 0], [0, 0, 0], [0.9, 1, 1.35])]);
  const checkGeo = merge([placed(box(0.008, 0.001, 0.0025), [-0.003, 0, 0.002], [0, -0.8, 0]), placed(box(0.014, 0.001, 0.0025), [0.003, 0, -0.001], [0, 0.85, 0])]);
  let pairs: Pair[] = [];

  const slot = (i: number, n: number): Vector3 => {
    const row = Math.floor(i / PER_ROW);
    const inRow = Math.min(PER_ROW, n - row * PER_ROW);
    const col = i % PER_ROW;
    return new Vector3((col - (inRow - 1) / 2) * STEP, 0, row === 0 ? 0.04 : -0.045);
  };

  const view: PairTags = {
    root,
    set(list) {
      for (const p of pairs) p.node.removeFromParent();
      const n = Math.min(14, list.length);
      pairs = list.slice(0, 14).map(({ key }, i) => {
        const node = new Object3D();
        node.name = `pair:${key}`;
        node.userData.target = `pair:${key}`;
        node.position.copy(slot(i, n));
        const a = part(tagGeo, 'paper', 'pair:a');
        const b = part(tagGeo, 'paper', 'pair:b');
        const string = part(stringGeo, 'edge', 'pair:string');
        const tie = part(tieGeo, 'thread', 'pair:tie');
        tie.position.y = TAG.h + 0.0008;
        tie.visible = false;
        const check = part(checkGeo, 'moss', 'pair:check');
        check.visible = false;
        node.add(a, b, string, tie, check);
        root.add(node);
        return { key, base: node.position.clone(), node, a, b, tie, check, verdict: null, at: -Infinity, released: -Infinity };
      });
    },
    mark(key, verdict) {
      const p = pairs.find((x) => x.key === key);
      if (!p) return;
      p.verdict = verdict;
      p.at = now();
      const color = verdict === 'unsure' ? 'amber' : verdict === 'unjudged' ? 'outline' : 'paper';
      setMat(p.a, color);
      setMat(p.b, color);
    },
    release() {
      const t = now();
      const keys: string[] = [];
      for (const p of pairs) {
        if (p.verdict === 'contradiction') {
          p.released = t;
          keys.push(p.key);
        }
      }
      return keys;
    },
    point(key) {
      const p = pairs.find((x) => x.key === key);
      if (!p) return null;
      p.node.updateWorldMatrix(true, false);
      return p.node.getWorldPosition(new Vector3());
    },
    update(t) {
      const reduced = lessMotion();
      for (const p of pairs) {
        const k = reduced ? 1 : easeInOut(progress(t, p.at, MOVE_MS));
        // Gap between the two tags: 6 mm at rest, 0 tied, 22 mm explained.
        const target = p.verdict === 'contradiction' ? 0.0005 : p.verdict === 'explained' ? 0.022 : 0.006;
        const gap = 0.006 + (target - 0.006) * k;
        p.a.position.set(0, 0, gap / 2 + TAG.d / 2);
        p.b.position.set(0, 0, -gap / 2 - TAG.d / 2);
        const turn = p.verdict === 'explained' ? 0.12 * k : p.verdict === 'contradiction' ? -0.05 * k : 0;
        p.a.rotation.y = turn;
        p.b.rotation.y = -turn;
        p.tie.visible = p.verdict === 'contradiction';
        p.tie.scale.setScalar(0.6 + 0.4 * (reduced ? 1 : easeOut(clamp01((t - p.at) / 220))));
        p.check.visible = p.verdict === 'explained';
        p.check.position.set(0.012, TAG.h + 0.0006, gap / 2 + TAG.d / 2);
        // Released: rise and leave toward the plot behind the arc.
        const kf = reduced ? (t >= p.released ? 1 : 0) : progress(t, p.released, FLY_MS);
        p.node.visible = kf < 1;
        const base = p.base;
        p.node.position.set(base.x * (1 - kf), base.y + 0.12 * Math.sin(Math.PI * kf * 0.8) + 0.05 * kf, base.z - 0.4 * easeInOut(kf));
        p.node.scale.setScalar(1 - 0.5 * kf);
      }
    },
  };
  animate(view);
  return view;
}
