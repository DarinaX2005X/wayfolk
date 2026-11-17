/**
 * The working birds of both islands: three of this island's flock and three of the
 * friend's, the same round birds as life's flock (src/life/flock.ts), in the island frame.
 * They carry the bridge planks from the clouds, circle above their end of the bridge while
 * they wait, and burst into a spiral round a high five. Hidden when there is no work, so
 * they cost nothing then (one draw call and about 2k triangles each while flying).
 */
import { Vector3 } from '@iwsdk/core';
import { BirdAgent, type FlockEnv } from '../life/flock';
import { wind } from '../world/wind';
import type { Ctx } from './context';

export type Crew = 'near' | 'far';

export interface Worker {
  bird: BirdAgent;
  crew: Crew;
  busy: boolean;
  /** Where it waits: circles round this point. */
  home: Vector3;
}

// Colours of FLOCK_COLORS: this island's birds (teal, coral, blue) and the friend's (cream, gold, green).
const NEAR_COLORS = [0, 1, 2];
const FAR_COLORS = [7, 5, 3];

export class Workers {
  readonly all: Worker[] = [];
  private readonly env: FlockEnv;
  private shown = false;
  private hideAt = -1;
  private t = 0;

  constructor(private readonly ctx: Ctx) {
    this.env = {
      head: new Vector3(),
      headFwd: new Vector3(0, 0, -1),
      center: new Vector3(0, 0, -12),
      radius: 12,
      time: 0,
      night: 0,
      perches: [],
      wind: (pos, out) => wind.sample(pos, undefined, out),
    };
    for (let i = 0; i < 6; i++) {
      const crew: Crew = i < 3 ? 'near' : 'far';
      const bird = new BirdAgent(false, crew === 'near' ? NEAR_COLORS[i] : FAR_COLORS[i - 3], 2.0, 0.6);
      bird.object.visible = false;
      bird.object.name = `together:bird:${crew}:${i}`;
      bird.mode = 'circle';
      bird.circleRadius = 1.6;
      ctx.root.add(bird.object);
      this.all.push({ bird, crew, busy: false, home: new Vector3() });
    }
  }

  /** Shows the birds near their homes (circling), for `seconds` at least. */
  show(seconds = 1e9): void {
    if (!this.shown) {
      for (const w of this.all) {
        w.bird.pos.copy(w.home).add(new Vector3((Math.random() - 0.5) * 3, 1.5 + Math.random(), (Math.random() - 0.5) * 3));
        w.bird.vel.set(0, 0, 0);
        w.bird.object.visible = true;
      }
      this.shown = true;
    }
    this.hideAt = Math.max(this.hideAt, this.t + seconds);
  }

  hide(): void {
    this.hideAt = this.t;
  }

  setHomes(near: Vector3, far: Vector3): void {
    this.all.forEach((w, i) => {
      w.home.copy(w.crew === 'near' ? near : far).add(new Vector3(((i % 3) - 1) * 0.8, 2.6 + (i % 3) * 0.35, 0));
      if (!w.busy) {
        w.bird.mode = 'circle';
        w.bird.circleCenter.copy(w.home);
      }
    });
  }

  idle(crew: Crew): Worker | null {
    return this.all.find((w) => w.crew === crew && !w.busy) ?? null;
  }

  release(w: Worker): void {
    w.busy = false;
    w.bird.carrying = false;
    w.bird.goalFn = null;
    w.bird.mode = 'circle';
    w.bird.circleCenter.copy(w.home);
  }

  get visible(): boolean {
    return this.shown;
  }

  update(dt: number): void {
    this.t += dt;
    if (!this.shown) return;
    if (this.t > this.hideAt && this.all.every((w) => !w.busy)) {
      for (const w of this.all) w.bird.object.visible = false;
      this.shown = false;
      return;
    }
    const env = this.env;
    env.time = this.t;
    env.night = this.ctx.world.sky?.night ?? 0;
    this.ctx.head(env.head);
    this.ctx.look(env.headFwd);
    const birds = this.all.map((w) => w.bird);
    for (const b of birds) b.update(Math.min(0.05, dt), env, birds);
  }

  dispose(): void {
    for (const w of this.all) w.bird.object.removeFromParent();
  }
}
