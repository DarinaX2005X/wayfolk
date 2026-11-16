/**
 * The ghost hand (DESIGN "Призрачная рука"): a translucent bone hand (35%, no glow) that
 * shows a gesture at an object until the person's first right action. Gestures: carry
 * (take, carry to `to`, let go), pull (pinch the bead and draw it toward the seat),
 * pinch, lift (take and raise 6 cm toward the person). One cycle: fly in, gesture, a
 * pause of 1.2 s, again. The hand is one instanced mesh of capsules (palm, fingers).
 */
import { CapsuleGeometry, Euler, InstancedMesh, Matrix4, MeshStandardMaterial, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { COLOR, MOTION } from '../../tokens/tokens';
import { zone } from '../../app/perf/zone';
import { animate, clamp01, easeInOut, lessMotion, now } from './time';
import type { GhostHand, Gesture } from './types';

const IN_MS = 600;
const PAUSE_MS = 1200;
const GESTURE_MS: Record<Gesture, number> = { carry: 1600, pull: 1100, pinch: 700, lift: 1000 };
const OPACITY = 0.35;

// Fingers: base in palm space (x across, z forward = away from the wrist), lengths of two segments.
const FINGERS = [
  { base: [-0.026, 0, -0.012], len: [0.03, 0.026], spread: 0.5, thumb: true },
  { base: [-0.017, 0, -0.072], len: [0.038, 0.03], spread: 0.08, thumb: false },
  { base: [-0.005, 0, -0.076], len: [0.042, 0.032], spread: 0, thumb: false },
  { base: [0.007, 0, -0.073], len: [0.039, 0.03], spread: -0.06, thumb: false },
  { base: [0.018, 0, -0.064], len: [0.03, 0.024], spread: -0.14, thumb: false },
] as const;

export function createGhostHand(): GhostHand {
  const root = new Object3D();
  root.name = 'kit:ghost-hand';
  zone(root, 'hands');
  const material = new MeshStandardMaterial({ color: COLOR.bone, roughness: 0.6, metalness: 0, transparent: true, opacity: OPACITY, depthWrite: true });
  const geo = new CapsuleGeometry(0.008, 1, 4, 10);
  geo.translate(0, 0.5, 0); // from y = 0 to y = 1 between the cap centres
  const mesh = new InstancedMesh(geo, material, 1 + FINGERS.length * 2);
  mesh.name = 'ghost-hand';
  mesh.frustumCulled = false;
  mesh.count = 0;
  root.add(mesh);

  let gesture: Gesture | null = null;
  let from = new Vector3();
  let to = new Vector3();
  let startAt = -Infinity;

  const palm = new Object3D();
  const m4 = new Matrix4();
  const q = new Quaternion();
  const e = new Euler();
  const a = new Vector3();
  const b = new Vector3();
  const s3 = new Vector3();
  const up = new Vector3(0, 1, 0);
  const pos = new Vector3();
  const dir = new Vector3();
  const tip = new Vector3();
  const w0 = new Vector3();
  const w1 = new Vector3();
  const p2 = new Vector3();

  const segment = (i: number, p0: Vector3, p1: Vector3, radius: number): void => {
    dir.subVectors(p1, p0);
    const len = Math.max(0.001, dir.length());
    q.setFromUnitVectors(up, dir.normalize());
    // The capsule's caps add 2 × 8 mm: scale its radius, stretch its length.
    m4.compose(p0, q, s3.set(radius / 0.008, len, radius / 0.008));
    mesh.setMatrixAt(i, m4);
  };

  const hand: GhostHand = {
    root,
    show(g, f, t) {
      gesture = g;
      from = f.clone();
      to = (t ?? f).clone();
      startAt = now();
    },
    hide() {
      gesture = null;
    },
    update(t) {
      if (!gesture) {
        mesh.count = 0;
        return;
      }
      const reduced = lessMotion();
      const cycle = IN_MS + GESTURE_MS[gesture] + PAUSE_MS;
      const local = (t - startAt) % cycle;
      const kIn = clamp01(local / IN_MS);
      const kG = clamp01((local - IN_MS) / GESTURE_MS[gesture]);
      const pause = local > IN_MS + GESTURE_MS[gesture];
      // Where the pinch point is, and how closed the hand is (0 open, 1 pinched).
      let close = 0;
      pos.copy(from);
      if (gesture === 'carry') {
        close = kG < 0.15 ? kG / 0.15 : kG > 0.85 ? (1 - kG) / 0.15 : 1;
        pos.lerpVectors(from, to, easeInOut(clamp01((kG - 0.15) / 0.7)));
        pos.y += 0.05 * Math.sin(Math.PI * clamp01((kG - 0.15) / 0.7));
      } else if (gesture === 'pull') {
        close = kG < 0.2 ? kG / 0.2 : 1;
        dir.set(-from.x, 0, -from.z).normalize();
        pos.copy(from).addScaledVector(dir, 0.15 * easeInOut(clamp01((kG - 0.2) / 0.8)));
      } else if (gesture === 'pinch') {
        close = Math.sin(Math.PI * kG);
      } else {
        close = kG < 0.25 ? kG / 0.25 : 1;
        dir.set(-from.x, 0, -from.z).normalize();
        const k = easeInOut(clamp01((kG - 0.25) / 0.75));
        pos.copy(from).addScaledVector(dir, MOTION.slip.lift * k);
        pos.y += MOTION.slip.lift * k;
      }
      // Flying in from above and behind the object.
      const approach = reduced ? 0 : 1 - easeInOut(kIn);
      pos.y += 0.12 * approach;
      const fade = reduced ? 1 : Math.min(kIn * 2, pause ? 1 - clamp01((local - IN_MS - GESTURE_MS[gesture]) / PAUSE_MS) * 0.6 : 1);
      material.opacity = OPACITY * fade;
      // Palm: wrist toward the person, fingers pointing away, palm down; pinch point ahead.
      const yaw = Math.atan2(-pos.x, -pos.z) + Math.PI;
      e.set(-0.5, yaw, 0, 'YXZ');
      palm.quaternion.setFromEuler(e);
      palm.position.copy(pos).add(tip.set(0.0, 0.035, 0.095).applyQuaternion(palm.quaternion));
      palm.updateMatrix();
      a.set(0, 0, 0).applyMatrix4(palm.matrix);
      b.set(0, 0, -0.07).applyMatrix4(palm.matrix);
      segment(0, a, b, 0.024);
      let i = 1;
      for (const f of FINGERS) {
        const curl = f.thumb ? 0.5 + close * 0.5 : 0.15 + close * (f.base[0] < 0 ? 0.9 : 1.2);
        const p0 = a.set(f.base[0], f.base[1], f.base[2]);
        const dx = f.thumb ? 0.4 + close * 0.5 : f.spread;
        // First segment.
        const d1 = dir.set(Math.sin(dx) * Math.cos(curl * 0.6), -Math.sin(curl * 0.6), -Math.cos(dx) * Math.cos(curl * 0.6));
        b.copy(p0).addScaledVector(d1, f.len[0]);
        w0.copy(p0).applyMatrix4(palm.matrix);
        w1.copy(b).applyMatrix4(palm.matrix);
        segment(i++, w0, w1, f.thumb ? 0.0085 : 0.0075);
        const d2 = d1.set(Math.sin(dx) * Math.cos(curl * 1.3), -Math.sin(curl * 1.3), -Math.cos(dx) * Math.cos(curl * 1.3));
        p2.copy(b).addScaledVector(d2, f.len[1]).applyMatrix4(palm.matrix);
        segment(i++, w1, p2, f.thumb ? 0.008 : 0.0068);
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
  animate(hand);
  return hand;
}
