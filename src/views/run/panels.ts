/**
 * Panels of the run view, built on the kit's UiPanel (src/kit/ui/panel.ts):
 *
 *   RunPanel          lies on the bench while a run goes: what answers, a state line and
 *                     the run's controls (the live numbers stand over the trail, ./stage.ts)
 *   DeliverablePanel  stands at the right when the work is done: the files of a site,
 *                     the sections of a document or the items of a plan, with "Open the
 *                     site" and "Send to phone"
 *   NewTaskPanel      at the hand after the "New task" stone: speak, type, or a sample
 */
import { Container, Text } from '@pmndrs/uikit';
import type { InputKind } from '../../agents/types';
import { PANEL } from '../../tokens/tokens';
import { UiPanel, faceStyle, type Composed } from '../../kit/ui/panel';
import { typeMm, LEADING, wrapLines } from '../../kit/ui/text';
import type { UiTheme } from '../../kit/ui/theme';
import { charsPerLine } from '../../tokens/tokens';

export type Act = { label: string; onSelect?: (input: InputKind) => void; disabled?: string | null; target?: string };

// ---------------------------------------------------------------- run panel

export type RunNumbers = { steps: number; of: number; passed: number; sentBack: number; working: number };
export type RunPanelSpec = {
  /** Who answers: "Written answers, checks run now". */
  source: string;
  numbers: RunNumbers;
  /** A state line under the numbers ("Waiting for your answer"). */
  line?: string | null;
  actions: Act[];
};

export class RunPanel extends UiPanel<RunPanelSpec> {
  protected compose(t: UiTheme): Composed {
    const w = Math.round(PANEL.runCard.size.w * 1000);
    const eye = PANEL.runCard.eyeDist;
    const pad = 8;
    const inner = w - 2 * pad;
    const flat = typeMm('flat', eye, t.large);
    const label = typeMm('label', eye, t.large);
    const n = this.state.numbers;
    const face = new Container({ ...faceStyle(t, w, { padding: pad, gap: 5 }), width: w } as never);
    face.add(this.text(this.state.source, 'label', eye, t, { color: t.soft, width: inner }));
    let h = 2 * pad + label.lineHeight + 5;

    void n;
    void flat;
    if (this.state.line) {
      face.add(this.text(this.state.line, 'read', eye, t, { width: inner }));
      h += wrapLines(this.state.line, charsPerLine('read', inner / 1000, eye, t.large)) * typeMm('read', eye, t.large).lineHeight + 5;
    }
    if (this.state.actions.length) {
      const acts = new Container({ flexDirection: 'row', gap: 6, width: inner } as never);
      this.state.actions.forEach((a, i) => acts.add(this.button(t, { ...a, eye, variant: i === 0 ? 'secondary' : 'text', grow: i === 0, target: a.target })));
      face.add(acts);
      h += 44 + 5;
    }
    h = Math.ceil(h);
    face.setProperties({ height: h } as never);
    return { w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- deliverable

export type DeliverableSpec = {
  title: string;
  /** "A site, 2 files, every check passed". */
  sub: string;
  /** Rows of the tree, the pages or the items. */
  rows: { text: string; meta?: string; mark?: 'ok' | 'warn' }[];
  more?: string | null;
  line?: string | null;
  actions: Act[];
};

export class DeliverablePanel extends UiPanel<DeliverableSpec> {
  protected compose(t: UiTheme): Composed {
    const w = 330;
    const eye = 0.62;
    const pad = 12;
    const inner = w - 2 * pad;
    const read = typeMm('read', eye, t.large);
    const label = typeMm('label', eye, t.large);
    const head = typeMm('head', eye, t.large);
    const face = new Container({ ...faceStyle(t, w, { padding: pad, gap: 6 }), width: w } as never);
    let h = 2 * pad;
    const chars = charsPerLine('head', inner / 1000, eye, t.large);
    face.add(this.text(this.state.title, 'head', eye, t, { weight: 700, width: inner }));
    h += wrapLines(this.state.title, chars) * head.lineHeight + 6;
    face.add(this.text(this.state.sub, 'label', eye, t, { color: t.soft, width: inner }));
    h += label.lineHeight + 6;

    const list = new Container({ flexDirection: 'column', width: inner, gap: 2, paddingY: 4, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.edge } as never);
    for (const r of this.state.rows) {
      const line = new Container({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: inner, gap: 8 } as never);
      const left = new Container({ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 } as never);
      left.add(new Container({ width: 6, height: 6, borderRadius: 3, backgroundColor: r.mark === 'warn' ? t.wait : r.mark === 'ok' ? t.ok : t.edge, flexShrink: 0 } as never));
      left.add(new Text({ text: r.text, fontSize: read.fontSize, lineHeight: LEADING, color: t.text, flexShrink: 1 } as never));
      line.add(left);
      if (r.meta) line.add(new Text({ text: r.meta, fontSize: label.fontSize, lineHeight: LEADING, color: t.soft, flexShrink: 0 } as never));
      list.add(line);
      h += read.lineHeight + 2;
    }
    face.add(list);
    h += 8 + 6;
    if (this.state.more) {
      face.add(this.text(this.state.more, 'label', eye, t, { color: t.soft }));
      h += label.lineHeight + 6;
    }
    if (this.state.line) {
      face.add(this.text(this.state.line, 'read', eye, t, { width: inner }));
      h += wrapLines(this.state.line, charsPerLine('read', inner / 1000, eye, t.large)) * read.lineHeight + 6;
    }
    this.state.actions.forEach((a, i) => {
      face.add(this.button(t, { ...a, eye, variant: i === 0 ? 'primary' : 'secondary', width: inner, target: a.target }));
      h += 44 + 6 + (a.disabled ? label.lineHeight + 3 : 0);
    });
    h = Math.ceil(h);
    face.setProperties({ height: h } as never);
    return { w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- new task

export type NewTaskSpec = {
  title: string;
  /** The honest line about live runs. */
  line: string;
  /** What the person said, or what is happening now. */
  heard?: string | null;
  actions: Act[];
  samples: Act[];
};

export class NewTaskPanel extends UiPanel<NewTaskSpec> {
  protected compose(t: UiTheme): Composed {
    const w = 360;
    const eye = 0.55;
    const pad = 12;
    const inner = w - 2 * pad;
    const read = typeMm('read', eye, t.large);
    const label = typeMm('label', eye, t.large);
    const chars = charsPerLine('read', inner / 1000, eye, t.large);
    const face = new Container({ ...faceStyle(t, w, { padding: pad, gap: 6 }), width: w } as never);
    let h = 2 * pad;
    face.add(this.text(this.state.title, 'read', eye, t, { weight: 700 }));
    h += read.lineHeight + 6;
    face.add(this.text(this.state.line, 'read', eye, t, { width: inner, color: t.soft }));
    h += wrapLines(this.state.line, chars) * read.lineHeight + 6;
    if (this.state.heard) {
      face.add(this.text(this.state.heard, 'read', eye, t, { width: inner }));
      h += wrapLines(this.state.heard, chars) * read.lineHeight + 6;
    }
    for (const a of this.state.actions) {
      face.add(this.button(t, { ...a, eye, variant: 'primary', width: inner, target: a.target }));
      h += 44 + 6 + (a.disabled ? label.lineHeight + 3 : 0);
    }
    if (this.state.samples.length) {
      face.add(this.text('Or watch a sample', 'label', eye, t, { color: t.soft }));
      h += label.lineHeight + 6;
      for (const a of this.state.samples) {
        face.add(this.button(t, { ...a, eye, variant: 'secondary', width: inner, target: a.target }));
        h += 44 + 6;
      }
    }
    h = Math.ceil(h);
    face.setProperties({ height: h } as never);
    return { w, h, children: [face] };
  }
}
