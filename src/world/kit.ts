/**
 * The KayKit pieces (CC0), baked into public/assets/world/kit.glb with vertex colours by
 * tests/world/tools/bake-kit.py. Loading converts every piece once to the world's attribute
 * layout (non-indexed, float normal, vec4 colour with the glow mask), so kit pieces and
 * procedural pieces merge into the same batches.
 *
 * Without the kit (unit tests, or before it loads) a piece falls back to a box of its size.
 */
import { BufferAttribute, BufferGeometry, Color, type Mesh, type Object3D } from '@iwsdk/core';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { M, cbox, paint, smoothNormals, surfaceAlpha } from './geo';
import { KIT_BOUNDS } from './kit-bounds';

const geos = new Map<string, BufferGeometry>();
let loading: Promise<void> | null = null;

/** Pieces whose warm bright parts glow at night (lantern glass, flames, lamp shades). */
const GLOW_PIECES = new Set(['lantern', 'lantern-hanging', 'post-lantern', 'candle', 'lamp-standing', 'lamp-table']);

export const KIT_URL = '/assets/world/kit.glb';

export function kitLoaded(): boolean {
  return geos.size > 0;
}

export function loadKit(url = KIT_URL): Promise<void> {
  if (loading) return loading;
  loading = new Promise<void>((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => {
        gltf.scene.traverse((o: Object3D) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          const id = mesh.name || mesh.parent?.name || '';
          if (!id || geos.has(id)) return;
          geos.set(id, convert(mesh.geometry as BufferGeometry, id));
        });
        resolve();
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  return loading;
}

const MOSS = new Color('#6f9a3e');
const tmp = new Color();
const hsl = { h: 0, s: 0, l: 0 };

/** Picks a surface id for a kit vertex from what the piece is and its colour. */
function surfaceFor(id: string, r: number, g: number, b: number, ny: number): number {
  tmp.setRGB(r, g, b).getHSL(hsl);
  const { h, s, l } = hsl;
  const brown = h > 0.02 && h < 0.13 && s > 0.2;
  const green = h > 0.16 && h < 0.45 && s > 0.15;
  if (/^(tree|trees|pine)/.test(id)) return brown && l < 0.22 ? M.bark : M.leaf;
  if (id.startsWith('rock') || id === 'stones') return ny > 0.6 ? M.grass : M.rock;
  if (/^(hill|mountain|hills)/.test(id)) return green ? M.grass : s < 0.2 ? M.rock : M.dirt;
  if (id.startsWith('water')) return M.leaf;
  if (id.startsWith('bld-') || id === 'bridge') {
    if (green) return M.grass;
    if (s < 0.16) return l > 0.55 ? M.plaster : M.cobble;
    if (brown && l < 0.4) return M.plank;
    if (s > 0.35) return M.tile;
    return M.plaster;
  }
  if (id.startsWith('cloud')) return M.plain;
  if (brown && l < 0.45) return M.plank;
  if (s < 0.12 && l < 0.35) return M.metal;
  return M.plain;
}

function convert(src: BufferGeometry, id: string): BufferGeometry {
  const glowParts = GLOW_PIECES.has(id);
  const mossy = id.startsWith('rock') || id === 'stones';
  const g = src.index ? src.toNonIndexed() : src.clone();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = g.getAttribute('color');
  const n = pos.count;
  const p = new Float32Array(n * 3);
  const nn = new Float32Array(n * 3);
  const c = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    p[i * 3] = pos.getX(i);
    p[i * 3 + 1] = pos.getY(i);
    p[i * 3 + 2] = pos.getZ(i);
    const ny = nor ? nor.getY(i) : 1;
    nn[i * 3] = nor ? nor.getX(i) : 0;
    nn[i * 3 + 1] = ny;
    nn[i * 3 + 2] = nor ? nor.getZ(i) : 0;
    let r = col ? col.getX(i) : 0.8;
    let gg = col ? col.getY(i) : 0.8;
    let b = col ? col.getZ(i) : 0.8;
    if (mossy && ny > 0.45) {
      const k = Math.min(1, (ny - 0.45) / 0.35) * 0.8;
      r = r * (1 - k) + MOSS.r * k;
      gg = gg * (1 - k) + MOSS.g * k;
      b = b * (1 - k) + MOSS.b * k;
    }
    c[i * 4] = r;
    c[i * 4 + 1] = gg;
    c[i * 4 + 2] = b;
    // warm and bright in linear space: lantern glass and flames
    const glow = glowParts && r > 0.55 && gg > 0.3 && b < 0.25 && r > b * 3;
    c[i * 4 + 3] = glow ? 0 : surfaceAlpha(surfaceFor(id, r, gg, b, ny));
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(p, 3));
  out.setAttribute('normal', new BufferAttribute(nn, 3));
  out.setAttribute('color', new BufferAttribute(c, 4));
  // organic pieces read soft, not faceted
  if (/^(tree|trees|pine|rock|hill|hills|mountain|cloud|bush|water|pumpkin|sack)/.test(id)) smoothNormals(out);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * A fresh copy of a kit piece's geometry at `scale`, optionally tinted. Falls back to a
 * box of the piece's size before the kit has loaded.
 */
export function kitGeometry(id: string, scale = 1, tint?: string, tintAmount = 0): BufferGeometry {
  const g = geos.get(id);
  let out: BufferGeometry;
  if (g) out = g.clone();
  else {
    const b = KIT_BOUNDS[id] ?? [-0.25, 0, -0.25, 0.25, 0.5, 0.25];
    out = paint(cbox(b[3] - b[0], b[4] - b[1], b[5] - b[2], 0.02), '#b89a7a');
    out.translate((b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2);
  }
  if (scale !== 1) out.scale(scale, scale, scale);
  if (tint && tintAmount > 0) {
    const t = new Color(tint);
    const col = out.getAttribute('color') as BufferAttribute;
    for (let i = 0; i < col.count; i++) {
      col.setXYZ(
        i,
        col.getX(i) * (1 - tintAmount) + t.r * tintAmount * col.getX(i) * 2.2,
        col.getY(i) * (1 - tintAmount) + t.g * tintAmount * col.getY(i) * 2.2,
        col.getZ(i) * (1 - tintAmount) + t.b * tintAmount * col.getZ(i) * 2.2,
      );
    }
  }
  return out;
}
