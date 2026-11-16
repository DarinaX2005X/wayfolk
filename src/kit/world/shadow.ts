/**
 * Shadows without a shadow map (DESIGN "Геометрия, материалы и свет"): under every
 * object a contact patch (ink 0.35 at the centre) and a long shadow away from the sun,
 * an elongated patch 2.25 × the object's height (the sun stands 24° high), ink 0.22.
 * A lifted object casts a wider, paler shadow; when it touches down the shadow tightens
 * in 120 ms. All patches of the world are two instanced meshes, drawn in world space by
 * one layer the kit adds to the scene (`installKit`).
 *
 * A patch lies in the plane of the object's parent (x–z of the parent at the object's
 * resting height), so objects on the tilted ring get patches on the tilted plots.
 */
import {
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  Object3D,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  Color,
} from '@iwsdk/core';
import { LIGHT } from '../../tokens/tokens';
import { zone } from '../../app/perf/zone';
import { animate, now, onKitQuality, whenInstalled } from './time';

export type ShadowOpts = {
  /** Height of the object, metres: the long shadow is 2.25 × this. */
  height: number;
  /** Footprint (x, z) of the contact patch; taken from the bounding box when left out. */
  size?: [number, number];
  /** Resting height of the object's origin in its parent: lifted is measured from here. */
  rest?: number;
  /** Strength 0..1 (folded instruments, paper sheets cast less). */
  strength?: number;
};

type Entry = { obj: Object3D; opts: ShadowOpts; size: [number, number]; rest: number; touchAt: number; lifted: boolean };

const MAX = 512;
const entries = new Map<Object3D, Entry>();
let longOn = true;

const vertex = /* glsl */ `
attribute float aShade;
varying vec2 vUv;
varying float vShade;
#include <common>
void main() {
  vUv = uv;
  vShade = aShade;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const fragment = (long: boolean): string => /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
varying float vShade;
void main() {
  ${
    long
      ? `// along v: from the object (0) to the tip (1); across u: soft sides
  float along = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.08, vUv.y);
  float across = 1.0 - smoothstep(0.25, 0.5, abs(vUv.x - 0.5));
  float a = along * across;`
      : `vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  float a = 1.0 - smoothstep(0.15, 1.0, d);
  a = a * a;`
  }
  gl_FragColor = vec4(uColor, a * vShade * uOpacity);
}`;

function patchMaterial(long: boolean, opacity: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color(LIGHT.contact.color) }, uOpacity: { value: opacity } },
    vertexShader: vertex,
    fragmentShader: fragment(long),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    blending: NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
}

function makeMesh(long: boolean): InstancedMesh {
  const g = new PlaneGeometry(1, 1);
  g.rotateX(-Math.PI / 2);
  if (long) g.translate(0, 0, -0.5); // starts at the object and runs along -z (local)
  g.setAttribute('aShade', new InstancedBufferAttribute(new Float32Array(MAX), 1));
  const m = new InstancedMesh(g, patchMaterial(long, long ? LIGHT.longShadow.opacity : LIGHT.contact.opacity), MAX);
  m.count = 0;
  m.frustumCulled = false;
  m.renderOrder = 1;
  m.raycast = () => {};
  m.name = long ? 'shadows:long' : 'shadows:contact';
  return m;
}

const layer = new Object3D();
layer.name = 'kit:shadows';
zone(layer, 'shadows');
const contact = makeMesh(false);
const longs = makeMesh(true);
layer.add(contact, longs);

/** The layer that draws every shadow; the kit adds it to the scene of an installed world. */
export function shadowLayer(): Object3D {
  return layer;
}
whenInstalled((world) => {
  if (!layer.parent) world.createTransformEntity(layer, { parent: world.sceneEntity, persistent: true });
});
onKitQuality((q) => {
  longOn = q !== 'low';
});

/** Direction of the long shadow in the seated frame: away from the sun (azimuth −35°). */
const SUN_AZ = (LIGHT.key.az * Math.PI) / 180;
const away = new Vector3(-Math.sin(SUN_AZ), 0, Math.cos(SUN_AZ)); // the sun is at (sin az, ·, −cos az)

const m = new Matrix4();
const pos = new Vector3();
const quat = new Quaternion();
const scl = new Vector3();
const up = new Vector3();
const dir = new Vector3();
const tmp = new Vector3();
const parentQ = new Quaternion();
const look = new Matrix4();
const base = new Vector3();
const back = new Vector3();

/** Gives `obj` a contact patch and a long shadow. Returns the undo. */
export function attachShadow(obj: Object3D, opts: ShadowOpts): () => void {
  let size = opts.size;
  if (!size) {
    let w = 0.05;
    let d = 0.05;
    obj.traverse((o) => {
      const g = (o as unknown as { geometry?: { boundingBox: { min: Vector3; max: Vector3 } | null; computeBoundingBox(): void } }).geometry;
      if (!g || o.userData.proxy || o.userData.label) return;
      if (!g.boundingBox) g.computeBoundingBox();
      if (g.boundingBox) {
        w = Math.max(w, (g.boundingBox.max.x - g.boundingBox.min.x) * o.scale.x);
        d = Math.max(d, (g.boundingBox.max.z - g.boundingBox.min.z) * o.scale.z);
      }
    });
    size = [w, d];
  }
  entries.set(obj, { obj, opts, size, rest: opts.rest ?? obj.position.y, touchAt: -Infinity, lifted: false });
  return () => {
    entries.delete(obj);
  };
}

/** Changes the height of an attached object (a growing stack). */
export function setShadowHeight(obj: Object3D, height: number): void {
  const e = entries.get(obj);
  if (e) e.opts = { ...e.opts, height };
}

function shown(o: Object3D): boolean {
  for (let n: Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return Boolean(o.parent);
}

/** Writes all patches; the kit runs it every frame after the objects moved. */
export function updateShadows(t = now()): void {
  const shade = contact.geometry.attributes.aShade as InstancedBufferAttribute;
  const shadeL = longs.geometry.attributes.aShade as InstancedBufferAttribute;
  let n = 0;
  let nl = 0;
  layer.updateMatrixWorld();
  for (const e of entries.values()) {
    if (n >= MAX) break;
    const o = e.obj;
    if (!shown(o) || !layerInScene(o)) continue;
    const parent = o.parent!;
    o.updateWorldMatrix(true, false);
    // Base point: the object's position in its parent at the resting height.
    base.set(o.position.x, e.rest, o.position.z).applyMatrix4(parent.matrixWorld);
    const lift = Math.max(0, o.position.y - e.rest) * parent.matrixWorld.getMaxScaleOnAxis();
    const lifted = lift > 0.004;
    if (e.lifted && !lifted) e.touchAt = t;
    e.lifted = lifted;
    const settle = Math.min(1, (t - e.touchAt) / LIGHT.touchMs);
    const k = Math.min(1, lift / 0.2);
    const spread = 1 + k * 1.4 + (1 - settle) * 0.15;
    const pale = (1 - k * 0.75) * (0.85 + 0.15 * settle);
    const strength = (e.opts.strength ?? 1) * pale;
    if (strength <= 0.01) continue;
    parent.getWorldQuaternion(parentQ);
    up.set(0, 1, 0).applyQuaternion(parentQ);
    const s = parent.matrixWorld.getMaxScaleOnAxis();
    // Contact patch: footprint plus a margin, in the plane of the parent.
    pos.copy(base).addScaledVector(up, 0.0015 * s);
    scl.set(e.size[0] * 1.5 * spread * s, 1, e.size[1] * 1.5 * spread * s);
    m.compose(pos, parentQ, scl);
    contact.setMatrixAt(n, m);
    shade.setX(n, strength);
    n += 1;
    if (!longOn || nl >= MAX) continue;
    // Long shadow: from the base away from the sun, projected into the parent's plane.
    dir.copy(away);
    const seatRoot = findSeat(o);
    if (seatRoot) dir.applyQuaternion(seatRoot.getWorldQuaternion(quat));
    dir.addScaledVector(up, -dir.dot(up)).normalize();
    const length = LIGHT.longShadow.length * (e.opts.height + lift) * s;
    // Local -z of the patch points along `dir`: x = up × z with z = −dir.
    tmp.crossVectors(up, dir).normalize().negate();
    back.copy(dir).negate();
    look.makeBasis(tmp, up, back);
    quat.setFromRotationMatrix(look);
    pos.copy(base).addScaledVector(up, 0.001 * s);
    scl.set(Math.max(e.size[0], e.size[1]) * spread * s, 1, length + e.size[1] * 0.3 * s);
    m.compose(pos, quat, scl);
    longs.setMatrixAt(nl, m);
    shadeL.setX(nl, strength * (1 - k * 0.5));
    nl += 1;
  }
  contact.count = n;
  longs.count = nl;
  longs.visible = longOn && nl > 0;
  contact.instanceMatrix.needsUpdate = true;
  longs.instanceMatrix.needsUpdate = true;
  shade.needsUpdate = true;
  shadeL.needsUpdate = true;
}

function layerInScene(o: Object3D): boolean {
  let a: Object3D = o;
  while (a.parent) a = a.parent;
  let b: Object3D = layer;
  while (b.parent) b = b.parent;
  return a === b;
}

/** The seated frame an object lives in (named root:seat by the core), if any. */
function findSeat(o: Object3D): Object3D | null {
  for (let n: Object3D | null = o; n; n = n.parent) if (n.name === 'root:seat' || n.userData.seatFrame) return n;
  return null;
}

animate({ root: layer, update: updateShadows }, true);
