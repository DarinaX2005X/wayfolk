/**
 * Text in the headset (DESIGN "Типографика", task 01.3.2).
 *
 *   fits(text, role, box, eyeDistance, large)   does a line fit its field: the capacity
 *       test of every product string (tests/kit/ui/fit.test.ts) and of panels that
 *       choose between a long and a short form at run time.
 *   richText(words, role, width)                text laid out word by word, with what
 *       uikit's Text cannot do inside a line: an underlined word (the vermilion line
 *       under a changed word of a rejected quote), a highlighted run over several lines
 *       (a quote on its page), and a bold word (the source of a caption).
 *
 * Sizes follow tokens: capital height in mm at 1 m ("dmm"), font size = cap / 0.7, line
 * height 1.35 font sizes, an average character half a font size wide.
 */
import { Container, Text } from '@pmndrs/uikit';
import { TEXT, charsPerLine, lineHeightFor, textSizeFor, type TextRole } from '../../tokens/tokens';
import { uiTheme, type UiTheme } from './theme';

/** How many lines `text` takes when wrapped at words into lines of `chars` characters. */
/** uikit takes line height as a multiple of the font size. */
export const LEADING = TEXT.lineHeight;

export function wrapLines(text: string, chars: number): number {
  if (chars <= 0) return Infinity;
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    let width = 0;
    let used = false;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      // A word longer than the line breaks over several lines.
      let w = word.length;
      if (!used) {
        lines += 1;
        used = true;
      }
      if (width > 0 && width + 1 + w > chars) {
        lines += 1;
        width = 0;
      }
      while (w > chars) {
        lines += 1;
        w -= chars;
      }
      width += (width > 0 ? 1 : 0) + w;
    }
    if (!used) lines += 1;
  }
  return lines;
}

/**
 * Whether `text` of a role fits a box (metres) seen from `eyeDistance` metres, wrapped
 * at words, with line height 1.35. `large` applies the ×1.25 of large text.
 */
export function fits(text: string, role: TextRole, box: { w: number; h: number }, eyeDistance: number, large = false): boolean {
  const chars = charsPerLine(role, box.w, eyeDistance, large);
  const lines = wrapLines(text, chars);
  const height = lines * lineHeightFor(role, eyeDistance, large);
  return height <= box.h + 1e-9;
}

/** Lines a text takes in a width (metres). */
export function linesFor(text: string, role: TextRole, widthM: number, eyeDistance: number, large = false): number {
  return wrapLines(text, charsPerLine(role, widthM, eyeDistance, large));
}

/** Font size and line height in layout mm for a role, as uikit takes them. */
export function typeMm(role: TextRole, eyeDistance: number, large: boolean): { fontSize: number; lineHeight: number } {
  const fontSize = textSizeFor(role, eyeDistance, large) * 1000;
  return { fontSize, lineHeight: fontSize * TEXT.lineHeight };
}

export type Word = { text: string; mark?: 'diff' | 'quote' | 'bold' };

/**
 * A run of words that wraps like text. `diff` underlines a word with a thin vermilion
 * bar, `quote` puts a highlight plate behind it (neighbouring quote words join into one
 * plate per line), `bold` sets it in 700. Returns a uikit container `width` mm wide.
 */
export function richText(
  words: Word[],
  role: TextRole,
  width: number,
  opts: { eyeDistance?: number; theme?: UiTheme; color?: string } = {},
): Container {
  const theme = opts.theme ?? uiTheme();
  const eye = opts.eyeDistance ?? 1;
  const { fontSize, lineHeight } = typeMm(role, eye, theme.large);
  const space = fontSize * 0.26;
  const box = new Container({ width, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start' } as never);
  words.forEach((w, i) => {
    const next = words[i + 1];
    const quote = w.mark === 'quote';
    const joinRight = quote && next?.mark === 'quote';
    const cell = new Container({
      flexDirection: 'column',
      height: lineHeight,
      paddingRight: joinRight ? space : 0,
      marginRight: joinRight ? 0 : space,
      backgroundColor: quote ? theme.highlight : undefined,
      borderRadius: quote ? 1.5 : 0,
      borderBottomWidth: w.mark === 'diff' ? Math.max(0.8, fontSize * 0.09) : 0,
      borderColor: theme.danger,
    } as never);
    const color = quote ? (theme.hc ? '#111513' : theme.text) : (opts.color ?? theme.text);
    cell.add(new Text({ text: w.text, fontSize, lineHeight: LEADING, fontWeight: w.mark === 'bold' ? 700 : 400, color } as never));
    box.add(cell);
  });
  return box;
}

/** Splits a sentence into plain words. */
export function words(text: string, mark?: Word['mark']): Word[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (mark ? { text: t, mark } : { text: t }));
}
