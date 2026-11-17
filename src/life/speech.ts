// Lines spoken by Pip and residents: a paper bubble above the speaker, a babble voice
// from the speaker's position, the mouth or beak driven by the same syllable plan.
import { Vector3, type Object3D } from '@iwsdk/core';
import type { LifeAudio } from './audio';
import { setPannerPos } from './audio';
import { Bubble } from './bubble';
import type { SayOptions } from './types';
import { mouthAt, playBabble, syllablePlan, type BabbleHandle, type VoiceProfile } from './voice';

export interface Speaker {
  id: string;
  name?: string;
  accent?: string;
  profile: VoiceProfile;
  /** Bubble tail point, world. */
  anchor(out: Vector3): Vector3;
  /** Where the voice comes from, world. */
  voicePos(out: Vector3): Vector3;
  setMouth(v: number): void;
  setTalking(on: boolean): void;
}

interface Line {
  speaker: Speaker;
  plan: ReturnType<typeof syllablePlan>;
  start: number;
  done: number;
  hold: number;
  babble: BabbleHandle | null;
  panner: PannerNode | null;
  resolve: () => void;
  finished: boolean;
}

const tA = new Vector3();

export class Speech {
  private lines: Line[] = [];
  private bubbles = new Map<string, Bubble>();
  private clock = 0;

  constructor(private audio: LifeAudio, private root: Object3D) {}

  say(speaker: Speaker, text: string, opts: SayOptions = {}): Promise<void> {
    // A new line from the same speaker replaces the old one.
    for (const l of this.lines) if (l.speaker.id === speaker.id && !l.finished) this.finish(l, 0);
    const plan = syllablePlan(text, speaker.profile);
    const readTime = Math.min(8, Math.max(1.2, 0.5 + text.length * 0.03));
    const start = this.clock + 0.05;
    const done = start + Math.max(plan.duration + 0.25, readTime * 0.8);
    let babble: BabbleHandle | null = null;
    let panner: PannerNode | null = null;
    const ctx = this.audio.ensure();
    if (ctx && plan.syllables.length > 0) {
      this.audio.resume();
      panner = this.audio.panner(speaker.voicePos(tA), 'main', 1.2);
      if (panner) babble = playBabble(ctx, panner, plan, speaker.profile, opts.volume ?? 1);
    }
    if (opts.bubble !== false) {
      let b = this.bubbles.get(speaker.id);
      if (!b) {
        b = new Bubble();
        this.bubbles.set(speaker.id, b);
        this.root.add(b.mesh);
      }
      // The words come with the babble: they appear over the time the voice takes.
      b.show(text, { name: opts.name ?? speaker.name, accent: speaker.accent }, babble ? Math.max(0.5, plan.duration * 0.9) : Math.min(2.5, readTime * 0.5));
    }
    speaker.setTalking(true);
    return new Promise<void>((resolve) => {
      this.lines.push({ speaker, plan, start, done, hold: opts.hold ?? 6, babble, panner, resolve, finished: false });
    });
  }

  private finish(l: Line, hold: number): void {
    if (l.finished) return;
    l.finished = true;
    l.babble?.stop();
    const p = l.panner;
    if (p) setTimeout(() => p.disconnect(), 400);
    l.speaker.setMouth(0);
    l.speaker.setTalking(false);
    const b = this.bubbles.get(l.speaker.id);
    b?.hide(hold);
    l.resolve();
  }

  /** Hurry every line to its end (a pinch). */
  skip(): void {
    for (const l of this.lines) this.finish(l, Math.min(l.hold, 2.5));
    this.lines = [];
  }

  /** Stop and hide a speaker's line and bubble right away. */
  silence(id: string): void {
    for (const l of this.lines) if (l.speaker.id === id) this.finish(l, 0);
    this.bubbles.get(id)?.hide(0);
  }

  speaking(id: string): boolean {
    return this.lines.some((l) => l.speaker.id === id && !l.finished);
  }

  update(dt: number, head: Vector3, speakers: (id: string) => Speaker | undefined): number {
    this.clock += dt;
    for (const l of this.lines) {
      if (l.finished) continue;
      const t = this.clock - l.start;
      l.speaker.setMouth(t < l.plan.duration ? mouthAt(l.plan, t) : 0);
      if (l.panner) setPannerPos(l.panner, l.speaker.voicePos(tA));
      if (this.clock >= l.done) this.finish(l, l.hold);
    }
    this.lines = this.lines.filter((l) => !l.finished);
    let visible = 0;
    for (const [id, b] of this.bubbles) {
      const s = speakers(id);
      if (!s) {
        b.hide(0);
      }
      const anchor = s ? s.anchor(tA) : tA.set(0, -100, 0);
      if (b.update(dt, anchor, head)) visible++;
    }
    return visible;
  }

  dispose(): void {
    this.skip();
    for (const b of this.bubbles.values()) {
      b.mesh.removeFromParent();
      b.dispose();
    }
    this.bubbles.clear();
  }
}
