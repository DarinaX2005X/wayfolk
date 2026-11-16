/**
 * Text on objects of the world without uikit: the envelope label, the tray counter, the
 * token's name, the plot board. `createLabel` lays a string out by the metrics of
 * Atkinson Hyperlegible Next (from public/fonts/), draws it into one shared canvas atlas
 * of 2048 × 2048 and returns a plane of the right physical size. A batch (./batch.ts)
 * draws every label under its root with one instanced mesh and the same atlas, so all
 * labels of a zone are one draw call.
 *
 * Sizes follow the text roles of DESIGN "Типографика": a role's capital height in dmm
 * grows with the distance from the eyes (`eyeDist`), large text multiplies by 1.25.
 * The gallery waits for `labelFontsReady()` before a frame is taken, so frames repeat.
 */
import {
  BufferAttribute,
  CanvasTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import { COLOR, TEXT, textSizeFor, type TextRole } from '../../tokens/tokens';
import { HIDDEN } from './materials';

export type LabelOpts = {
  role: TextRole;
  /** Width of the label in metres. */
  width: number;
  weight?: 400 | 700;
  /** Most lines; a longer text is cut at a word with an ellipsis. */
  lines?: number;
  /** Distance from the eyes the size is computed for (DESIGN "eyeDist"). Default 0.6 m. */
  eyeDist?: number;
  large?: boolean;
  color?: string;
  align?: 'left' | 'center' | 'right';
  /** Draw on both faces (labels seen from behind, such as a hanging tag). */
  doubleSided?: boolean;
};

export type LabelLayout = { lines: string[]; fontSize: number; lineHeight: number; width: number; height: number; cut: boolean };

const SIZE = 2048;
const PAD = 6;
const FAMILY = 'GW Atkinson';

// ---------------------------------------------------------------- the atlas

type Canvas2D = { getContext(kind: '2d'): CanvasRenderingContext2D | null; width: number; height: number };
let canvas: Canvas2D | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let texture: CanvasTexture | null = null;
let shared: MeshBasicMaterial | null = null;
let sharedDouble: MeshBasicMaterial | null = null;

function atlas(): { ctx: CanvasRenderingContext2D | null; texture: CanvasTexture | null } {
  if (!canvas) {
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = SIZE;
      c.height = SIZE;
      canvas = c;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(SIZE, SIZE) as unknown as Canvas2D;
    }
    ctx = canvas?.getContext('2d') ?? null;
    if (canvas && ctx) {
      texture = new CanvasTexture(canvas as unknown as HTMLCanvasElement);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.anisotropy = 4;
    }
  }
  return { ctx, texture };
}

function material(doubleSided = false): MeshBasicMaterial {
  const make = (side: boolean): MeshBasicMaterial => {
    const m = new MeshBasicMaterial({ map: atlas().texture, transparent: true, depthWrite: false, toneMapped: false, side: side ? DoubleSide : undefined });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    m.name = 'kit:label';
    return m;
  };
  if (doubleSided) return (sharedDouble ??= make(true));
  return (shared ??= make(false));
}

// Shelf packing with reuse of freed regions of the same size class.
type Region = { x: number; y: number; w: number; h: number };
let shelfY = 0;
let shelfX = 0;
let shelfH = 0;
const free: Region[] = [];

function allocate(w: number, h: number): Region | null {
  w = Math.ceil(w) + PAD * 2;
  h = Math.ceil(h) + PAD * 2;
  const reuse = free.findIndex((r) => r.w >= w && r.h >= h && r.w < w * 1.5 && r.h < h * 1.5);
  if (reuse >= 0) return free.splice(reuse, 1)[0];
  if (shelfX + w > SIZE) {
    shelfY += shelfH;
    shelfX = 0;
    shelfH = 0;
  }
  if (shelfY + h > SIZE || w > SIZE) return null;
  const r = { x: shelfX, y: shelfY, w, h };
  shelfX += w;
  shelfH = Math.max(shelfH, h);
  return r;
}

// ---------------------------------------------------------------- fonts

let fontsLoaded: Promise<void> | null = null;
let fontsReady = false;
const waiting = new Set<Mesh>();

/** Loads the two weights of Atkinson for the atlas; labels drawn before are redrawn after. */
export function labelFontsReady(): Promise<void> {
  if (fontsLoaded) return fontsLoaded;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
    fontsLoaded = Promise.resolve();
    return fontsLoaded;
  }
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const faces = ([400, 700] as const).map((w) => new FontFace(FAMILY, `url(${base}fonts/atkinson-hyperlegible-next-latin-${w}-normal.woff2)`, { weight: String(w) }));
  fontsLoaded = Promise.all(
    faces.map((f) =>
      f.load().then(
        (face) => document.fonts.add(face),
        (error: unknown) => console.warn('[kit] label font did not load', error),
      ),
    ),
  )
    .then(() => document.fonts.ready)
    .then(() => {
      fontsReady = true;
      for (const mesh of waiting) draw(mesh);
      waiting.clear();
    });
  return fontsLoaded;
}

// ---------------------------------------------------------------- layout

/** Physical font size (em, metres) and line height of a label. */
export function labelMetrics(opts: LabelOpts): { fontSize: number; lineHeight: number } {
  const fontSize = textSizeFor(opts.role, opts.eyeDist ?? 0.6, opts.large);
  return { fontSize, lineHeight: fontSize * TEXT.lineHeight };
}

function measure(text: string, fontSize: number, weight: number): number {
  const { ctx: c } = atlas();
  if (!c) return text.length * fontSize * TEXT.charWidth;
  const px = 64;
  c.font = `${weight} ${px}px '${FAMILY}', 'Atkinson Hyperlegible Next', sans-serif`;
  return (c.measureText(text).width / px) * fontSize;
}

/** Width in metres of one line of `text` set in a role at a distance. */
export function measureLabel(text: string, opts: Pick<LabelOpts, 'role' | 'eyeDist' | 'large' | 'weight'>): number {
  const { fontSize } = labelMetrics({ ...opts, width: 1 });
  return measure(text, fontSize, opts.weight ?? 400);
}

/** Wraps `text` into lines of `width` at most `lines` lines; cuts at a word with "…". */
export function layoutLabel(text: string, opts: LabelOpts): LabelLayout {
  const { fontSize, lineHeight } = labelMetrics(opts);
  const weight = opts.weight ?? 400;
  const max = opts.lines ?? 2;
  const out: string[] = [];
  let cut = false;
  const paragraphs = text.split('\n');
  for (let p = 0; p < paragraphs.length; p++) {
    const words = paragraphs[p].split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (!line || measure(next, fontSize, weight) <= opts.width) line = next;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  if (out.length > max) {
    cut = true;
    out.length = max;
  }
  if (cut || out.some((l) => measure(l, fontSize, weight) > opts.width)) {
    // The last kept line ends with an ellipsis and drops words until it fits.
    const last = out.length - 1;
    let words = out[last].split(' ');
    let candidate = cut ? `${words.join(' ')}…` : out[last];
    while (measure(candidate, fontSize, weight) > opts.width && words.length > 1) {
      words = words.slice(0, -1);
      candidate = `${words.join(' ')}…`;
    }
    if (candidate !== out[last]) cut = true;
    out[last] = candidate;
  }
  const height = Math.max(1, out.length) * lineHeight;
  return { lines: out, fontSize, lineHeight, width: opts.width, height, cut };
}

// ---------------------------------------------------------------- drawing

type LabelData = { text: string; opts: LabelOpts; layout: LabelLayout; region: Region | null; pxPerM: number };

function draw(mesh: Mesh): void {
  const data = mesh.userData.labelData as LabelData;
  const { ctx: c, texture: tex } = atlas();
  if (!c || !tex || !data.region) return;
  const r = data.region;
  c.clearRect(r.x, r.y, r.w, r.h);
  const k = data.pxPerM;
  const weight = data.opts.weight ?? 400;
  c.font = `${weight} ${data.layout.fontSize * k}px '${FAMILY}', 'Atkinson Hyperlegible Next', sans-serif`;
  c.fillStyle = data.opts.color ?? COLOR.ink;
  c.textBaseline = 'alphabetic';
  c.textAlign = data.opts.align ?? 'left';
  const x0 = r.x + PAD + (c.textAlign === 'center' ? (data.layout.width * k) / 2 : c.textAlign === 'right' ? data.layout.width * k : 0);
  data.layout.lines.forEach((line, i) => {
    // Baseline: half the line spacing above, then the capital height (0.7 em) of the font.
    const top = r.y + PAD + i * data.layout.lineHeight * k;
    const baseline = top + ((data.layout.lineHeight - data.layout.fontSize) / 2 + data.layout.fontSize * 0.86) * k;
    c.fillText(line, x0, baseline);
  });
  tex.needsUpdate = true;
  if (!fontsReady && typeof document !== 'undefined') waiting.add(mesh);
}

function place(mesh: Mesh, data: LabelData): void {
  const w = data.layout.width;
  const h = data.layout.height;
  // About 44 px per em in the atlas, fewer when the label would not fit in a row.
  let k = 44 / data.layout.fontSize;
  if (w * k > SIZE - 2 * PAD) k = (SIZE - 2 * PAD) / w;
  data.pxPerM = k;
  const old = data.region;
  const need = { w: Math.ceil(w * k) + PAD * 2, h: Math.ceil(h * k) + PAD * 2 };
  if (!old || old.w < need.w || old.h < need.h) {
    if (old) free.push(old);
    data.region = allocate(w * k, h * k);
    if (!data.region && atlas().ctx) console.warn('[kit] label atlas is full', data.text);
  }
  const r = data.region;
  const geometry = mesh.geometry as PlaneGeometry;
  const uv = geometry.attributes.uv as BufferAttribute;
  if (r) {
    const u0 = (r.x + PAD) / SIZE;
    const u1 = (r.x + PAD + w * k) / SIZE;
    const v1 = 1 - (r.y + PAD) / SIZE;
    const v0 = 1 - (r.y + PAD + h * k) / SIZE;
    // PlaneGeometry uv order: (0,1) (1,1) (0,0) (1,0)
    uv.setXY(0, u0, v1);
    uv.setXY(1, u1, v1);
    uv.setXY(2, u0, v0);
    uv.setXY(3, u1, v0);
    uv.needsUpdate = true;
    mesh.userData.labelRect = [u0, v0, u1, v1];
  } else mesh.userData.labelRect = [0, 0, 0, 0];
  mesh.userData.labelSize = [w, h];
  draw(mesh);
}

/**
 * A label: a plane in x–y facing +z, its centre at the origin, `opts.width` wide and as
 * tall as its lines. Text of the role at `eyeDist`.
 */
export function createLabel(text: string, opts: LabelOpts): Mesh {
  void labelFontsReady();
  const layout = layoutLabel(text, opts);
  const geometry = new PlaneGeometry(1, 1);
  const mesh = new Mesh(geometry, material(opts.doubleSided));
  mesh.name = `label:${text.slice(0, 24)}`;
  mesh.scale.set(layout.width, layout.height, 1);
  mesh.renderOrder = 2;
  mesh.userData.label = true;
  mesh.userData.labelMat = mesh.material;
  const data: LabelData = { text, opts, layout, region: null, pxPerM: 0 };
  mesh.userData.labelData = data;
  place(mesh, data);
  return mesh;
}

/** Changes the text of a label; the plane keeps its width and takes the new height. */
export function setLabelText(mesh: Mesh, text: string): void {
  const data = mesh.userData.labelData as LabelData | undefined;
  if (!data || data.text === text) return;
  data.text = text;
  data.layout = layoutLabel(text, data.opts);
  mesh.scale.set(data.layout.width, data.layout.height, 1);
  place(mesh, data);
}

export function labelText(mesh: Object3D): string {
  return (mesh.userData.labelData as LabelData | undefined)?.text ?? '';
}
export function labelLayout(mesh: Object3D): LabelLayout | null {
  return (mesh.userData.labelData as LabelData | undefined)?.layout ?? null;
}

// ---------------------------------------------------------------- instanced labels of a batch

export type LabelInstances = {
  track(mesh: Mesh, frame: number): void;
  finish(frame: number, inv: Matrix4): void;
  setOpacity(k: number): void;
  calls(): number;
  dispose(): void;
};

const m4 = new Matrix4();
const scaleM = new Matrix4();

/** One instanced mesh drawing every label under `root` from the shared atlas. */
export function createLabelInstances(root: Object3D): LabelInstances {
  let capacity = 32;
  const unit = new PlaneGeometry(1, 1);
  const mat = material().clone();
  mat.name = 'batch:labels';
  mat.side = DoubleSide;
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRect;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = mix(aRect.xy, aRect.zw, uv);\n#endif');
  };
  let mesh = make();
  const tracked = new Map<Mesh, { seen: number; index: number }>();
  const order: Mesh[] = [];

  function make(): InstancedMesh {
    const m = new InstancedMesh(unit, mat, capacity);
    m.name = 'batch:labels';
    m.userData.batchOwn = true;
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.raycast = () => {};
    m.geometry = unit.clone();
    m.geometry.setAttribute('aRect', new InstancedBufferAttribute(new Float32Array(capacity * 4), 4));
    m.count = 0;
    root.add(m);
    return m;
  }

  const restore = (label: Mesh): void => {
    label.material = label.userData.labelMat as MeshBasicMaterial;
    delete label.userData.batched;
  };

  return {
    track(label, frame) {
      let t = tracked.get(label);
      if (!t) {
        t = { seen: frame, index: -1 };
        tracked.set(label, t);
        label.material = HIDDEN;
        label.userData.batched = true;
      }
      t.seen = frame;
    },
    finish(frame, inv) {
      for (const [label, t] of tracked) {
        if (t.seen !== frame) {
          tracked.delete(label);
          restore(label);
        }
      }
      order.length = 0;
      for (const label of tracked.keys()) order.push(label);
      if (order.length > capacity) {
        capacity = Math.max(order.length, capacity * 2);
        mesh.removeFromParent();
        mesh.dispose();
        mesh = make();
      }
      const rect = mesh.geometry.attributes.aRect as InstancedBufferAttribute;
      let n = 0;
      for (const label of order) {
        let shown = true;
        for (let o: Object3D | null = label; o && o !== root; o = o.parent) if (!o.visible) shown = false;
        if (!shown) continue;
        const [w, h] = label.userData.labelSize as [number, number];
        const r = label.userData.labelRect as [number, number, number, number];
        m4.multiplyMatrices(inv, label.matrixWorld);
        // The label's own scale is its size already; the unit plane takes it from the matrix.
        void w;
        void h;
        mesh.setMatrixAt(n, m4);
        rect.setXYZW(n, r[0], r[1], r[2], r[3]);
        n += 1;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      rect.needsUpdate = true;
    },
    setOpacity(k) {
      mat.opacity = k;
      mesh.visible = k > 0.001;
    },
    calls() {
      return mesh.visible && mesh.count > 0 ? 1 : 0;
    },
    dispose() {
      for (const label of tracked.keys()) restore(label);
      tracked.clear();
      mesh.removeFromParent();
      mesh.dispose();
    },
  };
}

void scaleM;
void Vector3;
