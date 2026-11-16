/**
 * Every panel of the UI kit in every state, for /gallery (task 01.3.5). The texts are
 * the product's own lines from DESIGN "Тексты"; the numbers are the Harbor Street
 * targets, standing in for what the engine will send.
 */
import type { Object3D } from '@iwsdk/core';
import type { Container } from '@pmndrs/uikit';
import { defaultSettings } from '../../app/store';
import { asRoot, type PanelLike } from './root';
import type { GalleryEntry, GalleryState } from './types';
import { Button, Chip, Counter, Toggle, type ButtonLook, type ButtonVariant } from './panel';
import { CaptionRail, ReadingLine, StationBoard, type BoardSpec } from './boards';
import { AskCard, CallCard, CodeCard, ConfirmCard, NoteSheet, PairStrip, RunCard } from './cards';
import { EssaySheet, RunSlip, SlipSheet, SourceSheet } from './sheets';
import { ClassErrors, CodePad, CriterionBars, RulesList, SettingsPanel, TableCard, WishStrip } from './tools';
import { SIZE } from './sizes';

const noop = (): void => undefined;

/** A state that shows one panel standing on its own. */
function st(name: string, make: () => PanelLike & { at?: (s: number) => void }): GalleryState {
  return {
    name,
    build: () => {
      const panel = make();
      const root: Container = asRoot(panel);
      root.name = `gallery:${name}`;
      if (panel.at) (root as unknown as Object3D).userData.at = (t: number) => panel.at?.(t);
      return root as unknown as Object3D;
    },
  };
}

const LOOKS: ButtonLook[] = ['rest', 'hover', 'pressed', 'focus', 'dwell', 'disabled'];
const button = (variant: ButtonVariant, label: string): GalleryEntry => ({
  id: `button-${variant}`,
  title: `Button, ${variant}`,
  states: LOOKS.map((look) =>
    st(look, () => new Button({ label, variant, eye: 0.55, look, dwell: 0.6, disabled: look === 'disabled' ? 'Available when this run ends.' : null, onSelect: noop })),
  ),
});

const gate = (patch: Partial<BoardSpec>): BoardSpec => ({
  form: 'full',
  state: 'active',
  title: 'Checking quotes',
  sub: 'Checked by code, not a model',
  count: 62,
  unit: 'checked',
  rows: ['62 laid as ground', '4 sent back'],
  progress: 0.5,
  ...patch,
});

const SLIP = {
  claim: 'Mark says the keys were returned to the office on 27 February, before the inspection',
  source: 'Keys returned to the office on 6 March, after the inspection was booked',
};

export function uiGallery(): GalleryEntry[] {
  return [
    button('primary', 'Run it live'),
    button('secondary', 'Skip to the result'),
    button('text', 'Next pair'),
    {
      id: 'chip',
      title: 'Chip',
      states: (['plain', 'accent', 'ok', 'wait', 'danger'] as const).map((tone) =>
        st(tone, () => new Chip({ label: tone === 'ok' ? 'Kept' : tone === 'wait' ? 'Waiting' : tone === 'danger' ? 'Dropped' : tone === 'accent' ? 'Selected' : 'Your test', eye: 0.55, tone })),
      ),
    },
    {
      id: 'toggle',
      title: 'Toggle',
      states: [
        st('off', () => new Toggle({ label: 'Large text', on: false, eye: 0.55, width: 260, onChange: noop })),
        st('on', () => new Toggle({ label: 'Large text', on: true, eye: 0.55, width: 260, onChange: noop })),
        st('hover', () => new Toggle({ label: 'Large text', on: false, eye: 0.55, width: 260, look: 'hover', onChange: noop })),
        st('focus', () => new Toggle({ label: 'Large text', on: true, eye: 0.55, width: 260, look: 'focus', onChange: noop })),
      ],
    },
    {
      id: 'counter',
      title: 'Counter: catches up at 20 a second, tabular figures',
      states: [
        st('rolling to 62 (time slider)', () => {
          const c = new Counter({ value: 62, unit: 'checked', eye: 1.3, shown: 0 });
          (c as unknown as { at: (s: number) => void }).at = (s: number) => c.at(s, 0);
          return c;
        }),
        st('settled', () => new Counter({ value: 124, unit: 'of 124 claims', eye: 1.3 })),
      ],
    },
    {
      id: 'board',
      title: 'Station board, full form',
      states: [
        st('future', () => new StationBoard({ form: 'full', state: 'future', title: 'Reconcile', rows: ['Pairs of facts are compared', 'after the check'] })),
        st('active', () => new StationBoard(gate({}))),
        st('waiting', () => new StationBoard({ form: 'full', state: 'waiting', title: 'Extract', sub: 'Pages 31–36', count: 7, unit: 'of 11 batches', rows: ['Waiting for the model.', 'Retrying in 8 s.'], progress: 0.64 })),
        st('question', () => new StationBoard({ form: 'full', state: 'active', title: 'Reconcile', count: 13, unit: 'of 14 pairs', rows: ['6 don\'t match', '7 explained'], note: '1 question for you', progress: 0.93 })),
        st('error', () => new StationBoard({ form: 'full', state: 'error', title: 'Extract', rows: ["Pages 31–36 couldn't be read"], action: { label: 'Try again', onSelect: noop } })),
        st('done', () => new StationBoard(gate({ state: 'done', count: 124, unit: 'of 124 claims', rows: ['124 claims', '112 match the page', '2 corrected by code'], progress: 1 }))),
        st('plan', () =>
          new StationBoard({ form: 'plan', state: 'done', title: 'Plan', rows: ['12 documents', '64 pages', '11 batches of 6', '6 people', '7 topics', 'up to 21 model calls'] }),
        ),
        st('long text', () => new StationBoard(gate({ state: 'done', count: 124, unit: 'of 124 claims', rows: ['1 planted mistake got through', 'Treat this run with care', 'Planted 9, caught 8'], progress: 1 }))),
      ],
    },
    {
      id: 'board-chip',
      title: 'Station board, chip form (one weight)',
      states: [
        st('future', () => new StationBoard({ form: 'chip', state: 'future', title: 'Assemble' })),
        st('active', () => new StationBoard({ form: 'chip', state: 'active', title: 'Extract', count: 7 })),
        st('waiting', () => new StationBoard({ form: 'chip', state: 'waiting', title: 'Extract', count: 7 })),
        st('done', () => new StationBoard({ form: 'chip', state: 'done', title: 'Read', count: 64 })),
      ],
    },
    {
      id: 'rail',
      title: 'Caption rail',
      states: [
        st('two lines', () =>
          new CaptionRail({
            lines: [
              { source: 'Run', text: 'Recorded answers from a live run on 16 Nov. Every check runs now, on this device.', key: true },
              { source: 'Check', text: 'Quote not found on page 23' },
            ],
          }),
        ),
        st('a line with its source', () => new CaptionRail({ lines: [{ source: 'Extractor', text: '3 more batches read' }] })),
        st('empty', () => new CaptionRail({ lines: [] })),
      ],
    },
    {
      id: 'run-card',
      title: 'Run card (lies flat on the slab)',
      states: [
        st('recorded', () => new RunCard({ lines: ['Recorded live, 16 Nov', 'Checked on this device'], skip: { label: 'Skip to the result' }, live: { label: 'Run it live', note: '3 live runs left today for everyone.' } })),
        st('scripted', () => new RunCard({ lines: ['Scripted sample run', 'Checked on this device'], skip: { label: 'Skip to the result' }, live: { label: 'Run it live', note: 'Available when this run ends.', disabled: '' } })),
        st('live', () => new RunCard({ lines: ['Live run, 7 of 30 calls', 'Checked on this device'], skip: { label: 'Skip to the result' }, live: { label: 'Run it live', note: 'Available when this run ends.' } })),
        st('paused', () => new RunCard({ lines: ['Recorded live, 16 Nov', 'Paused'], skip: { label: 'Skip to the result' }, live: { label: 'Run it live', note: "Today's live runs are used up." } })),
        st('model off', () => new RunCard({ lines: ['Recorded live, 16 Nov', 'Checked on this device'], skip: { label: 'Skip to the result' }, live: { label: 'Run it live', note: 'Live model runs are off in this copy.' } })),
      ],
    },
    {
      id: 'call-card',
      title: 'Call card',
      states: [
        st('waiting', () => new CallCard({ role: 'Extractor', pages: [13, 18], sent: 9840, waited: 4.2, start: '[p. 13] From: Dana Whitlock, Pierline Property Management' })),
        st('answered', () => new CallCard({ role: 'Extractor', pages: [13, 18], sent: 9840, waited: 6.8, back: { items: 11, seconds: 6.8 }, start: '[p. 13] From: Dana Whitlock, Pierline Property Management' })),
      ],
    },
    {
      id: 'ask-card',
      title: 'Question card',
      states: [
        st('just landed', () =>
          new AskCard({
            question: 'Mark says he returned "the keys" on 27 February. The check-out report logs a "mailbox key" handed in on 9 March. Are these the same keys?',
            options: [{ label: 'Same keys', target: 'ask:same' }, { label: 'Different keys', target: 'ask:different' }],
            left: 1,
          }),
        ),
        st('half the time left', () =>
          new AskCard({
            question: 'Mark says he returned "the keys" on 27 February. The check-out report logs a "mailbox key" handed in on 9 March. Are these the same keys?',
            options: [{ label: 'Same keys' }, { label: 'Different keys' }],
            left: 0.5,
          }),
        ),
      ],
    },
    {
      id: 'confirm-card',
      title: 'Confirm card',
      states: [st('scope', () => new ConfirmCard({ question: 'Change it for all 8 essays with this mistake? 9 points come back.', yes: { label: 'Change for all 8' }, no: { label: 'Only this essay' } }))],
    },
    {
      id: 'slip-sheet',
      title: 'Opened rejection slip',
      states: [
        st('quote altered', () => new SlipSheet({ ...SLIP, marks: { claim: [8, 9, 11], source: [5, 6, 8] }, page: 23, reason: 'A date in the quote was changed: the page says 6 March' })),
        st('not found', () => new SlipSheet({ claim: 'Lena told Mark the deposit would come back in full by Friday', source: 'The deposit is held until the final inspection report is signed', marks: { claim: [], source: [] }, page: 23, reason: 'Quote not found on page 23' })),
        st('second look', () => new SlipSheet({ ...SLIP, marks: { claim: [8, 9], source: [5, 6] }, page: 23, reason: 'Date 14 March doesn\'t match the quote (4 March)', outcome: 'Fixed on a second look' })),
        st('dropped', () => new SlipSheet({ ...SLIP, marks: { claim: [9], source: [6] }, page: 23, reason: '4 March 2026 was a Wednesday, the quote says Friday', outcome: 'Dropped' })),
        st('long text', () => new SlipSheet({ ...SLIP, claim: `${SLIP.claim} and the mailbox key was left with the building manager that same evening`, marks: { claim: [18, 19], source: [5, 6] }, page: 40, reason: 'Quote is on page 41, not 40. Page corrected by the check.' })),
      ],
    },
    {
      id: 'run-slip',
      title: 'Work sheet at the hand',
      states: [
        st('closed', () =>
          new RunSlip({
            rows: [
              { key: 'pages', text: '64 pages' },
              { key: 'calls', text: '18 model calls' },
              { key: 'time', text: 'model time 1 min 42 s', sub: 'calls ran in parallel' },
              { key: 'checks', text: 'checks 0.3 s' },
              { key: 'claims', text: '124 claims' },
              { key: 'events', text: '119 events kept' },
              { key: 'planted', text: 'Planted 9, caught 9' },
              { key: 'sent', text: '6 sent back', sub: '3 fixed, 3 dropped', items: ['p. 12 Quote not found', 'p. 23 Wrong date', 'p. 31 Unknown person'] },
              { key: 'fool', text: 'Try to fool the check' },
            ],
          }),
        ),
        st('a line open', () =>
          new RunSlip({
            open: 'sent',
            rows: [
              { key: 'claims', text: '124 claims' },
              { key: 'match', text: '112 match the page' },
              { key: 'sent', text: '6 sent back', sub: '3 fixed, 3 dropped', items: ['p. 12 Quote not found', 'p. 23 Wrong date', 'p. 31 Unknown person'] },
              { key: 'dated', text: '3 dated passages not used', items: ['p. 7', 'p. 19', 'p. 44'] },
            ],
          }),
        ),
      ],
    },
    {
      id: 'source',
      title: 'Source page',
      states: [
        st('letter with the quote', () =>
          new SourceSheet({
            kind: 'email',
            title: 'Email, Pierline Property Management',
            page: 1,
            pages: 2,
            n: 23,
            blocks: [
              { k: 'head', text: 'From: Dana Whitlock' },
              { k: 'head', text: 'To: Mark Ellison' },
              { k: 'head', text: 'Date: 9 March 2026' },
              { k: 'head', text: 'Subject: Check-out of Unit 4B' },
              { k: 'p', text: 'Thank you for meeting me at the flat. As noted on the report, the mailbox key was handed in on 9 March, after the inspection was booked.' },
              { k: 'p', text: 'The deposit is held until the final inspection report is signed by both parties.' },
            ],
            spans: [{ blockIndex: 4, start: 63, end: 128 }],
          }),
        ),
        st('messages', () =>
          new SourceSheet({
            kind: 'messages',
            title: 'Messages, Mark and Lena',
            page: 2,
            pages: 2,
            n: 31,
            self: 'Mark',
            blocks: [
              { k: 'msg', who: 'Lena', at: '4 March 2026, 18:12', text: 'Did you drop the keys at the office?' },
              { k: 'msg', who: 'Mark', at: '4 March 2026, 18:20', text: 'Not yet, Friday after work.' },
              { k: 'msg', who: 'Lena', at: '6 March 2026, 09:02', text: 'They say nothing came in.' },
            ],
            spans: [{ blockIndex: 1, start: 0, end: 7 }],
          }),
        ),
      ],
    },
    {
      id: 'pair',
      title: 'Pair strip',
      states: [
        st('direct conflict', () => new PairStrip({ line: 'Same fact, two values: 27 Feb and 6 Mar. Direct conflict.', keep: { label: 'Keep as conflict' }, dismiss: { label: 'Not a conflict' }, next: { label: 'Next pair' } })),
        st('resolved later', () =>
          new PairStrip({ line: 'You kept this as a conflict. Page 65 now resolves it.', keep: { label: 'Still a conflict' }, dismiss: { label: 'Not a conflict' }, next: { label: 'Next pair' }, note: 'Resolved by page 65' }),
        ),
      ],
    },
    {
      id: 'reading',
      title: 'Reading line',
      states: [
        st('event', () => new ReadingLine({ lead: '27 Feb', text: 'Mark, keys returned to the office. Text messages, p. 31' })),
        st('view title', () => new ReadingLine({ text: '119 events from 64 pages. 6 places where the stories don\'t match' })),
      ],
    },
    {
      id: 'code',
      title: 'Code card and code pad',
      states: [
        st('export code', () => new CodeCard({ code: 'X4KM7', address: 'On your phone open groundwork.example/go and type X4KM7' })),
        st('files code', () => new CodeCard({ code: 'F7QH2', address: 'groundwork.example/go', note: 'Works when both devices are on the same Wi-Fi.' })),
        st('pad, three typed', () => new CodePad({ typed: 'X4K' })),
        st('pad, wrong code', () => new CodePad({ typed: 'X4KM8', error: 'No work has this code. Check the five letters and try again.' })),
      ],
    },
    {
      id: 'note',
      title: 'Note at the hand',
      states: [
        st('pages arrived', () => new NoteSheet({ title: 'While you were away: 2 notes', lines: ['2 new pages were read. 3 new events.', '1 contradiction resolved, 1 new.'], actions: [{ label: 'Show the changes' }, { label: 'Later' }] })),
        st('deadline', () => new NoteSheet({ title: 'Review due in 2 days.', lines: ['4 contradictions are still open.'], actions: [{ label: 'Open the timeline' }] })),
      ],
    },
    {
      id: 'seating',
      title: 'Table card and wish strips',
      states: [
        st('table', () =>
          new TableCard({
            label: 'Table 6',
            seats: 8,
            guests: [
              { id: 'g1', name: 'Edith Lindqvist', side: 'ochre' },
              { id: 'g2', name: 'Hal Lindqvist', side: 'ochre' },
              { id: 'g3', name: 'Imani Okafor', side: 'sage' },
              { id: 'g4', name: 'Peter Novak', side: 'steel' },
              { id: 'g5', name: 'Mila Novak', side: 'steel', child: true },
            ],
          }),
        ),
        st('met', () => new WishStrip({ text: 'Keep the Novaks together near the stage', source: 'From your letter', state: 'met' })),
        st('partly', () => new WishStrip({ text: 'University friends together', source: 'From your letter', state: 'partly', reason: 'University friends together, but Imani asked not to sit with Carys' })),
        st("can't be met", () => new WishStrip({ text: "Nadia's side in front of the stage", source: 'Guest note 17', state: 'impossible', reason: "30 guests from Nadia's side, the two tables in front of the stage seat 16" })),
        st('needs you', () => new WishStrip({ text: 'Aunt Rosa away from the speakers', source: 'Guest note 42', state: 'needs-you', reason: '"Aunt Rosa" fits 2 guests' })),
      ],
    },
    {
      id: 'settings',
      title: 'Settings panel',
      states: [
        st('defaults', () => new SettingsPanel({ settings: { ...defaultSettings(), lessMotion: false } })),
        st('dwell on, slowest', () => new SettingsPanel({ settings: { ...defaultSettings(), dwell: true, dwellMs: 1200, largeText: true } })),
      ],
    },
    {
      id: 'essays',
      title: 'Essays: sheet, criteria, rules, class errors',
      states: [
        st('marked passages', () =>
          new EssaySheet({
            title: 'Student 07',
            mode: 'marked',
            sentences: [
              { id: 'e07.s1', text: 'School uniforms are a topic that many people have strong views about.' },
              { id: 'e07.s2', text: 'Some studies show that uniforms help students focus.', mark: { label: 'Vague evidence', severity: 'major' } },
              { id: 'e07.s3', text: 'This is why every school should have them.' },
              { id: 'e07.s4', text: 'My cousin goes to a school without uniforms.' },
              { id: 'e07.s5', text: 'Everyone knows uniforms save money.', mark: { label: 'Unsupported claim', severity: 'minor' } },
              { id: 'e07.s6', text: 'In conclusion, uniforms are good.' },
            ],
          }),
        ),
        st('criteria', () =>
          new CriterionBars({
            rows: [
              { name: 'Argument', score: 4, max: 6, fixedByCode: true },
              { name: 'Evidence', score: 3, max: 6 },
              { name: 'Structure', score: 5, max: 6 },
              { name: 'Language', score: 6, max: 6 },
            ],
          }),
        ),
        st('rules', () => new RulesList({ rules: [{ id: 'r1', text: 'Vague evidence costs 2, not 1, 9 essays, from your marking' }, { id: 'r2', text: 'Unsupported claim costs 1, not 2, 8 essays, by you' }] })),
        st('no rules', () => new RulesList({ rules: [] })),
        st('class errors', () =>
          new ClassErrors({
            total: 24,
            errors: [
              { type: 'evidence-vague', label: 'Vague evidence', essays: 14 },
              { type: 'claim-unsupported', label: 'Unsupported claim', essays: 9 },
              { type: 'structure-paragraph', label: 'No paragraph plan', essays: 7 },
              { type: 'language-run-on', label: 'Run-on sentence', essays: 5 },
            ],
          }),
        ),
      ],
    },
  ];
}

/** Sizes the gallery may want to read (eye distances of the panels). */
export const GALLERY_SIZES = SIZE;
