/**
 * The instructions the model gets for each job of the mind. The world, the house style
 * and the rules live here once; each builder adds only the facts of its job. Facts the
 * person or another island supplied go in the user message as data, never as rules.
 */
import type { ChatMessage } from '../../api/_lib/contracts';
import type { GiftKind, IslandState, Resident } from './types';
import { GIFT_WORDS, TRADE_WORDS } from './words';
import type { TravelerAsk } from './schema';

export const WORLD = `Wayfolk is a cozy world for a person wearing a VR headset. They sit on the edge of their own small island floating in a sea of clouds at sunset. Little birds live with them; the lead bird is Pip. Travelers drift in out of the clouds by balloon, paper boat, kite, cloud whale, umbrella or lantern. Travelers are small stylized animals with a trade. If the person invites one to stay, the birds build them a house on the island. Islands float far apart; residents sometimes visit other islands and come back with stories.`;

export const STYLE = `House style: warm, specific and a little funny. Use concrete small objects, habits, sounds and smells that belong to this one character instead of adjectives, and avoid stock props every character could have. Characters have one odd habit and a soft spot. Plain English a ten-year-old understands, short sentences, no exclamation marks, no emojis, no stage directions. Nothing generic: avoid words like mystical, whimsical, ancient, realm, journey, magical. Family friendly, never dark or sad for long. No real people, brands, places, films, games or technology from our world; no phones, internet or AI. The world has clouds, wind, stars, islands, birds, rain, tea, bread, music and small handmade things.
Good: "I knit socks for the wind. It never wears them, but it does slow down to look."
Flat: "I am a passionate knitter who loves creating cozy things for everyone."
Do not borrow from these two examples.`;

const clock = (now: number): string => {
  const h = new Date(now).getHours();
  if (h >= 21 || h < 5) return 'night, stars out';
  if (h < 11) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening, sunset';
};

const residentsLine = (island: IslandState): string =>
  island.residents.length === 0
    ? 'Nobody lives on the island yet.'
    : `Living on the island: ${island.residents.map((r) => `${r.name} the ${r.species} (${TRADE_WORDS[r.trade].person})`).join(', ')}.`;

// ------------------------------------------------------------------ traveler

export function travelerMessages(ask: TravelerAsk, island: IslandState, now: number): ChatMessage[] {
  const trade = TRADE_WORDS[ask.trade];
  return [
    {
      role: 'system',
      content: `${WORLD}\n\n${STYLE}\n\nYou invent one new traveler and answer only with JSON in the given schema. Rules:
- species, trade and vehicle are given; keep them exactly.
- name: one or two short words, a little unusual, easy to say aloud, fits the animal; not a common pet name.
- tagline: up to six words that make you want to meet them.
- personality: two sentences, how they talk and one habit or quirk. This steers how they speak later.
- voice: pitch 0.7 to 1.4 (small animals higher), rate 0.8 to 1.25, timbre that fits.
- colors: main is a natural fur or feather color for the animal, accent a friendly color for a scarf, apron or hat.
- likes: two or three gifts they love, chosen to fit their trade and story.
- story.intro: what they say stepping onto the pier, first person, at most two short sentences and under 35 words: who they are and why the wind brought them here.
- story.beats: four to six beats in first person, each one or two short sentences and under 35 words. One beat is told per visit, so each must stand on its own and add something new; together they slowly lead toward the secret.
- story.secret: one or two short sentences under 35 words, tender or funny, the kind of thing you tell a friend. Never dark.
- house: colors for their ${trade.place} (wall, roof, trim, pleasant together), a door sign of one to three words, one to three props.`,
    },
    {
      role: 'user',
      content: `Island: ${island.name}. ${residentsLine(island)} Time: ${clock(now)}.
New traveler: a ${ask.species}, a ${trade.person}, arriving by ${ask.vehicle.replace('-', ' ')}.
Names already used, do not reuse: ${ask.avoidNames.length ? ask.avoidNames.join(', ') : 'none'}.`,
    },
  ];
}

// ------------------------------------------------------------------ talk

export type Turn = { who: 'person' | 'resident'; text: string };

export type TalkContext = {
  resident: Resident;
  island: IslandState;
  /** The traveler is still at the pier and may be invited to stay. */
  traveler: boolean;
  /** A guest from another island. */
  guest: boolean;
  turns: Turn[];
  /** The next story beat, if it has not been told this visit. */
  nextBeat: string | null;
  secretAllowed: boolean;
  now: number;
  /** Text the person typed or touched; absent when the person spoke (audio). */
  text?: string;
};

export function talkMessages(c: TalkContext): ChatMessage[] {
  const r = c.resident;
  const trade = TRADE_WORDS[r.trade];
  const where = c.traveler
    ? `You just stepped off your ${r.vehicle.replace('-', ' ')} onto the pier of the person's island. You would like to stay if they ask kindly; if they invite you, say yes warmly and ask where your ${trade.place} could go.`
    : c.guest
      ? `You are visiting this island from ${r.from?.islandName ?? 'another island'} for a little while.`
      : `You live on this island in your ${trade.place}. The person is your neighbor and friend.`;
  const told = r.story.beats.slice(0, r.story.revealed);
  const memory = r.memory.slice(-6).map((m) => `- ${m.text}`).join('\n');
  const secret = c.secretAllowed
    ? `Your secret, which you may now tell if the person asks about it or it fits naturally: ${r.story.secret}`
    : `You have a secret you do not tell yet. If asked, hint at it gently and say maybe another time.`;
  const system = `${WORLD}\n\n${STYLE}\n\nYou are ${r.name}, a ${r.species} and ${trade.person}. ${r.personality}
${where}
Speak only as ${r.name}: one or two short sentences, under 30 words, in your own voice. Always answer the person's latest words first and directly: if they invite you to stay, accept warmly; if they ask something, answer it; if they tell you something, react to it. Ask a small question back now and then. You know only this world. If the person is unkind or asks for something unsafe or from our world, gently steer back to the island.
The person answers by voice or by touching one of three short replies that you suggest.

Answer only with JSON in the given schema:
- heard: what the person said, written out exactly (from the audio if there is audio). Empty if nothing clear was said.
- text: your answer. If nothing clear was heard, say kindly that the wind took their words.
- intent: what the person wants: "stay" if they invite you to live here${c.traveler ? '' : ' (you already live here, so treat it as chat)'}; "leave" if they say goodbye or send you off; "gift" if they offer you something; "secret" if they ask what you hide or about your secret; "trip" if they suggest you travel or visit another island; otherwise "chat".
- choices: three things the person might say next, 2 to 6 words, in the person's voice: one curious question about what you just said, one that moves things on (${c.traveler ? 'inviting you to stay' : 'asking about your story, or suggesting a trip'}), and one friendly goodbye.
- choiceIntents: the intent of each choice, same order.
- toldBeat: true if your answer tells the next part of your story.
- toldSecret: true if your answer tells your secret.
- remember: a note of up to 12 words about the person, only when they said something specific worth remembering next time (their name, something they like, a promise). Otherwise an empty string.`;
  const facts = [
    `Island: ${c.island.name}. ${residentsLine(c.island)} Time: ${clock(c.now)}.`,
    `What you told when you arrived: ${r.story.intro}`,
    told.length ? `Story you already told:\n${told.map((b) => `- ${b}`).join('\n')}` : '',
    c.nextBeat ? `Next part of your story, tell it when the talk allows: ${c.nextBeat}` : 'No new story part for this visit; just talk.',
    secret,
    `Gifts you love: ${r.likes.map((l) => GIFT_WORDS[l as GiftKind] ?? l).join(', ')}.`,
    memory ? `You remember about the person:\n${memory}` : 'You have not met this person before.',
    c.turns.length ? `Conversation so far:\n${c.turns.slice(-6).map((t) => `${t.who === 'person' ? 'Person' : r.name}: ${t.text}`).join('\n')}` : 'This is the start of the conversation.',
    c.text !== undefined ? `The person's latest words: "${c.text}"
Answer them now.` : `The person's latest words are in the attached audio. Write them out in "heard" and answer them now.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: facts },
  ];
}

// ------------------------------------------------------------------ while away

export type AwayContext = {
  island: IslandState;
  away: string;
  count: number;
  trips: { resident: Resident; islandName: string; met: string[] }[];
  now: number;
};

export function awayMessages(c: AwayContext): ChatMessage[] {
  const people = c.island.residents
    .filter((r) => !r.trip || c.trips.some((t) => t.resident.id === r.id))
    .map((r) => {
      const last = r.memory.at(-1)?.text;
      return `- ${r.name} the ${r.species}, ${TRADE_WORDS[r.trade].person}. ${r.personality}${last ? ` Last memory: ${last}` : ''}`;
    })
    .join('\n');
  return [
    {
      role: 'system',
      content: `${WORLD}\n\n${STYLE}\n\nThe person was away from their island. Pip the bird tells them what happened, in a few small pieces of news. Answer only with JSON in the given schema.
- events: exactly ${c.count}, each about one resident by name. kind "news" is something they did or said; "gift" means they left a small present at the person's door (prop "gift-box"); "growth" means something grew on the island because of them (prop "flower-patch", "fruit-tree", "mushroom-ring" or "berry-bush"). For news use prop "none". Different residents and kinds where possible.
- text: Pip speaking to the person about the resident, in third person and using the resident's name, at most two short sentences and under 35 words, specific and a little funny, fitting the time away. Do not start with a greeting or with "Pip here".
- trips: one item for each traveler returning from a trip, first person in their own voice, two sentences about the island they visited, and a souvenir.`,
    },
    {
      role: 'user',
      content: `Island: ${c.island.name}. Away for ${c.away}. Time now: ${clock(c.now)}.
Residents:
${people || '- nobody yet'}
${c.trips.length ? `Returning from trips:\n${c.trips.map((t) => `- ${t.resident.name} visited ${t.islandName}${t.met.length ? `, where ${t.met.join(', ')} live` : ''}`).join('\n')}` : 'Nobody is returning from a trip.'}`,
    },
  ];
}

export function tripMessages(resident: Resident, islandName: string, met: string[], now: number): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `${WORLD}\n\n${STYLE}\n\nYou are ${resident.name}, a ${resident.species} and ${TRADE_WORDS[resident.trade].person}. ${resident.personality} You just came home from a trip. Answer only with JSON: story (first person, two short sentences about what happened there, specific and a little funny) and a souvenir you brought.`,
    },
    { role: 'user', content: `You visited ${islandName}${met.length ? `, where ${met.join(', ')} live` : ''}. Time now: ${clock(now)}.` },
  ];
}

export function giftMessages(resident: Resident, item: GiftKind, loved: boolean, now: number): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `${WORLD}\n\n${STYLE}\n\nYou are ${resident.name}, a ${resident.species} and ${TRADE_WORDS[resident.trade].person}. ${resident.personality} The person hands you a gift. React in your own voice, at most two short sentences.${loved ? ' You love it: say what you will do with it in your house.' : ' It is not your favorite thing, but you are grateful and kind about it.'} Answer only with JSON in the given schema.`,
    },
    { role: 'user', content: `The gift: ${GIFT_WORDS[item]}. Time: ${clock(now)}.` },
  ];
}
