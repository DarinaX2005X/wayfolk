/**
 * Gliding to another spot of the island (no smooth locomotion): soft glowing rings mark
 * the places one can go; point at one and pinch, the view closes from the edges, the
 * person is there, the view opens again. The vignette is a sphere around the head whose
 * edges darken first.
 */
import {
  AdditiveBlending,
  BackSide,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from '@iwsdk/core';
import { sound } from '../../feel/sound';
import type { App } from '../boot/world';
import { registerTest } from '../debug';
import { anchorPoint, type Anchor, type WorldPort } from '../ports';
import type { Rig } from '../rig';
import type { Hands } from './hands';
import type { Replies } from './replies';

export type Glide = {
  /** Shows or hides the rings. */
  enable(on: boolean): void;
  to(index: number): Promise<void>;
  /** Desk: glide to the ring nearest a world point, if one is near. */
  near(p: Vector3): number;
  rings(): Mesh[];
  /** Closes the view to a colour (0 open, 1 closed); used by the glide and by scenes. */
  vignette: { amount: number };
};

function ringTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 30, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,240,200,0)');
  grad.addColorStop(0.72, 'rgba(255,240,200,0.15)');
  grad.addColorStop(0.84, 'rgba(255,248,225,0.9)');
  grad.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createGlide(app: App, hands: Hands, world: WorldPort, rig: Rig, replies: Replies, busy: () => boolean): Glide {
  const group = new Group();
  group.name = 'glide';
  group.visible = false;
  app.roots.fx.add(group);
  const ringMat = new MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending });
  const spots: Anchor[] = [];
  const rings: Mesh[] = [];
  const p = new Vector3();
  const hit = new Vector3();
  let moving = false;

  const vignetteMat = new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { amount: { value: 0 }, tint: { value: new Color('#2a1d1a') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader:
      'uniform float amount; uniform vec3 tint; varying vec3 vP; void main(){ float off = 1.0 - dot(vP, vec3(0.0,0.0,-1.0)); float edge = mix(0.9, -0.25, amount); float a = smoothstep(edge, edge + 0.35, off) * smoothstep(0.0, 0.05, amount); if (a < 0.003) discard; gl_FragColor = vec4(tint, a); }',
  });
  const vignette = new Mesh(new SphereGeometry(0.25, 24, 16), vignetteMat);
  vignette.name = 'glide:vignette';
  vignette.renderOrder = 100;
  vignette.frustumCulled = false;
  app.world.camera.add(vignette);
  const vig = { amount: 0 };

  const refresh = (): void => {
    for (const r of rings) r.removeFromParent();
    rings.length = 0;
    spots.length = 0;
    for (const s of world.spots()) spots.push(s);
    spots.forEach((s, i) => {
      const ring = new Mesh(new PlaneGeometry(1.4, 1.4), ringMat);
      ring.rotation.x = -Math.PI / 2;
      anchorPoint(s, p);
      ring.position.set(p.x, p.y + 0.05, p.z);
      ring.name = `spot:${i}`;
      group.add(ring);
      rings.push(ring);
    });
  };

  const pace = (): number => Math.max(0.05, app.store.pace.peek());
  const fade = (to: number, ms: number): Promise<void> =>
    new Promise((resolve) => {
      const from = vig.amount;
      const t0 = app.clock.now();
      const off = app.everyFrame((_dt, now) => {
        const k = Math.min(1, (now - t0) / (ms * pace()));
        vig.amount = from + (to - from) * k * k * (3 - 2 * k);
        if (k >= 1) {
          off();
          resolve();
        }
      });
    });

  app.everyFrame((_dt, now) => {
    vignetteMat.uniforms.amount.value = vig.amount;
    vignette.visible = vig.amount > 0.001;
    if (!group.visible) return;
    for (let i = 0; i < rings.length; i += 1) rings[i].scale.setScalar(1 + Math.sin(now / 700 + i) * 0.05);
  });

  const glide: Glide = {
    enable(on) {
      if (on && !rings.length) refresh();
      group.visible = on;
    },
    async to(index) {
      const s = spots[index];
      if (!s || moving) return;
      moving = true;
      sound.play('slide');
      await fade(1, 380);
      rig.placeAt(s);
      await fade(0, 450);
      moving = false;
    },
    near(point) {
      let best = -1;
      let bestD = 1.6;
      rings.forEach((r, i) => {
        const d = Math.hypot(r.position.x - point.x, r.position.z - point.z);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    },
    rings: () => rings,
    vignette: vig,
  };

  hands.onPinch((s, down, h) => {
    if (down || !group.visible || moving || busy() || replies.consumed(s)) return;
    // Released while pointing at a ring: glide there.
    const y = rings[0]?.position.y ?? 0;
    if (Math.abs(h.rayDir.y) < 1e-3) return;
    const t = (y - h.rayOrigin.y) / h.rayDir.y;
    if (t <= 0) return;
    hit.copy(h.rayOrigin).addScaledVector(h.rayDir, t);
    const i = glide.near(hit);
    if (i >= 0) void glide.to(i);
  });

  registerTest('glide', (i: number) => glide.to(i));
  return glide;
}
