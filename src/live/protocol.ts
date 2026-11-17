/**
 * Wire protocol of live visits, shared by the browser client (src/live/) and the relay
 * (relay/, a Cloudflare Worker with one Durable Object per room). Pure code: no DOM, no
 * Three.js, no Node, so both sides import the same file.
 *
 * Binary frames (little endian) carry what is frequent or large:
 *
 *   presence  [1][slot][seq u16][time u32][flags u8][0][head pos 3×i16][head quat 4×i16]
 *             then per present hand (left first): [wrist 3×i16][wrist quat 4×i16]
 *             and, unless that hand is a controller, [5 fingertips × 3×i16]
 *   voice     [2][slot][clip u16][duration ms u16][mime length u8][mime ascii][audio bytes]
 *
 * The sender writes slot 0; the relay overwrites it with the sender's slot (1..4) before
 * forwarding, so a receiver knows whose frame it is without trusting the sender.
 *
 * Head positions are island-local metres in units of 2 mm (±65 m). Hand points are
 * relative to the head in units of 0.1 mm (±3.2 m). Quaternions are 4 × i16 / 32767.
 *
 * Text frames are JSON: see ClientMsg and RelayMsg. The literal 'ping' is answered with
 * 'pong' by the relay without waking the room (hibernation auto response).
 */

export const PROTOCOL_VERSION = 1;
export const ROOM_SIZE = 4;

export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

export const LIMITS = {
  /** Text frame (event, profile, bye). */
  textBytes: 16 * 1024,
  /** The island snapshot the host sends to a guest. */
  snapshotBytes: 512 * 1024,
  /** One voice note, header included. */
  voiceBytes: 160 * 1024,
  voiceSeconds: 12,
  presenceBytes: 128,
  nameChars: 24,
  kindChars: 32,
  /** Token buckets per socket: messages per second and burst. */
  rates: {
    presence: { rate: 30, burst: 45 },
    text: { rate: 10, burst: 30 },
    voice: { rate: 0.5, burst: 3 },
    snapshot: { rate: 1, burst: 6 },
  },
  /** Strikes of dropped messages before the relay closes an abusive socket. */
  strikes: 200,
} as const;

/** Times of the room's life on the relay, in ms. */
export const ROOM_TIMES = {
  /** A created room nobody entered is forgotten after this. */
  unclaimed: 10 * 60_000,
  /** An empty room keeps its code this long, so the host can come back after a drop. */
  empty: 30 * 60_000,
  /** Guests are sent home when the host has been away this long. */
  hostAway: 10 * 60_000,
  /** No real message from anyone for this long closes the room. */
  idle: 30 * 60_000,
  /** A socket that neither talks nor pings for this long is closed. */
  silent: 90_000,
  /** A socket must say hello within this. */
  hello: 15_000,
  /** How often the room checks itself while it has sockets. */
  check: 2 * 60_000,
} as const;

/** Close codes the relay uses; the client reads them as reasons. */
export const CLOSE = {
  normal: 1000,
  badRequest: 4000,
  full: 4001,
  badKey: 4003,
  noRoom: 4004,
  abuse: 4008,
  replaced: 4009,
  ended: 4010,
  hostGone: 4011,
  idle: 4012,
  timeout: 4013,
} as const;

export type CloseReason = 'bad-request' | 'full' | 'bad-key' | 'no-room' | 'abuse' | 'replaced' | 'ended' | 'host-gone' | 'idle' | 'timeout';

export function closeReason(code: number): CloseReason | null {
  switch (code) {
    case CLOSE.badRequest: return 'bad-request';
    case CLOSE.full: return 'full';
    case CLOSE.badKey: return 'bad-key';
    case CLOSE.noRoom: return 'no-room';
    case CLOSE.abuse: return 'abuse';
    case CLOSE.replaced: return 'replaced';
    case CLOSE.ended: return 'ended';
    case CLOSE.hostGone: return 'host-gone';
    case CLOSE.idle: return 'idle';
    case CLOSE.timeout: return 'timeout';
    default: return null;
  }
}

/** Close codes after which reconnecting makes no sense. */
export function isFinalClose(code: number): boolean {
  return code === CLOSE.badRequest || code === CLOSE.full || code === CLOSE.badKey || code === CLOSE.noRoom
    || code === CLOSE.abuse || code === CLOSE.replaced || code === CLOSE.ended || code === CLOSE.hostGone || code === CLOSE.idle;
}

/** Warm colours of visitors, in the island's palette. The relay hands out a free one. */
export const PEER_COLORS = ['#e9825f', '#3f9e98', '#e2a93b', '#7aa65a'] as const;

/** Events only the host may send: they change the island. */
export const HOST_ONLY_EVENTS: readonly string[] = ['house-placed', 'build-started', 'traveler-arrived', 'island'];

// ---------------------------------------------------------------------------------------
// Messages

export type Role = 'host' | 'guest';

export interface PeerInfo {
  id: string;
  slot: number;
  name: string;
  color: string;
  role: Role;
}

export interface RoomInfo {
  code: string;
  island: string;
  hostName: string;
}

/** First text frame of a socket. */
export interface HelloMsg {
  t: 'hi';
  v: number;
  pid: string;
  psk: string;
  name: string;
  color?: string;
  key?: string;
}

export type ClientMsg =
  | HelloMsg
  | { t: 'ev'; k: string; d?: unknown; to?: string }
  | { t: 'snap'; d: unknown; to: string }
  | { t: 'me'; name?: string; color?: string }
  | { t: 'bye' };

export type RelayMsg =
  | { t: 'welcome'; you: PeerInfo; room: RoomInfo; peers: PeerInfo[]; resumed: boolean }
  | { t: 'join'; p: PeerInfo; resumed?: boolean }
  | { t: 'me'; p: PeerInfo }
  | { t: 'left'; id: string; why: 'bye' | 'lost' }
  | { t: 'ev'; k: string; d?: unknown; f: string }
  | { t: 'snap'; d: unknown; f: string }
  | { t: 'err'; code: 'rate' | 'too-big' | 'not-host' | 'bad' | 'no-peer'; about?: string }
  | { t: 'ended'; why: 'host-left' | 'host-gone' | 'idle' };

const ID_RE = /^[a-z0-9]{8,24}$/;
const COLOR_RE = /^#[0-9a-f]{6}$/;

export function validId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function validColor(c: unknown): c is string {
  return typeof c === 'string' && COLOR_RE.test(c);
}

/** Names are shown on a tag above the avatar: one line, printable, short. */
export function cleanName(name: unknown, fallback = 'Friend'): string {
  if (typeof name !== 'string') return fallback;
  // Control characters, bidi overrides and zero-width characters go, spaces collapse.
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean).slice(0, LIMITS.nameChars).join('').trim();
  return chars || fallback;
}

export function validKind(k: unknown): k is string {
  return typeof k === 'string' && k.length > 0 && k.length <= LIMITS.kindChars && /^[a-z][a-z0-9-]*$/.test(k);
}

/** Parses a client text frame; null when it is not a well formed message. */
export function parseClientMsg(text: string): ClientMsg | null {
  let m: unknown;
  try {
    m = JSON.parse(text);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  switch (o.t) {
    case 'hi':
      if (o.v !== PROTOCOL_VERSION || !validId(o.pid) || !validId(o.psk)) return null;
      if (o.key !== undefined && typeof o.key !== 'string') return null;
      return { t: 'hi', v: PROTOCOL_VERSION, pid: o.pid, psk: o.psk, name: cleanName(o.name), color: validColor(o.color) ? o.color : undefined, key: o.key as string | undefined };
    case 'ev':
      if (!validKind(o.k)) return null;
      if (o.to !== undefined && !validId(o.to)) return null;
      return { t: 'ev', k: o.k, d: o.d, to: o.to as string | undefined };
    case 'snap':
      if (o.to !== '*' && !validId(o.to)) return null;
      return { t: 'snap', d: o.d, to: o.to as string };
    case 'me':
      return { t: 'me', name: o.name === undefined ? undefined : cleanName(o.name), color: validColor(o.color) ? o.color : undefined };
    case 'bye':
      return { t: 'bye' };
    default:
      return null;
  }
}

export function parseRelayMsg(text: string): RelayMsg | null {
  try {
    const m = JSON.parse(text) as RelayMsg;
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Codes and ids

export function randomString(length: number, alphabet: string, random: (n: number) => Uint8Array = cryptoBytes): string {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length) {
    const bytes = random(length * 2);
    for (let i = 0; i < bytes.length && out.length < length; i++) {
      if (bytes[i] < limit) out += alphabet[bytes[i] % alphabet.length];
    }
  }
  return out;
}

function cryptoBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  (globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto.getRandomValues(b);
  return b;
}

export function makeCode(random?: (n: number) => Uint8Array): string {
  return randomString(CODE_LENGTH, CODE_ALPHABET, random);
}

export function makeId(random?: (n: number) => Uint8Array): string {
  return randomString(16, 'abcdefghijklmnopqrstuvwxyz0123456789', random);
}

/** Accepts what a person types or a link carries: case, spaces and dashes do not matter. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  if (code.length !== CODE_LENGTH) return null;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return null;
  return code;
}

/** 'K7M4QX' → 'K7M 4QX', easier to read aloud. */
export function formatCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

// ---------------------------------------------------------------------------------------
// Presence

export const FRAME = { presence: 1, voice: 2 } as const;

export const PRESENCE_FLAGS = {
  left: 1,
  right: 2,
  talking: 4,
  leftController: 8,
  rightController: 16,
  immersive: 32,
} as const;

/** Joints carried per hand: the wrist pose and the five fingertips, thumb first. */
export const TIP_COUNT = 5;

export interface HandPose {
  /** Island-local position of the wrist, metres. */
  wrist: [number, number, number];
  /** Wrist orientation (x, y, z, w). */
  quat: [number, number, number, number];
  /** Island-local fingertips (thumb, index, middle, ring, pinky); absent for a controller. */
  tips?: [number, number, number][];
}

export interface Presence {
  seq: number;
  /** Sender clock, ms (wraps at 2^32). */
  time: number;
  slot: number;
  talking: boolean;
  immersive: boolean;
  head: { pos: [number, number, number]; quat: [number, number, number, number] };
  left?: HandPose;
  right?: HandPose;
}

const HEAD_UNIT = 0.002;
const HAND_UNIT = 0.0001;
const Q = 32767;

function q16(v: number, unit: number): number {
  const n = Math.round(v / unit);
  return n > 32767 ? 32767 : n < -32767 ? -32767 : n;
}

function qq(v: number): number {
  const n = Math.round(v * Q);
  return n > Q ? Q : n < -Q ? -Q : n;
}

export function presenceSize(p: Pick<Presence, 'left' | 'right'>): number {
  let n = 24;
  for (const h of [p.left, p.right]) if (h) n += 14 + (h.tips ? TIP_COUNT * 6 : 0);
  return n;
}

/** Encodes a presence frame (slot 0: the relay writes the sender's slot). */
export function encodePresence(p: Presence): Uint8Array {
  const buf = new Uint8Array(presenceSize(p));
  const v = new DataView(buf.buffer);
  v.setUint8(0, FRAME.presence);
  v.setUint8(1, 0);
  v.setUint16(2, p.seq & 0xffff, true);
  v.setUint32(4, p.time >>> 0, true);
  let flags = 0;
  if (p.left) flags |= PRESENCE_FLAGS.left;
  if (p.right) flags |= PRESENCE_FLAGS.right;
  if (p.talking) flags |= PRESENCE_FLAGS.talking;
  if (p.left && !p.left.tips) flags |= PRESENCE_FLAGS.leftController;
  if (p.right && !p.right.tips) flags |= PRESENCE_FLAGS.rightController;
  if (p.immersive) flags |= PRESENCE_FLAGS.immersive;
  v.setUint8(8, flags);
  v.setUint8(9, 0);
  const [hx, hy, hz] = p.head.pos;
  v.setInt16(10, q16(hx, HEAD_UNIT), true);
  v.setInt16(12, q16(hy, HEAD_UNIT), true);
  v.setInt16(14, q16(hz, HEAD_UNIT), true);
  const hq = normalizeQuat(p.head.quat);
  for (let i = 0; i < 4; i++) v.setInt16(16 + i * 2, qq(hq[i]), true);
  let o = 24;
  for (const h of [p.left, p.right]) {
    if (!h) continue;
    v.setInt16(o, q16(h.wrist[0] - hx, HAND_UNIT), true);
    v.setInt16(o + 2, q16(h.wrist[1] - hy, HAND_UNIT), true);
    v.setInt16(o + 4, q16(h.wrist[2] - hz, HAND_UNIT), true);
    const wq = normalizeQuat(h.quat);
    for (let i = 0; i < 4; i++) v.setInt16(o + 6 + i * 2, qq(wq[i]), true);
    o += 14;
    if (h.tips) {
      for (let t = 0; t < TIP_COUNT; t++) {
        const tip = h.tips[t] ?? h.wrist;
        v.setInt16(o, q16(tip[0] - hx, HAND_UNIT), true);
        v.setInt16(o + 2, q16(tip[1] - hy, HAND_UNIT), true);
        v.setInt16(o + 4, q16(tip[2] - hz, HAND_UNIT), true);
        o += 6;
      }
    }
  }
  return buf;
}

/** Decodes a presence frame; null when malformed. */
export function decodePresence(data: ArrayBuffer | Uint8Array): Presence | null {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.byteLength < 24 || buf.byteLength > LIMITS.presenceBytes || buf[0] !== FRAME.presence) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const flags = v.getUint8(8);
  const left = (flags & PRESENCE_FLAGS.left) !== 0;
  const right = (flags & PRESENCE_FLAGS.right) !== 0;
  const leftCtl = (flags & PRESENCE_FLAGS.leftController) !== 0;
  const rightCtl = (flags & PRESENCE_FLAGS.rightController) !== 0;
  const expect = 24 + (left ? 14 + (leftCtl ? 0 : 30) : 0) + (right ? 14 + (rightCtl ? 0 : 30) : 0);
  if (buf.byteLength !== expect) return null;
  const hx = v.getInt16(10, true) * HEAD_UNIT;
  const hy = v.getInt16(12, true) * HEAD_UNIT;
  const hz = v.getInt16(14, true) * HEAD_UNIT;
  const hq = normalizeQuat([v.getInt16(16, true) / Q, v.getInt16(18, true) / Q, v.getInt16(20, true) / Q, v.getInt16(22, true) / Q]);
  const p: Presence = {
    seq: v.getUint16(2, true),
    time: v.getUint32(4, true),
    slot: v.getUint8(1),
    talking: (flags & PRESENCE_FLAGS.talking) !== 0,
    immersive: (flags & PRESENCE_FLAGS.immersive) !== 0,
    head: { pos: [hx, hy, hz], quat: hq },
  };
  let o = 24;
  const readHand = (controller: boolean): HandPose => {
    const wrist: [number, number, number] = [hx + v.getInt16(o, true) * HAND_UNIT, hy + v.getInt16(o + 2, true) * HAND_UNIT, hz + v.getInt16(o + 4, true) * HAND_UNIT];
    const quat = normalizeQuat([v.getInt16(o + 6, true) / Q, v.getInt16(o + 8, true) / Q, v.getInt16(o + 10, true) / Q, v.getInt16(o + 12, true) / Q]);
    o += 14;
    if (controller) return { wrist, quat };
    const tips: [number, number, number][] = [];
    for (let t = 0; t < TIP_COUNT; t++) {
      tips.push([hx + v.getInt16(o, true) * HAND_UNIT, hy + v.getInt16(o + 2, true) * HAND_UNIT, hz + v.getInt16(o + 4, true) * HAND_UNIT]);
      o += 6;
    }
    return { wrist, quat, tips };
  };
  if (left) p.left = readHand(leftCtl);
  if (right) p.right = readHand(rightCtl);
  return p;
}

export function normalizeQuat(q: readonly number[]): [number, number, number, number] {
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(len > 1e-6)) return [0, 0, 0, 1];
  // One hemisphere (w >= 0) so the same rotation always encodes the same way.
  const s = q[3] < 0 ? -1 / len : 1 / len;
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}

// ---------------------------------------------------------------------------------------
// Voice notes

export interface VoiceNote {
  slot: number;
  clip: number;
  durationMs: number;
  mime: string;
  audio: Uint8Array;
}

export function encodeVoice(clip: number, durationMs: number, mime: string, audio: Uint8Array): Uint8Array {
  const m = mime.replace(/[^\x20-\x7e]/g, '').slice(0, 64);
  const buf = new Uint8Array(7 + m.length + audio.byteLength);
  const v = new DataView(buf.buffer);
  v.setUint8(0, FRAME.voice);
  v.setUint8(1, 0);
  v.setUint16(2, clip & 0xffff, true);
  v.setUint16(4, Math.max(0, Math.min(65535, Math.round(durationMs))), true);
  v.setUint8(6, m.length);
  for (let i = 0; i < m.length; i++) buf[7 + i] = m.charCodeAt(i);
  buf.set(audio, 7 + m.length);
  return buf;
}

export function decodeVoice(data: ArrayBuffer | Uint8Array): VoiceNote | null {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.byteLength < 8 || buf.byteLength > LIMITS.voiceBytes || buf[0] !== FRAME.voice) return null;
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const mlen = v.getUint8(6);
  if (7 + mlen >= buf.byteLength) return null;
  let mime = '';
  for (let i = 0; i < mlen; i++) mime += String.fromCharCode(buf[7 + i]);
  return { slot: v.getUint8(1), clip: v.getUint16(2, true), durationMs: v.getUint16(4, true), mime, audio: buf.subarray(7 + mlen) };
}

/** What a binary frame is, before decoding it: 'presence', 'voice' or null. */
export function frameKind(data: ArrayBuffer | Uint8Array): 'presence' | 'voice' | null {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (buf.byteLength < 2) return null;
  if (buf[0] === FRAME.presence) return buf.byteLength <= LIMITS.presenceBytes ? 'presence' : null;
  if (buf[0] === FRAME.voice) return buf.byteLength <= LIMITS.voiceBytes ? 'voice' : null;
  return null;
}

// ---------------------------------------------------------------------------------------
// Rate limits

/** A token bucket: `take()` is true while the sender stays within rate and burst. */
export class Bucket {
  private tokens: number;
  private at: number;
  constructor(private readonly rate: number, private readonly burst: number, now: number) {
    this.tokens = burst;
    this.at = now;
  }
  take(now: number, cost = 1): boolean {
    const dt = Math.max(0, now - this.at) / 1000;
    this.at = now;
    this.tokens = Math.min(this.burst, this.tokens + dt * this.rate);
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Reconnect delays: 0.5 s doubling to 8 s, with ±25 % jitter. */
export function backoff(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(8000, 500 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + random() * 0.5));
}

export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
