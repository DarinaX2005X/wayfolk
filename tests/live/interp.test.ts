import { describe, expect, it } from 'vitest';
import { PoseTrack, emptyPose, slerp } from '../../src/live/interp';
import { liveMessage, parseLiveLink, liveLink } from '../../src/live/index';
import type { Presence } from '../../src/live/protocol';

const frame = (time: number, x: number, hand = true): Presence => ({
  seq: time,
  time,
  slot: 1,
  talking: false,
  immersive: true,
  head: { pos: [x, 1.2, 0], quat: [0, 0, 0, 1] },
  left: hand
    ? { wrist: [x + 0.2, 1, -0.3], quat: [0, 0, 0, 1], tips: [0, 1, 2, 3, 4].map((i) => [x + 0.2 + i * 0.01, 1, -0.4] as [number, number, number]) }
    : undefined,
});

describe('pose playback', () => {
  it('plays back evenly despite jittery arrival', () => {
    const track = new PoseTrack();
    // Frames every 66 ms, delivered with 0–60 ms of jitter.
    const jitter = [0, 40, 10, 60, 5, 30, 0, 55, 20, 0, 45, 15, 0, 35, 10];
    for (let i = 0; i < jitter.length; i++) track.push(frame(1000 + i * 66, i * 0.066), 5000 + i * 66 + jitter[i]);
    const out = emptyPose();
    const xs: number[] = [];
    for (let t = 5600; t <= 5900; t += 11) {
      expect(track.sample(t, out)).toBe(true);
      xs.push(out.pos[0]);
    }
    // x moves at 1 m/s on the sender: playback steps of 11 ms are ~0.011 m each, never backwards.
    for (let i = 1; i < xs.length; i++) {
      const step = xs[i] - xs[i - 1];
      expect(step).toBeGreaterThanOrEqual(-1e-9);
      expect(step).toBeLessThan(0.02);
    }
    expect(track.delay).toBeGreaterThanOrEqual(70);
    expect(track.delay).toBeLessThanOrEqual(250);
  });

  it('ignores late and repeated frames and survives the clock wrap', () => {
    const track = new PoseTrack();
    track.push(frame(4_294_967_200, 0), 100);
    track.push(frame(4_294_967_200, 5), 110);
    track.push(frame(4_294_967_100, 5), 120);
    expect(track.size).toBe(1);
    track.push({ ...frame(30, 1), time: 30 }, 230); // 126 ms after the wrap
    expect(track.size).toBe(2);
    const out = emptyPose();
    track.sample(10_000, out);
    expect(out.pos[0]).toBeCloseTo(1, 5);
  });

  it('holds a hand that drops out instead of blending it with nothing', () => {
    const track = new PoseTrack();
    track.push(frame(0, 0, true), 0);
    track.push(frame(100, 0.1, false), 100);
    const out = emptyPose();
    track.sample(100 + track.delay - 70, out); // between the two, closer to the first
    expect(out.left.present).toBe(true);
    expect(out.left.wrist[0]).toBeCloseTo(0.2, 5);
    track.sample(10_000, out);
    expect(out.left.present).toBe(false);
  });

  it('reports age for staleness', () => {
    const track = new PoseTrack();
    expect(track.sample(0, emptyPose())).toBe(false);
    track.push(frame(0, 0), 1000);
    expect(track.age(4000)).toBe(3000);
  });

  it('slerps along the short arc', () => {
    const out = [0, 0, 0, 0];
    const s = Math.SQRT1_2;
    slerp([0, 0, 0, 1], [0, -s, 0, -s], 0.5, out); // -q of a +90° turn
    expect(Math.abs(out[1])).toBeCloseTo(Math.sin(Math.PI / 8), 5);
    expect(Math.hypot(...out)).toBeCloseTo(1, 6);
  });
});

describe('links and lines', () => {
  it('builds and reads share links', () => {
    const link = liveLink('K7M4QX', 'isl_42', 'https://wayfolk.example/island');
    expect(link).toBe('https://wayfolk.example/island?live=K7M4QX&island=isl_42');
    expect(parseLiveLink(link)).toEqual({ code: 'K7M4QX', island: 'isl_42' });
    expect(parseLiveLink('/island?live=k7m-4qx')).toEqual({ code: 'K7M4QX', island: null });
    expect(parseLiveLink('/island?live=nope')).toBeNull();
  });

  it('says one plain line when live does not work', () => {
    expect(liveMessage('live', null, 'host')).toBeNull();
    expect(liveMessage('connecting', null, 'guest')).toBeNull();
    for (const [state, reason, role] of [
      ['off', 'unreachable', 'host'],
      ['off', 'unreachable', 'guest'],
      ['off', 'no-room', null],
      ['off', 'full', null],
      ['off', 'ended', 'guest'],
      ['lost', 'dropped', 'guest'],
      ['lost', 'gone', 'host'],
    ] as const) {
      const line = liveMessage(state, reason, role);
      expect(line).toBeTruthy();
      expect(line).not.toMatch(/!/);
      expect(line!.length).toBeLessThan(100);
    }
  });
});
