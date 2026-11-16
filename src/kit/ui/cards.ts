/**
 * Cards of the bench and the hand (DESIGN "Компоненты и состояния", "Тексты").
 *
 *   RunCard      40 × 15 cm, lies flat on the slab: two short lines on where the answers
 *                come from, "Skip to the result" and "Run it live" with its reason under it
 *   CallCard     26 × 9 cm at the hand: the open call of a selected instrument
 *   AskCard      36 × 16 cm: the one question, two answers, a countdown that starts when
 *                the card has landed
 *   ConfirmCard  30 × 12 cm: a question of scope with two buttons
 *   CodeCard     30 × 11 cm: a code of five characters and the address
 *   NoteSheet    a paper note at the hand with numbers and buttons
 *   PairStrip    the strip between two pages: the pair in one line and three buttons
 */
import { Container, Text } from '@pmndrs/uikit';
import type { InputKind } from '../../agents/types';
import { COLOR, MOTION } from '../../tokens/tokens';
import { type UiTheme } from './theme';
import { typeMm } from './text';
import { LEADING } from './text';
import { UiPanel, faceStyle, type Composed } from './panel';
import { uiTicker } from './root';
import { SIZE } from './sizes';

type Act = { label: string; onSelect?: (input: InputKind) => void; disabled?: string | null; target?: string };

// ---------------------------------------------------------------- run card

export type RunCardSpec = {
  /** Two lines of up to 22 characters: "Recorded live, 16 Nov" / "Checked on this device". */
  lines: [string, string];
  skip: Act;
  live: Act & { note: string };
};

export class RunCard extends UiPanel<RunCardSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.runCard;
    const h = t.large ? c.hLarge : c.h;
    const inner = c.w - 2 * c.pad;
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: c.gap }), width: c.w, height: h } as never);
    for (const line of this.state.lines) face.add(this.text(line, 'flat', c.eye, t, { weight: 700, width: inner }));
    const row = new Container({ flexDirection: 'row', gap: 6, alignItems: 'flex-start', width: inner } as never);
    row.add(this.button(t, { ...this.state.skip, eye: c.eye, role: 'read', variant: 'secondary', grow: true, target: this.state.skip.target ?? 'skip' }));
    row.add(this.button(t, { ...this.state.live, eye: c.eye, role: 'read', variant: 'primary', target: this.state.live.target ?? 'run-live' }));
    face.add(row);
    face.add(this.text(this.state.live.note, 'label', c.eye, t, { color: t.soft, width: inner, align: 'right' }));
    return { w: c.w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- call card

export type CallCardSpec = { role: string; pages?: [number, number]; sent: number; waited: number; back?: { items: number; seconds: number } | null; start: string };

export class CallCard extends UiPanel<CallCardSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.callCard;
    const s = this.state;
    const inner = c.w - 2 * c.pad;
    const line1 = s.pages ? `${s.role}, pages ${s.pages[0]}–${s.pages[1]}` : s.role;
    const line2 = s.back
      ? `${s.back.items} claims back in ${s.back.seconds.toFixed(1)} s`
      : `sent ${s.sent.toLocaleString('en-US')} characters, waiting ${s.waited.toFixed(1)} s`;
    const read = typeMm('read', c.eye, t.large);
    const h = Math.max(c.h, Math.ceil(3 * read.lineHeight + 2 * c.pad + 8));
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 2 }), width: c.w, height: h } as never);
    face.add(this.text(line1, 'read', c.eye, t, { weight: 700, width: inner }));
    face.add(this.text(line2, 'read', c.eye, t, { width: inner, color: s.back ? t.okText : t.text }));
    // The start of what was sent, cut to one line.
    const chars = Math.floor(inner / (read.fontSize * 0.5));
    const start = `Sent: ${s.start}`;
    face.add(this.text(start.length > chars ? `${start.slice(0, chars - 1).trimEnd()}…` : start, 'read', c.eye, t, { width: inner, color: t.soft }));
    return { w: c.w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- ask card

export type AskSpec = {
  question: string;
  options: [Act, Act];
  /** Countdown in ms; the bar runs from when `shown()` is called. */
  timeoutMs?: number;
  /** Fixed share left on the bar (gallery, time slider). */
  left?: number;
};

export class AskCard extends UiPanel<AskSpec> {
  // `declare`: set during super()'s first composition, so no field initialisers here.
  declare private startedAt: number | null;
  declare private bar: Container | null;
  declare private elapsed: number;
  declare private stopTick: (() => void) | null;

  /** The card has landed: the countdown starts now. */
  shown(): void {
    this.startedAt = 0;
    this.elapsed = 0;
    this.stopTick?.();
    this.stopTick = uiTicker((ms) => {
      if (this.startedAt === null) return;
      this.elapsed += ms;
      this.paint();
    });
  }

  /** Holds the bar at an instant (seconds since landing). */
  at(seconds: number): void {
    this.elapsed = seconds * 1000;
    this.startedAt = 0;
    this.paint();
  }

  private paint(): void {
    const total = this.state.timeoutMs ?? MOTION.ask.countdownMs;
    const left = this.state.left ?? Math.max(0, 1 - (this.elapsed ?? 0) / total);
    this.bar?.setProperties({ width: `${Math.round(left * 1000) / 10}%` } as never);
  }

  protected compose(t: UiTheme): Composed {
    const c = SIZE.askCard;
    const h = t.large ? c.hLarge : c.h;
    const inner = c.w - 2 * c.pad;
    const face = new Container({ ...faceStyle(t, c.w, { padding: 0, gap: 0 }), width: c.w, height: h } as never);
    face.add(new Container({ height: c.strip, width: '100%', backgroundColor: t.wait, flexShrink: 0 } as never));
    const body = new Container({ flexDirection: 'column', padding: c.pad, gap: 6, flexGrow: 1 } as never);
    body.add(this.text(this.state.question, 'read', c.eye, t, { width: inner }));
    const row = new Container({ flexDirection: 'row', gap: 8, marginTop: 'auto' } as never);
    this.state.options.forEach((o, i) =>
      row.add(this.button(t, { ...o, eye: c.eye, variant: i === 0 ? 'primary' : 'secondary', grow: true, target: o.target })),
    );
    body.add(row);
    face.add(body);
    const track = new Container({ height: c.bar, width: '100%', backgroundColor: t.edge, flexShrink: 0 } as never);
    this.bar = new Container({ height: c.bar, width: '100%', backgroundColor: t.wait } as never);
    track.add(this.bar);
    face.add(track);
    this.paint();
    return { w: c.w, h, children: [face] };
  }

  override dispose(): void {
    this.stopTick?.();
    super.dispose();
  }
}

// ---------------------------------------------------------------- confirm card

export type ConfirmSpec = { question: string; yes: Act; no: Act };

export class ConfirmCard extends UiPanel<ConfirmSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.confirmCard;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const lines = 2;
    const h = Math.max(c.h, Math.ceil(lines * read.lineHeight + 44 + 2 * c.pad + 10 + 6));
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 8 }), width: c.w, height: h } as never);
    face.add(this.text(this.state.question, 'read', c.eye, t, { width: inner }));
    const row = new Container({ flexDirection: 'row', gap: 8, marginTop: 'auto' } as never);
    row.add(this.button(t, { ...this.state.yes, eye: c.eye, variant: 'primary', grow: true, target: this.state.yes.target ?? 'confirm:all' }));
    row.add(this.button(t, { ...this.state.no, eye: c.eye, variant: 'secondary', grow: true, target: this.state.no.target ?? 'confirm:one' }));
    face.add(row);
    return { w: c.w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- code card

export type CodeSpec = { code: string; address: string; note?: string };

export class CodeCard extends UiPanel<CodeSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.codeCard;
    const inner = c.w - 2 * c.pad;
    const count = typeMm('count', c.eye, t.large);
    const read = typeMm('read', c.eye, t.large);
    const label = typeMm('label', c.eye, t.large);
    const addressLines = Math.ceil((this.state.address.length * read.fontSize * 0.5) / inner);
    const h = Math.max(c.h, Math.ceil(count.lineHeight + addressLines * read.lineHeight + (this.state.note ? label.lineHeight : 0) + 2 * c.pad + 8));
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 2 }), width: c.w, height: h, alignItems: 'center' } as never);
    const cells = new Container({ flexDirection: 'row', gap: count.fontSize * 0.18 } as never);
    for (const ch of this.state.code.split('')) cells.add(new Text({ text: ch, fontSize: count.fontSize, lineHeight: LEADING, fontWeight: 700, color: t.text } as never));
    face.add(cells);
    face.add(this.text(this.state.address, 'read', c.eye, t, { width: inner, align: 'center' }));
    if (this.state.note) face.add(this.text(this.state.note, 'label', c.eye, t, { width: inner, align: 'center', color: t.soft }));
    return { w: c.w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- note sheet

export type NoteSpec = { title: string; lines: string[]; actions?: Act[] };

export class NoteSheet extends UiPanel<NoteSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.note;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const chars = Math.floor(inner / (read.fontSize * 0.5));
    let lines = Math.ceil((this.state.title.length * 1.05) / chars);
    for (const l of this.state.lines) lines += Math.max(1, Math.ceil(l.length / chars));
    const acts = this.state.actions ?? [];
    const h = Math.ceil(lines * read.lineHeight + acts.length * (44 + 12) + 2 * c.pad + this.state.lines.length * 3 + 6);
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 3, paper: true }), width: c.w, height: h } as never);
    face.add(this.text(this.state.title, 'read', c.eye, t, { weight: 700, width: inner }));
    for (const l of this.state.lines) face.add(this.text(l, 'read', c.eye, t, { width: inner }));
    for (const [i, a] of acts.entries()) face.add(this.button(t, { ...a, eye: c.eye, variant: i === 0 ? 'primary' : 'secondary', width: inner }));
    return { w: c.w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- pair strip

export type PairSpec = { line: string; keep: Act; dismiss: Act; next: Act; note?: string | null };

export class PairStrip extends UiPanel<PairSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.pair;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const chars = Math.floor(inner / (read.fontSize * 0.5));
    const lines = Math.ceil((this.state.line.length * 1.08) / chars) + (this.state.note ? Math.ceil(this.state.note.length / chars) : 0);
    const h = Math.ceil(lines * read.lineHeight + 2 * (44 + 10) + 8 + 2 * c.pad + 8);
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 6 }), width: c.w, height: h } as never);
    face.add(this.text(this.state.line, 'read', c.eye, t, { width: inner }));
    if (this.state.note) face.add(this.text(this.state.note, 'read', c.eye, t, { width: inner, color: t.okText }));
    const row = new Container({ flexDirection: 'row', gap: 8 } as never);
    row.add(this.button(t, { ...this.state.keep, eye: c.eye, variant: 'primary', grow: true, target: this.state.keep.target ?? 'pair:keep' }));
    row.add(this.button(t, { ...this.state.dismiss, eye: c.eye, variant: 'secondary', grow: true, target: this.state.dismiss.target ?? 'pair:dismiss' }));
    face.add(row);
    face.add(this.button(t, { ...this.state.next, eye: c.eye, variant: 'text', target: this.state.next.target ?? 'pair:next' }));
    return { w: c.w, h, children: [face] };
  }
}

/** Colour of a category mark (parties, sides), always with its shape elsewhere. */
export const CATEGORY = COLOR.category;
