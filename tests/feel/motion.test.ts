import { describe, expect, it } from 'vitest';
import { store } from '../../src/app/store';
import { motionReduced } from '../../src/feel/motion';
import { springs } from '../../src/feel/spring';

describe('motionReduced: the real "Less motion" setting of the app store', () => {
  it('follows store.settings.lessMotion', () => {
    store.settings.value = { ...store.settings.value, lessMotion: false };
    expect(motionReduced()).toBe(false);
    store.settings.value = { ...store.settings.value, lessMotion: true };
    expect(motionReduced()).toBe(true);
    store.settings.value = { ...store.settings.value, lessMotion: false };
  });

  it('reaches the springs: the cover overshoots with motion on and does not with it off', () => {
    const top = (): number => {
      const s = springs.settle();
      s.target = 90;
      let max = 0;
      for (let i = 0; i < 90; i++) max = Math.max(max, s.step(1 / 90));
      return max;
    };
    store.settings.value = { ...store.settings.value, lessMotion: false };
    expect(top()).toBeGreaterThan(92);
    store.settings.value = { ...store.settings.value, lessMotion: true };
    expect(top()).toBe(90);
    store.settings.value = { ...store.settings.value, lessMotion: false };
  });
});
