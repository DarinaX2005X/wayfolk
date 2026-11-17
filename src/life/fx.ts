// Soft particles in two draw calls: puffs (dust, cloud, smoke; normal blending) and
// glows (light motes, window light, lantern halo; additive). Billboarded in the vertex
// shader, so they work per eye in multiview.
import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type Blending,
} from '@iwsdk/core';

interface Particle {
  alive: boolean;
  pos: Vector3;
  vel: Vector3;
  age: number;
  life: number;
  size0: number;
  size1: number;
  color: Color;
  alpha: number;
  drag: number;
  rise: number;
  /** Follows a target position (lantern halo, window light) instead of moving. */
  hold: (() => Vector3 | null) | null;
}

const VERT = /* glsl */ `
attribute vec3 iOffset;
attribute float iSize;
attribute float iAlpha;
attribute vec3 iColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vUv = uv;
  vAlpha = iAlpha;
  vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
  mv.xy += position.xy * iSize;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG_PUFF = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = dot(p, p);
  float a = smoothstep(1.0, 0.15, r);
  // A soft lit top and shaded bottom give puffs some volume.
  vec3 c = vColor * (0.86 + 0.22 * (p.y * 0.5 + 0.5));
  gl_FragColor = vec4(c, a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
}`;

const FRAG_GLOW = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = dot(p, p);
  float a = exp(-r * 4.5) * (1.0 - smoothstep(0.7, 1.0, r));
  gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
}`;

class Pool {
  readonly mesh: Mesh;
  private parts: Particle[] = [];
  private offset: InstancedBufferAttribute;
  private size: InstancedBufferAttribute;
  private alpha: InstancedBufferAttribute;
  private color: InstancedBufferAttribute;
  private geo: InstancedBufferGeometry;

  constructor(max: number, frag: string, blending: Blending, name: string) {
    const quad = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    this.offset = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.size = new InstancedBufferAttribute(new Float32Array(max), 1);
    this.alpha = new InstancedBufferAttribute(new Float32Array(max), 1);
    this.color = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    for (const a of [this.offset, this.size, this.alpha, this.color]) a.setUsage(35048); // DynamicDrawUsage
    geo.setAttribute('iOffset', this.offset);
    geo.setAttribute('iSize', this.size);
    geo.setAttribute('iAlpha', this.alpha);
    geo.setAttribute('iColor', this.color);
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, transparent: true, depthWrite: false, blending });
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blending === AdditiveBlending ? 12 : 11;
    this.mesh.name = name;
    for (let i = 0; i < max; i++) {
      this.parts.push({ alive: false, pos: new Vector3(), vel: new Vector3(), age: 0, life: 1, size0: 0.1, size1: 0.2, color: new Color(), alpha: 1, drag: 0, rise: 0, hold: null });
    }
  }

  spawn(o: { pos: Vector3; vel?: Vector3; life: number; size0: number; size1: number; color: string | Color; alpha?: number; drag?: number; rise?: number; hold?: () => Vector3 | null }): void {
    let p = this.parts.find((x) => !x.alive);
    if (!p) {
      // Recycle the oldest.
      p = this.parts.reduce((a, b) => (a.age / a.life > b.age / b.life ? a : b));
    }
    p.alive = true;
    p.pos.copy(o.pos);
    p.vel.copy(o.vel ?? ZERO);
    p.age = 0;
    p.life = o.life;
    p.size0 = o.size0;
    p.size1 = o.size1;
    p.color.set(o.color);
    p.alpha = o.alpha ?? 1;
    p.drag = o.drag ?? 1.5;
    p.rise = o.rise ?? 0;
    p.hold = o.hold ?? null;
  }

  update(dt: number): void {
    let n = 0;
    const off = this.offset.array as Float32Array;
    const sz = this.size.array as Float32Array;
    const al = this.alpha.array as Float32Array;
    const co = this.color.array as Float32Array;
    for (const p of this.parts) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      if (p.hold) {
        const h = p.hold();
        if (!h) {
          p.alive = false;
          continue;
        }
        p.pos.copy(h);
      } else {
        p.vel.multiplyScalar(Math.exp(-p.drag * dt));
        p.vel.y += p.rise * dt;
        p.pos.addScaledVector(p.vel, dt);
      }
      const u = p.age / p.life;
      const fadeIn = Math.min(1, p.age / Math.min(0.15, p.life * 0.2));
      off[n * 3] = p.pos.x;
      off[n * 3 + 1] = p.pos.y;
      off[n * 3 + 2] = p.pos.z;
      sz[n] = p.size0 + (p.size1 - p.size0) * (1 - Math.pow(1 - u, 2));
      al[n] = p.alpha * fadeIn * (1 - u * u);
      co[n * 3] = p.color.r;
      co[n * 3 + 1] = p.color.g;
      co[n * 3 + 2] = p.color.b;
      n++;
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    this.offset.needsUpdate = true;
    this.size.needsUpdate = true;
    this.alpha.needsUpdate = true;
    this.color.needsUpdate = true;
  }

  count(): number {
    return this.geo.instanceCount;
  }
}

const ZERO = new Vector3();
const v = new Vector3();

export class Fx {
  readonly puffs = new Pool(260, FRAG_PUFF, NormalBlending, 'life-puffs');
  readonly glows = new Pool(120, FRAG_GLOW, AdditiveBlending, 'life-glows');

  /** Dust ring where a piece lands. */
  dust(at: Vector3, radius: number, color = '#e9d6b8'): void {
    const n = Math.round(8 + radius * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
      v.set(Math.cos(a), 0, Math.sin(a));
      const pos = at.clone().addScaledVector(v, radius * 0.7);
      pos.y += 0.05;
      this.puffs.spawn({ pos, vel: v.clone().multiplyScalar(1.2 + Math.random() * 1.4).setY(0.25 + Math.random() * 0.4), life: 0.9 + Math.random() * 0.5, size0: 0.12 + radius * 0.08, size1: 0.35 + radius * 0.25, color, alpha: 0.75, drag: 3.2, rise: 0.25 });
    }
  }

  /** A soft cloud puff (pieces and travelers come out of the clouds). */
  cloud(at: Vector3, size: number): void {
    for (let i = 0; i < 7; i++) {
      const pos = at.clone().add(v.set((Math.random() - 0.5) * size, (Math.random() - 0.3) * size * 0.5, (Math.random() - 0.5) * size));
      this.puffs.spawn({ pos, vel: v.set((Math.random() - 0.5) * 0.6, 0.2 + Math.random() * 0.3, (Math.random() - 0.5) * 0.6).clone(), life: 1.4 + Math.random() * 0.8, size0: size * 0.5, size1: size * 1.3, color: '#fff5ec', alpha: 0.9, drag: 1.2 });
    }
  }

  smoke(at: Vector3): void {
    this.puffs.spawn({ pos: at.clone(), vel: v.set((Math.random() - 0.5) * 0.1, 0.45, (Math.random() - 0.5) * 0.1).clone(), life: 3.2, size0: 0.12, size1: 0.55, color: '#e8e2dc', alpha: 0.55, drag: 0.4, rise: 0.05 });
  }

  /** Warm light motes and halo (arrivals, finished house). */
  motes(at: Vector3, spread: number, color = '#ffd28a', n = 10): void {
    for (let i = 0; i < n; i++) {
      const pos = at.clone().add(v.set((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread));
      this.glows.spawn({ pos, vel: v.set((Math.random() - 0.5) * 0.2, 0.15 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2).clone(), life: 1.6 + Math.random() * 1.2, size0: 0.05, size1: 0.02, color, alpha: 0.9, drag: 0.5 });
    }
  }

  /** A glow that follows something for a while (window light, lantern). */
  halo(follow: () => Vector3 | null, size: number, life: number, color = '#ffcf7a', alpha = 0.8): void {
    this.glows.spawn({ pos: follow() ?? new Vector3(), life, size0: size, size1: size, color, alpha, hold: follow });
  }

  update(dt: number): void {
    this.puffs.update(dt);
    this.glows.update(dt);
  }

  drawCalls(): number {
    return (this.puffs.count() > 0 ? 1 : 0) + (this.glows.count() > 0 ? 1 : 0);
  }
}
