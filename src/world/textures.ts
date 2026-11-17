/**
 * Stylized surface textures, painted in code at start-up (no downloads, no licences): grass
 * clumps, dirt with pebbles, cobbles, rock, planks, bark, leaf clusters, roof tiles, plaster,
 * thatch, sand and brick. One grey layer each in a texture array; the main material reads
 * the layer for a surface id and tints the vertex colour with it (triplanar, world space),
 * so colour stays in the palette and the texture only adds the hand-made grain.
 */
import { DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, RepeatWrapping, UnsignedByteType } from '@iwsdk/core';
import { rng } from './geo';

export const SURF_SIZE = 256;

/** Texture layer, world tile size in metres and contrast for each surface id (0..15). */
export const SURF_LAYER = [0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 8, 8, 0];
export const SURF_SCALE = [1, 1.3, 1.0, 1.1, 2.2, 1.0, 0.7, 0.75, 0.9, 1.4, 0.7, 1.2, 0.8, 1.0, 1.0, 1];
export const SURF_AMP = [0, 0.32, 0.3, 0.5, 0.42, 0.42, 0.45, 0.42, 0.5, 0.16, 0.42, 0.22, 0.5, 0.12, 0.1, 0];

type Field = Float32Array;
const N = SURF_SIZE;

function valueNoise(period: number, seed: number): (x: number, y: number) => number {
  const r = rng(seed);
  const g = new Float32Array(period * period).map(() => r());
  const s = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = (x / N) * period;
    const fy = (y / N) * period;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = s(fx - x0);
    const ty = s(fy - y0);
    const at = (i: number, j: number): number => g[(((j % period) + period) % period) * period + (((i % period) + period) % period)];
    const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
}

function fbm(seed: number, base = 4, oct = 4, stretchX = 1, stretchY = 1): (x: number, y: number) => number {
  const layers = Array.from({ length: oct }, (_, i) => valueNoise(base << i, seed + i * 13));
  return (x, y) => {
    let v = 0;
    let a = 0.5;
    let t = 0;
    for (const l of layers) {
      v += l(x * stretchX, y * stretchY) * a;
      t += a;
      a *= 0.5;
    }
    return v / t;
  };
}

/** Tileable Voronoi: distance to nearest and second nearest cell point, and cell id. */
function voronoi(cells: number, seed: number, jitter = 0.8): (x: number, y: number) => [number, number, number] {
  const r = rng(seed);
  const pts: [number, number, number][] = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) pts.push([(i + 0.5 + (r() - 0.5) * jitter) / cells, (j + 0.5 + (r() - 0.5) * jitter) / cells, r()]);
  return (x, y) => {
    const u = x / N;
    const v = y / N;
    const ci = Math.floor(u * cells);
    const cj = Math.floor(v * cells);
    let d1 = 9;
    let d2 = 9;
    let id = 0;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        const ii = ci + di;
        const jj = cj + dj;
        const p = pts[(((jj % cells) + cells) % cells) * cells + (((ii % cells) + cells) % cells)];
        const px = p[0] + Math.floor(ii / cells);
        const py = p[1] + Math.floor(jj / cells);
        const d = Math.hypot(u - px, v - py) * cells;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = p[2];
        } else if (d < d2) d2 = d;
      }
    return [d1, d2, id];
  };
}

const sm = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function paintField(fn: (x: number, y: number) => number): Field {
  const f = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) f[y * N + x] = fn(x, y);
  return f;
}

function stamp(f: Field, cx: number, cy: number, rad: number, fn: (d: number, dx: number, dy: number) => number | null): void {
  const r = Math.ceil(rad);
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      const d = Math.hypot(dx, dy) / rad;
      if (d > 1) continue;
      const x = (((Math.round(cx) + dx) % N) + N) % N;
      const y = (((Math.round(cy) + dy) % N) + N) % N;
      const v = fn(d, dx / rad, dy / rad);
      if (v !== null) f[y * N + x] = v;
    }
}

function grass(): Field {
  const n = fbm(1, 4, 4);
  const f = paintField((x, y) => 0.35 + n(x, y) * 0.3);
  const r = rng(11);
  for (let i = 0; i < 2600; i++) {
    const x = r() * N;
    const y = r() * N;
    const len = 4 + r() * 7;
    const a = -Math.PI / 2 + (r() - 0.5) * 1.2;
    const v = r() < 0.5 ? 0.25 + r() * 0.15 : 0.7 + r() * 0.25;
    for (let k = 0; k < len; k++) {
      const px = (((Math.round(x + Math.cos(a) * k) % N) + N) % N);
      const py = (((Math.round(y + Math.sin(a) * k) % N) + N) % N);
      f[py * N + px] = f[py * N + px] * 0.4 + v * 0.6;
    }
  }
  return f;
}

function dirt(): Field {
  const n = fbm(2, 4, 4);
  const f = paintField((x, y) => 0.38 + n(x, y) * 0.28);
  const r = rng(12);
  for (let i = 0; i < 160; i++) {
    const rad = 2 + r() * 4;
    const b = 0.6 + r() * 0.3;
    stamp(f, r() * N, r() * N, rad, (d, _dx, dy) => (d > 0.8 ? 0.2 : b - dy * 0.12));
  }
  return f;
}

function cobble(): Field {
  const v = voronoi(6, 3, 0.7);
  const n = fbm(3, 8, 3);
  return paintField((x, y) => {
    const [d1, d2, id] = v(x, y);
    const edge = sm(0.0, 0.16, d2 - d1);
    const dome = 1 - d1 * 0.5;
    return (0.35 + id * 0.3 + n(x, y) * 0.15) * edge * (0.75 + dome * 0.35) + (1 - edge) * 0.12;
  });
}

function rock(): Field {
  const n = fbm(4, 3, 5);
  const v = voronoi(5, 4, 0.9);
  return paintField((x, y) => {
    const [d1, d2] = v(x, y);
    const crack = sm(0.0, 0.05, d2 - d1);
    const strata = Math.sin((y / N) * Math.PI * 2 * 4 + n(x, y) * 6) * 0.08;
    return (0.3 + n(x, y) * 0.5 + strata) * (0.55 + crack * 0.45);
  });
}

function planks(): Field {
  const rows = 4;
  const r = rng(5);
  const shade = Array.from({ length: rows }, () => 0.45 + r() * 0.25);
  const joint = Array.from({ length: rows }, () => r());
  const grain = fbm(5, 2, 4, 0.25, 3);
  return paintField((x, y) => {
    const v = (y / N) * rows;
    const row = Math.floor(v);
    const fy = v - row;
    const u = x / N;
    const seam = sm(0, 0.07, fy) * sm(1, 0.93, fy);
    const j = Math.abs(((u - joint[row] + 1) % 1) - 0.5) < 0.006 ? 0.3 : 1;
    const g = grain(x, y * 1.0);
    const knot = 0;
    return (shade[row] + (g - 0.5) * 0.45 + knot) * (0.35 + 0.65 * seam) * j;
  });
}

function bark(): Field {
  const n = fbm(6, 4, 4, 3.0, 0.25);
  const v = voronoi(8, 6, 0.9);
  return paintField((x, y) => {
    const [d1, d2] = v(x, y * 0.25 + 0.0);
    const crack = sm(0.0, 0.08, d2 - d1);
    return (0.3 + n(x, y) * 0.55) * (0.5 + crack * 0.5);
  });
}

function leaves(): Field {
  const f = paintField(() => 0.32);
  const r = rng(7);
  for (let i = 0; i < 520; i++) {
    const rad = 6 + r() * 10;
    const b = 0.4 + r() * 0.45;
    stamp(f, r() * N, r() * N, rad, (d, dx, dy) => {
      const lit = Math.max(0, -dx * 0.5 - dy * 0.7);
      return Math.min(1, b * (1 - d * 0.45) + lit * 0.25);
    });
  }
  return f;
}

function tiles(): Field {
  const rows = 6;
  const cols = 5;
  const r = rng(8);
  const shade = Array.from({ length: rows * cols }, () => 0.5 + r() * 0.25);
  return paintField((x, y) => {
    const v = (y / N) * rows;
    const row = Math.floor(v);
    const fy = v - row;
    const u = (x / N) * cols + (row % 2) * 0.5;
    const col = Math.floor(u);
    const fx = u - col;
    // scallop: rounded bottom edge of each tile
    const arc = 1 - Math.pow(Math.abs(fx - 0.5) * 2, 2) * 0.35;
    const inTile = fy < arc ? 1 : 0;
    const edge = sm(0, 0.08, Math.min(fx, 1 - fx)) * sm(0, 0.08, arc - fy);
    const s = shade[(row * cols + (((col % cols) + cols) % cols)) % shade.length];
    const g = s * (1.05 - fy * 0.45);
    return inTile ? g * (0.45 + 0.55 * edge) : 0.2;
  });
}

function plaster(): Field {
  const n = fbm(9, 3, 5);
  return paintField((x, y) => 0.42 + n(x, y) * 0.22);
}

function thatch(): Field {
  const n = fbm(10, 4, 4, 6, 0.4);
  const rows = 5;
  return paintField((x, y) => {
    const fy = ((y / N) * rows) % 1;
    const band = sm(0, 0.12, fy) * 0.4 + 0.6;
    return (0.3 + n(x, y) * 0.6) * band;
  });
}

function sand(): Field {
  const n = fbm(11, 8, 3);
  const r = rng(13);
  return paintField((x, y) => {
    const ripple = Math.sin((x / N) * Math.PI * 2 * 3 + (y / N) * Math.PI * 2 + n(x, y) * 5) * 0.08;
    return 0.45 + n(x, y) * 0.15 + ripple + (r() - 0.5) * 0.08;
  });
}

function brick(): Field {
  const rows = 8;
  const cols = 4;
  const r = rng(14);
  const shade = Array.from({ length: rows * cols }, () => 0.45 + r() * 0.3);
  const n = fbm(14, 8, 2);
  return paintField((x, y) => {
    const v = (y / N) * rows;
    const row = Math.floor(v);
    const fy = v - row;
    const u = (x / N) * cols + (row % 2) * 0.5;
    const col = Math.floor(u);
    const fx = u - col;
    const mortar = sm(0, 0.06, fy) * sm(1, 0.94, fy) * sm(0, 0.04, fx) * sm(1, 0.96, fx);
    return (shade[(row * cols + (((col % cols) + cols) % cols)) % shade.length] + n(x, y) * 0.1) * (0.3 + 0.7 * mortar);
  });
}

let cached: DataArrayTexture | null = null;

/** The texture array with every surface layer (built once, about 20 ms). */
export function surfaceTextures(): DataArrayTexture {
  if (cached) return cached;
  const fields = [grass(), dirt(), cobble(), rock(), planks(), bark(), leaves(), tiles(), plaster(), thatch(), sand(), brick()];
  const data = new Uint8Array(N * N * fields.length);
  fields.forEach((f, l) => {
    // normalise each layer to mean 0.5 so tinting keeps the palette brightness
    let mean = 0;
    for (let i = 0; i < f.length; i++) mean += f[i];
    mean /= f.length;
    for (let i = 0; i < f.length; i++) data[l * N * N + i] = Math.max(0, Math.min(255, Math.round((f[i] - mean + 0.5) * 255)));
  });
  const tex = new DataArrayTexture(data, N, N, fields.length);
  tex.format = RedFormat;
  tex.type = UnsignedByteType;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  cached = tex;
  return tex;
}
