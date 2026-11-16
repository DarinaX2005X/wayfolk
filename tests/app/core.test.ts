/**
 * The small rules of src/app/: the action registry, the application clock, page
 * parameters, settings, the session rule, the seated frame, plane picking, the feature
 * order and the routes.
 */
import { describe, expect, it, vi } from 'vitest';
import { FAILED, NOT_AVAILABLE, hasAction, onActionsChange, registerAction, runAction } from '../../src/app/actions';
import { createClock } from '../../src/app/clock';
import { parseAppParams } from '../../src/app/params';
import { defaultSettings, sanitizeSettings } from '../../src/app/store';
import { nameOf, sortFeatures } from '../../src/app/boot/features';
import { DEVICE_VIEW, deskSeat, fovCone, seatFrom, seatToWorld, worldToSeat } from '../../src/app/boot/place';
import { createSessionFlow, XRUnavailableError, type SessionPort, type XRSessionKind } from '../../src/app/boot/session';
import { pickSurface, type PlaneInfo } from '../../src/app/boot/surfaces';
import { resolveRoute } from '../../src/pages/router';

describe('actions', () => {
  it('answers an unregistered action with the readable refusal, never by throwing', async () => {
    expect(hasAction('export')).toBe(false);
    expect(await runAction('export', 'p_abc')).toEqual({ ok: false, reason: NOT_AVAILABLE });
    expect(NOT_AVAILABLE).toBe("This isn't available in this copy.");
  });

  it('runs a registered action with its arguments and tells listeners about changes', async () => {
    const seen: string[] = [];
    const changes = vi.fn();
    const stop = onActionsChange(changes);
    const off = registerAction('visit-code', (code) => {
      seen.push(code);
    });
    expect(hasAction('visit-code')).toBe(true);
    expect(await runAction('visit-code', 'W4KM7')).toEqual({ ok: true });
    expect(seen).toEqual(['W4KM7']);
    off();
    expect(hasAction('visit-code')).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
    stop();
  });

  it('passes a refusal through and turns a failure into a retry line', async () => {
    const offA = registerAction('share', () => ({ ok: false, reason: 'Sharing needs the network.' }));
    expect(await runAction('share', 'p')).toEqual({ ok: false, reason: 'Sharing needs the network.' });
    offA();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const offB = registerAction('rerun', async () => {
      throw new Error('boom');
    });
    expect(await runAction('rerun', 'p')).toEqual({ ok: false, reason: FAILED });
    offB();
    error.mockRestore();
  });

  it('does not let an old unregister remove a newer registration', () => {
    const first = registerAction('together', () => undefined);
    const second = registerAction('together', () => undefined);
    first();
    expect(hasAction('together')).toBe(true);
    second();
    expect(hasAction('together')).toBe(false);
  });
});

describe('clock', () => {
  it('runs with its source and fires timers in order on tick', () => {
    let source = 1000;
    const clock = createClock(() => source, () => Date.UTC(2026, 10, 16, 12));
    const fired: string[] = [];
    clock.timers.set(() => fired.push('b'), 200);
    clock.timers.set(() => fired.push('a'), 100);
    const gone = clock.timers.set(() => fired.push('never'), 150);
    clock.timers.clear(gone);
    source += 150;
    expect(clock.now()).toBe(150);
    clock.tick();
    expect(fired).toEqual(['a']);
    source += 100;
    clock.tick();
    expect(fired).toEqual(['a', 'b']);
  });

  it('stands still when frozen and moves only by step, firing timers inside a long step in order', () => {
    let source = 0;
    const clock = createClock(() => source);
    clock.freeze(true);
    const seen: number[] = [];
    clock.timers.set(() => seen.push(clock.now()), 30);
    clock.timers.set(() => {
      seen.push(clock.now());
      clock.timers.set(() => seen.push(clock.now()), 10);
    }, 50);
    source += 10_000;
    clock.tick();
    expect(clock.now()).toBe(0);
    clock.step(100);
    expect(seen).toEqual([30, 50, 60]);
    expect(clock.now()).toBe(100);
  });

  it('keeps the wall date moving with application time and lets a scenario set it', () => {
    let source = 0;
    const clock = createClock(() => source, () => Date.UTC(2026, 10, 16, 12));
    clock.set('2027-03-01T09:00:00.000Z');
    source += 60_000;
    expect(clock.wall().toISOString()).toBe('2027-03-01T09:01:00.000Z');
    expect(() => clock.set('not a date')).toThrow();
  });
});

describe('page parameters', () => {
  it('reads run, answers, pace and capture only where debug hooks are on', () => {
    const on = parseAppParams('?run=harbor-street&answers=scripted&pace=0.25&capture=1', true);
    expect(on).toEqual({ run: 'harbor-street', answers: 'scripted', pace: 0.25, capture: true, debug: false });
    const off = parseAppParams('?run=harbor-street&answers=scripted&pace=0.25', false);
    expect(off).toEqual({ run: null, answers: null, pace: 1, capture: false, debug: false });
  });

  it('ignores unknown examples, a live answer set and nonsense pace', () => {
    const p = parseAppParams('?run=nope&answers=live&pace=-3&debug=1', true);
    expect(p).toMatchObject({ run: null, answers: null, pace: 1, debug: true });
    expect(parseAppParams('?pace=0', true).pace).toBe(0);
  });
});

describe('settings', () => {
  it('starts with sound and captions on and a dwell of 800 ms', () => {
    expect(defaultSettings()).toMatchObject({ sound: true, captions: true, dwellMs: 800, largeText: false });
  });

  it('keeps sound stored values and drops broken ones', () => {
    expect(sanitizeSettings({ sound: false, largeText: true, dwellMs: 1200, extra: 1 })).toMatchObject({
      sound: false,
      largeText: true,
      dwellMs: 1200,
      captions: true,
    });
    expect(sanitizeSettings({ sound: 'no', dwellMs: 999 })).toMatchObject({ sound: true, dwellMs: 800 });
    expect(sanitizeSettings([1, 2])).toBeUndefined();
  });
});

describe('session rule', () => {
  function port(answers: Partial<Record<XRSessionKind, boolean>>): SessionPort & { modes: string[]; running: XRSessionKind | null } {
    const p = {
      modes: [] as string[],
      running: null as XRSessionKind | null,
      active: () => p.running,
      supported: async (kind: XRSessionKind) => kind in answers,
      request: async (kind: XRSessionKind) => {
        if (answers[kind]) p.running = kind;
        return answers[kind] === true;
      },
      end: () => {
        p.running = null;
      },
      setMode: (mode: string) => {
        p.modes.push(mode);
      },
    };
    return p;
  }

  it('enters the Void in AR and switches to Room and back without leaving the session', async () => {
    const p = port({ 'immersive-ar': true });
    const flow = createSessionFlow(p);
    await flow.enter('void');
    expect(flow.setMode('room')).toBe('room');
    expect(flow.setMode('void')).toBe('void');
    expect(p.running).toBe('immersive-ar');
    expect(p.modes).toEqual(['void', 'room', 'void']);
  });

  it('falls back to VR, where Room is not possible', async () => {
    const p = port({ 'immersive-ar': false, 'immersive-vr': true });
    const flow = createSessionFlow(p);
    await flow.enter('room');
    expect(p.modes).toEqual(['void']);
    expect(flow.setMode('room')).toBe('void');
    expect(flow.roomPossible()).toBe(false);
  });

  it('stays at the desk and rejects with xr-unavailable when nothing starts', async () => {
    const p = port({ 'immersive-ar': false });
    const flow = createSessionFlow(p);
    await expect(flow.enter('void')).rejects.toBeInstanceOf(XRUnavailableError);
    expect(p.modes).toEqual(['desk']);
    expect(flow.setMode('room')).toBe('desk');
  });

  it('shares one request between two quick calls', async () => {
    const p = port({ 'immersive-ar': true });
    const request = vi.spyOn(p, 'request');
    const flow = createSessionFlow(p);
    await Promise.all([flow.enter('void'), flow.enter('void')]);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('seated frame', () => {
  it('turns with the head but stays level, and maps points both ways', () => {
    // Looking 30° to the right and a little down.
    const a = (30 * Math.PI) / 180;
    const seat = seatFrom([1, 1.2, 2], [Math.sin(a), -0.3, -Math.cos(a)]);
    expect(seat.forward[1]).toBe(0);
    const ahead = seatToWorld(seat, [0, -0.32, -0.45]);
    expect(ahead[0]).toBeCloseTo(1 + 0.45 * Math.sin(a), 6);
    expect(ahead[1]).toBeCloseTo(0.88, 6);
    expect(ahead[2]).toBeCloseTo(2 - 0.45 * Math.cos(a), 6);
    const back = worldToSeat(seat, ahead);
    expect(back[0]).toBeCloseTo(0, 6);
    expect(back[2]).toBeCloseTo(-0.45, 6);
  });

  it('uses the top of the head when the person looks straight down at entry', () => {
    const seat = seatFrom([0, 1.1, 0], [0, -1, 0], [0, 0, -1]);
    expect(seat.forward[2]).toBeCloseTo(-1, 6);
    expect(deskSeat().origin[1]).toBe(1.15);
  });

  it('tells whether a point is in the narrow view of the glasses', () => {
    const glasses = fovCone(DEVICE_VIEW.glasses, 2);
    expect(glasses([0, -0.32, -0.5])).toBe(true);
    // 40° to the side is outside the glasses (37°) but inside a Quest.
    const side: [number, number, number] = [Math.sin((40 * Math.PI) / 180), 0, -Math.cos((40 * Math.PI) / 180)];
    expect(glasses(side)).toBe(false);
    expect(fovCone(DEVICE_VIEW.quest3)(side)).toBe(true);
    expect(glasses([0, 0, 1])).toBe(false);
  });
});

describe('room planes', () => {
  const seat = seatFrom([0, 1.15, 0], [0, 0, -1]);
  const plane = (p: Partial<PlaneInfo>): PlaneInfo => ({
    center: [0, 1.2, -2],
    normal: [0, 0, 1],
    width: 2,
    height: 2.4,
    orientation: 'vertical',
    label: 'wall',
    ...p,
  });

  it('picks the wall ahead and not a door, a narrow wall, one too far or behind', () => {
    const planes = [
      plane({ label: 'door', center: [0, 1, -1.5] }),
      plane({ width: 0.9, center: [0.2, 1.2, -1.6] }),
      plane({ center: [0, 1.2, -4] }),
      plane({ center: [0, 1.2, 2] }),
      plane({ center: [2.5, 1.2, -1] }),
      plane({ center: [0.3, 1.2, -2.2] }),
    ];
    expect(pickSurface('wall', planes, seat, 0)).toBe(5);
    expect(pickSurface('wall', planes.slice(0, 5), seat, 0)).toBeNull();
  });

  it('finds the wall the person faces obliquely, by where the line of sight meets it', () => {
    // sunlit_living_room seated at the 0.74 m table, facing 145° to the left (tests/xr/README.md).
    const side = seatFrom([-0.635, 1.15, 0.9], [-0.5736, 0, 0.8192]);
    const back = plane({ center: [0, 1.35, 2.4], normal: [0, 0, -1], width: 5 });
    const far = plane({ center: [0, 1.35, -3.4], normal: [0, 0, 1], width: 5 });
    expect(pickSurface('wall', [far, back], side, 0)).toBe(1);
  });

  it('picks a table at sitting height in front, not the floor or a shelf', () => {
    const flat = (center: [number, number, number], w = 1, d = 0.6): PlaneInfo => ({
      center,
      normal: [0, 1, 0],
      width: w,
      height: d,
      orientation: 'horizontal',
      label: 'table',
    });
    const planes = [flat([0, 0, -1]), flat([0, 1.4, -0.5]), flat([0, 0.72, -0.5]), flat([0, 0.7, -1.5])];
    expect(pickSurface('table', planes, seat, 0)).toBe(2);
    expect(pickSurface('table', planes, seat, 0.5)).toBeNull();
  });
});

describe('features', () => {
  it('orders install modules by order, then by folder, from every allowed place', () => {
    const feature = (order: number) => ({ order, install: () => undefined });
    const sorted = sortFeatures({
      '../../views/run/install.ts': feature(20),
      '../core/install.ts': feature(0),
      '../../views/home/install.ts': feature(10),
      '../../voice/install.ts': feature(50),
      '../../views/check/install.ts': feature(20),
    });
    expect(sorted.map((f) => f.name)).toEqual(['app/core', 'views/home', 'views/check', 'views/run', 'voice']);
    expect(nameOf('../../public-world/install.ts')).toBe('public-world');
  });

  it('refuses a module without order or install', () => {
    expect(() => sortFeatures({ '../../views/x/install.ts': { install: () => undefined } })).toThrow('must export');
  });
});

describe('routes', () => {
  it.each([
    ['/', { name: 'landing' }],
    ['/app', { name: 'app' }],
    ['/APP/', { name: 'app' }],
    ['/go', { name: 'go', code: null }],
    ['/go/X4KM7', { name: 'go', code: 'X4KM7' }],
    ['/drop/D7KQ2', { name: 'drop', code: 'D7KQ2' }],
    ['/w/quiet-meadow-27', { name: 'world', world: 'quiet-meadow-27', work: null }],
    ['/w/quiet-meadow-27/harbor-street', { name: 'world', world: 'quiet-meadow-27', work: 'harbor-street' }],
    ['/j/J3MPX', { name: 'join', code: 'J3MPX' }],
    ['/x/X4KM7', { name: 'export', code: 'X4KM7' }],
    ['/gallery', { name: 'gallery' }],
  ])('%s', (path, expected) => {
    expect(resolveRoute(path)).toMatchObject(expected);
  });

  it.each(['/c/kite-plum-27', '/bench', '/w', '/x', '/w/a/b/c', '/app/extra'])('%s has no page', (path) => {
    expect(resolveRoute(path)).toBeNull();
  });
});
