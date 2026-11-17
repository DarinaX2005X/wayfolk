/**
 * Preview of live visits outside the app.
 *
 *   ?mode=gallery[&shot=close]       three visitors on a sunset stand-in for the island
 *   ?mode=tab&role=host               hosts a room and shows who comes
 *   ?mode=tab&role=guest&code=XXXXXX  joins it, with a moving head and waving fake hands
 *   &relay=<url>                      another relay (default: the deployed one)
 */
import {
  BackSide,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Fog,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from '@iwsdk/core';
import { Avatar } from '../../../src/live/avatar';
import { emptyPose, type HandOut } from '../../../src/live/interp';
import { createLive, type Live } from '../../../src/live/index';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'gallery';
const status = document.getElementById('status')!;

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new Scene();
const camera = new PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 200);
scene.add(camera);
const island = new Group();
island.name = 'island';
scene.add(island);
stage(scene, island);

// ---------------------------------------------------------------------------------------
// A stand-in for the island at sunset, only to judge the avatars in their light.

function stage(scene: Scene, island: Group): void {
  scene.fog = new Fog(new Color('#f2c7a0'), 18, 70);
  const sky = new Mesh(
    new SphereGeometry(90, 32, 16),
    new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      uniforms: { top: { value: new Color('#3d6f86') }, mid: { value: new Color('#e9b48c') }, low: { value: new Color('#f7d6a6') }, sun: { value: new Vector3(-0.55, 0.12, -0.83).normalize() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 low; uniform vec3 sun; varying vec3 vDir;
        void main(){ float h = vDir.y; vec3 c = mix(mid, top, smoothstep(0.05, 0.6, h)); c = mix(low, c, smoothstep(-0.15, 0.08, h));
        float s = max(dot(normalize(vDir), sun), 0.0); c += vec3(1.0,0.75,0.45) * pow(s, 24.0) * 0.6 + vec3(1.0,0.85,0.6) * pow(s, 400.0);
        gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  scene.add(sky);
  scene.add(new HemisphereLight(new Color('#ffe7cc'), new Color('#5d7046'), 1.5));
  const sun = new DirectionalLight(new Color('#ffcf98'), 2.2);
  sun.position.set(-5, 3.2, -6);
  scene.add(sun);
  const fill = new DirectionalLight(new Color('#bcd7ff'), 0.45);
  fill.position.set(4, 2, 5);
  scene.add(fill);

  const grass = new MeshLambertMaterial({ color: new Color('#86b35c'), flatShading: true });
  const grassDark = new MeshLambertMaterial({ color: new Color('#6e9a4b'), flatShading: true });
  const cliff = new MeshLambertMaterial({ color: new Color('#b98a62'), flatShading: true });
  const wood = new MeshLambertMaterial({ color: new Color('#9a6a45'), flatShading: true });
  const cloud = new MeshLambertMaterial({ color: new Color('#fff1e4'), emissive: new Color('#f3b98f'), emissiveIntensity: 0.25 });
  const top = new Mesh(new CylinderGeometry(7, 6.4, 0.5, 40, 1), grass);
  top.position.y = -0.25;
  island.add(top);
  const rock = new Mesh(new ConeGeometry(6.4, 4.5, 28, 3), cliff);
  rock.rotation.x = Math.PI;
  rock.position.y = -2.75;
  island.add(rock);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 2.2 + rnd() * 4.2;
    const bush = new Mesh(new SphereGeometry(0.25 + rnd() * 0.35, 9, 7), rnd() > 0.5 ? grass : grassDark);
    bush.position.set(Math.cos(a) * r, 0.05, Math.sin(a) * r);
    bush.scale.y = 0.7;
    island.add(bush);
  }
  for (const [x, z, s] of [[-2.6, -4.2, 1.2], [2.9, -3.6, 1], [-4.2, -1.6, 0.9], [4.4, -1.2, 1.1], [0.9, -5.3, 1.3]]) {
    const trunk = new Mesh(new CylinderGeometry(0.08 * s, 0.12 * s, 0.9 * s, 7), wood);
    trunk.position.set(x, 0.45 * s, z);
    const crown = new Mesh(new SphereGeometry(0.62 * s, 10, 8), grassDark);
    crown.position.set(x, 1.25 * s, z);
    crown.scale.y = 0.85;
    island.add(trunk, crown);
  }
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 12 + rnd() * 30;
    const puff = new Mesh(new SphereGeometry(1, 12, 8), cloud);
    puff.position.set(Math.cos(a) * r, -2.5 + rnd() * 2, Math.sin(a) * r);
    puff.scale.set(2 + rnd() * 3, 0.8 + rnd() * 0.8, 2 + rnd() * 2.5);
    scene.add(puff);
  }
}

// ---------------------------------------------------------------------------------------
// Hand poses

// Fingertips in the wrist frame of a relaxed left hand (from IWER's relaxed pose).
const TIPS_L: [number, number, number][] = [
  [0.087, -0.04, -0.101],
  [0.035, -0.022, -0.178],
  [-0.01, -0.016, -0.188],
  [-0.035, -0.013, -0.176],
  [-0.062, -0.022, -0.144],
];
const KNUCKLES_L: [number, number, number][] = [
  [0.03, -0.016, -0.035],
  [0.024, -0.007, -0.094],
  [0.002, -0.003, -0.096],
  [-0.017, -0.007, -0.089],
  [-0.035, -0.012, -0.078],
];

/** A wrist quaternion from where the fingers point and where the palm faces. */
function wristQuat(fingers: Vector3, palm: Vector3): Quaternion {
  const z = fingers.clone().normalize().negate();
  const y = palm.clone().normalize().negate();
  const x = new Vector3().crossVectors(y, z).normalize();
  y.crossVectors(z, x).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
}

/** curl 0 open .. 1 fist; spread widens the fingers; pinch closes thumb and index. */
function hand(side: 'left' | 'right', wrist: Vector3, quat: Quaternion, o: { curl?: number; spread?: number; pinch?: number } = {}): { wrist: Vector3; quat: Quaternion; tips: Vector3[] } {
  const m = side === 'left' ? 1 : -1;
  const tips = TIPS_L.map((t, i) => {
    const k = KNUCKLES_L[i];
    const tip = new Vector3(t[0] * m, t[1], t[2]);
    const kn = new Vector3(k[0] * m, k[1], k[2]);
    const spread = (o.spread ?? 0) * (i - 2) * 0.012 * m;
    tip.x += spread;
    const curl = i === 0 ? (o.curl ?? 0) * 0.4 : (o.curl ?? 0);
    // Curling folds the tip toward the palm, under the knuckle.
    const folded = kn.clone().add(new Vector3(0, -0.045, 0.01));
    tip.lerp(folded, curl);
    if (o.pinch && (i === 0 || i === 1)) tip.lerp(new Vector3(0.035 * m, -0.05, -0.115), o.pinch);
    return tip.applyQuaternion(quat).add(wrist);
  });
  return { wrist, quat, tips };
}

function toHandOut(h: ReturnType<typeof hand>, out: HandOut): void {
  out.present = true;
  out.controller = false;
  out.wrist = [h.wrist.x, h.wrist.y, h.wrist.z];
  out.quat = [h.quat.x, h.quat.y, h.quat.z, h.quat.w];
  h.tips.forEach((t, i) => {
    out.tips[i * 3] = t.x;
    out.tips[i * 3 + 1] = t.y;
    out.tips[i * 3 + 2] = t.z;
  });
}

function faceToward(from: Vector3, to: Vector3, roll = 0, pitch = 0): Quaternion {
  const d = to.clone().sub(from);
  const yaw = Math.atan2(-d.x, -d.z);
  return new Quaternion().setFromEuler(new Euler(pitch, yaw, roll, 'YXZ'));
}

// ---------------------------------------------------------------------------------------

const eye = new Vector3(0, 1.15, 0);
let last = performance.now();
const tickers: ((dt: number) => void)[] = [];
function loop(): void {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  for (const t of tickers) t(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

declare global {
  interface Window {
    __ready?: boolean;
    __live?: { live: Live; events: string[]; voices: { bytes: number; mime: string; decodedMs: number }[]; maxLevel: number; drawCalls: number };
    __stats?: { calls: number; triangles: number };
  }
}

if (mode === 'gallery') gallery();
else tab();

function gallery(): void {
  const shot = q.get('shot');
  camera.position.copy(eye);
  if (shot === 'close') {
    camera.position.set(-0.3, 1.16, -1.0);
    camera.lookAt(-0.45, 1.05, -1.75);
  } else if (shot === 'talk') {
    camera.position.set(0.12, 1.2, -1.45);
    camera.lookAt(0.18, 1.1, -2.3);
  } else camera.lookAt(0, 1.0, -2);

  const visitors = [
    { name: 'Mira', color: '#e9825f', head: new Vector3(-0.5, 1.12, -1.75), roll: 0.12, pitch: 0.05, wave: true },
    { name: 'Tom', color: '#3f9e98', head: new Vector3(0.18, 1.2, -2.3), roll: -0.05, pitch: -0.08, talk: true },
    { name: 'Ana', color: '#e2a93b', head: new Vector3(0.82, 1.08, -1.6), roll: -0.1, pitch: 0.18, pinch: true },
  ];
  const made = visitors.map((v) => {
    const a = new Avatar({ name: v.name, color: v.color });
    a.ground = () => 0;
    island.add(a.root);
    a.setActive(true);
    return { v, a };
  });
  let t = 0;
  tickers.push((dt) => {
    t += dt;
    for (const { v, a } of made) {
      const pose = a.pose;
      const qh = faceToward(v.head, eye, v.roll, v.pitch);
      pose.pos = [v.head.x, v.head.y, v.head.z];
      pose.quat = [qh.x, qh.y, qh.z, qh.w];
      pose.talking = Boolean(v.talk);
      const right = new Vector3(1, 0, 0).applyQuaternion(qh);
      const fwd = new Vector3(0, 0, -1).applyQuaternion(qh);
      const up = new Vector3(0, 1, 0);
      if (v.wave) {
        const sway = Math.sin(t * 7) * 0.35;
        const w = v.head.clone().addScaledVector(right, 0.24).addScaledVector(up, -0.02).addScaledVector(fwd, 0.12);
        const fingers = up.clone().applyAxisAngle(fwd, -sway);
        toHandOut(hand('right', w, wristQuat(fingers, fwd.clone().negate().negate()), { spread: 1 }), pose.right);
        const l = v.head.clone().addScaledVector(right, -0.17).addScaledVector(up, -0.42).addScaledVector(fwd, 0.2);
        toHandOut(hand('left', l, wristQuat(fwd.clone().add(new Vector3(0, -0.3, 0)), up.clone().negate()), { curl: 0.35 }), pose.left);
      } else if (v.pinch) {
        const r = v.head.clone().addScaledVector(right, 0.12).addScaledVector(up, -0.36).addScaledVector(fwd, 0.3);
        toHandOut(hand('right', r, wristQuat(fwd.clone().add(right.clone().multiplyScalar(-0.4)), right.clone().multiplyScalar(-1).add(up.clone().multiplyScalar(-0.6))), { pinch: 1, curl: 0.4 }), pose.right);
        const l = v.head.clone().addScaledVector(right, -0.16).addScaledVector(up, -0.4).addScaledVector(fwd, 0.26);
        toHandOut(hand('left', l, wristQuat(fwd.clone().add(right.clone().multiplyScalar(0.3)), up.clone().negate()), { curl: 0.2, spread: 0.3 }), pose.left);
      } else {
        const r = v.head.clone().addScaledVector(right, 0.22).addScaledVector(up, -0.38).addScaledVector(fwd, 0.22);
        toHandOut(hand('right', r, wristQuat(fwd.clone().add(new Vector3(0, -0.2, 0)), right.clone().multiplyScalar(-0.5).add(up.clone().multiplyScalar(-1))), { curl: 0.15 }), pose.right);
        const l = v.head.clone().addScaledVector(right, -0.24).addScaledVector(up, -0.36).addScaledVector(fwd, 0.18);
        toHandOut(hand('left', l, wristQuat(fwd.clone().add(new Vector3(0, -0.2, 0)), right.clone().multiplyScalar(0.5).add(up.clone().multiplyScalar(-1))), { curl: 0.15 }), pose.left);
        a.level = 0.45 + 0.35 * Math.sin(t * 13) * Math.sin(t * 3.1);
      }
      a.update(dt, camera);
    }
    window.__stats = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
  });
  requestAnimationFrame(loop);
  setTimeout(() => (window.__ready = true), 1500);
}

function tab(): void {
  const role = q.get('role') === 'guest' ? 'guest' : 'host';
  const relay = q.get('relay') ?? undefined;
  const guestSeat = new Vector3(0.7, 1.15, -1.8);
  const seat = role === 'host' ? eye.clone() : guestSeat.clone();
  camera.position.copy(seat);
  camera.lookAt(role === 'host' ? new Vector3(0.6, 1.1, -1.8) : eye);
  const base = camera.quaternion.clone();

  // Fake tracked hands for the guest: IWSDK-shaped adapters with joint matrices.
  const joints = { left: new Float32Array(25 * 16), right: new Float32Array(25 * 16) };
  const grip = new Object3D();
  const adapters = {
    hand: { left: { connected: role === 'guest', jointTransforms: joints.left, gripSpace: grip }, right: { connected: role === 'guest', jointTransforms: joints.right, gripSpace: grip } },
    controller: { left: { connected: false }, right: { connected: false } },
  };
  const world = { camera, scene, input: { xr: { visualAdapters: adapters } }, renderer: { xr: { isPresenting: role === 'guest' } } };
  const frameFns: ((dt: number, now: number) => void)[] = [];
  const live = createLive({ world, space: island, everyFrame: (fn) => (frameFns.push(fn), () => {}) }, { relay, name: role === 'host' ? 'Mira' : 'Tom', storage: null, ground: () => 0 });
  const state: NonNullable<Window['__live']> = { live, events: [], voices: [], maxLevel: 0, drawCalls: 0 };
  window.__live = state;
  live.on('state', (s, _r, msg) => {
    state.events.push(`state:${s}`);
    status.textContent = `${role} · ${s}${msg ? ` · ${msg}` : ''}${live.code ? ` · ${live.code}` : ''}`;
  });
  live.on('join', (p) => state.events.push(`join:${p.name}`));
  live.on('snapshot', (s) => state.events.push(`snapshot:${(s as { id?: string }).id}`));
  live.on('say', (d, from) => state.events.push(`say:${from.name}:${d.text}`));
  live.on('voice', async (note) => {
    const ctx = new AudioContext();
    let decodedMs = -1;
    try {
      decodedMs = Math.round((await ctx.decodeAudioData(note.audio.slice().buffer)).duration * 1000);
    } catch {
      decodedMs = -1;
    }
    void ctx.close();
    state.voices.push({ bytes: note.audio.byteLength, mime: note.mime, decodedMs });
  });

  let t = 0;
  tickers.push((dt) => {
    t += dt;
    if (role === 'guest') {
      // Head: a gentle look around; hands: a wave and a resting left.
      const look = new Quaternion().setFromEuler(new Euler(Math.sin(t * 0.7) * 0.08, Math.sin(t * 0.5) * 0.25, Math.sin(t * 0.9) * 0.05, 'YXZ'));
      camera.quaternion.copy(base).multiply(look);
      camera.position.copy(seat).add(new Vector3(Math.sin(t * 0.6) * 0.03, Math.sin(t * 1.1) * 0.015, 0));
      camera.updateMatrixWorld();
      const fwd = new Vector3(0, 0, -1).applyQuaternion(base);
      const right = new Vector3(1, 0, 0).applyQuaternion(base);
      const up = new Vector3(0, 1, 0);
      const sway = Math.sin(t * 6) * 0.4;
      const rw = seat.clone().addScaledVector(right, 0.25).addScaledVector(up, 0.0).addScaledVector(fwd, 0.25);
      const rh = hand('right', rw, wristQuat(up.clone().applyAxisAngle(fwd, -sway), fwd), { spread: 1 });
      const lw = seat.clone().addScaledVector(right, -0.2).addScaledVector(up, -0.4).addScaledVector(fwd, 0.25);
      const lh = hand('left', lw, wristQuat(fwd.clone().add(new Vector3(0, -0.3, 0)), up.clone().negate()), { curl: 0.3 + 0.1 * Math.sin(t) });
      for (const [arr, h] of [[joints.right, rh], [joints.left, lh]] as const) {
        new Matrix4().compose(h.wrist, h.quat, new Vector3(1, 1, 1)).toArray(arr, 0);
        [4, 9, 14, 19, 24].forEach((j, i) => new Matrix4().makeTranslation(h.tips[i].x, h.tips[i].y, h.tips[i].z).toArray(arr, j * 16));
      }
    }
    for (const fn of frameFns) fn(dt, performance.now());
    for (const p of live.peers) {
      const a = live.avatarOf(p.id)?.userData.avatar as Avatar | undefined;
      if (a) state.maxLevel = Math.max(state.maxLevel, a.level);
    }
    state.drawCalls = renderer.info.render.calls;
  });
  requestAnimationFrame(loop);

  const run = async () => {
    try {
      if (role === 'host') {
        const { code, link } = await live.host('preview-island', { snapshot: () => ({ id: 'preview-island' }) as never });
        state.events.push(`hosted:${code}`, `link:${link}`);
      } else {
        await live.join(q.get('code') ?? '');
        state.events.push('joined');
      }
    } catch (error) {
      state.events.push(`failed:${(error as { reason?: string }).reason ?? String(error)}`);
    }
    window.__ready = true;
  };
  void run();
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

export { emptyPose };
