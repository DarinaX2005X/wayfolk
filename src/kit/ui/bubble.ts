/**
 * Paper bubbles drawn on a canvas: a rounded card with a soft rim and a tail, large
 * Atkinson text, wrapped at words. One mesh, one draw call per bubble. Used for the reply
 * bubbles by the hand, Pip's lines in the stand-in, the postcard card and the QR card.
 *
 * Size is given in metres of the bubble's width; the height follows the text.
 */
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from '@iwsdk/core';

export const FONT = "'Atkinson Hyperlegible Next', 'Atkinson Fallback', system-ui, sans-serif";

export type BubbleStyle = {
  /** Paper colour. */
  paper?: string;
  ink?: string;
  rim?: string;
  /** Width of the bubble in metres. */
  width?: number;
  /** Text size in px at 512 px canvas width. */
  size?: number;
  bold?: boolean;
  tail?: 'down' | 'none' | 'left';
  /** Pixels per metre of the texture (sharpness). */
  ppm?: number;
  align?: 'center' | 'left';
  /** A small label above the text (the speaker). */
  label?: string;
  /**
   * A reply: the same paper speech bubble as the page's reply buttons (cream paper, a warm
   * inner rim, a solid drop under it, one sharp corner toward the speaker, bold text).
   */
  reply?: boolean;
  /** A little word cloud to poke: puffs round the words, a soft shadow, no tail. */
  cloud?: boolean;
};

const DEFAULT: Required<Omit<BubbleStyle, 'label' | 'reply' | 'cloud'>> = {
  paper: '#fff8ec',
  ink: '#3a2c22',
  rim: '#e8c9a0',
  width: 0.22,
  size: 44,
  bold: false,
  tail: 'down',
  ppm: 2400,
  align: 'center',
};

/** Splits text into lines that fit `max` px with the context's current font. */
export function wrapText(ctx: { measureText(s: string): { width: number } }, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, bl = r): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * A word cloud: bold words inside a small puffy cloud with a soft shadow. The canvas keeps
 * room round the cloud for the puffs and the shadow; the mesh is as wide as `width`.
 */
function drawCloud(text: string, s: Required<Omit<BubbleStyle, 'label' | 'reply' | 'cloud'>>): { canvas: HTMLCanvasElement; w: number; h: number } {
  const W = 512;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  measure.font = `700 ${s.size}px ${FONT}`;
  const lines = wrapText(measure, text, W - 170);
  const lineH = s.size * 1.18;
  const textW = Math.max(...lines.map((l) => measure.measureText(l).width));
  const bw = Math.max(150, textW + 40);
  const bh = lines.length * lineH + 26;
  const H = Math.ceil(bh + 120);
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  const x = (W - bw) / 2;
  const y = (H - bh) / 2 - 6;
  let seed = text.length * 17 + 3;
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const r0 = Math.min(44, bh * 0.55);
  const puffs: [number, number, number][] = [];
  const n = Math.max(2, Math.round(bw / (r0 * 1.15)));
  for (let i = 0; i <= n; i += 1) {
    const u = i / n;
    puffs.push([x + u * bw, y + 4 + rnd() * 6, r0 * (0.8 + rnd() * 0.35) * (1 - 0.25 * Math.abs(u - 0.5))]);
    puffs.push([x + u * bw, y + bh - 4, r0 * (0.65 + rnd() * 0.25)]);
  }
  puffs.push([x, y + bh / 2, r0 * 0.85], [x + bw, y + bh / 2, r0 * 0.85]);
  const path = (): void => {
    g.beginPath();
    g.rect(x, y, bw, bh);
    for (const [cx, cy, r] of puffs) {
      g.moveTo(cx + r, cy);
      g.arc(cx, cy, r, 0, Math.PI * 2);
    }
  };
  g.save();
  g.shadowColor = 'rgba(70, 60, 90, 0.3)';
  g.shadowBlur = 18;
  g.shadowOffsetY = 8;
  path();
  g.fillStyle = s.paper;
  g.fill('nonzero');
  g.restore();
  g.save();
  path();
  g.clip('nonzero');
  const grad = g.createLinearGradient(0, y - r0, 0, y + bh + r0);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.6, s.paper);
  grad.addColorStop(1, s.rim);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.restore();
  g.font = `700 ${s.size}px ${FONT}`;
  g.fillStyle = s.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, W / 2, y + bh / 2 + (i - (lines.length - 1) / 2) * lineH));
  return { canvas, w: s.width, h: (H / W) * s.width };
}

/** A reply bubble, drawn like the page's `.desk-choice` buttons at this canvas scale. */
function drawReply(text: string, s: Required<Omit<BubbleStyle, 'label' | 'reply' | 'cloud'>>): { canvas: HTMLCanvasElement; w: number; h: number } {
  const W = 512;
  const k = s.size / 17;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  measure.font = `700 ${s.size}px ${FONT}`;
  const padX = Math.round(18 * k);
  const padY = Math.round(11 * k);
  const lines = wrapText(measure, text, W - padX * 2 - 8);
  const lineH = s.size * 1.25;
  const drop = Math.round(5 * k);
  const bodyH = Math.ceil(padY * 2 + lines.length * lineH);
  const H = bodyH + drop + 4;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const r = Math.min(bodyH / 2, 20 * k);
  // The solid drop under the paper, then the paper with its warm inner rim.
  ctx.fillStyle = 'rgba(90, 42, 23, 0.22)';
  roundRect(ctx, 2, 2 + drop, W - 4, bodyH - 2, r, 6 * k);
  ctx.fill();
  ctx.fillStyle = s.paper;
  roundRect(ctx, 2, 2, W - 4, bodyH - 2, r, 6 * k);
  ctx.fill();
  const rim = 3 * k;
  ctx.strokeStyle = s.rim;
  ctx.lineWidth = rim;
  roundRect(ctx, 2 + rim / 2, 2 + rim / 2, W - 4 - rim, bodyH - 2 - rim, r - rim / 2, Math.max(2, 6 * k - rim / 2));
  ctx.stroke();
  ctx.font = `700 ${s.size}px ${FONT}`;
  ctx.fillStyle = s.ink;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  let y = padY + (lineH - s.size) / 2;
  for (const line of lines) {
    ctx.fillText(line, padX, y);
    y += lineH;
  }
  return { canvas, w: s.width, h: (H / W) * s.width };
}

/** Draws a bubble into a new canvas; returns it with its size in metres. */
export function drawBubble(text: string, style: BubbleStyle = {}): { canvas: HTMLCanvasElement; w: number; h: number } {
  const s = { ...DEFAULT, ...style };
  if (style.cloud) return drawCloud(text, s);
  if (style.reply) return drawReply(text, s);
  const W = 512;
  const scale = W / (s.width * 1000) * 1000; // px per metre of this texture
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d')!;
  const weight = s.bold ? 700 : 400;
  measure.font = `${weight} ${s.size}px ${FONT}`;
  const pad = 30;
  const lines = wrapText(measure, text, W - pad * 2 - 8);
  const lineH = s.size * 1.3;
  const labelH = s.label ? s.size * 0.75 : 0;
  const tailH = s.tail === 'down' ? 26 : 0;
  const bodyH = Math.ceil(pad * 1.6 + labelH + lines.length * lineH);
  const H = bodyH + tailH + 8;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  // Soft shadow under the card.
  ctx.fillStyle = 'rgba(80, 50, 30, 0.18)';
  roundRect(ctx, 6, 8, W - 12, bodyH - 4, 34);
  ctx.fill();
  ctx.fillStyle = s.paper;
  ctx.strokeStyle = s.rim;
  ctx.lineWidth = 5;
  roundRect(ctx, 4, 3, W - 12, bodyH - 6, 34);
  ctx.fill();
  ctx.stroke();
  if (s.tail === 'down') {
    ctx.beginPath();
    ctx.moveTo(W / 2 - 22, bodyH - 5);
    ctx.lineTo(W / 2, bodyH + tailH);
    ctx.lineTo(W / 2 + 22, bodyH - 5);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 22, bodyH - 4);
    ctx.lineTo(W / 2, bodyH + tailH);
    ctx.lineTo(W / 2 + 22, bodyH - 4);
    ctx.stroke();
  }
  ctx.textBaseline = 'top';
  let y = pad * 0.8;
  if (s.label) {
    ctx.font = `700 ${Math.round(s.size * 0.6)}px ${FONT}`;
    ctx.fillStyle = '#b0703a';
    ctx.textAlign = s.align;
    ctx.fillText(s.label, s.align === 'center' ? W / 2 : pad, y);
    y += labelH;
  }
  ctx.font = `${weight} ${s.size}px ${FONT}`;
  ctx.fillStyle = s.ink;
  ctx.textAlign = s.align;
  for (const line of lines) {
    ctx.fillText(line, s.align === 'center' ? W / 2 : pad, y);
    y += lineH;
  }
  return { canvas, w: s.width, h: (H / W) * s.width * (scale / scale) };
}

/** A bubble mesh facing +Z; its origin is at the tip of the tail (bottom centre). */
export function makeBubble(text: string, style: BubbleStyle = {}): Mesh<PlaneGeometry, MeshBasicMaterial> & { setText(t: string): void } {
  const geometry = new PlaneGeometry(1, 1);
  const material = new MeshBasicMaterial({ transparent: true, side: DoubleSide, depthWrite: false, toneMapped: false });
  const mesh = new Mesh(geometry, material) as Mesh<PlaneGeometry, MeshBasicMaterial> & { setText(t: string): void };
  mesh.renderOrder = 20;
  const apply = (t: string): void => {
    const { canvas, w, h } = drawBubble(t, style);
    material.map?.dispose();
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    material.map = texture;
    material.needsUpdate = true;
    geometry.dispose();
    const g = new PlaneGeometry(w, h);
    g.translate(0, h / 2, 0);
    mesh.geometry = g;
  };
  mesh.setText = apply;
  apply(text);
  return mesh;
}

/** Frees the bubble's texture and geometry. */
export function disposeBubble(mesh: Mesh): void {
  const material = mesh.material as MeshBasicMaterial;
  material.map?.dispose();
  material.dispose();
  mesh.geometry.dispose();
  mesh.removeFromParent();
}
