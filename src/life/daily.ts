// The island's own life: residents go to work, visit each other, sit on benches, fish at
// the pier, come to say hello, and go home at night. Several small scenes run at once.
import { Vector3 } from '@iwsdk/core';
import type { ResidentAgent } from './residents';
import { TRADE_WORK } from './species';

export interface DailyEnv {
  agents: () => ResidentAgent[];
  door: (a: ResidentAgent) => Vector3 | null;
  benches: () => Vector3[];
  pier: () => Vector3 | null;
  pierOut: () => Vector3;
  seat: () => Vector3 | null;
  spots: () => Vector3[];
  route: (from: Vector3, to: Vector3) => Vector3[];
  time: () => number;
  night: () => number;
  chatter: (a: ResidentAgent, text: string) => void;
}

interface Plan {
  kind: 'work' | 'visit' | 'bench' | 'stroll' | 'fish' | 'hello' | 'home' | 'wait';
  until: number;
  partner?: ResidentAgent;
  meet?: Vector3;
  arrived?: boolean;
  nextLine?: number;
}

const LINES = [
  'Did you see the clouds this morning?',
  'I saved you a slice.',
  'The wind smells of rain.',
  'Mm, that is a good idea.',
  'Ha, I remember that.',
  'Shall we go to the pier later?',
  'I heard a new bird song.',
  'Your roof looks lovely.',
];

let seed = 3;
const rnd = (): number => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};

export class Daily {
  private plans = new Map<string, Plan>();
  private acc = 0;
  running = false;
  /** Residents the app is directing right now; daily leaves them alone until then. */
  readonly manualUntil = new Map<string, number>();

  constructor(private env: DailyEnv) {}

  start(): void {
    this.running = true;
  }

  stop(): void {
    this.running = false;
    for (const a of this.env.agents()) if (this.plans.get(a.res.id)?.kind !== 'home') a.base = 'idle';
    this.plans.clear();
  }

  update(dt: number): void {
    if (!this.running) return;
    const t = this.env.time();
    this.acc += dt;
    const agents = this.env.agents();
    for (const a of agents) {
      const p = this.plans.get(a.res.id);
      if (p?.kind === 'visit' && p.arrived && p.partner && t < p.until && p.nextLine !== undefined && t > p.nextLine) {
        // Take turns talking.
        this.env.chatter(a, LINES[Math.floor(rnd() * LINES.length)]);
        a.emote(rnd() > 0.6 ? 'happy' : rnd() > 0.5 ? 'curious' : 'talk', t, 1.6);
        p.nextLine = t + 3.5 + rnd() * 2.5;
      }
    }
    if (this.acc < 0.5) return;
    this.acc = 0;
    const night = this.env.night() > 0.5;
    for (const a of agents) {
      if ((this.manualUntil.get(a.res.id) ?? 0) > t || a.riding) continue;
      const p = this.plans.get(a.res.id);
      if (night) {
        if (p?.kind !== 'home') this.goHome(a, t);
        continue;
      }
      if (a.hidden && p?.kind === 'home') {
        // Morning: out of the door with a stretch.
        a.hidden = false;
        a.emote('happy', t, 1.5);
        this.plans.set(a.res.id, { kind: 'wait', until: t + 2 });
        continue;
      }
      if (p && t < p.until) continue;
      if (a.walking) continue;
      if (p?.kind === 'visit' && p.partner) p.partner.base = 'idle';
      a.base = 'idle';
      a.look = null;
      a.lookPerson = true;
      this.choose(a, t, agents);
    }
  }

  private goHome(a: ResidentAgent, t: number): void {
    const door = this.env.door(a);
    this.plans.set(a.res.id, { kind: 'home', until: t + 1e9 });
    if (!door) {
      a.emote('sleep', t);
      return;
    }
    a.walk(this.env.route(a.pos, door), () => {
      if (this.plans.get(a.res.id)?.kind === 'home') a.hidden = true;
    });
  }

  private choose(a: ResidentAgent, t: number, all: ResidentAgent[]): void {
    const door = this.env.door(a);
    const work = TRADE_WORK[a.res.trade];
    const r = rnd();
    const free = all.filter((o) => o !== a && !o.hidden && !o.walking && !o.riding && (this.plans.get(o.res.id)?.until ?? 0) < t + 1 && (this.manualUntil.get(o.res.id) ?? 0) < t);
    if (r < 0.28 && free.length > 0) return this.visit(a, free[Math.floor(rnd() * free.length)], t);
    if (r < 0.58) {
      if (work === 'fish' && this.env.pier()) return this.fish(a, t);
      if (door) {
        const spot = door.clone().add(new Vector3((rnd() - 0.5) * 1.2, 0, (rnd() - 0.5) * 1.2));
        this.plans.set(a.res.id, { kind: 'work', until: t + 25 + rnd() * 20 });
        a.walk(this.env.route(a.pos, spot), () => {
          a.emote('work', t);
          a.lookPerson = false;
        });
        return;
      }
    }
    const benches = this.env.benches().filter((b) => ![...this.plans.values()].some((p) => p.kind === 'bench' && p.meet?.distanceTo(b) === 0));
    if (r < 0.74 && benches.length > 0) {
      const b = benches[Math.floor(rnd() * benches.length)];
      this.plans.set(a.res.id, { kind: 'bench', until: t + 20 + rnd() * 15, meet: b });
      a.walk(this.env.route(a.pos, b), () => a.emote('sit', t));
      return;
    }
    const seat = this.env.seat();
    if (r < 0.84 && seat && !all.some((o) => this.plans.get(o.res.id)?.kind === 'hello')) {
      // Come and say hello to the person.
      const toward = new Vector3(0, 0, 0).sub(seat).setY(0).normalize();
      const spot = seat.clone().addScaledVector(toward, 2.0);
      spot.y = a.pos.y;
      this.plans.set(a.res.id, { kind: 'hello', until: t + 14 });
      a.walk(this.env.route(a.pos, spot), () => {
        a.lookPerson = true;
        a.emote('wave', this.env.time(), 2);
      });
      return;
    }
    const spots = this.env.spots();
    const target = spots.length ? spots[Math.floor(rnd() * spots.length)].clone() : a.pos.clone().add(new Vector3((rnd() - 0.5) * 4, 0, (rnd() - 0.5) * 4));
    this.plans.set(a.res.id, { kind: 'stroll', until: t + 10 + rnd() * 8 });
    a.walk(this.env.route(a.pos, target), () => a.emote('curious', this.env.time(), 2.5));
  }

  private visit(a: ResidentAgent, b: ResidentAgent, t: number): void {
    const door = this.env.door(b) ?? b.pos;
    const meet = door.clone().lerp(a.pos, 0.25);
    const dir = new Vector3().subVectors(a.pos, meet).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
    dir.normalize();
    const pa = meet.clone().addScaledVector(dir, 0.42);
    const pb = meet.clone().addScaledVector(dir, -0.42);
    const until = t + 16 + rnd() * 10;
    const pA: Plan = { kind: 'visit', until, partner: b, meet, arrived: false };
    const pB: Plan = { kind: 'visit', until, partner: a, meet, arrived: false };
    this.plans.set(a.res.id, pA);
    this.plans.set(b.res.id, pB);
    let n = 0;
    const both = (): void => {
      n++;
      if (n < 2) return;
      a.faceToward(b.pos);
      b.faceToward(a.pos);
      a.look = b.pos;
      b.look = a.pos;
      a.lookPerson = false;
      b.lookPerson = false;
      a.emote('wave', this.env.time(), 1.2);
      const now = this.env.time();
      pA.arrived = true;
      pB.arrived = true;
      pA.nextLine = now + 1.2;
      pB.nextLine = now + 3.4;
    };
    a.walk(this.env.route(a.pos, pa), both);
    b.walk(this.env.route(b.pos, pb), both);
  }

  private fish(a: ResidentAgent, t: number): void {
    const pier = this.env.pier()!;
    const out = this.env.pierOut();
    const spot = pier.clone().addScaledVector(out, -0.3);
    spot.x += -out.z * 0.5;
    spot.z += out.x * 0.5;
    this.plans.set(a.res.id, { kind: 'fish', until: t + 35 + rnd() * 20 });
    a.walk(this.env.route(a.pos, spot), () => {
      a.faceToward(spot.clone().addScaledVector(out, 3));
      a.lookPerson = false;
      a.emote('work', this.env.time());
    });
  }
}
