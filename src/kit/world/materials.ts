/**
 * Materials of the world kit: MeshStandardMaterial without metal and without emissive
 * (DESIGN "Геометрия, материалы и свет"), one shared instance per kit colour. Every
 * part geometry carries a vertex colour attribute (white unless baked), so a part can
 * also be drawn by a batch of its class with an instance colour (./batch.ts).
 *
 * Classes share roughness and therefore one batch: ceramic 0.45 (bone and painted
 * parts), slate 0.6, matte 0.9 (tiles, paper, cut and keel), lens 0.2.
 */
import { Color, Mesh, MeshStandardMaterial, type BufferGeometry, type Material } from '@iwsdk/core';
import { COLOR, MATERIAL } from '../../tokens/tokens';

export type MatClass = 'ceramic' | 'slate' | 'matte' | 'lens';
export const CLASS_ROUGHNESS: Record<MatClass, number> = {
  ceramic: MATERIAL.bone.roughness,
  slate: MATERIAL.slate.roughness,
  matte: MATERIAL.tile.roughness,
  lens: 0.2,
};

const DEF = {
  bone: [COLOR.bone, 'ceramic'],
  boneShade: [COLOR.boneShade, 'ceramic'],
  edge: [COLOR.edge, 'ceramic'],
  cobalt: [COLOR.cobalt, 'ceramic'],
  vermilion: [COLOR.vermilion, 'ceramic'],
  moss: [COLOR.moss, 'ceramic'],
  amber: [COLOR.amber, 'ceramic'],
  steel: [COLOR.category.steel, 'ceramic'],
  outline: [COLOR.outline, 'ceramic'],
  ink: [COLOR.ink, 'ceramic'],
  inkSoft: [COLOR.inkSoft, 'ceramic'],
  highlight: [COLOR.highlight, 'matte'],
  slate: [COLOR.slate, 'slate'],
  slateEdge: [COLOR.slateEdge, 'slate'],
  paper: [COLOR.paper, 'matte'],
  paperShade: [COLOR.edge, 'matte'],
  thread: [COLOR.vermilion, 'matte'],
  threadGray: [COLOR.outline, 'matte'],
  cut: [COLOR.ground.cut, 'matte'],
  keel: [COLOR.ground.keel, 'matte'],
  ochre: [COLOR.category.ochre, 'matte'],
  sage: [COLOR.category.sage, 'matte'],
  steelMatte: [COLOR.category.steel, 'matte'],
  lens: [COLOR.ink, 'lens'],
  /** Baked vertex colours, white instance colour. */
  vcCeramic: ['#FFFFFF', 'ceramic'],
  vcSlate: ['#FFFFFF', 'slate'],
  vcMatte: ['#FFFFFF', 'matte'],
} as const satisfies Record<string, readonly [string, MatClass]>;

export type KitMat = keyof typeof DEF;

const cache = new Map<KitMat, MeshStandardMaterial>();

/** The shared material of a kit colour. */
export function mat(key: KitMat): MeshStandardMaterial {
  let m = cache.get(key);
  if (!m) {
    const [hex, cls] = DEF[key];
    m = new MeshStandardMaterial({ color: hex, roughness: CLASS_ROUGHNESS[cls], metalness: 0, vertexColors: true });
    m.name = `kit:${key}`;
    m.userData.kitMat = key;
    cache.set(key, m);
  }
  return m;
}

export function matClass(key: KitMat): MatClass {
  return DEF[key][1];
}

const colors = new Map<KitMat, Color>();
/** Linear colour of a kit material (what a batch writes as the instance colour). */
export function matColor(key: KitMat): Color {
  let c = colors.get(key);
  if (!c) {
    c = new Color(DEF[key][0]);
    colors.set(key, c);
  }
  return c;
}

/** A material nothing draws: what a batched part wears (./batch.ts), and every proxy. */
export const HIDDEN: Material = (() => {
  const m = new MeshStandardMaterial({ visible: false });
  m.name = 'kit:hidden';
  return m;
})();

/** A mesh of the kit: geometry with a kit colour that a batch may take over. */
export function part(geometry: BufferGeometry, key: KitMat, name?: string): Mesh {
  const mesh = new Mesh(geometry, mat(key));
  mesh.userData.kitMat = key;
  if (name) mesh.name = name;
  return mesh;
}

/** Changes the colour of a part, batched or not. */
export function setMat(mesh: Mesh, key: KitMat): void {
  if (mesh.userData.kitMat === key) return;
  mesh.userData.kitMat = key;
  if (!mesh.userData.batched) mesh.material = mat(key);
}

/** An invisible volume for rays, gaze, dwell and the mouse (PLAN "Захват и выбор на одном предмете"). */
export function proxyMesh(geometry: BufferGeometry, name: string): Mesh {
  const mesh = new Mesh(geometry, HIDDEN);
  mesh.name = name;
  mesh.userData.proxy = true;
  return mesh;
}
