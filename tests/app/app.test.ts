import { describe, expect, it } from 'vitest';
import { parseAppParams } from '../../src/app/params';
import { createSessionFlow, modeFor, type XRSessionKind } from '../../src/app/boot/session';
import { isPalmUp } from '../../src/app/hands/hands';
import { isFrameGesture } from '../../src/app/postcard';
import { encodeQr } from '../../src/kit/ui/qr';
import { resolveRoute } from '../../src/pages/router';

describe('routes', () => {
  it('serves the landing, the island alias and postcards', () => {
    expect(resolveRoute('/')?.name).toBe('home');
    expect(resolveRoute('/island')?.name).toBe('home');
    expect(resolveRoute('/p/abc123')).toEqual({ name: 'postcard', code: 'abc123' });
    expect(resolveRoute('/p/')).toBeNull();
    expect(resolveRoute('/nowhere')).toBeNull();
  });
});

describe('page parameters', () => {
  it('ignores test parameters where debug hooks are off', () => {
    expect(parseAppParams('?pace=0.2&fresh=1', false)).toMatchObject({ pace: 1, fresh: false });
  });
  it('reads them where they are on', () => {
    expect(parseAppParams('?pace=0.2&fresh=1&later=1', true)).toMatchObject({ pace: 0.2, fresh: true, later: true });
    expect(parseAppParams('?pace=-3', true).pace).toBe(1);
  });
});

describe('session flow', () => {
  it('passthrough exists only in AR', () => {
    expect(modeFor('immersive-ar', 'room')).toBe('room');
    expect(modeFor('immersive-vr', 'room')).toBe('void');
  });
  it('falls back from AR to VR and reports the mode', async () => {
    let running: XRSessionKind | null = null;
    const modes: string[] = [];
    const flow = createSessionFlow({
      active: () => running,
      supported: async (k) => k === 'immersive-vr',
      request: async (k) => {
        running = k;
        return true;
      },
      end: () => (running = null),
      setMode: (m) => modes.push(m),
    });
    await flow.enter('room');
    expect(running).toBe('immersive-vr');
    expect(modes.at(-1)).toBe('void');
  });
  it('rejects when no immersive session is possible', async () => {
    const flow = createSessionFlow({ active: () => null, supported: async () => false, request: async () => false, end: () => undefined, setMode: () => undefined });
    await expect(flow.enter('room')).rejects.toThrow('xr-unavailable');
  });
});

describe('hand rules', () => {
  it('a perch is an open palm facing up', () => {
    expect(isPalmUp(0.9, true)).toBe(true);
    expect(isPalmUp(0.9, false)).toBe(false);
    expect(isPalmUp(0.2, true)).toBe(false);
  });
  it('the postcard frame needs two open L shapes apart in front of the eyes', () => {
    const ok = { leftThumbIndex: 0.09, rightThumbIndex: 0.09, handsApart: 0.3, ahead: 0.4, heightBelowEyes: 0.1 };
    expect(isFrameGesture(ok)).toBe(true);
    expect(isFrameGesture({ ...ok, leftThumbIndex: 0.02 })).toBe(false);
    expect(isFrameGesture({ ...ok, handsApart: 0.05 })).toBe(false);
    expect(isFrameGesture({ ...ok, ahead: 0.05 })).toBe(false);
  });
});

describe('qr', () => {
  it('fits a postcard link and draws the three finder patterns', () => {
    const qr = encodeQr('https://wayfolk.vercel.app/p/x4km7q2a');
    expect(qr.version).toBeLessThanOrEqual(4);
    expect(qr.size).toBe(qr.version * 4 + 17);
    for (const [x, y] of [
      [0, 0],
      [qr.size - 7, 0],
      [0, qr.size - 7],
    ]) {
      expect(qr.dark(x, y)).toBe(true);
      expect(qr.dark(x + 1, y + 1)).toBe(false);
      expect(qr.dark(x + 3, y + 3)).toBe(true);
    }
  });
  it('refuses text that is too long', () => {
    expect(() => encodeQr('x'.repeat(400))).toThrow();
  });
});
