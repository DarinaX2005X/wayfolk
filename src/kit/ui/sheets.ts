/**
 * Sheets: paper that is read (DESIGN "Компоненты и состояния").
 *
 *   SlipSheet    what the opened rejection slip says, 18 × 16 cm read at 0.40 m:
 *                "Model said", "On page 23", "Why". Words that differ are underlined in
 *                vermilion by the word numbers of `CheckedItem.diff.marks`; a long quote
 *                shows as a window of three lines around its first differing word, so
 *                the underline is always in view. Large text grows the sheet down.
 *   RunSlip      the work sheet at the hand, 16 × 30 cm: one number per line, a line
 *                opens its own list.
 *   SourceSheet  a page of a document, 0.36 × 0.48 m: drawn by the kind of document
 *                (a letter head, message bubbles, log rows, clauses, paragraphs), the
 *                quote on highlight by `CheckedItem.spans`, Up, Down, Previous and Next.
 *   EssaySheet   an essay in "Marked passages": marked sentences with one sentence of
 *                context each side, the mark's label on the margin; "Full text" pages
 *                through the whole essay.
 */
import { Container } from '@pmndrs/uikit';
import type { Block, DocKind, QuoteSpan } from '../../agents/types';
import { charsPerLine } from '../../tokens/tokens';
import { type UiTheme } from './theme';
import { richText, typeMm, type Word } from './text';
import { UiPanel, chip, faceStyle, type Composed } from './panel';
import { SIZE } from './sizes';

// ---------------------------------------------------------------- the window around a difference

/**
 * The words of a long text that fit `lines` lines of `chars`, chosen so that the first
 * marked word sits in the window (its first line when it can). Ellipses mark cut ends.
 */
export function windowWords(all: string[], marked: number[], chars: number, lines: number): { words: Word[]; cutStart: boolean; cutEnd: boolean } {
  const mark = new Set(marked);
  const first = marked.length ? Math.min(...marked) : 0;
  const fitsFrom = (start: number): number => {
    // How many words from `start` fit the window.
    let line = 1;
    let width = start > 0 ? 2 : 0;
    let i = start;
    for (; i < all.length; i++) {
      const w = all[i].length;
      if (width > 0 && width + 1 + w > chars) {
        line += 1;
        width = 0;
        if (line > lines) break;
      }
      width += (width > 0 ? 1 : 0) + w;
    }
    return i - start;
  };
  let start = 0;
  if (fitsFrom(0) <= first) {
    // Start a few words before the difference, so it has some context on its left.
    start = Math.max(0, first - 3);
    while (start > 0 && fitsFrom(start) <= first - start) start += 1;
  }
  const count = fitsFrom(start);
  const cutStart = start > 0;
  const cutEnd = start + count < all.length;
  const words: Word[] = [];
  for (let i = start; i < start + count; i++) words.push(mark.has(i) ? { text: all[i], mark: 'diff' } : { text: all[i] });
  if (cutStart && words.length) words[0] = { ...words[0], text: `…${words[0].text}` };
  if (cutEnd && words.length) words[words.length - 1] = { ...words[words.length - 1], text: `${words[words.length - 1].text}…` };
  return { words, cutStart, cutEnd };
}

export type SlipSpec = {
  claim: string;
  source: string;
  marks?: { claim: number[]; source: number[] };
  /** The page the text was looked for on; null when the quote was found nowhere. */
  page: number | null;
  reason: string;
  /** "Dropped", "Fixed on a second look", "Planted by code", "Your test". */
  outcome?: string | null;
};

export class SlipSheet extends UiPanel<SlipSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.slipSheet;
    const s = this.state;
    const h = t.large ? c.hLarge : c.h;
    const inner = c.w - 2 * c.pad;
    const chars = charsPerLine('read', inner / 1000, c.eye, t.large);
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 0, paper: true }), width: c.w, height: h } as never);
    const caption = (text: string): Container => {
      const row = new Container({ flexDirection: 'row', justifyContent: 'space-between', width: inner } as never);
      row.add(this.text(text, 'read', c.eye, t, { weight: 700, color: t.soft }));
      return row;
    };
    const said = caption('Model said');
    if (s.outcome) said.add(chip(t, s.outcome, c.eye, s.outcome.startsWith('Fixed') ? 'ok' : 'plain'));
    face.add(said);
    const model = windowWords(s.claim.split(/\s+/).filter(Boolean), s.marks?.claim ?? [], chars, 3);
    face.add(richText(model.words, 'read', inner, { eyeDistance: c.eye, theme: t }));
    face.add(caption(s.page === null ? 'Nearest on the page' : `On page ${s.page}`));
    const page = windowWords(s.source.split(/\s+/).filter(Boolean), s.marks?.source ?? [], chars, 4);
    face.add(richText(page.words, 'read', inner, { eyeDistance: c.eye, theme: t }));
    face.add(caption('Why'));
    face.add(this.text(s.reason, 'read', c.eye, t, { width: inner, color: t.dangerText }));
    return { w: c.w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- work sheet

export type RunSlipRow = { key: string; text: string; sub?: string; items?: string[] };
export type RunSlipSpec = { rows: RunSlipRow[]; open?: string | null; title?: string };

export class RunSlip extends UiPanel<RunSlipSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.workSheet;
    const w = t.large ? c.wLarge : c.w;
    const h = t.large ? c.hLarge : c.h;
    const inner = w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const label = typeMm('label', c.eye, t.large);
    const face = new Container({ ...faceStyle(t, w, { padding: c.pad, gap: 1, paper: true }), width: w, height: h } as never);
    if (this.state.title) face.add(this.text(this.state.title, 'read', c.eye, t, { weight: 700, width: inner }));
    for (const r of this.state.rows) {
      const open = this.state.open === r.key;
      const row = new Container({
        flexDirection: 'column',
        width: inner,
        paddingX: 4,
        paddingY: 1,
        borderRadius: 6,
        backgroundColor: open ? t.face : undefined,
        hover: { backgroundColor: t.face },
        cursor: r.items ? 'pointer' : undefined,
        flexShrink: 0,
      } as never);
      row.add(this.text(r.text, 'read', c.eye, t, { weight: open ? 700 : 400, color: r.items ? t.accentText : t.text }));
      if (r.sub) row.add(this.text(r.sub, 'label', c.eye, t, { color: t.soft }));
      if (open && r.items) for (const item of r.items) row.add(this.text(item, 'label', c.eye, t, { width: inner - 8 }));
      face.add(row);
      if (r.items) {
        const made = this.button(t, { label: open ? 'Close' : 'Open', eye: c.eye, variant: 'text', target: `slip-row:${r.key}`, onSelect: () => this.set({ open: open ? null : r.key }) });
        // The whole row answers: the text button only names it for scenarios.
        made.setProperties({ display: 'none' } as never);
        face.add(made);
      }
      void read;
      void label;
    }
    return { w, h, children: [face] };
  }
}

// ---------------------------------------------------------------- source page

export type SourceSpec = {
  kind: DocKind;
  title: string;
  page: number;
  pages: number;
  /** Page number within the whole material ("p. 23"). */
  n: number;
  blocks: Block[];
  spans?: QuoteSpan[];
  /** First block shown (Up and Down move it). */
  from?: number;
  /** Who is "us" in a chat: their bubbles sit right. */
  self?: string;
  onPage?: (delta: -1 | 1) => void;
};

/** Words of a block text with `quote` marks over the characters of the spans. */
export function markedWords(text: string, spans: { start: number; end: number }[]): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = m.index;
    const b = a + m[0].length;
    const inside = spans.some((s) => a < s.end && b > s.start);
    out.push(inside ? { text: m[0], mark: 'quote' } : { text: m[0] });
  }
  return out;
}

export class SourceSheet extends UiPanel<SourceSpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.sourcePage;
    const s = this.state;
    const inner = c.w - 2 * c.pad;
    const read = typeMm('read', c.eye, t.large);
    const label = typeMm('label', c.eye, t.large);
    const chars = charsPerLine('read', inner / 1000, c.eye, t.large);
    const budget = t.large ? 16 : 20;
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 4, paper: true }), width: c.w, height: c.h } as never);
    const head = new Container({ flexDirection: 'row', justifyContent: 'space-between', width: inner } as never);
    head.add(this.text(s.title, 'label', c.eye, t, { weight: 700, color: t.soft }));
    head.add(this.text(`p. ${s.n}`, 'label', c.eye, t, { color: t.soft }));
    face.add(head);
    let lines = 1;
    const from = Math.max(0, Math.min(s.from ?? 0, s.blocks.length - 1));
    for (let i = from; i < s.blocks.length; i++) {
      const b = s.blocks[i];
      const spans = (s.spans ?? []).filter((sp) => sp.blockIndex === i);
      const words = markedWords(b.text, spans);
      const need = Math.ceil(b.text.length / chars) + (b.who || b.at ? 1 : 0);
      if (lines + need > budget && i > from) break;
      lines += need;
      if (b.k === 'head') {
        face.add(this.text(b.text, 'read', c.eye, t, { color: t.soft, width: inner }));
      } else if (b.k === 'msg') {
        const mine = s.self !== undefined && b.who === s.self;
        const bubble = new Container({
          flexDirection: 'column',
          maxWidth: inner * 0.82,
          alignSelf: mine ? 'flex-end' : 'flex-start',
          backgroundColor: mine ? t.face : t.quiet,
          borderWidth: 1,
          borderColor: t.edge,
          borderRadius: 10,
          padding: 6,
        } as never);
        if (b.who || b.at) bubble.add(this.text([b.who, b.at].filter(Boolean).join(', '), 'label', c.eye, t, { color: t.soft }));
        bubble.add(richText(words, 'read', inner * 0.82 - 12, { eyeDistance: c.eye, theme: t }));
        face.add(bubble);
      } else if (b.k === 'row') {
        const row = new Container({ flexDirection: 'row', gap: 8, width: inner, borderBottomWidth: 1, borderColor: t.edge, paddingY: 2 } as never);
        if (b.at) row.add(this.text(b.at, 'label', c.eye, t, { color: t.soft, width: inner * 0.3 }));
        row.add(richText(words, 'read', b.at ? inner * 0.7 - 8 : inner, { eyeDistance: c.eye, theme: t }));
        face.add(row);
      } else {
        if (b.who && b.k !== 'p') face.add(this.text(b.who, 'label', c.eye, t, { color: t.soft }));
        face.add(richText(words, 'read', inner, { eyeDistance: c.eye, theme: t }));
      }
    }
    void read;
    void label;
    const nav = new Container({ flexDirection: 'row', gap: 6, marginTop: 'auto', alignItems: 'center', width: inner } as never);
    nav.add(this.button(t, { label: 'Up', eye: c.eye, target: 'sheet:up', disabled: from === 0 ? 'At the top' : null, onSelect: () => this.set({ from: Math.max(0, from - 3) }) }));
    nav.add(this.button(t, { label: 'Down', eye: c.eye, target: 'sheet:down', onSelect: () => this.set({ from: Math.min(s.blocks.length - 1, from + 3) }) }));
    nav.add(this.button(t, { label: 'Previous page', eye: c.eye, target: 'sheet:prev', onSelect: () => s.onPage?.(-1) }));
    nav.add(this.button(t, { label: 'Next page', eye: c.eye, target: 'sheet:next', onSelect: () => s.onPage?.(1) }));
    face.add(nav);
    face.add(this.text(`${s.page} of ${s.pages}`, 'label', c.eye, t, { color: t.soft, width: inner, align: 'center' }));
    return { w: c.w, h: c.h, children: [face] };
  }
}

// ---------------------------------------------------------------- essay sheet

export type EssaySentence = { id: string; text: string; mark?: { label: string; severity: 'minor' | 'major' } };
export type EssaySpec = { title: string; sentences: EssaySentence[]; mode: 'marked' | 'full'; from?: number; onMode?: (mode: 'marked' | 'full') => void };

/** Marked sentences with one sentence of context on each side, in order, without repeats. */
export function markedPassages(sentences: EssaySentence[]): (EssaySentence | null)[] {
  const keep = new Set<number>();
  sentences.forEach((s, i) => {
    if (!s.mark) return;
    for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < sentences.length) keep.add(j);
  });
  const out: (EssaySentence | null)[] = [];
  let last = -2;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (last >= 0 && i > last + 1) out.push(null);
    out.push(sentences[i]);
    last = i;
  }
  return out;
}

export class EssaySheet extends UiPanel<EssaySpec> {
  protected compose(t: UiTheme): Composed {
    const c = SIZE.essay;
    const s = this.state;
    const inner = c.w - 2 * c.pad;
    const margin = 70;
    const label = typeMm('label', c.eye, t.large);
    const face = new Container({ ...faceStyle(t, c.w, { padding: c.pad, gap: 4, paper: true }), width: c.w, height: c.h } as never);
    const head = new Container({ flexDirection: 'row', justifyContent: 'space-between', width: inner } as never);
    head.add(this.text(s.title, 'read', c.eye, t, { weight: 700 }));
    head.add(this.text(s.mode === 'marked' ? 'Marked passages' : 'Full text', 'label', c.eye, t, { color: t.soft }));
    face.add(head);
    const list = s.mode === 'marked' ? markedPassages(s.sentences) : s.sentences.slice(s.from ?? 0);
    const budget = t.large ? 14 : 18;
    const chars = charsPerLine('read', (inner - margin) / 1000, c.eye, t.large);
    let lines = 0;
    for (const sentence of list) {
      if (sentence === null) {
        face.add(this.text('…', 'read', c.eye, t, { color: t.soft }));
        lines += 1;
        continue;
      }
      const need = Math.ceil(sentence.text.length / chars);
      if (lines + need > budget) break;
      lines += need;
      const row = new Container({ flexDirection: 'row', width: inner, gap: 6 } as never);
      const side = new Container({ width: margin - 6, flexShrink: 0 } as never);
      if (sentence.mark) side.add(this.text(sentence.mark.label, 'label', c.eye, t, { width: margin - 6, color: sentence.mark.severity === 'major' ? t.dangerText : t.waitText }));
      row.add(side);
      row.add(richText(sentence.text.split(/\s+/).filter(Boolean).map((w) => (sentence.mark ? { text: w, mark: 'quote' as const } : { text: w })), 'read', inner - margin, { eyeDistance: c.eye, theme: t }));
      face.add(row);
    }
    void label;
    face.add(
      this.button(t, {
        label: s.mode === 'marked' ? 'Full text' : 'Marked passages',
        eye: c.eye,
        variant: 'secondary',
        target: 'essay:mode',
        onSelect: () => {
          const next = s.mode === 'marked' ? 'full' : 'marked';
          this.set({ mode: next });
          s.onMode?.(next);
        },
      }),
    );
    return { w: c.w, h: c.h, children: [face] };
  }
}
