/**
 * What each agent is told. Messages are built from the plan, the materials and earlier
 * outputs only; the same inputs give the same messages, so a recording's request hash
 * stays stable. Every prompt says what code will check, so the model knows a quote or a
 * price it invents will be caught.
 */
import type { ChatMessage, Doc, Page, Plan, PlanStep } from '../types';
import { OBJECTS, PLANNER_KINDS, STEP_LIBRARY } from './library';
import { houseRules } from './house-rules';

/** The house rules a step writes by (or, for a review, reads against). */
function rulesFor(step: PlanStep, plan: Plan): string {
  if (step.kind === 'write-code') return houseRules('site');
  if (step.kind === 'write-section') return houseRules('document');
  if (step.kind === 'make-plan') return houseRules('plan');
  if (step.kind === 'review') return `Read the work against these rules too, and name each one it breaks.\n${houseRules(plan.deliverable)}`;
  return '';
}

const SYSTEM_COMMON =
  'You are one of the agents of Groundwork, a workshop where agents do real work for a person. ' +
  'Answer only with JSON that fits the schema. Write in plain English. Never invent facts, names, prices, dates or quotes: ' +
  'code checks every quote, number and file you give before the person sees it, and sends back what fails.';

export type StepInputs = {
  goal: string;
  plan: Plan;
  step: PlanStep;
  /** Text of the steps this one uses, by step id. */
  inputs: { id: string; title: string; text: string }[];
  /** Pages when the step uses the materials. */
  pages: Page[];
  docs: Doc[];
  links: string[];
  answers: { question: string; answer: string }[];
  today: string;
  /** A person's instruction for a redo, and what the step gave before. */
  instruction?: string;
  before?: string;
  /** A step this one uses was redone with this instruction: `before` is this step's earlier answer. */
  upstream?: string;
};

export function materialsText(docs: readonly Doc[], pages: readonly Page[], perDoc = 12_000): string {
  const out: string[] = [];
  for (const d of docs) {
    const own = pages.filter((p) => p.docId === d.meta.id);
    if (!own.length) continue;
    out.push(`=== ${d.meta.title} (pages ${d.meta.from}–${d.meta.to}) ===`);
    let used = 0;
    for (const p of own) {
      if (used > perDoc) {
        out.push(`[pages from ${p.n} left out: too long]`);
        break;
      }
      out.push(`[p. ${p.n}]\n${p.text}`);
      used += p.text.length;
    }
  }
  return out.join('\n\n');
}

export function plannerMessages(input: { goal: string; docs: readonly Doc[]; links: readonly string[]; today: string; problems?: string[] }): ChatMessage[] {
  const library = PLANNER_KINDS.map((k) => `- ${k}: ${STEP_LIBRARY[k].does}`).join('\n');
  const objects = OBJECTS.map((o) => `- ${o.id}: ${o.means}`).join('\n');
  const files = input.docs.length
    ? input.docs.map((d) => `- ${d.meta.title} (${d.pages.length} page${d.pages.length === 1 ? '' : 's'}):\n${d.pages.map((p) => p.text).join('\n').slice(0, 1600)}`).join('\n\n')
    : '(no files)';
  const system =
    SYSTEM_COMMON +
    '\n\nYou are the Planner. Turn the person\'s goal into a plan of steps from the step library. ' +
    'Code reads the files first and puts the result together last; you plan the work in between.\n\n' +
    'Rules:\n' +
    '- Pick the deliverable: "site" for a web page or a web app (it gets a live preview), "document" for writing, "plan" for dated tasks with owners.\n' +
    '- 3 to 9 steps of your own. Use "uses" to say which earlier steps (or "materials") a step needs; steps that do not depend on each other run at the same time.\n' +
    '- With files, start with research so later steps work from checked facts with quotes. Without files, do not add research.\n' +
    '- For a site: write-code steps name their files; index.html first, then styles.css and app.js (a separate step or the same one). Plain HTML, CSS and JavaScript, no frameworks, no build step, no files that are not written by a step (no image files: use CSS and inline SVG). In "required" give 3–6 parts the page must have, as CSS selectors of elements written in index.html itself (not made by scripts), e.g. "#menu", "form#order", "footer".\n' +
    '- For a plan: give windowFrom and windowTo from the goal or files (or a sensible window starting after today), and the team: the people the goal or files name. Plan items must have owners from the team. One make-plan step writes all the items (8–16 of them); its extra columns are only what items need beyond task, owner, dates and dependencies (a money column when the goal or files give a budget). Add a decide step only when the goal asks for a choice.\n' +
    '- Add a review step before the end when the work is long enough to benefit from a second reader.\n' +
    '- question: ask only when the goal can honestly be read in very different ways; put the reading you assume first in options. Most goals need no question.\n' +
    '- fit: "no" only for what agents here cannot do at all (booking, buying, sending, deploying to someone\'s server); then say what can\'t be done and what you can make instead. "partly" when part of it can be done.\n' +
    '- object: pick the island object that means this project.\n' +
    '- Titles are short station signs (up to 18 characters), like "Find facts", "Build page", "Write copy".\n\n' +
    `Step library:\n${library}\n\nIsland objects:\n${objects}`;
  let user = `Today is ${input.today}.\n\nGoal: ${input.goal}\n\nFiles:\n${files}\n\nLinks: ${input.links.length ? input.links.join(', ') : '(none)'}`;
  if (input.problems?.length) user += `\n\nYour previous plan did not pass the check by code:\n${input.problems.map((p) => '- ' + p).join('\n')}\nFix these and answer again.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

const ROLE_INTRO: Record<string, string> = {
  researcher: 'You are the Researcher. You find facts in the materials and copy the exact words that say them.',
  analyst: 'You are the Analyst. You compare, decide and plan from the facts you are given.',
  writer: 'You are the Writer. You write clear, warm, concrete text from the facts you are given.',
  builder:
    'You are the Builder, a front-end developer and designer from a strong studio. You write production-quality files for a real product: ' +
    'semantic HTML, modern CSS (custom properties, grid, flexbox, clamp() type scale) and plain modern JavaScript without libraries. ' +
    'You design for this one subject, the way a studio would for a paying client, never from a template.',
  reviewer: 'You are the Reviewer, a critical colleague. You read the work and say plainly what is weak, wrong or missing.',
};

function kindRules(step: PlanStep, inputs: StepInputs): string {
  switch (step.kind) {
    case 'research':
      return (
        'List the facts this project needs (up to 20). For each: a short claim, the quote that says it copied character for character from the page ' +
        '(a whole sentence or line, at least 5 words, no "..." unless you skip words), and the page number shown as [p. N]. ' +
        'Every number, price, time and date in a claim must also be in its quote. One fact per claim; no duplicates.'
      );
    case 'compare':
      return 'Fill the table: one row per option and criterion. Values short. When the materials back a value, copy the exact words as the quote with its page; otherwise leave quote empty and page 0.';
    case 'decide':
      return (
        'Choose one option. Give reasons that rest on what you are given. In "from" put the ids of the facts, rows or items a reason relies on (the ids in square brackets), ' +
        'the id of a whole earlier step (like "s2"), or "goal" when it rests on the goal itself. Numbers in a reason must come from those.'
      );
    case 'write-section':
      return (
        `Write these sections: ${(step.args.sections ?? []).join('; ') || 'as the step says'}. ` +
        'Use only facts given to you; put the ids of the facts you use in "from". Every price, time, date and number you write must appear in those facts or in the materials, written the same way. ' +
        'If you quote the materials, use the exact words in double quotes. No placeholders, no "Lorem ipsum".'
      );
    case 'make-plan': {
      const cols = step.args.columns?.map((c) => `${c.name} (${c.type})`).join(', ');
      const w = inputs.plan.window ? `between ${inputs.plan.window.from} and ${inputs.plan.window.to}` : `starting after ${inputs.today}`;
      return (
        `Write the plan items (8–16 for a real plan). Dates are YYYY-MM-DD ${w}; an item ends on or after its start and starts after the items it depends on end. ` +
        `Owners are people of the team: ${inputs.plan.team.join(', ') || '(none named: use roles)'}. ` +
        (cols ? `Extra columns: ${cols}; give each item a value for each in "cells" (only these columns: task, owner and dates have their own fields). ` : 'Leave "cells" empty. ') +
        'When a column holds money, give totals for it, and use only amounts the goal or materials state.'
      );
    }
    case 'review':
      return 'Read the work you are given. List up to 8 issues, major first: wrong or missing things, weak spots, what a real user would trip on. Be concrete; name the file, section or item.';
    default:
      return '';
  }
}

export function stepMessages(i: StepInputs, extra = ''): ChatMessage[] {
  const role = STEP_LIBRARY[i.step.kind].role ?? 'writer';
  const rules = rulesFor(i.step, i.plan);
  const system = `${SYSTEM_COMMON}\n\n${ROLE_INTRO[role] ?? ''}\n\n${kindRules(i.step, i)}${rules ? `\n\n${rules}` : ''}`;
  const parts: string[] = [];
  parts.push(`Goal of the project: ${i.goal}`);
  parts.push(`The planner understood it as: ${i.plan.understood}`);
  parts.push(`Your step: ${i.step.title}: ${i.step.does}`);
  if (i.step.args.focus) parts.push(`Focus: ${i.step.args.focus}`);
  if (i.step.args.options?.length) parts.push(`Options: ${i.step.args.options.join('; ')}`);
  if (i.step.args.criteria?.length) parts.push(`Criteria: ${i.step.args.criteria.join('; ')}`);
  if (i.step.done.length) parts.push(`Done when:\n${i.step.done.map((d) => '- ' + d).join('\n')}`);
  if (i.answers.length) parts.push(`The person answered:\n${i.answers.map((a) => `- ${a.question} → ${a.answer}`).join('\n')}`);
  for (const inp of i.inputs) parts.push(`--- From step ${inp.id} (${inp.title}) ---\n${inp.text}`);
  if (i.pages.length) parts.push(`--- Materials ---\n${materialsText(i.docs, i.pages)}`);
  if (i.instruction) {
    parts.push(`--- Your earlier answer for this step ---\n${i.before ?? ''}`);
    parts.push(`The person looked at it and asks you to redo it: "${i.instruction}". Keep what they did not ask to change, and answer with the whole answer again, the parts that stay the same included.`);
  } else if (i.upstream && i.before) {
    parts.push(`--- Your earlier answer for this step ---\n${i.before}`);
    parts.push(`An earlier step was redone because the person asked: "${i.upstream}". Bring your answer in line with what changed there, and keep everything else as it was in your earlier answer (every feature, part and wording).`);
  }
  if (extra) parts.push(extra);
  return [
    { role: 'system', content: system },
    { role: 'user', content: parts.join('\n\n') },
  ];
}

export type FileTask = { path: string; purpose: string; all: { path: string; purpose: string }[]; written: { path: string; text: string }[]; required: { what: string; selector: string }[] };

export function fileExtra(f: FileTask): string {
  const lines: string[] = [];
  lines.push(`Write the file ${f.path}: ${f.purpose}.`);
  lines.push(`Files of the project: ${f.all.map((x) => `${x.path} (${x.purpose})`).join('; ')}. Refer only to these files; there are no images or other assets.`);
  if (/\.html?$/.test(f.path)) {
    lines.push(
      'Link the stylesheets and scripts of the project with relative paths (scripts with defer). Use a system font stack, no external fonts, scripts or CDNs. ' +
        'Write all visible text in full: no placeholders. Every in-page link (#id) must point at an id that exists.',
    );
    if (f.all.some((x) => /\.css$/.test(x.path))) lines.push('All styling lives in the CSS file of the project: no <style> block and no style attributes in the HTML.');
    if (f.all.some((x) => /\.m?js$/.test(x.path))) lines.push('All behaviour lives in the script file of the project: no inline <script> code and no onclick attributes.');
    if (f.required.length) lines.push(`index.html must contain these parts, written in the HTML itself:\n${f.required.map((r) => `- ${r.what}: ${r.selector}`).join('\n')}`);
  }
  if (/\.css$/.test(f.path)) lines.push('Style every class and id the HTML and the scripts below use, including the elements the scripts create. Make it look like a finished, polished product.');
  if (/\.m?js$/.test(f.path)) lines.push('Use only ids and classes the HTML below has (or elements this script creates). No libraries. Wrap start-up code so it runs after the page loads.');
  for (const w of f.written) lines.push(`--- ${w.path} (already written) ---\n${w.text}`);
  return lines.join('\n\n');
}

export function fixMessages(i: StepInputs, sent: { id: string; text: string; problems: string[] }[], what: string): ChatMessage[] {
  const extra =
    `Code checked your answer and sent back ${sent.length} ${what}. For each, either fix it (action "fix", the corrected ${what === 'file' || what === 'files' ? 'whole file' : 'unit'}) ` +
    'or withdraw it (action "withdraw") when it can\'t be backed by the materials.\n\n' +
    sent.map((s) => `--- ${s.id} ---\nProblems found by code:\n${s.problems.map((p) => '- ' + p).join('\n')}\nWhat you gave:\n${s.text}`).join('\n\n');
  return stepMessages({ ...i, instruction: undefined, upstream: undefined }, extra);
}
