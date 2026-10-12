import { describe, expect, it } from 'vitest';
import { computeSummary } from './summary';
import type { Deck } from './deck';

const fib: Deck = { id: 'fibonacci' };
const tshirt: Deck = { id: 'tshirt' };
const votes = (...cards: string[]) =>
  cards.map((card, i) => ({ participantId: `p${i + 1}`, card }));

describe('summary (F01-AC15)', () => {
  it('F01-AC17: no votes', () => {
    const s = computeSummary(fib, []);
    expect(s).toEqual({
      totalVotes: 0,
      distribution: [],
      average: null,
      median: null,
      consensus: false,
      lowest: null,
      highest: null,
    });
  });

  it('F01-AC15: distribution counts every card including specials, in deck order', () => {
    const s = computeSummary(fib, votes('?', '5', '3', '5', '☕', '?'));
    expect(s.distribution).toEqual([
      { card: '3', count: 1 },
      { card: '5', count: 2 },
      { card: '?', count: 2 },
      { card: '☕', count: 1 },
    ]);
    expect(s.totalVotes).toBe(6);
  });

  it('F01-AC15: average has one decimal always', () => {
    expect(computeSummary(fib, votes('5', '5')).average).toBe('5.0');
    expect(computeSummary(fib, votes('3', '5', '8')).average).toBe('5.3'); // 5.333
    expect(computeSummary(fib, votes('1', '2')).average).toBe('1.5');
  });

  it('F01-AC15: average rounds half away from zero', () => {
    expect(computeSummary(fib, votes('0', '½')).average).toBe('0.3'); // 0.25 -> 0.3
    expect(
      computeSummary({ id: 'custom', cards: ['-0.2', '-0.3'] }, votes('-0.2', '-0.3')).average,
    ).toBe('-0.3'); // -0.25
    expect(computeSummary(fib, votes('½', '1', '1', '1')).average).toBe('0.9'); // 0.875
    expect(
      computeSummary(
        fib,
        votes(
          '0',
          '0',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
          '½',
        ),
      ).average,
    ).toBe('0.5'); // 0.45 exactly, rounds up (float math would give 0.4 or 0.5 arbitrarily)
  });

  it('F01-AC15: ½ counts as 0.5 and is shown as a decimal', () => {
    const s = computeSummary(fib, votes('½', '½'));
    expect(s.average).toBe('0.5');
    expect(s.median).toBe('0.5');
  });

  it('F01-AC15: median of odd count is the middle value', () => {
    expect(computeSummary(fib, votes('8', '1', '3')).median).toBe('3');
  });

  it('F01-AC15: median of even count is the mean of the two middle values, up to one decimal', () => {
    expect(computeSummary(fib, votes('2', '3')).median).toBe('2.5');
    expect(computeSummary(fib, votes('3', '5', '1', '8')).median).toBe('4'); // (3+5)/2
    expect(computeSummary(fib, votes('1', '1')).median).toBe('1');
    expect(
      computeSummary({ id: 'custom', cards: ['0.25', '0.5'] }, votes('0.25', '0.5')).median,
    ).toBe('0.4'); // 0.375
  });

  it('F01-AC15: average and median use numeric votes only (specials excluded)', () => {
    const s = computeSummary(fib, votes('2', '3', '?', '☕'));
    expect(s.average).toBe('2.5');
    expect(s.median).toBe('2.5');
  });

  it('F01-AC15: omitted when only special cards were played', () => {
    const s = computeSummary(fib, votes('?', '☕'));
    expect(s.average).toBeNull();
    expect(s.median).toBeNull();
    expect(s.consensus).toBe(false);
    expect(s.lowest).toBeNull();
  });

  it('F01-AC15: no average or median for non-numeric decks', () => {
    const s = computeSummary(tshirt, votes('M', 'L'));
    expect(s.average).toBeNull();
    expect(s.median).toBeNull();
  });

  it('F01-AC15: custom numeric deck gets average and median, custom non-numeric does not', () => {
    expect(computeSummary({ id: 'custom', cards: ['1', '10'] }, votes('1', '10')).average).toBe(
      '5.5',
    );
    expect(computeSummary({ id: 'custom', cards: ['1', 'x'] }, votes('1', 'x')).average).toBeNull();
  });

  it('F01-AC15: negative median and zero never shows "-0"', () => {
    const d: Deck = { id: 'custom', cards: ['-1', '1'] };
    expect(computeSummary(d, votes('-1', '1')).average).toBe('0.0');
    expect(computeSummary(d, votes('-1', '1')).median).toBe('0');
  });

  it('F01-AC15: consensus needs 2+ value votes, all identical; specials do not break it', () => {
    expect(computeSummary(fib, votes('5', '5')).consensus).toBe(true);
    expect(computeSummary(fib, votes('5', '5', '?', '☕')).consensus).toBe(true);
    expect(computeSummary(fib, votes('5')).consensus).toBe(false);
    expect(computeSummary(fib, votes('5', '?')).consensus).toBe(false);
    expect(computeSummary(fib, votes('5', '8')).consensus).toBe(false);
    expect(computeSummary(tshirt, votes('M', 'M')).consensus).toBe(true); // any deck
  });

  it('F01-AC15: lowest/highest by deck position mark all holders; specials never marked', () => {
    const s = computeSummary(fib, votes('8', '2', '2', '13', '?', '5', '13'));
    expect(s.lowest).toEqual({ card: '2', participantIds: ['p2', 'p3'] });
    expect(s.highest).toEqual({ card: '13', participantIds: ['p4', 'p7'] });
  });

  it('F01-AC15: lowest/highest follow deck order, not string order (T-shirt, custom)', () => {
    const s = computeSummary(tshirt, votes('XL', 'S', 'M'));
    expect(s.lowest?.card).toBe('S');
    expect(s.highest?.card).toBe('XL');
    const c = computeSummary({ id: 'custom', cards: ['z', 'a'] }, votes('a', 'z'));
    expect(c.lowest?.card).toBe('z');
    expect(c.highest?.card).toBe('a');
  });

  it('F01-AC15: no lowest/highest when they are the same card', () => {
    const s = computeSummary(fib, votes('5', '5', '?'));
    expect(s.lowest).toBeNull();
    expect(s.highest).toBeNull();
  });

  it('F01-AC15: a single value vote marks nobody', () => {
    const s = computeSummary(fib, votes('5', '?'));
    expect(s.lowest).toBeNull();
    expect(s.highest).toBeNull();
  });

  it('F01-AC18: votes of removed/offline participants are just votes in the list', () => {
    expect(computeSummary(fib, votes('3', '5')).totalVotes).toBe(2);
  });

  it('ignores cards that are not in the deck', () => {
    const s = computeSummary(fib, votes('5', '99'));
    expect(s.totalVotes).toBe(1);
  });
});
