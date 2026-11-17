/**
 * Small delights of the island, each a moment that answers a person's hand (or mouse):
 *
 *   lantern  a paper lantern lights on the palm; hold it up and it floats off to an
 *            island on the horizon, and a note goes to that island's mailbox;
 *   star     a shooting star falls in front of the seat; catch it, make a wish;
 *   notes    notes from guests hang on the mailbox as paper slips; a neighbour reads one
 *            aloud (on coming home, or when a slip is touched or clicked);
 *   wave     a resident you look at for a moment turns and waves;
 *   stroke   stroke Pip with a fingertip (or the mouse) and he puffs up and chirps.
 *
 * Every part works with hands in the headset and with the pointer in a page.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Object3D,
} from '@iwsdk/core';
import { say as caption } from '../feel/captions';
import { sound } from '../feel/sound';
import type { MailItem } from '../mind/types';
import { drawKind } from '../theatre/silhouettes';
import type { App } from './boot/world';
import { registerDebug, registerTest } from './debug';
import type { Guide } from './desk/guide';
import { SIDES, type Hands } from './hands/hands';
import type { Modules } from './modules';

export type Delights = {
  lantern(): Promise<void>;
  star(): Promise<void>;
  /** A neighbour reads the oldest unread note aloud; false when there is none. */
  readNote(): Promise<boolean>;
  /** Hangs the unread notes on the mailbox again. */
  refreshNotes(): void;
};

export const DELIGHT_LINES = {
  lanternHold: 'Hold it up high and let it go. It knows the way.',
  lanternDesk: 'Here is a lantern. Watch it go.',
  lanternGone: (island: string) => `It is going to ${island}. Someone there will see it tonight.`,
  lanternNote: (from: string) => `A paper lantern drifted over from ${from}.`,
  star: 'Look up. A star is falling, right by you.',
  starCatch: 'Catch it with your hand.',
  starCatchDesk: 'Click it to catch it.',
  starWish: 'Make a wish. Then let it go back up.',
  starMissed: 'It slipped back into the sky. There will be others.',
  note: (m: MailItem) => `"${m.text}" That is from ${m.from}${m.fromIsland ? ` on ${m.fromIsland}` : ''}.`,
  noteIntro: 'There is a note in the mailbox. Let me read it.',
} as const;

function lanternTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 210;
  const g = c.getContext('2d')!;
  drawKind(g, 'lantern', 0, 0, 210);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function glowTexture(color: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  r.addColorStop(0, color);
  r.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A folded paper note with a wax dot, for the mailbox. */
function slipTexture(from: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 120;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf1de';
  g.beginPath();
  g.moveTo(8, 10);
  g.lineTo(150, 4);
  g.lineTo(154, 108);
  g.lineTo(6, 114);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(160,110,70,0.35)';
  g.lineWidth = 2;
  for (let i = 0; i < 4; i += 1) {
    g.beginPath();
    g.moveTo(24, 46 + i * 15);
    g.lineTo(126 - (i === 3 ? 40 : 0), 44 + i * 15);
    g.stroke();
  }
  g.fillStyle = '#b8683a';
  g.font = "700 20px 'Atkinson Hyperlegible Next', system-ui, sans-serif";
  g.fillText(from.split(' ')[0], 22, 32, 110);
  g.fillStyle = '#c4532f';
  g.beginPath();
  g.arc(136, 96, 9, 0, Math.PI * 2);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createDelights(app: App, mods: Modules, hands: Hands, guide: Guide, busy: () => boolean): Delights {
  const { world, life, mind } = mods;
  const desk = (): boolean => app.store.mode.peek() === 'desk';
  const pace = (): number => Math.max(0.05, app.store.pace.peek());
  const wait = (ms: number): Promise<void> => new Promise((r) => app.clock.timers.set(r, ms * pace()));
  const within = <T>(p: Promise<T> | T, ms: number, fallback: T): Promise<T> => Promise.race([Promise.resolve(p), wait(ms).then(() => fallback)]).catch(() => fallback);
  const pipSay = (text: string): Promise<void> => {
    caption({ source: 'Pip', text });
    app.store.speaker.value = 'pip';
    return within(Promise.resolve(life.pip.say(text)), 2500 + text.length * 70, undefined);
  };
  const head = new Vector3();
  const fwd = new Vector3();
  const tmp = new Vector3();
  const cam = app.world.camera;
  const readHead = (): void => {
    cam.updateMatrixWorld();
    cam.getWorldPosition(head);
    cam.getWorldDirection(fwd);
  };

  // ------------------------------------------------------------ the lantern
  const lanternTex = lanternTexture();
  const warmGlow = glowTexture('rgba(255,214,140,0.9)');

  const lantern = async (): Promise<void> => {
    const group = new Group();
    group.name = 'delight:lantern';
    const body = new Mesh(new PlaneGeometry(0.16, 0.26), new MeshBasicMaterial({ map: lanternTex, transparent: true, depthWrite: false, toneMapped: false, side: DoubleSide }));
    const halo = new Mesh(new PlaneGeometry(0.38, 0.38), new MeshBasicMaterial({ map: warmGlow, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, opacity: 0.7 }));
    halo.position.z = -0.01;
    group.add(halo, body);
    app.roots.fx.add(group);
    readHead();
    const side = SIDES.find((s) => hands.get(s).tracked && hands.get(s).palmUp) ?? hands.primary()?.side;
    const hand = side ? hands.get(side) : null;
    const onHand = !desk() && hand?.tracked;
    const pos = new Vector3();
    if (onHand && hand) pos.copy(hand.palm).add(tmp.set(0, 0.16, 0));
    else pos.copy(head).addScaledVector(fwd.setY(0).normalize(), 0.9).add(tmp.set(0, -0.25, 0));
    group.position.copy(pos);
    sound.play('bloom', { at: pos });
    if (desk()) guide.frame(() => group.position, { lift: 0.1 });
    // Where it goes: an island on the horizon, or far out over the clouds.
    let islands: { id: string; name: string }[] = [];
    try {
      islands = await within(Promise.resolve(mind.publicIslands?.() ?? []), 3000, []);
    } catch {
      islands = [];
    }
    const target = islands.length ? islands[Math.floor(Math.random() * islands.length)] : null;
    const far = target ? (world as { horizon?: (id: string) => { pos?: Vector3 } | undefined }).horizon?.(target.id)?.pos : undefined;
    const to = far?.isVector3 ? world.root.localToWorld(far.clone()) : head.clone().addScaledVector(fwd, 70).setY(head.y + 18);
    void pipSay(onHand ? DELIGHT_LINES.lanternHold : DELIGHT_LINES.lanternDesk);
    // On the palm: it waits for the hand to rise (or a few seconds); in a page it waits a moment.
    const t0 = app.clock.now();
    const startY = pos.y;
    await new Promise<void>((resolve) => {
      const off = app.everyFrame((_dt, now) => {
        readHead();
        body.lookAt(head);
        halo.lookAt(head);
        halo.scale.setScalar(1 + Math.sin(now / 180) * 0.06);
        if (onHand && hand?.tracked) group.position.copy(hand.palm).add(tmp.set(0, 0.16, 0));
        const lifted = onHand && group.position.y - startY > 0.12;
        if (lifted || now - t0 > (onHand ? 7000 : 2200) * pace()) {
          off();
          resolve();
        }
      });
    });
    sound.play('slide', { at: group.position });
    // Off it goes: up first, then a long slow drift, swaying.
    const from = group.position.clone();
    const dur = 16000 * Math.max(0.3, pace());
    const t1 = app.clock.now();
    await new Promise<void>((resolve) => {
      const off = app.everyFrame((_dt, now) => {
        const k = Math.min(1, (now - t1) / dur);
        // A slow lift first, the way warm air takes a paper lantern, then the long drift.
        const lift = 1 - Math.pow(1 - Math.min(1, k * 1.6), 2);
        group.position.lerpVectors(from, to, Math.pow(k, 2.6) * 0.92);
        group.position.y += lift * 1.1 + Math.sin(now / 700) * 0.04;
        group.position.x += Math.sin(now / 1300) * 0.3 * k;
        readHead();
        body.lookAt(head);
        halo.lookAt(head);
        const fade = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
        (body.material as MeshBasicMaterial).opacity = fade;
        (halo.material as MeshBasicMaterial).opacity = fade * 0.7;
        if (k >= 1) {
          off();
          resolve();
        }
      });
      app.clock.timers.set(() => {
        if (target) {
          void pipSay(DELIGHT_LINES.lanternGone(target.name));
          void within(Promise.resolve((mind as { leaveMail?: (id: string, m: { kind: 'note'; text: string }) => Promise<boolean> }).leaveMail?.(target.id, { kind: 'note', text: DELIGHT_LINES.lanternNote(mind.state?.name ?? 'a small island') })), 5000, false);
        }
      }, 3500 * pace());
    });
    if (desk()) guide.frame(null);
    group.removeFromParent();
    body.geometry.dispose();
    (body.material as MeshBasicMaterial).dispose();
    halo.geometry.dispose();
    (halo.material as MeshBasicMaterial).dispose();
  };

  // ------------------------------------------------------------ the shooting star
  type Fallen = { pos: Vector3; star: Object3D; release(): void };
  const star = async (): Promise<void> => {
    const fall = (world as { shootingStar?: () => Promise<Fallen> }).shootingStar;
    if (!fall) return;
    void pipSay(DELIGHT_LINES.star);
    let fallen: Fallen;
    try {
      fallen = await within(fall.call(world), 12000, null as unknown as Fallen);
    } catch {
      return;
    }
    if (!fallen?.star) return;
    const s = fallen.star;
    if (desk()) guide.frame(() => s.getWorldPosition(tmp), { lift: 0 });
    if (desk()) guide.cue(() => s.getWorldPosition(new Vector3()), 'Click the star to catch it');
    else void pipSay(DELIGHT_LINES.starCatch);
    const caught = await new Promise<boolean>((resolve) => {
      const t0 = app.clock.now();
      const p = new Vector3();
      let clicked = false;
      const ray = new Raycaster();
      const ndc = new Vector2();
      const canvas = app.world.renderer.domElement;
      const onClick = (e: PointerEvent): void => {
        const r = canvas.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ndc, cam);
        s.getWorldPosition(p);
        if (ray.ray.distanceToPoint(p) < 0.35) clicked = true;
      };
      canvas.addEventListener('pointerup', onClick);
      const off = app.everyFrame((_dt, now) => {
        s.getWorldPosition(p);
        const hand = SIDES.map((x) => hands.get(x)).find((h) => h.tracked && (h.indexTip.distanceTo(p) < 0.16 || h.palm.distanceTo(p) < 0.18));
        if (hand || clicked) {
          off();
          canvas.removeEventListener('pointerup', onClick);
          if (hand) hand.anchor.attach(s);
          resolve(true);
        } else if (now - t0 > 25000 * pace()) {
          off();
          canvas.removeEventListener('pointerup', onClick);
          resolve(false);
        }
      });
    });
    guide.cue(null);
    if (caught) {
      sound.play('bloom', { at: s.getWorldPosition(tmp) });
      if (desk()) {
        // In a page the star comes close, as if held up to the eyes.
        readHead();
        const from = s.getWorldPosition(new Vector3());
        const near = head.clone().addScaledVector(fwd, 0.7).add(tmp.set(0, -0.1, 0));
        const t0 = app.clock.now();
        const off = app.everyFrame((_dt, now) => {
          const k = Math.min(1, (now - t0) / 900);
          s.position.copy(s.parent ? s.parent.worldToLocal(from.clone().lerp(near, k * k * (3 - 2 * k))) : from.clone().lerp(near, k));
          if (k >= 1) off();
        });
      }
      await pipSay(DELIGHT_LINES.starWish);
      await wait(3500);
    } else await pipSay(DELIGHT_LINES.starMissed);
    if (desk()) guide.frame(null);
    try {
      fallen.release();
    } catch {
      s.removeFromParent();
    }
  };

  // ------------------------------------------------------------ notes on the mailbox
  const slips: { mesh: Mesh; id: string }[] = [];
  const mailboxAt = (): Vector3 => {
    const local = new Vector3(2.45, 0, -1.1);
    local.y = (world.groundY?.(local.x, local.z) ?? 0) + 1.02;
    return world.root.localToWorld(local);
  };
  const refreshNotes = (): void => {
    const unread = (mind as { notes?: () => MailItem[] }).notes?.() ?? [];
    const want = unread.slice(0, 4);
    for (const s of [...slips]) {
      if (want.some((m) => m.id === s.id)) continue;
      s.mesh.removeFromParent();
      (s.mesh.material as MeshBasicMaterial).map?.dispose();
      (s.mesh.material as MeshBasicMaterial).dispose();
      s.mesh.geometry.dispose();
      slips.splice(slips.indexOf(s), 1);
    }
    const base = mailboxAt();
    want.forEach((m, i) => {
      if (slips.some((s) => s.id === m.id)) return;
      const mesh = new Mesh(new PlaneGeometry(0.24, 0.18), new MeshBasicMaterial({ map: slipTexture(m.from), transparent: true, side: DoubleSide, alphaTest: 0.05 }));
      mesh.name = `note:${i}`;
      mesh.position.copy(base).add(new Vector3(-0.16 + i * 0.11, 0.12 - (i % 2) * 0.12, 0.22));
      mesh.userData.home = mesh.position.clone();
      mesh.userData.phase = i * 1.7;
      app.roots.fx.add(mesh);
      slips.push({ mesh, id: m.id });
    });
  };
  app.clock.timers.set(function poll() {
    refreshNotes();
    app.clock.timers.set(poll, 3000);
  }, 1500);

  let reading = false;
  const readNote = async (): Promise<boolean> => {
    const unread = (mind as { notes?: () => MailItem[] }).notes?.() ?? [];
    const m = unread[0];
    if (!m || reading) return false;
    reading = true;
    try {
      const box = mailboxAt();
      // The nearest neighbour comes over to read it; with nobody home, Pip reads.
      const residents = (mind.state?.residents ?? []).filter((r) => life.objectOf?.(r.id));
      const reader = residents.sort((a, b) => {
        const da = life.objectOf?.(a.id)?.getWorldPosition(new Vector3()).distanceTo(box) ?? 99;
        const db = life.objectOf?.(b.id)?.getWorldPosition(new Vector3()).distanceTo(box) ?? 99;
        return da - db;
      })[0];
      const slip = slips.find((s) => s.id === m.id);
      if (desk() && slip) guide.frame(() => slip.mesh.position, { lift: 0 });
      if (reader) {
        await within(Promise.resolve(life.walkTo(reader.id, box.clone().add(new Vector3(-0.6, 0, 0.6)), { speed: 1.6 })), 8000, undefined);
        life.face?.(reader.id);
        life.emote(reader.id, 'curious');
        if (slip) {
          // The slip flutters off the box into their paws.
          const t0 = app.clock.now();
          const from = slip.mesh.position.clone();
          const off = app.everyFrame((_dt, now) => {
            const k = Math.min(1, (now - t0) / 700);
            const r = life.objectOf?.(reader.id)?.getWorldPosition(new Vector3());
            if (r) slip.mesh.position.lerpVectors(from, r.add(new Vector3(0, 0.55, 0.15)), k);
            if (k >= 1) off();
          });
        }
        const text = DELIGHT_LINES.note(m);
        caption({ source: reader.name, text });
        app.store.speaker.value = reader.id;
        if (desk()) guide.frame(guide.of(() => life.objectOf?.(reader.id), 0.45), { lift: -0.15 });
        await within(life.say(reader.id, text, { name: reader.name }), 4000 + text.length * 70, undefined);
        life.emote(reader.id, 'happy');
      } else {
        await pipSay(DELIGHT_LINES.note(m));
      }
      await within(Promise.resolve((mind as { readNote?: (id: string) => Promise<void> }).readNote?.(m.id)), 3000, undefined);
      refreshNotes();
      return true;
    } finally {
      reading = false;
      if (desk()) guide.frame(null);
    }
  };

  // ------------------------------------------------------------ touch or click a slip; wave; stroke Pip
  const ray = new Raycaster();
  const ndc = new Vector2();
  const canvas = app.world.renderer.domElement;
  canvas.addEventListener('pointerup', (e) => {
    if (!desk() || !slips.length || busy()) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    if (ray.intersectObjects(slips.map((s) => s.mesh), false).length) void readNote();
  });
  let strokeDist = 0;
  let lastStroke = 0;
  const lastTip = new Vector3();
  const puff = (): void => {
    const pip = life.pip.object;
    if (!pip) return;
    life.pip.emote?.('happy');
    sound.play('bloom', { at: pip.getWorldPosition(tmp) });
    const t0 = app.clock.now();
    const base = pip.scale.x || 1;
    const off = app.everyFrame((_dt, now) => {
      const k = Math.min(1, (now - t0) / 900);
      pip.scale.setScalar(base * (1 + Math.sin(k * Math.PI) * 0.22));
      if (k >= 1) {
        pip.scale.setScalar(base);
        off();
      }
    });
  };
  // In a page: moving the pointer over Pip strokes him.
  let hoverStroke = 0;
  canvas.addEventListener('pointermove', (e) => {
    if (!desk() || e.buttons) return;
    const pip = life.pip.object;
    if (!pip) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    if (ray.intersectObject(pip, true).length) {
      hoverStroke += Math.hypot(e.movementX, e.movementY);
      const now = app.clock.now();
      if (hoverStroke > 260 && now - lastStroke > 2500) {
        hoverStroke = 0;
        lastStroke = now;
        puff();
      }
    } else hoverStroke = Math.max(0, hoverStroke - 4);
  });
  const looked = new Map<string, number>();
  const waved = new Map<string, number>();
  let tickAt = 0;
  app.everyFrame((dt, now) => {
    // Stroking Pip with a fingertip.
    const pip = life.pip.object;
    if (pip && !desk()) {
      pip.getWorldPosition(tmp).add(head.set(0, 0.07, 0));
      for (const s of SIDES) {
        const h = hands.get(s);
        if (!h.tracked) continue;
        if (h.indexTip.distanceTo(tmp) < 0.08) {
          strokeDist += h.indexTip.distanceTo(lastTip);
          if (strokeDist > 0.12 && now - lastStroke > 2000) {
            strokeDist = 0;
            lastStroke = now;
            puff();
          }
        }
        lastTip.copy(h.indexTip);
      }
    }
    // Residents you look at for a moment turn and wave (not while a scene plays).
    if (now - tickAt < 200) return;
    tickAt = now;
    if (busy() || app.store.phase.peek() !== 'free') return;
    readHead();
    for (const r of mind.state?.residents ?? []) {
      const o = life.objectOf?.(r.id);
      if (!o) continue;
      o.getWorldPosition(tmp).add(new Vector3(0, 0.5, 0));
      const d = tmp.distanceTo(head);
      const dir = tmp.sub(head).normalize();
      const on = d < 10 && dir.dot(fwd) > Math.cos((d < 4 ? 12 : 7) * (Math.PI / 180));
      const t = on ? (looked.get(r.id) ?? 0) + 0.2 : 0;
      looked.set(r.id, t);
      if (t > 0.8 && now - (waved.get(r.id) ?? -1e9) > 40000) {
        waved.set(r.id, now);
        life.face?.(r.id);
        life.emote(r.id, 'wave');
      }
    }
    // The slips flutter a little in the wind.
    for (const s of slips) {
      const home = s.mesh.userData.home as Vector3;
      if (!home) continue;
      s.mesh.rotation.z = Math.sin(now / 600 + (s.mesh.userData.phase as number)) * 0.12;
      s.mesh.rotation.y = Math.sin(now / 900 + (s.mesh.userData.phase as number)) * 0.2;
    }
    // A fingertip on a slip reads it.
    if (!desk() && slips.length && !reading) {
      for (const sd of SIDES) {
        const h = hands.get(sd);
        if (h.tracked && slips.some((s) => s.mesh.position.distanceTo(h.indexTip) < 0.09)) {
          void readNote();
          break;
        }
      }
    }
    void dt;
  });

  const delights: Delights = { lantern, star, readNote, refreshNotes };
  registerTest('lantern', () => lantern());
  registerTest('star', () => star());
  registerTest('readNote', () => readNote());
  registerTest('note', async () => {
    const m = mind as { state: { mail?: MailItem[] } };
    m.state.mail = [...(m.state.mail ?? []), { id: `m-test-${Date.now()}`, at: Date.now(), from: 'Tamsin Rue', fromIsland: 'Kettle Key', kind: 'note', text: 'We saw your lights last night. They looked like a kettle on a shelf. Wave if you see ours.' }];
    refreshNotes();
    return true;
  });
  registerTest('puff', () => puff());
  registerDebug('delights', delights);
  return delights;
}
