/**
 * What the parts of src/together/ share: the island frame they draw in, the other modules
 * as far as they are used, the two people, the sounds and the clock. The parts never reach
 * for the app; index.ts builds one Ctx from createTogether's arguments.
 */
import type { Camera, Group, Object3D, Vector3 } from '@iwsdk/core';
import type { IslandState, P2, Resident } from '../mind/types';
import type { TogetherSound } from './sound';
import type { TgKind, TgPayloads } from './events';

/** The parts of the world module used here (src/world/index.ts World fits). */
export interface WorldLike {
  root: Object3D;
  groundY?(x: number, z: number): number;
  readonly fire?: Vector3;
  readonly cloudY?: number;
  readonly sky?: { night?: number; stars?: number; glow?: number };
  setPulse?(level: number, hue?: number): void;
  campfire?(on: boolean): void;
  addGround?(id: string, fn: (x: number, z: number) => number | null): void;
  removeGround?(id: string): void;
  addCrossing?(id: string, a: P2, b: P2, region: (x: number, z: number) => boolean): void;
  removeCrossing?(id: string): void;
  clearSpace?(x: number, z: number, r: number): void;
}

/** The parts of the life module used here (src/life/index.ts Life fits). */
export interface LifeLike {
  pip?: { say?(text: string, opts?: unknown): Promise<void> | void; emote?(kind: string): void; object?: Object3D };
  spawn?(resident: Resident, home?: unknown): unknown;
  despawn?(id: string): void;
  walkTo?(id: string, p: unknown, opts?: { speed?: number }): Promise<void> | void;
  emote?(id: string, kind: string): void;
  face?(id: string, p?: unknown): void;
  say?(id: string, text: string, opts?: unknown): Promise<void>;
  objectOf?(id: string): Object3D | null | undefined;
  flockCircle?(at: Vector3 | null, radius?: number): void;
  setBeat?(bpm: number): void;
  readonly audio?: AudioContext | null;
}

export interface MindLike {
  readonly state: IslandState;
  load?(): Promise<unknown>;
  save?(): Promise<void> | void;
}

export interface Person {
  name: string;
  color: string;
}

export interface Ctx {
  /** Everything of this module, in the island frame (a child of world.root). */
  root: Group;
  world: WorldLike;
  life: LifeLike | null;
  sound: TogetherSound;
  camera: Camera;
  /** 'host' on one's own island, 'guest' on a friend's, null with nobody live. */
  role(): 'host' | 'guest' | null;
  me(): Person;
  friend(): (Person & { id: string }) | null;
  send<K extends TgKind>(kind: K, data: TgPayloads[K]): void;
  /** The head in the island frame. */
  head(out: Vector3): Vector3;
  /** Where the head looks, in the island frame (unit). */
  look(out: Vector3): Vector3;
  /** Pip says a line (captioned by the app). */
  say(text: string): void;
  /** Application time, ms. */
  now(): number;
  ground(x: number, z: number): number;
  /** Moves the person to a place in the island frame (the app's glide), when offered. */
  glide(to: { pos: Vector3; rotY: number }): Promise<void>;
  /** The friend's avatar root (island frame), or null. */
  friendAvatar(): Object3D | null;
  immersive(): boolean;
  /** The island being shown: one's own (host or alone), or the host's snapshot (guest). */
  shown(): IslandState | null;
}
