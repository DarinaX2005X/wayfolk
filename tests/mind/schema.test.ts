/**
 * A model's answer becomes a traveler or a reply only through the schema and the code
 * checks. The schemas must also be ones the proxy accepts.
 */
import { describe, expect, it } from 'vitest';
import { schemaProblem, strictSchema, validate } from '../../api/_lib/llm/schema';
import { EVENTS_SCHEMA, GIFT_SCHEMA, REPLY_SCHEMA, TRAVELER_SCHEMA, TRIP_SCHEMA, replyFromModel, travelerFromModel, type TravelerAsk } from '../../src/mind/schema';

const ask: TravelerAsk = { species: 'hedgehog', trade: 'tea-maker', vehicle: 'umbrella', avoidNames: ['Mirrin Vell', 'Tansy Wick'] };

const good = () => ({
  name: 'Nettle Crumb',
  species: 'hedgehog',
  trade: 'tea-maker',
  vehicle: 'umbrella',
  tagline: 'Sit down, the kettle is nearly ready',
  personality: 'Nettle talks in short, careful sentences. She apologises to the kettle when it whistles too early!',
  voice: { pitch: 1.3, rate: 0.95, timbre: 'warm' },
  colors: { main: '#8A6A4F', accent: '#e8a33d' },
  likes: ['tea', 'honey', 'bell', 'star'],
  story: {
    intro: 'I came down under my umbrella, which is more of a bowl now. The wind said there was room here for a kettle.',
    beats: ['My grandmother kept a tea shop on a very small rock.', 'I have a kettle with a dent shaped like a thumb.', 'One winter I brewed for travelers who never came.', 'I met a mouse who could smell rain an hour early.'],
    secret: 'Some nights I make a pot of tea for nobody and pretend a friend just stepped out.',
  },
  house: { wall: '#f2e0c4', roof: '#7a4e3a', trim: '#9bc4b8', sign: 'Warm Pot Tea', props: ['teapot', 'lantern', 'not-a-prop'] },
});

describe('model schemas', () => {
  it('are in the subset the proxy accepts and fit their strict form', () => {
    for (const schema of [TRAVELER_SCHEMA, REPLY_SCHEMA, EVENTS_SCHEMA, GIFT_SCHEMA, TRIP_SCHEMA]) {
      expect(schemaProblem(schema)).toBeNull();
      expect(schemaProblem(strictSchema(schema))).toBeNull();
    }
    const fitting = good();
    fitting.house.props = ['teapot'];
    expect(validate(fitting, TRAVELER_SCHEMA)).toBeNull();
    expect(validate(good(), TRAVELER_SCHEMA)).toMatch(/props/);
    expect(validate({ ...fitting, species: 'dragon' }, TRAVELER_SCHEMA)).toMatch(/species/);
    expect(validate({ ...fitting, extra: 1 }, TRAVELER_SCHEMA)).toMatch(/not allowed/);
  });
});

describe('travelerFromModel', () => {
  it('turns a fitting answer into a resident, tidied to the house style', () => {
    const r = travelerFromModel(good(), ask, 'r-1', 1000);
    if (typeof r === 'string') throw new Error(r);
    expect(r).toMatchObject({ id: 'r-1', name: 'Nettle Crumb', species: 'hedgehog', trade: 'tea-maker', vehicle: 'umbrella', arrivedAt: 1000 });
    expect(r.personality).not.toMatch(/!/);
    expect(r.colors.main).toBe('#8a6a4f');
    expect(r.likes).toEqual(['tea', 'honey', 'bell']);
    expect(r.house?.props).toEqual(['teapot', 'lantern']);
    expect(r.story.revealed).toBe(0);
    expect(r.prepared).toBeUndefined();
  });

  it('refuses what does not fit the request or the world', () => {
    expect(travelerFromModel({ ...good(), species: 'fox' }, ask, 'x', 0)).toMatch(/differ/);
    expect(travelerFromModel({ ...good(), name: 'Tansy Moss' }, ask, 'x', 0)).toMatch(/repeats/);
    expect(travelerFromModel({ ...good(), name: 'Max' }, ask, 'x', 0)).toMatch(/not a good name/);
    expect(travelerFromModel({ ...good(), colors: { main: 'brown', accent: '#fff000' } }, ask, 'x', 0)).toMatch(/color/);
    const g = good();
    g.story.beats = ['Only one beat.'];
    expect(travelerFromModel(g, ask, 'x', 0)).toMatch(/beats/);
    const h = good();
    h.story.secret = 'I once met a wizard from an ancient realm.';
    expect(travelerFromModel(h, ask, 'x', 0)).toMatch(/off style/);
  });
});

describe('replyFromModel', () => {
  const reply = { heard: 'hi there', text: 'Hello! Mind the kettle.', intent: 'stay', mood: 'happy', choices: ['Tell me more', 'Stay with us', 'Bye', 'Extra'], choiceIntents: ['chat', 'stay'], toldBeat: true, toldSecret: false, remember: '' };
  it('keeps three choices, fills missing intents and tidies the line', () => {
    const r = replyFromModel(reply);
    if (typeof r === 'string') throw new Error(r);
    expect(r.text).toBe('Hello. Mind the kettle.');
    expect(r.choices).toEqual(['Tell me more', 'Stay with us', 'Bye']);
    expect(r.choiceIntents).toEqual(['chat', 'stay', 'chat']);
    expect(r.intent).toBe('stay');
  });
  it('refuses an empty or overlong line', () => {
    expect(replyFromModel({ ...reply, text: '' })).toBe('empty text');
    expect(replyFromModel({ ...reply, text: 'a'.repeat(400) })).toBe('text too long');
    expect(replyFromModel({ ...reply, choices: [] })).toBe('choices');
  });
});
