/**
 * Drawn pieces of the landing: the Wayfolk wordmark with Pip perched on the k, the
 * balloon that carries the entry tags, and the painted sunset that shows before the live
 * island is ready. Plain SVG strings, no outside images.
 */

export const WORDMARK = `
<svg class="wm" viewBox="0 0 640 210" role="img" aria-labelledby="wm-t">
  <title id="wm-t">Wayfolk</title>
  <defs>
    <linearGradient id="wm-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff8ea"/>
      <stop offset="1" stop-color="#ffe2b8"/>
    </linearGradient>
  </defs>
  <g font-family="'Atkinson Hyperlegible Next', 'Atkinson Fallback', sans-serif" font-weight="700" font-size="150" letter-spacing="-4">
    <text x="18" y="168" fill="#8e3d22" stroke="#8e3d22" stroke-width="26" stroke-linejoin="round">Wayfolk</text>
    <text x="18" y="158" fill="#c4532f" stroke="#c4532f" stroke-width="22" stroke-linejoin="round">Wayfolk</text>
    <text x="18" y="156" fill="url(#wm-fill)" stroke="#5a2a17" stroke-width="5" stroke-linejoin="round" paint-order="stroke">Wayfolk</text>
  </g>
  <g class="wm-pip" transform="translate(556 30)">
    <ellipse cx="0" cy="34" rx="20" ry="4" fill="#5a2a17" opacity="0.25"/>
    <path d="M-6 30 l-3 6 M4 30 l3 6" stroke="#5a2a17" stroke-width="3" stroke-linecap="round"/>
    <ellipse cx="0" cy="12" rx="22" ry="20" fill="#ff8a3d" stroke="#5a2a17" stroke-width="3.5"/>
    <ellipse cx="4" cy="18" rx="12" ry="10" fill="#ffd9a0"/>
    <path d="M-20 10 q-14 4 -12 16 q8 -2 14 -8z" fill="#e9724c" stroke="#5a2a17" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="-4" cy="4" r="4.2" fill="#2b1a12"/>
    <circle cx="-5.3" cy="2.6" r="1.4" fill="#fff"/>
    <path d="M-20 8 l-12 4 l12 4z" fill="#f4b740" stroke="#5a2a17" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M8 -8 q4 -8 10 -6" fill="none" stroke="#5a2a17" stroke-width="3" stroke-linecap="round"/>
  </g>
</svg>`;

export const BALLOON = `
<svg class="balloon-art" viewBox="0 0 200 260" aria-hidden="true">
  <defs>
    <clipPath id="env"><path d="M100 8 C 40 8 10 55 18 105 C 26 150 70 175 84 196 L116 196 C130 175 174 150 182 105 C190 55 160 8 100 8 Z"/></clipPath>
    <radialGradient id="env-shade" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#fff" stop-opacity="0.35"/>
      <stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
      <stop offset="1" stop-color="#4a1e10" stop-opacity="0.35"/>
    </radialGradient>
  </defs>
  <g clip-path="url(#env)">
    <rect x="0" y="0" width="200" height="200" fill="#e9724c"/>
    <path d="M58 0 C 44 60 48 140 84 200 L100 200 C 80 140 76 60 82 0Z" fill="#fff1d9"/>
    <path d="M118 0 C 124 60 120 140 100 200 L116 200 C 152 140 156 60 142 0Z" fill="#fff1d9"/>
    <rect x="0" y="118" width="200" height="16" fill="#f6b04a"/>
    <rect x="0" y="0" width="200" height="200" fill="url(#env-shade)"/>
  </g>
  <path d="M100 8 C 40 8 10 55 18 105 C 26 150 70 175 84 196 L116 196 C130 175 174 150 182 105 C190 55 160 8 100 8 Z" fill="none" stroke="#5a2a17" stroke-width="4"/>
  <path d="M86 196 L88 222 M114 196 L112 222 M96 197 L97 222 M104 197 L103 222" stroke="#5a2a17" stroke-width="2.5"/>
  <rect x="82" y="220" width="36" height="26" rx="5" fill="#a8754a" stroke="#5a2a17" stroke-width="3.5"/>
  <path d="M84 230 H116 M84 238 H116" stroke="#7a4f2e" stroke-width="2.5"/>
</svg>`;

/** One bank of soft sunset clouds: overlapping lobes with a warm underside. */
function bank(seed: number, y: number, scale: number): string {
  let out = '';
  for (let i = 0; i < 9; i += 1) {
    const x = ((i * 197 + seed * 61) % 1700) - 50;
    const w = (150 + ((i * 53 + seed * 17) % 120)) * scale;
    const h = w * 0.42;
    const cy = y + ((i * 29 + seed * 7) % 40);
    out += `<g transform="translate(${x} ${cy})">
      <ellipse cx="0" cy="${h * 0.35}" rx="${w}" ry="${h * 0.55}" fill="#f2b38a"/>
      <ellipse cx="${-w * 0.35}" cy="0" rx="${w * 0.55}" ry="${h * 0.75}" fill="#ffe6cc"/>
      <ellipse cx="${w * 0.25}" cy="${-h * 0.25}" rx="${w * 0.6}" ry="${h * 0.95}" fill="#fff2e2"/>
      <ellipse cx="${w * 0.7}" cy="${h * 0.1}" rx="${w * 0.42}" ry="${h * 0.6}" fill="#ffe9d4"/>
    </g>`;
  }
  return out;
}

/** The sunset behind the loading moment: sky and the low sun, no objects. */
export const LOADING_SKY = `
<svg class="ls-sky" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="ls-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3d5f86"/>
      <stop offset="0.42" stop-color="#b98a8e"/>
      <stop offset="0.68" stop-color="#f2a66b"/>
      <stop offset="1" stop-color="#ffd9b0"/>
    </linearGradient>
    <radialGradient id="ls-sun" cx="0.62" cy="0.66" r="0.4">
      <stop offset="0" stop-color="#fff3cf" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#fff3cf" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1600" height="900" fill="url(#ls-g)"/>
  <rect width="1600" height="900" fill="url(#ls-sun)"/>
</svg>`;

/** Two banks of clouds that part to the sides when the island is ready. */
export const CLOUDS_LEFT = `<svg class="ls-bank" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${bank(1, 640, 1.1)}${bank(4, 760, 1.5)}</svg>`;
export const CLOUDS_RIGHT = `<svg class="ls-bank" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${bank(2, 560, 0.9)}${bank(7, 700, 1.3)}</svg>`;

/** Pip in flight, wings up and down by CSS. */
export const PIP_FLYING = `
<svg class="ls-pip" viewBox="-40 -40 80 70" aria-hidden="true">
  <g class="ls-wing"><path d="M2 -2 q14 -26 30 -20 q-8 16 -26 26z" fill="#e9724c" stroke="#5a2a17" stroke-width="3" stroke-linejoin="round"/></g>
  <ellipse cx="0" cy="4" rx="20" ry="17" fill="#ff8a3d" stroke="#5a2a17" stroke-width="3.5"/>
  <ellipse cx="-4" cy="10" rx="11" ry="8" fill="#ffd9a0"/>
  <circle cx="-8" cy="-2" r="3.8" fill="#2b1a12"/>
  <circle cx="-9.2" cy="-3.3" r="1.3" fill="#fff"/>
  <path d="M-19 1 l-12 4 l12 4z" fill="#f4b740" stroke="#5a2a17" stroke-width="2.5" stroke-linejoin="round"/>
  <g class="ls-wing"><path d="M4 0 q16 -24 32 -16 q-8 18 -28 22z" fill="#f08a52" stroke="#5a2a17" stroke-width="3" stroke-linejoin="round"/></g>
</svg>`;
