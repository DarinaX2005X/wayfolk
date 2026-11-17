/**
 * / : the landing page with the island already alive behind it.
 *
 * One line says what this is; "Enter the island" opens the immersive session in a
 * headset browser (passthrough first, then the clouds), "Look around here" lets anyone
 * without a headset sit on the island with a mouse or a finger. The world boots in the
 * background from the first frame, so both buttons work at once.
 *
 * While inside at the desk, the page adds what a newcomer needs to talk and move
 * (./desk.ts), the captions for screen readers, and the postcard with its link and QR code.
 */
import { effect } from '@preact/signals-core';
import { qrSvg } from '../../kit/ui/qr';
import { store } from '../../app/store';
import type { RouteParams } from '../router';
import { createDeskUi } from './desk';
import { BALLOON, CLOUDS_LEFT, CLOUDS_RIGHT, LOADING_SKY, PIP_FLYING, WORDMARK } from './art';
import './home.css';

type Boot = typeof import('../../app/boot/world');
type WF = typeof import('../../app/wayfolk');

export const TEXT = {
  title: 'Wayfolk',
  line: 'A small island above the clouds. Travelers drift in, and some of them stay.',
  enter: 'Enter the island',
  look: 'Look around here',
  questHint: 'Open this page in Quest Browser to sit on the island with your hands.',
  loading: 'The island is waking up',
  noWebgl: "This browser can't draw 3D scenes. Try a recent Chrome, Edge, Safari or Quest Browser.",
  failed: "The island didn't load on this device.",
  reload: 'Load it again',
  postcard: 'A postcard from your island',
  copy: 'Copy link',
  copied: 'Copied',
  close: 'Close',
  invite: 'Invite a friend',
  snap: 'Take a postcard',
  vr: 'Enter in VR',
  inviteTitle: 'Come sit on my island',
  again: 'The island is ready. Press Enter again to put the headset on.',
} as const;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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

export async function mount(root: HTMLElement, params: RouteParams): Promise<void> {
  void params;
  const page = el('main', 'home');
  page.dataset.state = 'before';
  const sky = el('div', 'home-sky');
  sky.setAttribute('aria-hidden', 'true');
  // The loading moment: a sunset, two banks of clouds that part when the island is ready,
  // and Pip flying across. Nothing of the island is drawn until the real one can show.
  sky.innerHTML = `${LOADING_SKY}<div class="ls-left">${CLOUDS_LEFT}</div><div class="ls-right">${CLOUDS_RIGHT}</div><div class="ls-fly">${PIP_FLYING}</div>`;
  const stage = el('div', 'home-stage');

  // The title, as key art: the wordmark with Pip on it, one line under it.
  const hero = el('section', 'home-hero');
  hero.setAttribute('aria-labelledby', 'wm-t');
  const mark = el('h1', 'home-wordmark');
  mark.innerHTML = WORDMARK;
  const line = el('p', 'home-line', TEXT.line);
  hero.append(mark, line);

  // The way in: paper tags tied under a balloon that drifts over the island.
  const balloon = el('div', 'home-balloon');
  const art = el('div', 'home-balloon-art');
  art.innerHTML = BALLOON;
  const string = el('div', 'home-string');
  string.setAttribute('aria-hidden', 'true');
  const tags = el('div', 'home-tags');
  const enter = el('button', 'tag tag-enter', TEXT.enter);
  enter.type = 'button';
  const look = el('button', 'tag tag-look', TEXT.look);
  look.type = 'button';
  const status = el('p', 'tag-note', TEXT.loading);
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  tags.append(enter, look, status);
  balloon.append(art, string, tags);
  const plate = hero;

  // Inside, at the desk.
  const strip = el('section', 'home-strip');
  strip.setAttribute('aria-label', 'What is being said');
  const captions = el('div', 'home-captions');
  captions.setAttribute('aria-live', 'polite');
  // Once the first minute is over, Pip's little menu as tags at the desk.
  const menu = el('div', 'home-menu');
  const snap = el('button', 'tag tag-small', TEXT.snap);
  snap.type = 'button';
  snap.addEventListener('click', () => void wf?.postcard.take());
  const inviteTag = el('button', 'tag tag-small', TEXT.invite);
  inviteTag.type = 'button';
  inviteTag.addEventListener('click', () => void wf?.invite());
  // A headset in this browser: going in is one tag away.
  const vrTag = el('button', 'tag tag-small tag-vr', TEXT.vr);
  vrTag.type = 'button';
  vrTag.hidden = true;
  vrTag.addEventListener('click', () => void enterSession());
  menu.append(snap, inviteTag, vrTag);

  effect(() => {
    menu.hidden = store.phase.value !== 'free' || store.mode.value !== 'desk';
  });
  const prepared = el('p', 'home-prepared', 'prepared traveler');
  prepared.hidden = true;
  strip.append(captions, prepared, menu);
  let wf: Awaited<ReturnType<WF['startWayfolk']>> | null = null;
  const deskUi = createDeskUi(store, {
    pick: (i) => wf?.replies.pick(i),
    answer: (text) => wf?.replies.answer(text),
    micStart: () => void wf?.voice.start(),
    micStop: () => wf?.voice.stop(),
    walk: (f, r) => wf?.guide.setWalk(f, r),
  });
  effect(() => {
    prepared.hidden = !(store.prepared.value && store.choices.value.length > 0);
  });

  const card = el('aside', 'home-card');
  card.hidden = true;

  page.append(stage, sky, plate, balloon, strip, card, ...deskUi);
  root.replaceChildren(page);

  effect(() => {
    const lines = store.captions.value.slice(-2);
    captions.replaceChildren(
      ...lines.map((c) => {
        const p = el('p', 'home-caption');
        p.append(el('strong', '', c.source), document.createTextNode(` ${c.text}`));
        return p;
      }),
    );
  });

  const showCard = (pc: { url: string; image?: string; title: string }): void => {
    card.replaceChildren();
    const img = el('img', 'home-card-img');
    if (pc.image) img.src = pc.image;
    img.alt = 'The island, seen from the bench';
    img.hidden = !pc.image;
    const h = el('h2', 'home-card-title', pc.title);
    const qr = el('div', 'home-card-qr');
    qr.innerHTML = qrSvg(pc.url);
    const link = el('a', 'home-card-link', pc.url.replace(/^https?:\/\//, ''));
    link.href = pc.url;
    link.target = '_blank';
    link.rel = 'noopener';
    const row = el('div', 'home-card-row');
    const copy = el('button', 'tag tag-small', TEXT.copy);
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(pc.url).then(() => (copy.textContent = TEXT.copied));
    });
    const close = el('button', 'tag tag-small', TEXT.close);
    close.type = 'button';
    close.addEventListener('click', () => (card.hidden = true));
    row.append(copy, close);
    card.append(img, h, qr, link, row);
    card.hidden = false;
  };
  effect(() => {
    const pc = store.postcard.value;
    if (pc) showCard({ ...pc, title: TEXT.postcard });
  });
  effect(() => {
    const link = store.invite.value;
    if (link) showCard({ url: link, title: TEXT.inviteTitle });
  });

  // ---- the world boots in the background
  const booting = (async () => {
    const boot: Boot = await import('../../app/boot/world');
    const app = await boot.bootApp(stage);
    const mod: WF = await import('../../app/wayfolk');
    const started = await mod.startWayfolk(app);
    // Fonts and shaders are ready before the clouds part, so nothing pops in.
    await Promise.race([started.warm(), new Promise((r) => setTimeout(r, 8000))]);
    wf = started;
    if (page.dataset.state === 'before') started.showcase(true);
    return { app, wf: started };
  })().catch((error: unknown) => {
    console.error('[wf] the island did not start', error);
    const code = (error as { code?: string } | null)?.code;
    status.textContent = code === 'webgl-unavailable' ? TEXT.noWebgl : TEXT.failed;
    enter.textContent = TEXT.reload;
    enter.onclick = () => location.reload();
    look.hidden = true;
    page.dataset.state = 'failed';
    void plate;
    return null;
  });

  void booting.then((ready) => {
    if (!ready) return;
    page.dataset.loaded = 'yes';
    if (page.dataset.state === 'before') status.textContent = enter.dataset.xr === 'no' ? TEXT.questHint : '';
  });

  void xrOffered().then((offered) => {
    enter.dataset.xr = offered ? 'yes' : 'no';
    vrTag.hidden = !offered;
    if (!offered) {
      enter.hidden = true;
      look.classList.add('tag-main');
      if (page.dataset.loaded === 'yes') status.textContent = TEXT.questHint;
    }
  });

  const inside = (how: 'desk' | 'session'): void => {
    page.dataset.state = how;
  };
  // The balloon lifts off with its tags before the clouds come.
  const liftOff = (): Promise<void> =>
    new Promise((resolve) => {
      balloon.classList.add('is-leaving');
      setTimeout(resolve, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700);
    });

  // Whoever starts the session (this page, the headset browser, the emulator), the page follows.
  effect(() => {
    const mode = store.mode.value;
    if (mode !== 'desk') {
      inside('session');
      void booting.then((ready) => ready?.wf.begin());
    }
  });

  const enterSession = async (): Promise<void> => {
    const ready = await booting;
    if (!ready) return;
    try {
      await ready.app.session.enter('room');
      inside('session');
      void ready.wf.begin();
    } catch {
      status.textContent = TEXT.questHint;
    }
  };

  let pending = false;
  enter.addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    const clickedAt = performance.now();
    enter.setAttribute('aria-busy', 'true');
    const ready = await booting;
    enter.removeAttribute('aria-busy');
    pending = false;
    if (!ready) return;
    try {
      await ready.app.session.enter('room');
      inside('session');
      void ready.wf.begin();
    } catch {
      status.textContent = performance.now() - clickedAt > 4000 ? TEXT.again : TEXT.questHint;
    }
  });
  look.addEventListener('click', async () => {
    const ready = await booting;
    if (!ready) return;
    await liftOff();
    inside('desk');
    void ready.wf.begin();
  });

  // Debug: ?desk=1 sits down at once (web scenarios).
  if (new URLSearchParams(location.search).get('desk') === '1') {
    void booting.then((ready) => {
      if (!ready) return;
      inside('desk');
      void ready.wf.begin();
    });
  }
}
