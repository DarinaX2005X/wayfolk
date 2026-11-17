/**
 * The three modules as the app sees them (PLAN «Контракты»). Each module exports a
 * factory from `src/<module>/index.ts`; until a module lands, src/app/standin/ gives a
 * thin stand-in behind the same shape so the first minute runs. The modules' own types
 * are the real contract: these are kept loose on purpose (optional members, wide
 * argument types) so the app adapts to small differences instead of failing to build.
 */
import type { Object3D, Quaternion, Vector3, World as IwsdkWorld } from '@iwsdk/core';
import type { HouseSpec, IslandState, P2, Reply, Resident, Vehicle, WorldEvent } from '../mind/types';

/** What the app hands to createWorld and createLife. */
export type AppHandle = {
  /** The IWSDK World. */
  world: IwsdkWorld;
  scene: IwsdkWorld['scene'];
  camera: IwsdkWorld['camera'];
  renderer: IwsdkWorld['renderer'];
  /** An Object3D under the level root that modules may hang their roots on. */
  root: Object3D;
  /** Application time, ms. */
  now(): number;
  /** Adds a per-frame function (dt seconds, now ms); returns its removal. */
  everyFrame(fn: (dt: number, now: number) => void): () => void;
  /** The head (camera) of the person, world space. */
  head(): Object3D;
  /** Multiplier of waits (1 normally, smaller in scenarios). */
  pace?(): number;
};

export type BuildStep = { object3d: Object3D; target: { pos: Vector3; quat: Quaternion; scale: Vector3 } };

/** A pose on the island: an Object3D, or a plain point with an optional facing. */
export type Anchor = Object3D | { x: number; y?: number; z: number; rotY?: number } | { pos: { x: number; y?: number; z: number }; rotY?: number };

export type WorldPort = {
  root: Object3D;
  ready: Promise<unknown>;
  setTime(date: Date): void;
  validSpot(p: P2 | Vector3 | { x: number; y?: number; z: number }): { ok: boolean; snapped: { x: number; y?: number; z: number }; rotY: number };
  buildPlan(spec: HouseSpec): BuildStep[];
  addHouse(spec: HouseSpec): unknown;
  addPath(a: unknown, b: unknown): unknown;
  addProp(kind: string, pos: P2 | { x: number; y?: number; z: number }): unknown;
  setHorizon(islands: { id: string; name: string }[]): void;
  pier: Anchor;
  seat: Anchor;
  spots(): Anchor[];
  /** Ground height at a point, when the world offers it. */
  groundAt?(x: number, z: number): number;
  groundY?(x: number, z: number): number;
  /** A good free spot for the next house, when offered. */
  suggestSpot?(): { ok: boolean; snapped: { x: number; y?: number; z: number }; rotY: number };
  /** The finish of a build: window light, chimney smoke, sign. */
  finishHouse?(id: string): void;
  /** World clock step, when the world is not ticked by the render loop. */
  update?(timeMs?: number): void;
  /** Lights the windows of one house (the finish of a build), when offered. */
  lightHouse?(id: string, on?: boolean): void;
};

/** A hand as life sees it: an Object3D that follows the palm, plus which side. */
export type HandRef = Object3D & { userData: { side?: 'left' | 'right'; tracked?: boolean } };

/** Where Pip may sit: an Object3D, or one with the axis that points out of the palm. */
export type Perch = HandRef | Object3D | { object: Object3D; palmNormal?: { x: number; y: number; z: number }; tracked?: () => boolean };

export type PipPort = {
  landOn(hand: Perch): unknown;
  follow(hand: Perch): void;
  hover(): void;
  say(text: string, opts?: unknown): Promise<void> | void;
  emote?(kind: string): void;
  object?: Object3D;
};

export type LifePort = {
  pip: PipPort;
  build(steps: BuildStep[], opts?: unknown): Promise<void>;
  arrive(resident: Resident, vehicle?: Vehicle | string): Promise<void>;
  spawn(resident: Resident, at?: unknown): unknown;
  walkTo(id: string, p: unknown): Promise<void> | void;
  say(id: string, text: string, opts?: unknown): Promise<void>;
  emote(id: string, kind: string): void;
  startDaily(): void;
  soundAt(pos: unknown, kind: string): unknown;
  /** The Object3D of a resident, when offered (gifts are handed to it). */
  objectOf?(id: string): Object3D | null | undefined;
  /** Turns a resident toward a point, or toward the person. */
  face?(id: string, p?: unknown): void;
  /** Skips what is playing now (a long build, a line). */
  skip?(): void;
};

export type MindPort = {
  load(): Promise<IslandState | unknown>;
  save(): Promise<void> | void;
  readonly state: IslandState;
  nextTraveler(): Promise<Resident> | Resident;
  /** audio: a base64 WAV clip, 16 kHz mono (src/app/hands/voice.ts makes it). */
  talk(id: string, input: { text?: string; audio?: string }): Promise<Reply>;
  /** First words of a conversation without a model call, when offered. */
  greet?(id: string): Reply;
  /** Writes the memory notes of a finished conversation, when offered. */
  endTalk?(id: string): Promise<void>;
  /** The traveler at the pier leaves without staying. */
  dismiss?(id: string): Promise<void>;
  readonly persistent?: boolean;
  /** Marks events as told. */
  seen?(events: WorldEvent[]): Promise<void>;
  /** Starts a fresh island. */
  reset?(name?: string): Promise<IslandState>;
  /** During a visit: trips that came back, new mail and guests. */
  tick?(now?: number): Promise<WorldEvent[]>;
  settle(resident: Resident, spec: HouseSpec): Promise<unknown> | unknown;
  whileAway(now: number): Promise<WorldEvent[]> | WorldEvent[];
  give(id: string, item: string): Promise<{ text: string; prop?: string }> | { text: string; prop?: string };
  sendTrip?(id: string, to: string): unknown;
  publicIslands?(): Promise<{ id: string; name: string }[]> | { id: string; name: string }[];
  publish?(): Promise<{ id: string; url?: string } | string | unknown>;
  visit?(islandId: string): Promise<IslandState>;
  liveAI: boolean;
};

/** Live visits (package 01.5, `src/live/`): a friend joins the island by a link. */
export type LivePort = {
  host(islandId: string, opts?: unknown): Promise<{ code: string; link: string }> | { code: string; link: string };
  readonly message?: string | null;
  readonly role?: 'host' | 'guest' | null;
  startTalk?(): Promise<boolean>;
  stopTalk?(): Promise<boolean>;
  retry?(): void;
  join(code: string): Promise<unknown> | unknown;
  leave(): void;
  readonly peers?: unknown;
  send(kind: string, data?: unknown, opts?: { to?: string }): unknown;
  on(kind: string, fn: (...args: never[]) => void): (() => void) | void;
  sendVoice?(blob: Blob): unknown;
  readonly state?: unknown;
};

/** Which modules are real and which are stand-ins, for the report and the debug hook. */
export type ModuleReport = {
  world: 'real' | 'standin';
  life: 'real' | 'standin';
  mind: 'real' | 'standin';
  live: 'real' | 'standin';
  errors: string[];
};

/** A point of an anchor in world space (the anchor's own world transform when it is an Object3D). */
export function anchorPoint(a: Anchor, out: Vector3): Vector3 {
  if ((a as Object3D).isObject3D) {
    const o = a as Object3D;
    o.updateWorldMatrix(true, false);
    return o.getWorldPosition(out);
  }
  const withPos = a as { pos?: { x: number; y?: number; z: number } };
  if (withPos.pos) return out.set(withPos.pos.x, withPos.pos.y ?? 0, withPos.pos.z);
  const p = a as { x: number; y?: number; z: number };
  return out.set(p.x, p.y ?? 0, p.z);
}

/** The facing of an anchor around +Y, radians (0 looks along -Z). */
export function anchorYaw(a: Anchor): number {
  if ((a as Object3D).isObject3D) {
    const o = a as Object3D;
    o.updateWorldMatrix(true, false);
    const e = o.matrixWorld.elements;
    // -Z axis of the object in world space.
    const fx = -e[8];
    const fz = -e[10];
    return Math.atan2(-fx, -fz);
  }
  return (a as { rotY?: number }).rotY ?? 0;
}
