/**
 * The island's sound bed, all synthesised (no files): wind that swells with each gust,
 * birds in the trees by day, crickets in the grass at night, the pond and the waterfall,
 * soft chimes on the porch when the wind stirs them, rain while it rains and the campfire's
 * crackle. Every source sits where it comes from and is panned and faded by distance from
 * the listener; the world tells it the hour, the rain and the fire.
 *
 *   const amb = createAmbience(ctx, ctx.destination);
 *   amb.update(head.x, head.z, headYaw);     // a few times a second
 *   amb.stop();
 */
import { POND, STREAM } from './land';
import { createWindSound } from './wind';

interface AmbienceState {
  night: number;
  rain: number;
  fire: boolean;
  firePos: { x: number; z: number };
}

const state: AmbienceState = { night: 0, rain: 0, fire: false, firePos: { x: -2.5, z: -3.7 } };

/** The world keeps this up to date (one island per page). */
export function setAmbienceState(s: Partial<AmbienceState>): void {
  Object.assign(state, s);
}

export interface Ambience {
  /** Listener on the ground (x, z) facing yaw (radians, 0 looks toward −z, positive turns left). */
  update(x: number, z: number, yaw?: number): void;
  /** Overall level 0..1. */
  setVolume(v: number): void;
  stop(): void;
}

// Birdsong comes from trees well away from the porch (10 m and more), never by the ear.
const TREES: [number, number][] = [[-6.3, -22.2], [4.5, -24.5], [-12.6, -19.5], [11.5, -16.8], [9.6, -21.0], [-12.0, -9.6]];
// The porch chimes hang from the porch tree's bough (island.ts CHIMES_AT).
const CHIME: [number, number] = [-2.05, 0.55];

function noiseBuffer(ctx: AudioContext, seconds: number, brown: boolean): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w * 0.5;
  }
  return b;
}

export function createAmbience(ctx: AudioContext, dest: AudioNode): Ambience {
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(dest);
  const wind = createWindSound(ctx, master, 0.07);
  const listener = { x: 0, z: 0, yaw: 0 };
  const white = noiseBuffer(ctx, 3, false);
  const brown = noiseBuffer(ctx, 4, true);
  let stopped = false;

  /** A place a sound comes from: gain by distance, pan by bearing. */
  const spot = (x: number, z: number, near: number): { input: GainNode; place(x: number, z: number): void; level(k: number): void } => {
    const input = ctx.createGain();
    const dist = ctx.createGain();
    const pan = ctx.createStereoPanner();
    input.connect(dist).connect(pan).connect(master);
    let px = x;
    let pz = z;
    let lvl = 1;
    const apply = (): void => {
      const dx = px - listener.x;
      const dz = pz - listener.z;
      const d = Math.hypot(dx, dz);
      // bearing relative to where the listener faces: 0 ahead, positive to the right
      const bearing = Math.atan2(dx, -dz) + listener.yaw;
      const now = ctx.currentTime;
      dist.gain.setTargetAtTime(lvl / (1 + (d / near) ** 2), now, 0.3);
      pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, Math.sin(bearing) * Math.min(1, d / 1.5))), now, 0.3);
    };
    return {
      input,
      place(nx, nz) {
        px = nx;
        pz = nz;
        apply();
      },
      level(k) {
        lvl = k;
        apply();
      },
    };
  };

  const loop = (buf: AudioBuffer, filter: BiquadFilterType, freq: number, q: number, out: AudioNode): AudioBufferSourceNode => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.random();
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(out);
    src.start(ctx.currentTime, Math.random() * 2);
    return src;
  };

  // water: the pond laps, the waterfall rushes
  const pond = spot(POND.x, POND.z, 3.5);
  const fall = spot(STREAM[1].x, STREAM[1].z, 6);
  const sources: AudioBufferSourceNode[] = [loop(brown, 'lowpass', 520, 0.7, pond.input), loop(white, 'bandpass', 1100, 0.5, fall.input)];
  pond.level(0.08);
  fall.level(0.1);
  // rain all round
  const rainGain = ctx.createGain();
  rainGain.gain.value = 0;
  rainGain.connect(master);
  sources.push(loop(white, 'highpass', 2400, 0.3, rainGain));

  // crickets: a few voices in the grass, chirping in pulses
  const crickets = [[-3, -5], [4, -6.5], [-6.5, -9], [2, -11]].map(([x, z], i) => {
    const s = spot(x, z, 4);
    const osc = ctx.createOscillator();
    osc.frequency.value = 4300 + i * 230;
    const am = ctx.createGain();
    am.gain.value = 0;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 22 + i * 3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(am.gain);
    const gate = ctx.createGain();
    gate.gain.value = 0;
    osc.connect(am).connect(gate).connect(s.input);
    osc.start();
    lfo.start();
    return { s, gate, osc, lfo, next: ctx.currentTime + Math.random() * 2 };
  });

  // a short chirping phrase from a tree
  const bird = (x: number, z: number): void => {
    const s = spot(x, z, 7);
    s.level(0.035);
    const t0 = ctx.currentTime + 0.05;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2600 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const t = t0 + i * (0.09 + Math.random() * 0.07);
      const f = base * (0.85 + Math.random() * 0.4);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (Math.random() < 0.5 ? 1.35 : 0.75), t + 0.07);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(1, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      o.connect(g).connect(s.input);
      o.start(t);
      o.stop(t + 0.12);
    }
  };

  // porch chimes: soft pentatonic bells
  const chime = spot(CHIME[0], CHIME[1], 2.5);
  chime.level(0.022);
  const PENTA = [0, 2, 4, 7, 9, 12, 14];
  const ring = (): void => {
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.18 + Math.random() * 0.25);
      const f = 880 * Math.pow(2, PENTA[Math.floor(Math.random() * PENTA.length)] / 12);
      for (const [mul, amp] of [[1, 1], [2.76, 0.3]] as [number, number][]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f * mul;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0005, t + 2.6 / mul);
        o.connect(g).connect(chime.input);
        o.start(t);
        o.stop(t + 2.8);
      }
    }
  };

  // campfire crackle
  const fire = spot(state.firePos.x, state.firePos.z, 2.5);
  fire.level(0);
  const crackle = (): void => {
    const src = ctx.createBufferSource();
    src.buffer = white;
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1500 + Math.random() * 2500;
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.6 + Math.random() * 0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.03 + Math.random() * 0.05);
    src.connect(f).connect(g).connect(fire.input);
    src.start(t, Math.random() * 2, 0.1);
  };

  let nextBird = ctx.currentTime + 4;
  let nextChime = ctx.currentTime + 12;
  let nextCrackle = ctx.currentTime;
  const tick = (): void => {
    if (stopped) return;
    const now = ctx.currentTime;
    const day = 1 - state.night;
    const dry = 1 - state.rain;
    if (now > nextBird) {
      if (day > 0.4 && state.rain < 0.6) {
        const [x, z] = TREES[Math.floor(Math.random() * TREES.length)];
        bird(x, z);
      }
      nextBird = now + 6 + (Math.random() * 12) / Math.max(0.3, day);
    }
    if (now > nextChime) {
      ring();
      nextChime = now + 25 + Math.random() * 35;
    }
    for (const c of crickets) {
      if (now < c.next) continue;
      const on = state.night * dry;
      if (on > 0.1) {
        c.gate.gain.setTargetAtTime(0.012 * on, now, 0.02);
        c.gate.gain.setTargetAtTime(0, now + 0.25 + Math.random() * 0.3, 0.03);
      }
      c.next = now + 0.7 + Math.random() * 1.4;
    }
    rainGain.gain.setTargetAtTime(state.rain * 0.06, now, 0.8);
    fire.place(state.firePos.x, state.firePos.z);
    fire.level(state.fire ? 0.08 : 0);
    if (state.fire && now > nextCrackle) {
      crackle();
      nextCrackle = now + 0.05 + Math.random() * 0.35;
    }
  };
  const timer = setInterval(tick, 60);

  return {
    update(x, z, yaw = 0) {
      listener.x = x;
      listener.z = z;
      listener.yaw = yaw;
      wind.update(x, z);
      pond.place(POND.x, POND.z);
      fall.place(STREAM[1].x, STREAM[1].z);
      chime.place(CHIME[0], CHIME[1]);
      for (const c of crickets) c.s.level(1);
    },
    setVolume(v) {
      master.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), ctx.currentTime, 0.3);
    },
    stop() {
      stopped = true;
      clearInterval(timer);
      wind.stop();
      for (const s of sources) s.stop();
      for (const c of crickets) {
        c.osc.stop();
        c.lfo.stop();
      }
      master.disconnect();
    },
  };
}
