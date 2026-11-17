/**
 * Live visits: a friend joins someone's island from a link, from any network, and they
 * see and hear each other. createLive(app) puts the relay client, the visitors' avatars,
 * push-to-talk voice notes and the local pose sampling together behind one object.
 *
 *   const live = createLive(app, { name: 'Mira', snapshot: () => mind.state });
 *   const { code, link } = await live.host(mind.state.id);    // share the link
 *   await live.join(parseLiveLink(location.href)!.code);       // on the friend's side
 *   live.on('snapshot', (island) => ...);                      // guest: the host's island
 *   live.on('house-placed', ({ spec }, from) => ...);          // events of the room
 *   live.startTalk() / live.stopTalk();                        // the talk gesture
 *
 * The host is authoritative: every guest who joins (or comes back after a drop) gets the
 * host's island snapshot first; events that arrive before it are already in it and are
 * skipped. Only the host may send the island-changing events (HOST_ONLY_EVENTS).
 *
 * Presence is island-local, so put the guest somewhere on the host's island (a spot of
 * the world, not the host's seat) and they see each other where they are.
 */
import { Group, type Camera, type Object3D } from '@iwsdk/core';
import type { HouseSpec, IslandState, P2, Resident } from '../mind/types';
import { Avatar } from './avatar';
import { LiveClient, type LivePeer, type LiveReason, type LiveState } from './client';
import { LINK_PATH, LIVE_RELAY, PRESENCE_HZ } from './config';
import { PoseTrack } from './interp';
import { PoseReader, poseMoved, type PoseWorld } from './pose';
import { encodePresence, formatCode, normalizeCode, type Presence, type RoomInfo } from './protocol';
import { TalkRecorder, VoicePlayer, defaultMic } from './voice';

export type { LivePeer, LiveReason, LiveState } from './client';
export { HOST_ONLY_EVENTS, PEER_COLORS, ROOM_SIZE, formatCode, normalizeCode } from './protocol';
export { LIVE_RELAY } from './config';
export { Avatar } from './avatar';
export { LiveClient } from './client';

/** Events of a live room and their data. Island-changing ones come only from the host. */
export interface LiveEventMap {
  /** The host placed a house (the ghost footprint was confirmed). */
  'house-placed': { spec: HouseSpec };
  /** The flock started building it. */
  'build-started': { spec: HouseSpec };
  'traveler-arrived': { resident: Resident };
  /** The host's island changed in a way events do not cover: the whole state again. */
  island: { state: IslandState };
  /** A gift handed to a resident, by anyone in the room. */
  'gift-given': { residentId: string; item: string; prop?: string };
  /** A speech bubble: a resident's line (residentId) or a person's own words. */
  say: { text: string; residentId?: string; choices?: string[] };
  /** Someone glided to a spot. */
  glide: { to: P2 };
}

export interface LiveSignals {
  /** Connection state; `message` is the one plain line to show, or null. */
  state: (state: LiveState, reason: LiveReason | null, message: string | null) => void;
  /** Anyone came, left or changed name or colour. */
  peers: (peers: LivePeer[]) => void;
  join: (peer: LivePeer) => void;
  leave: (peer: LivePeer) => void;
  /** Guest: the host's island, on joining and after every reconnect. */
  snapshot: (island: IslandState, from: LivePeer) => void;
  /** A voice note arrived (it also plays from the avatar unless autoPlayVoice is off). */
  voice: (note: { from: LivePeer; audio: Uint8Array; mime: string; durationMs: number }) => void;
  /** The local talk clip started or stopped. */
  talk: (active: boolean) => void;
  /** The relay refused something we sent ('rate', 'too-big', 'not-host', 'no-peer', 'bad'). */
  error: (code: string, about?: string) => void;
}

const RESERVED = new Set<string>(['state', 'peers', 'join', 'leave', 'snapshot', 'voice', 'talk', 'error']);

/** What createLive needs from the app; the app's App object fits. */
export interface LiveApp {
  world?: PoseWorld & { scene?: Object3D };
  /** The island root: presence is shared in its frame and avatars live in it. */
  space?: Object3D;
  roots?: { island?: Object3D; level?: Object3D };
  everyFrame?(fn: (dt: number, now: number) => void): () => void;
}

export interface LiveOptions {
  relay?: string;
  /** The person's name on their tag. */
  name?: string;
  /** A preferred colour (one of PEER_COLORS); the relay gives a free one when taken. */
  color?: string;
  /** Base of share links; default `${location.origin}/island`. */
  linkBase?: string;
  /** Host: the island state a joining guest receives. */
  snapshot?: () => IslandState | null;
  /** Audio context for voice playback; default one of its own, made on first use. */
  audio?: () => AudioContext | null;
  /** Microphone stream for talk clips; default getUserMedia with echo cancellation. */
  mic?: () => Promise<MediaStream>;
  autoPlayVoice?: boolean;
  /** Ground height of the island at (x, z) in its frame, for the avatars' blob shadows. */
  ground?: (x: number, z: number) => number | null;
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void } | null;
}

export interface Live {
  readonly state: LiveState;
  readonly reason: LiveReason | null;
  /** One plain line for the person when live is not working, else null. */
  readonly message: string | null;
  readonly role: 'host' | 'guest' | null;
  readonly code: string | null;
  readonly link: string | null;
  readonly room: RoomInfo | null;
  readonly me: LivePeer | null;
  /** Everyone else in the room. */
  readonly peers: LivePeer[];
  /** Whether the host is in the room (always true for the host). */
  readonly hostOnline: boolean;
  /** Group of the visitors' avatars (inside the island root when one was given). */
  readonly avatars: Group;
  readonly talking: boolean;
  host(islandId: string, opts?: { name?: string; snapshot?: () => IslandState | null }): Promise<{ code: string; link: string }>;
  join(code: string, opts?: { name?: string }): Promise<void>;
  leave(): void;
  /** Try again after the connection was lost for good. */
  retry(): void;
  send<K extends keyof LiveEventMap>(kind: K, data: LiveEventMap[K], opts?: { to?: string }): boolean;
  send(kind: string, data?: unknown, opts?: { to?: string }): boolean;
  on<K extends keyof LiveSignals>(kind: K, fn: LiveSignals[K]): () => void;
  on<K extends keyof LiveEventMap>(kind: K, fn: (data: LiveEventMap[K], from: LivePeer) => void): () => void;
  on(kind: string, fn: (data: unknown, from: LivePeer) => void): () => void;
  /** Sends a recorded clip (a Blob from elsewhere, e.g. the app's own recorder). */
  sendVoice(blob: Blob, durationMs?: number): Promise<boolean>;
  /** Push to talk: begin recording (the avatar shows a ring to the others). */
  startTalk(): Promise<boolean>;
  /** Release: stop and send. False when too short, refused or not live. */
  stopTalk(): Promise<boolean>;
  cancelTalk(): void;
  setProfile(p: { name?: string; color?: string }): void;
  avatarOf(peerId: string): Object3D | null;
  /** Per frame; called by itself when the app has everyFrame. */
  update(dt: number): void;
  dispose(): void;
}

/** Reads the join code (and island id) from a share link or the current address. */
export function parseLiveLink(href: string): { code: string; island: string | null } | null {
  try {
    const url = new URL(href, 'https://x.invalid');
    const code = normalizeCode(url.searchParams.get('live') ?? '');
    if (!code) return null;
    return { code, island: url.searchParams.get('island') };
  } catch {
    return null;
  }
}

export function liveLink(code: string, island: string | null, base?: string): string {
  const origin = typeof location !== 'undefined' ? location.origin : 'https://wayfolk.app';
  const url = new URL(base ?? `${origin}${LINK_PATH}`);
  url.searchParams.set('live', code);
  if (island) url.searchParams.set('island', island);
  return url.toString();
}

/** The one line shown when live does not work; the async visit stays available. */
export function liveMessage(state: LiveState, reason: LiveReason | null, role: 'host' | 'guest' | null): string | null {
  const host = role === 'host';
  if (state === 'live') return null;
  if (state === 'connecting') return reason === 'dropped' ? 'The live connection slipped. Reconnecting.' : null;
  if (state === 'lost') {
    if (reason === 'gone') return host ? 'The live connection is gone. Your island works as usual.' : 'The live connection is gone. You can keep exploring on your own.';
    return 'The live connection dropped. Trying again.';
  }
  switch (reason) {
    case 'unreachable':
    case 'bad-key':
      return host ? 'Live visits can’t connect right now. Friends can still visit your island later.' : 'Live visits can’t connect right now. You can still visit this island on your own.';
    case 'no-room':
    case 'bad-code':
      return 'This island isn’t open for a live visit right now. You can still visit it on your own.';
    case 'full':
      return 'This island already has four people on it. You can still visit it on your own.';
    case 'ended':
    case 'host-gone':
      return 'Your friend has closed their island for now.';
    case 'idle':
      return 'The live visit ended after a long quiet.';
    case 'replaced':
      return 'This visit continued in another window.';
    case 'abuse':
    case 'bad-request':
    case 'timeout':
      return 'The live connection closed.';
    default:
      return null;
  }
}

interface PeerView {
  peer: LivePeer;
  avatar: Avatar;
  track: PoseTrack;
  level: number;
}

const STALE_MS = 3000;
const KEEPALIVE_MS = 1000;

export function createLive(app: LiveApp, opts: LiveOptions = {}): Live {
  const storage = opts.storage !== undefined ? opts.storage : browserStorage();
  const client = new LiveClient({ relay: opts.relay ?? LIVE_RELAY, name: opts.name, color: opts.color, storage });
  const space = () => app.space ?? app.roots?.island ?? app.world?.scene ?? null;
  const avatars = new Group();
  avatars.name = 'live-avatars';
  space()?.add(avatars);
  const views = new Map<string, PeerView>();
  const handlers = new Map<string, Set<(...a: never[]) => void>>();
  const reader = app.world ? new PoseReader(app.world, space) : null;
  let snapshotFn = opts.snapshot ?? null;
  let island: string | null = null;
  let synced = true;
  let talking = false;
  let lastSent: Presence | null = null;
  let lastSentAt = 0;
  let seq = 0;
  let ctx: AudioContext | null = null;
  const audio = opts.audio ?? (() => {
    if (ctx) return ctx;
    const AC = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext;
    ctx = AC ? new AC() : null;
    return ctx;
  });
  const recorder = new TalkRecorder(opts.mic ?? defaultMic);
  const player = new VoicePlayer(audio);
  const scratch: Presence = { seq: 0, time: 0, slot: 0, talking: false, immersive: false, head: { pos: [0, 0, 0], quat: [0, 0, 0, 1] } };

  const emit = (kind: string, ...args: unknown[]) => {
    const set = handlers.get(kind);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (...a: unknown[]) => void)(...args);
      } catch (error) {
        console.error('[live] listener failed', error);
      }
    }
  };
  const peersList = () => [...client.peers.values()];
  const hostOnline = () => client.role === 'host' || peersList().some((p) => p.role === 'host');

  const viewFor = (peer: LivePeer): PeerView => {
    let v = views.get(peer.id);
    if (!v) {
      const avatar = new Avatar({ name: peer.name, color: peer.color, id: peer.id });
      avatar.ground = opts.ground ?? null;
      avatars.add(avatar.root);
      v = { peer, avatar, track: new PoseTrack(), level: 0 };
      views.set(peer.id, v);
    }
    return v;
  };
  const dropView = (id: string) => {
    const v = views.get(id);
    if (!v) return;
    v.avatar.dispose();
    views.delete(id);
  };
  const sendSnapshot = (to: string) => {
    let state: IslandState | null = null;
    try {
      state = snapshotFn?.() ?? null;
    } catch (error) {
      console.error('[live] snapshot failed', error);
    }
    client.sendSnapshot(state, to);
  };

  client.on('state', (state, reason) => {
    if (state !== 'live') lastSent = null;
    if (state === 'off' || (state === 'lost' && reason === 'gone')) {
      for (const id of [...views.keys()]) dropView(id);
      if (talking) cancelTalk();
    }
    emit('state', state, reason, liveMessage(state, reason, client.role));
  });
  client.on('welcome', (_room, me) => {
    // A guest waits for the host's snapshot; a host resyncs everyone after a reconnect.
    synced = me.role === 'host' || !peersList().some((p) => p.role === 'host');
    if (me.role === 'host' && peersList().some((p) => p.role === 'guest')) sendSnapshot('*');
    emit('peers', peersList());
  });
  client.on('peer-join', (peer) => {
    viewFor(peer);
    if (client.role === 'host' && peer.role === 'guest') sendSnapshot(peer.id);
    if (client.role === 'guest' && peer.role === 'host') synced = false;
    lastSent = null;
    emit('join', peer);
    emit('peers', peersList());
  });
  client.on('peer-update', (peer) => {
    const v = viewFor(peer);
    v.peer = peer;
    v.avatar.restyle(peer.name, peer.color);
    emit('peers', peersList());
  });
  client.on('peer-leave', (peer) => {
    dropView(peer.id);
    emit('leave', peer);
    emit('peers', peersList());
  });
  client.on('presence', (p, peer) => {
    viewFor(peer).track.push(p, performance.now());
  });
  client.on('snapshot', (data, from) => {
    if (from.role !== 'host') return;
    synced = true;
    if (data && typeof data === 'object') emit('snapshot', data as IslandState, from);
  });
  client.on('event', (kind, data, from) => {
    if (!synced) return;
    emit(kind, data, from);
  });
  client.on('voice', (note, peer) => {
    const v = views.get(peer.id);
    emit('voice', { from: peer, audio: note.audio, mime: note.mime, durationMs: note.durationMs });
    if (v && opts.autoPlayVoice !== false) {
      const target = v;
      void player.play(note.audio, {
        where: (out) => (target.avatar.root.visible ? target.avatar.mouthWorld(out) : avatars.localToWorld(out.set(...lastHead(target)))),
        setLevel: (l) => {
          target.avatar.level = l;
        },
      });
    }
  });
  client.on('error', (code, about) => emit('error', code, about));

  const lastHead = (v: PeerView): [number, number, number] => [v.avatar.pose.pos[0], v.avatar.pose.pos[1], v.avatar.pose.pos[2]];

  function sendPresence(now: number, force: boolean): void {
    if (!reader || client.state !== 'live' || client.peers.size === 0) return;
    if (!force && now - lastSentAt < 1000 / PRESENCE_HZ - 4) return;
    scratch.talking = talking;
    reader.read(scratch, now);
    if (!force && lastSent && now - lastSentAt < KEEPALIVE_MS && !poseMoved(scratch, lastSent)) return;
    scratch.seq = seq = (seq + 1) & 0xffff;
    scratch.time = Math.floor(now) >>> 0;
    if (client.sendPresence(encodePresence(scratch))) {
      lastSent = clonePresence(scratch);
      lastSentAt = now;
    }
  }

  const camera = (): Camera | undefined => app.world?.camera;

  function update(dt: number): void {
    const now = performance.now();
    if (!avatars.parent) space()?.add(avatars);
    sendPresence(now, false);
    const cam = camera();
    for (const v of views.values()) {
      const fresh = v.track.size > 0 && v.track.age(now) < STALE_MS;
      if (fresh) v.track.sample(now, v.avatar.pose);
      v.avatar.setActive(fresh);
      v.avatar.update(dt, cam);
    }
    player.update(cam);
  }

  async function startTalk(): Promise<boolean> {
    if (talking) return true;
    if (client.state !== 'live') return false;
    // The person's gesture is the moment to wake audio up for the replies too.
    void audio()?.resume().catch(() => {});
    const ok = await recorder.start();
    if (!ok) return false;
    talking = true;
    sendPresence(performance.now(), true);
    emit('talk', true);
    return true;
  }

  async function stopTalk(): Promise<boolean> {
    if (!talking) return false;
    talking = false;
    const clip = await recorder.stop();
    sendPresence(performance.now(), true);
    emit('talk', false);
    if (!clip) return false;
    return client.sendVoice(clip.audio, clip.durationMs, clip.mime);
  }

  function cancelTalk(): void {
    if (!talking) return;
    talking = false;
    recorder.cancel();
    emit('talk', false);
  }

  recorder.onLimit = (clip) => {
    if (!talking) return;
    talking = false;
    emit('talk', false);
    if (clip) client.sendVoice(clip.audio, clip.durationMs, clip.mime);
  };

  const off = app.everyFrame?.((dt) => update(dt)) ?? null;

  const live: Live = {
    get state() {
      return client.state;
    },
    get reason() {
      return client.reason;
    },
    get message() {
      return liveMessage(client.state, client.reason, client.role);
    },
    get role() {
      return client.role;
    },
    get code() {
      return client.code;
    },
    get link() {
      return client.code && client.role === 'host' ? liveLink(client.code, island, opts.linkBase) : null;
    },
    get room() {
      return client.room;
    },
    get me() {
      return client.me;
    },
    get peers() {
      return peersList();
    },
    get hostOnline() {
      return hostOnline();
    },
    avatars,
    get talking() {
      return talking;
    },
    async host(islandId, o) {
      if (o?.snapshot) snapshotFn = o.snapshot;
      island = islandId;
      const { code } = await client.host(islandId, o?.name);
      return { code, link: liveLink(code, islandId, opts.linkBase) };
    },
    async join(code, o) {
      island = null;
      synced = false;
      await client.join(code, o?.name);
      island = client.room?.island ?? null;
    },
    leave() {
      cancelTalk();
      recorder.release();
      player.stopAll();
      client.leave();
      for (const id of [...views.keys()]) dropView(id);
    },
    retry() {
      client.retry();
    },
    send(kind: string, data?: unknown, o?: { to?: string }) {
      if (RESERVED.has(kind)) throw new Error(`live: "${kind}" is a reserved name, not an event`);
      return client.send(kind, data, o?.to);
    },
    on(kind: string, fn: (...a: never[]) => void) {
      let set = handlers.get(kind);
      if (!set) handlers.set(kind, (set = new Set()));
      set.add(fn);
      return () => set.delete(fn);
    },
    async sendVoice(blob, durationMs) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return client.sendVoice(bytes, durationMs ?? 0, blob.type || 'audio/webm');
    },
    startTalk,
    stopTalk,
    cancelTalk,
    setProfile(p) {
      client.setProfile(p);
    },
    avatarOf(peerId) {
      return views.get(peerId)?.avatar.root ?? null;
    },
    update,
    dispose() {
      off?.();
      live.leave();
      client.dispose();
      avatars.removeFromParent();
      handlers.clear();
      void ctx?.close().catch(() => {});
    },
  } as Live;
  return live;
}

function clonePresence(p: Presence): Presence {
  const hand = (h: Presence['left']) => (h ? { wrist: [...h.wrist] as [number, number, number], quat: [...h.quat] as [number, number, number, number], tips: h.tips?.map((t) => [...t] as [number, number, number]) } : undefined);
  return { ...p, head: { pos: [...p.head.pos], quat: [...p.head.quat] }, left: hand(p.left), right: hand(p.right) };
}

function browserStorage(): LiveOptions['storage'] {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** For the share card: '7JB RT7'. */
export const displayCode = formatCode;
