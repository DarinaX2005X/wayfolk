/**
 * Twin lanterns. Each person lets a paper lantern go; if the two go up within a little
 * while of each other they find each other: they drift together high over the clouds,
 * circle once, and where they meet they become a small new constellation, two little
 * figures of stars joined by one line, with both names written under it in starlight.
 * It stays in the night sky of both islands (records.ts), a little brighter for a while
 * after it was made. A lantern without a twin waits a while, then drifts off alone.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LatheGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  SRGBColorSpace,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
} from '@iwsdk/core';
import type { Ctx } from './context';
import { constellation, meetPoint } from './plan';
import type { StarRecord } from './records';

export const LANTERN_LINES = {
  first: (friend: string) => `${friend} let a lantern go. Let yours go too, and they will find each other.`,
  waiting: (friend: string) => `Your lantern is waiting for ${friend}'s.`,
  met: (a: string, b: string) => `There you are, ${a} and ${b}, up among the stars.`,
  alone: 'It drifted off on its own. Lanterns like company.',
} as const;

const MEET_S = 8;
const STAR_DIST = 80;
const STAR_SCALE = 19;

let haloTex: CanvasTexture | null = null;
function halo(): CanvasTexture | null {
  if (haloTex) return haloTex;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,230,170,1)');
  r.addColorStop(0.35, 'rgba(255,190,110,0.45)');
  r.addColorStop(1, 'rgba(255,160,80,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  haloTex = new CanvasTexture(c);
  haloTex.colorSpace = SRGBColorSpace;
  return haloTex;
}

/** A paper lantern: a warm unlit body, dark rims, a soft halo. */
function lanternObject(tint: string): Group {
  const g = new Group();
  const prof = [[0.0, -0.13], [0.07, -0.13], [0.105, -0.08], [0.115, 0.0], [0.105, 0.08], [0.07, 0.12], [0.03, 0.13], [0.0, 0.13]].map(([x, y]) => new Vector2(x, y));
  const body = new Mesh(new LatheGeometry(prof, 14), new MeshBasicMaterial({ color: new Color(tint), toneMapped: false, side: DoubleSide }));
  g.add(body);
  const rim = new Mesh(new LatheGeometry([new Vector2(0.072, -0.135), new Vector2(0.075, -0.115)], 12), new MeshBasicMaterial({ color: new Color('#5a3a26'), side: DoubleSide }));
  g.add(rim);
  const tex = halo();
  if (tex) {
    const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
    s.scale.setScalar(0.85);
    s.name = 'halo';
    g.add(s);
  }
  return g;
}

interface Lantern {
  obj: Group;
  from: Vector3;
  pos: Vector3;
  mine: boolean;
  at: number;
  t: number;
  state: 'held' | 'rising' | 'meeting' | 'leaving';
  meetFrom?: Vector3;
  phase: number;
}

class Constellation {
  readonly group = new Group();
  readonly made: number;
  private readonly mats: { setOpacity(o: number): void }[] = [];
  private draw = 0;
  private readonly count: number;
  private readonly lines: LineSegments;

  constructor(readonly rec: StarRecord, fresh: boolean) {
    this.made = fresh ? 0 : -1;
    const { points, lines, bright } = constellation(rec.names, rec.seed);
    const pos = new Float32Array(points.length * 3);
    const size = new Float32Array(points.length);
    const idx = new Float32Array(points.length);
    points.forEach(([x, y], i) => {
      idx[i] = i;
      pos.set([x * STAR_SCALE, y * STAR_SCALE, 0], i * 3);
      size[i] = bright.includes(i) ? 1.5 : 0.95 + ((i * 37) % 10) / 25;
    });
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('size', new BufferAttribute(size, 1));
    g.setAttribute('idx', new BufferAttribute(idx, 1));
    const starMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
      uniforms: { uTime: { value: 0 }, uOpacity: { value: 0 }, uDrawn: { value: fresh ? 0 : 99 } },
      vertexShader: `attribute float size; attribute float idx; uniform float uTime; uniform float uDrawn; varying float vA;
        void main(){ vA = clamp(uDrawn - idx, 0.0, 1.0) * (0.85 + 0.15 * sin(uTime * 2.3 + idx * 1.7));
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * 9.0 * (300.0 / -mv.z) * 0.12 * 6.0; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uOpacity; varying float vA; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0;
        float core = smoothstep(0.35, 0.0, d); float glow = smoothstep(1.0, 0.0, d) * 0.45; float ray = max(0.0, 1.0 - abs(p.x) * 14.0) * max(0.0, 1.0 - abs(p.y) * 2.2) + max(0.0, 1.0 - abs(p.y) * 14.0) * max(0.0, 1.0 - abs(p.x) * 2.2);
        float a = (core + glow + ray * 0.35) * vA * uOpacity; gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * a, a); }`,
    });
    const stars = new Points(g, starMat);
    stars.frustumCulled = false;
    this.group.add(stars);
    this.mats.push({ setOpacity: (o) => (starMat.uniforms.uOpacity.value = o) });
    this.count = points.length;
    const lp = new Float32Array(lines.length * 6);
    lines.forEach(([a, b], i) => {
      lp.set([points[a][0] * STAR_SCALE, points[a][1] * STAR_SCALE, 0, points[b][0] * STAR_SCALE, points[b][1] * STAR_SCALE, 0], i * 6);
    });
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(lp, 3));
    lg.setDrawRange(0, fresh ? 0 : lines.length * 2);
    const lineMat = new LineBasicMaterial({ color: new Color('#ffe2a8'), transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, fog: false });
    this.lines = new LineSegments(lg, lineMat);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.mats.push({ setOpacity: (o) => (lineMat.opacity = o * 0.4) });
    // both names, in starlight
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = 1024;
      c.height = 160;
      const x = c.getContext('2d')!;
      x.font = '600 76px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.shadowColor = 'rgba(255,200,120,0.9)';
      x.shadowBlur = 24;
      x.fillStyle = 'rgba(255,240,214,0.95)';
      x.fillText(`${rec.names[0]} and ${rec.names[1]}`, 512, 80);
      const tex = new CanvasTexture(c);
      tex.colorSpace = SRGBColorSpace;
      const labelMat = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: false });
      const label = new Mesh(new PlaneGeometry(STAR_SCALE * 1.5, STAR_SCALE * 0.234), labelMat);
      label.position.set(0, -STAR_SCALE * 0.5, 0);
      this.group.add(label);
      this.mats.push({ setOpacity: (o) => (labelMat.opacity = Math.min(1, o * 0.95)) });
    }
    this.group.name = `together:stars:${rec.id}`;
    void this.count;
  }

  /** Places the figure on the sky round the eye, facing it, upright. */
  place(): void {
    const d = new Vector3(...this.rec.dir).normalize();
    this.group.position.copy(d).multiplyScalar(STAR_DIST);
    // +z toward the eye: the label reads left to right, the figure is not mirrored
    this.group.lookAt(0, 0, 0);
  }

  update(dt: number, opacity: number, time: number): void {
    if (this.made >= 0) {
      this.draw += dt;
      const stars = this.group.children[0] as Points;
      (stars.material as ShaderMaterial).uniforms.uDrawn.value = this.draw * 3;
      const lineCount = (this.lines.geometry.getAttribute('position').count / 2) | 0;
      this.lines.geometry.setDrawRange(0, Math.min(lineCount, Math.floor(Math.max(0, this.draw - 1.4) * 4)) * 2);
    }
    ((this.group.children[0] as Points).material as ShaderMaterial).uniforms.uTime.value = time;
    for (const m of this.mats) m.setOpacity(opacity);
  }
}

export class Lanterns {
  /** The lanterns, in the island frame. */
  readonly group = new Group();
  /** The constellations: follows the eye, so they sit on the sky. */
  readonly sky = new Group();
  private lanterns: Lantern[] = [];
  private figures = new Map<string, Constellation>();
  private time = 0;
  private freshAt = -1e9;
  onFirst: ((friendName: string) => void) | null = null;

  constructor(private readonly ctx: Ctx) {
    this.group.name = 'together:lanterns';
    this.sky.name = 'together:sky';
    ctx.root.add(this.group, this.sky);
  }

  /** A lantern goes up from `at` (island frame). */
  release(at: Vector3, mine: boolean): void {
    // One lantern per person at a time.
    if (this.lanterns.some((l) => l.mine === mine && l.state !== 'leaving')) return;
    const obj = lanternObject(mine ? '#ffd9a0' : '#ffe6c2');
    obj.position.copy(at);
    this.group.add(obj);
    this.lanterns.push({ obj, from: at.clone(), pos: at.clone(), mine, at: this.ctx.now(), t: 0, state: 'rising', phase: Math.random() * 6 });
  }

  /** Both lanterns are up: they drift together and become stars. */
  meet(): boolean {
    const two = this.lanterns.filter((l) => l.state === 'rising');
    if (two.length < 2) return false;
    for (const l of two) {
      l.state = 'meeting';
      l.t = 0;
      l.meetFrom = l.pos.clone();
    }
    return true;
  }

  /** Where twins meet (island frame), from the two release points. */
  meetingPoint(): Vector3 | null {
    const two = this.lanterns.filter((l) => l.state === 'rising' || l.state === 'meeting');
    if (two.length < 2) return null;
    const m = meetPoint(two[0].from.toArray() as [number, number, number], two[1].from.toArray() as [number, number, number]);
    return new Vector3(...m);
  }

  rising(mine: boolean): boolean {
    return this.lanterns.some((l) => l.mine === mine && (l.state === 'rising' || l.state === 'meeting'));
  }

  /** Shows a constellation (fresh: drawn in star by star, bright for a while). */
  show(rec: StarRecord, fresh: boolean): void {
    if (this.figures.has(rec.id)) return;
    const c = new Constellation(rec, fresh);
    c.place();
    this.sky.add(c.group);
    this.figures.set(rec.id, c);
    if (fresh) this.freshAt = this.ctx.now();
  }

  clearSky(): void {
    for (const c of this.figures.values()) c.group.removeFromParent();
    this.figures.clear();
  }

  update(dt: number, onMet: () => void): void {
    this.time += dt;
    const meet = this.meetingPoint();
    for (const l of this.lanterns) {
      l.t += dt;
      const sway = Math.sin(this.time * 1.3 + l.phase) * 0.12;
      if (l.state === 'rising') {
        // A slow lift first, the way warm air takes a paper lantern.
        const up = Math.min(6, l.t * (0.25 + Math.min(1, l.t / 4) * 0.3));
        l.pos.set(l.from.x + sway, l.from.y + up, l.from.z + Math.cos(this.time * 0.9 + l.phase) * 0.1);
        if (l.t > 26) {
          l.state = 'leaving';
          l.t = 0;
          l.meetFrom = l.pos.clone();
          if (l.mine) this.ctx.say(LANTERN_LINES.alone);
        }
      } else if (l.state === 'meeting' && meet && l.meetFrom) {
        const k = Math.min(1, l.t / MEET_S);
        const e = k * k * (3 - 2 * k);
        // They spiral round each other as they close in.
        const other = this.lanterns.find((o) => o !== l && o.state === 'meeting');
        const sign = other && l.mine ? 1 : -1;
        const ang = e * Math.PI * 2.2 + (sign > 0 ? 0 : Math.PI);
        const r = (1 - e) * 1.6 + 0.12;
        l.pos.copy(l.meetFrom).lerp(meet, e);
        l.pos.x += Math.cos(ang) * r * (1 - e * 0.3);
        l.pos.z += Math.sin(ang) * r * (1 - e * 0.3);
        if (k >= 1 && l.mine !== false) {
          // handled once below
        }
      } else if (l.state === 'leaving' && l.meetFrom) {
        const k = Math.min(1, l.t / 14);
        l.pos.copy(l.meetFrom).add(new Vector3(k * 30, k * 18, -k * 40));
        l.obj.scale.setScalar(1 - k * 0.6);
      }
      l.obj.position.copy(l.pos);
      const s = l.obj.getObjectByName('halo');
      if (s) s.scale.setScalar(0.85 + Math.sin(this.time * 7 + l.phase) * 0.05);
    }
    const meeting = this.lanterns.filter((l) => l.state === 'meeting');
    if (meeting.length >= 2 && meeting.every((l) => l.t >= MEET_S)) {
      const at = this.ctx.root.localToWorld(meeting[0].pos.clone());
      this.ctx.sound.rush(at);
      for (const l of meeting) l.obj.removeFromParent();
      this.lanterns = this.lanterns.filter((l) => l.state !== 'meeting');
      onMet();
    }
    const done = this.lanterns.filter((l) => l.state === 'leaving' && l.t > 14);
    for (const l of done) l.obj.removeFromParent();
    this.lanterns = this.lanterns.filter((l) => !(l.state === 'leaving' && l.t > 14));
    // the sky: follows the eye; brighter for a while after a new one, otherwise as the stars
    this.ctx.head(this.sky.position);
    const stars = this.ctx.world.sky?.stars ?? this.ctx.world.sky?.night ?? 1;
    const fresh = Math.max(0, 1 - (this.ctx.now() - this.freshAt) / 40000);
    const vis = Math.max(stars, fresh, 0.08);
    for (const c of this.figures.values()) c.update(dt, vis, this.time);
  }

  /** The direction a new constellation hangs in, seen from the island's seat. */
  skyDir(meet: Vector3 | null): [number, number, number] {
    const eye = new Vector3(0, 1.2, 0);
    const d = (meet ?? new Vector3(0, 20, -30)).clone().sub(eye).normalize();
    // keep it well above the horizon and in front of the porch
    d.y = Math.max(0.42, d.y);
    d.normalize();
    return [d.x, d.y, d.z];
  }
}
