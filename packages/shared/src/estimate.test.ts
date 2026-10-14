import { describe, expect, it } from 'vitest';
import { isEstimateCard, quickPicks } from './estimate';
import type { Deck } from './deck';

const fib: Deck = { id: 'fibonacci' };
const tshirt: Deck = { id: 'tshirt' };
const votes = (...cards: string[]) =>
  cards.map((card, i) => ({ participantId: `p${i + 1}`, card }));

describe('quick picks (F02-AC10)', () => {
  it('F02-AC10: consensus is the card all value votes agree on', () => {
    expect(quickPicks(fib, votes('5', '5', '5')).consensus).toBe('5');
    expect(quickPicks(fib, votes('5', '5', '?')).consensus).toBe('5');
    expect(quickPicks(tshirt, votes('M', 'M')).consensus).toBe('M');
  });

  it('F02-AC10: no consensus when votes differ, with a single vote, or with only specials', () => {
    expect(quickPicks(fib, votes('5', '8')).consensus).toBeNull();
    expect(quickPicks(fib, votes('5')).consensus).toBeNull();
    expect(quickPicks(fib, votes('?', '☕')).consensus).toBeNull();
    expect(quickPicks(fib, votes()).consensus).toBeNull();
  });

  it('F02-AC10: median of an odd count is the middle vote', () => {
    expect(quickPicks(fib, votes('1', '8', '3')).median).toBe('3');
    expect(quickPicks(fib, votes('5')).median).toBe('5');
  });

  it('F02-AC10: an even count rounds the median up to the next deck card', () => {
    expect(quickPicks(fib, votes('3', '5')).median).toBe('5'); // 4 -> 5
    expect(quickPicks(fib, votes('2', '3')).median).toBe('3'); // 2.5 -> 3
    expect(quickPicks(fib, votes('1', '13')).median).toBe('8'); // 7 -> 8
    expect(quickPicks(fib, votes('0', '½')).median).toBe('½'); // 0.25 -> 0.5
    expect(quickPicks(fib, votes('5', '5')).median).toBe('5');
    expect(quickPicks({ id: 'modified-fibonacci' }, votes('20', '40')).median).toBe('40'); // 30 -> 40
  });

  it('F02-AC10: a median that is itself a deck card stays', () => {
    expect(quickPicks(fib, votes('1', '5')).median).toBe('3'); // 3 is a card
    expect(quickPicks({ id: 'powers-of-2' }, votes('2', '8')).median).toBe('8'); // 5 -> 8
    expect(quickPicks({ id: 'powers-of-2' }, votes('0', '8')).median).toBe('4'); // 4 is a card
  });

  it('F02-AC10: special cards are ignored', () => {
    expect(quickPicks(fib, votes('3', '?', '☕', '5')).median).toBe('5');
    expect(quickPicks(fib, votes('?', '☕')).median).toBeNull();
  });

  it('F02-AC10: on T-shirt decks the median is the upper middle vote by deck rank', () => {
    expect(quickPicks(tshirt, votes('S', 'XL', 'M')).median).toBe('M');
    expect(quickPicks(tshirt, votes('S', 'M')).median).toBe('M');
    expect(quickPicks(tshirt, votes('XS', 'XXL')).median).toBe('XXL');
    expect(quickPicks(tshirt, votes('L', 'XS', 'S', 'XL')).median).toBe('L');
  });

  it('F02-AC10: custom numeric decks use values, not list order', () => {
    const deck: Deck = { id: 'custom', cards: ['10', '1', '5'] };
    expect(quickPicks(deck, votes('1', '5')).median).toBe('5'); // 3 -> next card >= 3 is 5
    expect(quickPicks(deck, votes('5', '10')).median).toBe('10'); // 7.5 -> 10
  });

  it('F02-AC10: any value card can be picked; specials cannot be accepted', () => {
    expect(quickPicks(fib, votes()).cards).toEqual(['0', '½', '1', '2', '3', '5', '8', '13', '21']);
    expect(isEstimateCard(fib, '8')).toBe(true);
    expect(isEstimateCard(fib, '?')).toBe(false);
    expect(isEstimateCard(fib, '☕')).toBe(false);
    expect(isEstimateCard(fib, '4')).toBe(false);
  });
});
