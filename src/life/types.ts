// Types of the life module. Data types (Resident, Voice, HouseSpec...) live in src/mind/types.ts.
import type { Camera, Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import type { HouseSpec, P2, Resident, Vehicle } from '../mind/types';

export interface V3 { x: number; y: number; z: number }
export interface Q4 { x: number; y: number; z: number; w: number }

/** A point life can read: an Object3D (its world position), a Vector3, {x,y,z}, {x,z} or {pos}. */
export type PointLike = Object3D | Vector3 | V3 | P2 | { pos: V3 | P2; rotY?: number } | { position: V3; rotY?: number };

/**
 * What life needs from the app. The IWSDK World fits as it is (scene, camera,
 * registerSystem, createTransformEntity); a plain { scene, camera } works too, and then
 * the caller drives life.update(dt, time) every frame.
 */
export interface LifeApp {
  scene?: Object3D;
  camera?: Camera;
  /** The IWSDK world, when app is a wrapper around it. */
  world?: unknown;
  audio?: AudioContext;
  [key: string]: unknown;
}

/**
 * What life needs from the world module (src/world/). Only root, pier and seat are
 * required; the optional calls make walking and perching follow the real island.
 */
export interface LifeWorld {
  root: Object3D;
  ready?: Promise<unknown>;
  pier?: PointLike;
  seat?: PointLike;
  spots?: () => PointLike[];
  /** Ground height at (x, z) in world space. */
  heightAt?: (x: number, z: number) => number;
  /** Waypoints along the island's paths from a to b (world x/z). */
  route?: (a: P2, b: P2) => P2[];
  /** Places on roofs, trees and fences where birds can sit, world space. */
  perches?: () => PointLike[];
  /** Bench or sitting spots for residents, world space. */
  benches?: () => PointLike[];
  /** Island radius in metres, to find the cloud edge. */
  radius?: number;
  [key: string]: unknown;
}

/** One piece of a house in assembly order, as world.buildPlan(spec) returns it. */
export interface BuildStep {
  object3d: Object3D;
  /** Final transform in the parent space of object3d (world.root space when it has no parent). */
  target: { pos: V3 | Vector3; quat: Q4 | Quaternion; scale: V3 | Vector3 | number };
}

/**
 * A hand for Pip. Either an Object3D at the palm (WebXR joint convention: the palm faces
 * local -Y) or an anchor with an explicit palm normal and tracking flag.
 */
export type HandLike =
  | Object3D
  | {
      object: Object3D;
      /** Local axis that points out of the palm. Default (0,-1,0), the WebXR joint convention. */
      palmNormal?: V3;
      /** Local offset of the palm centre from the object origin, metres. */
      offset?: V3;
      tracked?: () => boolean;
    };

export type Emote =
  | 'idle' | 'walk' | 'talk' | 'wave' | 'happy' | 'sad' | 'sit' | 'work'
  | 'shy' | 'curious' | 'excited' | 'think' | 'sleep' | 'dance' | 'play';

export type SoundKind = 'waves' | 'oven' | 'chimes' | 'bees' | 'wind' | 'stream' | 'fire' | 'birds' | 'night';

export interface SoundHandle {
  stop(): void;
  setVolume(v: number): void;
}

export interface SayOptions {
  /** Mood colours the gesture while speaking. */
  mood?: 'happy' | 'shy' | 'sad' | 'curious' | 'excited';
  /** Show the paper bubble (default true). */
  bubble?: boolean;
  /** Seconds the bubble stays after the line is done (default 6; 0 hides at once). */
  hold?: number;
  /** Voice loudness 0..1 (default 1). Background chatter uses less. */
  volume?: number;
  /** Speaker name on the bubble. */
  name?: string;
}

export interface Pip {
  readonly object: Object3D;
  /** Fly to the open palm and stay on it while the hand moves. */
  landOn(hand: HandLike): Promise<void>;
  /** Fly beside the hand (a little above and outside) and keep up with it. */
  follow(hand: HandLike): void;
  /** Hover in front of the person at a comfortable distance. */
  hover(): void;
  /** Where he hovers from the head: metres ahead, to the right and below the eyes. */
  setHover?(o: { ahead: number; side: number; drop: number }): void;
  say(text: string, opts?: SayOptions): Promise<void>;
  emote(kind: Emote): void;
  /** Where Pip is now: 'palm' | 'follow' | 'hover' | 'flock' | 'perch'. */
  readonly mode: string;
}

export interface Life {
  readonly root: Object3D;
  readonly pip: Pip;
  readonly ready: Promise<void>;
  build(steps: BuildStep[]): Promise<void>;
  /** `near`: land on the grass there instead of at the pier (the first minute). */
  arrive(resident: Resident, vehicle?: Vehicle, opts?: { near?: PointLike }): Promise<void>;
  spawn(resident: Resident, home?: HouseSpec | P2): Object3D;
  despawn(id: string): void;
  /** Walks along the island's paths; `speed` (m/s) for this walk only. */
  walkTo(id: string, p: PointLike, opts?: { speed?: number }): Promise<void>;
  say(id: string, text: string, opts?: SayOptions): Promise<void>;
  emote(id: string, kind: Emote): void;
  /** Turn a resident (or 'pip') toward a point, or toward the person when omitted. */
  face(id: string, p?: PointLike): void;
  startDaily(): void;
  stopDaily(): void;
  /**
   * A few birds of the flock land round a point (crumbs on a palm or on the grass) and peck
   * for `seconds`, then fly back to the flock. `scale` shrinks them while they eat (a palm).
   */
  feed?(at: () => Vector3 | null, opts?: { count?: number; seconds?: number; spread?: number; scale?: number; up?: () => Vector3 }): Promise<void>;
  /** The flock circles a point (a concert), or goes back to its flock with null. */
  flockCircle(at: Vector3 | null, radius?: number): void;
  /** The beat residents dance to, per minute. */
  setBeat(bpm: number): void;
  soundAt(pos: PointLike, kind: SoundKind, volume?: number): SoundHandle;
  /** Hurry the current line, arrival or build to its end (a pinch). */
  skip(): void;
  /** Takes a speaker's cloud down now (a conversation is over). */
  quiet?(id: string): void;
  /** Ends a resident's walk at once where it was going (a pinch or a click hurries them). */
  hurry?(id: string): void;
  /** Night makes the island quieter and sends residents home. */
  setTime(date: Date): void;
  /** Call every frame when life is not registered as a system. */
  update(dt: number, time: number): void;
  /** The birds of the flock (a page lets a click near one feed them). */
  flockObjects?(): Object3D[];
  /** The resident's object (for hit tests or handing gifts). */
  objectOf(id: string): Object3D | undefined;
  /** Shared AudioContext; resume it on the first gesture. */
  readonly audio: AudioContext | null;
  /** Draw calls life adds (birds, residents, bubbles, particles), for the budget check. */
  stats(): { drawCalls: number; triangles: number };
  dispose(): void;
}
