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
  /** Browser mode: the paper flags over the rings (same order), clickable. */
  beacons(): Mesh[];
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

/** A paper pennant on a stick with the spot's name: how a ring reads from afar in a page. */
function flagTexture(name: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6b3b22';
  g.fillRect(122, 60, 10, 452);
  g.save();
  g.shadowColor = 'rgba(70,35,15,0.35)';
  g.shadowBlur = 10;
  g.shadowOffsetY = 4;
  g.fillStyle = '#fff4e2';
  g.beginPath();
  g.moveTo(132, 40);
  g.lineTo(250, 40);
  g.lineTo(226, 92);
  g.lineTo(250, 144);
  g.lineTo(132, 144);
  g.closePath();
  g.fill();
  g.restore();
  g.fillStyle = '#e9724c';
  g.beginPath();
  g.arc(127, 40, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5a2a17';
  g.font = "700 30px 'Atkinson Hyperlegible Next', system-ui, sans-serif";
  g.textBaseline = 'middle';
  const words = name.replace(/^the /i, '').split(' ');
  const lines = words.length > 1 ? [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')] : [name.replace(/^the /i, '')];
  lines.forEach((l, i) => g.fillText(l, 142, 92 + (i - (lines.length - 1) / 2) * 32, 92));
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
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
  const flags: Mesh[] = [];
  const p = new Vector3();
  const eye = new Vector3();
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
    for (const f of flags) {
      (f.material as MeshBasicMaterial).map?.dispose();
      f.removeFromParent();
    }
    rings.length = 0;
    flags.length = 0;
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
      const name = (s as { name?: string }).name ?? 'over there';
      const flag = new Mesh(new PlaneGeometry(0.55, 1.1), new MeshBasicMaterial({ map: flagTexture(name), transparent: true, alphaTest: 0.1, depthWrite: true }));
      flag.geometry.translate(0, 0.55, 0);
      flag.position.set(p.x, p.y, p.z);
      flag.name = `flag:${i}`;
      flag.visible = false;
      group.add(flag);
      flags.push(flag);
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
    // In a page the rings are larger and carry paper flags; in a headset they stay soft.
    const desk = app.store.mode.peek() === 'desk';
    app.world.camera.getWorldPosition(eye);
    for (let i = 0; i < rings.length; i += 1) {
      const near = Math.hypot(rings[i].position.x - eye.x, rings[i].position.z - eye.z) < 1.2;
      rings[i].scale.setScalar((desk ? 1.25 : 1) * (1 + Math.sin(now / 700 + i) * 0.05));
      const f = flags[i];
      if (!f) continue;
      f.visible = desk && !near;
      if (f.visible) {
        f.rotation.set(0, Math.atan2(eye.x - f.position.x, eye.z - f.position.z), Math.sin(now / 900 + i) * 0.03);
        // Larger with distance, so a far flag still reads as a thing to click.
        const d = Math.hypot(eye.x - f.position.x, eye.z - f.position.z);
        f.scale.setScalar(Math.max(1.3, Math.min(3.6, d / 4.5)) * (1 + Math.sin(now / 500 + i) * 0.03));
      }
    }
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
    beacons: () => flags,
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
