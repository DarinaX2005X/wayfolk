/**
 * /app: the place the person is about to sit in, before they enter (DESIGN "Браузер").
 *
 * The first paint is the view from the seat: `public/first-frame.webp` (a frame of the
 * real home scene) over the sky gradient of the tokens, so the screen is never empty.
 * The world boots in the background at once. "Enter Groundwork" works from the first
 * second: if the world is still loading, a ring runs along the button's edge and the
 * entry happens when the world is ready. The live world then fades in over the frame in
 * 400 ms from the same camera, so nothing jumps.
 *
 *   headset browser   Enter asks for the immersive session (Void first)
 *   no WebXR          the scene works with the mouse from the seat; the plate slides down
 *                     into the caption strip, with a slot for "Type a command" (02.4)
 *   session refused   the same, with the reason under the button
 *
 * Test parameters (`run`, `answers`, `pace`, `capture`, src/app/params.ts) skip the plate
 * and show the live world at once.
 */
import { effect } from '@preact/signals-core';
import { debugEnabled } from '../../app/debug';
import { parseAppParams } from '../../app/params';
import { store } from '../../app/store';
import type { RouteParams } from '../router';
import './app.css';

type BootModule = typeof import('../../app/boot/world');
type App = Awaited<ReturnType<BootModule['bootApp']>>;

export const TEXT = {
  enter: 'Enter Groundwork',
  questHint: 'Open this link in Quest Browser to use your hands',
  noVr: "This browser can't open VR. You can still try Groundwork here with a mouse.",
  againGesture: 'The world is ready. Press Enter Groundwork again to put the headset on.',
  noWebgl: "This browser can't draw 3D scenes, so Groundwork can't open here. Try a recent Chrome, Edge or Quest Browser.",
  bootFailed: "The world didn't load on this device.",
  reload: 'Load it again',
  mic: 'Allow microphone for voice',
  micReady: 'Microphone ready',
  micBlocked: 'The microphone is blocked for this site. You can still use the command buttons.',
  micMissing: 'No microphone was found. You can still use the command buttons.',
} as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Does this browser offer an immersive session at all? Never throws. */
async function xrOffered(): Promise<boolean> {
  try {
    if (!navigator.xr) return false;
    const [ar, vr] = await Promise.all([
      navigator.xr.isSessionSupported('immersive-ar').catch(() => false),
      navigator.xr.isSessionSupported('immersive-vr').catch(() => false),
    ]);
    return ar || vr;
  } catch {
    return false;
  }
}

/** The microphone button: asks once, stops the stream at once, remembers nothing itself. */
function microphone(button: HTMLButtonElement, note: HTMLElement): void {
  const ready = (): void => {
    button.textContent = TEXT.micReady;
    button.disabled = true;
    button.dataset.state = 'ready';
    note.hidden = true;
  };
  const problem = (text: string): void => {
    note.textContent = text;
    note.hidden = false;
  };
  void (async () => {
    try {
      const status = await navigator.permissions?.query({ name: 'microphone' as PermissionName });
      if (status?.state === 'granted') ready();
      if (status?.state === 'denied') problem(TEXT.micBlocked);
    } catch {
      // Some browsers cannot be asked about the microphone; the button still works.
    }
  })();
  button.addEventListener('click', async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      problem(TEXT.micMissing);
      return;
    }
    button.setAttribute('aria-busy', 'true');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // The microphone is never kept open: voice opens it again for each command.
      for (const track of stream.getTracks()) track.stop();
      ready();
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      problem(name === 'NotFoundError' || name === 'OverconstrainedError' ? TEXT.micMissing : TEXT.micBlocked);
    } finally {
      button.removeAttribute('aria-busy');
    }
  });
}

export async function mount(root: HTMLElement, params: RouteParams): Promise<void> {
  const test = parseAppParams(location.search, debugEnabled());
  void params;
  const q = new URLSearchParams(location.search);
  const direct = test.run !== null || test.capture || (debugEnabled() && (q.get('testscene') === '1' || q.get('desk') === '1'));

  // ---- the frame from the seat, painted first

  const page = el('main', 'app-page');
  page.dataset.state = 'before';
  const frame = el('div', 'app-frame');
  frame.setAttribute('aria-hidden', 'true');
  const shot = new Image();
  shot.alt = '';
  shot.decoding = 'async';
  shot.className = 'app-frame-shot';
  shot.addEventListener('load', () => frame.classList.add('has-shot'));
  shot.src = `${import.meta.env.BASE_URL}first-frame.webp`;
  frame.append(el('div', 'app-frame-bench'), shot);

  const stage = el('div', 'stage app-stage');

  const plate = el('section', 'app-plate');
  plate.setAttribute('aria-labelledby', 'app-title');
  const logo = el('img', 'app-logo');
  logo.src = `${import.meta.env.BASE_URL}logo.svg`;
  logo.alt = 'Groundwork';
  logo.width = 220;
  logo.height = 56;
  const title = el('h1', 'visually-hidden', 'Groundwork');
  title.id = 'app-title';
  const enter = el('button', 'button button-primary app-enter', TEXT.enter);
  enter.type = 'button';
  const line = el('p', 'app-line');
  line.setAttribute('role', 'status');
  line.setAttribute('aria-live', 'polite');
  plate.append(logo, title, enter, line);

  const side = el('section', 'app-side');
  side.setAttribute('aria-label', 'Before you enter');
  const mic = el('button', 'button button-secondary app-mic', TEXT.mic);
  mic.type = 'button';
  const micNote = el('p', 'app-side-note');
  micNote.hidden = true;
  const access = el('div', 'app-access');
  access.id = 'access-slot';
  side.append(mic, micNote, access);

  const strip = el('section', 'app-strip');
  strip.setAttribute('aria-label', 'Captions');
  const captions = el('div', 'app-captions');
  captions.setAttribute('aria-live', 'polite');
  // The reason from the plate stays readable after the plate has gone down.
  const stripNote = el('p', 'app-strip-note');
  stripNote.hidden = true;
  const command = el('div', 'app-command');
  command.id = 'command-slot';
  strip.append(stripNote, captions, command);

  page.append(frame, stage, plate, side, strip);
  root.replaceChildren(page);
  microphone(mic, micNote);

  // ---- the world boots in the background from the first frame

  let app: App | null = null;
  const booting: Promise<App | null> = import('../../app/boot/world')
    .then((mod) => mod.bootApp(stage))
    .then((booted) => (app = booted))
    .catch((error: unknown) => {
      const code = (error as { code?: string } | null)?.code;
      console.error('[gw] the world did not start', error);
      enter.classList.remove('is-loading');
      if (code === 'webgl-unavailable') {
        enter.disabled = true;
        line.textContent = TEXT.noWebgl;
      } else {
        enter.textContent = TEXT.reload;
        enter.onclick = () => location.reload();
        line.textContent = TEXT.bootFailed;
      }
      page.dataset.state = 'failed';
      return null;
    });

  /** The live world fades in over the frame, from the same seat. */
  const reveal = (inSession: boolean): void => {
    page.dataset.state = inSession ? 'session' : 'desk';
    stripNote.textContent = line.textContent === TEXT.questHint ? '' : (line.textContent ?? '');
    stripNote.hidden = inSession || !stripNote.textContent;
  };

  // Captions of the run in the strip (written only by src/feel/captions.ts).
  effect(() => {
    const lines = store.captions.value.slice(-2);
    captions.replaceChildren(
      ...lines.map((c) => {
        const line = el('p', c.key ? 'app-caption is-key' : 'app-caption');
        line.append(el('strong', 'app-caption-source', c.source), document.createTextNode(`: ${c.text}`));
        return line;
      }),
    );
  });
  // Whoever starts the session (this page, the headset browser, the emulator), the page follows it.
  effect(() => {
    const mode = store.mode.value;
    if (mode !== 'desk') reveal(true);
    else if (page.dataset.state === 'session') reveal(false);
  });

  void xrOffered().then((offered) => {
    enter.dataset.xr = offered ? 'yes' : 'no';
    if (!offered && !line.textContent && page.dataset.state === 'before') line.textContent = TEXT.questHint;
  });

  let pending = false;
  const go = async (): Promise<void> => {
    if (pending || page.dataset.state === 'failed') return;
    pending = true;
    const clickedAt = performance.now();
    if (!app) {
      enter.classList.add('is-loading');
      enter.setAttribute('aria-busy', 'true');
    }
    const ready = await booting;
    enter.classList.remove('is-loading');
    enter.removeAttribute('aria-busy');
    pending = false;
    if (!ready) return;
    if (enter.dataset.xr !== 'yes') {
      reveal(false);
      return;
    }
    try {
      await ready.session.enter('void');
      reveal(true);
    } catch {
      // Refused, or the browser no longer counts the click as a gesture after a long load.
      const stale = performance.now() - clickedAt > 4000;
      line.textContent = stale ? TEXT.againGesture : TEXT.noVr;
      if (!stale) reveal(false);
    }
  };
  enter.addEventListener('click', () => void go());

  if (direct) {
    void booting.then((ready) => ready && reveal(false));
  }
}
