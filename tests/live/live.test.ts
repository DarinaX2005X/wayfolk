/**
 * createLive end to end in Node, against the local relay: two "apps" with a camera and an
 * island root each. The host's snapshot reaches the guest before events, presence turns
 * into an avatar at the right island-local place, and the avatar leaves when the guest
 * does.
 */
import { Group, PerspectiveCamera, Vector3 } from '@iwsdk/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Avatar } from '../../src/live/avatar';
import { emptyPose } from '../../src/live/interp';
import { createLive, type Live } from '../../src/live/index';
import type { IslandState } from '../../src/mind/types';
import { startFakeRelay, type FakeRelay } from './fake-relay';
import { waitFor } from './suite';

let relay: FakeRelay;
beforeAll(async () => {
  relay = await startFakeRelay();
});
afterAll(async () => {
  await relay.close();
});

const island = { id: 'isl-live', name: 'Driftwood', houses: [] } as unknown as IslandState;

function pump(lives: Live[], ms: number): Promise<void> {
  return new Promise((resolve) => {
    const end = Date.now() + ms;
    const tick = () => {
      for (const l of lives) l.update(1 / 60);
      if (Date.now() >= end) resolve();
      else setTimeout(tick, 16);
    };
    tick();
  });
}

describe('createLive', () => {
  it('syncs the island, events and presence between a host and a guest', async () => {
    const hostCam = new PerspectiveCamera();
    hostCam.position.set(0, 1.2, 0);
    const hostSpace = new Group();
    // The guest's island root sits elsewhere in its own world: presence is island-local.
    const guestSpace = new Group();
    guestSpace.position.set(5, 0, 0);
    const guestCam = new PerspectiveCamera();
    guestCam.position.set(6, 1.1, -2);
    const host = createLive({ world: { camera: hostCam }, space: hostSpace }, { relay: relay.url, name: 'Mira', storage: null, autoPlayVoice: false, snapshot: () => island });
    const guest = createLive({ world: { camera: guestCam }, space: guestSpace }, { relay: relay.url, name: 'Tom', storage: null, autoPlayVoice: false });
    try {
      const got: string[] = [];
      guest.on('snapshot', (s) => got.push(`snapshot:${s.id}`));
      guest.on('house-placed', (d, from) => got.push(`house:${d.spec.id}:${from.name}`));
      const { code, link } = await host.host('isl-live');
      expect(link).toContain(`live=${code}`);
      expect(link).toContain('island=isl-live');
      await guest.join(code);
      expect(guest.role).toBe('guest');
      expect(guest.hostOnline).toBe(true);
      await waitFor(() => got.includes('snapshot:isl-live'), 5000, 'snapshot');
      host.send('house-placed', { spec: { id: 'h1' } as never });
      await waitFor(() => got.length === 2, 5000, 'house event');
      expect(got).toEqual(['snapshot:isl-live', 'house:h1:Mira']);
      expect(() => host.send('state' as never, {} as never)).toThrow();

      await pump([host, guest], 700);
      const tom = host.peers[0];
      const root = host.avatarOf(tom.id);
      expect(root?.visible).toBe(true);
      const avatar = root?.userData.avatar as Avatar;
      const head = avatar.head.position;
      expect(head.x).toBeCloseTo(1, 1);
      expect(head.y).toBeCloseTo(1.1, 1);
      expect(head.z).toBeCloseTo(-2, 1);
      expect(host.avatars.children).toHaveLength(1);

      const left: string[] = [];
      host.on('leave', (p) => left.push(p.name));
      guest.leave();
      await waitFor(() => left.length === 1, 5000, 'leave');
      expect(host.avatars.children).toHaveLength(0);
      expect(guest.state).toBe('off');
      expect(guest.message).toBeNull();
    } finally {
      host.dispose();
      guest.dispose();
    }
  }, 20_000);

  it('tells the guest plainly when the room is not there', async () => {
    const live = createLive({}, { relay: relay.url, storage: null, autoPlayVoice: false });
    const lines: (string | null)[] = [];
    live.on('state', (_s, _r, message) => lines.push(message));
    await expect(live.join('ZZZZZZ')).rejects.toMatchObject({ reason: 'no-room' });
    expect(live.message).toBe('This island isn’t open for a live visit right now. You can still visit it on your own.');
    expect(lines.at(-1)).toBe(live.message);
    live.dispose();
  });

  it('says the relay is unreachable without hanging', async () => {
    const live = createLive({}, { relay: 'http://127.0.0.1:9', storage: null, autoPlayVoice: false });
    await expect(live.host('isl-x')).rejects.toMatchObject({ reason: 'unreachable' });
    expect(live.state).toBe('off');
    expect(live.message).toMatch(/Friends can still visit your island later/);
    live.dispose();
  });
});

describe('avatar', () => {
  it('pops in with hands from the pose and hides when stale', () => {
    const a = new Avatar({ name: 'Ana', color: '#e2a93b' });
    const pose = a.pose;
    Object.assign(pose, emptyPose());
    pose.pos = [0, 1.2, -1];
    pose.left.present = true;
    pose.left.wrist = [-0.2, 1, -0.8];
    pose.left.tips = [-0.15, 1, -0.95, -0.17, 1.02, -0.97, -0.2, 1.02, -0.98, -0.22, 1.01, -0.97, -0.24, 1, -0.95];
    a.setActive(true);
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    expect(a.root.visible).toBe(true);
    expect(a.head.position.distanceTo(new Vector3(0, 1.2, -1))).toBeLessThan(1e-3);
    // Every instance matrix is finite.
    a.root.traverse((o) => {
      const m = (o as { instanceMatrix?: { array: Float32Array } }).instanceMatrix;
      if (m) for (const v of m.array) expect(Number.isFinite(v)).toBe(true);
    });
    a.setActive(false);
    for (let i = 0; i < 60; i++) a.update(1 / 60);
    expect(a.root.visible).toBe(false);
    a.dispose();
  });
});
