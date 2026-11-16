/**
 * The one caption queue of the product (PLAN "Голос и команды", task 01.3.4). Notes of
 * a run, answers to commands, checks, edits of the second person and errors all go
 * through `say()`; only this module writes `store.captions`, and the caption rail in the
 * headset and the HTML strip at the desk only read it.
 *
 * Rules:
 *   - every line names its source as the first word ("Check:", "Extractor:", "Seat:",
 *     "Heard:"); the rail sets that word in bold;
 *   - a line is at most two lines of 48 characters; a longer one is split at a word into
 *     several lines in a row;
 *   - ordinary lines come no faster than one every 1.5 s; when several wait from the same
 *     source, the older ones fold into the newest (the newest says where things stand);
 *   - key lines (the first stamp, a question, the result, an error, the answer to a
 *     command) are never folded and stay at least 3 s;
 *   - the setting `captions` hides the rail; errors and questions still show at their
 *     object, so the queue keeps running.
 * No speech synthesis.
 */
import { store, type CaptionLine } from '../app/store';

export type SayLine = { source: string; text: string; key?: boolean; hold?: number };

export const CAPTION = {
  /** Characters of one line of the rail, two lines a caption. */
  lineChars: 48,
  lines: 2,
  /** Ordinary lines at most once per this, ms. */
  everyMs: 1500,
  /** Key lines stay at least this long, ms. */
  keyMs: 3000,
  /** Lines kept in the store (the rail shows two). */
  keep: 2,
} as const;

type Timers = { set(fn: () => void, ms: number): number; clear(id: number): void };

export type Shown = CaptionLine & { folded: number; at: number };

/** Splits "Source: text" into captions of at most two rail lines each, at words. */
export function splitCaption(source: string, text: string, lineChars: number = CAPTION.lineChars, lines: number = CAPTION.lines): string[] {
  const max = lineChars * lines;
  const prefix = `${source}: `;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (prefix.length + next.length <= max || !cur) cur = next;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur || out.length === 0) out.push(cur);
  return out;
}

/** Wraps a caption to the rail's line width: how many lines it takes. */
export function railLines(line: string, lineChars: number = CAPTION.lineChars): number {
  let lines = 1;
  let width = 0;
  for (const w of line.split(/\s+/).filter(Boolean)) {
    const add = width === 0 ? w.length : w.length + 1;
    if (width + add > lineChars && width > 0) {
      lines += 1;
      width = w.length;
    } else width += add;
  }
  return lines;
}

/** Normalises a source to one word without the colon: "check:" -> "Check". */
export function sourceWord(source: string): string {
  const w = source.trim().replace(/:$/, '').split(/\s+/)[0] || 'Groundwork';
  return w.charAt(0).toUpperCase() + w.slice(1);
}

export function createCaptions(deps: { now(): number; timers: Timers; write(lines: Shown[]): void }) {
  type Item = { source: string; text: string; key: boolean; hold: number; folded: number };
  const queue: Item[] = [];
  const shown: Shown[] = [];
  let freeAt = -Infinity;
  let timer: number | null = null;

  const pump = (): void => {
    timer = null;
    const now = deps.now();
    while (queue.length > 0 && now >= freeAt) {
      const item = queue.shift()!;
      shown.push({ source: item.source, text: item.text, key: item.key || undefined, folded: item.folded, at: now });
      while (shown.length > CAPTION.keep) shown.shift();
      deps.write(shown.slice());
      freeAt = now + item.hold;
    }
    if (queue.length > 0) timer = deps.timers.set(pump, Math.max(0, freeAt - now));
  };

  const say = (line: SayLine): void => {
    const source = sourceWord(line.source);
    const key = line.key === true;
    const hold = Math.max(key ? CAPTION.keyMs : CAPTION.everyMs, line.hold ?? 0);
    const parts = splitCaption(source, line.text);
    for (const text of parts) {
      if (!key) {
        // Older ordinary lines of this source that still wait fold into this one.
        let folded = 0;
        for (let i = queue.length - 1; i >= 0; i--) {
          const q = queue[i];
          if (!q.key && q.source === source && parts.length === 1) {
            folded += 1 + q.folded;
            queue.splice(i, 1);
          }
        }
        queue.push({ source, text, key, hold, folded });
      } else queue.push({ source, text, key, hold, folded: 0 });
    }
    if (timer !== null) deps.timers.clear(timer);
    pump();
  };

  return {
    say,
    /** Lines waiting to be shown. */
    pending: (): number => queue.length,
    /** Shows everything waiting at once, last ones winning ("Skip to the result"). */
    flush(): void {
      freeAt = -Infinity;
      while (queue.length > 0) {
        const item = queue.shift()!;
        shown.push({ source: item.source, text: item.text, key: item.key || undefined, folded: item.folded, at: deps.now() });
        while (shown.length > CAPTION.keep) shown.shift();
      }
      deps.write(shown.slice());
    },
    clear(): void {
      queue.length = 0;
      shown.length = 0;
      freeAt = -Infinity;
      deps.write([]);
    },
  };
}

let clockNow: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let clockTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms) as unknown as number, clear: (id) => clearTimeout(id) };

const queue = createCaptions({
  now: () => clockNow(),
  timers: { set: (fn, ms) => clockTimers.set(fn, ms), clear: (id) => clockTimers.clear(id) },
  write: (lines) => {
    store.captions.value = lines.map(({ source, text, key }) => (key ? { source, text, key } : { source, text }));
  },
});

/** Moves the queue onto the application clock (bindFeel). */
export function useCaptionClock(now: () => number, timers: Timers): void {
  clockNow = now;
  clockTimers = timers;
}

/** Puts a line into the caption queue (PLAN contract). */
export function say(line: SayLine): void {
  queue.say(line);
}

export const captions = { flush: queue.flush, clear: queue.clear, pending: queue.pending };
