/**
 * Design tokens of Groundwork, direction D "First light": the only place where colours,
 * sky, type sizes, panel sizes, light, the seated layout, motion times, quality levels
 * and the draw budget are written down. Source: DESIGN "Семантические токены",
 * "Пространство в шлеме", "Слои и движение", "Движение и ограничения". Views never
 * invent these numbers; tests/tokens.test.ts checks the layout geometry, the panel
 * capacity and every contrast pair of DESIGN against the values here.
 *
 * This file imports nothing. scripts/build-tokens.mjs transpiles it on its own to
 * generate src/tokens/tokens.css for the browser pages, and the token test keeps the
 * two in step.
 *
 * Units: metres and degrees in the headset (azimuth 0 ahead, positive to the right;
 * elevation positive up), milliseconds for time, CSS pixels in the browser.
 */

// ---------------------------------------------------------------- colour

/** Raw colours, named as in DESIGN "Цвет". */
export const COLOR = {
  void: {
    /** Top of the sky: near night. */
    zenith: '#05080F',
    /** At +4°: the deep blue of the blue hour. */
    mid: '#14244A',
    /** The thin warm band at eye level. */
    horizon: '#C88A58',
    /** Fallback horizon if the headset shows the band too bright. */
    horizonSoft: '#A3714B',
    /** At −2°. */
    low: '#141B2B',
    /** Under the island. */
    nadir: '#04060A',
  },
  ground: {
    /** Three tones of basalt for a tile; the tone is picked by seed. */
    tile: ['#2B3039', '#262B33', '#31363F'],
    /** Rings of graphite tiles of the home plot. */
    home: ['#1E232A', '#1A1E24'],
    /** The even cut, 45 mm along the inner edge of a plot. */
    cut: '#3A414C',
    /** The keel, 65 mm under the cut, set back by 5 cm. */
    keel: '#0A0C10',
  },
  /** Bench slab, board bodies, mechanisms: graphite. */
  slate: '#1A1F27',
  slateEdge: '#2E3641',
  /** Instruments, keys, trays: matte ceramic. */
  bone: '#F3EEE4',
  boneShade: '#CFC6B6',
  /** Sheets, pages, cards, envelopes. */
  paper: '#FBF8F1',
  /** Decorative edge on bone. */
  edge: '#D6CCBB',
  ink: '#1E2421',
  inkSoft: '#4E5753',
  /** The accent of the world: rings, stakes, survey lines, selection, focus. */
  cobalt: '#4A78FF',
  /** Accent text on light surfaces (bone keys, paper, the browser pages). */
  cobaltText: '#2449B0',
  /** Fill of a primary action with white text. */
  action: '#2D56D6',
  /** A verified tile's seam: a thin unlit line. */
  seam: '#5FA4FF',
  /** Sent back and refusal. */
  vermilion: '#C4422C',
  vermilionText: '#A3331F',
  /** Passed: a clear green. */
  moss: '#26934F',
  mossText: '#2C6B3E',
  /** Waiting and warning. */
  amber: '#C98A1B',
  amberText: '#865A0A',
  /** Background of a verbatim quote on a page. */
  highlight: '#F2D98A',
  /** Dashed outline of slots not taken yet; decorative. */
  outline: '#3D4757',
  /** Panels of the headset: dark smoked glass with crisp white type. */
  glass: {
    face: '#121821',
    edge: '#2C3542',
    text: '#F2F5F9',
    soft: '#A7B2C3',
    quiet: '#1C2430',
    inset: '#0C1117',
    accentText: '#8FB0FF',
    okFill: '#1E7A41',
    okText: '#62D894',
    dangerFill: '#B63A26',
    dangerText: '#FF8D77',
    waitText: '#F2C462',
  },
  /** High contrast panels; hc.cobalt is also the mark accent on dark. */
  hc: { bg: '#111513', text: '#FFFDF7', cobalt: '#9DB6FF' },
  /** Data categories (parties, guest sides, the second person), always with a shape. */
  category: { ochre: '#A87A22', sage: '#6C8F60', steel: '#61728A', terracotta: '#A9583F' },
  /** Field of the cover and dark sections of the landing. */
  coverField: '#0E1626',
} as const;

/** The shape that goes with each category colour: colour never carries meaning alone. */
export const CATEGORY_SHAPE = { ochre: 'triangle', sage: 'circle', steel: 'square', terracotta: 'diamond' } as const;
export type Category = keyof typeof CATEGORY_SHAPE;
export const CATEGORY_ORDER: readonly Category[] = ['ochre', 'sage', 'steel', 'terracotta'];

/**
 * What each colour is for in the browser pages. CSS gets these as --role-* aliases of
 * the raw values, so a high-contrast pair is designed, not inverted.
 */
export const ROLE = {
  canvas: COLOR.bone,
  canvasDark: COLOR.slate,
  surface: COLOR.paper,
  surfaceRaised: COLOR.paper,
  surfaceInset: COLOR.boneShade,
  text: COLOR.ink,
  textSoft: COLOR.inkSoft,
  textOnDark: COLOR.paper,
  border: COLOR.edge,
  action: COLOR.action,
  actionText: COLOR.paper,
  link: COLOR.cobaltText,
  focus: COLOR.action,
  focusOnDark: COLOR.hc.cobalt,
  selected: COLOR.action,
  success: COLOR.mossText,
  warning: COLOR.amberText,
  danger: COLOR.vermilionText,
} as const;

/**
 * Contrast pairs of DESIGN "Измеренный контраст": foreground on background, the ratio
 * DESIGN measured, the threshold, and whether the pair is allowed. Failing pairs are
 * recorded so that nobody "fixes" them by quietly moving a colour: the token test
 * requires them to stay below their threshold.
 */
export type ContrastPair = { fg: string; bg: string; ratio: number; min: 3 | 4.5 | 7; pass: boolean; use: string };
export const CONTRAST: readonly ContrastPair[] = [
  { fg: COLOR.glass.text, bg: COLOR.glass.face, ratio: 16.3, min: 4.5, pass: true, use: 'text of panels and cards' },
  { fg: COLOR.glass.soft, bg: COLOR.glass.face, ratio: 8.32, min: 4.5, pass: true, use: 'captions and units on glass' },
  { fg: COLOR.glass.accentText, bg: COLOR.glass.face, ratio: 8.34, min: 4.5, pass: true, use: 'work in progress, accent text' },
  { fg: COLOR.glass.okText, bg: COLOR.glass.face, ratio: 9.99, min: 4.5, pass: true, use: 'checks passed' },
  { fg: COLOR.glass.dangerText, bg: COLOR.glass.face, ratio: 7.92, min: 4.5, pass: true, use: 'reasons for sent back' },
  { fg: COLOR.glass.waitText, bg: COLOR.glass.face, ratio: 10.9, min: 4.5, pass: true, use: 'waiting for the model' },
  { fg: COLOR.glass.text, bg: COLOR.glass.quiet, ratio: 14.28, min: 4.5, pass: true, use: 'secondary buttons' },
  { fg: COLOR.glass.text, bg: COLOR.glass.inset, ratio: 17.33, min: 4.5, pass: true, use: 'preview of a step, code' },
  { fg: '#FFFFFF', bg: COLOR.action, ratio: 6.15, min: 4.5, pass: true, use: 'primary button text' },
  { fg: COLOR.paper, bg: COLOR.glass.okFill, ratio: 5.06, min: 4.5, pass: true, use: 'text on a green chip' },
  { fg: COLOR.paper, bg: COLOR.glass.dangerFill, ratio: 5.47, min: 4.5, pass: true, use: 'text on a sent-back chip' },
  { fg: COLOR.ink, bg: COLOR.amber, ratio: 5.37, min: 4.5, pass: true, use: 'text on an amber plate' },
  { fg: COLOR.ink, bg: COLOR.highlight, ratio: 11.33, min: 4.5, pass: true, use: 'quote on highlight' },
  { fg: COLOR.glass.text, bg: COLOR.slate, ratio: 15.13, min: 4.5, pass: true, use: 'station sign on graphite' },
  { fg: COLOR.glass.soft, bg: COLOR.slate, ratio: 7.72, min: 4.5, pass: true, use: 'numbers on a station sign' },
  { fg: COLOR.glass.text, bg: COLOR.void.mid, ratio: 13.91, min: 4.5, pass: true, use: 'word on the blue sky' },
  { fg: COLOR.ink, bg: COLOR.bone, ratio: 13.66, min: 4.5, pass: true, use: 'text on bone keys and pages' },
  { fg: COLOR.ink, bg: COLOR.paper, ratio: 14.89, min: 4.5, pass: true, use: 'text of pages' },
  { fg: COLOR.inkSoft, bg: COLOR.bone, ratio: 6.46, min: 4.5, pass: true, use: 'captions on bone' },
  { fg: COLOR.inkSoft, bg: COLOR.paper, ratio: 7.04, min: 4.5, pass: true, use: 'captions on paper' },
  { fg: COLOR.cobaltText, bg: COLOR.bone, ratio: 6.84, min: 4.5, pass: true, use: 'accent text on bone' },
  { fg: COLOR.cobaltText, bg: COLOR.paper, ratio: 7.46, min: 4.5, pass: true, use: 'links on paper' },
  { fg: COLOR.paper, bg: COLOR.action, ratio: 5.8, min: 4.5, pass: true, use: 'primary button of the pages' },
  { fg: COLOR.vermilionText, bg: COLOR.bone, ratio: 5.95, min: 4.5, pass: true, use: 'reasons for rejection on bone' },
  { fg: COLOR.vermilionText, bg: COLOR.paper, ratio: 6.49, min: 4.5, pass: true, use: 'reasons on paper' },
  { fg: COLOR.paper, bg: COLOR.vermilion, ratio: 4.76, min: 4.5, pass: true, use: 'text on the stamp' },
  { fg: COLOR.mossText, bg: COLOR.bone, ratio: 5.54, min: 4.5, pass: true, use: 'kept, fixed on a second look' },
  { fg: COLOR.amberText, bg: COLOR.bone, ratio: 5.22, min: 4.5, pass: true, use: 'waiting for the model, on bone' },
  { fg: COLOR.paper, bg: COLOR.slate, ratio: 15.6, min: 4.5, pass: true, use: 'sheets on the bench' },
  { fg: COLOR.paper, bg: COLOR.coverField, ratio: 17.05, min: 4.5, pass: true, use: 'Groundwork on the cover' },
  { fg: COLOR.hc.text, bg: COLOR.hc.bg, ratio: 18.1, min: 7, pass: true, use: 'high contrast' },
  { fg: COLOR.hc.cobalt, bg: COLOR.hc.bg, ratio: 9.27, min: 4.5, pass: true, use: 'accent on dark' },
  { fg: COLOR.hc.cobalt, bg: COLOR.slate, ratio: 8.33, min: 4.5, pass: true, use: 'accent on graphite' },
  { fg: COLOR.cobalt, bg: COLOR.bone, ratio: 3.35, min: 3, pass: true, use: 'instrument ring, the first stake on its plate' },
  { fg: COLOR.cobalt, bg: COLOR.slate, ratio: 4.27, min: 3, pass: true, use: 'active bar of a sign' },
  { fg: COLOR.cobalt, bg: COLOR.ground.tile[0], ratio: 3.42, min: 3, pass: true, use: 'stakes and survey line on the shelf' },
  { fg: COLOR.cobalt, bg: COLOR.ground.tile[1], ratio: 3.67, min: 3, pass: true, use: 'stakes on darker basalt' },
  { fg: COLOR.cobalt, bg: COLOR.ground.tile[2], ratio: 3.13, min: 3, pass: true, use: 'stakes on lighter basalt' },
  { fg: COLOR.cobalt, bg: COLOR.ground.home[0], ratio: 4.08, min: 3, pass: true, use: 'dashes on the home plot' },
  { fg: COLOR.cobalt, bg: COLOR.void.mid, ratio: 3.93, min: 3, pass: true, use: 'the plan line against the sky' },
  { fg: COLOR.seam, bg: COLOR.ground.tile[0], ratio: 5.2, min: 3, pass: true, use: 'lit seams between basalt tiles' },
  { fg: COLOR.seam, bg: COLOR.ground.tile[1], ratio: 5.58, min: 3, pass: true, use: 'lit seams, darker tiles' },
  { fg: COLOR.seam, bg: COLOR.ground.tile[2], ratio: 4.76, min: 3, pass: true, use: 'lit seams, lighter tiles' },
  { fg: COLOR.moss, bg: COLOR.ground.tile[0], ratio: 3.39, min: 3, pass: true, use: 'done collar on the shelf' },
  { fg: COLOR.moss, bg: COLOR.slate, ratio: 4.23, min: 3, pass: true, use: 'done bar of a sign' },
  { fg: COLOR.moss, bg: COLOR.bone, ratio: 3.38, min: 3, pass: true, use: 'checks on bone' },
  { fg: COLOR.vermilion, bg: COLOR.slate, ratio: 3.28, min: 3, pass: true, use: 'sent-back bar of a sign' },
  { fg: COLOR.vermilion, bg: COLOR.bone, ratio: 4.36, min: 3, pass: true, use: 'stamp on a slip' },
  { fg: COLOR.amber, bg: COLOR.slate, ratio: 5.62, min: 3, pass: true, use: 'waiting bar of a sign' },
  { fg: COLOR.bone, bg: COLOR.void.mid, ratio: 13.15, min: 3, pass: true, use: 'instruments against the sky' },
  { fg: COLOR.slate, bg: COLOR.void.horizon, ratio: 5.7, min: 3, pass: true, use: 'a sign against the warm band' },
  { fg: COLOR.category.ochre, bg: COLOR.bone, ratio: 3.32, min: 3, pass: true, use: 'category mark with shape' },
  { fg: COLOR.category.sage, bg: COLOR.bone, ratio: 3.17, min: 3, pass: true, use: 'category mark with shape' },
  { fg: COLOR.category.steel, bg: COLOR.bone, ratio: 4.24, min: 3, pass: true, use: 'category mark with shape' },
  { fg: COLOR.category.terracotta, bg: COLOR.bone, ratio: 4.37, min: 3, pass: true, use: 'category mark with shape' },
  { fg: COLOR.cobaltText, bg: COLOR.glass.face, ratio: 2.25, min: 4.5, pass: false, use: 'never: on glass the accent text is glass.accentText' },
  { fg: COLOR.vermilionText, bg: COLOR.glass.face, ratio: 2.59, min: 4.5, pass: false, use: 'never: on glass reasons use glass.dangerText' },
  { fg: COLOR.mossText, bg: COLOR.glass.face, ratio: 2.78, min: 4.5, pass: false, use: 'never: on glass passed uses glass.okText' },
  { fg: COLOR.ink, bg: COLOR.glass.face, ratio: 1.13, min: 4.5, pass: false, use: 'never: ink only on light plates' },
  { fg: COLOR.outline, bg: COLOR.ground.tile[0], ratio: 1.41, min: 3, pass: false, use: 'never: empty slots are decoration only' },
  { fg: COLOR.amber, bg: COLOR.bone, ratio: 2.55, min: 3, pass: false, use: 'never: amber on bone only as a plate with ink text' },
];

// ---------------------------------------------------------------- sky

/**
 * The dome of the Void: five stops by elevation and a soft light patch around the sun.
 * The same colours feed IBLGradient (zenith, horizon, nadir) on the level root.
 */
export const SKY = {
  stops: [
    { el: 90, color: COLOR.void.zenith },
    { el: 4, color: COLOR.void.mid },
    { el: 0, color: COLOR.void.horizon },
    { el: -2, color: COLOR.void.low },
    { el: -90, color: COLOR.void.nadir },
  ],
  /** Light patch where the sun has just set: a soft gradient on the band, no disc. */
  sun: { az: -35, el: 0.5, radiusDeg: 6 },
  /** Environment light: the blue of the sky above, a cool equator, dark ground. */
  ibl: { sky: '#2A3E66', equator: '#4A5670', ground: '#0B0F16' },
  /** Environment light in Room is half of the Void. */
  roomEnvScale: 0.5,
  /** The sky dissolves and comes back in this time. */
  modeMs: 800,
} as const;

// ---------------------------------------------------------------- light and shadow

export const LIGHT = {
  key: { az: -35, el: 20, color: '#FFDDB8', void: 1.45, room: 1.2 },
  fill: { sky: '#7D95C4', ground: '#1A1F29', intensity: 1.15 },
  /** Long shadow of an object: an elongated patch 2.25 × its height, ink at 0.22. */
  longShadow: { length: 2.25, color: COLOR.ink, opacity: 0.22 },
  /** Contact patch under every object: ink 0.35 at the centre. */
  contact: { color: COLOR.ink, opacity: 0.35 },
  /** A lifted object casts a wider, paler shadow that tightens on touch in this time. */
  touchMs: 120,
} as const;

/** Materials: MeshStandardMaterial without metal or emissive. Bevels in metres. */
export const MATERIAL = {
  tile: { roughness: 0.9, bevel: 0.003 },
  slate: { roughness: 0.6, bevel: 0.004 },
  bone: { roughness: 0.45 },
  paper: { roughness: 0.9, thickness: 0.0015 },
  /** Seam between tiles while laying and on a closed plot. */
  seam: { laying: 0.005, closed: 0.0025 },
  plot: { cut: 0.045, keel: 0.065, keelInset: 0.05 },
} as const;

// ---------------------------------------------------------------- text in the headset

/**
 * Text roles: height of a capital letter in millimetres at 1 m from the eyes ("dmm"),
 * growing linearly with distance. `flat` is text lying on the slab: seen at about 28°
 * and squashed by half, so it is set larger and only in short lines.
 */
export type TextRole = 'label' | 'read' | 'body' | 'head' | 'view' | 'count' | 'flat';
export const TEXT = {
  dmm: { label: 14, read: 16, body: 20, head: 26, view: 36, count: 44, flat: 26 } as Record<TextRole, number>,
  /** "Large text" multiplies every size. */
  large: 1.25,
  /** Font size is the capital height divided by this. */
  capRatio: 0.7,
  /** Line height in font sizes. */
  lineHeight: 1.35,
  /** Average character width of Atkinson Hyperlegible Next in font sizes. */
  charWidth: 0.5,
  /** No line is longer than this many characters. */
  maxLine: 48,
  /** Reading distance of an object held in the hand, metres from the eyes. */
  HELD: 0.4,
  weights: [400, 700] as const,
} as const;

/** Capital height in metres of `dmm` millimetres-at-a-metre seen from `distance` metres. */
export function dmmToMeters(dmm: number, distance: number): number {
  return (dmm / 1000) * distance;
}

/** Font size (em) in metres for a role at a distance from the eyes. */
export function textSizeFor(role: TextRole, distance: number, large = false): number {
  const cap = dmmToMeters(TEXT.dmm[role], distance) * (large ? TEXT.large : 1);
  return cap / TEXT.capRatio;
}

/** Line height in metres for a role at a distance. */
export function lineHeightFor(role: TextRole, distance: number, large = false): number {
  return textSizeFor(role, distance, large) * TEXT.lineHeight;
}

/** How many average characters of a role fit in `widthM` metres at a distance. */
export function charsPerLine(role: TextRole, widthM: number, distance: number, large = false): number {
  return Math.floor(widthM / (textSizeFor(role, distance, large) * TEXT.charWidth) + 1e-9);
}

/** A point at azimuth `azDeg`, horizontal `radius` metres from the head and `y` metres up. -Z is ahead. */
export function polar(azDeg: number, radius: number, y: number): { x: number; y: number; z: number } {
  const a = (azDeg * Math.PI) / 180;
  return { x: radius * Math.sin(a), y, z: -radius * Math.cos(a) };
}

/**
 * Panels of DESIGN "Типографика": role and distance from the eyes, what they hold and
 * their size. `lines` lists the text of the panel: `count` lines of up to `chars`
 * characters of a role. `flow: true` means the text reflows as one paragraph (only the
 * total length matters); otherwise each line stands on its own and in large text may
 * wrap to `wrap` lines at most. `reserve` is height taken by buttons and bars.
 */
export type PanelLine = { role: TextRole; chars: number; count: number; flow?: boolean; wrap?: number };
export type PanelSpec = {
  role: TextRole;
  eyeDist: number;
  lines: PanelLine[];
  /** What the panel holds in large text when that differs (the source page shows less). */
  largeLines?: PanelLine[];
  /** Characters laid side by side in one line of several roles (counter and unit). */
  rows?: { parts: { role: TextRole; chars: number }[] }[];
  reserve?: number;
  size: { w: number; h: number };
  large: { w: number; h: number };
};
export const PANEL = {
  envelopeLabel: {
    role: 'label',
    eyeDist: 0.59,
    lines: [{ role: 'label', chars: 25, count: 2, wrap: 2 }],
    size: { w: 0.16, h: 0.09 },
    large: { w: 0.16, h: 0.09 },
  },
  traySlip: {
    role: 'label',
    eyeDist: 0.56,
    lines: [{ role: 'label', chars: 9, count: 2 }],
    size: { w: 0.075, h: 0.05 },
    large: { w: 0.075, h: 0.05 },
  },
  slipSheet: {
    role: 'read',
    eyeDist: TEXT.HELD,
    lines: [{ role: 'read', chars: 35, count: 12, flow: true }],
    size: { w: 0.18, h: 0.16 },
    large: { w: 0.18, h: 0.22 },
  },
  runCard: {
    role: 'flat',
    eyeDist: 0.68,
    lines: [{ role: 'flat', chars: 22, count: 2 }],
    reserve: 0.044,
    // DESIGN gave 13 cm (14.5 large); the line under "Run it live" adds a row.
    size: { w: 0.4, h: 0.156 },
    large: { w: 0.4, h: 0.176 },
  },
  captionRail: {
    role: 'read',
    eyeDist: 0.76,
    lines: [{ role: 'read', chars: 46, count: 2 }],
    size: { w: 0.66, h: 0.06 },
    large: { w: 0.66, h: 0.072 },
  },
  askCard: {
    role: 'read',
    eyeDist: 0.57,
    lines: [{ role: 'read', chars: 48, count: 3, flow: true }],
    // two buttons of 44 mm and the countdown bar
    reserve: 0.058,
    size: { w: 0.36, h: 0.16 },
    large: { w: 0.36, h: 0.18 },
  },
  stationBoard: {
    role: 'read',
    eyeDist: 1.3,
    lines: [
      { role: 'body', chars: 20, count: 1 },
      { role: 'label', chars: 28, count: 1 },
      { role: 'view', chars: 4, count: 1 },
      { role: 'read', chars: 25, count: 3 },
    ],
    rows: [{ parts: [{ role: 'view', chars: 4 }, { role: 'read', chars: 16 }] }],
    size: { w: 0.42, h: 0.34 },
    large: { w: 0.5, h: 0.41 },
  },
  stationPlan: {
    role: 'read',
    eyeDist: 1.3,
    lines: [
      { role: 'body', chars: 20, count: 1 },
      { role: 'label', chars: 28, count: 1 },
      { role: 'read', chars: 25, count: 6 },
    ],
    // Six lines and no counter: 2 cm taller than a station board (2.8 cm in large text).
    size: { w: 0.42, h: 0.36 },
    large: { w: 0.5, h: 0.438 },
  },
  stationChip: {
    role: 'label',
    eyeDist: 1.3,
    lines: [{ role: 'label', chars: 9, count: 1 }],
    size: { w: 0.17, h: 0.058 },
    large: { w: 0.17, h: 0.058 },
  },
  timelineCard: {
    role: 'label',
    eyeDist: 1.26,
    lines: [
      { role: 'body', chars: 6, count: 1 },
      { role: 'label', chars: 9, count: 2 },
    ],
    size: { w: 0.125, h: 0.13 },
    large: { w: 0.156, h: 0.16 },
  },
  readingLine: {
    role: 'read',
    eyeDist: 1.33,
    lines: [{ role: 'read', chars: 44, count: 2 }],
    size: { w: 0.9, h: 0.1 },
    large: { w: 0.9, h: 0.12 },
  },
  sourcePage: {
    role: 'read',
    eyeDist: 0.65,
    lines: [{ role: 'read', chars: 44, count: 20 }],
    // large text shows 35 characters in 16 lines on the same sheet
    largeLines: [{ role: 'read', chars: 35, count: 16 }],
    size: { w: 0.36, h: 0.48 },
    large: { w: 0.36, h: 0.48 },
  },
  workSheet: {
    role: 'read',
    eyeDist: 0.45,
    lines: [{ role: 'read', chars: 28, count: 20 }],
    size: { w: 0.16, h: 0.3 },
    // DESIGN gives 16 × 38 cm; 28 characters of large text need 18 cm of width
    large: { w: 0.18, h: 0.38 },
  },
  plotLabel: {
    role: 'label',
    eyeDist: 1.7,
    lines: [{ role: 'label', chars: 22, count: 2 }],
    size: { w: 0.4, h: 0.11 },
    // DESIGN gives no large size; 22 characters of large text need 0.47 m
    large: { w: 0.5, h: 0.135 },
  },
  codeCard: {
    role: 'count',
    eyeDist: 0.6,
    lines: [
      { role: 'count', chars: 5, count: 1 },
      { role: 'read', chars: 44, count: 1, wrap: 2 },
    ],
    size: { w: 0.3, h: 0.11 },
    large: { w: 0.3, h: 0.11 },
  },
} satisfies Record<string, PanelSpec>;

// ---------------------------------------------------------------- layout in the headset

/**
 * A place in the seated layout: azimuth (degrees, positive right), horizontal distance
 * from the head, height `y` above the bench top (the top is 0.32 m below the eyes),
 * size (w across, d in depth, h up) and the distance from the eyes to its centre, the
 * one text size is computed for.
 */
export type Place = { az: number; dist: number; y: number; w: number; d: number; h: number; eyeDist: number };

/** Eye height of a seated person over the floor, and the bench top under the eyes. */
export const SEAT = {
  eyeHeight: 1.15,
  benchBelowEyes: 0.32,
  /** Everything important sits in this cone. */
  cone: { horizontal: 30, up: 15, down: -35 },
  /** What is taken by hand stands this far (horizontal) from the head. */
  handZone: { min: 0.45, max: 0.62 },
  /** Sitting camera of the browser: eye height and pitch. */
  desk: { eyeHeight: 1.15, pitchDeg: -9, fovDeg: 60 },
} as const;

const eye = (dist: number, y: number): number =>
  Math.round(Math.hypot(dist, SEAT.benchBelowEyes - y) * 1000) / 1000;

const place = (az: number, dist: number, y: number, w: number, d: number, h: number, eyeDist = eye(dist, y + h / 2)): Place => ({
  az,
  dist,
  y,
  w,
  d,
  h,
  eyeDist,
});

/** Objects lying or standing on the bench slab, axis-aligned with the slab. */
export type BenchItem =
  | 'inbox'
  | 'firstStake'
  | 'runCard'
  | 'traySent'
  | 'trayFool'
  | 'voiceStone'
  | 'modeSwitch'
  | 'settingsTile'
  | 'keyIsland'
  | 'keySend';

/** Bench items taken or touched by hand: they stand in the hand zone. */
export const HAND_ITEMS: readonly BenchItem[] = ['inbox', 'firstStake', 'traySent', 'trayFool', 'voiceStone'];

/**
 * Which bench items are on the slab at the same time. Keys show only in a work view,
 * where the trays hide; the fool tray appears after a run. Overlap is checked inside
 * each group.
 */
export const BENCH_TOGETHER: readonly (readonly BenchItem[])[] = [
  ['inbox', 'firstStake', 'settingsTile', 'voiceStone', 'modeSwitch', 'runCard', 'traySent', 'trayFool'],
  ['inbox', 'firstStake', 'settingsTile', 'voiceStone', 'modeSwitch', 'runCard', 'keyIsland', 'keySend'],
];

const BENCH: Record<BenchItem, Place> = {
  /** Bone block 21 × 10 × 7.5 cm with a slot; the cobalt flag pin (5 cm) stands beside it. */
  inbox: place(-30, 0.5, 0, 0.21, 0.1, 0.075),
  /** Cobalt stake 5 cm on a bone plate 12 × 9 cm with the dashed outline of an envelope. */
  firstStake: place(-10, 0.46, 0, 0.12, 0.09, 0.05),
  /** Card 40 × 15.6 cm lying flat (17.6 cm deep in large text), its far edge inside the slab. */
  runCard: place(-7, 0.59, 0, 0.4, 0.156, 0.003, 0.68),
  /** Bone tray 16 × 11 cm, the long side in depth. */
  traySent: place(20, 0.45, 0, 0.11, 0.16, 0.03),
  /** The same tray with a small stamp head; appears after a run. */
  trayFool: place(32, 0.52, 0, 0.11, 0.16, 0.03),
  /** Slate stone 5 cm across on a bone stand. */
  voiceStone: place(22, 0.6, 0, 0.06, 0.06, 0.035),
  /** Bone cap 6 cm, 3 cm high. */
  modeSwitch: place(30, 0.64, 0, 0.06, 0.06, 0.03),
  /** Bone tile 6 × 6 cm; selected, not taken. */
  settingsTile: place(-30, 0.64, 0, 0.06, 0.06, 0.004),
  /** "Island", in the far left corner; only in a work view. */
  keyIsland: place(-32, 0.74, 0, 0.09, 0.044, 0.012),
  /** "Send to phone", in the far right corner; only in a work view. */
  keySend: place(32, 0.74, 0, 0.09, 0.044, 0.012),
};

/**
 * The bench for narrow devices (Meta VR Glasses, 37° to each side). The rule pulls
 * azimuths beyond ±20° in by `20 + (|az| − 20) × 0.4`, so ±30° becomes ±24°. Applied
 * alone it makes objects that lie on the slab together overlap (the inbox runs into the
 * first stake, the trays into each other, the settings tile into the run card): inside
 * ±24.8° the slab has no room for all of them at once. So `narrowAz` is the target and
 * the places below are the nearest arrangement without overlaps, found by search under
 * the same checks as the ordinary bench: every centre within ±26.5°, nothing taller than
 * the height rule, nothing seen lower than −35°. Glasses select by gaze and pinch, so
 * the hand zone does not bind here; every object is still within 0.44–0.69 m.
 */
export function narrowAz(az: number): number {
  const a = Math.abs(az);
  return a <= 20 ? az : Math.sign(az) * (20 + (a - 20) * 0.4);
}

/** Widest azimuth of a bench object's centre in the narrow layout. */
export const NARROW_MAX_AZ = 26.5;

function narrowBench(): Record<BenchItem, Place> {
  const n = (item: BenchItem, az: number, dist: number): Place => {
    const p = BENCH[item];
    return place(az, dist, p.y, p.w, p.d, p.h, item === 'runCard' ? 0.68 : undefined);
  };
  return {
    inbox: n('inbox', -25.5, 0.46),
    firstStake: n('firstStake', -3.5, 0.46),
    runCard: n('runCard', -7, 0.595),
    traySent: n('traySent', 14, 0.44),
    trayFool: n('trayFool', 26.5, 0.5),
    voiceStone: n('voiceStone', 16.8, 0.59),
    modeSwitch: n('modeSwitch', 23, 0.61),
    settingsTile: n('settingsTile', -26.5, 0.69),
    keyIsland: n('keyIsland', -25.5, 0.54),
    keySend: n('keySend', 24.8, 0.69),
  };
}

const BENCH_NARROW: Record<BenchItem, Place> = narrowBench();

/** Every row of DESIGN "Пространство в шлеме". */
export const LAYOUT = {
  ...BENCH,
  /** Home plot: disc of radius 0.9 m under the person, top 0.55 m below the eyes. */
  homePlot: place(0, 0, -0.23, 1.8, 1.8, 0, 0.55),
  /** Slate slab 0.9 × 0.45 m, centre 0.45 m ahead (0.225 to 0.675), 4 cm thick. */
  bench: place(0, 0.45, 0, 0.9, 0.45, 0.04),
  /** Caption rail behind the far edge: bottom on the edge, leaning away at 60° to the slab. */
  captionRail: { ...place(0, 0.675, 0, 0.66, 0.006, 0.06, 0.76), tiltDeg: 60, hLarge: 0.072 },
  /** Ask card: 2 cm above the slab, 55° to it; covers the rail while it asks. */
  askCard: { ...place(0, 0.52, 0.02, 0.36, 0.006, 0.16, 0.57), tiltDeg: 55, hLarge: 0.18 },
  /** Card at the hand: 10 cm over the pinch with a hand; at this place for ray, gaze and mouse. */
  handCard: { ...place(-14, 0.5, 0.06, 0.16, 0.006, 0.3), abovePinch: 0.1 },
  /** Code card over the inbox (own files) or here (export, visit, together). */
  codeCard: place(22, 0.5, 0.04, 0.3, 0.006, 0.11, 0.6),
  /** The run arc: radius 1.30 m, inner edge 1.215 m, 0.47 m below the eyes, −31° to +31°, shelf 22 cm wide. */
  arc: {
    ...place(0, 1.3, -0.15, 0, 0.22, 0, 1.38),
    from: -31,
    to: 31,
    inner: 1.215,
    rows: { inner: 1.27, outer: 1.38 },
    /** Folded instruments park left of the shelf: six places in two rows of three. */
    parking: { from: -41, to: -31, rows: 2, perRow: 3, step: 0.075 },
    /** Work spots at a model station: 2 × 2, both rows, 11 cm apart. */
    workSpots: { rows: 2, perRow: 2, step: 0.11 },
    stations: { 5: [-26, -13, 0, 13, 26], 4: [-19.5, -6.5, 6.5, 19.5], 3: [-13, 0, 13] } as Record<3 | 4 | 5, number[]>,
  },
  /** Station boards on a 6 mm rod; bottom 0.165 m below the eyes. */
  board: {
    full: place(0, 1.3, 0.155, 0.42, 0.006, 0.34, 1.3),
    fullLarge: place(0, 1.3, 0.12, 0.5, 0.006, 0.41, 1.3),
    chip: place(0, 1.3, 0.155, 0.17, 0.006, 0.058, 1.3),
    rod: 0.006,
  },
  /** Ring of plots: inner 1.46 m, outer 2.16 m, 8 slots of 45° with 2.4° gaps, leaning 14° to the person. */
  ring: {
    ...place(0, 1.46, -0.15, 0, 0.7, 0, 1.5),
    inner: 1.46,
    outer: 2.16,
    slots: 8,
    gapDeg: 2.4,
    innerY: -0.15,
    outerY: 0.02,
    tiltDeg: 14,
  },
  /** The plot laid during a run: slot 0, straight behind the arc. */
  newPlot: place(0, 1.81, -0.065, 0, 0.7, 0, 1.81),
  /** Object of a plot at the inner edge; its label board 0.40 × 0.11 m. */
  plotObject: { ...place(0, 1.7, -0.1, 0.21, 0.15, 0.35, 1.7), hMin: 0.3, hMax: 0.4 },
  plotLabel: place(0, 1.7, 0.27, 0.4, 0.006, 0.11, 1.7),
  /** Timeline in the Void: band of radius 1.25 m over 100°; six lanes and the month axis. */
  timelineVoid: {
    ...place(0, 1.25, -0.08, 0, 0.006, 0.58, 1.26),
    spanDeg: 100,
    lanes: 6,
    lane: 0.09,
    axis: 0.04,
    /** Heights relative to the eyes. */
    top: 0.18,
    bottom: -0.4,
    cardsFrom: 0.2,
    cardsTo: 0.33,
    reading: { w: 0.9, h: 0.1, hLarge: 0.12, centerY: -0.47 },
  },
  /** Timeline in Room: on a found wall 0.8–3.5 m away, scaled so a card keeps its angular size. */
  timelineRoom: { nearest: 0.8, farthest: 3.5, scale: { per: 1.25, min: 0.8, max: 2.6 } },
  /** Two pages above the bench, 0.6 m away, tilted 20°. */
  pairPages: { ...place(0, 0.6, 0.15, 0.36, 0.006, 0.48, 0.65), tiltDeg: 20, gap: 0.04 },
  /** Hall model 80 × 40 cm on the bench (1:25). */
  hall: { ...place(0, 0.45, 0, 0.8, 0.4, 0.02), scale: 1 / 25 },
  /** Fan of notebooks: an arc of 0.7 m on the bench, centre 0°, 0.50 m. */
  notebookFan: { ...place(0, 0.5, 0, 0.7, 0.18, 0.04), arc: 0.7 },
  /** The island in Room: a 1:6 model (outer radius 0.36 m) on a found table, or floating here at bench height. */
  roomIsland: { ...place(-40, 0.6, 0, 0.72, 0.72, 0.1), scale: 1 / 6 },
  /** Ring and arc in a work view sink 0.35 m and fade by 15%. */
  workView: { sink: 0.35, fade: 0.15 },
  /** Air between bench and arc and the drop to the shelf. */
  gap: { air: 0.6, drop: 0.15 },
  /** Height rule: an object on the slab at forward distance z is no taller than a + b·z. */
  heightRule: { a: 0.32, b: -0.474 },
  /** Object held in the hand reads at this distance. */
  held: TEXT.HELD,
  narrow: BENCH_NARROW,
} as const;

// ---------------------------------------------------------------- browser

/** Type scale of the browser pages, px; body 17 with line height 1.55. */
export const WEB_TYPE = {
  family: "'Atkinson Hyperlegible Next', 'Atkinson Hyperlegible', system-ui, sans-serif",
  scale: { caption: 15, body: 17, lead: 21, heading: 28, title: 44, display: 76 },
  body: { size: 17, leading: 1.55, weight: 400 },
  display: { size: 76, sizePhone: 44, weight: 700, trackingEm: -0.03, leading: 1.02 },
  heading: { weight: 700, trackingEm: -0.02, leading: 1.12 },
  label: { weight: 700 },
} as const;

/** Radii: browser px, headset metres. */
export const RADIUS = {
  web: { large: 20, card: 14, control: 10, tag: 6 },
  /** Panels up to 30 cm get 14 mm; larger ones 20 mm. */
  panel: { small: 0.014, large: 0.02, smallUpTo: 0.3 },
  /** Panel thickness, no transparency. */
  panelDepth: 0.006,
} as const;

/** Browser elevation roles: one light from the top left, ink-tinted. */
export const SHADOW = {
  rest: '0 1px 1px #1E242110, 0 2px 6px #1E242110',
  raised: '0 1px 2px #1E242114, 0 10px 28px -8px #1E242130',
  overlay: '0 2px 4px #1E242114, 0 28px 64px -16px #1E242147',
} as const;

/** Targets: buttons 44 mm at touch distance, 60 mm for a ray at 1 m and further. */
export const TARGET = {
  buttonTouch: 0.044,
  buttonRay: 0.06,
  /** Hit volume of a select target is at least this angular size. */
  minAngleDeg: 2.2,
  /** Hand-grab target at least 22 mm with 12 mm clearance. */
  grabMin: 0.022,
  grabGap: 0.012,
  /** Browser controls. */
  web: { button: 56, control: 48, focusRing: 3, focusOffset: 2 },
} as const;

// ---------------------------------------------------------------- motion

export const MOTION = {
  spring: { press: 0.96, pressMs: 90, lift: 1.04, resultMs: 420, overshoot: 0.06 },
  stake: { staggerMs: 120, settle: 0.03, settleMs: 180, lineMs: 240, outlineMs: 1200 },
  instrument: { unfoldMs: 300, speed: 0.9, stepTail: 0.1, stepsPerSecond: 5, stepLength: 0.05 },
  tile: { travelMs: 300, flipDropMs: 200, dropFrom: 0.04, staggerMs: 90, staggerBusyMs: 60, busyAfter: 8, layMs: 500 },
  plot: { closeMs: 500, settle: 0.02 },
  slip: { openMs: 220, closeMs: 160, lift: 0.06, turnDeg: 60, closeBelow: 0.03, closeUnderDeg: 35 },
  /** Display queue minimums; multiplied by pace. */
  queue: {
    stakeMinMs: 180,
    stakeOffsetMs: 120,
    firstStamps: 3,
    firstStampMs: 600,
    stampMs: 150,
    counterPerSecond: 20,
    lagMaxMs: 1500,
    layRowMs: 200,
    batchHandoffMs: 600,
    batchReleaseMs: 1200,
  },
  ask: { flyMs: 800, countdownMs: 20_000, autoShownMs: 5000 },
  bloom: { notesMs: 900, growMs: 900 },
  firstFrame: { fadeMs: 400, homeRevealMs: 1500 },
  /** Browser micro-interactions. */
  web: {
    hoverMs: 160,
    pressMs: 100,
    releaseMs: 220,
    lift: 2,
    pressScale: 0.97,
    ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    easeRelease: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
  },
} as const;

// ---------------------------------------------------------------- quality and budget

/**
 * Quality levels. Low is entered when a frame takes longer than 14 ms for three seconds
 * in a row, and never while the person holds something.
 */
export const QUALITY = {
  high: { frameScale: 1.0, legs: true, longShadows: true },
  medium: { frameScale: 0.9, legs: true, longShadows: true },
  low: { frameScale: 0.8, legs: false, longShadows: false },
  slowFrameMs: 14,
  slowForMs: 3000,
} as const;

/** Zones of the draw budget (DESIGN "Бюджет отрисовки по зонам"); `zone(obj, name)` tags roots. */
export type Zone =
  | 'sky-bench'
  | 'bench-panels'
  | 'arc'
  | 'boards'
  | 'instruments'
  | 'plot'
  | 'ring'
  | 'slips'
  | 'hands'
  | 'shadows'
  | 'reserve';

/**
 * The frame budget: unique draw calls per eye and triangles, no shadow map, no post
 * processing. `viewFactor` is what renderer.info counts per unique call inside an
 * emulated session (measured by task 01.1.4, see tests/xr/README.md).
 */
export const BUDGET = {
  drawCalls: 90,
  triangles: 150_000,
  zones: {
    'sky-bench': 10,
    'bench-panels': 12,
    arc: 5,
    boards: 11,
    instruments: 6,
    plot: 3,
    ring: 18,
    slips: 2,
    hands: 3,
    shadows: 2,
    reserve: 18,
  } as Record<Zone, number>,
  /**
   * Measured by task 01.1.4 (tests/xr/README.md): inside an emulated session on
   * metaQuest3 and metaVRGlasses renderer.info counts every draw once per view, so a
   * scene of 9 unique draws reports 18. At the desk the factor is 1.
   */
  viewFactor: 2,
} as const;
