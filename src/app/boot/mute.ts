/**
 * A page driven by automation (the IWSDK managed browser, Playwright scenarios and
 * previews) plays its sound into a silent gain instead of the speakers: every sound still
 * runs and is logged, but nobody hears a window they cannot see. A person's browser never
 * has `navigator.webdriver`, so nothing changes for them.
 */
export function muteUnderAutomation(): void {
  try {
    if (typeof navigator === 'undefined' || !navigator.webdriver || typeof window === 'undefined') return;
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext; __wfMuted?: boolean };
    const Base = w.AudioContext ?? w.webkitAudioContext;
    if (!Base || w.__wfMuted) return;
    class Muted extends Base {
      private silent: GainNode | null = null;
      override get destination(): AudioDestinationNode {
        if (!this.silent) {
          this.silent = this.createGain();
          this.silent.gain.value = 0;
          this.silent.connect(super.destination);
        }
        return this.silent as unknown as AudioDestinationNode;
      }
    }
    w.AudioContext = Muted;
    w.webkitAudioContext = Muted;
    w.__wfMuted = true;
  } catch {
    // Sound stays as it is.
  }
}
