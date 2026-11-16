/**
 * The base of every panel and the small controls (task 01.3.2): `Panel`, `Button`,
 * `Chip`, `Toggle`, `Counter`.
 *
 * Panels are written in code on @pmndrs/uikit (no UIKitML, no PanelUI). A panel keeps
 * its own state and composes its uikit tree from it; `set(patch)` recomposes. Every
 * live panel recomposes when the settings `highContrast` or `largeText` change, so a
 * switch on the settings panel is seen at once everywhere.
 *
 * Material: a bone face with a bent edge (the edge catches the light like the 6 mm thick
 * ceramic it stands for, without an extra draw call), radius 14 mm up to 30 cm, 20 mm
 * above; boards add a slate body with a 4 mm rim so they read on the sky; no
 * transparency. Layout units are millimetres.
 */
import { effect } from '@preact/signals-core';
import { Component, Container, Text } from '@pmndrs/uikit';
import type { InputKind } from '../../agents/types';
import { store } from '../../app/store';
import { MOTION, type TextRole } from '../../tokens/tokens';
import { onSelect } from '../../interact/select';
import { target as nameTarget } from '../../interact/targets';
import { buttonMm, radiusMm, uiTheme, type UiTheme } from './theme';
import { typeMm } from './text';
import { LEADING } from './text';
import { uiTicker, type PanelLike } from './root';

// ---------------------------------------------------------------- panels

const live = new Set<UiPanel<object>>();
let watching = false;

function watchSettings(): void {
  if (watching) return;
  watching = true;
  let last = '';
  effect(() => {
    const s = store.settings.value;
    const key = `${s.highContrast}|${s.largeText}`;
    if (last && key !== last) for (const p of [...live]) p.render();
    last = key;
  });
}

export type Composed = { w: number; h: number; style?: Record<string, unknown>; children: Component[] };

export abstract class UiPanel<S extends object> implements PanelLike {
  readonly el: Container;
  protected state: S;
  private w = 0;
  private h = 0;
  private offs: (() => void)[] = [];
  private alive = true;

  constructor(initial: S, name?: string) {
    this.state = initial;
    this.el = new Container({ flexDirection: 'column', flexShrink: 0 } as never);
    if (name) this.el.name = name;
    watchSettings();
    live.add(this as unknown as UiPanel<object>);
    // Subclasses must not rely on field initialisers inside compose(): they run after this.
    this.render();
  }

  get width(): number {
    return this.w;
  }
  get height(): number {
    return this.h;
  }
  /** Current state (read-only copy). */
  get value(): Readonly<S> {
    return this.state;
  }

  protected abstract compose(t: UiTheme): Composed;

  /** Changes the state and redraws. */
  set(patch: Partial<S>): this {
    this.state = { ...this.state, ...patch };
    this.render();
    return this;
  }

  /** Registers what to undo before the next composition (select handlers, tickers). */
  protected keep(off: () => void): void {
    this.offs.push(off);
  }

  render(): void {
    if (!this.alive) return;
    for (const off of this.offs.splice(0)) off();
    for (const child of [...this.el.children]) {
      if (child instanceof Component) {
        this.el.remove(child);
        child.dispose();
      }
    }
    const t = uiTheme();
    const c = this.compose(t);
    this.w = c.w;
    this.h = c.h;
    this.el.setProperties({ width: c.w, height: c.h, ...(c.style ?? {}) } as never);
    if (c.children.length) this.el.add(...c.children);
  }

  dispose(): void {
    this.alive = false;
    live.delete(this as unknown as UiPanel<object>);
    for (const off of this.offs.splice(0)) off();
    this.el.removeFromParent();
    this.el.dispose();
  }

  // -------- builders for subclasses

  protected text(s: string, role: TextRole, eye: number, t: UiTheme, o: { weight?: 400 | 700; color?: string; width?: number; align?: 'left' | 'center' | 'right' } = {}): Text {
    const { fontSize, lineHeight } = typeMm(role, eye, t.large);
    return new Text({
      text: s,
      fontSize,
      lineHeight: LEADING,
      fontWeight: o.weight ?? 400,
      color: o.color ?? t.text,
      width: o.width,
      textAlign: o.align ?? 'left',
      flexShrink: 0,
    } as never);
  }

  protected button(t: UiTheme, b: ButtonSpec): Container {
    const made = makeButton(t, b);
    if (made.off) this.keep(made.off);
    return made.el;
  }
}

/** The face of a panel: bone, a bent edge, the radius by width. */
export function faceStyle(t: UiTheme, widthMm: number, o: { padding?: number; gap?: number; paper?: boolean } = {}): Record<string, unknown> {
  return {
    backgroundColor: o.paper ? t.paper : t.face,
    borderRadius: radiusMm(widthMm / 1000),
    borderWidth: 1.5,
    borderColor: t.edge,
    borderBend: 0.6,
    padding: o.padding ?? 10,
    gap: o.gap ?? 6,
    flexDirection: 'column',
    alignItems: 'stretch',
  };
}

/** A slate body with a 4 mm rim around a bone face (boards on the sky). */
export function rimmed(t: UiTheme, widthMm: number, heightMm: number, face: Component[], o: { padding?: number; gap?: number } = {}): Container {
  const body = new Container({
    width: widthMm,
    height: heightMm,
    backgroundColor: t.body,
    borderRadius: radiusMm(widthMm / 1000),
    padding: 4,
    flexShrink: 0,
  } as never);
  const inner = new Container({ ...faceStyle(t, widthMm - 8, o), borderWidth: 0, borderRadius: radiusMm(widthMm / 1000) - 4, flexGrow: 1 } as never);
  if (face.length) inner.add(...face);
  body.add(inner);
  return body;
}

// ---------------------------------------------------------------- button

export type ButtonVariant = 'primary' | 'secondary' | 'text';
export type ButtonLook = 'rest' | 'hover' | 'pressed' | 'focus' | 'dwell' | 'disabled';

export type ButtonSpec = {
  label: string;
  variant?: ButtonVariant;
  /** Distance from the eyes: sets the text size and the height (44 mm near, 60 mm for rays at 1 m and further). */
  eye: number;
  role?: TextRole;
  onSelect?: (input: InputKind) => void;
  /** A disabled button shows its reason under itself and does not answer. */
  disabled?: string | null;
  /** Named target for scenarios and the first session. */
  target?: string;
  /** A fixed look for the gallery. */
  look?: ButtonLook;
  /** Fill of the dwell ring when `look` is 'dwell', 0…1. */
  dwell?: number;
  width?: number;
  grow?: boolean;
};

export function makeButton(t: UiTheme, b: ButtonSpec): { el: Container; off?: () => void } {
  const variant = b.variant ?? 'secondary';
  const height = buttonMm(b.eye);
  const role = b.role ?? 'read';
  const { fontSize, lineHeight } = typeMm(role, b.eye, t.large);
  const disabled = Boolean(b.disabled) || b.look === 'disabled';
  const look = b.look ?? 'rest';
  const bg = variant === 'primary' ? t.accent : variant === 'secondary' ? t.quiet : 'transparent';
  const fg = variant === 'primary' ? t.onAccent : variant === 'secondary' ? t.text : t.accentText;
  const lift = MOTION.spring.press;

  const wrap = new Container({ flexDirection: 'column', alignItems: 'stretch', gap: 3, flexShrink: 0, flexGrow: b.grow ? 1 : 0, width: b.width } as never);
  // The focus ring: 3 mm of cobalt drawn on the button's own edge, so focus never moves the layout.
  const ring = new Container({ flexDirection: 'column', alignItems: 'stretch' } as never);
  const face = new Container({
    height,
    paddingX: Math.max(8, fontSize * 0.7),
    borderRadius: 8,
    backgroundColor: bg === 'transparent' ? undefined : bg,
    borderWidth: look === 'focus' ? 3 : variant === 'secondary' ? 1.5 : 0,
    borderColor: look === 'focus' ? (variant === 'primary' ? t.onAccent : t.accent) : t.edge,
    borderBend: variant === 'text' ? 0 : 0.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: disabled ? 0.4 : 1,
    transformTranslateZ: look === 'hover' ? 4 : 0,
    transformScaleX: look === 'pressed' ? lift : 1,
    transformScaleY: look === 'pressed' ? lift : 1,
    // uikit cannot take `hover: undefined`: a disabled button simply has no conditional styles.
    ...(disabled ? {} : { cursor: 'pointer', hover: { transformTranslateZ: 4 }, active: { transformScaleX: lift, transformScaleY: lift } }),
    positionType: 'relative',
  } as never);
  face.add(new Text({ text: b.label, fontSize, lineHeight: LEADING, fontWeight: 700, color: fg } as never));
  if (look === 'dwell') {
    // Dwell fills a bar along the bottom of the button for the gallery state.
    face.add(
      new Container({
        positionType: 'absolute',
        positionLeft: 0,
        positionBottom: 0,
        height: 3,
        width: `${Math.round((b.dwell ?? 0.6) * 100)}%`,
        backgroundColor: variant === 'primary' ? t.onAccent : t.accent,
      } as never),
    );
  }
  ring.add(face);
  wrap.add(ring);
  if (b.disabled) {
    const reason = typeMm('label', b.eye, t.large);
    wrap.add(new Text({ text: b.disabled, fontSize: reason.fontSize, lineHeight: LEADING, color: t.soft } as never));
  }
  if (b.target) nameTarget(b.target, face);
  if (!b.onSelect || disabled) return { el: wrap };
  const off = onSelect(face, (input) => b.onSelect?.(input), { poke: true, enabled: () => !disabled });
  return { el: wrap, off };
}

/** A single button on its own (the gallery). */
export class Button extends UiPanel<ButtonSpec> {
  protected compose(t: UiTheme): Composed {
    const { fontSize } = typeMm(this.state.role ?? 'read', this.state.eye, t.large);
    const w = this.state.width ?? Math.ceil(this.state.label.length * fontSize * 0.55 + fontSize * 1.6 + 10);
    const reason = this.state.disabled ? typeMm('label', this.state.eye, t.large).lineHeight + 3 : 0;
    return { w, h: buttonMm(this.state.eye) + reason, children: [this.button(t, { ...this.state, width: w })] };
  }
}

// ---------------------------------------------------------------- chip, toggle

export type ChipTone = 'plain' | 'accent' | 'ok' | 'wait' | 'danger';

export function chip(t: UiTheme, label: string, eye: number, tone: ChipTone = 'plain'): Container {
  const { fontSize, lineHeight } = typeMm('label', eye, t.large);
  const bg = tone === 'accent' ? t.accent : tone === 'ok' ? t.ok : tone === 'wait' ? t.wait : tone === 'danger' ? t.danger : t.quiet;
  const fg = tone === 'accent' ? t.onAccent : tone === 'plain' ? t.text : tone === 'wait' ? '#1E2421' : t.hc ? '#111513' : '#FBF8F1';
  const c = new Container({
    paddingX: fontSize * 0.5,
    height: lineHeight + 4,
    borderRadius: 6,
    backgroundColor: bg,
    borderWidth: tone === 'plain' ? 1 : 0,
    borderColor: t.edge,
    alignItems: 'center',
    flexShrink: 0,
  } as never);
  c.add(new Text({ text: label, fontSize, lineHeight: LEADING, fontWeight: 700, color: fg } as never));
  return c;
}

export class Chip extends UiPanel<{ label: string; eye: number; tone?: ChipTone }> {
  protected compose(t: UiTheme): Composed {
    const { fontSize, lineHeight } = typeMm('label', this.state.eye, t.large);
    return { w: Math.ceil(this.state.label.length * fontSize * 0.56 + fontSize + 4), h: lineHeight + 4, children: [chip(t, this.state.label, this.state.eye, this.state.tone)] };
  }
}

export type ToggleSpec = { label: string; on: boolean; eye: number; target?: string; onChange?: (on: boolean) => void; look?: ButtonLook };

/** One row with a label and a switch: the knob sits right and turns cobalt when on. */
export function toggleRow(t: UiTheme, s: ToggleSpec, width: number): { el: Container; off?: () => void } {
  const { fontSize, lineHeight } = typeMm('read', s.eye, t.large);
  const h = buttonMm(s.eye);
  const row = new Container({
    width,
    height: h,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingX: 8,
    borderRadius: 8,
    backgroundColor: s.look === 'hover' ? t.quiet : undefined,
    borderWidth: s.look === 'focus' ? 3 : 0,
    borderColor: t.accent,
    hover: { backgroundColor: t.quiet },
    cursor: 'pointer',
    flexShrink: 0,
  } as never);
  row.add(new Text({ text: s.label, fontSize, lineHeight: LEADING, color: t.text } as never));
  const track = new Container({
    width: h * 0.9,
    height: h * 0.5,
    borderRadius: h * 0.25,
    backgroundColor: s.on ? t.accent : t.edge,
    padding: 3,
    flexDirection: 'row',
    justifyContent: s.on ? 'flex-end' : 'flex-start',
  } as never);
  track.add(new Container({ width: h * 0.5 - 6, height: h * 0.5 - 6, borderRadius: h * 0.25, backgroundColor: s.on ? t.onAccent : t.face } as never));
  row.add(track);
  if (s.target) nameTarget(s.target, row);
  if (!s.onChange) return { el: row };
  const off = onSelect(row, () => s.onChange?.(!s.on), { poke: true });
  return { el: row, off };
}

export class Toggle extends UiPanel<ToggleSpec & { width: number }> {
  protected compose(t: UiTheme): Composed {
    const made = toggleRow(t, { ...this.state, onChange: (on) => (this.state.onChange?.(on), this.set({ on })) }, this.state.width);
    if (made.off) this.keep(made.off);
    return { w: this.state.width, h: buttonMm(this.state.eye), children: [made.el] };
  }
}

// ---------------------------------------------------------------- counter

/**
 * A number that catches up with its value no faster than 20 units a second (DESIGN
 * "Слои и движение"), in tabular figures, with a unit after it on the same line. Under
 * "Less motion" it jumps. It never delays anything: the value is already true; only the
 * figure catches up.
 */
export class Counter extends UiPanel<{ value: number; unit?: string; eye: number; role?: TextRole; unitRole?: TextRole; shown?: number }> {
  private shownValue = 0;
  private figure: Text | null = null;
  private stop: (() => void) | null = null;

  constructor(s: { value: number; unit?: string; eye: number; role?: TextRole; unitRole?: TextRole; shown?: number }) {
    super(s);
    this.shownValue = s.shown ?? s.value;
    this.render();
    this.stop = uiTicker((ms) => this.step(ms));
  }

  /** Sets the true value; the figure rolls toward it. */
  to(value: number): void {
    this.state = { ...this.state, value };
    if (store.settings.peek().lessMotion) {
      this.shownValue = value;
      this.figure?.setProperties({ text: String(Math.round(value)) } as never);
    }
  }

  /** The figure at an instant: the gallery's time slider. */
  at(seconds: number, from = 0): void {
    const span = Math.abs(this.state.value - from);
    const k = Math.min(1, (seconds * MOTION.queue.counterPerSecond) / Math.max(1, span));
    this.shownValue = from + (this.state.value - from) * k;
    this.figure?.setProperties({ text: String(Math.round(this.shownValue)) } as never);
  }

  get shown(): number {
    return Math.round(this.shownValue);
  }

  private step(ms: number): void {
    const target = this.state.value;
    if (this.shownValue === target) return;
    const step = (MOTION.queue.counterPerSecond * ms) / 1000;
    const d = target - this.shownValue;
    this.shownValue = Math.abs(d) <= step ? target : this.shownValue + Math.sign(d) * step;
    this.figure?.setProperties({ text: String(Math.round(this.shownValue)) } as never);
  }

  protected compose(t: UiTheme): Composed {
    const role = this.state.role ?? 'view';
    const big = typeMm(role, this.state.eye, t.large);
    const small = typeMm(this.state.unitRole ?? 'read', this.state.eye, t.large);
    const row = new Container({ flexDirection: 'row', alignItems: 'baseline', gap: small.fontSize * 0.35 } as never);
    this.figure = new Text({ text: String(Math.round(this.shownValue ?? this.state.value)), fontSize: big.fontSize, lineHeight: LEADING, fontWeight: 700, color: t.text } as never);
    row.add(this.figure);
    if (this.state.unit) row.add(new Text({ text: this.state.unit, fontSize: small.fontSize, lineHeight: LEADING, color: t.soft } as never));
    const w = Math.ceil(4 * big.fontSize * 0.6 + (this.state.unit ? this.state.unit.length * small.fontSize * 0.55 + small.fontSize : 0));
    return { w, h: big.lineHeight, children: [row] };
  }

  override dispose(): void {
    this.stop?.();
    super.dispose();
  }
}
