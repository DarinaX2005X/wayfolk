/**
 * Generated music for the sunset concert and the evening of stories, in the browser with
 * Web Audio: a pentatonic tune that is new every evening (seeded by the date and the
 * player), a soft bass and pad under it, a shaker and a soft drum when it is a concert.
 *
 * The tune is written in phrases (A A B A, four bars each) so it has a shape: steps
 * rather than leaps, a rise in B, every phrase coming home to the root or the fifth.
 * Each trade plays its own instrument (a fiddle, teacups, a kalimba...).
 *
 *   const music = createMusic(ctx, panner);
 *   const run = music.play(songFor(seed, 'musician'), { onNote, onBar });
 *   run.level();   // 0..1, how loud the music is right now (for lanterns and dancers)
 *   run.stop();
 */

export type Instrument = 'kalimba' | 'fiddle' | 'flute' | 'glass' | 'harp' | 'marimba' | 'musicbox';

export type Note = { at: number; dur: number; midi: number; vel: number; voice: 'lead' | 'bass' | 'pad' | 'drum' | 'shaker' };

export type Song = {
  seed: number;
  bpm: number;
  /** MIDI note of the key's root. */
  root: number;
  instrument: Instrument;
  /** Concert: drums and bass; story: a quiet music box under the voice. */
  style: 'concert' | 'story';
  notes: Note[];
  /** Length in seconds. */
  length: number;
  bars: number;
};

/** Which instrument each trade picks up. */
export const TRADE_INSTRUMENT: Record<string, Instrument> = {
  musician: 'fiddle',
  'tea-maker': 'glass',
  baker: 'marimba',
  storyteller: 'harp',
  stargazer: 'musicbox',
  gardener: 'flute',
  fisher: 'kalimba',
  tinkerer: 'musicbox',
  painter: 'harp',
  beekeeper: 'flute',
  'lighthouse-keeper': 'kalimba',
  cartographer: 'marimba',
};

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const PENTA = [0, 2, 4, 7, 9];
/** Chords as scale roots (semitones) for a gentle loop: I, vi, IV, V and friends. */
const PROGRESSIONS = [
  [0, 9, 5, 7],
  [0, 5, 9, 7],
  [0, 7, 9, 5],
  [5, 0, 7, 0],
];
const RHYTHMS: number[][] = [
  // eighths per bar (8), 1 = a note starts, 0 = rest or held
  [1, 0, 1, 0, 1, 1, 1, 0],
  [1, 0, 0, 1, 1, 0, 1, 0],
  [1, 1, 1, 0, 1, 0, 0, 0],
  [1, 0, 1, 1, 0, 1, 1, 0],
  [1, 0, 0, 0, 1, 0, 1, 1],
];

/** A song for this seed: tempo, key, tune, bass, pad and drums as a list of notes. */
export function songFor(seed: number, trade: string, style: 'concert' | 'story' = 'concert'): Song {
  const r = rng(seed * 2654435761 + 7);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length) % xs.length];
  const bpm = style === 'story' ? 66 + Math.floor(r() * 8) : 84 + Math.floor(r() * 18);
  const root = pick([57, 58, 60, 62, 63, 65]);
  const instrument = style === 'story' ? 'musicbox' : (TRADE_INSTRUMENT[trade] ?? 'kalimba');
  const prog = pick(PROGRESSIONS);
  const beat = 60 / bpm;
  const bar = beat * 4;
  const eighth = beat / 2;
  // Scale tones over two octaves, as indexes.
  const tones: number[] = [];
  for (let o = 0; o < 2; o += 1) for (const p of PENTA) tones.push(root + o * 12 + p);
  tones.push(root + 24);
  const notes: Note[] = [];
  const phraseA = writePhrase(r, tones, RHYTHMS, 4, 3, false);
  const phraseB = writePhrase(r, tones, RHYTHMS, 4, 6, true);
  const form = style === 'story' ? ['A', 'B', 'A', 'B', 'A', 'A', 'B', 'A'] : ['A', 'A', 'B', 'A', 'A', 'B', 'B', 'A'];
  const barsPerPhrase = 4;
  let barIndex = 0;
  form.forEach((name, fi) => {
    const phrase = name === 'A' ? phraseA : phraseB;
    // Each return of a phrase is varied a little: an ornament, a moved note.
    const vary = fi > 1 && r() < 0.6;
    for (const n of phrase) {
      let idx = n.idx;
      if (vary && r() < 0.18) idx = Math.max(0, Math.min(tones.length - 1, idx + (r() < 0.5 ? -1 : 1)));
      const at = (barIndex + n.bar) * bar + n.step * eighth;
      notes.push({ at, dur: n.len * eighth, midi: tones[idx] + (style === 'story' ? 12 : 0), vel: n.accent ? 0.9 : 0.62 + r() * 0.15, voice: 'lead' });
    }
    for (let b = 0; b < barsPerPhrase; b += 1) {
      const chord = prog[b % prog.length];
      const t = (barIndex + b) * bar;
      const low = root - 12 + chord;
      if (style === 'concert') {
        notes.push({ at: t, dur: beat * 1.6, midi: low, vel: 0.8, voice: 'bass' });
        notes.push({ at: t + beat * 2, dur: beat * 1.2, midi: low + 7, vel: 0.62, voice: 'bass' });
        if (fi > 0) {
          for (let k = 0; k < 4; k += 1) notes.push({ at: t + k * beat, dur: 0.2, midi: 0, vel: k % 2 === 0 ? 0.8 : 0.45, voice: 'drum' });
          for (let k = 0; k < 8; k += 1) if (k % 2 === 1 || r() < 0.25) notes.push({ at: t + k * eighth, dur: 0.06, midi: 0, vel: 0.35 + r() * 0.2, voice: 'shaker' });
        }
      }
      // A soft pad: the chord's third and fifth around the middle.
      const third = [0, 5, 7].includes(chord) ? 4 : 3;
      for (const iv of [0, third, 7]) notes.push({ at: t, dur: bar * 0.98, midi: root + chord + iv, vel: style === 'story' ? 0.18 : 0.22, voice: 'pad' });
    }
    barIndex += barsPerPhrase;
  });
  // A last long root to close.
  const end = barIndex * bar;
  notes.push({ at: end, dur: bar * 1.5, midi: root + 12 + (style === 'story' ? 12 : 0), vel: 0.8, voice: 'lead' });
  if (style === 'concert') notes.push({ at: end, dur: bar, midi: root - 12, vel: 0.8, voice: 'bass' });
  notes.sort((a, b) => a.at - b.at);
  return { seed, bpm, root, instrument, style, notes, length: end + bar * 1.6, bars: barIndex + 1 };
}

type PhraseNote = { bar: number; step: number; len: number; idx: number; accent: boolean };

function writePhrase(r: () => number, tones: number[], rhythms: number[][], bars: number, start: number, rising: boolean): PhraseNote[] {
  const out: PhraseNote[] = [];
  let idx = start;
  for (let b = 0; b < bars; b += 1) {
    const rhythm = rhythms[Math.floor(r() * rhythms.length) % rhythms.length];
    const last = b === bars - 1;
    const steps = rhythm.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    steps.forEach((step, k) => {
      const next = steps[k + 1] ?? 8;
      // Mostly steps, now and then a leap; B phrases lean upward.
      const move = r() < 0.75 ? (r() < (rising ? 0.65 : 0.5) ? 1 : -1) : (r() < 0.5 ? 2 : -2);
      idx = Math.max(1, Math.min(tones.length - 2, idx + move));
      if (last && k === steps.length - 1) idx = r() < 0.6 ? 5 : 8; // home: the root or the fifth
      out.push({ bar: b, step, len: Math.max(1, next - step), idx, accent: step === 0 });
    });
  }
  return out;
}

export type MusicRun = {
  /** 0..1, how much is sounding now. */
  level(): number;
  /** Seconds into the song. */
  time(): number;
  stop(): void;
  done: Promise<void>;
};

export type Music = {
  play(song: Song, opts?: { volume?: number; onNote?(n: Note): void; onBar?(bar: number): void }): MusicRun;
};

const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export function createMusic(ctx: AudioContext, dest: AudioNode): Music {
  let noise: AudioBuffer | null = null;
  const noiseBuffer = (): AudioBuffer => {
    if (noise) return noise;
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
    return noise;
  };

  function voiceLead(inst: Instrument, out: AudioNode, t: number, n: Note): void {
    const f = hz(n.midi);
    const g = ctx.createGain();
    g.connect(out);
    const v = n.vel;
    const osc = (type: OscillatorType, freq: number, gain: number, decay: number): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(gain, t + 0.006);
      og.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + decay + 0.05);
    };
    g.gain.value = v * 0.5;
    switch (inst) {
      case 'kalimba':
        osc('sine', f, 0.6, 1.4);
        osc('sine', f * 5.4, 0.12, 0.25);
        osc('sine', f * 2, 0.08, 0.6);
        break;
      case 'marimba':
        osc('sine', f, 0.7, 0.9);
        osc('sine', f * 4, 0.18, 0.12);
        osc('triangle', f * 10, 0.03, 0.05);
        break;
      case 'glass':
        osc('sine', f * 2, 0.4, 2.2);
        osc('sine', f * 5.03, 0.1, 1.2);
        osc('sine', f * 8.2, 0.04, 0.6);
        break;
      case 'musicbox':
        osc('sine', f, 0.45, 1.8);
        osc('sine', f * 3, 0.1, 0.5);
        osc('sine', f * 6.1, 0.03, 0.2);
        break;
      case 'harp': {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(f * 8, t);
        lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.8);
        const og = ctx.createGain();
        og.gain.setValueAtTime(0, t);
        og.gain.linearRampToValueAtTime(0.7, t + 0.004);
        og.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        o.connect(lp).connect(og).connect(g);
        o.start(t);
        o.stop(t + 1.7);
        break;
      }
      case 'fiddle':
      case 'flute': {
        // A bowed or blown voice: held for the note's length with a little vibrato.
        const o = ctx.createOscillator();
        o.type = inst === 'fiddle' ? 'sawtooth' : 'triangle';
        o.frequency.value = f;
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.2;
        const vibG = ctx.createGain();
        vibG.gain.setValueAtTime(0, t);
        vibG.gain.linearRampToValueAtTime(f * 0.006, t + 0.25);
        vib.connect(vibG).connect(o.frequency);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = inst === 'fiddle' ? 2400 : 1800;
        lp.Q.value = inst === 'fiddle' ? 2 : 0.7;
        const og = ctx.createGain();
        const len = Math.max(0.18, n.dur * 0.92);
        og.gain.setValueAtTime(0, t);
        og.gain.linearRampToValueAtTime(inst === 'fiddle' ? 0.32 : 0.42, t + 0.07);
        og.gain.setValueAtTime(inst === 'fiddle' ? 0.28 : 0.36, t + len * 0.7);
        og.gain.linearRampToValueAtTime(0.0001, t + len + 0.12);
        o.connect(lp).connect(og).connect(g);
        o.start(t);
        vib.start(t);
        o.stop(t + len + 0.2);
        vib.stop(t + len + 0.2);
        break;
      }
    }
  }

  function voicePad(out: AudioNode, t: number, n: Note): void {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = hz(n.midi);
    o.detune.value = (Math.random() - 0.5) * 8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(n.vel * 0.22, t + 0.6);
    g.gain.setValueAtTime(n.vel * 0.22, t + n.dur - 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + n.dur + 0.3);
    o.connect(lp).connect(g).connect(out);
    o.start(t);
    o.stop(t + n.dur + 0.4);
  }

  function voiceBass(out: AudioNode, t: number, n: Note): void {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz(n.midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(n.vel * 0.42, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + n.dur + 0.05);
  }

  function voiceDrum(out: AudioNode, t: number, n: Note): void {
    if (n.voice === 'drum') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.15);
      const g = ctx.createGain();
      g.gain.setValueAtTime(n.vel * 0.45, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.25);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(n.vel * 0.09, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(hp).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, 0.1);
  }

  return {
    play(song, opts = {}) {
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(dest);
      const start = ctx.currentTime + 0.15;
      master.gain.linearRampToValueAtTime(opts.volume ?? 0.8, start + 1.2);
      let next = 0;
      let stopped = false;
      let resolve: () => void = () => undefined;
      const done = new Promise<void>((r) => (resolve = r));
      // Level: a sum of the recent onsets, decaying; read at the audio clock.
      const onsets: { at: number; vel: number }[] = [];
      let lastBar = -1;
      const barLen = (60 / song.bpm) * 4;
      const timers: number[] = [];
      const tick = (): void => {
        if (stopped) return;
        const now = ctx.currentTime;
        const ahead = now + 0.25;
        while (next < song.notes.length && start + song.notes[next].at < ahead) {
          const n = song.notes[next];
          const t = Math.max(now, start + n.at);
          if (n.voice === 'lead') voiceLead(song.instrument, master, t, n);
          else if (n.voice === 'pad') voicePad(master, t, n);
          else if (n.voice === 'bass') voiceBass(master, t, n);
          else voiceDrum(master, t, n);
          if (n.voice === 'lead' || n.voice === 'drum' || n.voice === 'bass') onsets.push({ at: t, vel: n.voice === 'lead' ? n.vel : n.vel * 0.6 });
          if (opts.onNote) {
            const fire = n;
            timers.push(window.setTimeout(() => !stopped && opts.onNote?.(fire), Math.max(0, (t - now) * 1000)));
          }
          next += 1;
        }
        const bar = Math.floor((now - start) / barLen);
        if (bar !== lastBar && bar >= 0) {
          lastBar = bar;
          opts.onBar?.(bar);
        }
        while (onsets.length && onsets[0].at < now - 2) onsets.shift();
        if (now > start + song.length) {
          finish();
          return;
        }
        timers.push(window.setTimeout(tick, 40));
      };
      const finish = (): void => {
        if (stopped) return;
        stopped = true;
        for (const id of timers) clearTimeout(id);
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + 1.2);
        window.setTimeout(() => {
          master.disconnect();
          resolve();
        }, 1300);
      };
      tick();
      return {
        level() {
          const now = ctx.currentTime;
          let l = 0;
          for (const o of onsets) {
            const d = now - o.at;
            if (d >= 0) l += o.vel * Math.exp(-d * 4);
          }
          return Math.min(1, l * 0.7);
        },
        time: () => Math.max(0, ctx.currentTime - start),
        stop: finish,
        done,
      };
    },
  };
}
