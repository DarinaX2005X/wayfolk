/**
 * Plays the palette through Web Audio.
 *
 * Every sound is rendered by the pure code in render.ts into a buffer, so what a test
 * measures is what the browser plays. The graph is small and linear:
 *
 *   voice (buffer -> gain -> panner) --> voice bus --\
 *   loop  (buffer -> low-pass -> gain) -> voice bus ---> master (-14 dB) -> output
 *   comb tooth (buffer -> gain) -------> melody bus --/
 *
 * Rules from feel.md live here: silent until the first gesture, a pitch move of up to
 * 3 % on every play, three voices plus the melody, a low master gain, nothing while the
 * page is hidden or the app is paused. There is no limiter: the levels are budgeted so
 * that three voices and the fullest melody stay under -1 dBFS (tests/feel/mix.test.ts).
 */
import type { Vector3 } from '@iwsdk/core';
import type { Tune } from './scale';
import { SCALE_HZ, stepSeconds } from './scale';
import { nearestTooth } from './comb';
import { LOOPS, LOOP_NAMES, PALETTE, SOUND_NAMES, type LoopName, type SoundName } from './palette';
import {
  LOOP_Q,
  MASTER_GAIN,
  MAX_VOICES,
  PITCH_JITTER,
  SAMPLE_RATE,
  TUNE_GAIN,
  renderLoopBuffer,
  renderPaper,
  renderTooth,
  voiceGain,
} from './render';

export type PlayOptions = { at?: Vector3; pitch?: number; gain?: number };

export type EngineOptions = {
  /** Makes the audio context. Returns null where the platform has no Web Audio. */
  context?: () => BaseAudioContext | null;
  /** Source of the per-play variation, 0…1. */
  random?: () => number;
};

type Voice = {
  rank: number;
  endsAt: number;
  gain: GainNode;
  exit: AudioNode;
  sources: AudioBufferSourceNode[];
};

type LoopVoice = Voice & { name: LoopName; filter: BiquadFilterNode; touched: number };

type Session = { done: boolean; tick: ReturnType<typeof setTimeout> | null; steps: Set<ReturnType<typeof setTimeout>> };

/** Seconds between `play` of a melody and its first note. */
const LEAD = 0.08;
/** Notes are handed to the audio clock this far ahead, so a late timer cannot delay them. */
const AHEAD = 0.2;
/** How often the melody looks for notes to hand over, milliseconds. */
const TICK_MS = 50;
/** A loop nobody has updated for this long fades out by itself: the hand has stopped. */
const LOOP_HOLD = 0.25;
/** Stress-free pitch range for `opts.pitch`. */
const PITCH_MIN = 0.25;
const PITCH_MAX = 4;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const wall = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function defaultContext(): BaseAudioContext | null {
  const g = globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor({ latencyHint: 'interactive' }) : null;
}

export class SoundEngine {
  private readonly make: () => BaseAudioContext | null;
  private readonly random: () => number;
  private ctx: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private tuneBus: GainNode | null = null;
  private unlocked = false;
  private muted = false;
  private paused = false;
  private hidden = false;
  private readonly samples = new Map<string, Float32Array>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly takeAt = new Map<SoundName, number>();
  private voices: Voice[] = [];
  private readonly loops = new Map<LoopName, LoopVoice>();
  private readonly ringing = new Map<number, { src: AudioBufferSourceNode; gain: GainNode; at: number }>();
  private session: Session | null = null;
  private warming = false;
  private slept = 0;
  private sleepAt: number | null = null;
  private readonly heard = new Float64Array(6).fill(NaN);

  constructor(o: EngineOptions = {}) {
    this.make = o.context ?? defaultContext;
    this.random = o.random ?? Math.random;
  }

  // ------------------------------------------------------------ state

  /** Call from a user gesture. Until then nothing sounds; calling it again is harmless. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = this.make();
      } catch {
        this.ctx = null;
      }
      if (!this.ctx) return;
      const ctx = this.ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
      this.master.connect(ctx.destination);
      this.voiceBus = ctx.createGain();
      this.voiceBus.connect(this.master);
      this.tuneBus = ctx.createGain();
      this.tuneBus.gain.value = TUNE_GAIN;
      this.tuneBus.connect(this.master);
    }
    this.unlocked = true;
    this.sync();
    this.warm();
  }

  /** True once a gesture has unlocked sound and the context is not held back. */
  get live(): boolean {
    return this.unlocked && this.ctx !== null && !this.asleep;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    const ctx = this.ctx;
    if (ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, ctx.currentTime, 0.015);
    if (m) for (const l of [...this.loops.values()]) this.endLoop(l);
    else this.warm();
  }

  /** App pause (headset taken off, system menu). Sound stops where it is. */
  suspend(): void {
    this.setAsleep(true, this.hidden);
  }

  resume(): void {
    this.setAsleep(false, this.hidden);
  }

  /** The page became hidden or visible. A hidden page never sounds. */
  setHidden(hidden: boolean): void {
    this.setAsleep(this.paused, hidden);
  }

  private get asleep(): boolean {
    return this.paused || this.hidden;
  }

  private setAsleep(paused: boolean, hidden: boolean): void {
    const was = this.asleep;
    this.paused = paused;
    this.hidden = hidden;
    const is = this.asleep;
    if (is && !was) this.sleepAt = wall();
    if (!is && was && this.sleepAt !== null) {
      this.slept += wall() - this.sleepAt;
      this.sleepAt = null;
    }
    this.sync();
  }

  private sync(): void {
    const ctx = this.ctx as (BaseAudioContext & { suspend?: () => Promise<void>; resume?: () => Promise<void> }) | null;
    if (!ctx || !this.unlocked) return;
    try {
      const done = this.asleep ? ctx.suspend?.() : ctx.resume?.();
      done?.catch(() => undefined);
    } catch {
      // A context that cannot change state (closed, offline) keeps playing what it has.
    }
  }

  /** Wall clock in seconds that stands still while the app is paused or hidden. */
  private stillClock(): number {
    return ((this.sleepAt ?? wall()) - this.slept) / 1000;
  }

  /** Where the ears are. Called every frame by the app, so it only writes on change. */
  listener(position: Vector3, forward: Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const h = this.heard;
    const same =
      Math.abs(h[0] - position.x) < 1e-3 &&
      Math.abs(h[1] - position.y) < 1e-3 &&
      Math.abs(h[2] - position.z) < 1e-3 &&
      Math.abs(h[3] - forward.x) < 1e-3 &&
      Math.abs(h[4] - forward.y) < 1e-3 &&
      Math.abs(h[5] - forward.z) < 1e-3;
    if (same) return;
    h[0] = position.x;
    h[1] = position.y;
    h[2] = position.z;
    h[3] = forward.x;
    h[4] = forward.y;
    h[5] = forward.z;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = h[0];
      l.positionY.value = h[1];
      l.positionZ.value = h[2];
      l.forwardX.value = h[3];
      l.forwardY.value = h[4];
      l.forwardZ.value = h[5];
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(h[0], h[1], h[2]);
      l.setOrientation(h[3], h[4], h[5], 0, 1, 0);
    }
  }

  // ------------------------------------------------------------ buffers

  private render(key: string): Float32Array {
    let data = this.samples.get(key);
    if (data) return data;
    const [kind, name, n] = key.split('|');
    if (kind === 'paper') data = renderPaper(name as SoundName, SAMPLE_RATE, Number(n), 1);
    else if (kind === 'calm') data = renderPaper(name as SoundName, SAMPLE_RATE, 0, Number(n));
    else if (kind === 'loop') data = renderLoopBuffer(name as LoopName, SAMPLE_RATE);
    else data = renderTooth(Number(name), SAMPLE_RATE);
    this.samples.set(key, data);
    return data;
  }

  private buffer(key: string): AudioBuffer {
    let buf = this.buffers.get(key);
    if (buf) return buf;
    const data = this.render(key);
    // Buffers keep the rate they were rendered at; the context resamples on playback.
    buf = this.ctx!.createBuffer(1, data.length, SAMPLE_RATE);
    buf.getChannelData(0).set(data);
    this.buffers.set(key, buf);
    return buf;
  }

  /**
   * Renders the palette ahead of use, one sound per idle slice, so that the first tap
   * does not pay for synthesis. Rendering needs no audio context and may start before
   * the first gesture.
   */
  warm(): void {
    if (this.warming || this.muted || typeof window === 'undefined') return;
    this.warming = true;
    const keys: string[] = [];
    for (const name of SOUND_NAMES) keys.push(`paper|${name}|0`);
    for (let n = 0; n < SCALE_HZ.length; n++) keys.push(`tooth|${n}`);
    for (const name of LOOP_NAMES) keys.push(`loop|${name}`);
    for (const name of SOUND_NAMES) for (let t = 1; t < PALETTE[name].takes; t++) keys.push(`paper|${name}|${t}`);
    const idle =
      (window as { requestIdleCallback?: (fn: () => void, o?: { timeout: number }) => void }).requestIdleCallback ??
      ((fn: () => void) => setTimeout(fn, 30));
    const next = (): void => {
      if (this.muted) {
        this.warming = false;
        return;
      }
      let key = keys.shift();
      while (key && this.samples.has(key)) key = keys.shift();
      if (!key) return;
      this.render(key);
      idle(next, { timeout: 500 });
    };
    idle(next, { timeout: 500 });
  }

  // ------------------------------------------------------------ voices

  private release(v: Voice): void {
    this.voices = this.voices.filter((x) => x !== v);
    try {
      v.exit.disconnect();
    } catch {
      // Already disconnected.
    }
  }

  private silence(v: Voice, now: number): void {
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setTargetAtTime(0, now, 0.004);
    for (const s of v.sources) {
      try {
        s.stop(now + 0.03);
      } catch {
        // Not started or already stopped.
      }
    }
  }

  /**
   * Finds room for a new voice. When all are busy, the one closest to its end among
   * those of the same or lower rank gives way; a small tick never cuts off a moment.
   */
  private claim(rank: number, now: number): boolean {
    for (const v of [...this.voices]) if (v.endsAt <= now) this.release(v);
    for (const l of [...this.loops.values()]) if (now - l.touched > LOOP_HOLD + 0.4) this.endLoop(l);
    if (this.voices.length < MAX_VOICES) return true;
    let victim: Voice | null = null;
    for (const v of this.voices) {
      if (v.rank <= rank && (!victim || v.endsAt < victim.endsAt)) victim = v;
    }
    if (!victim) return false;
    const loop = [...this.loops.values()].find((l) => l === victim);
    if (loop) this.endLoop(loop);
    else {
      this.silence(victim, now);
      this.release(victim);
    }
    return true;
  }

  private nextTake(name: SoundName): number {
    const takes = PALETTE[name].takes;
    if (takes <= 1) return 0;
    const prev = this.takeAt.get(name) ?? Math.floor(this.random() * takes);
    // Any take but the previous one, so that a repeat is never the same noise.
    const take = (prev + 1 + Math.floor(this.random() * (takes - 1))) % takes;
    this.takeAt.set(name, take);
    return take;
  }

  /**
   * One sound of the palette. `pitch` multiplies its frequency (for sounds with comb
   * notes it moves the note), `gain` its level, `at` places it in the room.
   * `stretch` is the length scale of the paper part for "Less motion" variants.
   */
  play(name: SoundName, opts?: PlayOptions, stretch = 1): void {
    const ctx = this.ctx;
    const patch = PALETTE[name];
    if (!ctx || !patch || !this.live || this.muted || !this.voiceBus) return;
    const now = ctx.currentTime;
    if (!this.claim(patch.rank, now)) return;

    const pitch = clamp(opts?.pitch ?? 1, PITCH_MIN, PITCH_MAX);
    const jitter = 1 + (this.random() * 2 - 1) * PITCH_JITTER;
    // The level only ever varies downward, so the voice stays inside its mix budget.
    const level = voiceGain(name, opts?.gain ?? 1) * (0.92 + 0.08 * this.random());

    const gain = ctx.createGain();
    gain.gain.value = level;
    let exit: AudioNode = gain;
    if (opts?.at) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 0.5;
      p.rolloffFactor = 1;
      p.maxDistance = 10;
      if (p.positionX) {
        p.positionX.value = opts.at.x;
        p.positionY.value = opts.at.y;
        p.positionZ.value = opts.at.z;
      } else {
        p.setPosition(opts.at.x, opts.at.y, opts.at.z);
      }
      gain.connect(p);
      exit = p;
    }
    exit.connect(this.voiceBus);

    const voice: Voice = { rank: patch.rank, endsAt: now, gain, exit, sources: [] };
    const tail: { src: AudioBufferSourceNode | null } = { src: null };
    const add = (buf: AudioBuffer, rate: number, at: number, into: AudioNode): void => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(into);
      src.start(now + at);
      voice.sources.push(src);
      const end = now + at + buf.duration / rate;
      if (end >= voice.endsAt) {
        voice.endsAt = end;
        tail.src = src;
      }
    };

    const key = stretch === 1 ? `paper|${name}|${this.nextTake(name)}` : `calm|${name}|${stretch}`;
    add(this.buffer(key), (patch.comb ? 1 : pitch) * jitter, 0, gain);
    for (const hit of patch.comb?.(pitch) ?? []) {
      const { note, rate } = nearestTooth(hit.hz);
      const g = ctx.createGain();
      g.gain.value = hit.gain;
      g.connect(gain);
      // A tooth keeps its tuning: only a few cents of drift, never the 3 % of paper.
      add(this.buffer(`tooth|${note}`), rate * (1 + (this.random() * 2 - 1) * 0.0015), hit.at, g);
    }

    this.voices.push(voice);
    if (tail.src) tail.src.onended = () => this.release(voice);
  }

  // ------------------------------------------------------------ loops

  /**
   * A sound that lasts as long as the hand moves. Call it on every move with the
   * current intensity (0…1, from hand speed); it fades by itself when the calls stop.
   */
  loop(name: LoopName, on: boolean, intensity = 0.6): void {
    const ctx = this.ctx;
    const patch = LOOPS[name];
    if (!ctx || !patch) return;
    let l = this.loops.get(name);
    if (!on || this.muted || !this.live || !this.voiceBus) {
      if (l) this.endLoop(l);
      return;
    }
    const now = ctx.currentTime;
    const shape = patch.shape(clamp(intensity, 0, 1));
    if (!l) {
      if (!this.claim(2, now)) return;
      const src = ctx.createBufferSource();
      src.buffer = this.buffer(`loop|${name}`);
      src.loop = true;
      src.playbackRate.value = shape.rate;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = shape.cutoff;
      filter.Q.value = 20 * Math.log10(LOOP_Q);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.voiceBus);
      src.start(now, this.random() * src.buffer.duration);
      l = { name, rank: 2, endsAt: Infinity, gain, exit: gain, sources: [src], filter, touched: now };
      this.loops.set(name, l);
      this.voices.push(l);
    }
    l.touched = now;
    l.gain.gain.cancelScheduledValues(now);
    l.gain.gain.setTargetAtTime(shape.gain, now, 0.03);
    l.gain.gain.setTargetAtTime(0, now + LOOP_HOLD, 0.06);
    l.filter.frequency.setTargetAtTime(shape.cutoff, now, 0.03);
    l.sources[0].playbackRate.setTargetAtTime(shape.rate, now, 0.05);
  }

  private endLoop(l: LoopVoice): void {
    const now = this.ctx!.currentTime;
    this.loops.delete(l.name);
    this.voices = this.voices.filter((v) => v !== l);
    l.gain.gain.cancelScheduledValues(now);
    l.gain.gain.setTargetAtTime(0, now, 0.02);
    const src = l.sources[0];
    src.onended = () => {
      try {
        l.exit.disconnect();
      } catch {
        // Already disconnected.
      }
    };
    try {
      src.stop(now + 0.15);
    } catch {
      // Already stopped.
    }
  }

  // ------------------------------------------------------------ melody

  /** Plucks one tooth on the melody bus. A tooth that still rings is damped first, as on a real comb. */
  private pluck(note: number, when: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.tuneBus || !Number.isInteger(note) || note < 0 || note >= SCALE_HZ.length) return;
    const prev = this.ringing.get(note);
    if (prev) {
      prev.gain.gain.setTargetAtTime(0, when, 0.012);
      try {
        prev.src.stop(when + 0.08);
      } catch {
        // Already stopped.
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = this.buffer(`tooth|${note}`);
    src.playbackRate.value = 1 + (this.random() * 2 - 1) * 0.0015;
    const gain = ctx.createGain();
    gain.gain.value = 0.85 + 0.15 * this.random();
    src.connect(gain);
    gain.connect(this.tuneBus);
    src.start(when);
    const entry = { src, gain, at: when };
    this.ringing.set(note, entry);
    src.onended = () => {
      if (this.ringing.get(note) === entry) this.ringing.delete(note);
      try {
        gain.disconnect();
      } catch {
        // Already disconnected.
      }
    };
  }

  /**
   * Plays a short phrase once. `onStep(i)` fires as step `i` sounds, for the
   * visible beat of the phrase; it fires on time even when sound is locked or muted.
   * Starting a melody stops the one before it.
   */
  tunePlay(t: Tune, onStep?: (i: number) => void): void {
    this.tuneStop();
    const steps = t?.steps;
    if (!Array.isArray(steps) || steps.length === 0) return;
    const asked = stepSeconds(t.bpm);
    const step = Number.isFinite(asked) && asked > 0 ? Math.max(0.05, asked) : 0.25;
    const ctx = this.ctx;
    const audible = ctx !== null && this.live;
    const clock = audible ? () => ctx.currentTime : () => this.stillClock();
    const t0 = clock() + LEAD;
    const session: Session = { done: false, tick: null, steps: new Set() };
    this.session = session;
    let i = 0;
    const tick = (): void => {
      if (session.done) return;
      const now = clock();
      while (i < steps.length && t0 + i * step < now + AHEAD) {
        const index = i++;
        const at = t0 + index * step;
        if (audible && !this.muted && Array.isArray(steps[index])) {
          for (const n of steps[index]) this.pluck(n, Math.max(at, now));
        }
        const id = setTimeout(
          () => {
            session.steps.delete(id);
            if (session.done) return;
            if (index === steps.length - 1) {
              session.done = true;
              if (this.session === session) this.session = null;
            }
            onStep?.(index);
          },
          Math.max(0, (at - now) * 1000),
        );
        session.steps.add(id);
      }
      session.tick = i < steps.length ? setTimeout(tick, TICK_MS) : null;
    };
    tick();
  }

  /** Stops handing out notes. Teeth already plucked ring out, as when a crank stops. */
  tuneStop(): void {
    const s = this.session;
    if (!s) return;
    s.done = true;
    if (s.tick !== null) clearTimeout(s.tick);
    for (const id of s.steps) clearTimeout(id);
    s.steps.clear();
    this.session = null;
    const ctx = this.ctx;
    if (!ctx) return;
    // Notes handed over ahead of time but not yet sounding are taken back.
    for (const [note, r] of [...this.ringing]) {
      if (r.at > ctx.currentTime) {
        this.ringing.delete(note);
        r.src.onended = null;
        try {
          r.gain.disconnect();
          r.src.stop();
        } catch {
          // Already stopped.
        }
      }
    }
  }

  /** One note of the scale (0…7) for the strip preview. */
  tuneNote(n: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.live || this.muted) return;
    this.pluck(n, ctx.currentTime);
  }

  /** Length of a sound in seconds, its comb notes included. */
  lengthOf(name: SoundName): number {
    let end = this.render(`paper|${name}|0`).length / SAMPLE_RATE;
    for (const hit of PALETTE[name].comb?.(1) ?? []) {
      const { note, rate } = nearestTooth(hit.hz);
      end = Math.max(end, hit.at + this.render(`tooth|${note}`).length / SAMPLE_RATE / rate);
    }
    return end;
  }

  /** Number of voices sounding now, loops included; the melody is not counted. */
  get voiceCount(): number {
    const now = this.ctx?.currentTime ?? 0;
    return this.voices.filter((v) => v.endsAt > now).length;
  }
}
