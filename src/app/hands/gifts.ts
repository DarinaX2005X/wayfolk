/**
 * Gifts by hand (PROJECT «Фишки» 8): a little fruit branch within reach of the seat, and
 * at night a falling star that drifts down slowly enough to catch. Pinch near a gift to
 * take it; let go while pointing at a resident (or with the hand near one) and it flies
 * to them; mind.give answers and the resident says thank you. Let go elsewhere and it
 * floats back to where it was.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import { sound } from '../../feel/sound';
import type { App } from '../boot/world';
import { registerTest } from '../debug';
import type { LifePort, MindPort } from '../ports';
import type { Hands, Side } from './hands';
import type { Replies } from './replies';

type Gift = { object: Object3D; kind: 'fruit' | 'star'; home: Vector3; heldBy: Side | null; flying: boolean };

export type Gifts = {
  /** Hangs the fruit by the seat, relative to the head now. */
  setUp(): void;
  /** Gives a gift to a resident without hands (desk, tests). */
  give(residentId: string, kind?: 'fruit' | 'star'): Promise<void>;
  enable(on: boolean): void;
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

  const fruitMat = new MeshLambertMaterial({ color: '#ff9f43', flatShading: true });
  const leafMat = new MeshLambertMaterial({ color: '#5c9e47', flatShading: true });
  const branchMat = new MeshLambertMaterial({ color: '#7a5236', flatShading: true });

  const makeFruit = (): Object3D => {
    const g = new Group();
    const f = new Mesh(new SphereGeometry(0.03, 10, 8), fruitMat);
    const leaf = new Mesh(new ConeGeometry(0.012, 0.03, 5), leafMat);
    leaf.position.y = 0.034;
    leaf.rotation.z = 0.5;
    g.add(f, leaf);
    return g;
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
      const cam = app.world.camera;
      cam.updateWorldMatrix(true, false);
      // A small branch by the right hand of the seat.
      const branch = new Mesh(new CylinderGeometry(0.008, 0.012, 0.32, 5), branchMat);
      branch.position.set(0.36, -0.12, -0.38).applyMatrix4(cam.matrixWorld);
      branch.rotation.z = Math.PI / 2.4;
      branch.name = 'gift:branch';
      group.add(branch);
      for (let i = 0; i < 2; i += 1) {
        const f = makeFruit();
        f.name = `gift:fruit:${i}`;
        const home = new Vector3(0.3 + i * 0.09, -0.19 - i * 0.02, -0.38 + i * 0.03).applyMatrix4(cam.matrixWorld);
        f.position.copy(home);
        group.add(f);
        gifts.push({ object: f, kind: 'fruit', home, heldBy: null, flying: false });
      }
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
  };
}

export function registerGiftTest(gifts: Gifts): void {
  registerTest('give', (id: string, kind?: 'fruit' | 'star') => gifts.give(id, kind));
}
