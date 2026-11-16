/**
 * The one typeface in the headset: Atkinson Hyperlegible Next, 400 and 700, from the
 * MSDF atlases in public/fonts/atkinson-msdf/ (built by `npm run font`, digits tabular).
 * Set as the global default of every uikit component, so no panel falls back to the
 * bundled Inter and no package has to pass fonts around.
 */
import { setGlobalProperties } from '@pmndrs/uikit';

export const FONT_FAMILY = 'atkinson';

export function fontUrl(weight: 400 | 700): string {
  return `${import.meta.env.BASE_URL}fonts/atkinson-msdf/atkinson-${weight}.json`;
}

export const FONT_FAMILIES = {
  [FONT_FAMILY]: { normal: fontUrl(400), bold: fontUrl(700) },
};

let done = false;

/** Makes Atkinson the default font of uikit. Safe to call more than once. */
export function installFonts(): void {
  if (done) return;
  done = true;
  setGlobalProperties({ fontFamilies: FONT_FAMILIES, fontFamily: FONT_FAMILY });
}
