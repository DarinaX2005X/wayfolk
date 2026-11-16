import { describe, expect, it } from 'vitest';
import { houseProblems } from '../../src/agents/checks/code/house';
import { checkProject } from '../../src/agents/checks/code/project';
import { dashProblems, formulaProblems, headingProblems, hypeProblems, proseProblems } from '../../src/agents/checks/prose';

const TEMPLATE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Marlow Street Bakery — bread and coffee</title><link rel="stylesheet" href="styles.css"></head>
<body><header><p class="eyebrow">Neighborhood bakery</p><h1>Marlow Street Bakery</h1></header>
<main><section id="menu"><h2>Our menu!</h2><p>Bread is baked every morning — starting at 4 am.</p><p>Open 7:00 am – 3:00 pm.</p></section>
<button class="order">Order now!</button><a href="#menu">Menu</a></main></body></html>`;
const TEMPLATE_CSS = `.eyebrow { text-transform: uppercase; letter-spacing: .2em; font-size: 12px }
h1 { font-family: "Playfair Display", Georgia, serif; }
h2 { background: linear-gradient(90deg, red, blue); -webkit-background-clip: text; background-clip: text; color: transparent }
body { font-family: system-ui, sans-serif }`;

const CLEAN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Marlow Street Bakery</title><link rel="stylesheet" href="styles.css"></head>
<body><header><h1>Marlow Street Bakery</h1><p>Bread baked every morning at 14 Marlow Street, open 7:00 am to 3:00 pm</p></header>
<main><section id="menu"><h2>Today's bread</h2><p>Country sourdough loaf, $7.50</p></section><button class="order">Call to order a cake</button><a href="#menu">Menu</a></main></body></html>`;
const CLEAN_CSS = `body { font-family: "Avenir Next", system-ui, sans-serif }
a:hover, .order:hover { color: #5b3a1e }
.order:active { transform: scale(.98) }
a:focus-visible, .order:focus-visible { outline: 2px solid #5b3a1e }
@media (max-width: 640px) { h1 { font-size: 48px } }`;

describe('house rules of a page', () => {
  it('finds the template habits: eyebrow, dashes, shouting, banned and serif faces, gradient text, no states, no phone layout', () => {
    const p = houseProblems([
      { path: 'index.html', text: TEMPLATE_HTML },
      { path: 'styles.css', text: TEMPLATE_CSS },
    ]);
    const page = (p.get('index.html') ?? []).map((x) => x.text).join('\n');
    const styles = (p.get('styles.css') ?? []).map((x) => x.text).join('\n');
    expect(page).toMatch(/Neighborhood bakery.*eyebrow/);
    expect(page).toMatch(/dash is used as punctuation/);
    expect(page).toMatch(/heading "Our menu!" has an exclamation/);
    expect(page).toMatch(/button "Order now!" has an exclamation/);
    expect(page).toMatch(/no viewport meta/);
    expect(page).not.toMatch(/7:00 am – 3:00/);
    expect(styles).toMatch(/Playfair/i);
    expect(styles).toMatch(/Gradient text/);
    expect(styles).toMatch(/Links have no :hover/);
    expect(styles).toMatch(/no :focus-visible/);
    expect(styles).toMatch(/No media query/);
    for (const x of [...(p.get('index.html') ?? []), ...(p.get('styles.css') ?? [])]) expect(x.reason).toBe('house-rule');
  });

  it('passes a page made by the rules', () => {
    const p = houseProblems([
      { path: 'index.html', text: CLEAN_HTML },
      { path: 'styles.css', text: CLEAN_CSS },
    ]);
    expect([...p.values()].flat()).toEqual([]);
  });

  it('runs inside the project check only when asked, and never breaks the load report', () => {
    const files = [
      { path: 'index.html', text: TEMPLATE_HTML },
      { path: 'styles.css', text: TEMPLATE_CSS },
    ];
    expect(checkProject(files).files.flatMap((f) => f.problems).filter((p) => p.reason === 'house-rule')).toEqual([]);
    const pc = checkProject(files, { house: true });
    expect(pc.files.flatMap((f) => f.problems).some((p) => p.reason === 'house-rule')).toBe(true);
    expect(pc.load.ok).toBe(true);
  });
});

describe('house rules of wording', () => {
  it('flags dashes as punctuation but not ranges', () => {
    expect(dashProblems('We bake at dawn — every day.')).toHaveLength(1);
    expect(dashProblems('Bread - baked daily')).toHaveLength(1);
    expect(dashProblems('Open 9–5, 2019–2024, 7:00 am – 3:00 pm, a well-known loaf')).toEqual([]);
  });
  it('flags hype, formulas and headings with full stops', () => {
    expect(hypeProblems('A seamless, magic way to plan')).toHaveLength(1);
    expect(formulaProblems("It's not a bottle, it's a companion.")).toHaveLength(1);
    expect(formulaProblems('Not just a bottle but a promise')).toHaveLength(1);
    expect(headingProblems('Why it matters.')).toHaveLength(1);
    expect(headingProblems('Why it matters')).toEqual([]);
    expect(proseProblems('The bottle keeps water cold for 24 hours, so a full day outside needs one refill.')).toEqual([]);
  });
});
