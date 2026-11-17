/**
 * Painted words on the house signs. All signs share one canvas atlas and one mesh, so twelve
 * houses cost one draw call. Without a DOM (unit tests) signs are simply left blank.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  SRGBColorSpace,
} from '@iwsdk/core';

const COLS = 4;
const ROWS = 8;
const SLOT_W = 256;
const SLOT_H = 80;

export interface Signs {
  mesh: Mesh | null;
  /** Paints a sign; `matrix` places a w × h plane (facing +z, centred) in root space. */
  set(id: string, text: string, matrix: Matrix4, w: number, h: number): void;
  remove(id: string): void;
}

export function createSigns(parent: Object3D): Signs {
  const hasDom = typeof document !== 'undefined' && typeof document.createElement === 'function';
  if (!hasDom) return { mesh: null, set() {}, remove() {} };
  const canvas = document.createElement('canvas');
  canvas.width = COLS * SLOT_W;
  canvas.height = ROWS * SLOT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { mesh: null, set() {}, remove() {} };
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new MeshLambertMaterial({ map: tex, transparent: true, alphaTest: 0.3, depthWrite: true });
  mat.name = 'world:signs';
  const mesh = new Mesh(new BufferGeometry(), mat);
  mesh.name = 'world:signs';
  mesh.matrixAutoUpdate = false;
  mesh.raycast = () => {};
  parent.add(mesh);
  const slots = new Map<string, { slot: number; quad: Float32Array; uv: Float32Array }>();
  const free: number[] = Array.from({ length: COLS * ROWS }, (_, i) => i);

  const draw = (slot: number, text: string): void => {
    const x = (slot % COLS) * SLOT_W;
    const y = Math.floor(slot / COLS) * SLOT_H;
    ctx.clearRect(x, y, SLOT_W, SLOT_H);
    let size = 46;
    ctx.font = `700 ${size}px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", "Trebuchet MS", sans-serif`;
    while (ctx.measureText(text).width > SLOT_W - 24 && size > 18) {
      size -= 2;
      ctx.font = `700 ${size}px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", "Trebuchet MS", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#4a2f1d';
    ctx.fillText(text, x + SLOT_W / 2, y + SLOT_H / 2 + 2);
    tex.needsUpdate = true;
  };

  const rebuild = (): void => {
    const n = slots.size;
    const pos = new Float32Array(n * 18);
    const uv = new Float32Array(n * 12);
    let i = 0;
    for (const s of slots.values()) {
      pos.set(s.quad, i * 18);
      uv.set(s.uv, i * 12);
      i++;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    mesh.geometry.dispose();
    mesh.geometry = g;
  };

  return {
    mesh,
    set(id, text, matrix, w, h) {
      let entry = slots.get(id);
      const slot = entry?.slot ?? free.shift();
      if (slot === undefined) return;
      draw(slot, text);
      const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
      const quad = new Float32Array(18);
      const v = new Float32Array(3);
      corners.forEach(([cx, cy], k) => {
        const e = matrix.elements;
        v[0] = e[0] * cx + e[4] * cy + e[12];
        v[1] = e[1] * cx + e[5] * cy + e[13];
        v[2] = e[2] * cx + e[6] * cy + e[14];
        quad.set(v, k * 3);
      });
      const u0 = (slot % COLS) / COLS;
      const u1 = u0 + 1 / COLS;
      const v1 = 1 - Math.floor(slot / COLS) / ROWS;
      const v0 = v1 - 1 / ROWS;
      const uv = new Float32Array([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1]);
      entry = { slot, quad, uv };
      slots.set(id, entry);
      rebuild();
    },
    remove(id) {
      const e = slots.get(id);
      if (!e) return;
      slots.delete(id);
      free.push(e.slot);
      rebuild();
    },
  };
}
