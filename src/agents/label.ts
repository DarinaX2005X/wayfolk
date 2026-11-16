/** The caption of a run: what answered and what ran now. */
import type { Answers, AnswerSet } from './types';

export function runLabel(answers: Answers, set: AnswerSet | null): string {
  if (answers === 'recorded') return `Recorded answers from a live run${set?.model ? ` (${set.model})` : ''}, checks run now`;
  if (answers === 'scripted') return 'Sample run with written answers, checks run now';
  return 'Live run: the model answers now, code checks every answer';
}
