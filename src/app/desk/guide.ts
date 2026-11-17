/**
 * The browser guide: in a page without a headset the view is a camera the person does
 * not yet know how to hold, so the island directs it for them.
 *
 *   - framing: the view turns gently to whoever speaks, to the traveler drifting in, to
 *     the spot where a house goes; a drag or a walk takes the view back for a while;
 *   - screen points: where on the page the speaker and the one next action are, so the
 *     page can put the replies beside the speaker and a paper arrow on the next action;
 *   - walking: W A S D or the arrow keys (and the stick on a phone) walk on the ground.
 *
 * Everything here runs only while `store.mode` is 'desk'. In a headset nothing of it
 * moves the view, and there is no smooth locomotion.
 */
import { AdditiveBlending, Box3, CanvasTexture, Quaternion, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3, type Object3D } from '@iwsdk/core';
import { Raycaster, type Ray } from '@iwsdk/core';
import type { App } from '../boot/world';
import { createWalkable, type Walkable } from '../walkable';
import { registerDebug } from '../debug';
import type { WorldPort } from '../ports';
import { EYE_HEIGHT, type Rig } from '../rig';
import type { ScreenPoint } from '../store';

/** A point in the world, read each frame (null while it does not exist). */
export type Subject = () => Vector3 | null;

export type Guide = {
  /**
   * Keeps a subject in view (null: stop framing). `lift` raises the aim, metres; `zoom`
   * narrows the view on a far subject (a traveler drifting in), as a camera would.
   */
  frame(subject: Subject | null, opts?: { lift?: number; hold?: boolean; zoom?: boolean }): void;
  /** Hangs a glowing arrow in the air over a subject (the one next thing), or takes it away. */
  cue(subject: Subject | null, text?: string | null): void;
  /** The person took the view (drag, keys): framing waits. */
  manual(ms?: number): void;
  /** Walking input, -1..1 each: forward and right (keys or the phone stick). */
  setWalk(forward: number, right: number, turn?: number): void;
  /** Walks to a point of the ground (a click on it); false when nobody can stand there. */
  goTo(p: Vector3): boolean;
  /** Where a ray from the page meets the island's ground, if it does. */
  groundHit(ray: Ray): Vector3 | null;
  /** Where a person may stand (shared with moving in a headset). */
  readonly walkable: Walkable;
  /** True while the person walks. */
  readonly walking: boolean;
  /** Where a world object is, for subjects: its world position plus a lift. */
  of(object: () => Object3D | null | undefined, lift?: number): Subject;
};

const TMP = new Vector3();
const LOCAL = new Vector3();
const ARROW_AT = new Vector3();
const HALO_Q = new Quaternion();

/** A soft ring for the spot a click walks to. */
function ringTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 34, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,240,200,0)');
  r.addColorStop(0.75, 'rgba(255,236,190,0.85)');
  r.addColorStop(1, 'rgba(255,220,160,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft round glow for under the arrow. */
function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,236,170,0.95)');
  r.addColorStop(0.45, 'rgba(255,210,120,0.4)');
  r.addColorStop(1, 'rgba(255,190,100,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createGuide(app: App, rig: Rig, world: WorldPort, blocked: () => { x: number; z: number; r: number }[]): Guide {
  const desk = (): boolean => app.store.mode.peek() === 'desk';
  let subject: Subject | null = null;
  let lift = 0;
  let zoom = false;
  let baseFov = 0;
  let cueSubject: Subject | null = null;
  // The arrow: a warm golden arrow that bobs over the subject, with a glow behind it.
  const arrow = new Group();
  arrow.name = 'guide:arrow';
  arrow.visible = false;
  const gold = new MeshBasicMaterial({ color: '#ffcf6a', toneMapped: false, fog: false, transparent: true, depthTest: false });
  const head = new Mesh(new ConeGeometry(0.5, 0.75, 20).rotateZ(Math.PI).translate(0, 0.375, 0), gold);
  const shaft = new Mesh(new CylinderGeometry(0.17, 0.17, 0.7, 14).translate(0, 1.05, 0), gold);
  const halo = new Mesh(new PlaneGeometry(2.6, 2.6), new MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending, toneMapped: false, fog: false, side: DoubleSide }));
  halo.position.y = 0.7;
  for (const m of [head, shaft, halo]) m.renderOrder = 66;
  arrow.add(halo, head, shaft);
  app.roots.fx.add(arrow);
  let manualUntil = 0;
  let aiming = false;
  const walk = { f: 0, r: 0, turn: 0 };
  const vel = new Vector3();
  let walking = false;
  const walkable = createWalkable(world, blocked);
  const groundAt = (x: number, z: number): number => world.groundY?.(x, z) ?? world.groundAt?.(x, z) ?? 0;
  /** May the person stand here: on the island, clear of houses and tree trunks. */
  const standable = (x: number, z: number): boolean => walkable.ok(x, z);
  /** Where a click asked to walk to (null: nowhere), and a ring on the grass there. */
  let goal: Vector3 | null = null;
  let stuck = 0;
  const ringMat = new MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, fog: false, side: DoubleSide, opacity: 0 });
  const ring = new Mesh(new PlaneGeometry(1, 1), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.renderOrder = 4;
  ring.visible = false;
  app.roots.fx.add(ring);
  const groundRay = new Raycaster();

  const project = (p: Vector3, out: ScreenPoint, size = 0.8): void => {
    const cam = app.world.camera;
    const canvas = app.world.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    LOCAL.copy(p).applyMatrix4(cam.matrixWorldInverse);
    const inFront = LOCAL.z < -0.05;
    TMP.copy(p).project(cam);
    if (inFront && Math.abs(TMP.x) <= 1 && Math.abs(TMP.y) <= 1) {
      out.x = ((TMP.x + 1) / 2) * w;
      out.y = ((1 - TMP.y) / 2) * h;
      out.on = true;
      const fov = ((cam as { fov?: number }).fov ?? 60) * (Math.PI / 180);
      out.size = (size / Math.max(0.3, -LOCAL.z)) * (h / (2 * Math.tan(fov / 2)));
      return;
    }
    // Off the page: a point on the edge in the direction of the subject.
    let dx = LOCAL.x;
    let dy = LOCAL.y;
    if (!inFront && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) dx = 1;
    const k = Math.max(Math.abs(dx) / (w / 2 - 70), Math.abs(dy) / (h / 2 - 70));
    out.x = w / 2 + dx / k;
    out.y = h / 2 - dy / k;
    out.on = false;
    out.size = 0;
  };

  app.everyFrame((dtIn, now) => {
    const points = app.store.points;
    if (!desk()) {
      points.speaker.on = false;
      points.cue.on = false;
      arrow.visible = false;
      walking = false;
      return;
    }
    const dt = Math.min(0.05, dtIn > 1 ? dtIn / 1000 : dtIn);
    const cam = app.world.camera;
    cam.updateMatrixWorld();

    // Walking on the ground: keys and the stick, or toward a clicked spot.
    if (walk.f || walk.r) goal = null;
    let want = Math.hypot(walk.f, walk.r);
    if (walk.turn) {
      rig.look(rig.lookYaw - walk.turn * dt * 1.6, rig.lookPitch);
      manualUntil = now + 4000;
    }
    const yaw = app.world.player.rotation.y + rig.lookYaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const speed = 1.8;
    let tx = (fx * walk.f + -fz * walk.r) * (want > 1 ? 1 / want : 1) * speed;
    let tz = (fz * walk.f + fx * walk.r) * (want > 1 ? 1 / want : 1) * speed;
    if (goal) {
      const p = app.world.player.position;
      const dx = goal.x - p.x;
      const dz = goal.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25 || stuck > 0.6) {
        goal = null;
        stuck = 0;
      } else {
        const v = Math.min(speed, d * 2.2 + 0.4);
        tx = (dx / d) * v;
        tz = (dz / d) * v;
        want = 1;
      }
    }
    ring.visible = Boolean(goal);
    if (goal) {
      ring.position.set(goal.x, groundAt(goal.x, goal.z) + 0.04, goal.z);
      ring.scale.setScalar(0.9 + Math.sin(now / 260) * 0.08);
      ringMat.opacity = 0.85;
    }
    vel.x += (tx - vel.x) * Math.min(1, dt * 8);
    vel.z += (tz - vel.z) * Math.min(1, dt * 8);
    walking = Math.hypot(vel.x, vel.z) > 0.05;
    if (walking) {
      const p = app.world.player.position;
      let nx = p.x + vel.x * dt;
      let nz = p.z + vel.z * dt;
      if (!standable(nx, nz)) {
        // Slide along the edge: try each axis alone.
        if (standable(nx, p.z)) nz = p.z;
        else if (standable(p.x, nz)) nx = p.x;
        else {
          nx = p.x;
          nz = p.z;
          vel.set(0, 0, 0);
          stuck += dt;
        }
      }
      const gy = groundAt(nx, nz);
      // The camera keeps seated eye height over the ground, eased so steps do not jolt.
      const ny = p.y + ((Number.isFinite(gy) ? gy : p.y) - p.y) * Math.min(1, dt * 10);
      rig.stepTo(nx, ny, nz);
      if (want > 0) {
        manualUntil = now + 4000;
        if (!app.store.walked.peek()) app.store.walked.value = true;
      }
    }

    // Framing.
    const target = subject?.();
    // The lens: a far subject is brought closer by narrowing the view, eased both ways.
    const lens = cam as unknown as { fov?: number; updateProjectionMatrix?: () => void };
    if (lens.fov && lens.updateProjectionMatrix) {
      if (!baseFov) baseFov = lens.fov;
      let want = baseFov;
      if (zoom && target) {
        const d = cam.getWorldPosition(TMP).distanceTo(target);
        want = Math.max(baseFov * 0.5, Math.min(baseFov, (baseFov * 6.5) / Math.max(1, d)));
      }
      if (Math.abs(want - lens.fov) > 0.05) {
        // With reduced motion the view cuts instead of gliding.
        lens.fov += (want - lens.fov) * (app.store.settings.peek().lessMotion ? 1 : 1 - Math.exp(-dt * 1.6));
        lens.updateProjectionMatrix();
      }
    }
    if (target && now > manualUntil) {
      const from = cam.getWorldPosition(LOCAL);
      const dx = target.x - from.x;
      const dz = target.z - from.z;
      const goalYaw = Math.atan2(-dx, -dz) - app.world.player.rotation.y;
      const goalPitch = Math.max(-0.9, Math.min(0.5, Math.atan2(target.y + lift - from.y, Math.hypot(dx, dz))));
      let dy = goalYaw - rig.lookYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const dp = goalPitch - rig.lookPitch;
      // A dead zone keeps the view still while the subject stays well in frame.
      const far = Math.abs(dy) > 0.13 || Math.abs(dp) > 0.11;
      if (far) aiming = true;
      if (aiming) {
        const k = app.store.settings.peek().lessMotion ? 1 : 1 - Math.exp(-dt * 2.4);
        rig.look(rig.lookYaw + dy * k, rig.lookPitch + dp * k);
        if (Math.abs(dy) < 0.015 && Math.abs(dp) < 0.015) aiming = false;
      }
    }

    // Where the speaker and the next action are on the page.
    const speaker = app.store.speaker.peek();
    const sp = speaker ? speakerPoint(speaker) : null;
    if (sp) project(sp, points.speaker, speaker === 'pip' ? 0.25 : 0.8);
    else points.speaker.on = false;
    const cp = cueSubject?.();
    if (cp) project(cp, points.cue, 0.6);
    else points.cue.on = false;
    // The arrow hangs over the subject, sized to read at any distance, and bobs.
    arrow.visible = Boolean(cp);
    if (cp) {
      const d = cam.getWorldPosition(ARROW_AT).distanceTo(cp);
      const s = Math.max(0.24, Math.min(1.2, d * 0.05));
      const less = app.store.settings.peek().lessMotion;
      arrow.position.copy(cp).add(TMP.set(0, s * 0.6 + (less ? 0 : Math.abs(Math.sin(now / 380)) * s * 0.5), 0));
      arrow.scale.setScalar(s);
      arrow.rotation.y = less ? 0 : now / 900;
      arrow.updateMatrixWorld();
      halo.quaternion.copy(arrow.quaternion).invert().multiply(cam.getWorldQuaternion(HALO_Q));
    }
  });

  let speakerPoint: (id: string) => Vector3 | null = () => null;

  const guide: Guide & { speakerAt(fn: (id: string) => Vector3 | null): void } = {
    frame(s, opts) {
      subject = s;
      lift = opts?.lift ?? 0;
      zoom = Boolean(opts?.zoom);
      aiming = true;
      if (!opts?.hold) manualUntil = Math.min(manualUntil, app.clock.now() + 600);
    },
    cue(s, text) {
      cueSubject = s;
      app.store.cue.value = s ? (text ?? null) : null;
    },
    manual(ms = 5000) {
      manualUntil = app.clock.now() + ms;
      aiming = false;
    },
    setWalk(f, r, turn = 0) {
      walk.f = f;
      walk.r = r;
      walk.turn = turn;
    },
    goTo(p) {
      if (!standable(p.x, p.z)) return false;
      goal = p.clone();
      stuck = 0;
      manualUntil = app.clock.now() + 4000;
      if (!app.store.walked.peek()) app.store.walked.value = true;
      return true;
    },
    groundHit(ray) {
      const ground = (world as { ground?: Mesh }).ground;
      if (!ground?.isMesh) return null;
      groundRay.ray.copy(ray);
      groundRay.far = 80;
      const hit = groundRay.intersectObject(ground, false)[0];
      return hit ? hit.point.clone() : null;
    },
    walkable,
    get walking() {
      return walking;
    },
    of(object, l = 0) {
      const v = new Vector3();
      return () => {
        const o = object();
        if (!o) return null;
        o.updateWorldMatrix(true, false);
        return o.getWorldPosition(v).add(TMP.set(0, l, 0));
      };
    },
    speakerAt(fn) {
      speakerPoint = fn;
    },
  };
  registerDebug('guide', guide);
  void EYE_HEIGHT;
  return guide;
}
