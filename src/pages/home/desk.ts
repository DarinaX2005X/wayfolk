/**
 * The page's part of the browser mode (no headset): what a newcomer needs to talk and
 * to move, and never more than one thing to do at a time.
 *
 *   - replies: paper bubbles beside whoever speaks (store.points.speaker), a paper field
 *     to type your own answer, and a mic button (or hold Space) with a listening state;
 *     what you said is shown back above the bubbles;
 *   - the next action: one paper tag with a hand-drawn arrow at the thing to click
 *     (store.cue, store.points.cue), at the page edge when it is out of view;
 *   - keys: one short line at a time in the corner (drag, W A S D, the stick), gone once
 *     used, back from a small "?" tag;
 *   - a phone gets a small stick for walking.
 *
 * Nothing here shows in a headset: the page is hidden behind the immersive session, and
 * every element waits for `store.mode` 'desk'.
 */
import { effect } from '@preact/signals-core';
import type { Store } from '../../app/store';
import './desk.css';

type Hooks = {
  pick(index: number): void;
  answer(text: string): void;
  micStart(): void;
  micStop(): void;
  walk(forward: number, right: number): void;
};

export const DESK_TEXT = {
  say: 'Say something…',
  send: 'Say it',
  hold: 'Hold to talk',
  listening: 'Listening… let go to send',
  you: 'You',
  thinking: 'is thinking',
  help: 'How to play',
  close: 'Got it',
  lines: {
    drag: 'Drag to look around',
    walk: 'to walk',
    stick: 'Use the stick to walk',
    click: 'Click Pip or a neighbour to talk',
    tap: 'Tap Pip or a neighbour to talk',
    flags: 'Click a flag to go there',
    space: 'Hold Space to talk',
    hurry: 'Click anywhere to hurry',
  },
} as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const keycaps = (keys: string[]): HTMLElement => {
  const span = el('span', 'kbd-row');
  for (const k of keys) span.append(el('kbd', 'kbd', k));
  return span;
};

/** A curved arrow drawn by hand, pointing to the right; rotated by the page. */
const ARROW = `<svg viewBox="0 0 120 60" aria-hidden="true"><path d="M3 15 C 34 -4, 78 -6, 112 14" fill="none" stroke="#5a2a17" stroke-width="5" stroke-linecap="round"/><path d="M97 4 L114 15 L98 27" fill="none" stroke="#5a2a17" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

export function createDeskUi(store: Store, hooks: Hooks): HTMLElement[] {
  const touch = matchMedia('(pointer: coarse)').matches;
  const canSpeak = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  // ---- replies beside the speaker
  const talk = el('section', 'desk-talk');
  talk.setAttribute('aria-label', 'Your reply');
  talk.hidden = true;
  const heard = el('p', 'desk-heard');
  const thinking = el('p', 'desk-thinking');
  thinking.setAttribute('aria-live', 'polite');
  const choices = el('div', 'desk-choices');
  const form = el('form', 'desk-say');
  const input = el('input', 'desk-input');
  input.type = 'text';
  input.placeholder = DESK_TEXT.say;
  input.maxLength = 200;
  input.setAttribute('aria-label', 'Type your own answer');
  input.autocomplete = 'off';
  const send = el('button', 'desk-send', DESK_TEXT.send);
  send.type = 'submit';
  form.append(input, send);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    input.value = '';
    input.blur();
    hooks.answer(text);
  });
  const mic = el('button', 'desk-mic');
  mic.type = 'button';
  mic.hidden = !canSpeak;
  const micLabel = el('span', '', DESK_TEXT.hold);
  const micDot = el('span', 'desk-mic-dot');
  mic.append(micDot, micLabel);
  if (!touch) mic.append(keycaps(['Space']));
  const on = (e: Event): void => {
    e.preventDefault();
    mic.setPointerCapture?.((e as PointerEvent).pointerId);
    hooks.micStart();
  };
  mic.addEventListener('pointerdown', on);
  mic.addEventListener('pointerup', () => hooks.micStop());
  mic.addEventListener('pointercancel', () => hooks.micStop());
  const row = el('div', 'desk-row');
  row.append(form, mic);
  talk.append(heard, thinking, choices, row);

  let lastChoices: string[] = [];
  effect(() => {
    const list = store.choices.value;
    if (list.join('|') === lastChoices.join('|')) return;
    lastChoices = list;
    choices.replaceChildren(
      ...list.map((text, i) => {
        const b = el('button', 'desk-choice', text);
        b.type = 'button';
        b.style.setProperty('--i', String(i));
        b.addEventListener('click', () => hooks.pick(i));
        return b;
      }),
    );
  });
  effect(() => {
    const listening = store.listening.value;
    mic.dataset.on = listening ? 'yes' : 'no';
    micLabel.textContent = listening ? DESK_TEXT.listening : DESK_TEXT.hold;
  });
  effect(() => {
    const said = store.heard.value;
    heard.hidden = !said;
    heard.replaceChildren(el('strong', '', DESK_TEXT.you), document.createTextNode(` ${said ?? ''}`));
  });
  effect(() => {
    const desk = store.mode.value === 'desk';
    const talking = store.talkingTo.value !== null;
    const offered = store.choices.value.length > 0;
    talk.hidden = !desk || (!offered && !talking);
    row.hidden = !talking || !offered;
    const speaker = store.speaker.value;
    thinking.hidden = !(talking && !offered && store.heard.value);
    thinking.textContent = '';
    if (!thinking.hidden) {
      const dots = el('span', 'desk-dots', '• • •');
      thinking.append(dots);
      void speaker;
    }
  });

  // ---- the one next action
  const cue = el('div', 'desk-cue');
  cue.hidden = true;
  cue.setAttribute('role', 'status');
  const cueText = el('p', 'desk-cue-text');
  const cueArrow = el('span', 'desk-cue-arrow');
  cueArrow.innerHTML = ARROW;
  cue.append(cueText, cueArrow);
  effect(() => {
    const text = store.cue.value;
    cueText.textContent = text ? (touch ? text.replace(/^Click/, 'Tap') : text) : '';
    cue.hidden = !text || store.mode.value !== 'desk' || (store.choices.value.length > 0 && store.phase.value === 'free');
  });

  // ---- one line of keys at a time
  const hint = el('aside', 'desk-hint');
  hint.setAttribute('aria-label', 'How to play here');
  hint.hidden = true;
  const help = el('button', 'desk-help', '?');
  help.type = 'button';
  help.setAttribute('aria-label', DESK_TEXT.help);
  help.hidden = true;
  const all = el('div', 'desk-all');
  all.hidden = true;
  all.setAttribute('role', 'dialog');
  all.setAttribute('aria-label', DESK_TEXT.help);
  const lineEls = (): HTMLElement[] => {
    const out: HTMLElement[] = [];
    const drag = el('p', 'desk-line');
    drag.append(el('span', 'desk-glyph desk-glyph-drag'), document.createTextNode(DESK_TEXT.lines.drag));
    out.push(drag);
    const walk = el('p', 'desk-line');
    if (touch) walk.append(el('span', 'desk-glyph desk-glyph-stick'), document.createTextNode(DESK_TEXT.lines.stick));
    else walk.append(keycaps(['W', 'A', 'S', 'D']), document.createTextNode(` ${DESK_TEXT.lines.walk}`));
    out.push(walk);
    out.push(el('p', 'desk-line', touch ? DESK_TEXT.lines.tap : DESK_TEXT.lines.click));
    out.push(el('p', 'desk-line', touch ? DESK_TEXT.lines.flags.replace('Click', 'Tap') : DESK_TEXT.lines.flags));
    if (canSpeak && !touch) {
      const sp = el('p', 'desk-line');
      sp.append(keycaps(['Space']), document.createTextNode(' hold to talk'));
      out.push(sp);
    }
    return out;
  };
  const closeAll = el('button', 'desk-close', DESK_TEXT.close);
  closeAll.type = 'button';
  all.append(...lineEls(), closeAll);
  closeAll.addEventListener('click', () => {
    all.hidden = true;
    help.focus();
  });
  help.addEventListener('click', () => {
    all.hidden = !all.hidden;
  });
  const [dragLine, walkLine] = lineEls();
  const hurryLine = el('p', 'desk-line');
  hurryLine.append(el('span', 'desk-glyph desk-glyph-tap'), document.createTextNode(touch ? DESK_TEXT.lines.hurry.replace('Click', 'Tap') : DESK_TEXT.lines.hurry));
  let shown: HTMLElement | null = null;
  effect(() => {
    // Only once inside: the landing has its own tags.
    const desk = store.mode.value === 'desk' && store.phase.value !== 'boot';
    const looked = store.deskUsed.value;
    const walked = store.walked.value;
    const phase = store.phase.value;
    const free = phase === 'free';
    // In a long moment (a traveler on the way, a house going up) a click hurries it.
    const long = (phase === 'arrive' || phase === 'build') && !store.hurried.value;
    // Look first; walking matters once the island is free to wander.
    const next = !desk ? null : long ? hurryLine : !looked ? dragLine : !walked && free ? walkLine : null;
    if (next !== shown) {
      shown = next;
      hint.replaceChildren(...(next ? [next] : []));
    }
    hint.hidden = !next;
    help.hidden = !desk || !!next;
  });

  // ---- the stick on a phone
  const stick = el('div', 'desk-stick');
  stick.hidden = true;
  stick.setAttribute('aria-label', 'Walk');
  const knob = el('div', 'desk-knob');
  stick.append(knob);
  let stickId: number | null = null;
  const stickMove = (e: PointerEvent): void => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (e.clientX - cx) / (r.width / 2);
    let dy = (e.clientY - cy) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    knob.style.translate = `${dx * r.width * 0.32}px ${dy * r.height * 0.32}px`;
    hooks.walk(-dy, dx);
  };
  stick.addEventListener('pointerdown', (e) => {
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    stickMove(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) stickMove(e);
  });
  const stickUp = (e: PointerEvent): void => {
    if (e.pointerId !== stickId) return;
    stickId = null;
    knob.style.translate = '0 0';
    hooks.walk(0, 0);
  };
  stick.addEventListener('pointerup', stickUp);
  stick.addEventListener('pointercancel', stickUp);
  effect(() => {
    stick.hidden = !(touch && store.mode.value === 'desk' && store.phase.value === 'free');
  });

  // ---- placing things where the world says, every frame
  const pos = { x: -1, y: -1 };
  const rest = { x: -1, y: -1 };
  const frame = (): void => {
    requestAnimationFrame(frame);
    if (store.mode.peek() !== 'desk') return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!talk.hidden) {
      const sp = store.points.speaker;
      const box = talk.getBoundingClientRect();
      const narrow = W < 640;
      let x: number;
      let y: number;
      if (narrow || !sp.on) {
        // Under the speaker on a phone, or low in the middle when they are out of view.
        x = (W - box.width) / 2;
        y = sp.on && narrow ? Math.min(H - box.height - 16, sp.y + Math.max(40, sp.size * 0.55)) : H - box.height - 90;
      } else {
        const gap = Math.max(36, sp.size * 0.32);
        x = sp.x + gap;
        if (x + box.width > W - 16) x = sp.x - gap - box.width;
        y = sp.y - box.height * 0.35;
      }
      x = Math.max(12, Math.min(W - box.width - 12, x));
      y = Math.max(12, Math.min(H - box.height - 84, y));
      // The replies stay put while the speaker sways or bobs; they follow only a real move,
      // so a bubble never slides away from the pointer.
      if (pos.x < 0) {
        pos.x = x;
        pos.y = y;
        rest.x = x;
        rest.y = y;
      } else if (Math.hypot(x - rest.x, y - rest.y) > 70) {
        rest.x = x;
        rest.y = y;
      }
      pos.x += (rest.x - pos.x) * 0.2;
      pos.y += (rest.y - pos.y) * 0.2;
      if (Math.abs(rest.x - pos.x) < 0.5) pos.x = rest.x;
      if (Math.abs(rest.y - pos.y) < 0.5) pos.y = rest.y;
      talk.style.translate = `${Math.round(pos.x)}px ${Math.round(pos.y)}px`;
      talk.dataset.side = sp.on && !narrow && pos.x < sp.x ? 'left' : 'right';
    } else pos.x = -1;
    if (!cue.hidden) {
      const cp = store.points.cue;
      const box = cueText.getBoundingClientRect();
      const bw = box.width;
      const bh = box.height;
      let x: number;
      let y: number;
      let sx: number;
      let sy: number;
      let tx = cp.x;
      let ty = cp.y;
      if (cp.on) {
        // The tag sits up and to one side of the target; the arrow runs from its corner.
        const left = cp.x - bw - 70 > 12;
        const above = cp.y - bh - 60 > 12;
        x = left ? cp.x - bw - 70 : cp.x + 70;
        y = above ? cp.y - bh - 60 : cp.y + 60;
        x = Math.max(12, Math.min(W - bw - 12, x));
        y = Math.max(12, Math.min(H - bh - 90, y));
        sx = left ? x + bw - 10 : x + 10;
        sy = above ? y + bh : y;
        cue.dataset.edge = 'no';
      } else {
        x = Math.max(12, Math.min(W - bw - 12, cp.x - bw / 2));
        y = Math.max(12, Math.min(H - bh - 90, cp.y - bh / 2));
        sx = x + bw / 2;
        sy = y + bh / 2;
        // Out of view: the arrow points out of the page toward it.
        const a = Math.atan2(cp.y - H / 2, cp.x - W / 2);
        sx += Math.cos(a) * (bw / 2 + 4);
        sy += Math.sin(a) * (bh / 2 + 4);
        tx = sx + Math.cos(a) * 70;
        ty = sy + Math.sin(a) * 70;
        cue.dataset.edge = 'yes';
      }
      cueText.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
      const len = Math.max(30, Math.min(130, Math.hypot(tx - sx, ty - sy) - 14));
      cueArrow.style.translate = `${Math.round(sx)}px ${Math.round(sy - len * 0.25)}px`;
      cueArrow.style.width = `${Math.round(len)}px`;
      cueArrow.style.height = `${Math.round(len * 0.5)}px`;
      cueArrow.style.rotate = `${Math.atan2(ty - sy, tx - sx)}rad`;
    }
  };
  requestAnimationFrame(frame);

  return [talk, cue, hint, help, all, stick];
}
