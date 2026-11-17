// Paper speech bubble: a canvas texture on a plane above the speaker, turned toward the
// person, sized by distance so the text stays readable, popping in and fading out.
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

  show(text: string, style: BubbleStyle = {}): void {
    this.text = text;
    this.style = style;
    this.draw();
    void loadBubbleFonts().then(() => {
      if (this.text === text) this.draw();
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
  }

  private draw(): void {
    const c = this.canvas;
    if (!c || !this.texture) return;
    const g = (c as HTMLCanvasElement).getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const family = `${FONT}, "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif`;
    let size = 50;
    let lines: string[] = [];
    const maxText = 860;
    for (; size >= 34; size -= 4) {
      g.font = `400 ${size}px ${family}`;
      lines = wrapLines((s) => g.measureText(s).width, this.text, maxText);
      const nameH = this.style.name ? size * 0.78 : 0;
      if (lines.length * size * 1.22 + nameH + 64 <= H - 70) break;
    }
    g.font = `400 ${size}px ${family}`;
    const lineH = size * 1.22;
    const nameSize = Math.round(size * 0.62);
    const nameH = this.style.name ? nameSize * 1.35 : 0;
    const textW = Math.max(...lines.map((l) => g.measureText(l).width), this.style.name ? (g.font = `700 ${nameSize}px ${family}`, g.measureText(this.style.name).width) : 0);
    const padX = 44;
    const padY = 30;
    const bw = Math.min(W - 24, Math.max(220, textW + padX * 2));
    const bh = lines.length * lineH + nameH + padY * 2 - (lineH - size) * 0.6;
    const tail = 46;
    const x = (W - bw) / 2;
    const y = H - tail - bh - 8;
    const rad = Math.min(46, bh / 2);

    // Shadow, then paper.
    g.save();
    g.shadowColor = 'rgba(90, 55, 25, 0.28)';
    g.shadowBlur = 22;
    g.shadowOffsetY = 7;
    bubblePath(g, x, y, bw, bh, rad, tail);
    const grad = g.createLinearGradient(0, y, 0, y + bh);
    grad.addColorStop(0, '#fffbf3');
    grad.addColorStop(1, '#f8ecd8');
    g.fillStyle = grad;
    g.fill();
    g.restore();
    // Paper fibre: a few faint strokes keep it from looking like a flat panel.
    g.save();
    bubblePath(g, x, y, bw, bh, rad, tail);
    g.clip();
    let seed = this.text.length * 31 + 7;
    const rnd = (): number => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    g.globalAlpha = 0.05;
    g.strokeStyle = '#a07040';
    g.lineWidth = 1.2;
    for (let i = 0; i < 70; i++) {
      const fx = x + rnd() * bw;
      const fy = y + rnd() * bh;
      g.beginPath();
      g.moveTo(fx, fy);
      g.lineTo(fx + (rnd() - 0.5) * 30, fy + (rnd() - 0.5) * 8);
      g.stroke();
    }
    g.restore();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(176, 140, 96, 0.55)';
    bubblePath(g, x, y, bw, bh, rad, tail);
    g.stroke();

    let ty = y + padY;
    g.textBaseline = 'top';
    if (this.style.name) {
      g.font = `700 ${nameSize}px ${family}`;
      g.fillStyle = darken(this.style.accent ?? '#9a5a2a', 0.72);
      g.textAlign = 'left';
      g.fillText(this.style.name, x + padX, ty);
      ty += nameH;
    }
    g.font = `400 ${size}px ${family}`;
    g.fillStyle = '#33251c';
    g.textAlign = 'left';
    for (const l of lines) {
      g.fillText(l, x + padX, ty);
      ty += lineH;
    }
    this.texture.needsUpdate = true;
  }

  /**
   * Place the bubble with its tail at `anchor` (world), turned toward `head`, scaled to
   * stay readable from there. Returns false when it has faded out.
   */
  update(dt: number, anchor: Vector3, head: Vector3, parentInverse?: (v: Vector3) => Vector3): boolean {
    if (!this.shown) return false;
    this.age += dt;
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

function bubblePath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, tail: number): void {
  const cx = x + w / 2;
  g.beginPath();
  g.moveTo(x + r, y);
  g.lineTo(x + w - r, y);
  g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(cx + 30, y + h);
  g.quadraticCurveTo(cx + 8, y + h + tail * 0.45, cx - 4, y + h + tail);
  g.quadraticCurveTo(cx - 6, y + h + tail * 0.4, cx - 26, y + h);
  g.lineTo(x + r, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

export type { Object3D };
