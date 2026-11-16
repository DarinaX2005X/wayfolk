/**
 * The hard cases of the extraction prompt (01.4.4): eight one-page inputs where models
 * usually go wrong, each with the properties a good answer has. The checks run the real
 * gate (verifyClaim) over the answer, so a property holds only for events that pass it.
 * The offline test feeds the example answers; 01.7.3 feeds one live answer per case and
 * edits the prompt until all eight hold:
 *
 *   import { loadCases, buildCaseMessages, casePropertyProblems } from 'tests/agents/prompt-cases/properties';
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { caseWindow } from '../../../src/agents/checks/date';
import { extractMessages } from '../../../src/agents/jobs/case/prompts';
import { extractSchema } from '../../../src/agents/jobs/case/schemas';
import { checkEnv, fillEvent, verifyClaim } from '../../../src/agents/jobs/case/verify';
import type { Block, CaseExtractAnswer, CasePlan, ChatMessage, Doc, DocMeta, JsonSchema, Page } from '../../../src/agents/types';
import { blockText } from '../../../src/materials/text';

export type PromptCase = {
  file: string;
  name: string;
  goal: string;
  plan: CasePlan;
  doc: DocMeta;
  page: { docId: string; n: number; blocks: Block[] };
  expect: {
    kinds?: { record?: number; account?: number };
    facts?: { field: string; value?: string; basis?: 'literal' | 'derived' }[];
    dates?: string[];
    minEvents?: number;
    maxEvents?: number;
    quoteOnce?: string;
    noQuoteContains?: string[];
    actorsByQuote?: { quote: string; actors: string[] }[];
  };
  example: CaseExtractAnswer;
};

const DIR = resolve(__dirname);

export function loadCases(): PromptCase[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((file) => ({ file, ...(JSON.parse(readFileSync(resolve(DIR, file), 'utf8')) as Omit<PromptCase, 'file'>) }));
}

export function casePage(c: PromptCase): Page {
  return { docId: c.page.docId, n: c.page.n, blocks: c.page.blocks, text: c.page.blocks.map(blockText).join('\n') };
}

export function caseDocs(c: PromptCase): Doc[] {
  return [{ meta: c.doc, pages: [casePage(c)] }];
}

/** The messages and schema the extractor gets for this case. */
export function buildCaseMessages(c: PromptCase): { messages: ChatMessage[]; schema: JsonSchema } {
  const pages = [casePage(c)];
  return {
    messages: extractMessages({ batch: 1, pages: [c.page.n, c.page.n] }, { plan: c.plan, docs: caseDocs(c), pages, goal: c.goal }),
    schema: extractSchema(c.plan),
  };
}

/** What is wrong with an answer for this case; [] when every property holds. */
export function casePropertyProblems(c: PromptCase, answer: unknown): string[] {
  const out: string[] = [];
  const pages = [casePage(c)];
  const env = checkEnv(c.plan, caseDocs(c), pages, caseWindow(pages, { [c.doc.id]: c.doc.date }));
  const claims = ((answer as { events?: unknown[] })?.events ?? []).map((e) => fillEvent(e as Record<string, never>));
  const kept: { id: string; page: number; quote: string }[] = [];
  const events = [];
  for (const [i, claim] of claims.entries()) {
    const v = verifyClaim(`c${i + 1}`, claim, env, kept, { batch: 1, pass: 1, status: 'verified' });
    if (v.status === 'rejected' || v.status === 'merged') {
      out.push(`event ${i + 1} "${claim.quote}" did not pass: ${v.item.reason}${v.detail ? ` (${v.detail})` : ''}`);
      continue;
    }
    if (v.factsRemoved) out.push(`event ${i + 1}: ${v.factsRemoved} fact(s) not supported by the quote`);
    kept.push({ id: v.event!.id, page: v.event!.source.page, quote: v.event!.quote });
    events.push(v.event!);
  }
  const e = c.expect;
  if (e.kinds?.record && events.filter((x) => x.kind === 'record').length < e.kinds.record) out.push(`fewer than ${e.kinds.record} record event(s)`);
  if (e.kinds?.account && events.filter((x) => x.kind === 'account').length < e.kinds.account) out.push(`fewer than ${e.kinds.account} account event(s)`);
  for (const f of e.facts ?? []) {
    const ok = events.some((x) => x.facts.some((y) => y.field === f.field && (f.value === undefined || y.value === f.value) && (f.basis === undefined || y.basis === f.basis)));
    if (!ok) out.push(`no checked fact ${f.field}${f.value ? ` = ${f.value}` : ''}${f.basis ? ` (${f.basis})` : ''}`);
  }
  for (const d of e.dates ?? []) if (!events.some((x) => x.at?.startsWith(d))) out.push(`no event dated ${d}`);
  if (e.minEvents !== undefined && events.length < e.minEvents) out.push(`fewer than ${e.minEvents} checked event(s)`);
  if (e.maxEvents !== undefined && claims.length > e.maxEvents) out.push(`more than ${e.maxEvents} event(s)`);
  if (e.quoteOnce && events.filter((x) => x.quote.toLowerCase().includes(e.quoteOnce!.toLowerCase())).length !== 1) out.push(`"${e.quoteOnce}" is not in exactly one event`);
  for (const s of e.noQuoteContains ?? []) if (claims.some((x) => x.quote.toLowerCase().includes(s.toLowerCase()))) out.push(`a quote contains "${s}"`);
  for (const a of e.actorsByQuote ?? []) {
    const hit = events.find((x) => x.quote.includes(a.quote));
    if (!hit) out.push(`no event quoting "${a.quote}"`);
    else if (JSON.stringify(hit.actors) !== JSON.stringify(a.actors)) out.push(`"${a.quote}": actors ${hit.actors.join(', ')} instead of ${a.actors.join(', ')}`);
  }
  return out;
}

export type { Page };
