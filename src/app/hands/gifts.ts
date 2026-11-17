/**
 * Gifts by hand (PROJECT «Фишки» 8): a small fruit tree planted by the seat, its fruit
 * hanging within a seated arm's reach, and
 * at night a falling star that drifts down slowly enough to catch. Pinch near a gift to
 * take it; let go while pointing at a resident (or with the hand near one) and it flies
 * to them; mind.give answers and the resident says thank you. Let go elsewhere and it
 * floats back to where it was.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TubeGeometry,
  Vector2,
  Vector3,
  type BufferGeometry,
} from '@iwsdk/core';
import { say as caption } from '../../feel/captions';
import { sound } from '../../feel/sound';
import type { App } from '../boot/world';
import { registerTest } from '../debug';
import { anchorPoint, anchorYaw, type LifePort, type MindPort, type WorldPort } from '../ports';
import type { Hands, Side } from './hands';
import type { Replies } from './replies';

type Gift = { object: Object3D; kind: 'fruit' | 'star'; home: Vector3; heldBy: Side | null; flying: boolean };

export type Gifts = {
  /** Hangs the fruit by the seat, relative to the head now. */
  setUp(): void;
  /** Gives a gift to a resident without hands (desk, tests). */
  give(residentId: string, kind?: 'fruit' | 'star'): Promise<void>;
  enable(on: boolean): void;
  /** True while a hand holds a gift (its pinch is taken). */
  holding(): boolean;
};

function starSprite(): Sprite {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.3, 'rgba(255,230,150,0.8)');
  grad.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: t, blending: AdditiveBlending, depthWrite: false, transparent: true }));
  s.scale.setScalar(0.12);
  return s;
}

export function createGifts(
  app: App,
  hands: Hands,
  life: LifePort,
  mind: MindPort,
  replies: Replies,
  residentsNear: () => { id: string; object: Object3D; name: string }[],
  world?: WorldPort,
): Gifts {
  const group = new Group();
  group.name = 'gifts';
  group.visible = false;
  app.roots.fx.add(group);
  const gifts: Gift[] = [];
  const v = new Vector3();
  const w = new Vector3();
  const head = new Vector3();
  let enabled = false;
  let nextStarAt = 0;

  // Smooth, soft-lit fruit: a peach blush on the sunny side, a tiny stem and a leaf.
  const fruitMat = new MeshLambertMaterial({ vertexColors: true });
  const leafMat = new MeshLambertMaterial({ vertexColors: true });
  const barkMat = new MeshLambertMaterial({ color: '#7a5236' });
  const stemMat = new MeshLambertMaterial({ color: '#6b4a2c' });
  const tint = (g: BufferGeometry, fn: (x: number, y: number, z: number) => Color): BufferGeometry => {
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 1) {
      const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i));
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new BufferAttribute(col, 3));
    return g;
  };
  const warm = new Color('#ffb347');
  const blush = new Color('#e8583a');
  const pale = new Color('#ffd98a');
  const fruitGeo = tint(new SphereGeometry(0.034, 20, 14).scale(1, 0.94, 1), (x, y, z) => {
    const side = Math.max(0, Math.min(1, (x + z) / 0.05 + 0.5));
    return warm.clone().lerp(blush, side * 0.75).lerp(pale, Math.max(0, -y / 0.034) * 0.35);
  });
  const leafGeo = tint(new SphereGeometry(0.018, 10, 6).scale(1, 0.25, 0.5), (x) => new Color('#7cbf52').lerp(new Color('#3f7d34'), Math.max(0, Math.min(1, x / 0.018 + 0.5))));
  const stemGeo = new CylinderGeometry(0.003, 0.004, 0.06, 6).translate(0, 0.03, 0);

  const makeFruit = (): Object3D => {
    const g = new Group();
    const f = new Mesh(fruitGeo, fruitMat);
    const stem = new Mesh(stemGeo, stemMat);
    stem.position.y = 0.026;
    const leaf = new Mesh(leafGeo, leafMat);
    leaf.position.set(0.016, 0.05, 0);
    leaf.rotation.z = 0.5;
    g.add(f, stem, leaf);
    return g;
  };

  /**
   * The little tree: a fruit tree in a clay pot on the porch behind the right shoulder of
   * the seat, a curved trunk, a soft round crown overhead, and one branch bending forward
   * over the right hand with the fruit on it. Built once.
   */
  let tree: Group | null = null;
  const hangAt: Vector3[] = [];
  const plantTree = (): void => {
    if (tree || !world) return;
    const seat = anchorPoint(world.seat, new Vector3());
    const yaw = anchorYaw(world.seat);
    const right = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const fwd = new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const potAt = seat.clone().addScaledVector(right, 1.15).addScaledVector(fwd, -0.5);
    const base = Math.max(seat.y, world.groundY?.(potAt.x, potAt.z) ?? world.groundAt?.(potAt.x, potAt.z) ?? seat.y);
    const at = (r: number, f: number, up: number): Vector3 => {
      const p = seat.clone().addScaledVector(right, r).addScaledVector(fwd, f);
      p.y = base + up;
      return p;
    };
    tree = new Group();
    tree.name = 'gift:tree';
    // The pot: terracotta with a rolled rim and dark soil.
    const potGeo = new LatheGeometry(
      [
        [0, 0],
        [0.15, 0],
        [0.17, 0.04],
        [0.2, 0.26],
        [0.235, 0.27],
        [0.24, 0.31],
        [0.205, 0.32],
        [0.2, 0.3],
        [0, 0.3],
      ].map(([x, y]) => new Vector2(x, y)),
      24,
    );
    const pot = new Mesh(potGeo, new MeshLambertMaterial({ color: '#c46a43' }));
    pot.position.copy(at(1.15, -0.5, 0));
    tree.add(pot);
    const soil = new Mesh(new CylinderGeometry(0.195, 0.195, 0.02, 20), new MeshLambertMaterial({ color: '#4a3020' }));
    soil.position.copy(at(1.15, -0.5, 0.295));
    tree.add(soil);
    const trunk = new CatmullRomCurve3([at(1.15, -0.5, 0.28), at(1.13, -0.46, 0.8), at(1.04, -0.38, 1.32), at(0.98, -0.32, 1.72)]);
    tree.add(new Mesh(new TubeGeometry(trunk, 16, 0.045, 8, false), barkMat));
    // The fruiting branch reaches forward over the right hand of a seated person.
    const branch = new CatmullRomCurve3([at(1.07, -0.41, 1.12), at(0.88, -0.18, 1.19), at(0.68, 0.04, 1.16), at(0.48, 0.27, 1.08)]);
    tree.add(new Mesh(new TubeGeometry(branch, 14, 0.02, 6, false), barkMat));
    const twig = new CatmullRomCurve3([at(1.0, -0.34, 1.45), at(0.85, -0.12, 1.52), at(0.74, 0.0, 1.48)]);
    tree.add(new Mesh(new TubeGeometry(twig, 8, 0.013, 5, false), barkMat));
    // Crown: a few soft clumps, lighter on top.
    const crownGeo = tint(new IcosahedronGeometry(0.32, 3), (_x, y) => new Color('#4f8f3a').lerp(new Color('#8cc85a'), Math.max(0, Math.min(1, (y / 0.32) * 0.5 + 0.5))));
    const crownMat = new MeshLambertMaterial({ vertexColors: true });
    const clumps: [number, number, number, number][] = [
      [0.98, -0.32, 1.92, 1.0],
      [1.2, -0.5, 1.82, 0.8],
      [0.78, -0.12, 1.72, 0.7],
      [1.05, -0.12, 2.05, 0.7],
      [0.82, -0.4, 2.08, 0.62],
    ];
    for (const [r, f, u, k] of clumps) {
      const m = new Mesh(crownGeo, crownMat);
      m.position.copy(at(r, f, u));
      m.scale.set(k, k * 0.82, k);
      tree.add(m);
    }
    // Leaves along the fruiting branch.
    const leaves: [number, number, number, number][] = [
      [0.8, -0.08, 1.21, 0.4],
      [0.64, 0.08, 1.18, -0.5],
      [0.52, 0.22, 1.12, 0.9],
      [0.92, -0.24, 1.22, -1.2],
      [0.72, 0.0, 1.5, 0.2],
    ];
    for (const [r, f, u, a] of leaves) {
      const leaf = new Mesh(leafGeo, leafMat);
      leaf.position.copy(at(r, f, u));
      leaf.scale.setScalar(2.4);
      leaf.rotation.set(0.3, a, 0.4);
      tree.add(leaf);
    }
    hangAt.push(at(0.5, 0.25, 1.0), at(0.63, 0.1, 1.07), at(0.78, -0.07, 1.11));
    group.add(tree);
  };

  const flyTo = (gift: Gift, target: Object3D, done: () => void): void => {
    gift.flying = true;
    const from = gift.object.position.clone();
    const t0 = app.clock.now();
    const off = app.everyFrame((_dt, now) => {
      const k = Math.min(1, (now - t0) / 900);
      target.getWorldPosition(w);
      w.y += 0.6;
      gift.object.position.lerpVectors(from, w, k);
      gift.object.position.y += Math.sin(k * Math.PI) * 0.6;
      if (k >= 1) {
        off();
        gift.object.visible = false;
        done();
      }
    });
  };

  const handOver = async (gift: Gift, to: { id: string; object: Object3D; name: string }): Promise<void> => {
    sound.play('drop', { at: gift.object.position });
    await new Promise<void>((r) => flyTo(gift, to.object, r));
    try {
      const answer = await mind.give(to.id, gift.kind);
      life.emote(to.id, 'happy');
      caption({ source: to.name, text: answer.text });
      await life.say(to.id, answer.text, { name: to.name });
    } catch (error) {
      console.error('[wf] the gift was not taken', error);
    }
    // A new one grows back after a while.
    setTimeout(() => {
      if (gift.kind === 'fruit') {
        gift.object.position.copy(gift.home);
        gift.object.visible = true;
      } else {
        gift.object.removeFromParent();
        gifts.splice(gifts.indexOf(gift), 1);
      }
      gift.flying = false;
    }, 8000);
  };

  hands.onPinch((side, down, h) => {
    if (!enabled || replies.open || replies.consumed(side)) return;
    if (down) {
      for (const g of gifts) {
        if (g.flying || g.heldBy || !g.object.visible) continue;
        g.object.getWorldPosition(v);
        if (v.distanceTo(h.indexTip) < 0.07) {
          g.heldBy = side;
          sound.play('grab', { at: v });
          return;
        }
      }
      return;
    }
    const g = gifts.find((x) => x.heldBy === side);
    if (!g) return;
    g.heldBy = null;
    // Who is it for: the resident the hand points at, or the nearest one to the hand.
    let best: { id: string; object: Object3D; name: string } | null = null;
    let bestScore = 0.22; // about 13 degrees
    for (const r of residentsNear()) {
      r.object.getWorldPosition(w);
      w.y += 0.4;
      const d = w.clone().sub(h.rayOrigin).normalize();
      const off = 1 - d.dot(h.rayDir);
      const close = w.distanceTo(h.indexTip) < 0.8 ? 0 : 1;
      const score = Math.min(off, close);
      if (score < bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (best) void handOver(g, best);
    else g.flying = false;
  });

  app.everyFrame((dt, now) => {
    if (!enabled) return;
    for (const g of gifts) {
      if (g.heldBy) {
        const h = hands.get(g.heldBy);
        v.copy(h.indexTip).add(h.thumbTip).multiplyScalar(0.5);
        g.object.position.lerp(v, 1 - Math.exp(-dt * 30));
      } else if (!g.flying && g.kind === 'fruit') {
        g.object.position.lerp(g.home, 1 - Math.exp(-dt * 4));
      }
    }
    // A star at night, now and then.
    const hour = app.clock.wall().getHours();
    const night = hour >= 20 || hour < 6;
    if (night && now > nextStarAt && !gifts.some((x) => x.kind === 'star')) {
      nextStarAt = now + 45_000;
      app.world.camera.getWorldPosition(head);
      const star = starSprite();
      star.name = 'gift:star';
      const home = new Vector3(0.25, -0.15, -0.45).applyMatrix4(app.world.camera.matrixWorld);
      star.position.set(home.x + 1.5, home.y + 3, home.z - 1);
      group.add(star);
      const gift: Gift = { object: star, kind: 'star', home, heldBy: null, flying: false };
      gifts.push(gift);
      const t0 = now;
      const from = star.position.clone();
      const off = app.everyFrame((_d, t) => {
        if (gift.heldBy || gift.flying) {
          off();
          return;
        }
        const k = (t - t0) / 6000;
        if (k < 1) star.position.lerpVectors(from, home, k * (2 - k));
        else if (k > 3) {
          off();
          star.removeFromParent();
          gifts.splice(gifts.indexOf(gift), 1);
        }
      });
    }
  });

  return {
    setUp() {
      for (const g of gifts) g.object.removeFromParent();
      gifts.length = 0;
      plantTree();
      // The fruit hangs from the tree by the seat (placed from the seat, not the head, so it
      // is always in the same place within reach).
      let homes = hangAt;
      if (!homes.length) {
        const cam = app.world.camera;
        cam.updateWorldMatrix(true, false);
        homes = [0, 1].map((i) => new Vector3(0.3 + i * 0.09, -0.19 - i * 0.02, -0.38 + i * 0.03).applyMatrix4(cam.matrixWorld));
      }
      homes.forEach((home, i) => {
        const f = makeFruit();
        f.name = `gift:fruit:${i}`;
        f.position.copy(home);
        f.rotation.set(0.15 * (i - 1), i * 1.7, 0.1);
        group.add(f);
        gifts.push({ object: f, kind: 'fruit', home: home.clone(), heldBy: null, flying: false });
      });
    },
    async give(residentId, kind = 'fruit') {
      const to = residentsNear().find((r) => r.id === residentId);
      const g = gifts.find((x) => x.kind === kind && !x.flying && x.object.visible);
      if (!to || !g) return;
      await handOver(g, to);
    },
    enable(on) {
      enabled = on;
      group.visible = on;
    },
    holding: () => gifts.some((g) => g.heldBy !== null),
  };
}

export function registerGiftTest(gifts: Gifts): void {
  registerTest('give', (id: string, kind?: 'fruit' | 'star') => gifts.give(id, kind));
}
