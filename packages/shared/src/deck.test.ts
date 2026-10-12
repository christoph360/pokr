import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import {
  CustomCardsSchema,
  DeckSchema,
  cardHundredths,
  cardSlug,
  decksEqual,
  isCardInDeck,
  isNumericDeck,
  resolveDeck,
} from './deck';
import type { Deck } from './deck';

const custom = (cards: string[]): Deck => ({ id: 'custom', cards });
const parseCards = (cards: unknown) => v.safeParse(CustomCardsSchema, cards);

describe('decks (overview, F01 Definitions)', () => {
  it('preset decks match the product overview, specials last', () => {
    expect(resolveDeck({ id: 'fibonacci' })).toEqual([
      '0',
      '½',
      '1',
      '2',
      '3',
      '5',
      '8',
      '13',
      '21',
      '?',
      '☕',
    ]);
    expect(resolveDeck({ id: 'modified-fibonacci' })).toEqual([
      '0',
      '½',
      '1',
      '2',
      '3',
      '5',
      '8',
      '13',
      '20',
      '40',
      '100',
      '?',
      '☕',
    ]);
    expect(resolveDeck({ id: 'tshirt' })).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕']);
    expect(resolveDeck({ id: 'powers-of-2' })).toEqual([
      '0',
      '1',
      '2',
      '4',
      '8',
      '16',
      '32',
      '64',
      '?',
      '☕',
    ]);
  });

  it('numeric deck detection: presets except T-shirt', () => {
    expect(isNumericDeck({ id: 'fibonacci' })).toBe(true);
    expect(isNumericDeck({ id: 'modified-fibonacci' })).toBe(true);
    expect(isNumericDeck({ id: 'powers-of-2' })).toBe(true);
    expect(isNumericDeck({ id: 'tshirt' })).toBe(false);
  });

  it('custom deck is numeric only if every value card is a decimal (. separator, no exponent)', () => {
    expect(isNumericDeck(custom(['1', '2.5', '10', '-1']))).toBe(true);
    expect(isNumericDeck(custom(['1', 'M']))).toBe(false);
    expect(isNumericDeck(custom(['1e3']))).toBe(false);
    expect(isNumericDeck(custom(['1,5']))).toBe(false);
    expect(isNumericDeck(custom(['½', '1']))).toBe(false); // ½ is only 0.5 in presets
  });

  it('½ is 0.5; decimals parse exactly in hundredths', () => {
    expect(cardHundredths('½')).toBe(50);
    expect(cardHundredths('0')).toBe(0);
    expect(cardHundredths('13')).toBe(1300);
    expect(cardHundredths('0.25')).toBe(25);
    expect(cardHundredths('-0.5')).toBe(-50);
    expect(cardHundredths('-0')).toBe(0);
    expect(cardHundredths('?')).toBeNull();
    expect(cardHundredths('1e3')).toBeNull();
    expect(cardHundredths('.5')).toBeNull();
  });

  it('F01-AC34: custom deck needs 1-20 cards', () => {
    expect(parseCards([]).success).toBe(false);
    expect(parseCards(['a']).success).toBe(true);
    expect(parseCards(Array.from({ length: 20 }, (_, i) => `c${i}`)).success).toBe(true);
    expect(parseCards(Array.from({ length: 21 }, (_, i) => `c${i}`)).success).toBe(false);
  });

  it('F01-AC34: each card is 1-4 graphemes after normalization', () => {
    expect(parseCards(['abcd']).success).toBe(true);
    expect(parseCards(['abcde']).success).toBe(false);
    expect(parseCards(['']).success).toBe(false);
    expect(parseCards(['   ']).success).toBe(false);
    expect(parseCards(['👨‍👩‍👧👍🏽🇩🇪x']).success).toBe(true);
    expect(parseCards(['a\nb']).success).toBe(false);
    const r = parseCards(['  a  b ']);
    expect(r.success && r.output).toEqual(['a b']);
  });

  it('F01-AC34: cards are unique case-insensitively', () => {
    expect(parseCards(['a', 'A']).success).toBe(false);
    expect(parseCards(['xl', 'XL']).success).toBe(false);
    expect(parseCards(['a ', ' a']).success).toBe(false); // equal after normalization
    expect(parseCards(['a', 'b']).success).toBe(true);
  });

  it('F01-AC34: ? and ☕ cannot be entered (they are appended automatically)', () => {
    expect(parseCards(['?']).success).toBe(false);
    expect(parseCards(['☕']).success).toBe(false);
    expect(parseCards(['☕️']).success).toBe(false);
    expect(resolveDeck(custom(['a', 'b']))).toEqual(['a', 'b', '?', '☕']);
  });

  it('DeckSchema discriminates on id', () => {
    expect(v.safeParse(DeckSchema, { id: 'fibonacci' }).success).toBe(true);
    expect(v.safeParse(DeckSchema, { id: 'custom' }).success).toBe(false);
    expect(v.safeParse(DeckSchema, { id: 'custom', cards: ['a'] }).success).toBe(true);
    expect(v.safeParse(DeckSchema, { id: 'nope' }).success).toBe(false);
  });

  it('F01-AC28: selecting the current deck is not a change', () => {
    expect(decksEqual({ id: 'fibonacci' }, { id: 'fibonacci' })).toBe(true);
    expect(decksEqual({ id: 'fibonacci' }, { id: 'tshirt' })).toBe(false);
    expect(decksEqual(custom(['a', 'b']), custom(['a', 'b']))).toBe(true);
    expect(decksEqual(custom(['a', 'b']), custom(['b', 'a']))).toBe(false);
    expect(decksEqual(custom(['a']), { id: 'tshirt' })).toBe(false);
  });

  it('isCardInDeck / cardSlug', () => {
    expect(isCardInDeck({ id: 'fibonacci' }, '☕')).toBe(true);
    expect(isCardInDeck({ id: 'fibonacci' }, '4')).toBe(false);
    expect(cardSlug('?')).toBe('question');
    expect(cardSlug('☕')).toBe('coffee');
    expect(cardSlug('½')).toBe('half');
    expect(cardSlug('XL')).toBe('xl');
    expect(cardSlug('1.5')).toBe('1_u2e_5');
  });
});
