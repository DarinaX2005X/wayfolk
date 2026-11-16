/**
 * Tools of the work views and the service column (DESIGN "Компоненты и состояния").
 *
 *   CodePad        30 keys of the code alphabet in three rows of 44 mm, five cells, Clear
 *   TableCard      a table of the hall: its name rows 30 mm high
 *   WishStrip      one wish on a paper strip with its state
 *   SettingsPanel  six switches, the dwell speed (Slower, Faster) and Recenter
 *   CriterionBars  four criteria: name, "4 of 6", the fill, an amber dot where code fixed it
 *   RulesList      "Your rules": a rule per line with Undo
 *   ClassErrors    "What the class got wrong": up to six lines with the number of essays
 */
import { Container, Text } from '@pmndrs/uikit';
import type { InputKind, Settings } from '../../agents/types';
import { DWELL_MS } from '../../app/store';
import { CATEGORY_SHAPE, COLOR, type Category } from '../../tokens/tokens';
import { type UiTheme } from './theme';
import { typeMm } from './text';
import { LEADING } from './text';
import { UiPanel, faceStyle, toggleRow, type Composed } from './panel';
import { SIZE } from './sizes';

/** The code alphabet: 30 characters without look-alikes (PLAN "Остров, записки, коды"). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

// ---------------------------------------------------------------- code pad

export type PadSpec = { typed: string; onType?: (code: string) => void; onDone?: (code: string) => void; error?: string | null };

export class CodePad extends UiPanel<PadSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.pad;
    const perRow = 10;
    const w = perRow * c.key + (perRow - 1) * c.gap + 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const count = typeMm('head', c.eye, t.large);
    const face = new Container({ ...faceStyle(t, w, { padding: c.pad, gap: 6 }), width: w } as never);
    const cells = new Container({ flexDirection: 'row', gap: 6, alignItems: 'center' } as never);
    for (let i = 0; i < 5; i++) {
      const ch = this.state.typed[i] ?? '';
      const cell = new Container({
        width: c.key,
        height: c.key + 8,
        borderRadius: 8,
        borderWidth: 2,
        borderColor: i === this.state.typed.length ? t.accent : t.edge,
        backgroundColor: t.paper,
        alignItems: 'center',
        justifyContent: 'center',
      } as never);
      cell.add(new Text({ text: ch, fontSize: count.fontSize, lineHeight: LEADING, fontWeight: 700, color: t.text } as never));
      cells.add(cell);
    }
    cells.add(this.button(t, { label: 'Clear', eye: c.eye, variant: 'text', target: 'pad:clear', onSelect: () => this.type('') }));
    face.add(cells);
    if (this.state.error) face.add(this.text(this.state.error, 'read', c.eye, t, { color: t.dangerText, width: w - 2 * c.pad }));
    for (let r = 0; r < 3; r++) {
      const row = new Container({ flexDirection: 'row', gap: c.gap } as never);
      for (const ch of CODE_ALPHABET.slice(r * perRow, r * perRow + perRow)) {
        row.add(
          this.button(t, {
            label: ch,
            eye: c.eye,
            variant: 'secondary',
            width: c.key,
            target: `key:${ch}`,
            onSelect: () => this.type(this.state.typed.length < 5 ? this.state.typed + ch : this.state.typed),
          }),
        );
      }
      face.add(row);
    }
    const h = Math.ceil(2 * c.pad + c.key + 8 + 6 + 3 * (c.key + 10 + c.gap) + (this.state.error ? read.lineHeight + 6 : 0));
    face.setProperties({ height: h } as never);
    return { w, h, children: [face] };
  }

  private type(code: string): void {
    this.set({ typed: code, error: null });
    this.state.onType?.(code);
    if (code.length === 5) this.state.onDone?.(code);
  }
}

// ---------------------------------------------------------------- table card

export type TableSpec = { label: string; seats: number; guests: { id: string; name: string; side?: Category; child?: boolean }[]; locked?: boolean };

/** A small shape of a category (colour never carries the meaning alone). */
export function shapeMark(category: Category, size: number): Container {
  const shape = CATEGORY_SHAPE[category];
  return new Container({
    width: size,
    height: size,
    backgroundColor: COLOR.category[category],
    borderRadius: shape === 'circle' ? size / 2 : shape === 'square' ? 1 : 0,
    transformRotateZ: shape === 'diamond' ? 45 : 0,
    flexShrink: 0,
  } as never);
}

export class TableCard extends UiPanel<TableSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.table;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const label = typeMm('label', c.eye, t.large);
    const rowH = Math.max(c.row, read.lineHeight + 4);
    const h = Math.ceil(2 * c.pad + read.lineHeight + 6 + this.state.guests.length * (rowH + 2));
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 2 }), width: c.w, height: h } as never);
    const head = new Container({ flexDirection: 'row', justifyContent: 'space-between', width: inner } as never);
    head.add(this.text(this.state.label, 'read', c.eye, t, { weight: 700 }));
    head.add(this.text(`${this.state.guests.length} of ${this.state.seats}${this.state.locked ? ', locked' : ''}`, 'label', c.eye, t, { color: t.soft }));
    face.add(head);
    for (const g of this.state.guests) {
      const row = new Container({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: rowH,
        width: inner,
        paddingX: 4,
        borderRadius: 6,
        hover: { backgroundColor: t.quiet },
        cursor: 'pointer',
      } as never);
      if (g.side) row.add(shapeMark(g.side, label.fontSize * 0.7));
      row.add(this.text(g.name, 'read', c.eye, t));
      if (g.child) row.add(this.text('child', 'label', c.eye, t, { color: t.soft }));
      face.add(row);
    }
    return { w: c.w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- wish strip

export type WishState = 'met' | 'partly' | 'broken' | 'needs-you' | 'impossible';
export type WishSpec = { text: string; source: string; state: WishState; reason?: string };

const WISH_WORD: Record<WishState, string> = { met: 'Met', partly: 'Partly', broken: 'Broken', 'needs-you': 'Needs you', impossible: "Can't be met" };

export class WishStrip extends UiPanel<WishSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.wish;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const label = typeMm('label', c.eye, t.large);
    const chars = Math.floor(inner / (read.fontSize * 0.5));
    const lines = Math.ceil((this.state.text.length * 1.08) / chars) + (this.state.reason ? Math.ceil((this.state.reason.length * 1.1) / Math.floor(inner / (label.fontSize * 0.5))) : 0);
    const h = Math.ceil(2 * c.pad + label.lineHeight + 4 + lines * read.lineHeight + 4);
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 2, paper: true }), width: c.w, height: h } as never);
    const head = new Container({ flexDirection: 'row', justifyContent: 'space-between', width: inner } as never);
    head.add(this.text(this.state.source, 'label', c.eye, t, { color: t.soft }));
    const s = this.state.state;
    const tone = s === 'met' ? t.okText : s === 'partly' || s === 'needs-you' ? t.waitText : t.dangerText;
    head.add(this.text(WISH_WORD[s], 'label', c.eye, t, { weight: 700, color: tone }));
    face.add(head);
    face.add(this.text(this.state.text, 'read', c.eye, t, { width: inner }));
    if (this.state.reason) face.add(this.text(this.state.reason, 'label', c.eye, t, { width: inner, color: t.soft }));
    return { w: c.w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- settings

export type SettingsSpec = {
  settings: Settings;
  onChange?: (patch: Partial<Settings>) => void;
  onRecenter?: (input: InputKind) => void;
};

const SWITCH_LABEL: [keyof Settings, string][] = [
  ['sound', 'Sound'],
  ['captions', 'Captions'],
  ['highContrast', 'High contrast'],
  ['lessMotion', 'Less motion'],
  ['largeText', 'Large text'],
  ['dwell', 'Select by looking (head pointer or gaze)'],
];

export class SettingsPanel extends UiPanel<SettingsSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.settings;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 2 }) } as never);
    face.add(this.text('Settings', 'read', c.eye, t, { weight: 700 }));
    let h = 2 * c.pad + read.lineHeight + 2;
    for (const [key, label] of SWITCH_LABEL) {
      const on = this.state.settings[key] === true;
      const made = toggleRow(t, { label, on, eye: c.eye, target: `setting:${key}`, onChange: (next) => this.change({ [key]: next }) }, inner);
      if (made.off) this.keep(made.off);
      face.add(made.el);
      h += 44 + 2 + (label.length * read.fontSize * 0.5 > inner - 50 ? read.lineHeight : 0);
    }
    const ms = this.state.settings.dwellMs;
    const i = DWELL_MS.indexOf(ms);
    const row = new Container({ flexDirection: 'row', alignItems: 'center', gap: 6, width: inner } as never);
    row.add(this.text(`Dwell ${(ms / 1000).toFixed(1)} s`, 'read', c.eye, t, { width: inner * 0.34 }));
    row.add(
      this.button(t, {
        label: 'Slower',
        eye: c.eye,
        grow: true,
        target: 'setting:dwell-slower',
        disabled: i >= DWELL_MS.length - 1 ? 'Slowest already' : null,
        onSelect: () => this.change({ dwellMs: DWELL_MS[Math.min(DWELL_MS.length - 1, i + 1)] }),
      }),
    );
    row.add(
      this.button(t, {
        label: 'Faster',
        eye: c.eye,
        grow: true,
        target: 'setting:dwell-faster',
        disabled: i <= 0 ? 'Fastest already' : null,
        onSelect: () => this.change({ dwellMs: DWELL_MS[Math.max(0, i - 1)] }),
      }),
    );
    face.add(row);
    face.add(this.button(t, { label: 'Recenter', eye: c.eye, variant: 'primary', target: 'recenter', width: inner, onSelect: (input) => this.state.onRecenter?.(input) }));
    h += 44 + 14 + read.lineHeight + 44 + 14 + 8;
    h = Math.ceil(h);
    face.setProperties({ width: c.w, height: h } as never);
    return { w: c.w, h, children: [face] };
  }

  private change(patch: Partial<Settings>): void {
    this.set({ settings: { ...this.state.settings, ...patch } });
    this.state.onChange?.(patch);
  }
}

// ---------------------------------------------------------------- essays: criteria, rules, class errors

export type CriterionRow = { name: string; score: number; max: number; fixedByCode?: boolean };

export class CriterionBars extends UiPanel<{ rows: CriterionRow[] }> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.bars;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const rowH = read.lineHeight + 10;
    const h = Math.ceil(2 * c.pad + this.state.rows.length * (rowH + 4));
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 4 }), width: c.w, height: h } as never);
    for (const r of this.state.rows) {
      const row = new Container({ flexDirection: 'column', width: inner, gap: 2 } as never);
      const top = new Container({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: inner } as never);
      const name = new Container({ flexDirection: 'row', alignItems: 'center', gap: 4 } as never);
      name.add(this.text(r.name, 'read', c.eye, t));
      if (r.fixedByCode) name.add(new Container({ width: 6, height: 6, borderRadius: 3, backgroundColor: t.wait } as never));
      top.add(name);
      top.add(this.text(`${r.score} of ${r.max}`, 'read', c.eye, t, { weight: 700 }));
      row.add(top);
      const track = new Container({ width: inner, height: 6, borderRadius: 3, backgroundColor: t.edge } as never);
      track.add(new Container({ height: 6, borderRadius: 3, width: `${Math.round((r.score / Math.max(1, r.max)) * 100)}%`, backgroundColor: t.accent } as never));
      row.add(track);
      face.add(row);
    }
    return { w: c.w, h, children: [face] };
  }
}

export type RuleRow = { id: string; text: string; onUndo?: () => void };

export class RulesList extends UiPanel<{ rules: RuleRow[] }> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.rules;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const chars = Math.floor((inner - 80) / (read.fontSize * 0.5));
    let h = 2 * c.pad + read.lineHeight + 4;
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 4, paper: true }), width: c.w } as never);
    face.add(this.text('Your rules', 'read', c.eye, t, { weight: 700 }));
    if (this.state.rules.length === 0) {
      face.add(this.text('No rules yet. A rule appears when you change what a mistake costs.', 'read', c.eye, t, { width: inner, color: t.soft }));
      h += 2 * read.lineHeight + 4;
    }
    for (const r of this.state.rules) {
      const row = new Container({ flexDirection: 'row', alignItems: 'center', gap: 6, width: inner } as never);
      row.add(this.text(r.text, 'read', c.eye, t, { width: inner - 86 }));
      row.add(this.button(t, { label: 'Undo', eye: c.eye, variant: 'secondary', width: 80, target: `rule:${r.id}`, onSelect: () => r.onUndo?.() }));
      face.add(row);
      h += Math.max(54, Math.ceil(r.text.length / chars) * read.lineHeight) + 4;
    }
    h = Math.ceil(h);
    face.setProperties({ height: h } as never);
    return { w: c.w, h, children: [face] };
  }
}

export type ClassError = { type: string; label: string; essays: number };

export class ClassErrors extends UiPanel<{ errors: ClassError[]; total: number }> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.classErrors;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const rows = this.state.errors.slice(0, 6);
    const h = Math.ceil(2 * c.pad + read.lineHeight + 4 + rows.length * (read.lineHeight + 8));
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 4 }), width: c.w, height: h } as never);
    face.add(this.text('What the class got wrong', 'read', c.eye, t, { weight: 700 }));
    for (const e of rows) {
      const row = new Container({ flexDirection: 'row', alignItems: 'center', gap: 6, width: inner, hover: { backgroundColor: t.quiet }, borderRadius: 6, cursor: 'pointer' } as never);
      const bar = new Container({ width: 60, height: 6, borderRadius: 3, backgroundColor: t.edge } as never);
      bar.add(new Container({ height: 6, borderRadius: 3, width: `${Math.round((e.essays / Math.max(1, this.state.total)) * 100)}%`, backgroundColor: t.accent } as never));
      row.add(this.text(e.label, 'read', c.eye, t, { width: inner - 140 }));
      row.add(bar);
      row.add(this.text(`${e.essays} essays`, 'read', c.eye, t, { width: 72, align: 'right' }));
      face.add(row);
    }
    return { w: c.w, h, children: [face] };
  }
}
