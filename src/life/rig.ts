// Characters built in code: parts hang on bones and are merged into one rigidly skinned
// mesh, so a whole bird or resident is one draw call with one shared material, and
// every part (head, beak, wing, ear, arm) still moves on its own.
import {
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Sphere,
  Vector3,
  type ColorRepresentation,
} from '@iwsdk/core';

export interface PartOptions {
  pos?: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number] | number;
  /** 0..1: how much the part glows (eye shine, lantern paper). */
  glow?: number;
  /** Strength of the darker-below gradient, 0..1 (default 0.22). */
  shade?: number;
  /** Optional second colour, mixed in toward the top of the part. */
  top?: ColorRepresentation;
  /** 0..1: fur or feather grain in the surface (default 1; 0 for eyes, beaks, hats). */
  fur?: number;
  /** 0..1: glossy, like eyes and noses (default 0). */
  gloss?: number;
}

interface Part {
  bone: number;
  geo: BufferGeometry;
  color: Color;
  top: Color | null;
  glow: number;
  shade: number;
  fur: number;
  gloss: number;
  local: Matrix4;
}

export interface RigMesh {
  mesh: SkinnedMesh;
  bones: Record<string, Bone>;
  /** Rest transforms of every bone, so animation can start from them each frame. */
  rest: Record<string, { pos: Vector3; quat: Quaternion; scale: Vector3 }>;
  triangles: number;
}

const tmpM = new Matrix4();
const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpV = new Vector3();
const tmpS = new Vector3();
const tmpC = new Color();

export class Rig {
  readonly bones: Bone[] = [];
  private byName = new Map<string, number>();
  private parts: Part[] = [];

  bone(name: string, parent: string | null, x = 0, y = 0, z = 0): Bone {
    const b = new Bone();
    b.name = name;
    b.position.set(x, y, z);
    if (parent !== null) {
      const p = this.byName.get(parent);
      if (p === undefined) throw new Error(`rig: no bone ${parent}`);
      this.bones[p].add(b);
    }
    this.byName.set(name, this.bones.length);
    this.bones.push(b);
    return b;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Add a geometry (in the bone's local space) with one colour. The geometry is consumed. */
  part(bone: string, geo: BufferGeometry, color: ColorRepresentation, o: PartOptions = {}): this {
    const idx = this.byName.get(bone);
    if (idx === undefined) throw new Error(`rig: no bone ${bone}`);
    const s = o.scale ?? 1;
    tmpS.set(...(typeof s === 'number' ? ([s, s, s] as [number, number, number]) : s));
    tmpQ.setFromEuler(tmpE.set(...(o.rot ?? [0, 0, 0])));
    tmpV.set(...(o.pos ?? [0, 0, 0]));
    this.parts.push({
      bone: idx,
      geo,
      color: new Color(color),
      top: o.top !== undefined ? new Color(o.top) : null,
      glow: o.glow ?? 0,
      shade: o.shade ?? 0.22,
      fur: o.fur ?? (o.glow ? 0 : 1),
      gloss: o.gloss ?? 0,
      local: new Matrix4().compose(tmpV, tmpQ, tmpS),
    });
    return this;
  }

  /** Mirror helper: the same part on the left (+x) and right (-x) bones. */
  pair(boneL: string, boneR: string, make: () => BufferGeometry, color: ColorRepresentation, o: PartOptions = {}): this {
    this.part(boneL, make(), color, o);
    const pos = o.pos ? ([-o.pos[0], o.pos[1], o.pos[2]] as [number, number, number]) : undefined;
    const rot = o.rot ? ([o.rot[0], -o.rot[1], -o.rot[2]] as [number, number, number]) : undefined;
    this.part(boneR, make(), color, { ...o, pos, rot });
    return this;
  }

  build(material: MeshStandardMaterial): RigMesh {
    const root = this.bones[0];
    root.updateMatrixWorld(true);
    let vCount = 0;
    let iCount = 0;
    const prepared: { g: BufferGeometry; p: Part }[] = [];
    for (const p of this.parts) {
      const g = p.geo;
      g.deleteAttribute('uv');
      g.deleteAttribute('uv1');
      g.deleteAttribute('tangent');
      if (!g.getAttribute('normal')) g.computeVertexNormals();
      tmpM.multiplyMatrices(this.bones[p.bone].matrixWorld, p.local);
      g.applyMatrix4(tmpM);
      prepared.push({ g, p });
      vCount += g.getAttribute('position').count;
      iCount += g.index ? g.index.count : g.getAttribute('position').count;
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const glow = new Float32Array(vCount);
    const surf = new Float32Array(vCount * 2);
    const skI = new Uint16Array(vCount * 4);
    const skW = new Float32Array(vCount * 4);
    const index = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    let vo = 0;
    let io = 0;
    for (const { g, p } of prepared) {
      const P = g.getAttribute('position');
      const N = g.getAttribute('normal');
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const h = Math.max(1e-6, bb.max.y - bb.min.y);
      for (let i = 0; i < P.count; i++) {
        const y = P.getY(i);
        const t = (y - bb.min.y) / h;
        pos[(vo + i) * 3] = P.getX(i);
        pos[(vo + i) * 3 + 1] = y;
        pos[(vo + i) * 3 + 2] = P.getZ(i);
        nor[(vo + i) * 3] = N.getX(i);
        nor[(vo + i) * 3 + 1] = N.getY(i);
        nor[(vo + i) * 3 + 2] = N.getZ(i);
        tmpC.copy(p.color);
        if (p.top) tmpC.lerp(p.top, Math.min(1, Math.max(0, (t - 0.35) / 0.65)));
        const k = 1 - p.shade * (1 - t) * (1 - t);
        col[(vo + i) * 3] = tmpC.r * k;
        col[(vo + i) * 3 + 1] = tmpC.g * k;
        col[(vo + i) * 3 + 2] = tmpC.b * k;
        glow[vo + i] = p.glow;
        surf[(vo + i) * 2] = p.fur;
        surf[(vo + i) * 2 + 1] = p.gloss;
        skI[(vo + i) * 4] = p.bone;
        skW[(vo + i) * 4] = 1;
      }
      if (g.index) {
        const I = g.index;
        for (let i = 0; i < I.count; i++) index[io + i] = I.getX(i) + vo;
        io += I.count;
      } else {
        for (let i = 0; i < P.count; i++) index[io + i] = vo + i;
        io += P.count;
      }
      vo += P.count;
      g.dispose();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(nor, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setAttribute('glow', new BufferAttribute(glow, 1));
    geo.setAttribute('surf', new BufferAttribute(surf, 2));
    geo.setAttribute('skinIndex', new BufferAttribute(skI, 4));
    geo.setAttribute('skinWeight', new BufferAttribute(skW, 4));
    geo.setIndex(new BufferAttribute(index, 1));
    geo.computeBoundingSphere();

    const mesh = new SkinnedMesh(geo, material);
    mesh.add(root);
    mesh.updateMatrixWorld(true);
    const skeleton = new Skeleton(this.bones);
    mesh.bind(skeleton, mesh.matrixWorld);
    const bs = geo.boundingSphere!;
    mesh.boundingSphere = new Sphere(bs.center.clone(), bs.radius * 1.6);
    mesh.frustumCulled = true;

    const bones: Record<string, Bone> = {};
    const rest: RigMesh['rest'] = {};
    for (const b of this.bones) {
      bones[b.name] = b;
      rest[b.name] = { pos: b.position.clone(), quat: b.quaternion.clone(), scale: b.scale.clone() };
    }
    return { mesh, bones, rest, triangles: iCount / 3 };
  }
}

/** Put every bone back to its rest transform (start of each animated frame). */
export function resetPose(r: RigMesh): void {
  for (const name in r.rest) {
    const b = r.bones[name];
    const s = r.rest[name];
    b.position.copy(s.pos);
    b.quaternion.copy(s.quat);
    b.scale.copy(s.scale);
  }
}

const eul = new Euler();
const q2 = new Quaternion();
/** Rotate a bone by Euler angles on top of its current rotation. */
export function turn(b: Bone | undefined, x: number, y: number, z: number, order: 'XYZ' | 'YXZ' | 'ZXY' = 'XYZ'): void {
  if (!b) return;
  if (x === 0 && y === 0 && z === 0) return;
  q2.setFromEuler(eul.set(x, y, z, order));
  b.quaternion.multiply(q2);
}

// Rim light colour is shared by every life material, so the time of day can tint it.
const rimUniform = { value: new Color(0.6, 0.45, 0.33) };
const fillUniform = { value: new Color(0.1, 0.075, 0.06) };

export function setRim(color: ColorRepresentation, fill: ColorRepresentation): void {
  rimUniform.value.set(color);
  fillUniform.value.set(fill);
}

let shared: MeshStandardMaterial | null = null;

/**
 * Soft painted-clay material: vertex colours, a warm rim toward the light behind the
 * character, a small fill so shadow sides never go black, and a glow channel for eye
 * shine and lantern paper. Multiview safe (only view-space varyings are used).
 */
export function lifeMaterial(): MeshStandardMaterial {
  if (shared) return shared;
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0 });
  m.name = 'life-clay';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = rimUniform;
    shader.uniforms.uFill = fillUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>
attribute float glow;
attribute vec2 surf;
varying float vGlow;
varying vec2 vSurf;
varying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>
vGlow = glow;
vSurf = surf;
vLocal = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying float vGlow;',
          'varying vec2 vSurf;',
          'varying vec3 vLocal;',
          'uniform vec3 uRim;',
          'uniform vec3 uFill;',
          'float lifeHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
          'float lifeNoise(vec3 x) {',
          '  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);',
          '  return mix(mix(mix(lifeHash(i), lifeHash(i + vec3(1,0,0)), f.x), mix(lifeHash(i + vec3(0,1,0)), lifeHash(i + vec3(1,1,0)), f.x), f.y),',
          '             mix(mix(lifeHash(i + vec3(0,0,1)), lifeHash(i + vec3(1,0,1)), f.x), mix(lifeHash(i + vec3(0,1,1)), lifeHash(i + vec3(1,1,1)), f.x), f.y), f.z);',
          '}',
        ].join('
'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          // Soft mottling plus fine strands along the body: fur or feathers, never flat paint.
          'float lifeBlot = lifeNoise(vLocal * 38.0);',
          'float lifeStrand = lifeNoise(vec3(vLocal.x * 260.0, vLocal.y * 55.0, vLocal.z * 260.0));',
          'diffuseColor.rgb *= 1.0 + vSurf.x * ((lifeBlot - 0.5) * 0.1 + (lifeStrand - 0.5) * 0.1);',
        ].join('
'),
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.18, vSurf.y);')
      .replace(
        '#include <opaque_fragment>',
        [
          'float lifeFace = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);',
          'float lifeRim = pow(1.0 - lifeFace, 3.0);',
          // Fuzz: a broad soft sheen at grazing angles, stronger on fur.
          'float lifeFuzz = pow(1.0 - lifeFace, 1.6) * 0.18 * vSurf.x;',
          'outgoingLight += uRim * (lifeRim + lifeFuzz) * (0.2 + 0.8 * diffuseColor.rgb);',
          'outgoingLight += uFill * diffuseColor.rgb;',
          'outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.25, vGlow);',
          '#include <opaque_fragment>',
        ].join('
'),
      );
  };
  m.customProgramCacheKey = () => 'life-clay-2';
  shared = m;
  return m;
}
