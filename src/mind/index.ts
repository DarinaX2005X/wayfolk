/**
 * The mind of Wayfolk: the person's island and everything that thinks on it.
 *
 *   const mind = createMind();          // after world and life
 *   await mind.load();                  // the island from this device, or a new one
 *   const news = await mind.whileAway(); // what happened while the person was away
 *   const t = await mind.nextTraveler(); // the next traveler (state.pending)
 *   mind.greet(t.id);                   // their first words and three touch replies
 *   await mind.talk(t.id, { text });    // or { audio: base64 WAV 16 kHz mono }
 *   mind.settle(t, spec);               // they stay: the house spec from world/app
 *
 * Live model calls go through /api/llm only while `liveAI` is on and the proxy says it
 * is live; anything else (no key, budget spent, offline, a slow or malformed answer)
 * falls back to the prepared set, and each result says `prepared` when it came from it.
 * State is saved to IndexedDB after every change that matters.
 */
import type { PublicResident } from '../../api/_lib/contracts';
import { CHAPTER_SCHEMA, chapterMessages, cleanChapter, directChapter, nextChapterNumber, preparedChapter } from './chapters';
import { islandFromPublic, publicSnapshot } from './check';
import { DEMO_ISLANDS } from './demo';
import { createModelClient, noModel, type ModelClient } from './llm';
import { createIslandsClient } from './net';
import { choicesFor, fill, greeting, guessIntent, offlineReply, type Choice } from './offline';
import { FIRST_IDS, LINES, PREPARED } from './prepared';
import { awayMessages, giftMessages, talkMessages, travelerMessages, tripMessages, type Turn } from './prompts';
import { EVENTS_SCHEMA, GIFT_SCHEMA, REPLY_SCHEMA, TRAVELER_SCHEMA, TRIP_SCHEMA, firstSentences, replyFromModel, tidy, travelerFromModel, type TravelerAsk } from './schema';
import { deviceStore, memoryStore, type IslandStore } from './store';
import {
  SPECIES,
  TRADES,
  VEHICLES,
  type Chapter,
  type GiftKind,
  type GiveResult,
  type HouseSpec,
  type Intent,
  type IslandState,
  type IslandSummary,
  type MailItem,
  type P2,
  type Reply,
  type Resident,
  type Trip,
  type WorldEvent,
} from './types';
import { DOOR_GIFT, GIFT_PROPS, GIFT_WORDS, GROWTH_PROPS, SOUVENIRS, TRADE_WORDS } from './words';

export type MindOptions = {
  /** Origin of the API, '' for the same origin. */
  api?: string;
  fetch?: typeof fetch;
  /** Where the island is kept; IndexedDB by default. */
  store?: IslandStore;
  /** A model client (tests); by default the proxy at `api`. */
  model?: ModelClient;
  now?: () => number;
  random?: () => number;
  /** Live model calls; can be switched at any time through `mind.liveAI`. */
  liveAI?: boolean;
  /** Short trips and quick news for a demo session. */
  demo?: boolean;
  /** How long a trip lasts; by default 3 minutes in demo mode, otherwise 2 hours. */
  tripMs?: number;
};

export type Mind = {
  readonly state: IslandState;
  /** Live model calls allowed (a setting); the proxy may still be off, see `aiStatus()`. */
  liveAI: boolean;
  /** Whether the device keeps the island between sessions. */
  readonly persistent: boolean;
  load(): Promise<IslandState>;
  save(): Promise<void>;
  /** Starts a fresh island (the old one is replaced on save). */
  reset(name?: string): Promise<IslandState>;
  aiStatus(): Promise<{ live: boolean; audio: boolean }>;
  nextTraveler(): Promise<Resident>;
  /** The traveler at the pier leaves without staying. */
  dismiss(id: string): Promise<void>;
  /** First words of a conversation (no model call): the intro, or a greeting. */
  greet(id: string): Reply;
  talk(id: string, input: { text?: string; audio?: string }): Promise<Reply>;
  /** Writes the conversation's memory notes; called when the talk panel closes. */
  endTalk(id: string): Promise<void>;
  settle(resident: Resident, spec: HouseSpec): Promise<void>;
  whileAway(now?: number): Promise<WorldEvent[]>;
  /** During a session: trips that came back, new mail and guests. */
  tick(now?: number): Promise<WorldEvent[]>;
  give(id: string, item: GiftKind): Promise<GiveResult>;
  sendTrip(id: string, to: string): Promise<Trip>;
  publicIslands(): Promise<IslandSummary[]>;
  publish(): Promise<{ id: string }>;
  unpublish(): Promise<void>;
  visit(islandId: string): Promise<IslandState>;
  /** Leave a gift or a note in another island's mailbox. */
  leaveMail(islandId: string, mail: { kind: 'gift' | 'note'; item?: GiftKind; text: string; from?: string }): Promise<boolean>;
  /** Marks events as seen (Pip told them). */
  seen(events: WorldEvent[]): Promise<void>;
  /** The next chapter of a resident's story for the evening fire: prepared, live, or directed from their beats. */
  chapter(id: string): Promise<Chapter>;
  /** A chapter was told to the end (or nearly): the next evening brings the next one. */
  toldChapter(id: string): Promise<void>;
  /** Notes and gifts in this island's mailbox that nobody has read out yet. */
  notes(): MailItem[];
  /** A note was read aloud. */
  readNote(id: string): Promise<void>;
};

/** Notes neighbours from the islands on the horizon leave in a demo session. */
const NEIGHBOUR_NOTES = [
  'We saw your lights last night. They looked like a kettle on a shelf. Wave if you see ours.',
  'Our gulls say your birds are very polite. Come over when the wind is kind.',
  'I left a feather for your bird. The blue one. It fell off my hat on the way.',
  'Your island looks small from here, which is the best kind of island.',
  'Thank you for the lantern. It got stuck in our apple tree and we have named it Gerald.',
  'Somebody on your island sings while they work. We hum along from here.',
];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** A new conversation after this long counts as a new visit. */
const VISIT_GAP = 10 * MINUTE;
const MEMORY_KEEP = 16;
const EVENTS_KEEP = 60;
const TALK_TIMEOUT = 8000;
const AUDIO_TIMEOUT = 10_000;
const TRAVELER_TIMEOUT = 25_000;

type Conversation = { turns: Turn[]; notes: string[]; choices: Choice[]; beatTold: boolean };

const ISLAND_NAMES = ['Puddlewick', 'Saltloaf', 'Brindle Isle', 'Lowtide Rock', 'Moss Hollow', 'Kettle Key', 'Thimble Isle', 'Dovecote'];

export function newIsland(now: number, random: () => number, name?: string): IslandState {
  return {
    id: `home-${Math.floor(random() * 36 ** 6).toString(36)}`,
    name: name ?? ISLAND_NAMES[Math.floor(random() * ISLAND_NAMES.length)],
    seed: Math.floor(random() * 2 ** 31),
    visibility: 'private',
    radius: 12,
    residents: [],
    houses: [],
    paths: [],
    props: [],
    events: [],
    createdAt: now,
    lastVisit: now,
    met: [],
  };
}

const isNight = (now: number): boolean => {
  const h = new Date(now).getHours();
  return h >= 21 || h < 5;
};

const durationWords = (ms: number): string => {
  if (ms < 2 * MINUTE) return 'a minute';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} minutes`;
  if (ms < 2 * HOUR) return 'an hour';
  if (ms < 30 * HOUR) return `${Math.round(ms / HOUR)} hours`;
  return `${Math.round(ms / (24 * HOUR))} days`;
};

export function createMind(options: MindOptions = {}): Mind {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const api = options.api ?? '';
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const demo = options.demo ?? false;
  const tripMs = options.tripMs ?? (demo ? 3 * MINUTE : 2 * HOUR);
  const runId = `s-${now().toString(36)}-${Math.floor(random() * 36 ** 6).toString(36)}`;
  const model = options.model ?? createModelClient({ api, runId, fetch: doFetch, now });
  const net = createIslandsClient({ api, fetch: doFetch });

  let store: IslandStore | null = options.store ?? null;
  let state: IslandState = newIsland(now(), random);
  let liveAI = options.liveAI ?? true;
  let visiting: IslandState | null = null;
  let upcoming: Promise<Resident | null> | null = null;
  let lastNetCheck = 0;
  let horizon: IslandSummary[] = [];
  const talks = new Map<string, Conversation>();

  const getStore = async (): Promise<IslandStore> => (store ??= await deviceStore().catch(() => memoryStore()));
  const save = async (): Promise<void> => {
    try {
      await (await getStore()).save(state);
    } catch (err) {
      console.warn('[mind] could not save the island', err);
    }
  };
  const live = async (): Promise<boolean> => liveAI && (await model.available());
  const makeId = (prefix: string): string => `${prefix}-${Math.floor(random() * 36 ** 8).toString(36).padStart(6, '0')}`;
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length) % list.length];

  function addEvents(events: WorldEvent[]): WorldEvent[] {
    state.events = [...state.events, ...events].slice(-EVENTS_KEEP);
    return events;
  }

  function remember(r: Resident, text: string): void {
    const t = tidy(text);
    if (!t) return;
    r.memory = [...r.memory, { at: now(), text: t }].slice(-MEMORY_KEEP);
  }

  /** The resident with this id and how they relate to the person. */
  function find(id: string): { r: Resident; role: 'traveler' | 'resident' | 'guest' } {
    if (state.pending?.id === id) return { r: state.pending, role: 'traveler' };
    const own = state.residents.find((x) => x.id === id);
    if (own) return { r: own, role: 'resident' };
    const guest = state.visitors?.find((x) => x.id === id) ?? visiting?.residents.find((x) => x.id === id);
    if (guest) return { r: guest, role: 'guest' };
    throw new Error(`mind: no resident ${id}`);
  }

  const secretAllowed = (r: Resident): boolean =>
    r.secretKnown === true || (r.visits ?? 0) >= 3 || r.story.revealed >= r.story.beats.length || isNight(now());

  function conversation(r: Resident): Conversation {
    let c = talks.get(r.id);
    if (!c) {
      if (now() - (r.lastTalkAt ?? 0) > VISIT_GAP) r.visits = (r.visits ?? 0) + 1;
      c = { turns: [], notes: [], choices: [], beatTold: false };
      talks.set(r.id, c);
    }
    return c;
  }

  // ---------------------------------------------------------------- travelers

  function askFor(): TravelerAsk {
    const taken = new Set(state.residents.map((r) => r.trade));
    const trades = TRADES.filter((t) => !taken.has(t));
    const speciesCount = new Map(SPECIES.map((s) => [s, state.residents.filter((r) => r.species === s).length]));
    const fewest = Math.min(...speciesCount.values());
    const species = SPECIES.filter((s) => speciesCount.get(s) === fewest);
    const metNames = PREPARED.filter((p) => state.met?.includes(p.id)).map((p) => p.name);
    return {
      trade: pick(trades.length ? trades : TRADES),
      species: pick(species),
      vehicle: pick(VEHICLES),
      avoidNames: [...state.residents.map((r) => r.name), ...metNames, ...PREPARED.map((p) => p.name)],
    };
  }

  function preparedTraveler(first: boolean): Resident {
    const names = new Set(state.residents.map((r) => r.name.toLowerCase()));
    const trades = new Set(state.residents.map((r) => r.trade));
    const fresh = PREPARED.filter((p) => !state.met?.includes(p.id) && !names.has(p.name.toLowerCase()) && !state.residents.some((r) => r.id === p.id));
    const pool = first ? fresh.filter((p) => FIRST_IDS.includes(p.id)) : [];
    const newTrade = fresh.filter((p) => !trades.has(p.trade));
    const chosen = pick(pool.length ? pool : newTrade.length ? newTrade : fresh.length ? fresh : PREPARED.filter((p) => !names.has(p.name.toLowerCase())));
    return { ...structuredClone(chosen), arrivedAt: now(), prepared: true };
  }

  async function generate(): Promise<Resident | null> {
    if (!(await live())) return null;
    const ask = askFor();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const r = await model.call({ task: 'traveler', messages: travelerMessages(ask, state, now()), schema: TRAVELER_SCHEMA, maxTokens: 1400, timeoutMs: TRAVELER_TIMEOUT, attempt });
      if (!r.ok) {
        if (r.reason !== 'bad-output') return null;
        continue;
      }
      const resident = travelerFromModel(r.json, ask, makeId('r'), now());
      if (typeof resident !== 'string') return resident;
    }
    return null;
  }

  async function nextTraveler(): Promise<Resident> {
    if (state.pending) return state.pending;
    const firstMinute = state.residents.length === 0 && (state.met?.length ?? 0) === 0;
    let traveler: Resident | null = null;
    if (!firstMinute) {
      traveler = await (upcoming ?? generate());
      upcoming = null;
    }
    traveler ??= preparedTraveler(firstMinute);
    traveler.arrivedAt = now();
    state.pending = traveler;
    state.met = [...(state.met ?? []), traveler.id].slice(-200);
    await save();
    return traveler;
  }

  // ---------------------------------------------------------------- talk

  function greet(id: string): Reply {
    const { r, role } = find(id);
    const c = conversation(r);
    const reply = greeting(r, role, secretAllowed(r), random);
    c.choices = reply.choices.map((text, i) => ({ text, intent: reply.choiceIntents![i] }));
    if (c.turns.length === 0) c.turns.push({ who: 'resident', text: reply.text });
    return reply;
  }

  async function talk(id: string, input: { text?: string; audio?: string }): Promise<Reply> {
    const started = now();
    const { r, role } = find(id);
    const c = conversation(r);
    const text = input.text?.trim() ? tidy(input.text).slice(0, 300) : undefined;
    const audio = !text && input.audio ? input.audio : undefined;
    const touched = text ? c.choices.find((ch) => ch.text.toLowerCase() === text.toLowerCase()) : undefined;
    const nextBeat = !c.beatTold && r.story.revealed < r.story.beats.length ? r.story.beats[r.story.revealed] : null;
    const allowed = secretAllowed(r);

    let reply: Reply | null = null;
    let toldBeat = false;
    let toldSecret = false;
    if (await live()) {
      if (!audio || (await model.status()).audio) {
        const result = await model.call({
          task: 'talk',
          messages: talkMessages({ resident: r, island: role === 'guest' && visiting?.residents.includes(r) ? visiting : state, traveler: role === 'traveler', guest: role === 'guest', turns: c.turns, nextBeat, secretAllowed: allowed, now: now(), text }),
          schema: REPLY_SCHEMA,
          audio,
          maxTokens: 350,
          timeoutMs: audio ? AUDIO_TIMEOUT : TALK_TIMEOUT,
        });
        const parsed = result.ok ? replyFromModel(result.json) : null;
        if (parsed && typeof parsed !== 'string') {
          let intent: Intent = touched?.intent ?? parsed.intent;
          if (intent === 'stay' && role !== 'traveler') intent = 'chat';
          if (intent === 'trip' && role !== 'resident') intent = 'chat';
          toldBeat = parsed.toldBeat && nextBeat !== null;
          toldSecret = parsed.toldSecret && allowed;
          if (parsed.remember) c.notes.push(parsed.remember);
          reply = { text: parsed.text, choices: parsed.choices, choiceIntents: parsed.choiceIntents, intent, mood: parsed.mood, heard: parsed.heard || text };
        }
      }
    }
    if (!reply) {
      const intent = touched?.intent ?? (text ? guessIntent(text, role === 'traveler') : 'chat');
      const offline = offlineReply({ resident: r, role, intent, audio: Boolean(audio), nextBeat, secretAllowed: allowed, random });
      reply = { ...offline.reply, heard: text };
      toldBeat = offline.toldBeat;
      toldSecret = offline.toldSecret;
      if (text && intent === 'chat' && text.length > 12 && !touched) c.notes.push(`They told me: "${text.slice(0, 80)}"`);
    }
    if (toldBeat) {
      r.story.revealed += 1;
      c.beatTold = true;
    }
    if (toldSecret) {
      r.secretKnown = true;
      reply.secret = true;
      if (role !== 'guest') addEvents([{ at: now(), kind: 'secret', residentId: r.id, text: r.story.secret, seen: true }]);
    }
    c.turns.push({ who: 'person', text: reply.heard ?? (audio ? '(spoke)' : '') }, { who: 'resident', text: reply.text });
    c.turns = c.turns.slice(-12);
    c.choices = reply.choices.map((t, i) => ({ text: t, intent: reply!.choiceIntents?.[i] ?? 'chat' }));
    r.lastTalkAt = now();
    reply.ms = now() - started;
    if (reply.intent === 'leave' && role !== 'traveler') await endTalk(id);
    else await save();
    return reply;
  }

  async function endTalk(id: string): Promise<void> {
    const c = talks.get(id);
    if (!c) return;
    talks.delete(id);
    let r: Resident | undefined;
    try {
      r = find(id).r;
    } catch {
      return;
    }
    const notes = [...new Set(c.notes)].slice(-3);
    if (notes.length === 0 && c.turns.length > 1) notes.push(`We talked ${isNight(now()) ? 'under the stars' : 'for a while'}.`);
    for (const note of notes) remember(r, note);
    await save();
  }

  // ---------------------------------------------------------------- settling

  async function settle(resident: Resident, spec: HouseSpec): Promise<void> {
    const r = state.pending?.id === resident.id ? state.pending : resident;
    const notes = talks.get(r.id)?.notes ?? [];
    talks.delete(r.id);
    const settled: Resident = { ...r, houseId: spec.id, arrivedAt: now(), lastTalkAt: now() };
    for (const note of [...new Set(notes)].slice(-3)) remember(settled, note);
    remember(settled, `I moved to ${state.name}. The birds built my ${TRADE_WORDS[r.trade].place}.`);
    state.residents = [...state.residents.filter((x) => x.id !== r.id), settled];
    state.houses = [...state.houses.filter((h) => h.id !== spec.id), { ...spec, residentId: r.id, builtAt: spec.builtAt || now() }];
    const nearest = state.houses
      .filter((h) => h.id !== spec.id)
      .sort((a, b) => Math.hypot(a.pos.x - spec.pos.x, a.pos.z - spec.pos.z) - Math.hypot(b.pos.x - spec.pos.x, b.pos.z - spec.pos.z))[0];
    state.paths = [...state.paths, [spec.id, nearest ? nearest.id : 'seat']];
    if (state.pending?.id === r.id) state.pending = undefined;
    await save();
    // Think of the next traveler while the person enjoys the house.
    upcoming = generate().catch(() => null);
  }

  async function dismiss(id: string): Promise<void> {
    if (state.pending?.id !== id) return;
    talks.delete(id);
    state.pending = undefined;
    await save();
    upcoming = generate().catch(() => null);
  }

  // ---------------------------------------------------------------- events

  const near = (r: Resident): P2 | undefined => {
    const house = state.houses.find((h) => h.residentId === r.id);
    if (!house) return undefined;
    const a = random() * Math.PI * 2;
    return { x: Math.round((house.pos.x + Math.cos(a) * 1.6) * 100) / 100, z: Math.round((house.pos.z + Math.sin(a) * 1.6) * 100) / 100 };
  };

  function placeSouvenir(r: Resident, souvenir: string, from: string): void {
    const house = state.houses.find((h) => h.residentId === r.id);
    if (house && !house.props.includes(souvenir)) house.props = [...house.props, souvenir];
    const at = near(r);
    if (at) state.props = [...state.props, { id: makeId('p'), kind: souvenir, pos: at, from }].slice(-80);
  }

  function offlineTrip(r: Resident, trip: Trip): { story: string; souvenir: string } {
    return { story: fill(pick(LINES[r.trade].tripStory), { island: trip.toName }), souvenir: pick(SOUVENIRS) };
  }

  async function finishTrips(due: Resident[], fromModel: Map<string, { story: string; souvenir: string }>): Promise<WorldEvent[]> {
    const events: WorldEvent[] = [];
    for (const r of due) {
      const trip = r.trip!;
      let told = fromModel.get(r.id);
      if (!told && (await live())) {
        const res = await model.call({ task: 'trip', messages: tripMessages(r, trip.toName, trip.met ?? [], now()), schema: TRIP_SCHEMA, maxTokens: 200, timeoutMs: 6000 });
        const v = res.ok ? (res.json as { story?: unknown; souvenir?: unknown }) : null;
        if (v && typeof v.story === 'string' && (SOUVENIRS as readonly unknown[]).includes(v.souvenir)) told = { story: firstSentences(tidy(v.story), 2), souvenir: v.souvenir as string };
      }
      told ??= offlineTrip(r, trip);
      placeSouvenir(r, told.souvenir, trip.toName);
      remember(r, `I visited ${trip.toName} and brought back a ${told.souvenir.replace('-', ' ')}.`);
      events.push({ at: now(), kind: 'trip-return', residentId: r.id, text: told.story, effect: { prop: told.souvenir, at: near(r) } });
      r.trip = undefined;
    }
    return events;
  }

  /** Mail and guests from the server, at most once a minute. */
  async function fromServer(force: boolean): Promise<WorldEvent[]> {
    const events: WorldEvent[] = [];
    if (!force && now() - lastNetCheck < MINUTE) return events;
    lastNetCheck = now();
    const pub = state.published;
    if (!pub) return events;
    const [mail, guests] = await Promise.all([net.readMail(pub.id, pub.ownerKey), net.guests(pub.id)]);
    if (mail) {
      const known = new Set((state.mail ?? []).map((m) => m.id));
      const fresh = mail.filter((m: MailItem) => !known.has(m.id));
      state.mail = [...(state.mail ?? []), ...fresh].slice(-40);
      for (const m of fresh) {
        const what = m.kind === 'gift' && m.item ? `left ${GIFT_WORDS[m.item]} in your mailbox` : 'left you a note';
        events.push({ at: now(), kind: 'visitor', text: `${m.from}${m.fromIsland ? ' from far away' : ''} ${what}.${m.text ? ` It says: "${m.text}"` : ''}`, effect: m.kind === 'gift' ? { prop: DOOR_GIFT } : undefined });
      }
    }
    if (guests) {
      const before = new Set((state.visitors ?? []).map((v) => `${v.from?.islandId}/${v.id}`));
      state.visitors = guests.map((g) => ({ ...g.resident, memory: [], from: { islandId: g.fromId, islandName: g.fromName, returnsAt: g.leavesAt } }));
      for (const v of state.visitors) {
        if (!before.has(`${v.from?.islandId}/${v.id}`)) events.push({ at: now(), kind: 'visitor', residentId: v.id, text: `${v.name} the ${v.species} came over from ${v.from?.islandName} for a visit.` });
      }
    }
    return events;
  }

  function offlineAway(count: number): WorldEvent[] {
    const events: WorldEvent[] = [];
    const home = state.residents.filter((r) => !r.trip);
    if (home.length === 0) return events;
    const kinds: ('news' | 'growth' | 'gift')[] = ['news', 'growth', 'gift'];
    const order = [...home].sort(() => random() - 0.5);
    for (let i = 0; i < count; i += 1) {
      const r = order[i % order.length];
      const kind = kinds[i % kinds.length];
      if (kind === 'news') {
        const beatLeft = r.story.revealed < r.story.beats.length;
        const text = fill(pick(LINES[r.trade].news), { name: r.name }) + (beatLeft && random() < 0.5 ? ` I think ${r.name} has something new to tell you.` : '');
        events.push({ at: now(), kind: 'news', residentId: r.id, text });
      } else if (kind === 'growth') {
        const prop = pick(GROWTH_PROPS);
        events.push({ at: now(), kind: 'growth', residentId: r.id, text: `Something grew by ${r.name}'s ${TRADE_WORDS[r.trade].place} while you were gone. ${r.name} says it was the rain, but I saw the watering can.`, effect: { prop, at: near(r) } });
      } else {
        events.push({ at: now(), kind: 'gift', residentId: r.id, text: `${r.name} left a little something by your seat. It is wrapped in a leaf and tied with string.`, effect: { prop: DOOR_GIFT } });
      }
    }
    return events;
  }

  async function whileAway(at = now()): Promise<WorldEvent[]> {
    const away = at - state.lastVisit;
    const due = state.residents.filter((r) => r.trip && r.trip.returnsAt <= at);
    const steps = demo ? [MINUTE, 10 * MINUTE, 30 * MINUTE] : [3 * MINUTE, HOUR, 8 * HOUR];
    const count = state.residents.length === 0 ? 0 : steps.filter((s) => away >= s).length;
    const events: WorldEvent[] = [];
    const tripTold = new Map<string, { story: string; souvenir: string }>();

    if ((count > 0 || due.length > 0) && (await live())) {
      const trips = due.map((r) => ({ resident: r, islandName: r.trip!.toName, met: r.trip!.met ?? [] }));
      const res = await model.call({ task: 'events', messages: awayMessages({ island: state, away: durationWords(away), count: Math.max(1, count), trips, now: at }), schema: EVENTS_SCHEMA, maxTokens: 900, timeoutMs: 12_000 });
      if (res.ok) {
        const v = res.json as { events: { kind: 'news' | 'gift' | 'growth'; resident: string; text: string; prop: string }[]; trips: { resident: string; story: string; souvenir: string }[] };
        for (const e of v.events.slice(0, count)) {
          const r = state.residents.find((x) => x.name.toLowerCase() === e.resident.trim().toLowerCase());
          const text = firstSentences(tidy(e.text), 2);
          if (!r || !text || text.length > 280 || !text.includes(r.name.split(' ')[0])) continue;
          const prop = e.kind === 'gift' ? DOOR_GIFT : e.kind === 'growth' ? ((GROWTH_PROPS as readonly string[]).includes(e.prop) ? e.prop : pick(GROWTH_PROPS)) : undefined;
          events.push({ at, kind: e.kind, residentId: r.id, text, ...(prop ? { effect: { prop, at: e.kind === 'growth' ? near(r) : undefined } } : {}) });
        }
        for (const t of v.trips) {
          const r = due.find((x) => x.name.toLowerCase() === t.resident.trim().toLowerCase());
          if (r && t.story) tripTold.set(r.id, { story: firstSentences(tidy(t.story), 2), souvenir: (SOUVENIRS as readonly string[]).includes(t.souvenir) ? t.souvenir : pick(SOUVENIRS) });
        }
      }
    }
    if (events.length < count) events.push(...offlineAway(count - events.length));
    for (const e of events) if (e.kind === 'growth' && e.effect?.prop && e.effect.at) state.props = [...state.props, { id: makeId('p'), kind: e.effect.prop, pos: e.effect.at, from: 'growth' }].slice(-80);
    events.push(...(await finishTrips(due, tripTold)));
    events.push(...(await fromServer(true)));
    const note = count > 0 ? neighbourNote() : null;
    if (note) {
      state.mail = [...(state.mail ?? []), note].slice(-40);
      events.push({ at, kind: 'visitor', text: `${note.from} from ${note.fromIsland} left a note in your mailbox.` });
    }
    state.lastVisit = at;
    addEvents(events);
    await save();
    return events;
  }

  async function tick(at = now()): Promise<WorldEvent[]> {
    const due = state.residents.filter((r) => r.trip && r.trip.returnsAt <= at);
    const events = [...(await finishTrips(due, new Map())), ...(await fromServer(false))];
    if (events.length) {
      addEvents(events);
      await save();
    }
    return events;
  }

  // ---------------------------------------------------------------- gifts

  async function give(id: string, item: GiftKind): Promise<GiveResult> {
    const { r, role } = find(id);
    const loved = r.likes.includes(item);
    let text: string | null = null;
    let prepared = false;
    if (await live()) {
      const res = await model.call({ task: 'gift', messages: giftMessages(r, item, loved, now()), schema: GIFT_SCHEMA, maxTokens: 160, timeoutMs: 5000 });
      const v = res.ok ? (res.json as { text?: unknown }) : null;
      const said = v && typeof v.text === 'string' ? firstSentences(tidy(v.text), 2) : '';
      if (said && said.length <= 260) text = said;
    }
    if (!text) {
      const words = GIFT_WORDS[item];
      text = fill(pick(loved ? LINES[r.trade].giftLove : LINES[r.trade].giftLike), { gift: words, Gift: words[0].toUpperCase() + words.slice(1), place: TRADE_WORDS[r.trade].place });
      prepared = true;
    }
    const result: GiveResult = { text, loved, prepared };
    if (loved) {
      result.prop = GIFT_PROPS[item];
      const house = state.houses.find((h) => h.residentId === r.id);
      if (house && !house.props.includes(result.prop)) house.props = [...house.props, result.prop];
    }
    if (loved && item === r.likes[0] && !r.secretKnown) {
      r.secretKnown = true;
      result.secret = r.story.secret;
      if (role !== 'guest') addEvents([{ at: now(), kind: 'secret', residentId: r.id, text: r.story.secret, seen: true }]);
    }
    remember(r, `They gave me ${GIFT_WORDS[item]}${loved ? ', which I love' : ''}.`);
    await save();
    return result;
  }

  // ---------------------------------------------------------------- trips and islands

  async function sendTrip(id: string, to: string): Promise<Trip> {
    const r = state.residents.find((x) => x.id === id);
    if (!r) throw new Error(`mind: no resident ${id}`);
    if (r.trip) return r.trip;
    const target = await net.read(to);
    const toName = target.ok ? target.value.island.name : horizon.find((h) => h.id === to)?.name ?? 'a faraway island';
    const met = target.ok ? target.value.island.residents.slice(0, 3).map((x) => x.name) : [];
    const leftAt = now();
    const trip: Trip = { to, toName, leftAt, returnsAt: leftAt + tripMs, met };
    r.trip = trip;
    remember(r, `I set off to visit ${toName}.`);
    await save();
    const { memory: _m, trip: _t, from: _f, lastTalkAt: _l, ...card } = r;
    void net.sendGuest(to, { resident: card as PublicResident, fromId: state.published?.id ?? state.id, fromName: state.name, stayMs: tripMs });
    return trip;
  }

  async function publicIslands(): Promise<IslandSummary[]> {
    const list = await net.list();
    horizon = list.filter((s) => s.id !== state.published?.id);
    return horizon;
  }

  async function publish(): Promise<{ id: string }> {
    const snapshot = publicSnapshot(state);
    const pub = state.published;
    if (pub) {
      const r = await net.update(pub.id, pub.ownerKey, snapshot);
      if (r.ok) {
        state.published = { ...pub, rev: r.value.rev, at: now() };
        state.visibility = 'public';
        await save();
        return { id: pub.id };
      }
      if (r.status !== 404 && r.status !== 403) throw new Error(`mind: publish failed (${r.error})`);
    }
    const r = await net.publish(snapshot);
    if (!r.ok) throw new Error(`mind: publish failed (${r.error})`);
    state.published = { id: r.value.id, ownerKey: r.value.ownerKey, rev: r.value.rev, at: now() };
    state.visibility = 'public';
    await save();
    return { id: r.value.id };
  }

  async function unpublish(): Promise<void> {
    const pub = state.published;
    if (pub) await net.remove(pub.id, pub.ownerKey);
    state.published = undefined;
    state.visibility = 'private';
    await save();
  }

  async function visit(islandId: string): Promise<IslandState> {
    const r = await net.read(islandId);
    if (!r.ok) throw new Error(`mind: island ${islandId} could not be read (${r.error})`);
    visiting = islandFromPublic(r.value.island, r.value.guests);
    return visiting;
  }

  async function leaveMail(islandId: string, mail: { kind: 'gift' | 'note'; item?: GiftKind; text: string; from?: string }): Promise<boolean> {
    const r = await net.sendMail(islandId, { from: mail.from ?? `A friend from ${state.name}`, fromIsland: state.published?.id, kind: mail.kind, item: mail.item, text: mail.text.slice(0, 140) });
    return r.ok;
  }

  // ---------------------------------------------------------------- the evening fire

  async function chapter(id: string): Promise<Chapter> {
    const { r } = find(id);
    const n = nextChapterNumber(r);
    if (r.prepared) {
      const prepared = preparedChapter(r, n);
      if (prepared) return prepared;
    }
    if (await live()) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const res = await model.call({ task: 'chapter', messages: chapterMessages(r, n, state.name), schema: CHAPTER_SCHEMA, maxTokens: 2200, timeoutMs: 18_000, attempt });
        if (!res.ok) {
          if (res.reason !== 'bad-output') break;
          continue;
        }
        const c = cleanChapter(res.json, r, n, 'live');
        if (typeof c !== 'string') return c;
      }
    }
    return directChapter(r, n);
  }

  async function toldChapter(id: string): Promise<void> {
    let r: Resident;
    try {
      r = find(id).r;
    } catch {
      return;
    }
    r.chapters = (r.chapters ?? 0) + 1;
    r.lastChapterAt = now();
    remember(r, `I told the person chapter ${r.chapters} of my story by the fire.`);
    await save();
  }

  /** A demo session gets a note now and then from a neighbour on the horizon. */
  function neighbourNote(): MailItem | null {
    if (!demo || !DEMO_ISLANDS.length || state.residents.length === 0) return null;
    if ((state.mail ?? []).some((m) => !m.read)) return null;
    const island = pick(DEMO_ISLANDS);
    const who = island.island.residents[Math.floor(random() * island.island.residents.length)];
    if (!who) return null;
    const used = new Set((state.mail ?? []).map((m) => m.text));
    const text = NEIGHBOUR_NOTES.find((t) => !used.has(t)) ?? pick(NEIGHBOUR_NOTES);
    return { id: makeId('m'), at: now(), from: who.name, fromIsland: island.island.name, kind: 'note', text };
  }

  // ---------------------------------------------------------------- the object

  const mind: Mind = {
    get state() {
      return state;
    },
    get liveAI() {
      return liveAI;
    },
    set liveAI(value: boolean) {
      liveAI = value;
    },
    get persistent() {
      return store?.persistent ?? false;
    },
    async load() {
      const loaded = await (await getStore()).load().catch(() => null);
      if (loaded && typeof loaded === 'object' && Array.isArray(loaded.residents)) state = loaded;
      else {
        state = newIsland(now(), random);
        await save();
      }
      return state;
    },
    save,
    async reset(name) {
      state = newIsland(now(), random, name);
      talks.clear();
      upcoming = null;
      await save();
      return state;
    },
    async aiStatus() {
      if (!liveAI) return { live: false, audio: false };
      return model.status();
    },
    nextTraveler,
    dismiss,
    greet,
    talk,
    endTalk,
    settle,
    whileAway,
    tick,
    give,
    sendTrip,
    publicIslands,
    publish,
    unpublish,
    visit,
    leaveMail,
    chapter,
    toldChapter,
    notes: () => (state.mail ?? []).filter((m) => !m.read),
    async readNote(id) {
      const m = (state.mail ?? []).find((x) => x.id === id);
      if (m) m.read = true;
      await save();
    },
    async seen(events) {
      const set = new Set(events);
      for (const e of state.events) if (set.has(e)) e.seen = true;
      await save();
    },
  };
  if (options.model === undefined && options.liveAI === false) liveAI = false;
  void noModel;
  void choicesFor;
  return mind;
}

export { HOUSE_PROPS, GIFT_PROPS, SOUVENIRS, GROWTH_PROPS, DOOR_GIFT, TRADE_WORDS } from './words';
export { PREPARED } from './prepared';
export { DEMO_ISLANDS } from './demo';
