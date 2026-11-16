/**
 * Colours and sizes of the panels for the current settings (DESIGN "Цвет", "Типографика",
 * "Геометрия, материалы и свет"). Panels read `uiTheme()` when they are built and when the
 * settings `highContrast` or `largeText` change; the gallery can override both without
 * touching the person's settings.
 *
 * Normal: dark smoked glass with crisp white type, cobalt for work in progress, a clear
 * green for passed, vermilion only for sent back. High
 * contrast: the hc pair (18.1:1) with the light cobalt for the accent. All panels are
 * opaque.
 */
import { COLOR, RADIUS, TARGET, TEXT, textSizeFor, type TextRole } from '../../tokens/tokens';
import { store } from '../../app/store';

export type UiOverride = { highContrast?: boolean; largeText?: boolean };

let override: UiOverride | null = null;

/** The gallery's preview of high contrast and large text (null: follow the settings). */
export function setUiOverride(o: UiOverride | null): void {
  override = o ? { ...o } : null;
}

export type UiTheme = {
  hc: boolean;
  large: boolean;
  /** Face of a panel, its text, secondary text, the accent and text on the accent. */
  face: string;
  text: string;
  soft: string;
  accent: string;
  onAccent: string;
  accentText: string;
  /** Body of boards and the rim around their face. */
  body: string;
  /** Edge of a bone face (bent border). */
  edge: string;
  /** Secondary button face. */
  quiet: string;
  danger: string;
  dangerText: string;
  ok: string;
  okText: string;
  wait: string;
  waitText: string;
  highlight: string;
  paper: string;
};

const NORMAL = {
  face: COLOR.glass.face,
  text: COLOR.glass.text,
  soft: COLOR.glass.soft,
  accent: COLOR.action,
  onAccent: '#FFFFFF',
  accentText: COLOR.glass.accentText,
  body: COLOR.glass.inset,
  edge: COLOR.glass.edge,
  quiet: COLOR.glass.quiet,
  danger: COLOR.glass.dangerFill,
  dangerText: COLOR.glass.dangerText,
  ok: COLOR.glass.okFill,
  okText: COLOR.glass.okText,
  wait: COLOR.amber,
  waitText: COLOR.glass.waitText,
  highlight: COLOR.highlight,
  paper: COLOR.glass.inset,
};

const HIGH = {
  face: COLOR.hc.bg,
  text: COLOR.hc.text,
  soft: COLOR.hc.text,
  accent: COLOR.hc.cobalt,
  onAccent: COLOR.hc.bg,
  accentText: COLOR.hc.cobalt,
  body: COLOR.hc.bg,
  edge: COLOR.hc.text,
  quiet: COLOR.hc.bg,
  // On the dark face the light accent marks state; amber and vermilion keep their own plates with ink.
  danger: COLOR.vermilion,
  dangerText: COLOR.hc.text,
  ok: COLOR.moss,
  okText: COLOR.hc.text,
  wait: COLOR.amber,
  waitText: COLOR.hc.text,
  highlight: COLOR.highlight,
  paper: COLOR.hc.bg,
};

export function uiTheme(): UiTheme {
  const s = store.settings.peek();
  const hc = override?.highContrast ?? s.highContrast;
  const large = override?.largeText ?? s.largeText;
  return { hc, large, ...(hc ? HIGH : NORMAL) };
}

/** Font size in layout units (mm) for a role at a distance from the eyes. */
export function fontMm(role: TextRole, eyeDist: number, large: boolean): number {
  return textSizeFor(role, eyeDist, large) * 1000;
}

/** Radius of a panel in mm: 14 mm up to 30 cm wide, 20 mm above. */
export function radiusMm(widthM: number): number {
  return (widthM <= RADIUS.panel.smallUpTo ? RADIUS.panel.small : RADIUS.panel.large) * 1000;
}

/** Button height in mm: 44 mm at touch distance, 60 mm for a ray at 1 m and further. */
export function buttonMm(eyeDist: number): number {
  return (eyeDist >= 1 ? TARGET.buttonRay : TARGET.buttonTouch) * 1000;
}

export const LINE = TEXT.lineHeight;
