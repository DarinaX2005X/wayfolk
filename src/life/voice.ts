// Babble voices. voiceProfile() and syllablePlan() are pure (unit tested); playBabble()
// renders a plan with Web Audio: one oscillator through two vowel formants, a gain
// envelope per syllable and short consonant clicks. mouthAt() gives the mouth or beak
// opening at any moment of the same plan, so lips follow the sound without an analyser.
import type { Voice } from '../mind/types';

export interface VoiceProfile {
  baseHz: number;
  /** Seconds per syllable. */
  syllableSec: number;
  wave: OscillatorType;
  /** Low-pass cutoff of the dry voice, Hz. */
  cutoff: number;
  /** Multiplier on vowel formant frequencies. */
  formant: number;
  /** Amplitude roughness 0..1 (croaky voices). */
  creak: number;
  /** Bird chirps: each syllable sweeps upward. */
  chirp: boolean;
}

export const BASE_HZ = 230;
export const BASE_SYLLABLES_PER_SEC = 10.5;
export const PIP_VOICE: Voice = { pitch: 1.0, rate: 1.15, timbre: 'bright' };

const TIMBRE: Record<Voice['timbre'], { wave: OscillatorType; cutoff: number; formant: number; creak: number }> = {
  soft: { wave: 'triangle', cutoff: 2200, formant: 1.0, creak: 0 },
  bright: { wave: 'square', cutoff: 3800, formant: 1.12, creak: 0 },
  croaky: { wave: 'sawtooth', cutoff: 1700, formant: 0.88, creak: 0.55 },
  warm: { wave: 'sawtooth', cutoff: 1350, formant: 0.94, creak: 0.06 },
};

const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/**
 * Voice → synth parameters. pitch and rate are multipliers around 1 (0.5..2); values
 * above 20 (pitch) or 4 (rate) are read as Hz and syllables per second.
 */
export function voiceProfile(v: Partial<Voice> | undefined, opts: { bird?: boolean } = {}): VoiceProfile {
  const pitchIn = Number.isFinite(v?.pitch) ? (v!.pitch as number) : 1;
  const rateIn = Number.isFinite(v?.rate) ? (v!.rate as number) : 1;
  const timbre = v?.timbre && v.timbre in TIMBRE ? v.timbre : 'soft';
  const t = TIMBRE[timbre];
  const base = opts.bird ? 760 : BASE_HZ;
  const hz = pitchIn > 20 ? clamp(pitchIn, 80, 1400) : base * clamp(pitchIn, 0.5, 2);
  const sps = rateIn > 4 ? clamp(rateIn, 4, 22) : BASE_SYLLABLES_PER_SEC * clamp(rateIn, 0.5, 2);
  return {
    baseHz: hz,
    syllableSec: 1 / sps,
    wave: opts.bird ? 'sine' : t.wave,
    cutoff: opts.bird ? 5200 : t.cutoff,
    formant: t.formant * Math.pow(hz / BASE_HZ, 0.25),
    creak: opts.bird ? 0 : t.creak,
    chirp: !!opts.bird,
  };
}

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u';
export interface Syllable {
  t: number;
  d: number;
  hz: number;
  vowel: Vowel;
  /** How wide the mouth opens on this vowel, 0..1. */
  open: number;
  /** Starts with a plosive or hiss: a short click of noise. */
  click: boolean;
}

export const VOWEL_FORMANTS: Record<Vowel, [number, number]> = {
  a: [800, 1250],
  e: [500, 1900],
  i: [330, 2300],
  o: [520, 900],
  u: [360, 800],
};
const OPEN: Record<Vowel, number> = { a: 1, e: 0.7, i: 0.45, o: 0.85, u: 0.55 };

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const MAX_SECONDS = 9;

/** Syllables of a line: timing, pitch contour, vowel and mouth opening. Deterministic per text. */
export function syllablePlan(text: string, p: VoiceProfile): { syllables: Syllable[]; duration: number } {
  const rand = rng(hash(text) ^ Math.round(p.baseHz));
  const tokens = text.match(/[\p{L}\p{N}']+|[.,!?;:…—-]/gu) ?? [];
  type Raw = { vowel: Vowel; click: boolean; pauseAfter: number; end: '' | '.' | '?' | '!' };
  const raw: Raw[] = [];
  for (const tok of tokens) {
    if (/^[.,!?;:…—-]$/.test(tok)) {
      const last = raw[raw.length - 1];
      if (!last) continue;
      const strong = /[.!?…]/.test(tok);
      last.pauseAfter = Math.max(last.pauseAfter, strong ? 0.32 : 0.18);
      if (tok === '?') last.end = '?';
      else if (tok === '!') last.end = '!';
      else if (strong) last.end = '.';
      continue;
    }
    const groups = tok.toLowerCase().match(/[^aeiouyаеёиоуыэюя]*[aeiouyаеёиоуыэюя]+/gu) ?? [tok.toLowerCase()];
    const n = Math.min(groups.length, 4);
    for (let i = 0; i < n; i++) {
      const g = groups[i];
      const vch = (g.match(/[aeiouyаеёиоуыэюя]/u)?.[0] ?? 'a').replace('y', 'i');
      const map: Record<string, Vowel> = { а: 'a', е: 'e', ё: 'o', и: 'i', о: 'o', у: 'u', ы: 'i', э: 'e', ю: 'u', я: 'a' };
      const vowel = (map[vch] ?? vch) as Vowel;
      raw.push({ vowel: 'aeiou'.includes(vowel) ? vowel : 'a', click: /^[ptkbdgcsfzxчкпт]/u.test(g), pauseAfter: i === n - 1 ? 0.035 : 0, end: '' });
    }
  }
  if (raw.length === 0) return { syllables: [], duration: 0 };

  let sec = p.syllableSec;
  const pauses = raw.reduce((s, r) => s + r.pauseAfter, 0);
  const est = raw.length * sec + pauses;
  if (est > MAX_SECONDS) sec = Math.max(0.045, (MAX_SECONDS - pauses * 0.6) / raw.length);

  const syllables: Syllable[] = [];
  let t = 0;
  // Sentence position drives a gentle declination; questions rise at the end.
  let sentenceStart = 0;
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    let sentenceEnd = i;
    while (sentenceEnd < raw.length - 1 && raw[sentenceEnd].end === '') sentenceEnd++;
    const span = Math.max(1, sentenceEnd - sentenceStart);
    const pos = (i - sentenceStart) / span;
    let contour = 1.06 - pos * 0.12;
    const endKind = raw[sentenceEnd].end;
    if (endKind === '?' && sentenceEnd - i < 2) contour *= 1.18 + (1 - (sentenceEnd - i)) * 0.1;
    if (endKind === '!' && i === sentenceStart) contour *= 1.1;
    const jitter = 1 + (rand() - 0.5) * 0.22;
    const d = sec * (0.82 + rand() * 0.36);
    syllables.push({ t, d, hz: p.baseHz * contour * jitter, vowel: r.vowel, open: OPEN[r.vowel], click: r.click });
    t += d + r.pauseAfter * (sec / p.syllableSec);
    if (r.end !== '') sentenceStart = i + 1;
  }
  return { syllables, duration: t };
}

/** Mouth opening 0..1 at time t (seconds since the line started). */
export function mouthAt(plan: { syllables: Syllable[] }, t: number): number {
  const s = plan.syllables;
  if (s.length === 0 || t < 0) return 0;
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  const syl = s[lo];
  const u = (t - syl.t) / syl.d;
  if (u < 0 || u > 1) return 0;
  return syl.open * Math.pow(Math.sin(Math.PI * u), 0.7);
}

export interface BabbleHandle {
  readonly start: number;
  readonly end: number;
  stop(): void;
}

let noiseBuffer: AudioBuffer | null = null;
function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffer = b;
  return b;
}

/** Render a syllable plan into `dest` (usually a positional PannerNode). */
export function playBabble(
  ctx: BaseAudioContext,
  dest: AudioNode,
  plan: { syllables: Syllable[]; duration: number },
  p: VoiceProfile,
  volume = 1,
  when = ctx.currentTime + 0.04,
): BabbleHandle {
  const t0 = when;
  const end = t0 + plan.duration + 0.15;
  const osc = ctx.createOscillator();
  osc.type = p.wave;
  const env = ctx.createGain();
  env.gain.value = 0;
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 6;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 8;
  const dry = ctx.createBiquadFilter();
  dry.type = 'lowpass';
  dry.frequency.value = p.cutoff;
  const g1 = ctx.createGain();
  g1.gain.value = 1.4;
  const g2 = ctx.createGain();
  g2.gain.value = 0.9;
  const gd = ctx.createGain();
  gd.gain.value = p.chirp ? 0.9 : 0.35;
  osc.connect(f1).connect(g1).connect(env);
  osc.connect(f2).connect(g2).connect(env);
  osc.connect(dry).connect(gd).connect(env);
  const out = ctx.createGain();
  out.gain.value = 0.22 * volume * (p.wave === 'square' ? 0.55 : p.wave === 'sawtooth' ? 0.7 : 1);
  env.connect(out).connect(dest);

  let creakOsc: OscillatorNode | null = null;
  if (p.creak > 0) {
    // Roughness: a fast tremolo on the envelope stage.
    creakOsc = ctx.createOscillator();
    creakOsc.frequency.value = 31;
    const depth = ctx.createGain();
    depth.gain.value = p.creak * 0.5;
    const am = ctx.createGain();
    am.gain.value = 1 - p.creak * 0.5;
    env.disconnect();
    env.connect(am).connect(out);
    creakOsc.connect(depth).connect(am.gain);
    creakOsc.start(t0);
    creakOsc.stop(end + 0.1);
  }

  const clicks = ctx.createBufferSource();
  clicks.buffer = noise(ctx);
  clicks.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2600;
  const cg = ctx.createGain();
  cg.gain.value = 0;
  clicks.connect(hp).connect(cg).connect(out);

  osc.frequency.setValueAtTime(plan.syllables[0]?.hz ?? p.baseHz, t0);
  for (const s of plan.syllables) {
    const t = t0 + s.t;
    const [F1, F2] = VOWEL_FORMANTS[s.vowel];
    f1.frequency.setValueAtTime(F1 * p.formant, t);
    f2.frequency.setValueAtTime(F2 * p.formant, t);
    if (p.chirp) {
      osc.frequency.setValueAtTime(s.hz * 0.82, t);
      osc.frequency.exponentialRampToValueAtTime(s.hz * 1.38, t + s.d * 0.55);
      osc.frequency.exponentialRampToValueAtTime(s.hz * 1.05, t + s.d * 0.95);
    } else {
      osc.frequency.setValueAtTime(s.hz * 1.04, t);
      osc.frequency.linearRampToValueAtTime(s.hz * 0.96, t + s.d * 0.85);
    }
    const peak = 0.55 + s.open * 0.45;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(peak, t + Math.min(0.014, s.d * 0.2));
    env.gain.linearRampToValueAtTime(peak * 0.75, t + s.d * 0.6);
    env.gain.linearRampToValueAtTime(0, t + s.d * 0.96);
    if (s.click && !p.chirp) {
      cg.gain.setValueAtTime(0, t);
      cg.gain.linearRampToValueAtTime(0.35, t + 0.004);
      cg.gain.linearRampToValueAtTime(0, t + 0.028);
    }
  }
  osc.start(t0);
  osc.stop(end);
  clicks.start(t0);
  clicks.stop(end);
  let stopped = false;
  return {
    start: t0,
    end,
    stop() {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setTargetAtTime(0, now, 0.02);
      try {
        osc.stop(now + 0.12);
        clicks.stop(now + 0.12);
        creakOsc?.stop(now + 0.12);
      } catch {
        /* already stopped */
      }
    },
  };
}
