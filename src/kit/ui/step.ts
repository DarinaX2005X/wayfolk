/**
 * StepCard: one step of the general agent engine as a card the person reviews.
 *
 *   header   the step's title and its state in a word ("Running", "Needs you", "Approved")
 *   role     which agent did it and how long it took ("Extractor, 6.8 s")
 *   preview  a short look at the output, in one of three forms:
 *              text   an excerpt with the quote on a highlight plate (by character spans)
 *              code   a file excerpt with line numbers in tabular figures, changed lines marked
 *              table  a small table: header row and up to four rows
 *   actions  Approve, Reject, Redo; Redo opens the instruction for the second try
 *            (spoken or typed elsewhere, offered here as suggestions) with "Redo with this"
 *
 * The card stands at the hand (0.36 m wide, read at about half a metre) and grows down
 * with its preview. Every button has a named target: `step:<id>:approve`, `:reject`,
 * `:redo`, `:redo-send`, `:redo-cancel`, `:hint:<n>`.
 */
import { Container, Text } from '@pmndrs/uikit';
import type { InputKind } from '../../agents/types';
import { charsPerLine } from '../../tokens/tokens';
import { type UiTheme } from './theme';
import { richText, typeMm, wrapLines } from './text';
import { LEADING } from './text';
import { UiPanel, chip, faceStyle, type ChipTone, type Composed } from './panel';
import { markedWords } from './sheets';
import { HAND_EYE } from './sizes';

export type StepStatus = 'queued' | 'running' | 'review' | 'approved' | 'rejected' | 'redoing' | 'failed';

export type StepPreview =
  | { kind: 'text'; source: string; text: string; quote?: { start: number; end: number }[] }
  | { kind: 'code'; file: string; start: number; lines: string[]; changed?: number[] }
  | { kind: 'table'; caption?: string; columns: string[]; rows: string[][] };

export type StepSpec = {
  id: string;
  title: string;
  role: string;
  /** Seconds the call took, when it is back. */
  seconds?: number | null;
  status: StepStatus;
  preview?: StepPreview | null;
  /** A line under the preview: why it failed, what the check found. */
  note?: string | null;
  /** Redo: the instruction for the second try and ready suggestions. */
  redo?: { open: boolean; instruction?: string; suggestions?: string[] } | null;
  onApprove?: (input: InputKind) => void;
  onReject?: (input: InputKind) => void;
  onRedo?: (instruction: string, input: InputKind) => void;
};

export const STEP_CARD = { w: 360, pad: 10, eye: HAND_EYE, previewLines: 5, tableRows: 4 } as const;

const STATUS: Record<StepStatus, { word: string; tone: ChipTone }> = {
  queued: { word: 'Queued', tone: 'plain' },
  running: { word: 'Running', tone: 'accent' },
  review: { word: 'Needs you', tone: 'wait' },
  approved: { word: 'Approved', tone: 'ok' },
  rejected: { word: 'Rejected', tone: 'danger' },
  redoing: { word: 'Redoing', tone: 'accent' },
  failed: { word: 'Failed', tone: 'danger' },
};

/** The first `lines` lines of a text excerpt, cut so that the first quoted character is in view. */
export function excerpt(text: string, quote: { start: number; end: number }[] | undefined, chars: number, lines: number): { text: string; offset: number } {
  const budget = chars * lines;
  if (text.length <= budget) return { text, offset: 0 };
  const first = quote?.length ? Math.min(...quote.map((q) => q.start)) : 0;
  let start = Math.max(0, first - Math.floor(chars * 0.8));
  // Start at a word.
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space >= 0 && space < first ? space + 1 : start;
  }
  let end = Math.min(text.length, start + budget - 2);
  const back = text.lastIndexOf(' ', end);
  if (back > start + chars) end = back;
  const pre = start > 0 ? '…' : '';
  const post = end < text.length ? '…' : '';
  return { text: `${pre}${text.slice(start, end)}${post}`, offset: start - pre.length };
}

export class StepCard extends UiPanel<StepSpec> {
  protected compose(t: UiTheme): Composed {
    const c = STEP_CARD;
    const s = this.state;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const label = typeMm('label', c.eye, t.large);
    const chars = charsPerLine('read', (inner - 12) / 1000, c.eye, t.large);
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 6 }), width: c.w } as never);
    let h = 2 * c.pad;

    // ---- header and role
    const head = new Container({ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', width: inner, gapRow: 2 } as never);
    const st = STATUS[s.status];
    head.add(this.text(s.title, 'read', c.eye, t, { weight: 700 }));
    head.add(chip(t, st.word, c.eye, st.tone));
    face.add(head);
    const headLines = wrapLines(`${s.title} ${st.word}xx`, chars);
    h += headLines * (read.lineHeight + 2) + 6;
    const roleLine = typeof s.seconds === 'number' ? `${s.role}, ${s.seconds.toFixed(1)} s` : s.role;
    face.add(this.text(roleLine, 'label', c.eye, t, { color: t.soft, width: inner }));
    h += label.lineHeight + 6;

    // ---- preview
    const p = s.preview;
    if (p) {
      const box = new Container({
        flexDirection: 'column',
        width: inner,
        padding: 6,
        gap: 2,
        backgroundColor: t.paper,
        borderWidth: 1,
        borderColor: t.edge,
        borderRadius: 8,
      } as never);
      let lines = 0;
      if (p.kind === 'text') {
        box.add(this.text(p.source, 'label', c.eye, t, { color: t.soft }));
        lines += label.lineHeight / read.lineHeight;
        const ex = excerpt(p.text, p.quote, chars, c.previewLines);
        const spans = (p.quote ?? []).map((q) => ({ start: q.start - ex.offset, end: q.end - ex.offset }));
        box.add(richText(markedWords(ex.text, spans), 'read', inner - 12, { eyeDistance: c.eye, theme: t }));
        lines += Math.min(c.previewLines, wrapLines(ex.text, chars));
      } else if (p.kind === 'code') {
        box.add(this.text(p.file, 'label', c.eye, t, { color: t.soft }));
        lines += label.lineHeight / read.lineHeight;
        const changed = new Set(p.changed ?? []);
        const last = p.start + Math.min(p.lines.length, c.previewLines) - 1;
        const gutter = String(last).length * read.fontSize * 0.55 + 6;
        const codeChars = charsPerLine('read', (inner - 12 - gutter - 6) / 1000, c.eye, t.large);
        p.lines.slice(0, c.previewLines).forEach((code, i) => {
          const n = p.start + i;
          const row = new Container({ flexDirection: 'row', gap: 6, width: inner - 12, backgroundColor: changed.has(n) ? t.highlight : undefined, borderRadius: 2 } as never);
          row.add(new Text({ text: String(n), fontSize: read.fontSize, lineHeight: LEADING, color: changed.has(n) ? '#1E2421' : t.soft, width: gutter, textAlign: 'right', flexShrink: 0 } as never));
          // Code keeps its indentation; a line wider than the card is cut with an ellipsis.
          const shown = code.length > codeChars ? `${code.slice(0, codeChars - 1)}…` : code;
          row.add(new Text({ text: shown.replace(/\t/g, '  ') || ' ', fontSize: read.fontSize, lineHeight: LEADING, color: changed.has(n) ? '#1E2421' : t.text, whiteSpace: 'pre' } as never));
          box.add(row);
          lines += 1;
        });
        if (p.lines.length > c.previewLines) {
          box.add(this.text(`${p.lines.length - c.previewLines} more lines`, 'label', c.eye, t, { color: t.soft }));
          lines += label.lineHeight / read.lineHeight;
        }
      } else {
        if (p.caption) {
          box.add(this.text(p.caption, 'label', c.eye, t, { color: t.soft }));
          lines += label.lineHeight / read.lineHeight;
        }
        const cols = Math.max(1, p.columns.length);
        const colW = (inner - 12 - (cols - 1) * 6) / cols;
        const colChars = charsPerLine('read', colW / 1000, c.eye, t.large);
        const cut = (v: string): string => (v.length > colChars ? `${v.slice(0, Math.max(1, colChars - 1))}…` : v);
        const row = (cells: string[], header: boolean): Container => {
          const r = new Container({ flexDirection: 'row', gap: 6, width: inner - 12, borderBottomWidth: header ? 1 : 0, borderColor: t.edge } as never);
          cells.slice(0, cols).forEach((v, i) => {
            const numeric = /^[-+$£]?[\d.,]+%?$/.test(v.trim());
            r.add(new Text({ text: cut(v), fontSize: header ? label.fontSize : read.fontSize, lineHeight: LEADING, fontWeight: header ? 700 : 400, color: header ? t.soft : t.text, width: colW, textAlign: numeric && i > 0 ? 'right' : 'left' } as never));
          });
          return r;
        };
        box.add(row(p.columns, true));
        lines += 1;
        for (const cells of p.rows.slice(0, c.tableRows)) {
          box.add(row(cells, false));
          lines += 1;
        }
        if (p.rows.length > c.tableRows) {
          box.add(this.text(`${p.rows.length - c.tableRows} more rows`, 'label', c.eye, t, { color: t.soft }));
          lines += label.lineHeight / read.lineHeight;
        }
      }
      face.add(box);
      h += lines * read.lineHeight + 12 + 2 + 6 + 4;
    }

    if (s.note) {
      face.add(this.text(s.note, 'read', c.eye, t, { width: inner, color: s.status === 'failed' || s.status === 'rejected' ? t.dangerText : t.soft }));
      h += wrapLines(s.note, charsPerLine('read', inner / 1000, c.eye, t.large)) * read.lineHeight + 6;
    }

    // ---- actions
    const redo = s.redo;
    if (redo?.open) {
      const instruction = redo.instruction?.trim() ?? '';
      face.add(this.text('What should change?', 'read', c.eye, t, { weight: 700 }));
      face.add(this.text(instruction || 'Say it, type it, or pick one below.', 'read', c.eye, t, { width: inner, color: instruction ? t.text : t.soft }));
      h += read.lineHeight * (1 + wrapLines(instruction || 'Say it, type it, or pick one below.', charsPerLine('read', inner / 1000, c.eye, t.large))) + 12;
      for (const [i, hint] of (redo.suggestions ?? []).slice(0, 3).entries()) {
        face.add(this.button(t, { label: hint, eye: c.eye, variant: 'secondary', width: inner, target: `step:${s.id}:hint:${i}`, onSelect: () => this.set({ redo: { ...redo, instruction: hint } }) }));
        h += 44 + 6 + 6;
      }
      const row = new Container({ flexDirection: 'row', gap: 8, width: inner } as never);
      row.add(
        this.button(t, {
          label: 'Redo with this',
          eye: c.eye,
          variant: 'primary',
          grow: true,
          target: `step:${s.id}:redo-send`,
          look: instruction ? undefined : 'disabled',
          onSelect: (input) => {
            this.set({ status: 'redoing', redo: { ...redo, open: false } });
            s.onRedo?.(instruction, input);
          },
        }),
      );
      row.add(this.button(t, { label: 'Cancel', eye: c.eye, variant: 'text', target: `step:${s.id}:redo-cancel`, onSelect: () => this.set({ redo: { ...redo, open: false } }) }));
      face.add(row);
      h += 44 + 6 + 6;
    } else if (s.status === 'review') {
      const row = new Container({ flexDirection: 'row', gap: 8, width: inner } as never);
      row.add(this.button(t, { label: 'Approve', eye: c.eye, variant: 'primary', grow: true, target: `step:${s.id}:approve`, onSelect: (input) => (this.set({ status: 'approved' }), s.onApprove?.(input)) }));
      row.add(this.button(t, { label: 'Reject', eye: c.eye, variant: 'secondary', grow: true, target: `step:${s.id}:reject`, onSelect: (input) => (this.set({ status: 'rejected' }), s.onReject?.(input)) }));
      row.add(this.button(t, { label: 'Redo', eye: c.eye, variant: 'text', target: `step:${s.id}:redo`, onSelect: () => this.set({ redo: { suggestions: [], ...redo, open: true } }) }));
      face.add(row);
      h += 44 + 6 + 6;
    }
    // The face takes the height of its content; `h` is the estimate the roots place it by.
    return { w: c.w, h: Math.ceil(h), children: [face] };
  }
}
