/**
 * The evening on the island: a story by the fire and a concert at sunset.
 *
 *   story    the campfire is lit, a resident sits by it and tells the next chapter of
 *            their story; it plays in the clouds in front of the person as a paper
 *            silhouette theatre (src/theatre/), with the teller's voice from the fire,
 *            the line on a paper strip and a quiet music box. A pinch (or "Next") hurries
 *            a line, "That's enough for tonight" ends it.
 *   concert  the musician (or anyone with an instrument) plays a tune made for this
 *            evening (src/feel/music.ts); the island answers through world.setPulse, the
 *            others dance, the birds circle, notes rise from the player.
 *
 * Both work the same in the headset and in a page; in a page the view turns to the stage
 * or the player (src/app/desk/guide.ts) and the page offers the two tags.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, CanvasTexture, Points, PointsMaterial, SRGBColorSpace, Vector3, type Object3D } from '@iwsdk/core';
import { say as caption } from '../feel/captions';
import { createMusic, songFor, type MusicRun } from '../feel/music';
import { directChapter, nextChapterNumber } from '../mind/chapters';
import type { Chapter, Resident } from '../mind/types';
import { createStage, STAGE, type Stage } from '../theatre/stage';
import { drawKind } from '../theatre/silhouettes';
import type { App } from './boot/world';
import { registerDebug, registerTest } from './debug';
import type { Guide } from './desk/guide';
import type { Hands } from './hands/hands';
import type { Modules } from './modules';
import { EYE_HEIGHT } from './rig';

export type Evening = {
  /** A resident (or the one whose turn it is) tells the next chapter by the fire. */
  story(id?: string): Promise<void>;
  /** The musician (or anyone) plays for the sunset. */
  concert(id?: string): Promise<void>;
  /** The light turns to dusk over a few seconds (the evening offer); never back from night. */
  dusk(): void;
  /** Hurries the story to its next line. */
  next(): void;
  /** Ends what is playing. */
  stop(): void;
  readonly playing: 'story' | 'concert' | null;
  readonly stage: Stage;
};

export const EVENING_LINES = {
  gather: (name: string) => `Gather round. ${name} has a story tonight.`,
  nobody: 'Nobody lives here yet to tell a story. Ask a traveler to stay first.',
  thanks: (name: string) => `Thank you, ${name}. Sleep well, everyone.`,
  concert: (name: string) => `${name} wants to play something for the sunset.`,
  applause: (name: string) => `That was lovely, ${name}. The lanterns liked it too.`,
  tellerDone: 'That is all for tonight.',
} as const;

type WorldExtras = {
  campfire?: (on: boolean) => void;
  fire?: Vector3;
  setPulse?: (level: number, hue?: number) => void;
  benches?: () => unknown[];
};

type MindExtras = {
  chapter?: (id: string) => Promise<Chapter>;
  toldChapter?: (id: string) => Promise<void>;
};

type LifeExtras = {
  flockCircle?: (center: Vector3 | null, radius?: number) => void;
  setBeat?: (bpm: number) => void;
};

/** A soft glowing note sprite, drawn once. */
function noteTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const halo = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  halo.addColorStop(0, 'rgba(255,230,170,0.9)');
  halo.addColorStop(1, 'rgba(255,200,120,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#fff6e0';
  drawKind(g, 'notes', 12, 14, 36);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function createEvening(app: App, mods: Modules, guide: Guide, hands: Hands): Evening {
  const { world, life, mind } = mods;
  const W = world as typeof world & WorldExtras;
  const M = mind as typeof mind & MindExtras;
  const L = life as typeof life & LifeExtras;
  const desk = (): boolean => app.store.mode.peek() === 'desk';
  const stage = createStage({ parent: app.roots.fx, lessMotion: () => app.store.settings.peek().lessMotion, overlay: () => desk() });
  let playing: 'story' | 'concert' | null = null;
  let music: MusicRun | null = null;
  let stopNow: (() => void) | null = null;
  const pace = (): number => Math.max(0.05, app.store.pace.peek());
  const wait = (ms: number): Promise<void> => new Promise((r) => app.clock.timers.set(r, ms * pace()));
  const within = <T>(p: Promise<T> | T, ms: number, fallback: T): Promise<T> => Promise.race([Promise.resolve(p), wait(ms).then(() => fallback)]).catch(() => fallback);

  app.everyFrame((dt) => stage.update(dt > 1 ? dt / 1000 : dt));

  // The light of the evening: the sky slides to an hour over a few seconds. It only moves
  // forward into the evening, so a real night stays night.
  let skyOff: (() => void) | null = null;
  const skyHour = (): number => (world as { sky?: { hour?: number } }).sky?.hour ?? app.clock.wall().getHours();
  const skyTo = (hour: number, seconds = 4): void => {
    const from = skyHour();
    const evening = from >= hour - 0.05 || from < 4.5;
    if (evening) return;
    skyOff?.();
    const t0 = app.clock.now();
    const date = new Date(app.clock.wall());
    const less = app.store.settings.peek().lessMotion;
    const off = app.everyFrame((_dt, now) => {
      const k = less ? 1 : Math.min(1, (now - t0) / (seconds * 1000));
      const e = k * k * (3 - 2 * k);
      const h = from + (hour - from) * e;
      date.setHours(Math.floor(h), Math.floor((h % 1) * 60), Math.floor((((h % 1) * 60) % 1) * 60), 0);
      try {
        world.setTime(date);
      } catch {
        // The sky keeps its hour.
      }
      if (k >= 1) {
        off();
        skyOff = null;
      }
    });
    skyOff = off;
  };

  const residents = (): Resident[] => (mind.state?.residents ?? []).filter((r) => !r.trip && life.objectOf?.(r.id));
  const audio = (): AudioContext | null => (life as { audio?: AudioContext | null }).audio ?? null;
  const head = new Vector3();
  const fwd = new Vector3();

  /** The fire, or a point a little in front of the seat. */
  const firePoint = (): Vector3 => {
    if (W.fire?.isVector3) return world.root.localToWorld(W.fire.clone());
    const seat = world.seat as { pos?: Vector3; meet?: Vector3 };
    if (seat.meet?.isVector3) return world.root.localToWorld(seat.meet.clone());
    return new Vector3(0, 0, -2);
  };
  const benchPoints = (): Vector3[] =>
    (W.benches?.() ?? [])
      .map((b) => {
        const p = (b as { pos?: Vector3 }).pos ?? (b as Vector3);
        return p?.isVector3 ? world.root.localToWorld(p.clone()) : null;
      })
      .filter((v): v is Vector3 => !!v);

  /** Hangs the stage in the clouds in front of where the person looks. */
  const placeStage = (): Vector3 => {
    const cam = app.world.camera;
    cam.updateMatrixWorld();
    cam.getWorldPosition(head);
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    // In a headset the stage hangs 5.6 m off, its screen a little above the eyes; in a page
    // it stands back far enough for the whole proscenium to fit the width of the view.
    let d = 5.6;
    if (desk()) {
      const lens = cam as unknown as { aspect?: number; fov?: number };
      const halfH = Math.atan(Math.tan(((lens.fov ?? 60) * Math.PI) / 360) * (lens.aspect ?? 1.6));
      d = Math.max(6.5, Math.min(9.5, 4.0 / Math.tan(halfH * 0.92)));
    }
    stage.group.position.set(head.x + fwd.x * d, head.y - 0.3, head.z + fwd.z * d);
    stage.group.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
    stage.group.updateMatrixWorld(true);
    return stage.group.position.clone().add(new Vector3(0, STAGE.height * 0.45, 0));
  };

  const gather = async (teller: Resident): Promise<void> => {
    W.campfire?.(true);
    const fire = firePoint();
    const benches = benchPoints();
    // The teller by the fire, the others on the benches around it.
    const others = residents().filter((r) => r.id !== teller.id);
    const seatFor = (i: number): Vector3 => benches[i + 1] ?? fire.clone().add(new Vector3(Math.cos(i * 2.1) * 1.6, 0, Math.sin(i * 2.1) * 1.6));
    const walks: Promise<unknown>[] = [];
    walks.push(Promise.resolve(life.walkTo(teller.id, seatFor(0), { speed: 1.6 })));
    others.slice(0, 3).forEach((r, i) => walks.push(Promise.resolve(life.walkTo(r.id, seatFor(i + 1), { speed: 1.4 }))));
    await within(Promise.all(walks), 9000, undefined);
    for (const r of [teller, ...others.slice(0, 3)]) {
      life.face?.(r.id, fire);
      life.emote(r.id, 'sit');
    }
    life.face?.(teller.id);
  };

  const release = (ids: string[]): void => {
    for (const id of ids) life.emote(id, 'idle');
  };

  const evening: Evening = {
    get playing() {
      return playing;
    },
    stage,
    async story(id) {
      if (playing) return;
      const list = residents();
      const teller = list.find((r) => r.id === id) ?? [...list].sort((a, b) => (a.chapters ?? 0) - (b.chapters ?? 0))[0];
      if (!teller) {
        await life.pip.say(EVENING_LINES.nobody);
        return;
      }
      playing = 'story';
      app.store.show.value = 'story';
      skyTo(20.4, 5);
      const ids = residents().map((r) => r.id);
      const ctx = audio();
      let run: MusicRun | null = null;
      try {
        const writing = within(M.chapter ? M.chapter(teller.id) : Promise.resolve(directChapter(teller, nextChapterNumber(teller))), 20000, directChapter(teller, nextChapterNumber(teller)));
        caption({ source: 'Pip', text: EVENING_LINES.gather(teller.name) });
        await Promise.all([within(Promise.resolve(life.pip.say(EVENING_LINES.gather(teller.name))), 6000, undefined), gather(teller)]);
        const chapter = await writing;
        const centre = placeStage();
        if (desk()) guide.frame(() => centre, { lift: -0.25 });
        if (ctx) {
          void ctx.resume?.();
          run = createMusic(ctx, ctx.destination).play(songFor(Date.now() % 100000, teller.trade, 'story'), { volume: 0.22 });
        }
        const done = stage.play(chapter, {
          name: teller.name,
          onBeat: (_i, line) => {
            caption({ source: teller.name, text: line });
            void life.say(teller.id, line, { bubble: false, volume: 0.85, hold: 0 });
            life.emote(teller.id, 'talk');
          },
        });
        stopNow = () => stage.stop();
        await done;
        run?.stop();
        run = null;
        await within(M.toldChapter?.(teller.id), 4000, undefined);
        if (!M.toldChapter) teller.chapters = (teller.chapters ?? 0) + 1;
        caption({ source: 'Pip', text: EVENING_LINES.thanks(teller.name) });
        await within(Promise.resolve(life.pip.say(EVENING_LINES.thanks(teller.name))), 6000, undefined);
      } finally {
        run?.stop();
        stopNow = null;
        playing = null;
        app.store.show.value = null;
        if (desk()) guide.frame(null);
        release(ids);
        try {
          life.startDaily();
        } catch {
          // Daily life resumes on its own later.
        }
      }
    },
    async concert(id) {
      if (playing) return;
      const list = residents();
      const player = list.find((r) => r.id === id) ?? list.find((r) => r.trade === 'musician') ?? list[0];
      if (!player) {
        await life.pip.say(EVENING_LINES.nobody);
        return;
      }
      const ctx = audio();
      playing = 'concert';
      app.store.show.value = 'concert';
      skyTo(19.2, 4);
      const ids = list.map((r) => r.id);
      let notes: Points | null = null;
      let off: (() => void) | null = null;
      try {
        caption({ source: 'Pip', text: EVENING_LINES.concert(player.name) });
        void within(Promise.resolve(life.pip.say(EVENING_LINES.concert(player.name))), 6000, undefined);
        // The player stands where everyone can see, the others around.
        const spot = firePoint();
        await within(Promise.resolve(life.walkTo(player.id, spot, { speed: 1.6 })), 8000, undefined);
        life.face?.(player.id);
        const playerObj = (): Object3D | null | undefined => life.objectOf?.(player.id);
        if (desk()) guide.frame(guide.of(playerObj, 0.6), { lift: 0.3 });
        const others = list.filter((r) => r.id !== player.id);
        others.forEach((r, i) => {
          const a = (i / Math.max(1, others.length)) * Math.PI * 1.2 + 0.9;
          void life.walkTo(r.id, spot.clone().add(new Vector3(Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2)), { speed: 1.4 });
        });
        if (!ctx) {
          await wait(4000);
          return;
        }
        void ctx.resume?.();
        const song = songFor(Math.floor(Date.now() / 86_400_000) * 31 + player.id.length, player.trade, 'concert');
        // The tune comes from where the player stands.
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.refDistance = 2;
        const p = new Vector3();
        playerObj()?.getWorldPosition(p);
        panner.positionX.value = p.x;
        panner.positionY.value = p.y + 0.6;
        panner.positionZ.value = p.z;
        panner.connect(ctx.destination);
        L.setBeat?.(song.bpm);
        L.flockCircle?.(p.clone().setY(p.y + 3.2), 3.5);
        life.emote(player.id, 'play');
        // Notes rise from the player on each note of the tune.
        const COUNT = 28;
        const geo = new BufferGeometry();
        const pos = new Float32Array(COUNT * 3);
        geo.setAttribute('position', new BufferAttribute(pos, 3));
        const born = new Float32Array(COUNT).fill(-10);
        const drift = new Float32Array(COUNT * 2);
        notes = new Points(geo, new PointsMaterial({ map: noteTexture(), size: 0.32, transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false, opacity: 0.95 }));
        notes.frustumCulled = false;
        app.roots.fx.add(notes);
        let slot = 0;
        let hue = 0.08;
        const t0 = app.clock.now();
        music = createMusic(ctx, panner).play(song, {
          volume: 0.85,
          onNote: (n) => {
            if (n.voice !== 'lead') return;
            const i = slot++ % COUNT;
            born[i] = (app.clock.now() - t0) / 1000;
            drift[i * 2] = (Math.random() - 0.5) * 0.6;
            drift[i * 2 + 1] = (Math.random() - 0.5) * 0.6;
          },
          onBar: (bar) => {
            hue = 0.06 + ((bar % 8) / 8) * 0.12;
            // Everyone else dances; now and then someone hops.
            for (const r of others) life.emote(r.id, bar % 4 === 3 ? 'excited' : 'dance');
            if (bar % 2 === 0) life.emote(player.id, 'play');
          },
        });
        stopNow = () => music?.stop();
        off = app.everyFrame(() => {
          if (!music || !notes) return;
          const level = music.level();
          W.setPulse?.(level, hue);
          playerObj()?.getWorldPosition(p);
          const now = (app.clock.now() - t0) / 1000;
          for (let i = 0; i < COUNT; i += 1) {
            const age = now - born[i];
            if (age < 0 || age > 3.2) {
              pos[i * 3 + 1] = -999;
              continue;
            }
            pos[i * 3] = p.x + drift[i * 2] * age + Math.sin(age * 3 + i) * 0.08;
            pos[i * 3 + 1] = p.y + 0.9 + age * 0.55;
            pos[i * 3 + 2] = p.z + drift[i * 2 + 1] * age;
          }
          geo.attributes.position.needsUpdate = true;
          (notes.material as PointsMaterial).opacity = 0.6 + level * 0.4;
        });
        await music.done;
        caption({ source: 'Pip', text: EVENING_LINES.applause(player.name) });
        for (const r of others) life.emote(r.id, 'happy');
        await within(Promise.resolve(life.pip.say(EVENING_LINES.applause(player.name))), 6000, undefined);
      } finally {
        off?.();
        music?.stop();
        music = null;
        stopNow = null;
        W.setPulse?.(0);
        L.flockCircle?.(null);
        if (notes) {
          notes.removeFromParent();
          notes.geometry.dispose();
          (notes.material as PointsMaterial).map?.dispose();
          (notes.material as PointsMaterial).dispose();
        }
        playing = null;
        app.store.show.value = null;
        if (desk()) guide.frame(null);
        release(ids);
        try {
          life.startDaily();
        } catch {
          // Daily life resumes on its own later.
        }
      }
    },
    dusk() {
      skyTo(18.9, 4.5);
    },
    next() {
      if (playing === 'story') stage.next();
    },
    stop() {
      stopNow?.();
    },
  };

  // A pinch hurries the story along, like any long scene.
  hands.onPinch((_s, down) => {
    if (down && playing === 'story') stage.next();
  });

  registerTest('story', (id?: string) => evening.story(id));
  registerTest('concert', (id?: string) => evening.concert(id));
  registerTest('storyNext', () => evening.next());
  registerTest('storyStop', () => evening.stop());
  registerDebug('evening', evening);
  void EYE_HEIGHT;
  return evening;
}
