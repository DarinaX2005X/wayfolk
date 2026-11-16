/**
 * The red thread (DESIGN "Красная нить"): a sagging cord of 4 mm between two points with
 * a bead tag of 3 cm in the middle carrying the topic (its hit zone is 5 cm). The bead is
 * its own node: `onPull` of 01.3 moves it along its axis toward the seat, and the cord
 * follows it; `setPull(k)` does the same from code (0 at rest, 1 is 15 cm toward the person).
 *
 * States: open (red, sagging), taut (under the hand, straight), kept (a moss "Kept"
 * stamp on the bead), dismissed (grey and slack), resolved (grey with "Resolved by page
 * 65"), reopened (red, "reopened by you"), added (red, "added by you"), new (a wave runs
 * along it for 600 ms). The cord is rebuilt in place, never reallocated.
 */
import { BufferAttribute, BufferGeometry, Mesh, Object3D, SphereGeometry, Vector3 } from '@iwsdk/core';
import { COLOR } from '../../tokens/tokens';
import { bevelBox, flatRing } from './geom';
import { createLabel, setLabelText } from './label';
import { mat, part, proxyMesh, setMat } from './materials';
import { animate, clamp01, lessMotion, now } from './time';
import type { ThreadState, ThreadView } from './types';

const SEG = 40;
const RAD = 8;
const R = 0.002;
const PULL = 0.15;
const WAVE_MS = 600;

const NOTE: Partial<Record<ThreadState, string>> = { reopened: 'reopened by you', added: 'added by you', resolved: 'Resolved' };

export function createThread(opts: { eyeDist?: number } = {}): ThreadView {
  const root = new Object3D();
  root.name = 'kit:thread';
  const eyeDist = opts.eyeDist ?? 1.0;

  // The cord: SEG+1 rings of RAD vertices.
  const positions = new Float32Array((SEG + 1) * RAD * 3);
  const normals = new Float32Array((SEG + 1) * RAD * 3);
  const colors = new Float32Array((SEG + 1) * RAD * 3).fill(1);
  const index: number[] = [];
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < RAD; j++) {
      const a = i * RAD + j;
      const b = i * RAD + ((j + 1) % RAD);
      const c = (i + 1) * RAD + j;
      const d = (i + 1) * RAD + ((j + 1) % RAD);
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new BufferAttribute(normals, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  geometry.setIndex(index);
  const cord = new Mesh(geometry, mat('thread'));
  cord.name = 'thread:cord';
  cord.userData.kitMat = 'thread';
  cord.userData.noBatch = true;
  cord.frustumCulled = false;
  root.add(cord);

  // The bead: a paper tag with a vermilion edge, the topic on it, a 5 cm hit zone.
  const bead = new Object3D();
  bead.name = 'thread:bead';
  const tag = part(bevelBox(0.03, 0.02, 0.003, 0.0008, 0.003), 'paper', 'thread:tag');
  tag.position.y = -0.024;
  const rim = part(bevelBox(0.032, 0.022, 0.0026, 0.0008, 0.004), 'vermilion', 'thread:rim');
  rim.position.set(0, -0.025, -0.0004);
  const topic = createLabel(' ', { role: 'label', width: 0.08, eyeDist, lines: 1, weight: 700, align: 'center' });
  topic.scale.multiplyScalar(1);
  topic.position.set(0, -0.014, 0.0022);
  const stamp = part(flatRing(0.007, 0.0012, 20), 'moss', 'thread:kept');
  stamp.rotation.x = Math.PI / 2;
  stamp.position.set(0.009, -0.016, 0.002);
  stamp.visible = false;
  const keptLabel = createLabel('Kept', { role: 'label', width: 0.04, eyeDist, lines: 1, weight: 700, color: COLOR.mossText, align: 'center' });
  keptLabel.position.set(0, -0.032, 0.0022);
  keptLabel.visible = false;
  const note = createLabel(' ', { role: 'label', width: 0.18, eyeDist, lines: 1, color: COLOR.inkSoft, align: 'center' });
  note.position.set(0, -0.052, 0.0022);
  note.visible = false;
  const hit = proxyMesh(new SphereGeometry(0.025, 12, 8), 'thread:hit');
  hit.position.y = -0.016;
  bead.add(rim, tag, topic, stamp, keptLabel, note, hit);
  root.add(bead);

  const a = new Vector3();
  const b = new Vector3();
  const rest = new Vector3();
  const toward = new Vector3();
  let state: ThreadState = 'open';
  let stateAt = -Infinity;
  let pull = 0;
  let pullSet = false;
  const p = new Vector3();
  const q = new Vector3();
  const t3 = new Vector3();
  const n1 = new Vector3();
  const n2 = new Vector3();
  const side = new Vector3();
  const upW = new Vector3(0, 1, 0);

  const sagFor = (s: ThreadState): number => (s === 'taut' ? 0.004 : s === 'dismissed' || s === 'resolved' ? 0.16 : 0.08);

  /** Point of the cord at u (0..1): a → bead → b, each half a sagging parabola. */
  const at = (u: number, out: Vector3, sag: number): Vector3 => {
    const first = u < 0.5;
    const from = first ? a : bead.position;
    const to = first ? bead.position : b;
    const k = first ? u * 2 : (u - 0.5) * 2;
    out.lerpVectors(from, to, k);
    const len = from.distanceTo(to);
    out.y -= 4 * k * (1 - k) * sag * len;
    return out;
  };

  const thread: ThreadView = {
    root,
    bead,
    get state() {
      return state;
    },
    set(o) {
      a.copy(o.a);
      b.copy(o.b);
      rest.lerpVectors(a, b, 0.5);
      rest.y -= 0.02;
      // Toward the seat: from the rest point to the origin of the frame, level.
      toward.set(-rest.x, 0, -rest.z).normalize();
      if (state !== o.state) stateAt = now();
      state = o.state;
      setLabelText(topic, o.label || ' ');
      const text = o.note ?? NOTE[o.state] ?? '';
      setLabelText(note, text || ' ');
      note.visible = text.length > 0;
      const gray = o.state === 'dismissed' || o.state === 'resolved';
      setMat(cord, gray ? 'threadGray' : 'thread');
      setMat(rim, gray ? 'outline' : 'vermilion');
      stamp.visible = o.state === 'kept';
      keptLabel.visible = o.state === 'kept';
      if (!pullSet) bead.position.copy(rest);
    },
    setPull(k) {
      pull = clamp01(k);
      pullSet = true;
      bead.position.copy(rest).addScaledVector(toward, PULL * pull);
    },
    update(t) {
      const sag = sagFor(pull > 0.02 ? 'taut' : state) * (1 - pull * 0.8);
      const wave = state === 'new' && !lessMotion() ? clamp01((t - stateAt) / WAVE_MS) : -1;
      for (let i = 0; i <= SEG; i++) {
        const u = i / SEG;
        at(u, p, sag);
        if (i < SEG) t3.subVectors(at(u + 1 / SEG, q, sag), p).normalize();
        else t3.subVectors(p, at(u - 1 / SEG, q, sag)).normalize();
        side.crossVectors(t3, upW);
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0);
        side.normalize();
        n1.crossVectors(side, t3).normalize();
        const bulge = wave >= 0 && wave < 1 ? 1 + 1.2 * Math.exp(-((u - wave) ** 2) / 0.004) : 1;
        for (let j = 0; j < RAD; j++) {
          const ang = (j / RAD) * Math.PI * 2;
          n2.copy(side).multiplyScalar(Math.cos(ang)).addScaledVector(n1, Math.sin(ang));
          const o = (i * RAD + j) * 3;
          positions[o] = p.x + n2.x * R * bulge;
          positions[o + 1] = p.y + n2.y * R * bulge;
          positions[o + 2] = p.z + n2.z * R * bulge;
          normals[o] = n2.x;
          normals[o + 1] = n2.y;
          normals[o + 2] = n2.z;
        }
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.normal.needsUpdate = true;
      geometry.computeBoundingSphere();
      // The bead faces the person.
      bead.rotation.y = Math.atan2(-bead.position.x, -bead.position.z);
    },
  };
  animate(thread);
  return thread;
}
