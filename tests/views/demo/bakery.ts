/**
 * Written answers of the bakery sample: what a good model answers, with the two kinds of
 * mistakes real models make (a price that isn't in the notes, a reworded quote, a page
 * that forgot a part the plan asked for). The engine checks them like any answer; the
 * generator (./build.ts) records them as an AnswerSet the app replays.
 */

export const BAKERY_PLAN = {
  understood: 'Ines wants a warm, simple one-page site for Marlow Street Bakery with the hours, the menu with prices and how to order a cake.',
  title: 'Marlow Street Bakery',
  deliverable: 'site',
  fit: 'yes',
  notDoable: '',
  instead: '',
  question: 'What should the top of the page lead with?',
  options: ['Hours and the menu', "The bakery's story"],
  object: 'house',
  objectWhy: 'A small shop on a corner: a site is its front door',
  windowFrom: '',
  windowTo: '',
  team: [],
  steps: [
    step('s1', 'research', 'Find the facts', 'Pull hours, prices, contact and the story out of the notes', ['materials'], { focus: 'Opening hours, every price, phone, address, special orders, the starter' }),
    step('s2', 'write-section', 'Write the copy', 'Write the welcome, the story line and the cake orders text', ['materials'], { sections: ['Welcome', 'Baked every morning', 'Cakes and special orders'] }),
    step('s3', 'write-code', 'Build the page', 'Write the one page and its styles in cream and dark brown', ['s1', 's2'], {
      files: [
        { path: 'index.html', purpose: 'The one page: hours, menu with prices, the story, how to order, contact' },
        { path: 'styles.css', purpose: 'Warm and simple: cream and dark brown, readable on a phone' },
      ],
      required: [
        { what: 'Opening hours', selector: '#hours' },
        { what: 'Menu with prices', selector: '#menu' },
        { what: 'How to order a cake', selector: '#order' },
        { what: 'Contact in the footer', selector: 'footer' },
      ],
    }),
    step('s4', 'review', 'Review the page', 'Read the page as a customer on a phone and list what is weak', ['s3']),
  ],
};

function step(id: string, kind: string, title: string, does: string, uses: string[], extra: Record<string, unknown> = {}) {
  return { id, kind, title, does, uses, focus: '', files: [], sections: [], columns: [], options: [], criteria: [], required: [], done: [], ...extra };
}

const F = (claim: string, quote: string) => ({ claim, quote, page: 1 });

/** The first answer of "Find the facts": two planted mistakes and one duplicate. */
export const BAKERY_FACTS = [
  F('Open Tuesday to Friday, 7:00 am to 3:00 pm', 'Tuesday to Friday: 7:00 am to 3:00 pm.'),
  F('Open Saturday and Sunday, 8:00 am to 2:00 pm', 'Saturday and Sunday: 8:00 am to 2:00 pm.'),
  F('Closed on Mondays', 'Closed on Mondays.'),
  F('A country sourdough loaf is $7.50', 'Country sourdough loaf: $7.50'),
  F('A seeded rye loaf is $8.00', 'Seeded rye loaf: $8.00'),
  F('A butter croissant is $3.75', 'Butter croissant: $3.75'),
  F('A cardamom bun is $4.25', 'Cardamom bun: $4.25'),
  F('A morning bun with orange zest is $4.00', 'Morning bun with orange zest: $4.00'),
  F('A sourdough focaccia slice is $4.50', 'Sourdough focaccia slice: $4.50'),
  F('Filter coffee is $2.75', 'Filter coffee: $2.75'),
  // Planted: a price the notes don't have.
  F('An oat milk latte is $4.95', 'Oat milk latte: $4.95'),
  F('Cakes and party bread need 48 hours notice', "Whole cakes and bread for parties need 48 hours' notice."),
  F('No orders by email yet', 'We do not take orders by email yet.'),
  F('Phone (555) 014-2290', 'Phone: (555) 014-2290'),
  F('At 14 Marlow Street, by the library', '14 Marlow Street, on the corner by the library'),
  // Planted: a quote in the model's own words.
  F('Everything is baked on site each morning from 4 am', 'Everything is baked fresh on site each morning from 4 am.'),
  F("Teo's starter has been alive since 2016", 'We use a sourdough starter that Teo has kept alive since 2016.'),
  F('Opened in 2019 by Ines and Teo Okafor', 'Ines Okafor opened it in 2019 with her brother Teo Okafor, who bakes the bread.'),
  F('Cardamom buns sell out by 11 am on weekends', 'The cardamom buns usually sell out by 11 am on weekends.'),
  // Duplicate of the croissant.
  F('Croissants cost $3.75', 'Butter croissant: $3.75'),
];

export const BAKERY_FACT_FIXES: Record<string, { claim: string; quote: string; page: number }> = {
  latte: F('An oat milk latte is $4.75', 'Oat milk latte: $4.75'),
  baked: F('Everything is baked on site every morning, from 4 am', 'Everything is baked on site every morning, starting at 4 am.'),
};

export const BAKERY_FACTS_SHORT = BAKERY_FACTS.filter((_, i) => [0, 1, 2, 3, 5, 6, 11, 13].includes(i));

export const BAKERY_SECTIONS = [
  {
    heading: 'Welcome',
    text: 'Marlow Street Bakery is a small neighborhood bakery at 14 Marlow Street, on the corner by the library. Come in for a loaf, a bun and a cup of coffee.',
  },
  {
    heading: 'Baked every morning',
    text: 'Everything is baked on site every morning, starting at 4 am. Teo bakes the bread with a sourdough starter he has kept alive since 2016.',
  },
  {
    heading: 'Cakes and special orders',
    text: "Whole cakes and bread for parties need 48 hours' notice. Call us on (555) 014-2290 or come by the counter. We don't take orders by email yet.",
  },
];

export const BAKERY_SECTIONS_SHORT = [
  { heading: 'Welcome', text: 'A small bakery at 14 Marlow Street, by the library.' },
  { heading: 'Baked every morning', text: "Baked on site from 4 am, with Teo's starter from 2016." },
  { heading: 'Cakes and special orders', text: "Cakes need 48 hours' notice. Call (555) 014-2290." },
];

export const BAKERY_SECTIONS_STYLE = [
  { heading: 'Welcome', text: 'Good morning from the corner by the library. Marlow Street Bakery has been baking at 14 Marlow Street since 2019.' },
  { heading: 'Baked every morning', text: 'The ovens go on at 4 am. Teo bakes every loaf with the sourdough starter he has fed since 2016.' },
  { heading: 'Cakes and special orders', text: "Planning a party? Give us 48 hours' notice for a whole cake or bread. Ring (555) 014-2290 or ask at the counter." },
];

const MENU: [string, string][] = [
  ['Country sourdough loaf', '$7.50'],
  ['Seeded rye loaf', '$8.00'],
  ['Butter croissant', '$3.75'],
  ['Cardamom bun', '$4.25'],
  ['Morning bun with orange zest', '$4.00'],
  ['Sourdough focaccia slice', '$4.50'],
  ['Filter coffee', '$2.75'],
  ['Oat milk latte', '$4.75'],
];

const menuItems = (indent: string) => MENU.map(([name, price]) => `${indent}<li><span class="item">${name}</span><span class="price">${price}</span></li>`).join('\n');

export function bakeryHtml(opts: { order?: boolean; short?: boolean; style?: boolean } = {}): string {
  const order = opts.order ?? true;
  const lead = opts.style
    ? 'Good morning from the corner by the library. Bread, buns and coffee, baked here since 2019.'
    : opts.short
      ? 'Bread, buns and coffee at 14 Marlow Street.'
      : 'A small neighborhood bakery at 14 Marlow Street, on the corner by the library. Everything is baked on site every morning.';
  const story = opts.short
    ? "<p>Baked on site from 4 am, with Teo's starter from 2016.</p>"
    : '<p>Everything is baked on site every morning, starting at 4 am. Teo bakes the bread with a sourdough starter he has kept alive since 2016.</p>';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Marlow Street Bakery</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body${opts.style ? ' class="morning"' : ''}>
  <header class="top">
    <p class="mark">Marlow Street Bakery</p>
    <nav>
      <a href="#hours">Hours</a>
      <a href="#menu">Menu</a>
      ${order ? '<a href="#order">Cakes</a>' : ''}
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>Marlow Street Bakery</h1>
      <p class="lead">${lead}</p>
    </section>
    <section id="hours" class="card">
      <h2>Hours</h2>
      <dl>
        <dt>Tuesday to Friday</dt><dd>7:00 am to 3:00 pm</dd>
        <dt>Saturday and Sunday</dt><dd>8:00 am to 2:00 pm</dd>
        <dt>Monday</dt><dd>Closed</dd>
      </dl>
    </section>
    <section id="menu" class="card">
      <h2>Menu</h2>
      <ul class="menu">
${menuItems('        ')}
      </ul>
      ${opts.short ? '' : '<p class="note">The cardamom buns usually sell out by 11 am on weekends.</p>'}
    </section>
    <section id="story" class="card">
      <h2>Baked every morning</h2>
      ${story}
    </section>
${
  order
    ? `    <section id="order" class="card">
      <h2>Cakes and special orders</h2>
      <p>Whole cakes and bread for parties need 48 hours' notice. Call us or come by the counter. We don't take orders by email yet.</p>
      <a class="call" href="tel:5550142290">Call (555) 014-2290</a>
    </section>
`
    : ''
}  </main>
  <footer>
    <p>Marlow Street Bakery, 14 Marlow Street</p>
    <p>Phone: (555) 014-2290</p>
  </footer>
</body>
</html>
`;
}

export function bakeryCss(opts: { style?: boolean } = {}): string {
  const cream = opts.style ? '#FBF3E6' : '#F6EEE1';
  const brown = opts.style ? '#4A2E1F' : '#3B2A20';
  const accent = opts.style ? '#B5652B' : '#9C5B2E';
  return `:root {
  --cream: ${cream};
  --paper: #FFFBF4;
  --brown: ${brown};
  --soft: #6E5A4C;
  --accent: ${accent};
  --line: #E4D6C2;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--cream);
  color: var(--brown);
  font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif;
  font-size: 18px;
  line-height: 1.55;
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  max-width: 960px;
  margin: 0 auto;
  padding: 20px 24px;
}

.mark { margin: 0; font-weight: 700; letter-spacing: 0.02em; }

nav a {
  color: var(--brown);
  margin-left: 18px;
  text-decoration: none;
  border-bottom: 1px solid transparent;
}

nav a:hover { border-bottom-color: var(--accent); }

main {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 24px 48px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}

.hero { grid-column: 1 / -1; padding: 48px 0 24px; }

.hero h1 {
  font-size: clamp(40px, 7vw, 72px);
  line-height: 1.02;
  margin: 0 0 16px;
  letter-spacing: -0.02em;
}

.lead { font-size: 21px; max-width: 34em; color: var(--soft); margin: 0; }

.card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: ${opts.style ? '22px' : '14px'};
  padding: 24px;
}

.card h2 { margin: 0 0 12px; font-size: 24px; }

dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin: 0; }
dt { color: var(--soft); }
dd { margin: 0; font-variant-numeric: tabular-nums; }

.menu { list-style: none; margin: 0; padding: 0; }

.menu li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px dotted var(--line);
}

.price { font-variant-numeric: tabular-nums; font-weight: 700; }

.note { color: var(--soft); font-size: 16px; margin: 12px 0 0; }

.call {
  display: inline-block;
  margin-top: 8px;
  padding: 12px 18px;
  border-radius: 999px;
  background: var(--brown);
  color: var(--paper);
  text-decoration: none;
}

footer {
  max-width: 960px;
  margin: 0 auto;
  padding: 24px;
  border-top: 1px solid var(--line);
  color: var(--soft);
  font-size: 16px;
}

footer p { margin: 4px 0; }

@media (max-width: 600px) {
  .top { flex-direction: column; align-items: flex-start; gap: 8px; }
  nav a { margin: 0 16px 0 0; }
}
`;
}

export const BAKERY_REVIEW = {
  verdict: 'The page answers the three things Ines asked for at a glance: hours, prices and how to order a cake.',
  issues: [
    { severity: 'minor', about: 'index.html', text: 'The menu has no headings for bread, pastry and coffee; a long list is harder to scan on a phone.' },
    { severity: 'minor', about: 'index.html', text: 'There is no map link for the address.' },
  ],
};
