/**
 * Talk without a live model: the resident's own story (intro, beats, secret) and the
 * prepared lines of their trade, chosen by what the person wants. What the person wants
 * comes from the choice they touched (its intent is known) or from a few words in typed
 * text. A voice clip cannot be understood here, so the resident asks for a touch reply.
 */
import { LINES } from './prepared';
import type { Intent, Reply, Resident } from './types';
import { GIFT_WORDS, TRADE_WORDS } from './words';

export type Choice = { text: string; intent: Intent };

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.floor(random() * list.length) % list.length];

/** What typed words most likely want. */
export function guessIntent(text: string, traveler: boolean): Intent {
  const t = text.toLowerCase();
  if (/\b(bye|goodbye|see you|good night|farewell|later|safe travels|go home|leave)\b/.test(t)) return 'leave';
  if (traveler && /\b(stay|live here|move in|settle|build|join us|your house|home here)\b/.test(t)) return 'stay';
  if (/\b(secret|hiding|hide|tell me something|mystery)\b/.test(t)) return 'secret';
  if (/\b(trip|travel|visit|holiday|go see|fly to|another island)\b/.test(t)) return 'trip';
  if (/\b(gift|present|for you|brought you|have this|take this)\b/.test(t)) return 'gift';
  return 'chat';
}

const CURIOUS = ['Tell me more', 'How did that happen?', 'What happened next?', 'Really? Why?', 'What do you love about it?'];

/** Three replies for the person: curious, the next step, goodbye. */
export function choicesFor(r: Resident, role: 'traveler' | 'resident' | 'guest', secretAllowed: boolean, random: () => number): Choice[] {
  const trade = TRADE_WORDS[r.trade];
  const curious: Choice = { text: random() < 0.4 ? `How did you start ${trade.work}?` : pick(CURIOUS, random), intent: 'chat' };
  let step: Choice;
  if (role === 'traveler') step = { text: pick(['Would you like to stay?', 'Stay and live here', 'We have room for you'], random), intent: 'stay' };
  else if (secretAllowed && !r.secretKnown) step = { text: pick(['Do you have a secret?', 'What are you hiding?'], random), intent: 'secret' };
  else if (role === 'resident' && random() < 0.5) step = { text: pick(['Want to visit another island?', 'Fancy a little trip?'], random), intent: 'trip' };
  else step = { text: pick(['What is new with you?', 'Tell me a story'], random), intent: 'chat' };
  const bye: Choice = { text: pick(role === 'traveler' ? ['Safe travels', 'Maybe another time'] : ['See you later', 'Talk soon', 'Good night'], random), intent: 'leave' };
  return [curious, step, bye];
}

export type OfflineInput = {
  resident: Resident;
  role: 'traveler' | 'resident' | 'guest';
  intent: Intent;
  audio: boolean;
  nextBeat: string | null;
  secretAllowed: boolean;
  random: () => number;
};

export type OfflineReply = { reply: Reply; toldBeat: boolean; toldSecret: boolean };

export function offlineReply(input: OfflineInput): OfflineReply {
  const { resident: r, role, random } = input;
  const lines = LINES[r.trade];
  let text: string;
  let toldBeat = false;
  let toldSecret = false;
  let intent: Intent = input.intent;
  let mood: Reply['mood'] = 'happy';
  if (input.audio) {
    text = 'The wind took your words before they reached me. Could you touch one of these instead?';
    intent = 'chat';
    mood = 'curious';
  } else {
    switch (intent) {
      case 'stay':
        if (role === 'traveler') {
          text = pick(lines.stay, random);
          mood = 'excited';
        } else {
          text = pick(lines.chat, random);
          intent = 'chat';
        }
        break;
      case 'leave':
        text = pick(lines.leave, random);
        break;
      case 'gift':
        text = `For me? I have a soft spot for ${GIFT_WORDS[r.likes[0] as keyof typeof GIFT_WORDS] ?? 'small things'}, but I will love anything you choose.`;
        mood = 'shy';
        break;
      case 'secret':
        if (input.secretAllowed) {
          text = r.story.secret;
          toldSecret = true;
          mood = 'shy';
        } else {
          text = pick(lines.hint, random);
          mood = 'shy';
        }
        break;
      case 'trip':
        text = role === 'resident' ? 'A trip? I would like that. Pick an island for me and I will pack a sandwich.' : 'I have only just arrived, but I like how you think.';
        if (role !== 'resident') intent = 'chat';
        mood = 'excited';
        break;
      default:
        if (input.nextBeat) {
          text = input.nextBeat;
          toldBeat = true;
          mood = 'curious';
        } else {
          text = pick(lines.chat, random);
        }
    }
  }
  const choices = choicesFor(r, role, input.secretAllowed && !toldSecret, random);
  return {
    reply: { text, choices: choices.map((c) => c.text), choiceIntents: choices.map((c) => c.intent), intent, mood, prepared: true },
    toldBeat,
    toldSecret,
  };
}

/** The first words of a conversation: the traveler's intro, or a greeting at home. */
export function greeting(r: Resident, role: 'traveler' | 'resident' | 'guest', secretAllowed: boolean, random: () => number): Reply {
  const text = role === 'traveler' ? r.story.intro : role === 'guest' ? `Hello. I came over from ${r.from?.islandName ?? 'my island'} for a little visit.` : pick(LINES[r.trade].greet, random);
  const choices = choicesFor(r, role, secretAllowed, random);
  return { text, choices: choices.map((c) => c.text), choiceIntents: choices.map((c) => c.intent), intent: 'chat', mood: 'happy', prepared: true };
}

/** Fill {name} / {island} in a prepared line. */
export const fill = (line: string, values: Record<string, string>): string => line.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? k);
