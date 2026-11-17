/**
 * Sounds of doing things together, synthesised in Web Audio (no files): wind chime tubes,
 * the warm chord of a high five, a wooden knock as a plank lands, the creak of a rope
 * pulled taut, the soft rush of a lantern turning into stars, and a quiet drone under the
 * duet. Each sound comes from its place in the island through an HRTF panner; the
 * listener follows the head (life does that for the shared context).
 */
import type { Vector3 } from '@iwsdk/core';

export interface TogetherSound {
  readonly ctx: AudioContext | null;
  chime(hz: number, velocity: number, at: Vector3 | null, bright?: number): void;
  fiveChord(at: Vector3 | null): void;
  knock(at: Vector3 | null, pitch?: number): void;
  creak(at: Vector3 | null, amount?: number): void;
  rush(at: Vector3 | null): void;
  /** The duet's drone, 0 (silent) .. 1. */
  drone(level: number): void;
  dispose(): void;
}

export function createSound(getCtx: () => AudioContext | null | undefined): TogetherSound {
  let bus: GainNode | null = null;
  let droneGain: GainNode | null = null;
  let droneOsc: OscillatorNode[] = [];
  let noise: AudioBuffer | null = null;
  const ctxOf = (): AudioContext | null => {
    const c = getCtx() ?? null;
    if (!c) return null;
    if (!bus || bus.context !== c) {
      bus = c.createGain();
      bus.gain.value = 0.8;
      bus.connect(c.destination);
      noise = null;
      droneGain = null;
      droneOsc = [];
    }
    return c;
  };
  const out = (c: AudioContext, at: Vector3 | null): AudioNode => {
    if (!at) return bus!;
    const p = c.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1.2;
    p.rolloffFactor = 0.9;
    if (p.positionX) {
      p.positionX.value = at.x;
      p.positionY.value = at.y;
      p.positionZ.value = at.z;
    } else (p as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(at.x, at.y, at.z);
    p.connect(bus!);
    return p;
  };
  const noiseBuffer = (c: AudioContext): AudioBuffer => {
    if (noise) return noise;
    const b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < d.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (s / 0x7fffffff) * 2 - 1;
    }
    noise = b;
    return b;
  };
  const partial = (c: AudioContext, dest: AudioNode, hz: number, gain: number, decay: number, t0: number, type: OscillatorType = 'sine'): void => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    o.connect(g).connect(dest);
    o.start(t0);
    o.stop(t0 + decay + 0.05);
  };
  const tick = (c: AudioContext, dest: AudioNode, t0: number, gain: number, hz: number, len = 0.02): void => {
    const s = c.createBufferSource();
    s.buffer = noiseBuffer(c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = hz;
    f.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    s.connect(f).connect(g).connect(dest);
    s.start(t0, Math.random() * 0.5, len + 0.02);
  };

  return {
    get ctx() {
      return ctxOf();
    },
    chime(hz, velocity, at, bright = 1) {
      const c = ctxOf();
      if (!c || c.state !== 'running') return;
      const t0 = c.currentTime + 0.005;
      const dest = out(c, at);
      const v = 0.22 * Math.max(0.2, Math.min(1, velocity));
      // A tube: a clear fundamental, the tube's inharmonic partials, a metal tick.
      partial(c, dest, hz, v, 3.6, t0);
      partial(c, dest, hz * 2.76, v * 0.42 * bright, 1.7, t0);
      partial(c, dest, hz * 5.4, v * 0.2 * bright, 0.8, t0);
      partial(c, dest, hz * 8.93, v * 0.08 * bright, 0.35, t0);
      partial(c, dest, hz * 1.003, v * 0.35, 2.8, t0);
      tick(c, dest, t0, v * 0.5, 5200, 0.015);
    },
    fiveChord(at) {
      const c = ctxOf();
      if (!c || c.state !== 'running') return;
      const t0 = c.currentTime + 0.01;
      const dest = out(c, at);
      // D major, spread, and a little run of bells rising above it.
      [146.83, 220, 293.66, 369.99, 440].forEach((hz, i) => partial(c, dest, hz, 0.09 - i * 0.008, 2.6 + i * 0.2, t0 + i * 0.012, i < 2 ? 'triangle' : 'sine'));
      [587.33, 739.99, 880, 1174.66].forEach((hz, i) => {
        partial(c, dest, hz, 0.06, 1.4, t0 + 0.09 + i * 0.075);
        partial(c, dest, hz * 2.76, 0.018, 0.6, t0 + 0.09 + i * 0.075);
      });
      tick(c, dest, t0, 0.35, 2400, 0.05);
    },
    knock(at, pitch = 1) {
      const c = ctxOf();
      if (!c || c.state !== 'running') return;
      const t0 = c.currentTime + 0.005;
      const dest = out(c, at);
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(220 * pitch, t0);
      o.frequency.exponentialRampToValueAtTime(110 * pitch, t0 + 0.09);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.32, t0 + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g).connect(dest);
      o.start(t0);
      o.stop(t0 + 0.2);
      tick(c, dest, t0, 0.25, 900 * pitch, 0.05);
    },
    creak(at, amount = 1) {
      const c = ctxOf();
      if (!c || c.state !== 'running') return;
      const t0 = c.currentTime + 0.005;
      const dest = out(c, at);
      const s = c.createBufferSource();
      s.buffer = noiseBuffer(c);
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = 9;
      f.frequency.setValueAtTime(380, t0);
      f.frequency.linearRampToValueAtTime(620, t0 + 0.35);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.16 * amount, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
      s.connect(f).connect(g).connect(dest);
      s.start(t0, Math.random() * 0.4, 0.5);
    },
    rush(at) {
      const c = ctxOf();
      if (!c || c.state !== 'running') return;
      const t0 = c.currentTime + 0.005;
      const dest = out(c, at);
      const s = c.createBufferSource();
      s.buffer = noiseBuffer(c);
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(400, t0);
      f.frequency.exponentialRampToValueAtTime(5000, t0 + 0.9);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.12, t0 + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
      s.connect(f).connect(g).connect(dest);
      s.start(t0, 0, 1.0);
      [880, 1108.73, 1318.51, 1760].forEach((hz, i) => partial(c, dest, hz, 0.04, 2.2, t0 + 0.6 + i * 0.11));
    },
    drone(level) {
      const c = ctxOf();
      if (!c) return;
      if (!droneGain) {
        if (level < 0.01) return;
        droneGain = c.createGain();
        droneGain.gain.value = 0;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 900;
        droneGain.connect(lp).connect(bus!);
        droneOsc = [146.83, 220, 293.66 * 1.002].map((hz, i) => {
          const o = c.createOscillator();
          o.type = i === 0 ? 'triangle' : 'sine';
          o.frequency.value = hz;
          const g = c.createGain();
          g.gain.value = i === 0 ? 0.5 : 0.3;
          o.connect(g).connect(droneGain!);
          o.start();
          return o;
        });
      }
      droneGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.07, c.currentTime, 0.4);
    },
    dispose() {
      for (const o of droneOsc) {
        try {
          o.stop();
        } catch {
          // already stopped
        }
      }
      droneOsc = [];
      droneGain = null;
      bus?.disconnect();
      bus = null;
    },
  };
}
