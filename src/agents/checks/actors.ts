/**
 * checkActors (PLAN "Правила проверок"): every participant the model names must be a
 * party of the case by name, surname or role from Party.aliases; otherwise the claim
 * is rejected with unknown-actor. Matching ignores case, punctuation and a leading
 * "the" ("the tenant" is the alias "tenant").
 */
import type { CheckedItem, Party } from '../types';
import { tokens } from '../../materials/normalize';

export type ActorsResult = Pick<CheckedItem, 'status' | 'reason'> & {
  status: 'accepted' | 'rejected';
  /** Party ids in the order named, without repeats. */
  ids: string[];
  /** The names that matched no party. */
  unknown: string[];
};

const key = (s: string): string => {
  const t = tokens(s);
  return (t[0] === 'the' ? t.slice(1) : t).join(' ');
};

/** A lookup from every name, alias and id of the parties to the party id. */
export function actorIndex(parties: readonly Party[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const p of parties) {
    for (const s of [p.id, p.name, ...p.aliases]) {
      const k = key(s);
      if (k && !index.has(k)) index.set(k, p.id);
    }
  }
  return index;
}

export function resolveActor(name: string, parties: readonly Party[] | Map<string, string>): string | null {
  const index = parties instanceof Map ? parties : actorIndex(parties);
  return index.get(key(name)) ?? null;
}

export function checkActors(actors: readonly string[], parties: readonly Party[] | Map<string, string>): ActorsResult {
  const index = parties instanceof Map ? parties : actorIndex(parties);
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const a of actors ?? []) {
    if (!a || !a.trim()) continue;
    const id = index.get(key(a));
    if (id) {
      if (!ids.includes(id)) ids.push(id);
    } else unknown.push(a);
  }
  return unknown.length ? { status: 'rejected', reason: 'unknown-actor', ids, unknown } : { status: 'accepted', ids, unknown };
}
