/**
 * The evening theatre: a paper silhouette stage that opens in the clouds in front of the
 * seated person and plays one chapter (src/mind/chapters.ts).
 *
 *   things are made of cut paper, lit from behind by a warm screen, and move like stick
 *   puppets: a rocking hop when they walk, pop-up scenery, a paper flip when they turn.
 *
 * Three depths of cut-outs (far hazy and warm, near dark and sharp) stand in front of a
 * glowing paper screen with its own ground rows, framed by cream paper clouds. Under it a
 * paper strip carries the line being told. Everything is one atlas texture drawn for the
 * chapter, so a stage costs about twenty draw calls and no lights.
 *
 * The timeline is a pure function of time (`seek(t)` replays it with a fixed step), so a
 * frame of any moment can be rendered for a check.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Object3D,
} from '@iwsdk/core';
import type { CastMember, Chapter, SilhouetteKind, StageAction, StageLayer, StageMood, StagePlace } from '../mind/types';
import { KINDS, drawKind } from './silhouettes';

// ---------------------------------------------------------------- geometry of the stage

/** Size of the paper screen, metres. */
export const STAGE = { width: 6.2, height: 3.5 } as const;
const HALF = STAGE.width / 2;
const LAYER_Z: Record<StageLayer, number> = { far: -0.9, mid: -0.45, near: 0 };
const LAYER_SCALE: Record<StageLayer, number> = { far: 0.56, mid: 0.78, near: 1 };
/** The ground line of each layer (top of its ground row). */
const LAYER_GROUND: Record<StageLayer, number> = { far: 0.72, mid: 0.42, near: 0.16 };
const PLACE_X: Record<StagePlace, number> = {
  'far-left': -2.25,
  left: -1.25,
  center: 0,
  right: 1.25,
  'far-right': 2.25,
  'sky-left': -1.55,
  sky: 0,
  'sky-right': 1.6,
  high: 0.3,
  'offstage-left': -HALF - 1.4,
  'offstage-right': HALF + 1.4,
  below: 0,
  above: 0,
};
const SKY_Y: Partial<Record<StagePlace, number>> = { 'sky-left': 2.35, sky: 2.55, 'sky-right': 2.35, high: 2.9 };

type Palette = { center: string; mid: string; edge: string; far: string; middle: string; near: string; halo: string; cloud: string; ink: string };
const MOODS: Record<StageMood, Palette> = {
  dusk: { center: '#ffe0a6', mid: '#f6a970', edge: '#c9654b', far: '#e39468', middle: '#9a4e37', near: '#2a1611', halo: '#ffb070', cloud: '#fde9d0', ink: '#3a2418' },
  night: { center: '#5d84ab', mid: '#2f4a72', edge: '#16223d', far: '#3a5880', middle: '#1f3150', near: '#0b111c', halo: '#7aa6d8', cloud: '#c9d6ea', ink: '#1f2a3d' },
  day: { center: '#fff4cf', mid: '#f9d690', edge: '#e2a867', far: '#e8b789', middle: '#ad7750', near: '#382317', halo: '#ffd890', cloud: '#fff6e6', ink: '#3a2418' },
  storm: { center: '#d8d0c2', mid: '#9c96a0', edge: '#5e5b6c', far: '#857f8c', middle: '#504c5a', near: '#1b1a21', halo: '#c8c0d0', cloud: '#e6e2ea', ink: '#2b2833' },
};

// ---------------------------------------------------------------- textures

type Cell = { u0: number; v0: number; u1: number; v1: number; aspect: number };
type AtlasKey = SilhouetteKind | 'row-far' | 'row-mid' | 'row-near' | 'row-sea';
const ROW_ASPECT = 6;

function drawRow(c: CanvasRenderingContext2D, key: AtlasKey, x: number, y: number, h: number): void {
  const w = h * ROW_ASPECT;
  c.save();
  c.translate(x, y);
  c.scale(h, h);
  c.fillStyle = '#fff';
  const W = ROW_ASPECT;
  c.beginPath();
  if (key === 'row-far') {
    c.moveTo(0, 1);
    c.lineTo(0, 0.55);
    c.bezierCurveTo(W * 0.1, 0.25, W * 0.2, 0.3, W * 0.3, 0.5);
    c.bezierCurveTo(W * 0.4, 0.2, W * 0.55, 0.15, W * 0.62, 0.45);
    c.bezierCurveTo(W * 0.72, 0.3, W * 0.85, 0.2, W, 0.5);
    c.lineTo(W, 1);
    c.closePath();
    c.fill();
    // Tiny trees on the ridges.
    for (const [k, s] of [[0.13, 0.12], [0.16, 0.09], [0.52, 0.14], [0.56, 0.1], [0.83, 0.11]] as const) {
      const tx = W * k;
      const ty = 0.33 - s * 0.2;
      c.beginPath();
      c.moveTo(tx - s * 0.5, ty + s * 0.9);
      c.lineTo(tx, ty - s * 0.9);
      c.lineTo(tx + s * 0.5, ty + s * 0.9);
      c.closePath();
      c.fill();
    }
  } else if (key === 'row-mid') {
    c.moveTo(0, 1);
    c.lineTo(0, 0.6);
    c.bezierCurveTo(W * 0.2, 0.35, W * 0.35, 0.55, W * 0.5, 0.5);
    c.bezierCurveTo(W * 0.7, 0.42, W * 0.85, 0.62, W, 0.45);
    c.lineTo(W, 1);
    c.closePath();
    c.fill();
    for (const [k, s] of [[0.08, 0.28], [0.27, 0.2], [0.74, 0.24], [0.93, 0.3]] as const) {
      c.beginPath();
      c.ellipse(W * k, 0.5, s, s * 0.75, 0, 0, Math.PI * 2);
      c.fill();
    }
  } else if (key === 'row-near') {
    c.moveTo(0, 1);
    c.lineTo(0, 0.45);
    c.bezierCurveTo(W * 0.25, 0.3, W * 0.5, 0.42, W * 0.75, 0.32);
    c.bezierCurveTo(W * 0.85, 0.28, W * 0.95, 0.35, W, 0.4);
    c.lineTo(W, 1);
    c.closePath();
    c.fill();
    // Grass tufts and a few flowers along the front edge.
    let seed = 17;
    const r = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 70; i += 1) {
      const gx = r() * W;
      const base = 0.42 - Math.sin((gx / W) * Math.PI * 2) * 0.05;
      const gh = 0.12 + r() * 0.22;
      c.beginPath();
      c.moveTo(gx - 0.02, base + 0.05);
      c.quadraticCurveTo(gx + (r() - 0.5) * 0.1, base - gh * 0.6, gx + (r() - 0.5) * 0.12, base - gh);
      c.quadraticCurveTo(gx + 0.01, base - gh * 0.4, gx + 0.03, base + 0.05);
      c.closePath();
      c.fill();
      if (i % 9 === 0) {
        c.beginPath();
        c.arc(gx + 0.02, base - gh - 0.03, 0.035, 0, Math.PI * 2);
        c.fill();
      }
    }
  } else {
    // A row of waves for a story at sea.
    c.moveTo(0, 1);
    c.lineTo(0, 0.5);
    const n = 10;
    for (let i = 0; i < n; i += 1) {
      const x0 = (i / n) * W;
      const x1 = ((i + 1) / n) * W;
      c.bezierCurveTo(x0 + (x1 - x0) * 0.3, 0.1, x0 + (x1 - x0) * 0.6, 0.2, x0 + (x1 - x0) * 0.75, 0.42);
      c.quadraticCurveTo(x0 + (x1 - x0) * 0.66, 0.6, x1, 0.5);
    }
    c.lineTo(W, 1);
    c.closePath();
    c.fill();
  }
  c.restore();
  void w;
}

/** Packs the chapter's cut-outs into one canvas in shelves; returns UV cells. */
function buildAtlas(keys: AtlasKey[]): { texture: CanvasTexture; cells: Map<AtlasKey, Cell> } {
  const SIZE = 2048;
  const aspectOf = (k: AtlasKey): number => (k.startsWith('row-') ? ROW_ASPECT : KINDS[k as SilhouetteKind].aspect);
  const heightFor = (k: AtlasKey, base: number): number => (k.startsWith('row-') ? Math.min(base * 0.62, (SIZE - 8) / ROW_ASPECT) : KINDS[k as SilhouetteKind].weather ? base * 0.8 : base);
  let base = 400;
  let layout: { k: AtlasKey; x: number; y: number; w: number; h: number }[] = [];
  for (let tries = 0; tries < 6; tries += 1) {
    layout = [];
    let x = 4;
    let y = 4;
    let row = 0;
    let fits = true;
    for (const k of keys) {
      const h = Math.floor(heightFor(k, base));
      const w = Math.ceil(h * aspectOf(k));
      if (x + w + 4 > SIZE) {
        x = 4;
        y += row + 6;
        row = 0;
      }
      if (y + h + 4 > SIZE || w + 8 > SIZE) {
        fits = false;
        break;
      }
      layout.push({ k, x, y, w, h });
      x += w + 6;
      row = Math.max(row, h);
    }
    if (fits) break;
    base = Math.floor(base * 0.82);
  }
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const cells = new Map<AtlasKey, Cell>();
  for (const { k, x, y, w, h } of layout) {
    if (k.startsWith('row-')) drawRow(ctx, k, x, y, h);
    else drawKind(ctx, k as SilhouetteKind, x, y, h);
    cells.set(k, { u0: x / SIZE, u1: (x + w) / SIZE, v0: 1 - (y + h) / SIZE, v1: 1 - y / SIZE, aspect: aspectOf(k) });
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.minFilter = LinearMipmapLinearFilter;
  return { texture, cells };
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number): void {
  let s = seed;
  const r = (): number => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.save();
  for (let i = 0; i < (w * h) / 90; i += 1) {
    const x = r() * w;
    const y = r() * h;
    ctx.globalAlpha = amount * (0.4 + r() * 0.6);
    ctx.fillStyle = r() < 0.5 ? '#fff8ec' : '#7a4a30';
    ctx.fillRect(x, y, 1 + r() * 2.5, 1);
  }
  // Long paper fibres.
  ctx.lineWidth = 1;
  for (let i = 0; i < 160; i += 1) {
    const x = r() * w;
    const y = r() * h;
    ctx.globalAlpha = amount * 0.7;
    ctx.strokeStyle = '#fff3dc';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30, x + (r() - 0.5) * 60, y + (r() - 0.5) * 20);
    ctx.stroke();
  }
  ctx.restore();
}

/** The glowing paper screen: a warm gradient with fibres and soft torn edges. */
function backdropTexture(p: Palette, seed: number): CanvasTexture {
  const W = 1024;
  const H = Math.round((W * STAGE.height) / STAGE.width);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(W * 0.5, H * 0.62, H * 0.08, W * 0.5, H * 0.55, W * 0.62);
  g.addColorStop(0, p.center);
  g.addColorStop(0.5, p.mid);
  g.addColorStop(1, p.edge);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  noise(c, W, H, 0.09, seed);
  // Feathered, slightly wavy edge: the screen melts into the clouds.
  c.globalCompositeOperation = 'destination-in';
  const mask = c.createRadialGradient(W / 2, H / 2, H * 0.36, W / 2, H / 2, W * 0.56);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.72, 'rgba(0,0,0,0.92)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  c.save();
  c.scale(1, H / W / 0.62);
  c.fillStyle = mask;
  c.fillRect(0, 0, W, H / (H / W / 0.62));
  c.restore();
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function haloTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const c = canvas.getContext('2d')!;
  const g = c.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function weatherTexture(kind: 'rain' | 'snow'): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const c = canvas.getContext('2d')!;
  drawKind(c, kind, 0, 0, 256);
  drawKind(c, kind, 0, 256, 256);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(1.5, 1.2);
  return t;
}

// ---------------------------------------------------------------- caption strip

const FONT = "'Atkinson Hyperlegible Next', 'Atkinson Fallback', system-ui, sans-serif";

function wrap(c: CanvasRenderingContext2D, text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (c.measureText(next).width <= max || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A torn strip of paper with the teller's name and the line. */
function drawCaption(canvas: HTMLCanvasElement, name: string, text: string, ink: string): void {
  const W = canvas.width;
  const H = canvas.height;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, W, H);
  if (!text) return;
  c.font = `400 56px ${FONT}`;
  const lines = wrap(c, text, W - 120).slice(0, 3);
  const bodyH = 70 + lines.length * 68;
  const top = (H - bodyH) / 2;
  // Torn edges: a jagged outline drawn from the seed of the text.
  let seed = text.length * 97 + 13;
  const r = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  c.save();
  c.shadowColor = 'rgba(60,30,15,0.35)';
  c.shadowBlur = 18;
  c.shadowOffsetY = 6;
  c.fillStyle = '#fbf1de';
  c.beginPath();
  c.moveTo(20, top + 6);
  for (let x = 20; x <= W - 20; x += 22) c.lineTo(x, top + r() * 8);
  for (let y = top; y <= top + bodyH; y += 20) c.lineTo(W - 20 + r() * 6, y);
  for (let x = W - 20; x >= 20; x -= 22) c.lineTo(x, top + bodyH - r() * 8);
  for (let y = top + bodyH; y >= top; y -= 20) c.lineTo(20 - r() * 6, y);
  c.closePath();
  c.fill();
  c.restore();
  c.fillStyle = '#b8683a';
  c.font = `700 34px ${FONT}`;
  c.textBaseline = 'top';
  c.textAlign = 'left';
  c.fillText(name, 60, top + 22);
  c.fillStyle = ink;
  c.font = `400 56px ${FONT}`;
  c.textAlign = 'center';
  lines.forEach((l, i) => c.fillText(l, W / 2, top + 58 + i * 68));
}

// ---------------------------------------------------------------- actors and the timeline

type Tween = { t0: number; dur: number; kind: StageAction['do'] | 'intro' | 'outro'; fromX?: number; fromY?: number; toX?: number; toY?: number; then?: () => void; arc?: number };

type Actor = {
  member: CastMember;
  info: (typeof KINDS)[SilhouetteKind];
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  base: Color;
  layer: StageLayer;
  x: number;
  y: number;
  /** World height of this cut-out on its layer. */
  h: number;
  scale: number;
  scaleGoal: number;
  facing: number;
  opacity: number;
  on: boolean;
  move: Tween | null;
  fx: Tween[];
  walked: number;
  swayUntil: number;
};

export type StageOptions = {
  /** Where the stage hangs (the scene, or a root under it). */
  parent: Object3D;
  /** Seconds the caption strip lingers is tied to the beat; less motion keeps end states. */
  lessMotion?: () => boolean;
};

export type PlayOptions = {
  /** The teller's name on the caption strip. */
  name: string;
  /** A line starts: the caller makes the teller speak it. */
  onBeat?(index: number, line: string): void;
};

export type Stage = {
  readonly group: Group;
  readonly playing: boolean;
  /** Index of the beat now told, -1 during the opening, beats.length during the close. */
  readonly beat: number;
  /** Seconds since the chapter started. */
  readonly time: number;
  play(chapter: Chapter, opts: PlayOptions): Promise<void>;
  /** Hurries to the next line. */
  next(): void;
  /** Ends the chapter now (the stage folds away). */
  stop(): void;
  /** Steps the stage; the app calls it every frame. */
  update(dt: number): void;
  /** Replays the chapter to `t` seconds without speaking (frames for checks). */
  seek(t: number): void;
  /** How long each beat lasts, seconds. */
  timeline(chapter: Chapter): { intro: number; beats: { start: number; dur: number }[]; total: number };
  dispose(): void;
};

const INTRO = 3.0;
const OUTRO = 2.6;

export function beatSeconds(line: string): number {
  return Math.min(10.5, Math.max(4.6, 2.2 + line.length * 0.052));
}

export function createStage(opts: StageOptions): Stage {
  const group = new Group();
  group.name = 'theatre';
  group.visible = false;
  opts.parent.add(group);

  const halo = new Mesh(
    new PlaneGeometry(STAGE.width * 1.9, STAGE.height * 2.1),
    new MeshBasicMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: false, opacity: 0 }),
  );
  halo.position.set(0, STAGE.height * 0.5, -1.3);
  halo.renderOrder = 1;
  group.add(halo);

  const backdropMat = new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, fog: false, side: DoubleSide, opacity: 0 });
  const backdrop = new Mesh(new PlaneGeometry(STAGE.width * 1.12, STAGE.height * 1.12), backdropMat);
  backdrop.position.set(0, STAGE.height * 0.5, -1.15);
  backdrop.renderOrder = 2;
  group.add(backdrop);

  const capCanvas = document.createElement('canvas');
  capCanvas.width = 1600;
  capCanvas.height = 300;
  const capTex = new CanvasTexture(capCanvas);
  capTex.colorSpace = SRGBColorSpace;
  capTex.anisotropy = 4;
  const capMat = new MeshBasicMaterial({ map: capTex, transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0 });
  const caption = new Mesh(new PlaneGeometry(4.4, (4.4 * 300) / 1600), capMat);
  caption.name = 'theatre:caption';
  caption.position.set(0, -0.62, 0.35);
  caption.renderOrder = 30;
  group.add(caption);

  let atlas: { texture: CanvasTexture; cells: Map<AtlasKey, Cell> } | null = null;
  let actors: Actor[] = [];
  let rows: { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; layer: StageLayer; base: Color; y: number }[] = [];
  let clouds: { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; home: { x: number; y: number }; out: { x: number; y: number } }[] = [];
  let weather: { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; actor: Actor; speed: number }[] = [];
  let chapter: Chapter | null = null;
  let play: PlayOptions | null = null;
  let resolveDone: (() => void) | null = null;
  let t = 0;
  let beatIndex = -2;
  let beatStart = 0;
  let beatDur = 0;
  let ending = -1;
  let silent = false;
  let palette = MOODS.dusk;

  const geometryFor = (cell: Cell, h: number, center: boolean): PlaneGeometry => {
    const g = new PlaneGeometry(h * cell.aspect, h);
    if (!center) g.translate(0, h / 2, 0);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) === 0 ? cell.u0 : cell.u1, uv.getY(i) === 0 ? cell.v0 : cell.v1);
    }
    uv.needsUpdate = true;
    return g;
  };

  const tintFor = (layer: StageLayer): Color => new Color(layer === 'far' ? palette.far : layer === 'mid' ? palette.middle : palette.near);

  const groundY = (layer: StageLayer): number => LAYER_GROUND[layer];

  const placeXY = (a: Actor, place: StagePlace): { x: number; y: number } => {
    const k = LAYER_SCALE[a.layer];
    const x = PLACE_X[place] * (place.startsWith('offstage') ? 1 : 0.6 + k * 0.4);
    if (place === 'below') return { x: a.x, y: -2.4 };
    if (place === 'above') return { x: a.x, y: STAGE.height + 1.5 };
    const sky = SKY_Y[place];
    if (sky !== undefined) return { x, y: sky - (1 - k) * 0.4 };
    if (a.info.sky) return { x, y: a.member.kind === 'moon' || a.member.kind === 'sun' ? 2.3 : 2.2 };
    return { x, y: groundY(a.layer) };
  };

  function clear(): void {
    for (const a of actors) {
      a.mesh.geometry.dispose();
      a.mesh.material.dispose();
      a.mesh.removeFromParent();
    }
    for (const r of rows) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
      r.mesh.removeFromParent();
    }
    for (const c of clouds) {
      c.mesh.geometry.dispose();
      c.mesh.material.dispose();
      c.mesh.removeFromParent();
    }
    for (const w of weather) w.mesh.material.map?.dispose();
    actors = [];
    rows = [];
    clouds = [];
    weather = [];
    atlas?.texture.dispose();
    atlas = null;
    backdropMat.map?.dispose();
    backdropMat.map = null;
  }

  function build(ch: Chapter): void {
    clear();
    palette = MOODS[ch.mood];
    const atSea = ch.cast.some((c) => c.kind === 'sea' || c.kind === 'boat' || c.kind === 'paper-boat' || c.kind === 'fish');
    const keys = new Set<AtlasKey>(['row-far', atSea ? 'row-sea' : 'row-mid', 'row-near', 'cloud']);
    for (const c of ch.cast) if (c.kind !== 'rain' && c.kind !== 'snow') keys.add(c.kind);
    atlas = buildAtlas([...keys]);
    backdropMat.map = backdropTexture(palette, ch.id.length * 31 + ch.n);
    backdropMat.needsUpdate = true;
    (halo.material as MeshBasicMaterial).color.set(palette.halo);

    // Ground rows of each depth.
    const rowKey: Record<StageLayer, AtlasKey> = { far: 'row-far', mid: atSea ? 'row-sea' : 'row-mid', near: atSea ? 'row-sea' : 'row-near' };
    const rowH: Record<StageLayer, number> = { far: 1.1, mid: 0.8, near: 0.42 };
    for (const layer of ['far', 'mid', 'near'] as StageLayer[]) {
      const cell = atlas.cells.get(rowKey[layer])!;
      const h = rowH[layer];
      const w = STAGE.width * (layer === 'far' ? 1.05 : layer === 'mid' ? 1.1 : 1.2);
      const g = new PlaneGeometry(w, h);
      g.translate(0, h / 2, 0);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) === 0 ? cell.u0 : cell.u1, uv.getY(i) === 0 ? cell.v0 : cell.v1);
      const base = tintFor(layer);
      const mat = new MeshBasicMaterial({ map: atlas.texture, color: base, transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0, side: DoubleSide });
      const mesh = new Mesh(g, mat);
      const y = groundY(layer) - h * (layer === 'near' ? 0.55 : 0.45);
      mesh.position.set(layer === 'mid' ? 0.3 : 0, y, LAYER_Z[layer] - 0.02);
      mesh.renderOrder = layer === 'far' ? 4 : layer === 'mid' ? 8 : 12;
      group.add(mesh);
      rows.push({ mesh, layer, base, y });
    }

    // Cast.
    const order: StageLayer[] = ['far', 'mid', 'near'];
    for (const m of ch.cast) {
      const info = KINDS[m.kind];
      if (m.kind === 'rain' || m.kind === 'snow') {
        const tex = weatherTexture(m.kind);
        const mat = new MeshBasicMaterial({ map: tex, color: m.kind === 'rain' ? tintFor('mid') : new Color('#ffffff'), transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0 });
        const mesh = new Mesh(new PlaneGeometry(STAGE.width * 0.98, STAGE.height * 0.95), mat);
        mesh.position.set(0, STAGE.height * 0.5, LAYER_Z.mid + 0.1);
        mesh.renderOrder = 9;
        group.add(mesh);
        const actor = makeActor(m, info, mesh, mat.color.clone(), 1);
        actor.x = 0;
        actor.y = STAGE.height * 0.5;
        actors.push(actor);
        weather.push({ mesh, actor, speed: m.kind === 'rain' ? 1.6 : 0.25 });
        continue;
      }
      const cell = atlas.cells.get(m.kind)!;
      const k = LAYER_SCALE[m.layer];
      const h = info.height * k * (m.size ?? 1) * (info.strip ? 1.2 : 1);
      const center = Boolean(info.sky) || Boolean(info.weather);
      const base = info.light ? new Color('#ffffff') : tintFor(m.layer);
      const mat = new MeshBasicMaterial({ map: atlas.texture, color: base.clone(), transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0, side: DoubleSide });
      const mesh = new Mesh(geometryFor(cell, h, center), mat);
      mesh.name = `theatre:${m.id}`;
      mesh.renderOrder = 5 + order.indexOf(m.layer) * 4 + (info.light ? 0 : 1);
      group.add(mesh);
      const actor = makeActor(m, info, mesh, base, h);
      const p = placeXY(actor, m.at);
      actor.x = m.hidden ? (p.x < 0 ? PLACE_X['offstage-left'] : PLACE_X['offstage-right']) : p.x;
      actor.y = p.y;
      actor.on = !m.hidden;
      actor.opacity = 0;
      actors.push(actor);
    }

    // Cream paper clouds framing the screen; they part when the stage opens.
    const cc = atlas.cells.get('cloud')!;
    const frame = [
      { x: -2.9, y: -0.05, s: 1.5, o: { x: -4.6, y: -0.5 } },
      { x: 2.95, y: 0.0, s: 1.7, o: { x: 4.7, y: -0.4 } },
      { x: -3.1, y: 2.9, s: 1.2, o: { x: -4.8, y: 3.6 } },
      { x: 3.05, y: 3.2, s: 1.3, o: { x: 4.8, y: 3.8 } },
      { x: -1.1, y: -0.35, s: 1.1, o: { x: -1.6, y: -1.4 } },
      { x: 1.4, y: -0.4, s: 1.25, o: { x: 2.2, y: -1.5 } },
      { x: 0.2, y: 3.55, s: 1.0, o: { x: 0.3, y: 4.6 } },
    ];
    for (const f of frame) {
      const mat = new MeshBasicMaterial({ map: atlas.texture, color: new Color(palette.cloud), transparent: true, depthWrite: false, toneMapped: false, fog: false, opacity: 0, side: DoubleSide });
      const mesh = new Mesh(geometryFor(cc, f.s, true), mat);
      mesh.position.set(f.o.x, f.o.y, 0.45);
      mesh.renderOrder = 25;
      group.add(mesh);
      clouds.push({ mesh, home: { x: f.x, y: f.y }, out: f.o });
    }
  }

  function makeActor(m: CastMember, info: KindInfoLike, mesh: Mesh<PlaneGeometry, MeshBasicMaterial>, base: Color, h: number): Actor {
    return {
      member: m,
      info,
      mesh,
      base,
      layer: m.layer,
      x: 0,
      y: 0,
      h,
      scale: 1,
      scaleGoal: 1,
      facing: m.facing === 'left' ? -1 : 1,
      opacity: 0,
      on: !m.hidden,
      move: null,
      fx: [],
      walked: 0,
      swayUntil: 0,
    };
  }

  const ease = (k: number): number => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
  const back = (k: number): number => {
    const c1 = 1.5;
    const c3 = c1 + 1;
    const x = Math.min(1, Math.max(0, k));
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };

  function act(a: Actor, action: StageAction, at: number): void {
    const verb = action.do;
    const target = action.to ? placeXY(a, action.to) : null;
    const travel = (to: { x: number; y: number }, speed: number, min: number, max: number, then?: () => void, arc = 0): void => {
      const d = Math.hypot(to.x - a.x, to.y - a.y);
      const dur = Math.min(max, Math.max(min, d / speed));
      if (Math.abs(to.x - a.x) > 0.05 && (a.info.folk || a.info.sky)) a.facing = to.x > a.x ? 1 : -1;
      a.move = { t0: at, dur, kind: verb, fromX: a.x, fromY: a.y, toX: to.x, toY: to.y, then, arc };
    };
    switch (verb) {
      case 'enter': {
        const to = target && !action.to?.startsWith('offstage') ? target : placeXY(a, a.member.at);
        if (!a.on || a.opacity < 0.05) {
          a.x = to.x < 0 ? PLACE_X['offstage-left'] : PLACE_X['offstage-right'];
          if (a.info.sky) a.y = to.y + 0.3;
          else a.y = to.y;
        }
        a.on = true;
        a.opacity = Math.max(a.opacity, 0.001);
        travel(to, a.info.sky ? 1.5 : 1.25, 1.4, 3.4, undefined, a.info.sky ? 0.35 : 0);
        break;
      }
      case 'exit': {
        const side = action.to === 'offstage-left' || action.to === 'offstage-right' ? action.to : a.x < 0 ? 'offstage-left' : 'offstage-right';
        travel({ x: PLACE_X[side], y: a.y }, 1.3, 1.4, 3.2, () => {
          a.on = false;
        });
        break;
      }
      case 'move':
        if (!a.on) {
          a.on = true;
          a.fx.push({ t0: at, dur: 0.8, kind: 'appear' });
        }
        if (target) travel(target, a.info.folk ? 1.1 : 1.3, 1.1, 3.2);
        break;
      case 'fly':
        if (!a.on) {
          a.on = true;
          a.x = (target?.x ?? 0) < 0 ? PLACE_X['offstage-left'] : PLACE_X['offstage-right'];
          a.y = (target?.y ?? 2.2) + 0.2;
        }
        travel(target ?? placeXY(a, a.member.at), 1.4, 1.8, 3.6, undefined, 0.45);
        break;
      case 'appear': {
        const p = target ?? placeXY(a, a.member.at);
        a.x = p.x;
        a.y = p.y;
        a.on = true;
        a.fx.push({ t0: at, dur: 0.9, kind: 'appear' });
        break;
      }
      case 'fade':
        a.fx.push({ t0: at, dur: 1.0, kind: 'fade', then: () => (a.on = false) });
        break;
      case 'rise': {
        const p = target ?? placeXY(a, a.member.at);
        if (!a.on) {
          a.x = p.x;
          a.y = p.y - 2.2;
        }
        a.on = true;
        travel(p, 0.9, 2.2, 3.5);
        break;
      }
      case 'sink':
        travel({ x: a.x, y: a.y - 2.6 }, 1.0, 1.6, 3, () => (a.on = false));
        a.fx.push({ t0: at + 0.6, dur: 1.4, kind: 'fade' });
        break;
      case 'hop':
      case 'shake':
      case 'spin':
      case 'glow':
        a.fx.push({ t0: at, dur: verb === 'hop' ? 0.9 : verb === 'shake' ? 0.7 : verb === 'spin' ? 1.3 : 1.8, kind: verb });
        if (!a.on) {
          a.on = true;
          a.fx.push({ t0: at, dur: 0.8, kind: 'appear' });
        }
        break;
      case 'sway':
        a.swayUntil = at + 6;
        break;
      case 'grow':
        a.scaleGoal = Math.min(1.6, a.scaleGoal * 1.35);
        break;
      case 'shrink':
        a.scaleGoal = Math.max(0.5, a.scaleGoal * 0.72);
        break;
      case 'turn':
        a.fx.push({ t0: at, dur: 0.5, kind: 'turn', then: () => (a.facing *= -1) });
        break;
    }
  }

  function startBeat(i: number): void {
    if (!chapter) return;
    beatIndex = i;
    beatStart = t;
    const b = chapter.beats[i];
    beatDur = beatSeconds(b.line);
    b.actions.forEach((action, k) => {
      const a = actors.find((x) => x.member.id === action.who);
      if (a) act(a, action, t + 0.25 + k * 0.75);
    });
    const ink = chapter.mood === 'night' ? palette.ink : palette.ink;
    drawCaption(capCanvas, play?.name ?? '', b.line, ink);
    capTex.needsUpdate = true;
    if (!silent) {
      try {
        play?.onBeat?.(i, b.line);
      } catch (error) {
        console.warn('[theatre] the teller could not say the line', error);
      }
    }
  }

  function finishMoves(): void {
    for (const a of actors) {
      if (a.move) {
        a.x = a.move.toX ?? a.x;
        a.y = a.move.toY ?? a.y;
        const then = a.move.then;
        a.move = null;
        then?.();
      }
      for (const f of a.fx) f.then?.();
      a.fx = [];
    }
  }

  function step(dt: number): void {
    if (!chapter) return;
    t += dt;
    // Opening, lines, close.
    if (beatIndex === -2) {
      beatIndex = -1;
      drawCaption(capCanvas, `Chapter ${chapter.n}`, chapter.title, palette.ink);
      capTex.needsUpdate = true;
    }
    if (ending < 0) {
      if (beatIndex === -1 && t >= INTRO) startBeat(0);
      else if (beatIndex >= 0 && t - beatStart >= beatDur) {
        if (beatIndex + 1 < chapter.beats.length) startBeat(beatIndex + 1);
        else {
          ending = t + 1.2;
          beatIndex = chapter.beats.length;
        }
      }
    }
    const open = ending < 0 ? ease(t / 2.2) : 1 - ease((t - ending) / OUTRO);
    backdropMat.opacity = open * 0.97;
    (halo.material as MeshBasicMaterial).opacity = open * 0.55;
    capMat.opacity = ending < 0 ? ease((t - 0.8) / 1.2) : open;
    caption.position.y = -0.62 - (1 - open) * 0.25;
    for (const c of clouds) {
      const k = ending < 0 ? ease((t - 0.2) / 2.4) : open;
      c.mesh.position.x = c.out.x + (c.home.x - c.out.x) * k;
      c.mesh.position.y = c.out.y + (c.home.y - c.out.y) * k + Math.sin(t * 0.4 + c.home.x) * 0.04;
      c.mesh.material.opacity = Math.min(1, k * 1.3) * 0.96;
    }
    // Scenery rows pop up like the pages of a pop-up book, far ones first.
    rows.forEach((r, i) => {
      const k = ending < 0 ? back((t - 0.6 - i * 0.35) / 0.9) : open;
      r.mesh.scale.y = Math.max(0.001, k);
      r.mesh.material.opacity = Math.min(1, Math.max(0, (t - 0.6 - i * 0.35) * 3)) * (ending < 0 ? 1 : open) * (r.layer === 'far' ? 0.92 : 1);
    });
    for (const a of actors) updateActor(a, dt, open);
    for (const w of weather) {
      const map = w.mesh.material.map;
      if (map) map.offset.y += dt * w.speed * 0.35;
      if (map && w.actor.member.kind === 'rain') map.offset.x += dt * 0.12;
    }
    if (ending >= 0 && t - ending >= OUTRO) finish();
  }

  function updateActor(a: Actor, dt: number, open: number): void {
    const less = opts.lessMotion?.() ?? false;
    let ox = 0;
    let oy = 0;
    let rot = 0;
    let sx = 1;
    let sy = 1;
    let glow = 0;
    let fade = 1;
    if (a.move) {
      const m = a.move;
      const k = Math.min(1, Math.max(0, (t - m.t0) / m.dur));
      if (t >= m.t0) {
        const e = less ? (k >= 1 ? 1 : 0) : ease(k);
        const px = a.x;
        a.x = m.fromX! + (m.toX! - m.fromX!) * e;
        a.y = m.fromY! + (m.toY! - m.fromY!) * e + Math.sin(Math.PI * e) * (m.arc ?? 0);
        a.walked += Math.abs(a.x - px);
        if (k >= 1) {
          a.move = null;
          m.then?.();
        }
      }
    }
    if (a.info.folk && a.move && t >= a.move.t0 && !less) {
      // The stick puppet's walk: a rocking hop with each step.
      const ph = a.walked * 7.5;
      oy += Math.abs(Math.sin(ph)) * 0.07;
      rot += Math.sin(ph) * 0.07;
    }
    if (a.info.sky && !less) {
      oy += Math.sin(t * 1.3 + a.x) * 0.05;
      rot += Math.sin(t * 0.9 + a.y) * 0.04;
      if (a.move && t >= a.move.t0) rot += -a.facing * 0.08;
    }
    if (a.member.kind === 'sea' && !less) ox += Math.sin(t * 0.8) * 0.15;
    for (const f of [...a.fx]) {
      if (t < f.t0) continue;
      const k = Math.min(1, (t - f.t0) / f.dur);
      switch (f.kind) {
        case 'appear':
          sy *= back(k);
          sx *= 0.85 + 0.15 * ease(k);
          fade *= Math.min(1, k * 2.5);
          break;
        case 'fade':
          fade *= 1 - ease(k);
          sx *= 1 - 0.1 * k;
          sy *= 1 - 0.1 * k;
          break;
        case 'hop':
          oy += Math.abs(Math.sin(k * Math.PI * 2)) * 0.18 * (1 - k * 0.3);
          sy *= 1 + Math.sin(k * Math.PI * 4) * 0.04;
          break;
        case 'shake':
          ox += Math.sin(k * 60) * 0.05 * (1 - k);
          rot += Math.sin(k * 45) * 0.05 * (1 - k);
          break;
        case 'spin':
          rot += ease(k) * Math.PI * 2;
          break;
        case 'glow':
          glow = Math.max(glow, Math.sin(k * Math.PI));
          break;
        case 'turn':
          sx *= Math.abs(Math.cos(k * Math.PI));
          break;
        default:
          break;
      }
      if (k >= 1) {
        a.fx.splice(a.fx.indexOf(f), 1);
        if (f.kind === 'turn') a.facing *= -1;
        else f.then?.();
      }
    }
    if (t < a.swayUntil && !less) rot += Math.sin(t * 2.2) * 0.1;
    if (a.member.kind === 'stars') fade *= 0.75 + Math.sin(t * 2.3) * 0.12 + Math.sin(t * 3.7) * 0.08;
    if (a.member.kind === 'wind' && !less) ox += ((t * 0.6) % 2) - 1;
    a.scale += (a.scaleGoal - a.scale) * Math.min(1, dt * 3);
    const visibleGoal = a.on ? 1 : 0;
    // Hidden cut-outs leave quickly; a cut-out told to show comes in with its own tween.
    a.opacity += (visibleGoal - a.opacity) * Math.min(1, dt * (a.on ? 6 : 3));
    const sceneryIn = a.member.hidden ? 1 : Math.min(1, Math.max(0, (t - 1.2) * 1.5));
    const o = a.opacity * fade * open * sceneryIn;
    const mesh = a.mesh;
    mesh.visible = o > 0.004;
    mesh.material.opacity = Math.min(1, o) * (a.layer === 'far' && !a.info.light ? 0.92 : 1);
    if (glow > 0) mesh.material.color.copy(a.base).lerp(GLOW, glow * 0.75);
    else if (!mesh.material.color.equals(a.base)) mesh.material.color.copy(a.base);
    const pop = a.member.hidden ? 1 : back((t - 1.0) / 0.9);
    mesh.position.set(a.x + ox, a.y + oy, LAYER_Z[a.layer] + (a.info.light ? -0.05 : 0));
    mesh.rotation.z = rot;
    mesh.scale.set(a.facing * sx * a.scale, Math.max(0.001, sy * a.scale * (a.on ? pop : 1)), 1);
  }

  function finish(): void {
    group.visible = false;
    chapter = null;
    beatIndex = -2;
    ending = -1;
    const r = resolveDone;
    resolveDone = null;
    clear();
    r?.();
  }

  const stage: Stage = {
    group,
    get playing() {
      return chapter !== null;
    },
    get beat() {
      return beatIndex;
    },
    get time() {
      return t;
    },
    timeline(ch) {
      let at = INTRO;
      const beats = ch.beats.map((b) => {
        const dur = beatSeconds(b.line);
        const out = { start: at, dur };
        at += dur;
        return out;
      });
      return { intro: INTRO, beats, total: at + 1.2 + OUTRO };
    },
    play(ch, o) {
      if (chapter) finish();
      chapter = ch;
      play = o;
      t = 0;
      beatIndex = -2;
      ending = -1;
      silent = false;
      build(ch);
      group.visible = true;
      return new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
    },
    next() {
      if (!chapter || ending >= 0) return;
      finishMoves();
      if (beatIndex < 0) {
        t = Math.max(t, INTRO);
        startBeat(0);
      } else if (beatIndex + 1 < chapter.beats.length) startBeat(beatIndex + 1);
      else {
        ending = t;
        beatIndex = chapter.beats.length;
      }
    },
    stop() {
      if (!chapter) return;
      if (ending < 0) ending = t;
      beatIndex = chapter.beats.length;
    },
    update(dt) {
      if (chapter) step(Math.min(0.1, dt));
    },
    seek(target) {
      if (!chapter || !play) return;
      const ch = chapter;
      const o = play;
      const r = resolveDone;
      resolveDone = null;
      chapter = ch;
      t = 0;
      beatIndex = -2;
      ending = -1;
      build(ch);
      resolveDone = r;
      play = o;
      silent = true;
      const dt = 1 / 30;
      while (t < target && chapter) step(dt);
      silent = false;
    },
    dispose() {
      clear();
      group.removeFromParent();
    },
  };
  return stage;
}

type KindInfoLike = (typeof KINDS)[SilhouetteKind];
const GLOW = new Color('#ffd48a');
