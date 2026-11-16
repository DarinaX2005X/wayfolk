import { describe, expect, it } from 'vitest';
import { blockText, normalizeText } from '../../src/materials/text';

describe('blockText', () => {
  it('puts the author and the time before the text', () => {
    expect(blockText({ k: 'msg', who: 'Mark Ellison', at: '4 March 2026, 18:12', text: 'Keys are in the box.' })).toBe(
      'Mark Ellison, 4 March 2026, 18:12: Keys are in the box.',
    );
  });
  it('uses the author alone, the time alone, or neither', () => {
    expect(blockText({ k: 'msg', who: 'Dana', text: 'Fine.' })).toBe('Dana: Fine.');
    expect(blockText({ k: 'row', at: '3 Feb 2026', text: 'Boiler checked' })).toBe('3 Feb 2026: Boiler checked');
    expect(blockText({ k: 'p', text: 'The tenant left on Friday.' })).toBe('The tenant left on Friday.');
  });
  it('treats empty author and time as missing', () => {
    expect(blockText({ k: 'p', who: '', at: '', text: 'x' })).toBe('x');
  });
});

describe('normalizeText', () => {
  it('folds whitespace and line breaks into single spaces and trims', () => {
    expect(normalizeText('  The keys\n\twere   returned \r\n on Friday. ')).toBe('The keys were returned on Friday.');
  });
  it('joins a word hyphenated across a line end, but keeps real hyphens', () => {
    expect(normalizeText('the deposit was with-\ndrawn')).toBe('the deposit was withdrawn');
    expect(normalizeText('a well-known landlord')).toBe('a well-known landlord');
  });
  it('turns typographic quotes and dashes into plain ones', () => {
    expect(normalizeText('“I didn’t” — she said – ‘no’')).toBe(`"I didn't" - she said - 'no'`);
  });
  it('turns no-break spaces into spaces and drops invisible marks', () => {
    expect(normalizeText('﻿£1 200 on 4 March, re­turned​')).toBe('£1 200 on 4 March, returned');
  });
  it('keeps letter case and is stable when applied twice', () => {
    const once = normalizeText('Mr  Ellison SAID “No”');
    expect(once).toBe('Mr Ellison SAID "No"');
    expect(normalizeText(once)).toBe(once);
  });
  it('gives an empty string for whitespace only', () => {
    expect(normalizeText(' \n  ')).toBe('');
  });
});
