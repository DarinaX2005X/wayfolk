/**
 * Sounds of the gallery: every sound of the palette with what it has to sound like, its
 * numbers and a button to listen; the tile and the stake play their whole rising phrase,
 * and the air of the Void can be switched on.
 */
import { answer } from '../../feel';
import { PLAN, type FeelName } from '../../feel/plan';
import { engine, sound } from '../../feel/sound';
import { AIR, PALETTE, SOUND_NAMES, type SoundName } from '../../feel/sound/palette';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const EVENTS: Record<SoundName, FeelName[]> = (() => {
  const map = Object.fromEntries(SOUND_NAMES.map((n) => [n, [] as FeelName[]])) as Record<SoundName, FeelName[]>;
  for (const [event, row] of Object.entries(PLAN)) {
    const beats = typeof row.sounds === 'function' ? row.sounds(2) : row.sounds;
    for (const b of beats) if (!map[b.sound].includes(event as FeelName)) map[b.sound].push(event as FeelName);
  }
  return map;
})();

export function soundSection(root: HTMLElement): void {
  const list = el('div', 'g-sounds');
  const listen = (fn: () => void): void => {
    sound.unlock();
    fn();
  };
  for (const name of SOUND_NAMES) {
    const p = PALETTE[name];
    const row = el('div', 'g-sound');
    const play = el('button', 'button button-secondary g-sound-play', `Play ${name}`);
    play.type = 'button';
    play.addEventListener('click', () => listen(() => sound.play(name, { value: 0.5 })));
    const text = el('div', 'g-sound-text');
    text.append(
      el('p', 'g-sound-like', p.like),
      el('p', 'g-sound-numbers', `${p.ms} ms, ${p.db} dB, ${p.band ? `noise ${p.band[0]}–${p.band[1]} Hz, ` : ''}${p.notes}`),
      el('p', 'g-sound-events', `Events: ${EVENTS[name].join(', ') || 'none'}`),
    );
    row.append(play, text);
    if (name === 'tile' || name === 'stake') {
      const phrase = el('button', 'button button-text g-sound-phrase', name === 'tile' ? 'Play a plot filling up' : 'Play five stakes');
      phrase.type = 'button';
      phrase.addEventListener('click', () =>
        listen(() => {
          const steps = name === 'tile' ? 11 : 5;
          for (let i = 0; i < steps; i++) setTimeout(() => answer({ type: name === 'tile' ? 'tile' : 'stake', value: i / (steps - 1) }), i * 160);
        }),
      );
      row.append(phrase);
    }
    list.append(row);
  }
  const air = el('div', 'g-sound');
  const toggle = el('button', 'button button-secondary g-sound-play', 'Air on');
  toggle.type = 'button';
  toggle.addEventListener('click', () =>
    listen(() => {
      const on = !engine.ambientOn;
      sound.ambient(on);
      toggle.textContent = on ? 'Air off' : 'Air on';
    }),
  );
  const t = el('div', 'g-sound-text');
  t.append(el('p', 'g-sound-like', AIR.like), el('p', 'g-sound-numbers', `${AIR.db} dB, under ${AIR.cutoff} Hz, ±${AIR.swingDb} dB over ${AIR.periodS} s, only in the Void`));
  air.append(toggle, t);
  list.append(air);
  root.append(list);
}
