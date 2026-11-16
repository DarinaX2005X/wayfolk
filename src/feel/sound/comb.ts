/**
 * The comb of the music box. One steel tooth is a clamped bar: a long pure fundamental
 * that drops quickly at first and then rings on, a twin 0.9 Hz sharp of it that makes
 * the note shimmer slowly, a little octave and twelfth from the wooden box, and the bar's own
 * inharmonic overtones (6.27 and 17.55 times the fundamental) that last a few
 * hundredths of a second and give the "plink". The pin letting go of the tooth is a
 * tiny noise tick. A short tail of the box follows every note.
 */
import { SCALE_HZ } from './scale';
import { bp, fadeTail, hit, hp, lp, renderLayers, rng, runBand } from './dsp';

/**
 * No tooth peaks above this before the master gain (tests/feel/comb.test.ts measures all
 * eight). The mix budget of a voice counts every comb note at this level.
 */
export const COMB_LEVEL = 0.5;

/** Ring time constant of the fundamental, seconds: about 1.7 s to silence at C5, 1 s at E6. */
export function ringTau(hz: number): number {
  return 0.25 * Math.pow(SCALE_HZ[0] / hz, 0.6);
}

/**
 * RMS of a note over its first 125 ms. The ear gains about 3.6 dB of sensitivity from
 * C5 to E6 and a high tooth also fades sooner, so high teeth are set a little softer
 * and the eight notes come out equally loud on an A-weighted meter.
 */
export function toothLevel(hz: number): number {
  return 0.205 * Math.pow(SCALE_HZ[0] / hz, 0.36);
}

/**
 * The partials of a tooth at `hz`: frequency, amplitude and decay time constant.
 * Exported so that tests can look for exactly these lines in the rendered note.
 */
export function toothPartials(hz: number, sr: number): { hz: number; amp: number; tau: number }[] {
  const tau = ringTau(hz);
  const list = [
    { hz, amp: 1, tau },
    { hz, amp: 0.45, tau: 0.06 },
    { hz: hz + 0.9, amp: 0.22, tau },
    { hz: hz * 2, amp: 0.12, tau: tau * 0.45 },
    { hz: hz * 3, amp: 0.05, tau: tau * 0.3 },
    { hz: hz * 6.27, amp: 0.2, tau: 0.035 },
    { hz: hz * 17.55, amp: 0.07, tau: 0.012 },
  ];
  return list.filter((p) => p.hz < sr * 0.34);
}

/**
 * Adds a decaying sine to `out` with a two-pole resonator: two multiplications a
 * sample instead of a sine and an exponent, so a whole comb renders in a few
 * milliseconds.
 */
function ring(out: Float32Array, sr: number, hz: number, amp: number, tau: number): void {
  const w = (2 * Math.PI * hz) / sr;
  const r = Math.exp(-1 / (tau * sr));
  const k1 = 2 * r * Math.cos(w);
  const k2 = r * r;
  const n = Math.min(out.length, Math.ceil(tau * 7.5 * sr));
  let y2 = 0;
  let y1 = amp * r * Math.sin(w);
  if (n > 1) out[1] += y1;
  for (let i = 2; i < n; i++) {
    const y = k1 * y1 - k2 * y2;
    y2 = y1;
    y1 = y;
    out[i] += y;
  }
}

/**
 * The short answer of the wooden box as a sparse impulse response (velvet noise):
 * about 1500 signed taps a second that die away in 0.16 s. Sparse taps make the
 * convolution cheap enough to bake into every note buffer.
 */
export function boxTail(sr: number): { at: Int32Array; amp: Float32Array } {
  const rand = rng(40_961);
  const span = 0.16;
  const delay = 0.004;
  const tau = 0.03;
  const step = sr / 1500;
  const count = Math.floor((span * sr) / step);
  const at = new Int32Array(count);
  const amp = new Float32Array(count);
  let energy = 0;
  for (let k = 0; k < count; k++) {
    const pos = Math.round(k * step + rand() * (step - 1));
    at[k] = Math.round(delay * sr) + pos;
    amp[k] = (rand() < 0.5 ? -1 : 1) * Math.exp(-pos / sr / tau);
    energy += amp[k] * amp[k];
  }
  const k = 1 / Math.sqrt(energy);
  for (let i = 0; i < count; i++) amp[i] *= k;
  return { at, amp };
}

const tails = new Map<number, { at: Int32Array; amp: Float32Array }>();

/** Adds the box tail to a dry note. Only the loud first part of the note feeds the box. */
function addBox(dry: Float32Array, sr: number, wet: number): void {
  let tail = tails.get(sr);
  if (!tail) tails.set(sr, (tail = boxTail(sr)));
  const feed = Math.min(dry.length, Math.round(0.25 * sr));
  const out = new Float32Array(Math.min(dry.length, feed + Math.round(0.2 * sr)));
  for (let k = 0; k < tail.at.length; k++) {
    const d = tail.at[k];
    const a = tail.amp[k];
    const n = Math.min(feed, out.length - d);
    for (let i = 0; i < n; i++) out[d + i] += dry[i] * a;
  }
  // A wooden box answers in the middle of the spectrum: no boom, no hiss.
  runBand(out, sr, hp(260));
  runBand(out, sr, lp(3200));
  for (let i = 0; i < out.length; i++) dry[i] += out[i] * wet;
}

/** One plucked tooth at `hz`. `seed` only changes the pin tick. */
export function combNote(hz: number, sr: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.ceil(ringTau(hz) * 7.5 * sr));
  for (const p of toothPartials(hz, sr)) ring(out, sr, p.hz, p.amp, p.tau);
  // The tooth does not jump to full swing: a 1.2 ms rise keeps the start from clicking.
  const rise = Math.round(0.0012 * sr);
  for (let i = 0; i < rise; i++) out[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / rise);
  const pin = renderLayers(
    [{ kind: 'noise', at: 0, gain: 0.3, env: hit(0.0002, 0.0018), band: [bp(3800, 1.2)] }],
    sr,
    seed,
  );
  for (let i = 0; i < pin.length && i < out.length; i++) out[i] += pin[i];
  addBox(out, sr, 0.22);
  // Set the level by the energy of the first 125 ms, not by the peak: the peak depends
  // on how the short overtones line up, and the box favours some notes over others.
  const head = Math.min(out.length, Math.round(0.125 * sr));
  let power = 0;
  for (let i = 0; i < head; i++) power += out[i] * out[i];
  const scale = toothLevel(hz) / Math.sqrt(power / head);
  for (let i = 0; i < out.length; i++) out[i] *= scale;
  fadeTail(out, sr, 0.01);
  return out;
}

/** Index of the scale note closest to `hz` and the playback rate that reaches `hz` from it. */
export function nearestTooth(hz: number): { note: number; rate: number } {
  let note = 0;
  let best = Infinity;
  for (let i = 0; i < SCALE_HZ.length; i++) {
    const d = Math.abs(Math.log(hz / SCALE_HZ[i]));
    if (d < best) {
      best = d;
      note = i;
    }
  }
  return { note, rate: hz / SCALE_HZ[note] };
}
