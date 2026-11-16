/**
 * Written answers of the habit tracker and the launch plan samples (see ./bakery.ts).
 */

function step(id: string, kind: string, title: string, does: string, uses: string[], extra: Record<string, unknown> = {}) {
  return { id, kind, title, does, uses, focus: '', files: [], sections: [], columns: [], options: [], criteria: [], required: [], done: [], ...extra };
}

const planBase = { fit: 'yes', notDoable: '', instead: '', question: '', options: [], windowFrom: '', windowTo: '', team: [] as string[] };

// ---------------------------------------------------------------- habit tracker

export const HABIT_PLAN = {
  ...planBase,
  understood: 'A small web app to add habits, tick them off each day, see streaks, and keep it all in local storage.',
  title: 'Habit tracker',
  deliverable: 'site',
  object: 'toolbox',
  objectWhy: 'An app is a tool you use every day',
  steps: [
    step('s1', 'decide', 'Choose the model', 'Decide how habits and days are stored', [], {
      options: ['One list of habits with a set of done days each', 'A log of every tick'],
      criteria: ['Simple to count a streak', 'Small in local storage'],
    }),
    step('s2', 'write-code', 'Build the app', 'Write the page, the styles and the script', ['s1'], {
      files: [
        { path: 'index.html', purpose: 'The app page: a form to add a habit and the list of habits' },
        { path: 'styles.css', purpose: 'A calm, readable look that works on a phone' },
        { path: 'app.js', purpose: 'Add habits, tick today, count streaks, save to local storage' },
      ],
      required: [
        { what: 'Form to add a habit', selector: 'form#add' },
        { what: 'List of habits', selector: '#habits' },
      ],
    }),
    step('s3', 'review', 'Try it as a user', 'Use the app as a first-time user and list what trips you', ['s2']),
  ],
};

export const HABIT_DECISION = {
  choice: 'One list of habits with a set of done days each',
  reasons: [
    { text: 'A streak is counted by walking back from today through the set of done days.', from: [] },
    { text: 'Each habit stores only its name and its days, so the saved data stays small.', from: [] },
  ],
  risks: ['Days are stored as local dates, so travel across time zones can shift a tick.'],
};

export const HABIT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Habits</title>
  <link rel="stylesheet" href="styles.css">
  <script src="app.js" defer></script>
</head>
<body>
  <main class="app">
    <header>
      <h1>Habits</h1>
      <p id="today" class="today"></p>
    </header>
    <form id="add" class="add">
      <label for="name">New habit</label>
      <div class="row">
        <input id="name" name="name" placeholder="Read for ten minutes" autocomplete="off" required>
        <button type="submit">Add</button>
      </div>
    </form>
    <ul id="habits" class="habits"></ul>
    <p id="empty" class="empty">No habits yet. Add the first one above.</p>
  </main>
</body>
</html>
`;

export const HABIT_CSS = `:root { --ink: #1D2430; --soft: #5B6577; --line: #DDE2EA; --accent: #2E57C9; --done: #2F7D4F; --bg: #F5F7FA; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.app { max-width: 520px; margin: 0 auto; padding: 32px 20px; }
h1 { margin: 0; font-size: 34px; letter-spacing: -0.02em; }
.today { margin: 4px 0 24px; color: var(--soft); }
.add label { display: block; font-weight: 700; margin-bottom: 6px; }
.row { display: flex; gap: 8px; }
input { flex: 1; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; font: inherit; }
button { padding: 12px 18px; border: 0; border-radius: 10px; background: var(--accent); color: #fff; font: inherit; font-weight: 700; cursor: pointer; }
.habits { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 10px; }
.habit { display: flex; align-items: center; gap: 12px; padding: 14px; background: #fff; border: 1px solid var(--line); border-radius: 12px; }
.habit .name { flex: 1; }
.habit .streak { color: var(--soft); font-variant-numeric: tabular-nums; }
.tick { width: 36px; height: 36px; border-radius: 50%; border: 2px solid var(--line); background: #fff; padding: 0; }
.habit.done .tick { background: var(--done); border-color: var(--done); }
.empty { color: var(--soft); }
`;

const habitJs = (listId: string) => `(function () {
  var KEY = 'habits.v1';
  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
  }
  function save(habits) { localStorage.setItem(KEY, JSON.stringify(habits)); }
  function day(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function streak(h) {
    var n = 0;
    var d = new Date();
    while (h.days.indexOf(day(d)) >= 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  function render() {
    var habits = load();
    var list = document.getElementById('${listId}');
    var empty = document.getElementById('empty');
    var today = day(new Date());
    list.innerHTML = '';
    empty.hidden = habits.length > 0;
    habits.forEach(function (h, i) {
      var li = document.createElement('li');
      li.className = 'habit' + (h.days.indexOf(today) >= 0 ? ' done' : '');
      var tick = document.createElement('button');
      tick.className = 'tick';
      tick.setAttribute('aria-label', 'Done today: ' + h.name);
      tick.addEventListener('click', function () {
        var all = load();
        var at = all[i].days.indexOf(today);
        if (at >= 0) all[i].days.splice(at, 1); else all[i].days.push(today);
        save(all);
        render();
      });
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = h.name;
      var s = document.createElement('span');
      s.className = 'streak';
      var n = streak(h);
      s.textContent = n === 1 ? '1 day' : n + ' days';
      li.append(tick, name, s);
      list.append(li);
    });
  }
  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('today').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('add').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = document.getElementById('name');
      var name = input.value.trim();
      if (!name) return;
      var all = load();
      all.push({ name: name, days: [] });
      save(all);
      input.value = '';
      render();
    });
    render();
  });
})();
`;

/** The planted mistake: the script looks for a list id the page doesn't have. */
export const HABIT_JS_BROKEN = habitJs('habit-list');
export const HABIT_JS = habitJs('habits');

export const HABIT_REVIEW = {
  verdict: 'The app does the three things asked: add, tick today, see a streak, and it keeps them after a reload.',
  issues: [
    { severity: 'minor', about: 'app.js', text: 'There is no way to delete a habit.' },
    { severity: 'minor', about: 'index.html', text: 'Past days cannot be ticked, so a missed evening breaks a streak.' },
  ],
};

// ---------------------------------------------------------------- launch plan

export const LAUNCH_PLAN = {
  ...planBase,
  understood: 'Maya wants a dated launch plan for Fernway with owners from the team and the budget split.',
  title: 'Fernway launch plan',
  deliverable: 'plan',
  object: 'chart',
  objectWhy: 'A plan over weeks, like a chart of time',
  windowFrom: '2027-01-04',
  windowTo: '2027-02-19',
  team: ['Maya Lindqvist', 'Sam Okoro', 'Priya Raman', 'Leo Martins'],
  steps: [
    step('s1', 'research', 'Find the facts', 'Pull dates, people, budget lines and the must-haves out of the brief', ['materials']),
    step('s2', 'make-plan', 'Make the plan', 'Lay out the launch work with owners, dates and costs', ['s1'], { columns: [{ name: 'Cost', type: 'money' }] }),
    step('s3', 'review', 'Review the plan', 'Read the plan as the launch lead and list the risks', ['s2']),
  ],
};

const L = (claim: string, quote: string) => ({ claim, quote, page: 1 });
export const LAUNCH_FACTS = [
  L('Public launch is on Tuesday 9 February 2027', 'Public launch on Tuesday 9 February 2027.'),
  L('Launch work runs 4 January to 19 February 2027', 'All launch work happens between 4 January 2027 and 19 February 2027'),
  L('Maya owns the launch and the go/no-go call', 'Maya Lindqvist: product lead, owns the launch and the go/no-go call'),
  L('Sam owns the app, fixes and the release', 'Sam Okoro: developer, owns the app, fixes and the release'),
  L('Priya owns the landing page and the store images', 'Priya Raman: designer, owns the landing page and the store images'),
  L('Leo owns the newsletter, the posts and the launch day', 'Leo Martins: marketing, owns the newsletter, the posts and the launch day'),
  L('The total budget is $3,000', 'Total launch budget: $3,000.'),
  L('Landing page design and copy cost $600', 'Landing page design and copy: $600'),
  // Planted: a sum the brief doesn't state.
  L('Paid posts cost $1,800', 'Paid posts in the first two weeks: $1,800'),
  L('Beta gifts cost $400', 'Beta tester thank-you gifts: $400'),
  L('The launch event costs $500', 'Launch day event (online): $500'),
  L('A closed beta of about 30 testers runs for two weeks', 'A closed beta with about 30 testers for two weeks before launch.'),
];
export const LAUNCH_FACT_FIX = L('Paid posts cost $1,500', 'Paid posts in the first two weeks: $1,500');

const I = (id: string, task: string, owner: string, start: string, end: string, depends: string[], cost = '') => ({ id, task, owner, start, end, depends, cells: cost ? [{ column: 'Cost', value: cost }] : [] });
export const LAUNCH_ITEMS = [
  I('i1', 'Invite about 30 beta testers', 'Maya Lindqvist', '2027-01-04', '2027-01-08', []),
  I('i2', 'Closed beta, two weeks', 'Sam Okoro', '2027-01-11', '2027-01-22', ['i1'], '$400'),
  I('i3', 'Design and write the landing page', 'Priya Raman', '2027-01-11', '2027-01-27', [], '$600'),
  I('i4', 'Fix the bugs the beta finds', 'Sam Okoro', '2027-01-25', '2027-02-03', ['i2']),
  I('i5', 'Landing page with sign-up form goes live', 'Priya Raman', '2027-01-28', '2027-02-02', ['i3']),
  I('i6', 'Store images', 'Priya Raman', '2027-01-25', '2027-02-01', []),
  I('i7', 'Go/no-go call', 'Maya Lindqvist', '2027-02-04', '2027-02-04', ['i4']),
  I('i8', 'Release the app', 'Sam Okoro', '2027-02-08', '2027-02-09', ['i7']),
  I('i9', 'Newsletter to the waiting list', 'Leo Martins', '2027-02-09', '2027-02-09', ['i8']),
  I('i10', 'Launch post and online launch event', 'Leo Martins', '2027-02-09', '2027-02-09', ['i8'], '$500'),
  I('i11', 'Paid posts, first two weeks', 'Leo Martins', '2027-02-09', '2027-02-19', ['i8'], '$1,500'),
  I('i12', 'Follow-up post', 'Leo Martins', '2027-02-16', '2027-02-16', ['i10']),
  I('i13', 'Review the numbers', 'Maya Lindqvist', '2027-02-16', '2027-02-19', ['i8']),
];
export const LAUNCH_TOTALS = [{ column: 'Cost', value: '$3,000' }];

export const LAUNCH_REVIEW = {
  verdict: 'The plan fits the window and every must-have from the brief has an owner and dates.',
  issues: [
    { severity: 'major', about: 'i4', text: 'Bug fixing ends five days before the release: one bad beta week leaves no slack.' },
    { severity: 'minor', about: 'i9', text: 'The newsletter has no draft step before launch day.' },
  ],
};
