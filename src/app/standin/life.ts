/**
 * A thin stand-in for `createLife` (src/life/), used only until the life module lands:
 * Pip and a small flock of round birds, a balloon that brings the traveler to the pier,
 * birds that carry the house pieces in, paper speech bubbles with captions.
 */
import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import { say as caption } from '../../feel/captions';
import { disposeBubble, makeBubble } from '../../kit/ui/bubble';
import type { Resident } from '../../mind/types';
import { anchorPoint, type AppHandle, type BuildStep, type LifePort, type WorldPort } from '../ports';

const lam = (c: string): MeshLambertMaterial => new MeshLambertMaterial({ color: c, flatShading: true });

function makeBird(body: string, belly: string, size = 0.09): Group {
  const g = new Group();
  const b = new Mesh(new SphereGeometry(size, 12, 9), lam(body));
  b.scale.set(1, 0.92, 1.05);
  const tummy = new Mesh(new SphereGeometry(size * 0.75, 10, 8), lam(belly));
  tummy.position.set(0, -size * 0.18, -size * 0.38);
  const eyeM = lam('#1d1410');
  for (const s of [-1, 1]) {
    const e = new Mesh(new SphereGeometry(size * 0.17, 8, 6), eyeM);
    e.position.set(s * size * 0.42, size * 0.25, -size * 0.78);
    const hi = new Mesh(new SphereGeometry(size * 0.06, 6, 4), lam('#ffffff'));
    hi.position.set(s * size * 0.45, size * 0.31, -size * 0.92);
    const wing = new Mesh(new SphereGeometry(size * 0.5, 8, 6), lam(body));
    wing.scale.set(0.35, 0.7, 1);
    wing.position.set(s * size * 0.95, 0, 0.02);
    wing.name = s < 0 ? 'wing-l' : 'wing-r';
    g.add(e, hi, wing);
  }
  const beak = new Mesh(new ConeGeometry(size * 0.18, size * 0.4, 6), lam('#f4a340'));
  beak.rotation.x = -Math.PI / 2;
  beak.position.set(0, size * 0.05, -size * 1.05);
  g.add(b, tummy, beak);
  return g;
}

function makeResident(r: Resident): Group {
  const g = new Group();
  g.name = `resident:${r.id}`;
  const main = lam(r.colors.main);
  const accent = lam(r.colors.accent);
  const body = new Mesh(new SphereGeometry(0.22, 12, 9), main);
  body.scale.set(1, 1.25, 0.95);
  body.position.y = 0.3;
  const head = new Mesh(new SphereGeometry(0.17, 12, 9), main);
  head.position.y = 0.68;
  const snout = new Mesh(new SphereGeometry(0.07, 8, 6), accent);
  snout.position.set(0, 0.64, 0.15);
  const scarf = new Mesh(new CylinderGeometry(0.15, 0.17, 0.06, 12), accent);
  scarf.position.y = 0.53;
  g.add(body, head, snout, scarf);
  for (const s of [-1, 1]) {
    const ear = new Mesh(new ConeGeometry(0.05, 0.13, 6), main);
    ear.position.set(s * 0.1, 0.84, 0);
    const eye = new Mesh(new SphereGeometry(0.025, 6, 4), lam('#1d1410'));
    eye.position.set(s * 0.06, 0.71, 0.14);
    g.add(ear, eye);
  }
  return g;
}

function makeBalloon(r: Resident): Group {
  const g = new Group();
  const env = new Mesh(new SphereGeometry(1.1, 16, 12), lam(r.colors.accent));
  env.scale.set(1, 1.15, 1);
  env.position.y = 2.6;
  const band = new Mesh(new CylinderGeometry(1.12, 1.12, 0.3, 16), lam('#fff1d6'));
  band.position.y = 2.6;
  const basket = new Mesh(new CylinderGeometry(0.42, 0.36, 0.45, 10), lam('#9b6a40'));
  basket.position.y = 0.6;
  g.add(env, band, basket);
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
    const rope = new Mesh(new CylinderGeometry(0.01, 0.01, 1.3, 4), lam('#5a4030'));
    rope.position.set(x, 1.4, z);
    g.add(rope);
  }
  return g;
}

export function createStandinLife(app: AppHandle, world: WorldPort): LifePort {
  const root = new Group();
  root.name = 'standin:life';
  world.root.add(root);
  const v = new Vector3();
  const w = new Vector3();

  // ---- Pip
  const pipObj = makeBird('#ff8a3d', '#ffd9a0', 0.055);
  pipObj.name = 'pip';
  app.scene.add(pipObj);
  let pipTarget: Object3D | null = null;
  let pipMode: 'hover' | 'hand' = 'hover';
  pipObj.position.set(0, 1.2, 7);

  // ---- flock
  const flock: Group[] = [];
  const colours = [['#4fb0c6', '#d8f1f5'], ['#f2c14e', '#fff3c4'], ['#7bc67b', '#e2f5d8'], ['#e86a6a', '#ffd7d0'], ['#9c8ade', '#e7e0ff'], ['#4fb0c6', '#d8f1f5']];
  colours.forEach(([a, b], i) => {
    const bird = makeBird(a, b, 0.08);
    bird.name = `bird:${i}`;
    bird.position.set(Math.cos(i) * 5, 4 + i * 0.3, Math.sin(i) * 5);
    root.add(bird);
    flock.push(bird);
  });
  let carrying = 0;

  const residents = new Map<string, Group>();
  const bubbles = new Map<string, Mesh>();

  const faceHead = (o: Object3D): void => {
    app.head().getWorldPosition(w);
    o.getWorldPosition(v);
    o.rotation.y = Math.atan2(w.x - v.x, w.z - v.z);
  };

  app.everyFrame((dt, now) => {
    const t = now / 1000;
    // Pip follows the palm softly, or hovers by the head.
    if (pipMode === 'hand' && pipTarget) {
      pipTarget.updateWorldMatrix(true, false);
      pipTarget.getWorldPosition(v);
      v.y += 0.06;
    } else {
      const head = app.head();
      head.updateWorldMatrix(true, false);
      v.set(0.35, -0.12 + Math.sin(t * 2) * 0.03, -0.6).applyMatrix4(head.matrixWorld);
    }
    pipObj.position.lerp(v, 1 - Math.exp(-dt * 6));
    app.head().getWorldPosition(w);
    pipObj.lookAt(w);
    pipObj.rotateY(Math.PI);
    const flap = pipMode === 'hand' ? 0 : Math.sin(t * 22) * 0.6;
    for (const c of pipObj.children) if (c.name.startsWith('wing')) c.rotation.z = (c.name === 'wing-l' ? 1 : -1) * flap;
    // The flock circles over the island unless it carries pieces.
    flock.forEach((bird, i) => {
      if (carrying > 0 && i < carrying) return;
      const a = t * 0.35 + (i / flock.length) * Math.PI * 2;
      bird.position.set(Math.cos(a) * (6 + i * 0.4), 4.5 + Math.sin(t + i) * 0.5, Math.sin(a) * (6 + i * 0.4));
      bird.rotation.y = -a;
      for (const c of bird.children) if (c.name.startsWith('wing')) c.rotation.z = (c.name === 'wing-l' ? 1 : -1) * Math.sin(t * 18 + i) * 0.7;
    });
    for (const [, g] of residents) faceHead(g);
    for (const [, b] of bubbles) {
      b.getWorldPosition(v);
      b.lookAt(w.x, v.y, w.z);
    }
  });

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms * Math.max(0.05, pace())));
  const pace = (): number => app.pace?.() ?? 1;

  const showBubble = async (key: string, parent: Object3D, y: number, text: string, label: string, width = 0.9): Promise<void> => {
    const old = bubbles.get(key);
    if (old) disposeBubble(old);
    const b = makeBubble(text, { width, label, size: 40 });
    b.position.set(0, y, 0);
    parent.add(b);
    bubbles.set(key, b);
    caption({ source: label, text });
    await wait(1200 + text.length * 45);
    if (bubbles.get(key) === b) {
      bubbles.delete(key);
      disposeBubble(b);
    }
  };

  const life: LifePort = {
    pip: {
      object: pipObj,
      landOn(hand) {
        pipTarget = ((hand as { object?: Object3D }).object ?? hand) as Object3D;
        pipMode = 'hand';
      },
      follow(hand) {
        pipTarget = ((hand as { object?: Object3D }).object ?? hand) as Object3D;
        pipMode = 'hand';
      },
      hover() {
        pipMode = 'hover';
        pipTarget = null;
      },
      say(text) {
        return showBubble('pip', pipObj, 0.08, text, 'Pip', 0.2);
      },
    },
    async build(steps: BuildStep[]) {
      carrying = Math.min(flock.length, 3);
      const from = new Vector3();
      for (let i = 0; i < steps.length; i += 1) {
        const s = steps[i];
        const o = s.object3d;
        const parent = o.parent;
        const to = s.target.pos.clone();
        if (parent) parent.updateWorldMatrix(true, false);
        from.set(to.x, to.y + 9, to.z - 6);
        o.visible = true;
        const bird = flock[i % carrying];
        const t0 = performance.now();
        const dur = 900 * Math.max(0.15, pace());
        await new Promise<void>((resolve) => {
          const off = app.everyFrame(() => {
            const k = Math.min(1, (performance.now() - t0) / dur);
            const e = 1 - (1 - k) * (1 - k);
            o.position.lerpVectors(from, to, e);
            o.scale.setScalar(0.6 + 0.4 * e + (k > 0.85 ? Math.sin((k - 0.85) * 20) * 0.06 : 0));
            o.getWorldPosition(v);
            bird.position.copy(root.worldToLocal(v.add(w.set(0, 0.7, 0))));
            if (k >= 1) {
              off();
              o.scale.setScalar(1);
              resolve();
            }
          });
        });
      }
      carrying = 0;
    },
    async arrive(resident) {
      const pier = new Vector3();
      anchorPoint(world.pier, pier);
      const balloon = makeBalloon(resident);
      const g = makeResident(resident);
      residents.set(resident.id, g);
      balloon.add(g);
      g.position.set(0, 0.55, 0);
      root.add(balloon);
      const start = pier.clone().add(new Vector3(-14, -6, -18));
      const end = pier.clone().add(new Vector3(0, -0.1, -1.5));
      const t0 = performance.now();
      const dur = 6000 * Math.max(0.15, pace());
      await new Promise<void>((resolve) => {
        const off = app.everyFrame(() => {
          const k = Math.min(1, (performance.now() - t0) / dur);
          const e = k * k * (3 - 2 * k);
          balloon.position.lerpVectors(start, end, e);
          balloon.position.y += Math.sin(k * Math.PI * 3) * 0.3 * (1 - k);
          if (k >= 1) {
            off();
            resolve();
          }
        });
      });
      // Steps onto the pier.
      root.add(g);
      g.position.copy(pier);
      await wait(400);
    },
    spawn(resident, at) {
      const g = residents.get(resident.id) ?? makeResident(resident);
      residents.set(resident.id, g);
      root.add(g);
      if (at && typeof at === 'object' && 'x' in (at as object)) {
        const p = at as { x: number; z: number };
        g.position.set(p.x, 0, p.z);
      }
      return g;
    },
    async walkTo(id, p) {
      const g = residents.get(id);
      if (!g) return;
      const q = p as { x: number; z: number };
      const from = g.position.clone();
      const to = new Vector3(q.x, 0, q.z);
      const t0 = performance.now();
      const dur = Math.max(300, from.distanceTo(to) * 600 * Math.max(0.15, pace()));
      await new Promise<void>((resolve) => {
        const off = app.everyFrame(() => {
          const k = Math.min(1, (performance.now() - t0) / dur);
          g.position.lerpVectors(from, to, k);
          g.position.y = Math.abs(Math.sin(k * 30)) * 0.05;
          if (k >= 1) {
            off();
            resolve();
          }
        });
      });
    },
    say(id, text, opts) {
      const g = residents.get(id);
      const label = (opts as { name?: string } | undefined)?.name ?? '';
      if (!g) {
        caption({ source: label || 'Traveler', text });
        return wait(1500);
      }
      return showBubble(id, g, 1.05, text, label);
    },
    emote(id, kind) {
      const g = residents.get(id);
      if (!g) return;
      const t0 = performance.now();
      const off = app.everyFrame(() => {
        const k = (performance.now() - t0) / 700;
        g.children[0].position.y = 0.3 + (kind === 'happy' || kind === 'wave' ? Math.abs(Math.sin(k * Math.PI * 2)) * 0.12 : 0);
        if (k >= 1) off();
      });
    },
    startDaily() {
      return undefined;
    },
    soundAt() {
      return null;
    },
    objectOf(id) {
      return residents.get(id) ?? null;
    },
  };
  return life;
}
