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
};

const DEFAULT: Required<Omit<BubbleStyle, 'label' | 'reply'>> = {
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

/** A reply bubble, drawn like the page's `.desk-choice` buttons at this canvas scale. */
function drawReply(text: string, s: Required<Omit<BubbleStyle, 'label' | 'reply'>>): { canvas: HTMLCanvasElement; w: number; h: number } {
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
