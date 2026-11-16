/**
 * Late pages over a finished case (01.4.5): a run with scope { pages } on top of the
 * result. Stations Read, Extract, Check; only the new pages are read (a page whose text
 * was read before, known by its sha256, changes nothing); accepted events get a pass one
 * higher and join CaseResult.events; candidates pair only new events with old ones; one
 * reconcile call, shown at Check; no second look, so a rejected claim is dropped at
 * once; contradictions are resolved by code (resolve.ts); new ones get origin
 * 'late-pages'. The run is the same CaseRun as the first one (job.ts) with scope late;
 * this module holds what it reports: the note "2 new pages were read. 3 new events.
 * 1 contradiction resolved, 1 new." (saved in the run's partial under 'note').
 */
import type { Note } from '../../types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 new pages were read. 3 new events. 1 contradiction resolved, 1 new." */
export function lateNoteText(pages: number, events: number, resolved: number, added: number): string {
  if (pages === 0) return 'These pages were read before. Nothing changed in the chronology.';
  const head = `${plural(pages, 'new page was', 'new pages were')} read.`;
  if (events === 0 && resolved === 0 && added === 0) return `${head} Nothing changed in the chronology.`;
  const parts = [head, `${plural(events, 'new event', 'new events')}.`];
  if (resolved && added) parts.push(`${plural(resolved, 'contradiction', 'contradictions')} resolved, ${added} new.`);
  else if (resolved) parts.push(`${plural(resolved, 'contradiction', 'contradictions')} resolved.`);
  else if (added) parts.push(`${plural(added, 'new contradiction', 'new contradictions')}.`);
  return parts.join(' ');
}

export function lateNote(
  projectId: string,
  runId: string,
  pages: number,
  events: string[],
  contradictions: string[],
  resolved: string[],
  rejected: number,
  at: string,
): Note {
  return {
    id: `n_${runId}`,
    projectId,
    at,
    by: 'late-pages',
    kind: 'pages-read',
    text: lateNoteText(pages, events.length, resolved.length, contradictions.length),
    read: false,
    diff: { events, contradictions, resolved, rejected, pages },
  };
}

