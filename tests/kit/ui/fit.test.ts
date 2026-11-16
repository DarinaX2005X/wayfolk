/**
 * Capacity test (task 01.3.2): every English line of DESIGN "Тексты" in the panel that
 * shows it, at the panel's distance from the eyes, in ordinary and in large text (×1.25).
 * Which line goes where and in which role comes from DESIGN "Типографика" (tokens PANEL)
 * and the panel sizes of src/kit/ui/sizes.ts, which the panels themselves build from.
 * A line that does not fit fails with the panel's name; the fix is the panel's size or a
 * wrap, never a shorter text without a word in the report.
 */
import { describe, expect, it } from 'vitest';
import { PANEL, lineHeightFor, textSizeFor, type TextRole } from '../../../src/tokens/tokens';
import { fits, linesFor } from '../../../src/kit/ui/text';
import { SIZE } from '../../../src/kit/ui/sizes';
import { splitCaption } from '../../../src/feel/captions';

const LARGE = [false, true] as const;
const mm = (n: number): number => n / 1000;
const lh = (role: TextRole, eye: number, large: boolean): number => lineHeightFor(role, eye, large);
/** Width a line of a role takes, metres (average glyph half the font size). */
const widthOf = (text: string, role: TextRole, eye: number, large: boolean): number => text.length * textSizeFor(role, eye, large) * 0.5;

function oneLine(panel: string, text: string, role: TextRole, widthM: number, eye: number, large: boolean): void {
  expect(linesFor(text, role, widthM, eye, large), `${panel}${large ? ' (large text)' : ''}: "${text}"`).toBe(1);
}

describe('envelope label: two lines of 25 in a 16 × 9 cm field at 0.59 m; large text wraps each to two', () => {
  const labels: [string, string][] = [
    ['Harbor Street, Unit 4B', '64 pages, 12 documents'],
    ['Wedding', '84 guests, a wish letter'],
    ['Class 9B', '24 essays, 2 marked'],
    ['Your files', 'Send them from your phone'],
    ['2 late pages', 'Dana Whitlock, sample'],
    ['Enter a code', 'Visit or join'],
  ];
  const p = PANEL.envelopeLabel;
  for (const large of LARGE)
    it.each(labels)(`%s / %s${large ? ' (large)' : ''}`, (a, b) => {
      if (!large) {
        oneLine('envelope label', a, 'label', p.size.w, p.eyeDist, false);
        oneLine('envelope label', b, 'label', p.size.w, p.eyeDist, false);
      }
      expect(fits(`${a}\n${b}`, 'label', p.size, p.eyeDist, large), 'envelope label').toBe(true);
    });
});

describe('slip in the tray: two lines of up to 9 on 7.5 × 5 cm at 0.56 m', () => {
  const slips: [string, string][] = [
    ['Quote not', 'found'],
    ['Quote', 'altered'],
    ['Quote too', 'short'],
    ['Wrong', 'date'],
    ['Wrong', 'weekday'],
    ['Out of', 'range'],
    ['Unknown', 'person'],
    ['Not on', 'the list'],
    ['Source', 'not found'],
    ['Not in', 'essay'],
    ['Unknown', 'mark'],
  ];
  const p = PANEL.traySlip;
  for (const large of LARGE)
    it.each(slips)(`%s / %s${large ? ' (large)' : ''}`, (a, b) => {
      oneLine('tray slip', a, 'label', p.size.w, p.eyeDist, large);
      oneLine('tray slip', b, 'label', p.size.w, p.eyeDist, large);
      expect(fits(`${a}\n${b}`, 'label', p.size, p.eyeDist, large)).toBe(true);
    });
});

describe('opened slip: 18 × 16 cm (large 18 × 22) read at 0.40 m', () => {
  const s = SIZE.slipSheet;
  const reasons = [
    'Quote not found on page 23',
    'A date in the quote was changed: the page says 6 March',
    'A name in the quote was changed: the page says Lena',
    'A number in the quote was changed: the page says $2,600',
    'A "not" in the quote was changed',
    'The quote is too short to check (8 characters)',
    "Date 14 March doesn't match the quote (4 March)",
    '4 March 2026 was a Wednesday, the quote says Friday',
    '12 January 2025 is outside the dates of this case',
    "Ms Whitmore isn't a party in this case",
    "Marco isn't on the guest list",
    "This wish isn't in your letter or the guest notes",
    "Marked sentence isn't in this essay",
    '"tone" isn\'t one of your kinds of mistake',
    'Quote is on page 41, not 40. Page corrected by the check.',
  ];
  for (const large of LARGE) {
    const inner = mm(s.w - 2 * s.pad);
    it(`holds three captions, three lines of the model, four of the page and two of the reason${large ? ' (large)' : ''}`, () => {
      // Large text: the reason may take a third line, the page window gives one back, and the
      // outcome word may drop under its caption.
      for (const r of reasons) expect(linesFor(r, 'read', inner, s.eye, large), `slip sheet reason "${r}"`).toBeLessThanOrEqual(large ? 3 : 2);
      const lines = large ? 3 + 3 + 3 + 3 + 1 : 3 + 3 + 4 + 2;
      expect(lines * lh('read', s.eye, large), 'slip sheet height').toBeLessThanOrEqual(mm((large ? s.hLarge : s.h) - 2 * s.pad));
    });
    it(`has 35 characters a line${large ? ' (29 in large text)' : ''}`, () => {
      expect(Math.floor(inner / (textSizeFor('read', s.eye, large) * 0.5))).toBeGreaterThanOrEqual(large ? 29 : 35);
    });
    it(`fits the outcome words beside or under their caption${large ? ' (large)' : ''}`, () => {
      for (const o of ['Dropped', 'Fixed on a second look', 'No second look in this recording', 'Planted by code', 'Your test']) {
        expect(linesFor(o, 'label', inner, s.eye, large), `slip sheet outcome "${o}"`).toBe(1);
      }
    });
  }
});

describe('run card: two flat lines of 22, the buttons and the line under "Run it live"', () => {
  const c = SIZE.runCard;
  const inner = mm(c.w - 2 * c.pad);
  const lines = ['Recorded live, 16 Nov', 'Checked on this device', 'Scripted sample run', 'Live run, 7 of 30 calls', 'Paused'];
  const notes = ['3 live runs left today for everyone.', "Today's live runs are used up.", 'Available when this run ends.', 'Live model runs are off in this copy.'];
  for (const large of LARGE) {
    it(`fits each line on one line${large ? ' (large)' : ''}`, () => {
      for (const l of lines) oneLine('run card', l, 'flat', inner, c.eye, large);
      for (const n of notes) oneLine('run card note', n, 'label', inner, c.eye, large);
    });
    it(`puts both buttons in one row${large ? ' (large)' : ''}`, () => {
      const pad = (role: TextRole): number => 2 * Math.max(mm(8), textSizeFor(role, c.eye, large) * 0.7);
      const row = widthOf('Skip to the result', 'read', c.eye, large) + widthOf('Run it live', 'read', c.eye, large) + 2 * pad('read') + mm(6);
      expect(row, 'run card buttons').toBeLessThanOrEqual(inner);
    });
    it(`has the height for it (DESIGN 13 cm, here ${c.h / 10} cm; large ${c.hLarge / 10} cm)${large ? ' (large)' : ''}`, () => {
      const h = 2 * lh('flat', c.eye, large) + 0.044 + lh('label', c.eye, large) + mm(2 * c.pad + 2 * c.gap + 3);
      expect(h, 'run card height').toBeLessThanOrEqual(mm(large ? c.hLarge : c.h));
    });
  }
});

describe('caption rail: two lines of 46 at 0.76 m, the source in bold', () => {
  const r = SIZE.rail;
  const captions: [string, string][] = [
    ['Goal', "Find where the stories don't match."],
    ['Run', 'Recorded answers from a live run on 16 Nov (google/gemini-2.5-flash-lite, 18 calls). Every check runs now, on this device.'],
    ['Run', '5 fakes were added by code to test the check.'],
    ['Run', 'Shown 1.6× faster than it was recorded.'],
    ['Run', 'Sample run. The model answers are scripted, and 9 of them are wrong on purpose. Every check runs now, on this device.'],
    ['Run', 'Paused. It continues when you are back.'],
    ['Check', 'Both quotes are checked. Whether they conflict is the model\'s reading.'],
    ['Seat', 'The run plays in the Void. Your room comes back with the result.'],
    ['Planner', 'Planner named "Dana Whitlock", who isn\'t in the documents. Left out.'],
    ['Run', "You're offline. The run continues when the connection is back."],
    ['Run', 'The live model stopped answering. Finishing with recorded answers.'],
    ['Heard', 'only Mark and Lena'],
    ['Voice', "Voice is off in this copy. Pick a command."],
    ['Groundwork', 'I can filter the timeline, open pages, or send files to your phone.'],
    ['Seat', 'Edith and Hal moved to table 11. The Lindqvists took their seats at table 6.'],
    ['Essays', "I can change what a mistake costs or clear a mark. I don't change scores without a reason."],
  ];
  for (const large of LARGE)
    it.each(captions)(`%s: %s${large ? ' (large)' : ''}`, (source, text) => {
      for (const part of splitCaption(source, text)) {
        expect(fits(`${source}: ${part}`, 'read', { w: mm(r.w - 2 * r.padX), h: mm((large ? r.hLarge : r.h) - 2 * r.padY) }, r.eye, large), `caption rail "${part}"`).toBe(true);
      }
    });
});

describe('question card: up to 144 characters in three lines (four in large), two buttons, the countdown', () => {
  const c = SIZE.askCard;
  const inner = mm(c.w - 2 * c.pad);
  const questions = [
    'Mark says he returned "the keys" on 27 February. The check-out report logs a "mailbox key" handed in on 9 March. Are these the same keys?',
    'The documents give two values for keys returned: 27 Feb 2026 and 9 Mar 2026. Is this a real conflict?',
  ];
  for (const large of LARGE)
    it.each(questions)(`%s${large ? ' (large)' : ''}`, (q) => {
      expect(q.length).toBeLessThanOrEqual(144);
      const lines = linesFor(q, 'read', inner, c.eye, large);
      expect(lines, 'ask card lines').toBeLessThanOrEqual(large ? 4 : 3);
      const h = mm(c.strip + 2 * c.pad + 6 + c.bar) + lines * lh('read', c.eye, large) + 0.044;
      expect(h, 'ask card height').toBeLessThanOrEqual(mm(large ? c.hLarge : c.h));
      for (const b of ['Same keys', 'Different keys']) expect(widthOf(b, 'read', c.eye, large) + mm(20), `ask card button "${b}"`).toBeLessThanOrEqual(inner / 2);
    });
});

describe('station board: 0.42 × 0.34 m (large 0.50 × 0.41) at 1.3 m', () => {
  const b = SIZE.board;
  const titles = ['Checking quotes', 'Read', 'Extract', 'Check', 'Reconcile', 'Assemble', 'Wishes', 'Seat', 'Mark', 'Calibrate', 'Plan'];
  const rows = [
    '62 laid as ground', '4 sent back', '124 claims', '112 match the page', '2 corrected by code', '4 duplicates merged',
    '6 sent back', '3 fixed, 3 dropped', 'Planted 9, caught 9', 'Planted 5, caught 5', 'Treat this run with care', '14 pairs to compare',
    '12 documents', '64 pages', '11 batches of 6', '6 people', '7 topics', 'up to 21 model calls', 'Waiting for the model.', 'Retrying in 8 s.',
    '84 guests', '31 parties', '11 tables', '88 seats', '3 model calls', '1 question for you',
  ];
  /** Lines longer than 25 characters wrap to two lines and the board grows down (DESIGN allows to 0.5 m). */
  const long = ['1 planted mistake got through', "Pages 31–36 couldn't be read", 'Call budget reached. 3 second looks were skipped.', 'Slowing down to 2 calls at a time.', 'Extractor is asked to answer again'];
  for (const large of LARGE) {
    const w = mm((large ? b.wLarge : b.w) - 2 * b.rim - 2 * (large ? b.padLarge : b.pad));
    it(`fits every title and row on one line${large ? ' (large)' : ''}`, () => {
      for (const t of titles) oneLine('station board title', t, 'body', w, b.eye, large);
      oneLine('station board subtitle', 'Checked by code, not a model', 'label', w, b.eye, large);
      for (const r of rows) oneLine('station board row', r, 'read', w, b.eye, large);
    });
    it(`wraps the long lines into two (three in large text)${large ? ' (large)' : ''}`, () => {
      for (const r of long) expect(linesFor(r, 'read', w, b.eye, large), `station board "${r}"`).toBeLessThanOrEqual(large ? 3 : 2);
    });
    it(`puts the counter and its unit on one line${large ? ' (large)' : ''}`, () => {
      const row = widthOf('124', 'view', b.eye, large) + widthOf('of 124 claims', 'read', b.eye, large) + textSizeFor('read', b.eye, large) * 0.35;
      expect(row, 'station board counter').toBeLessThanOrEqual(w);
    });
    it(`holds title, subtitle, counter, three rows and the bar in its height${large ? ' (large)' : ''}`, () => {
      const pad = large ? b.padLarge : b.pad;
      const h = lh('body', b.eye, large) + lh('label', b.eye, large) + lh('view', b.eye, large) + 3 * lh('read', b.eye, large) + mm(b.progress + 5 * b.gap + 2 * pad + 2 * b.rim);
      expect(h, 'station board height').toBeLessThanOrEqual(mm(large ? b.hLarge : b.h));
    });
    it(`holds the plan's title and six rows when it grows ${large ? b.planGrowLarge / 10 : b.planGrow / 10} cm${large ? ' (large)' : ''}`, () => {
      const pad = large ? b.padLarge : b.pad;
      const h = lh('body', b.eye, large) + 6 * lh('read', b.eye, large) + mm(6 * b.gap + 2 * pad + 2 * b.rim);
      expect(h, 'plan board height').toBeLessThanOrEqual(mm((large ? b.hLarge + b.planGrowLarge : b.h + b.planGrow)));
    });
  }
  it('names a station on its chip in one weight, with its number when it fits', () => {
    const c = SIZE.chip;
    const inner = mm(c.w - 8 - 2 * c.pad);
    for (const t of titles.filter((x) => x !== 'Checking quotes')) oneLine('station chip', t, 'label', inner, c.eye, false);
    oneLine('station chip', 'Read 64', 'label', inner, c.eye, false);
  });
});

describe('reading line: two lines of 44 at 1.33 m', () => {
  const r = SIZE.reading;
  const texts = [
    "119 events from 64 pages. 6 places where the stories don't match",
    '27 Feb Mark, keys returned to the office. Text messages, p. 31',
    'Review due in 6 days. 6 contradictions are open.',
    'Ahead: evidence due 4 Mar 2027, in 105 days',
    'You kept this as a conflict. Page 65 now resolves it.',
  ];
  for (const large of LARGE)
    it.each(texts)(`%s${large ? ' (large)' : ''}`, (t) => {
      expect(fits(t, 'read', { w: mm(r.w - 2 * r.pad), h: mm((large ? r.hLarge : r.h) - 2 * r.pad) }, r.eye, large), `reading line "${t}"`).toBe(true);
    });
});

describe('work sheet at the hand: lines of up to 28 at 0.45 m, 16 × 30 cm (large 18 × 38)', () => {
  const s = SIZE.workSheet;
  const rows = [
    '64 pages', '18 model calls', 'model time 1 min 42 s', 'calls ran in parallel', 'checks 0.3 s', '124 claims', '119 events kept',
    '6 contradictions', 'Planted 9, caught 9', '112 match the page', '2 corrected by code', '4 duplicates merged', '6 sent back',
    '3 fixed, 3 dropped', '2 added on a second look', '1 fact removed', '3 dated passages not used', 'Try to fool the check',
  ];
  for (const large of LARGE)
    it(`holds every number of a run${large ? ' (large: a long line wraps)' : ''}`, () => {
      const w = mm((large ? s.wLarge : s.w) - 2 * s.pad);
      let lines = 0;
      for (const r of rows) {
        const n = linesFor(r, 'read', w, s.eye, large);
        if (!large) expect(n, `work sheet "${r}"`).toBe(1);
        lines += n;
      }
      expect(lines * lh('read', s.eye, large), 'work sheet height').toBeLessThanOrEqual(mm((large ? s.hLarge : s.h) - 2 * s.pad));
      expect(linesFor('Every dated passage is used', 'read', w, s.eye, large)).toBeLessThanOrEqual(large ? 2 : 1);
    });
});

describe('code card: five characters and the address at 0.6 m', () => {
  const c = SIZE.codeCard;
  for (const large of LARGE)
    it(`fits the code and an address of 44 characters in two lines${large ? ' (large)' : ''}`, () => {
      const inner = mm(c.w - 2 * c.pad);
      expect(widthOf('X4KM7', 'count', c.eye, large) * 1.2, 'code card code').toBeLessThanOrEqual(inner);
      const address = 'groundwork-git-main-darina.vercel.app/go/X4K';
      expect(address.length).toBe(44);
      expect(linesFor(address, 'read', inner, c.eye, large), 'code card address').toBeLessThanOrEqual(2);
      const h = lh('count', c.eye, large) + 2 * lh('read', c.eye, large) + mm(2 * c.pad);
      // In large text the card grows down by up to 2 cm (DESIGN gives it no large size).
      expect(h, 'code card height').toBeLessThanOrEqual(mm(c.h) + (large ? 0.02 : 0));
    });
});

describe('plot label: two lines of 22 at 1.7 m on 0.40 × 0.11 m (large 0.50 × 0.135)', () => {
  const p = PANEL.plotLabel;
  const titles: [string, string][] = [
    ['Harbor Street, Unit 4B', '6 open, 119 events'],
    ['Wedding', '84 guests, 1 needs you'],
    ['Class 9B', '24 essays, 3 to look at'],
  ];
  for (const large of LARGE)
    it.each(titles)(`%s / %s${large ? ' (large)' : ''}`, (a, b) => {
      const box = large ? p.large : p.size;
      oneLine('plot label', a, 'label', box.w, p.eyeDist, large);
      oneLine('plot label', b, 'label', box.w, p.eyeDist, large);
      expect(fits(`${a}\n${b}`, 'label', box, p.eyeDist, large)).toBe(true);
    });
});

describe('source page and essay sheet: 44 characters × 20 lines (large 35 × 16) at 0.65 m', () => {
  const s = SIZE.sourcePage;
  for (const large of LARGE)
    it(`holds its screen of text${large ? ' (large)' : ''}`, () => {
      const inner = mm(s.w - 2 * s.pad);
      const chars = Math.floor(inner / (textSizeFor('read', s.eye, large) * 0.5));
      expect(chars, 'source page characters').toBeGreaterThanOrEqual(large ? 35 : 44);
      // The page buttons hang under the sheet; the sheet holds its title line and the text.
      const text = mm(s.h - 2 * s.pad - 4) - lh('label', s.eye, large);
      expect(Math.floor(text / lh('read', s.eye, large)), 'source page lines').toBeGreaterThanOrEqual(large ? 16 : 20);
    });
});

describe('step card: title, role, a preview of text, code or a table, and three actions at the hand', () => {
  const c = { w: 360, pad: 10, eye: SIZE.callCard.eye };
  const inner = mm(c.w - 2 * c.pad);
  const titles = ['Find the dates in the lease', 'Fix the date parser', 'Sum the rent payments', 'Read the scanned receipts', 'Compare the two statements'];
  for (const large of LARGE) {
    it(`fits a title and its state word in two lines${large ? ' (large)' : ''}`, () => {
      for (const t of titles) expect(linesFor(`${t} Needs you`, 'read', inner, c.eye, large), `step card "${t}"`).toBeLessThanOrEqual(2);
    });
    it(`puts Approve, Reject and Redo in one row${large ? ' (large)' : ''}`, () => {
      const pad = 2 * Math.max(mm(8), textSizeFor('read', c.eye, large) * 0.7);
      const row = ['Approve', 'Reject', 'Redo'].reduce((sum, b) => sum + widthOf(b, 'read', c.eye, large) + pad, 0) + mm(16);
      expect(row, 'step card actions').toBeLessThanOrEqual(inner);
    });
    it(`shows a three-column table of dates, names and amounts${large ? ' (large)' : ''}`, () => {
      const col = (inner - mm(12 + 12)) / 3;
      for (const v of ['3 Jan 2026', 'Pierline', '$1,450']) oneLine('step card table', v, 'read', col, c.eye, large);
    });
    it(`shows code lines of at least 36 characters with their numbers${large ? ' (large)' : ''}`, () => {
      const gutter = 3 * textSizeFor('read', c.eye, large) * 0.55 + mm(6 + 6 + 12);
      expect(Math.floor((inner - gutter) / (textSizeFor('read', c.eye, large) * 0.5))).toBeGreaterThanOrEqual(large ? 29 : 36);
    });
  }
});
