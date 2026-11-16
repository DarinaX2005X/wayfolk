/**
 * Boards of the arc and the lines of the bench (DESIGN "Компоненты и состояния").
 *
 *   StationBoard  'full' 0.42 × 0.34 m (large 0.50 × 0.41): title, the gate's subtitle,
 *                 a counter with its unit on one line, three lines, a progress bar along
 *                 the bottom; 'plan' holds six lines and no counter; 'chip' is the small
 *                 0.17 × 0.058 m plate in one weight ("Read 64", a moss dot when done).
 *                 States: future, active, waiting (amber plate), error (vermilion line
 *                 and an action), done.
 *   CaptionRail   0.66 × 0.06 m behind the bench: the last two captions, the source in
 *                 bold; reads store.captions; hidden by the setting `captions`.
 *   ReadingLine   0.9 × 0.10 m under the timeline: two lines of 44 characters.
 */
import { effect } from '@preact/signals-core';
import { Container, Text, type Component } from '@pmndrs/uikit';
import { store, type CaptionLine } from '../../app/store';
import { radiusMm, type UiTheme } from './theme';
import { typeMm, richText } from './text';
import { Counter, UiPanel, chip, faceStyle, rimmed, type Composed } from './panel';
import { SIZE } from './sizes';

export type StationState = 'future' | 'active' | 'waiting' | 'error' | 'done';

export type BoardSpec = {
  form: 'full' | 'plan' | 'chip';
  state: StationState;
  title: string;
  sub?: string;
  count?: number;
  unit?: string;
  rows?: string[];
  /** 0…1 of real progress; no bar when absent. */
  progress?: number | null;
  /** One line over the owner's lines ("1 question for you"). */
  note?: string | null;
  /** Error: the action under the vermilion line. */
  action?: { label: string; onSelect(): void } | null;
  target?: string;
};

export class StationBoard extends UiPanel<BoardSpec> {
  private counter: Counter | null = null;

  /** Sets the counter value: the figure rolls toward it, never faster than 20 a second. */
  count(value: number): void {
    this.state = { ...this.state, count: value };
    if (this.counter) this.counter.to(value);
    else this.render();
  }

  protected compose(t: UiTheme): Composed {
    const s = this.state;
    if (s.form === 'chip') return this.composeChip(t);
    const b = SIZE.board;
    const w = t.large ? b.wLarge : b.w;
    const pad = t.large ? b.padLarge : b.pad;
    const eye = b.eye;
    const inner = w - 2 * b.rim - 2 * pad;
    const face: Component[] = [];
    let used = 0;
    const add = (c: Component, h: number): void => {
      face.push(c);
      used += h + (face.length > 1 ? b.gap : 0);
    };

    const head = new Container({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: inner } as never);
    const title = typeMm('body', eye, t.large);
    head.add(this.text(s.title, 'body', eye, t, { weight: 700 }));
    if (s.state === 'waiting') head.add(chip(t, 'Waiting', eye, 'wait'));
    else if (s.state === 'done') head.add(chip(t, 'Done', eye, 'ok'));
    add(head, title.lineHeight);
    if (s.sub) add(this.text(s.sub, 'label', eye, t, { color: t.soft }), typeMm('label', eye, t.large).lineHeight);
    if (s.form === 'full' && s.count !== undefined) {
      this.counter?.dispose();
      this.counter = new Counter({ value: s.count, unit: s.unit, eye, role: 'view', unitRole: 'read', shown: this.counter?.shown ?? s.count });
      add(this.counter.el, typeMm('view', eye, t.large).lineHeight);
    }
    const max = s.form === 'plan' ? 6 : 3;
    const rows = (s.rows ?? []).slice(0, max);
    if (s.note) rows.splice(Math.min(rows.length, max - 1), rows.length >= max ? 1 : 0, s.note);
    const read = typeMm('read', eye, t.large);
    for (const r of rows) add(this.text(r, 'read', eye, t, { color: s.state === 'error' && r === rows[rows.length - 1] ? t.dangerText : t.text, width: inner }), read.lineHeight);
    if (s.state === 'error' && s.action) {
      face.push(this.button(t, { label: s.action.label, eye, variant: 'primary', onSelect: () => s.action?.onSelect() }));
      used += 60 + b.gap;
    }
    // The bar measures real progress only; it sits on the bottom edge.
    const bar = new Container({ positionType: 'absolute', positionLeft: 0, positionBottom: 0, width: '100%', height: b.progress, backgroundColor: t.edge } as never);
    if (typeof s.progress === 'number') {
      bar.add(new Container({ height: b.progress, width: `${Math.round(Math.max(0, Math.min(1, s.progress)) * 100)}%`, backgroundColor: s.state === 'waiting' ? t.wait : t.accent } as never));
      face.push(bar);
    }
    const base = t.large ? b.hLarge : b.h;
    const grow = s.form === 'plan' ? (t.large ? b.planGrowLarge : b.planGrow) : 0;
    const need = used + 2 * pad + 2 * b.rim + (typeof s.progress === 'number' ? b.progress : 0);
    const h = Math.max(base + grow, Math.ceil(need));
    const body = rimmed(t, w, h, face, { padding: pad, gap: b.gap });
    if (s.state === 'future') body.setProperties({ opacity: 0.85 } as never);
    return { w, h, children: [body] };
  }

  private composeChip(t: UiTheme): Composed {
    const s = this.state;
    const c = SIZE.chip;
    const { fontSize, lineHeight } = typeMm('label', c.eye, t.large);
    const text = s.count !== undefined ? `${s.title} ${s.count}` : s.title;
    const w = Math.max(c.w, Math.ceil(text.length * fontSize * 0.55 + 2 * c.pad + (s.state === 'done' ? fontSize : 0) + 8));
    const h = Math.max(c.h, Math.ceil(lineHeight + 8 + 8));
    const body = new Container({ width: w, height: h, backgroundColor: t.body, borderRadius: radiusMm(w / 1000), padding: 4, flexShrink: 0 } as never);
    const face = new Container({
      flexGrow: 1,
      backgroundColor: s.state === 'waiting' ? t.wait : t.face,
      borderRadius: radiusMm(w / 1000) - 4,
      flexDirection: 'row',
      alignItems: 'center',
      paddingX: c.pad,
      gap: fontSize * 0.4,
    } as never);
    if (s.state === 'done') face.add(new Container({ width: fontSize * 0.6, height: fontSize * 0.6, borderRadius: fontSize * 0.3, backgroundColor: t.ok } as never));
    // One weight on a chip: it costs one call less.
    face.add(new Text({ text, fontSize, lineHeight, fontWeight: 400, color: s.state === 'future' ? t.soft : s.state === 'waiting' ? '#1E2421' : t.text } as never));
    body.add(face);
    return { w, h, children: [body] };
  }

  override dispose(): void {
    this.counter?.dispose();
    super.dispose();
  }
}

// ---------------------------------------------------------------- caption rail

export type RailSpec = { lines?: CaptionLine[]; follow?: boolean };

/**
 * The rail behind the bench. With `follow` (the default) it reads store.captions; the
 * gallery passes fixed lines instead. The older line goes up, the newer one under it.
 */
export class CaptionRail extends UiPanel<RailSpec> {
  private stop: (() => void) | null = null;

  constructor(spec: RailSpec = {}) {
    super(spec);
    if (spec.follow !== false && !spec.lines) {
      this.stop = effect(() => {
        void store.captions.value;
        void store.settings.value.captions;
        this.render();
      });
    }
  }

  protected compose(t: UiTheme): Composed {
    const r = SIZE.rail;
    const h = t.large ? r.hLarge : r.h;
    const lines = (this.state.lines ?? store.captions.peek()).slice(-2);
    const hidden = this.state.lines === undefined && store.settings.peek().captions === false;
    const face = new Container({ ...faceStyle(t, r.w, { padding: 0, gap: 0 }), paddingX: r.padX, paddingY: r.padY, width: r.w, height: h, justifyContent: 'flex-end' } as never);
    if (!hidden) {
      for (const line of lines) {
        const words = [{ text: `${line.source}:`, mark: 'bold' as const }, ...line.text.split(/\s+/).filter(Boolean).map((w) => ({ text: w }))];
        face.add(richText(words, 'read', r.w - 2 * r.padX, { eyeDistance: r.eye, theme: t }));
      }
    }
    return { w: r.w, h, children: [face], style: { opacity: hidden ? 0 : 1 } };
  }

  override dispose(): void {
    this.stop?.();
    super.dispose();
  }
}

// ---------------------------------------------------------------- reading line

export class ReadingLine extends UiPanel<{ text: string; lead?: string }> {
  protected compose(t: UiTheme): Composed {
    const r = SIZE.reading;
    const h = t.large ? r.hLarge : r.h;
    const words = [
      ...(this.state.lead ? [{ text: this.state.lead, mark: 'bold' as const }] : []),
      ...this.state.text.split(/\s+/).filter(Boolean).map((w) => ({ text: w })),
    ];
    const face = new Container({ ...faceStyle(t, r.w, { padding: r.pad, gap: 0 }), width: r.w, height: h, justifyContent: 'center' } as never);
    face.add(richText(words, 'read', r.w - 2 * r.pad, { eyeDistance: r.eye, theme: t }));
    return { w: r.w, h, children: [face] };
  }
}
