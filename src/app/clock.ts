/**
 * The one clock of the application (PLAN "Подключение пакетов без общих файлов").
 * The engine (RunDeps.now and RunDeps.timers), the display queue, springs, sound and
 * instruments take time from here, so a frozen clock makes a whole run reproducible
 * frame by frame.
 *
 *   now()        ms of application time; runs with the frame clock
 *   wall()       the date for deadlines; `set` moves it (scenario step "clock")
 *   step(ms)     moves time forward by hand and fires the timers that came due
 *   freeze(on)   while frozen, time moves only by `step` (capture=1 and tests)
 *   timers       setTimeout over application time; fired by `tick` and `step`
 *
 * `tick()` is called once per rendered frame by src/app/core/install.ts.
 */

export type Timers = { set(fn: () => void, ms: number): number; clear(id: number): void };

export type Clock = {
  now(): number;
  wall(): Date;
  set(isoOrMs: string | number): void;
  step(ms: number): void;
  freeze(on: boolean): void;
  timers: Timers;
};

export type AppClock = Clock & {
  /** Brings application time up to the source clock and fires due timers. */
  tick(): void;
  readonly frozen: boolean;
};

const defaultSource = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createClock(source: () => number = defaultSource, wallSource: () => number = Date.now): AppClock {
  let t = 0;
  let last = source();
  let frozen = false;
  // wall() = wallBase + (now() - wallAt): the date moves with application time.
  let wallBase = wallSource();
  let wallAt = 0;

  let nextId = 1;
  const due = new Map<number, { at: number; fn: () => void; order: number }>();
  let order = 0;

  const fire = (): void => {
    for (;;) {
      let pick: number | null = null;
      for (const [id, timer] of due) {
        if (timer.at > t) continue;
        const best = pick === null ? null : due.get(pick)!;
        if (!best || timer.at < best.at || (timer.at === best.at && timer.order < best.order)) pick = id;
      }
      if (pick === null) return;
      const timer = due.get(pick)!;
      due.delete(pick);
      try {
        timer.fn();
      } catch (error) {
        console.error('[gw] a timer failed', error);
      }
    }
  };

  const advance = (ms: number): void => {
    if (!(ms > 0) || !Number.isFinite(ms)) return;
    // Timers fire at their own time, in order, even inside one long step.
    for (;;) {
      let next = Infinity;
      for (const timer of due.values()) if (timer.at < next) next = timer.at;
      if (next > t + ms) {
        t += ms;
        break;
      }
      const jump = Math.max(0, next - t);
      t += jump;
      ms -= jump;
      fire();
    }
    fire();
  };

  const clock: AppClock = {
    now() {
      return frozen ? t : t + Math.max(0, source() - last);
    },
    wall() {
      return new Date(wallBase + (clock.now() - wallAt));
    },
    set(isoOrMs) {
      const ms = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(isoOrMs);
      if (!Number.isFinite(ms)) throw new Error(`clock.set: "${isoOrMs}" is not a date`);
      wallBase = ms;
      wallAt = clock.now();
    },
    step(ms) {
      if (!frozen) {
        // Bring time up to now first, so the step lands on top of real time.
        clock.tick();
      }
      advance(ms);
    },
    freeze(on) {
      if (on === frozen) return;
      if (on) clock.tick();
      frozen = on;
      last = source();
    },
    tick() {
      const s = source();
      if (!frozen) advance(s - last);
      last = s;
    },
    get frozen() {
      return frozen;
    },
    timers: {
      set(fn, ms) {
        const id = nextId++;
        due.set(id, { at: clock.now() + Math.max(0, Number.isFinite(ms) ? ms : 0), fn, order: order++ });
        return id;
      },
      clear(id) {
        due.delete(id);
      },
    },
  };
  return clock;
}
