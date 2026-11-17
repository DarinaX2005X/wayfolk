/**
 * A visiting friend as a small soft creature of the island: a round felt head with dark
 * eyes, rosy cheeks and a smile that turns to an open mouth when their voice plays, a
 * little bell-shaped body that hangs below and turns after the head, two floating mitten
 * hands built from their wrist and fingertips, and a paper name tag in their colour that
 * shows sound bars while they record a voice note for you.
 *
 * The head follows the interpolated pose exactly; body and hands follow with a little
 * softness. A visitor whose frames stop shrinks away and pops back when they return.
 *
 * Cost per avatar: 7 draw calls (head, eyes, smile or mouth, body, hand balls, fingers,
 * tag), about 5k triangles.
 */
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Camera,
} from '@iwsdk/core';
import { emptyPose, type HandOut, type PoseOut } from './interp';

export const HEAD_R = 0.12;
const BODY_DROP = 0.128;
const TAG_LIFT = 0.215;
const INK = '#3a2e29';
const PAPER = '#fbf4e6';
const CREAM = '#fff3e2';

// Knuckles in the wrist frame of a left hand (WebXR: -Z toward the fingers, +Y out of the
// back of the hand). A right hand mirrors X.
const KNUCKLES: [number, number, number][] = [
  [0.03, -0.016, -0.035],
  [0.024, -0.007, -0.094],
  [0.002, -0.003, -0.096],
  [-0.017, -0.007, -0.089],
  [-0.035, -0.012, -0.078],
];
// Mitten-soft fingers: thicker than real ones, so a hand reads at a few metres.
const FINGER_R = [0.0165, 0.0152, 0.0156, 0.0148, 0.0134];
const PALM_CENTER: [number, number, number] = [0, -0.006, -0.054];
const PALM_HALF: [number, number, number] = [0.05, 0.026, 0.054];
/** Spheres per hand: palm, 5 knuckles, 5 tips. */
const SPH = 11;

let shared: {
  head: BufferGeometry;
  body: BufferGeometry;
  eyes: BufferGeometry;
  smile: BufferGeometry;
  mouth: BufferGeometry;
  sphere: SphereGeometry;
  cylinder: CylinderGeometry;
  tag: PlaneGeometry;
  ink: MeshBasicMaterial;
  face: MeshBasicMaterial;
  shadow: ShaderMaterial;
  disc: PlaneGeometry;
} | null = null;

function resources() {
  if (shared) return shared;
  const sphere = new SphereGeometry(1, 14, 10);
  const cylinder = new CylinderGeometry(1, 1, 1, 12, 1, true);
  // Instance colours multiply vertex colours: the hand geometries carry white ones.
  for (const g of [sphere, cylinder]) {
    const n = g.getAttribute('position').count;
    g.setAttribute('color', new Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  }
  shared = {
    head: new SphereGeometry(HEAD_R, 32, 22),
    body: bodyGeometry(),
    eyes: eyesGeometry(),
    smile: smileGeometry(),
    mouth: mouthGeometry(),
    sphere,
    cylinder,
    tag: new PlaneGeometry(1, 0.25),
    ink: new MeshBasicMaterial({ color: new Color(INK) }),
    face: new MeshBasicMaterial({ vertexColors: true }),
    // A soft round blob shadow, darker in the middle; opacity per avatar.
    shadow: new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uOpacity: { value: 0.3 }, uColor: { value: new Color('#2b2a35') } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv; void main(){ float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(uColor, a * a * uOpacity); }',
    }),
    disc: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  };
  return shared;
}

/** A point on the head surface: yaw and pitch in degrees, 0/0 is straight ahead (-Z). */
function onHead(yaw: number, pitch: number, lift = 0): Vector3 {
  const y = (yaw * Math.PI) / 180;
  const p = (pitch * Math.PI) / 180;
  const d = new Vector3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  return d.multiplyScalar(HEAD_R + lift);
}

/** Orientation of a feature lying on the head: +Z out of the surface, +Y up the face. */
function surfaceQuat(at: Vector3): Quaternion {
  const z = at.clone().normalize();
  const x = new Vector3(0, 1, 0).cross(z);
  if (x.lengthSq() < 1e-8) x.set(1, 0, 0);
  x.normalize();
  const y = new Vector3().crossVectors(z, x).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** A feature lying on the head, with a flat vertex colour. */
function placed(geo: BufferGeometry, at: Vector3, scale: Vector3, color: string): BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(new Matrix4().compose(at, surfaceQuat(at), scale));
  const c = new Color(color);
  const n = g.getAttribute('position').count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const out = new BufferGeometry();
  for (const name of ['position', 'normal', 'color'] as const) {
    const arrays = parts.map((p) => p.getAttribute(name).array as Float32Array);
    const merged = new Float32Array(arrays.reduce((s, a) => s + a.length, 0));
    let o = 0;
    for (const a of arrays) {
      merged.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new Float32BufferAttribute(merged, 3));
  }
  for (const p of parts) p.dispose();
  return out;
}

const EYE_PITCH = 4;
const EYE_Y = Math.sin((EYE_PITCH * Math.PI) / 180) * HEAD_R;

function eyesGeometry(): BufferGeometry {
  const dot = new SphereGeometry(1, 16, 12);
  const parts: BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    parts.push(placed(dot, onHead(21 * side, EYE_PITCH, -0.002), new Vector3(0.0165, 0.0235, 0.009), INK));
    // The catchlight sits up and toward the light on both eyes.
    parts.push(placed(dot, onHead(21 * side - 3.4, EYE_PITCH + 3.6, 0.0045), new Vector3(0.0058, 0.0064, 0.003), '#fffaf0'));
  }
  const g = merge(parts);
  // Pivot on the eye line, so scaling Y blinks both eyes in place.
  g.translate(0, -EYE_Y, 0);
  dot.dispose();
  return g;
}

const MOUTH_PITCH = -15;

function smileGeometry(): BufferGeometry {
  // The lower half of a ring: a small curve that opens upward.
  const arc = new TorusGeometry(0.0145, 0.0034, 6, 18, Math.PI);
  arc.rotateZ(Math.PI);
  arc.translate(0, 0.006, 0);
  const at = onHead(0, MOUTH_PITCH, 0.0005);
  arc.applyMatrix4(new Matrix4().compose(at, surfaceQuat(at), new Vector3(1, 1, 1)));
  return arc;
}

function mouthGeometry(): BufferGeometry {
  // A unit ball flattened onto the head; the avatar scales it with the voice. Its origin is
  // the mouth point, so scaling opens it in place.
  const g = new SphereGeometry(1, 16, 10);
  const at = onHead(0, MOUTH_PITCH - 1.5, -0.004);
  g.applyMatrix4(new Matrix4().compose(new Vector3(), surfaceQuat(at), new Vector3(1, 1, 0.5)));
  return g;
}

export const MOUTH_AT = onHead(0, MOUTH_PITCH - 1.5, -0.004);

function bodyGeometry(): BufferGeometry {
  // A soft bell: narrow neck, round shoulders, a full skirt and a rounded hem.
  const profile: [number, number][] = [
    [0.0, 0.0],
    [0.034, -0.004],
    [0.054, -0.02],
    [0.068, -0.045],
    [0.08, -0.08],
    [0.091, -0.118],
    [0.098, -0.15],
    [0.096, -0.17],
    [0.082, -0.186],
    [0.05, -0.196],
    [0.0, -0.2],
  ];
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 28);
}

/** Vertex colours of felt: the base colour, a little darker toward the bottom, rosy cheeks. */
function shade(geo: BufferGeometry, base: Color, blush?: Color): BufferGeometry {
  const g = geo.clone();
  const pos = g.getAttribute('position');
  const colors = new Float32Array(pos.count * 3);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    min = Math.min(min, pos.getY(i));
    max = Math.max(max, pos.getY(i));
  }
  const cheeks = [onHead(-36, -9).normalize(), onHead(36, -9).normalize()];
  const v = new Vector3();
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const h = (v.y - min) / Math.max(1e-6, max - min);
    c.copy(base).multiplyScalar(0.82 + 0.18 * Math.pow(h, 0.7));
    if (blush) {
      v.normalize();
      let w = 0;
      for (const ch of cheeks) w = Math.max(w, Math.pow(Math.max(0, v.dot(ch)), 70));
      c.lerp(blush, Math.min(0.6, w * 0.75));
    }
    colors.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return g;
}

/**
 * Lambert felt with a warm rim and a little light of its own, so a visitor reads as a
 * cheerful shape against any sky without looking lit from inside.
 */
function feltMaterial(base: Color, rim: Color, strength: number, glow: number): MeshLambertMaterial {
  const m = new MeshLambertMaterial({ vertexColors: true, emissive: base.clone().multiplyScalar(glow) });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = { value: rim.clone().multiplyScalar(strength) };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
      .replace(
        '#include <opaque_fragment>',
        'float rimF = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);\noutgoingLight += uRim * pow(rimF, 2.2);\n#include <opaque_fragment>',
      );
  };
  m.customProgramCacheKey = () => 'wayfolk-felt';
  return m;
}

function headColor(base: Color): Color {
  return base.clone().lerp(new Color(CREAM), 0.1);
}

function handColor(base: Color): Color {
  return base.clone().lerp(new Color(CREAM), 0.32);
}

/** The head with a little tuft on top, as one geometry with vertex colours. */
function headGeometry(base: Color): BufferGeometry {
  const r = resources();
  const ball = shade(r.head, headColor(base), new Color('#f08a7e'));
  const head = ball.index ? ball.toNonIndexed() : ball;
  if (head !== ball) ball.dispose();
  head.deleteAttribute('uv');
  const puff = new SphereGeometry(1, 10, 8);
  const tuft = base.clone().multiplyScalar(0.8).getHexString();
  const parts = [head];
  for (const [yaw, pitch, sx, sy, tilt] of [[0, 84, 0.022, 0.04, 0.2], [-14, 80, 0.016, 0.03, -0.5], [14, 81, 0.017, 0.032, 0.7]] as const) {
    const at = onHead(yaw, pitch, 0.012);
    const g = placed(puff, at, new Vector3(sx, sx, sy), `#${tuft}`);
    // Lean each strand a little, like a soft cowlick.
    g.applyMatrix4(new Matrix4().makeTranslation(-at.x, -at.y, -at.z));
    g.applyMatrix4(new Matrix4().makeRotationZ(tilt * 0.35));
    g.applyMatrix4(new Matrix4().makeTranslation(at.x, at.y, at.z));
    parts.push(g);
  }
  puff.dispose();
  return merge(parts);
}

/** The paper name tag; redrawn when the talking state changes. */
class Tag {
  readonly tex: CanvasTexture | null;
  private readonly canvas: HTMLCanvasElement | null;
  private talking = false;

  constructor(private name: string, private color: string) {
    if (typeof document === 'undefined') {
      this.canvas = null;
      this.tex = null;
      return;
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 128;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.draw();
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.load('700 54px "Atkinson Hyperlegible Next"').then(() => this.draw(), () => {});
  }

  set(name: string, color: string, talking: boolean): void {
    if (name === this.name && color === this.color && talking === this.talking) return;
    this.name = name;
    this.color = color;
    this.talking = talking;
    this.draw();
  }

  private draw(): void {
    const ctx = this.canvas?.getContext('2d');
    if (!ctx || !this.tex) return;
    ctx.clearRect(0, 0, 512, 128);
    let size = 54;
    const font = (s: number) => `700 ${s}px "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif`;
    ctx.font = font(size);
    const lead = this.talking ? 82 : 64;
    const maxText = 512 - 2 * 16 - lead - 36;
    while (ctx.measureText(this.name).width > maxText && size > 30) ctx.font = font((size -= 2));
    const textW = Math.min(maxText, ctx.measureText(this.name).width);
    const h = 92;
    const w = Math.round(textW + lead + 38);
    const x0 = Math.round((512 - w) / 2);
    const y0 = 16;
    ctx.fillStyle = 'rgba(58, 46, 41, 0.2)';
    roundRect(ctx, x0, y0 + 6, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    roundRect(ctx, x0, y0, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = this.color;
    const cy = y0 + h / 2;
    if (this.talking) {
      // Sound bars: they are recording a voice note.
      const bars = [16, 34, 24, 12];
      bars.forEach((bh, i) => {
        roundRect(ctx, x0 + 26 + i * 12, cy - bh / 2, 7, bh, 3.5);
        ctx.fill();
      });
    } else {
      ctx.beginPath();
      ctx.arc(x0 + 46, cy, 15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(this.name, x0 + lead + 10, cy + 2, maxText);
    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.tex?.dispose();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const tmpV = new Vector3();
const tmpV2 = new Vector3();
const tmpQ = new Quaternion();
const tmpM = new Matrix4();
const tmpS = new Vector3();
const UP = new Vector3(0, 1, 0);
const camPos = new Vector3();
const IDENTITY_Q = new Quaternion();
const handQ = new Quaternion();
const fingerQ = new Quaternion();
const knuckleV = new Vector3();
const tipV = new Vector3();
const fwd = new Vector3();
const ZERO = new Matrix4().makeScale(0, 0, 0);

/** Exponential follow factor for a time constant in seconds. */
const follow = (dt: number, tau: number) => 1 - Math.exp(-dt / tau);

export interface AvatarOptions {
  name: string;
  color: string;
  /** Peer id, for finding the avatar from the scene. */
  id?: string;
}

export class Avatar {
  readonly root = new Group();
  readonly head = new Group();
  /** The pose to show; PoseTrack.sample() writes it before update(). */
  readonly pose: PoseOut = emptyPose();
  /** 0..1 loudness of the voice note playing from this avatar. */
  level = 0;
  name: string;
  color: string;
  /** Ground height under a point of the island, for a blob shadow; null: no shadow. */
  ground: ((x: number, z: number) => number | null) | null = null;

  private readonly body: Mesh;
  private readonly bodyPivot = new Group();
  private readonly eyes: Mesh;
  private readonly smile: Mesh;
  private readonly mouth: Mesh;
  private readonly tagMesh: Mesh;
  private readonly tag: Tag;
  private readonly spheres: InstancedMesh;
  private readonly cylinders: InstancedMesh;
  private readonly felt: MeshLambertMaterial;
  private readonly hands: MeshLambertMaterial;
  private readonly tagMat: MeshBasicMaterial;
  private shadow: Mesh | null = null;
  private readonly headGeo: BufferGeometry;
  private readonly bodyGeo: BufferGeometry;
  private readonly shown = { pos: new Vector3(), quat: new Quaternion(), bodyYaw: 0, bodyPos: new Vector3() };
  private readonly handPts = [new Float32Array(3 + 4 + 15), new Float32Array(3 + 4 + 15)];
  private readonly handWeight = [0, 0];
  private readonly handSeen = [false, false];
  private presence = 0;
  private visibleTarget = false;
  private first = true;
  private mouthOpen = 0;
  private blinkAt = 1.5 + Math.random() * 3;
  private blink = 0;
  private t = Math.random() * 10;

  constructor(opts: AvatarOptions) {
    const r = resources();
    this.name = opts.name;
    this.color = opts.color;
    const base = new Color(opts.color);
    this.felt = feltMaterial(base, new Color('#ffd6a0'), 0.42, 0.22);
    this.hands = feltMaterial(handColor(base), new Color('#ffe2b8'), 0.3, 0.18);
    this.headGeo = headGeometry(base);
    this.bodyGeo = shade(r.body, base.clone().multiplyScalar(0.92));

    this.root.name = `live-avatar${opts.id ? `:${opts.id}` : ''}`;
    this.root.userData.avatar = this;
    this.root.visible = false;
    this.root.add(this.head, this.bodyPivot);

    const headMesh = new Mesh(this.headGeo, this.felt);
    headMesh.scale.set(1, 0.95, 1);
    this.eyes = new Mesh(r.eyes, r.face);
    this.eyes.position.y = EYE_Y * 0.95;
    this.smile = new Mesh(r.smile, r.ink);
    this.smile.scale.set(1, 0.95, 1);
    this.mouth = new Mesh(r.mouth, r.ink);
    this.mouth.position.copy(MOUTH_AT).multiply(new Vector3(1, 0.95, 1));
    this.mouth.visible = false;
    this.head.add(headMesh, this.eyes, this.smile, this.mouth);

    this.body = new Mesh(this.bodyGeo, this.felt);
    this.bodyPivot.add(this.body);

    const tint = handColor(base);
    this.spheres = new InstancedMesh(r.sphere, this.hands, SPH * 2);
    this.cylinders = new InstancedMesh(r.cylinder, this.hands, 10);
    for (const m of [this.spheres, this.cylinders]) {
      m.frustumCulled = false;
      for (let i = 0; i < m.count; i++) {
        m.setColorAt(i, tint);
        m.setMatrixAt(i, ZERO);
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.root.add(m);
    }

    this.tag = new Tag(opts.name, opts.color);
    this.tagMat = new MeshBasicMaterial({ map: this.tag.tex, transparent: true, depthWrite: false, color: this.tag.tex ? 0xffffff : new Color(PAPER) });
    this.tagMesh = new Mesh(r.tag, this.tagMat);
    this.tagMesh.scale.setScalar(0.27);
    this.tagMesh.renderOrder = 2;
    this.root.add(this.tagMesh);
  }

  /** New name or colour (a peer changed their profile). */
  restyle(name: string, color: string): void {
    if (name === this.name && color === this.color) return;
    this.name = name;
    this.color = color;
    this.tag.set(name, color, this.pose.talking);
    const base = new Color(color);
    const r = resources();
    const head = headGeometry(base);
    const body = shade(r.body, base.clone().multiplyScalar(0.92));
    this.headGeo.setAttribute('color', head.getAttribute('color'));
    this.bodyGeo.setAttribute('color', body.getAttribute('color'));
    head.dispose();
    body.dispose();
    this.felt.emissive.copy(base).multiplyScalar(0.22);
    const tint = handColor(base);
    this.hands.emissive.copy(tint).multiplyScalar(0.18);
    for (const m of [this.spheres, this.cylinders]) {
      for (let i = 0; i < m.count; i++) m.setColorAt(i, tint);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Whether fresh frames keep coming; a stale avatar shrinks away. */
  setActive(active: boolean): void {
    this.visibleTarget = active;
  }

  /** World position of the mouth, for voice playback. */
  mouthWorld(out: Vector3): Vector3 {
    return this.head.localToWorld(out.copy(MOUTH_AT));
  }

  update(dt: number, camera?: Camera): void {
    this.t += dt;
    const pose = this.pose;
    // Appear and leave with a soft pop.
    const goal = this.visibleTarget ? 1 : 0;
    this.presence += (goal - this.presence) * follow(dt, goal ? 0.12 : 0.09);
    if (!this.visibleTarget && this.presence < 0.02) {
      this.presence = 0;
      this.root.visible = false;
      this.first = true;
      this.handSeen[0] = this.handSeen[1] = false;
      return;
    }
    this.root.visible = true;
    const pop = easeOutBack(Math.min(1, this.presence));

    const s = this.shown;
    tmpV.fromArray(pose.pos);
    tmpQ.fromArray(pose.quat);
    if (this.first) {
      s.pos.copy(tmpV);
      s.quat.copy(tmpQ);
      s.bodyPos.copy(tmpV).y -= BODY_DROP;
      s.bodyYaw = yawOf(tmpQ);
      this.first = false;
    }
    s.pos.lerp(tmpV, follow(dt, 0.035));
    s.quat.slerp(tmpQ, follow(dt, 0.035));
    this.head.position.copy(s.pos);
    this.head.quaternion.copy(s.quat);
    this.head.scale.setScalar(pop);

    // Body: hangs under the head, turns after it, and its hem trails when the head moves.
    tmpV2.copy(s.pos);
    tmpV2.y -= BODY_DROP;
    s.bodyPos.lerp(tmpV2, follow(dt, 0.1));
    s.bodyYaw += wrapAngle(yawOf(s.quat) - s.bodyYaw) * follow(dt, 0.28);
    this.bodyPivot.position.copy(s.bodyPos);
    const lx = s.pos.x - s.bodyPos.x;
    const lz = s.pos.z - s.bodyPos.z;
    const cy = Math.cos(-s.bodyYaw);
    const sy = Math.sin(-s.bodyYaw);
    const localX = lx * cy + lz * sy;
    const localZ = -lx * sy + lz * cy;
    const clampLean = (v: number) => Math.max(-0.3, Math.min(0.3, v));
    this.bodyPivot.rotation.set(clampLean(localZ * 2.5), s.bodyYaw, clampLean(-localX * 2.5), 'YXZ');
    const breathe = 1 + Math.sin(this.t * 1.6) * 0.012;
    this.bodyPivot.scale.set(pop, pop * breathe, pop);
    this.updateShadow(pop);

    // Face: blinks, and a mouth that opens with the voice.
    this.blinkAt -= dt;
    if (this.blinkAt <= 0) {
      this.blink = 1;
      this.blinkAt = 2.2 + Math.random() * 3.8;
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    const lid = this.blink > 0 ? Math.abs(Math.cos(this.blink * Math.PI)) : 1;
    this.eyes.scale.set(1, 0.12 + 0.83 * lid, 1);
    this.mouthOpen += (Math.min(1, this.level * 1.6) - this.mouthOpen) * follow(dt, 0.05);
    const open = this.mouthOpen > 0.06;
    this.mouth.visible = open;
    this.smile.visible = !open;
    if (open) this.mouth.scale.set(0.012 + 0.006 * this.mouthOpen, 0.005 + 0.016 * this.mouthOpen, 0.008);

    // Hands.
    for (let h = 0; h < 2; h++) this.updateHand(h, h === 0 ? pose.left : pose.right, dt, pop);
    this.spheres.instanceMatrix.needsUpdate = true;
    this.cylinders.instanceMatrix.needsUpdate = true;

    // Name tag above the head, facing the viewer; sound bars and a soft pulse while they
    // record a voice note.
    this.tag.set(this.name, this.color, pose.talking);
    const pulse = pose.talking ? 1 + 0.045 * Math.sin(this.t * 9) : 1;
    this.tagMesh.position.set(s.pos.x, s.pos.y + TAG_LIFT * Math.max(0.6, pop), s.pos.z);
    this.tagMesh.scale.setScalar(0.27 * pop * pulse);
    if (camera) {
      camera.getWorldPosition(camPos);
      this.tagMesh.lookAt(camPos);
    }
  }

  private updateShadow(pop: number): void {
    const gy = this.ground?.(this.shown.bodyPos.x, this.shown.bodyPos.z) ?? null;
    if (gy === null) {
      if (this.shadow) this.shadow.visible = false;
      return;
    }
    if (!this.shadow) {
      const r = resources();
      const mat = r.shadow.clone();
      this.shadow = new Mesh(r.disc, mat);
      this.shadow.renderOrder = 1;
      this.root.add(this.shadow);
    }
    const lift = Math.max(0, this.shown.bodyPos.y - 0.2 - gy);
    this.shadow.visible = true;
    this.shadow.position.set(this.shown.bodyPos.x, gy + 0.012, this.shown.bodyPos.z);
    this.shadow.scale.setScalar((0.3 + lift * 0.25) * pop);
    (this.shadow.material as ShaderMaterial).uniforms.uOpacity.value = (0.42 / (1 + lift * 2.5)) * pop;
  }

  private updateHand(h: number, hand: HandOut, dt: number, pop: number): void {
    const pts = this.handPts[h];
    const goal = hand.present ? 1 : 0;
    this.handWeight[h] += (goal - this.handWeight[h]) * follow(dt, goal ? 0.08 : 0.15);
    const w = this.handWeight[h] * pop;
    const base = h * SPH;
    const cylBase = h * 5;
    if (w < 0.01 && !hand.present) {
      this.handSeen[h] = false;
      for (let i = 0; i < SPH; i++) this.spheres.setMatrixAt(base + i, ZERO);
      for (let i = 0; i < 5; i++) this.cylinders.setMatrixAt(cylBase + i, ZERO);
      return;
    }
    // Follow the target softly; snap on the first frame of a hand.
    const k = this.handSeen[h] ? follow(dt, 0.03) : 1;
    if (hand.present) this.handSeen[h] = true;
    for (let i = 0; i < 3; i++) pts[i] += (hand.wrist[i] - pts[i]) * k;
    tmpQ.set(pts[3], pts[4], pts[5], pts[6]);
    handQ.set(hand.quat[0], hand.quat[1], hand.quat[2], hand.quat[3]);
    if (k === 1) tmpQ.copy(handQ);
    else tmpQ.slerp(handQ, k);
    pts[3] = tmpQ.x;
    pts[4] = tmpQ.y;
    pts[5] = tmpQ.z;
    pts[6] = tmpQ.w;
    for (let i = 0; i < 15; i++) pts[7 + i] += (hand.tips[i] - pts[7 + i]) * k;

    const wrist = tmpV.set(pts[0], pts[1], pts[2]);
    const mirror = h === 0 ? 1 : -1;
    const q = tmpQ;
    if (hand.controller) {
      // A closed mitten around the controller grip.
      tmpS.set(0.046, 0.054, 0.06).multiplyScalar(w);
      this.spheres.setMatrixAt(base, tmpM.compose(tmpV2.set(0, 0, -0.02).applyQuaternion(q).add(wrist), q, tmpS));
      for (let i = 1; i < SPH; i++) this.spheres.setMatrixAt(base + i, ZERO);
      for (let i = 0; i < 5; i++) this.cylinders.setMatrixAt(cylBase + i, ZERO);
      return;
    }
    // Palm: a soft flattened ball between the wrist and the knuckles.
    const palm = tmpV2.set(PALM_CENTER[0] * mirror, PALM_CENTER[1], PALM_CENTER[2]).applyQuaternion(q).add(wrist);
    tmpS.set(PALM_HALF[0], PALM_HALF[1], PALM_HALF[2]).multiplyScalar(w);
    this.spheres.setMatrixAt(base, tmpM.compose(palm, q, tmpS));
    for (let f = 0; f < 5; f++) {
      const kn = KNUCKLES[f];
      knuckleV.set(kn[0] * mirror, kn[1], kn[2]).applyQuaternion(q).add(wrist);
      tipV.set(pts[7 + f * 3], pts[8 + f * 3], pts[9 + f * 3]);
      const r = FINGER_R[f] * w;
      this.spheres.setMatrixAt(base + 1 + f, tmpM.compose(knuckleV, IDENTITY_Q, tmpS.setScalar(r)));
      this.spheres.setMatrixAt(base + 6 + f, tmpM.compose(tipV, IDENTITY_Q, tmpS.setScalar(r * 1.04)));
      const len = knuckleV.distanceTo(tipV);
      const mid = tmpV2.copy(knuckleV).add(tipV).multiplyScalar(0.5);
      const dir = tipV.sub(knuckleV);
      if (len > 1e-4) dir.divideScalar(len);
      else dir.copy(UP);
      fingerQ.setFromUnitVectors(UP, dir);
      this.cylinders.setMatrixAt(cylBase + f, tmpM.compose(mid, fingerQ, tmpS.set(r, len, r)));
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.felt.dispose();
    this.hands.dispose();
    this.tag.dispose();
    this.tagMat.dispose();
    (this.shadow?.material as ShaderMaterial | undefined)?.dispose();
    this.headGeo.dispose();
    this.bodyGeo.dispose();
    this.spheres.dispose();
    this.cylinders.dispose();
  }
}

function yawOf(q: Quaternion): number {
  // Heading of the forward vector (-Z) projected on the ground.
  const f = fwd.set(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-f.x, -f.z);
}

function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function easeOutBack(x: number): number {
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
