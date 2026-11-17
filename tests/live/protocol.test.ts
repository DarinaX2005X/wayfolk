import { describe, expect, it } from 'vitest';
import {
  Bucket,
  CODE_ALPHABET,
  LIMITS,
  backoff,
  cleanName,
  closeReason,
  decodePresence,
  decodeVoice,
  encodePresence,
  encodeVoice,
  formatCode,
  frameKind,
  isFinalClose,
  makeCode,
  makeId,
  normalizeCode,
  parseClientMsg,
  presenceSize,
  randomString,
  type Presence,
} from '../../src/live/protocol';

const quat = (axis: [number, number, number], angle: number): [number, number, number, number] => {
  const s = Math.sin(angle / 2);
  const n = Math.hypot(...axis);
  return [(axis[0] / n) * s, (axis[1] / n) * s, (axis[2] / n) * s, Math.cos(angle / 2)];
};

function full(): Presence {
  const tips = (x: number): [number, number, number][] => [0, 1, 2, 3, 4].map((i) => [x + i * 0.012, 1.02 - i * 0.003, -30.95 - i * 0.01]);
  return {
    seq: 65535,
    time: 4_294_967_000,
    slot: 0,
    talking: false,
    immersive: true,
    head: { pos: [12.345, 1.234, -30.5], quat: quat([0.2, 1, 0.1], 2.4) },
    left: { wrist: [12.1, 0.95, -30.9], quat: quat([1, 0.3, -0.2], -1.1), tips: tips(12.05) },
    right: { wrist: [12.6, 0.97, -30.8], quat: quat([0, 0, 1], 0.4) },
  };
}

describe('presence frames', () => {
  it('round-trips within the quantization steps', () => {
    const p = full();
    const buf = encodePresence(p);
    expect(buf.byteLength).toBe(presenceSize(p));
    expect(buf.byteLength).toBe(24 + 44 + 14);
    const d = decodePresence(buf)!;
    expect(d.seq).toBe(65535);
    expect(d.time).toBe(4_294_967_000);
    expect(d.immersive).toBe(true);
    expect(d.talking).toBe(false);
    for (let i = 0; i < 3; i++) expect(Math.abs(d.head.pos[i] - p.head.pos[i])).toBeLessThanOrEqual(0.001 + 1e-9);
    // Same rotation (q and -q are one rotation): |dot| close to 1.
    const dot = (a: number[], b: number[]) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
    expect(dot(d.head.quat, p.head.quat)).toBeGreaterThan(0.99999);
    expect(dot(d.left!.quat, p.left!.quat)).toBeGreaterThan(0.99999);
    for (let i = 0; i < 3; i++) {
      // Hands are stored relative to the head, so their error adds the head's.
      expect(Math.abs(d.left!.wrist[i] - p.left!.wrist[i])).toBeLessThan(0.0012);
      expect(Math.abs(d.left!.tips![4][i] - p.left!.tips![4][i])).toBeLessThan(0.0012);
    }
    expect(d.right!.tips).toBeUndefined();
    expect(d.right!.wrist[0]).toBeCloseTo(12.6, 2);
  });

  it('keeps a head-only frame small and rejects malformed ones', () => {
    const p: Presence = { seq: 1, time: 5, slot: 0, talking: true, immersive: false, head: { pos: [0, 1.2, 0], quat: [0, 0, 0, 1] } };
    const buf = encodePresence(p);
    expect(buf.byteLength).toBe(24);
    expect(decodePresence(buf)?.talking).toBe(true);
    expect(decodePresence(buf.subarray(0, 20))).toBeNull();
    const wrongFlags = buf.slice();
    wrongFlags[8] |= 1; // claims a left hand that is not there
    expect(decodePresence(wrongFlags)).toBeNull();
    expect(frameKind(buf)).toBe('presence');
    expect(frameKind(new Uint8Array([9, 0, 0]))).toBeNull();
  });

  it('clamps positions beyond the range instead of wrapping', () => {
    const p: Presence = { seq: 1, time: 5, slot: 0, talking: false, immersive: false, head: { pos: [500, -500, 0], quat: [0, 0, 0, 2] } };
    const d = decodePresence(encodePresence(p))!;
    expect(d.head.pos[0]).toBeCloseTo(65.534, 2);
    expect(d.head.pos[1]).toBeCloseTo(-65.534, 2);
    expect(d.head.quat[3]).toBeCloseTo(1, 4);
  });

  it('keeps the slot the relay writes', () => {
    const buf = encodePresence(full());
    buf[1] = 3;
    expect(decodePresence(buf)?.slot).toBe(3);
  });
});

describe('voice frames', () => {
  it('round-trips audio, mime and duration', () => {
    const audio = new Uint8Array(5000).map((_, i) => (i * 7) & 255);
    const buf = encodeVoice(70000, 4321, 'audio/webm;codecs=opus', audio);
    expect(frameKind(buf)).toBe('voice');
    const v = decodeVoice(buf)!;
    expect(v.clip).toBe(70000 & 0xffff);
    expect(v.durationMs).toBe(4321);
    expect(v.mime).toBe('audio/webm;codecs=opus');
    expect([...v.audio]).toEqual([...audio]);
  });

  it('refuses a clip over the size cap', () => {
    const buf = encodeVoice(1, 1000, 'audio/webm', new Uint8Array(LIMITS.voiceBytes));
    expect(frameKind(buf)).toBeNull();
    expect(decodeVoice(buf)).toBeNull();
  });
});

describe('client messages', () => {
  it('accepts a hello and cleans the name', () => {
    const m = parseClientMsg(JSON.stringify({ t: 'hi', v: 1, pid: 'abcdefgh12', psk: 'zzzzzzzz99', name: '  Mira‮  the\n great baker of the cloud sea ', color: '#3f9e98', key: 'k' }));
    expect(m).toMatchObject({ t: 'hi', name: 'Mira the great baker of', color: '#3f9e98', key: 'k' });
  });

  it('rejects malformed messages', () => {
    expect(parseClientMsg('nope')).toBeNull();
    expect(parseClientMsg('[]')).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'hi', v: 2, pid: 'abcdefgh12', psk: 'zzzzzzzz99' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'hi', v: 1, pid: 'AB', psk: 'zzzzzzzz99' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'ev', k: 'Bad Kind' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'ev', k: 'say', to: '../x' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'snap', d: {}, to: 'x' }))).toBeNull();
    expect(parseClientMsg(JSON.stringify({ t: 'snap', d: {}, to: '*' }))).toEqual({ t: 'snap', d: {}, to: '*' });
    expect(parseClientMsg(JSON.stringify({ t: 'ev', k: 'say', d: { text: 'hi' } }))).toEqual({ t: 'ev', k: 'say', d: { text: 'hi' }, to: undefined });
  });

  it('cleans names of control characters and keeps a fallback', () => {
    expect(cleanName('\u0000​')).toBe('Friend');
    expect(cleanName(42, 'A friend')).toBe('A friend');
    expect(cleanName('Ana 🌸')).toBe('Ana 🌸');
  });
});

describe('codes, ids and timing', () => {
  it('makes readable codes and accepts what people type', () => {
    for (let i = 0; i < 50; i++) {
      const code = makeCode();
      expect(code).toHaveLength(6);
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
      expect(normalizeCode(formatCode(code).toLowerCase())).toBe(code);
    }
    expect(normalizeCode('k7m-4qx')).toBe('K7M4QX');
    expect(normalizeCode('K7M4Q0')).toBeNull();
    expect(normalizeCode('K7M4Q')).toBeNull();
    expect(formatCode('K7M4QX')).toBe('K7M 4QX');
    expect(makeId()).toMatch(/^[a-z0-9]{16}$/);
  });

  it('draws characters evenly', () => {
    let n = 0;
    const seq = () => new Uint8Array(4).map(() => n++ & 255);
    const s = randomString(2000, 'abc', seq);
    const counts = { a: 0, b: 0, c: 0 } as Record<string, number>;
    for (const ch of s) counts[ch]++;
    for (const c of Object.values(counts)) expect(Math.abs(c - 2000 / 3)).toBeLessThan(40);
  });

  it('backs off from half a second to eight', () => {
    expect(backoff(0, () => 0.5)).toBe(500);
    expect(backoff(1, () => 0.5)).toBe(1000);
    expect(backoff(10, () => 0.5)).toBe(8000);
    expect(backoff(10, () => 0)).toBe(6000);
  });

  it('limits a token bucket to rate and burst', () => {
    const b = new Bucket(10, 3, 0);
    expect([b.take(0), b.take(0), b.take(0), b.take(0)]).toEqual([true, true, true, false]);
    expect(b.take(50)).toBe(false);
    expect(b.take(100)).toBe(true);
    expect(b.take(10_000) && b.take(10_000) && b.take(10_000)).toBe(true);
    expect(b.take(10_000)).toBe(false);
  });

  it('knows which close codes end the visit', () => {
    expect(closeReason(4001)).toBe('full');
    expect(isFinalClose(4001)).toBe(true);
    expect(isFinalClose(4013)).toBe(false);
    expect(isFinalClose(1006)).toBe(false);
  });
});
