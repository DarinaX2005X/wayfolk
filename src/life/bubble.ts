// Speech cloud: a puffy cloud with a soft tail toward the speaker, drawn on a canvas on a
// plane above them, turned toward the person and sized by distance so the text stays
// readable. The words appear one by one with the babble; the cloud bobs a little.
import {
  CanvasTexture,
  DoubleSide,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from '@iwsdk/core';

const W = 1024;
const H = 512;
const FONT = 'WayfolkAtkinson';
let fontsReady: Promise<void> | null = null;

function baseUrl(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  return env?.BASE_URL ?? '/';
}

/** Load Atkinson Hyperlegible (shipped in public/fonts) for the canvas. */
export function loadBubbleFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') return (fontsReady = Promise.resolve());
  const base = baseUrl();
  const faces = [
    new FontFace(FONT, `url(${base}fonts/atkinson-hyperlegible-next-latin-400-normal.woff2)`, { weight: '400' }),
    new FontFace(FONT, `url(${base}fonts/atkinson-hyperlegible-next-latin-700-normal.woff2)`, { weight: '700' }),
  ];
  fontsReady = Promise.all(
    faces.map((f) =>
      f
        .load()
        .then((loaded) => {
          (document.fonts as unknown as { add(f: FontFace): void }).add(loaded);
        })
        .catch(() => undefined),
    ),
  ).then(() => undefined);
  return fontsReady;
}

type Layout = {
  family: string;
  size: number;
  lines: string[];
  lineH: number;
  nameSize: number;
  nameH: number;
  padX: number;
  padY: number;
  bw: number;
  bh: number;
  x: number;
  y: number;
  tail: number;
  puffs: [number, number, number][];
};

export interface BubbleStyle {
  name?: string;
  /** Name colour (resident accent). */
  accent?: string;
}

function darken(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#7a4a2a';
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r},${g},${b})`;
}

/** Wrap text into lines that fit maxWidth with the current ctx font. */
export function wrapLines(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const tryLine = line ? `${line} ${word}` : word;
    if (measure(tryLine) <= maxWidth || !line) {
      if (!line && measure(word) > maxWidth) {
        // Break a very long word.
        let part = '';
        for (const ch of word) {
          if (measure(part + ch) > maxWidth && part) {
            lines.push(part);
            part = ch;
          } else part += ch;
        }
        line = part;
      } else line = tryLine;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export class Bubble {
  readonly mesh: Mesh;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null;
  private texture: CanvasTexture | null;
  private material: MeshBasicMaterial;
  private age = 0;
  private hideAt = Infinity;
  private fade = 0;
  private shown = false;
  /** Height of the drawn bubble as a fraction of the plane (for stacking/anchors). */
  private text = '';
  private style: BubbleStyle = {};
  private words: string[] = [];
  /** Seconds over which the words appear (0: all at once). */
  private reveal = 0;
  private drawn = -1;
  private layout: Layout | null = null;

  constructor() {
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (this.canvas) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.texture = this.canvas ? new CanvasTexture(this.canvas as HTMLCanvasElement) : null;
    if (this.texture) {
      this.texture.colorSpace = SRGBColorSpace;
      this.texture.minFilter = LinearMipmapLinearFilter;
      this.texture.anisotropy = 4;
    }
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
      fog: false,
      opacity: 0,
    });
    const geo = new PlaneGeometry(1, H / W);
    geo.translate(0, H / W / 2, 0); // anchor at the bottom centre (tail tip)
    this.mesh = new Mesh(geo, this.material);
    this.mesh.name = 'life-bubble';
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  get visible(): boolean {
    return this.shown;
  }

  show(text: string, style: BubbleStyle = {}, reveal = 0): void {
    this.text = text;
    this.style = style;
    this.words = text.trim().split(/\s+/).filter(Boolean);
    this.reveal = Math.max(0, reveal);
    this.drawn = -1;
    this.layout = null;
    this.draw(this.reveal > 0 ? 1 : this.words.length);
    void loadBubbleFonts().then(() => {
      if (this.text === text) {
        this.layout = null;
        this.draw(this.drawn);
      }
    });
    this.age = 0;
    this.fade = 0;
    this.hideAt = Infinity;
    this.shown = true;
    this.mesh.visible = true;
  }

  /** Fade out after `delay` seconds. */
  hide(delay = 0): void {
    this.hideAt = this.age + delay;
    // Whatever was left unsaid shows at once when the line is cut short.
    if (this.drawn < this.words.length) this.draw(this.words.length);
  }

  /** Lays the whole line out once, so the cloud never changes size while words appear. */
  private measure(g: CanvasRenderingContext2D): Layout {
    if (this.layout) return this.layout;
    const family = `${FONT}, "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif`;
    let size = 50;
    let lines: string[] = [];
    const maxText = 780;
    for (; size >= 34; size -= 4) {
      g.font = `400 ${size}px ${family}`;
      lines = wrapLines((s) => g.measureText(s).width, this.text, maxText);
      const nameH = this.style.name ? size * 0.78 : 0;
      if (lines.length * size * 1.22 + nameH + 64 <= H - 150) break;
    }
    g.font = `400 ${size}px ${family}`;
    const lineH = size * 1.22;
    const nameSize = Math.round(size * 0.6);
    const nameH = this.style.name ? nameSize * 1.3 : 0;
    const textW = Math.max(...lines.map((l) => g.measureText(l).width), this.style.name ? (g.font = `700 ${nameSize}px ${family}`, g.measureText(this.style.name).width) : 0);
    const padX = 40;
    const padY = 22;
    const bw = Math.min(W - 150, Math.max(200, textW + padX * 2));
    const bh = lines.length * lineH + nameH + padY * 2 - (lineH - size) * 0.6;
    const tail = 70;
    const x = (W - bw) / 2;
    const y = H - tail - bh - 34;
    // Puffs round the edge, seeded by the text so a line keeps its own cloud.
    let seed = this.text.length * 31 + 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const puffs: [number, number, number][] = [];
    const per = (len: number, r: number): number => Math.max(2, Math.round(len / (r * 1.25)));
    const rTop = Math.min(56, bh * 0.42);
    const nTop = per(bw, rTop);
    for (let i = 0; i <= nTop; i += 1) {
      const u = i / nTop;
      const r = rTop * (0.78 + rnd() * 0.4) * (1 - 0.18 * Math.abs(u - 0.5) * 2);
      puffs.push([x + u * bw, y + r * 0.25 + rnd() * 6, r]);
    }
    const rBot = rTop * 0.82;
    const nBot = per(bw, rBot);
    for (let i = 0; i <= nBot; i += 1) {
      const u = i / nBot;
      const r = rBot * (0.75 + rnd() * 0.35);
      puffs.push([x + u * bw, y + bh - r * 0.3, r]);
    }
    const nSide = Math.max(1, Math.round(bh / (rTop * 1.4)));
    for (let i = 0; i <= nSide; i += 1) {
      const v = i / nSide;
      const r = rTop * (0.7 + rnd() * 0.3);
      puffs.push([x + r * 0.2, y + v * bh, r]);
      puffs.push([x + bw - r * 0.2, y + v * bh, r]);
    }
    this.layout = { family, size, lines, lineH, nameSize, nameH, padX, padY, bw, bh, x, y, tail, puffs };
    return this.layout;
  }

  private cloudPath(g: CanvasRenderingContext2D, L: Layout, grow = 0): void {
    g.beginPath();
    g.rect(L.x - grow, L.y - grow, L.bw + grow * 2, L.bh + grow * 2);
    for (const [cx, cy, r] of L.puffs) {
      g.moveTo(cx + r + grow, cy);
      g.arc(cx, cy, r + grow, 0, Math.PI * 2);
    }
    // The tail: a soft pointed puff that leans down toward the speaker.
    const cx = W / 2;
    const top = L.y + L.bh;
    // Drawn the same way round as the puffs, so the shapes join instead of cutting holes.
    g.moveTo(cx + 40 + grow, top - 4);
    g.quadraticCurveTo(cx + 20, top + L.tail * 0.5, cx - 6, top + L.tail + grow);
    g.quadraticCurveTo(cx - 10, top + L.tail * 0.55, cx - 34 - grow, top - 4);
    g.closePath();
  }

  /** Draws the cloud with the first `count` words of the line. */
  private draw(count: number): void {
    const c = this.canvas;
    if (!c || !this.texture) return;
    const g = (c as HTMLCanvasElement).getContext('2d');
    if (!g) return;
    const L = this.measure(g);
    g.clearRect(0, 0, W, H);
    // A soft shadow under the cloud, then the cloud: bright on top, a cool blush underneath.
    g.save();
    g.shadowColor = 'rgba(70, 60, 90, 0.26)';
    g.shadowBlur = 26;
    g.shadowOffsetY = 10;
    this.cloudPath(g, L);
    g.fillStyle = '#fbf6f0';
    g.fill('nonzero');
    g.restore();
    g.save();
    this.cloudPath(g, L);
    g.clip('nonzero');
    const grad = g.createLinearGradient(0, L.y - 40, 0, L.y + L.bh + L.tail);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.62, '#fbf7f2');
    grad.addColorStop(1, '#ead9de');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
    // A little light on the upper puffs.
    g.globalAlpha = 0.55;
    for (const [px, py, r] of L.puffs) {
      if (py > L.y + L.bh * 0.4) continue;
      const hl = g.createRadialGradient(px - r * 0.25, py - r * 0.35, 1, px, py, r);
      hl.addColorStop(0, 'rgba(255,255,255,0.9)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hl;
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    let ty = L.y + L.padY;
    g.textBaseline = 'top';
    g.textAlign = 'left';
    if (this.style.name) {
      g.font = `700 ${L.nameSize}px ${L.family}`;
      g.fillStyle = darken(this.style.accent ?? '#9a5a2a', 0.7);
      g.fillText(this.style.name, L.x + L.padX, ty);
      ty += L.nameH;
    }
    g.font = `400 ${L.size}px ${L.family}`;
    g.fillStyle = '#33251c';
    let left = Math.max(0, count);
    for (const l of L.lines) {
      if (left <= 0) break;
      const words = l.split(' ');
      const part = words.slice(0, left).join(' ');
      left -= words.length;
      g.fillText(part, L.x + L.padX, ty);
      ty += L.lineH;
    }
    this.drawn = count;
    this.texture.needsUpdate = true;
  }

  /**
   * Place the bubble with its tail at `anchor` (world), turned toward `head`, scaled to
   * stay readable from there. Returns false when it has faded out.
   */
  update(dt: number, anchor: Vector3, head: Vector3, parentInverse?: (v: Vector3) => Vector3): boolean {
    if (!this.shown) return false;
    this.age += dt;
    if (this.drawn < this.words.length) {
      const k = this.reveal > 0 ? Math.min(1, this.age / this.reveal) : 1;
      const count = Math.max(1, Math.ceil(this.words.length * k));
      if (count !== this.drawn) this.draw(count);
    }
    const fadingOut = this.age >= this.hideAt;
    this.fade = fadingOut ? Math.max(0, this.fade - dt / 0.35) : Math.min(1, this.fade + dt / 0.22);
    if (fadingOut && this.fade <= 0) {
      this.shown = false;
      this.mesh.visible = false;
      this.material.opacity = 0;
      return false;
    }
    const d = anchor.distanceTo(head);
    const width = Math.min(2.3, Math.max(0.17, d * 0.4));
    // Pop: overshoot then settle on the way in; shrink slightly on the way out.
    const a = Math.min(1, this.age / 0.38);
    const pop = fadingOut ? 0.94 + 0.06 * this.fade : 1 + 0.12 * Math.sin(a * Math.PI) * (1 - a) - 0.25 * Math.pow(1 - a, 3);
    this.mesh.scale.setScalar(width * pop);
    tmp.copy(anchor);
    tmp.y += (1 - (fadingOut ? this.fade : 1)) * 0.05 * width;
    // A slow bob, the way a cloud rides the air.
    tmp.y += Math.sin(this.age * 1.7) * 0.012 * width;
    if (parentInverse) parentInverse(tmp);
    this.mesh.position.copy(tmp);
    look.copy(head);
    look.y = Math.max(look.y, anchor.y - 0.2);
    this.mesh.lookAt(look);
    this.material.opacity = easeOut(this.fade);
    return true;
  }

  dispose(): void {
    this.texture?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}

const tmp = new Vector3();
const look = new Vector3();
const easeOut = (x: number): number => 1 - Math.pow(1 - x, 3);

export type { Object3D };
