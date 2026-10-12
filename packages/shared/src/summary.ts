import {
  cardHundredths,
  cardRank,
  isCardInDeck,
  isNumericDeck,
  isSpecialCard,
  resolveDeck,
} from './deck';
import type { Deck } from './deck';

export interface SummaryVote {
  participantId: string;
  card: string;
}

export interface ExtremeGroup {
  card: string;
  participantIds: string[];
}

export interface Summary {
  totalVotes: number;
  /** Count per card, in deck order (specials last), only cards that received votes. */
  distribution: { card: string; count: number }[];
  /** Numeric decks only, over numeric votes only; null if not applicable or no numeric votes. Always one decimal: "5.0". */
  average: string | null;
  /** Same conditions as average. Up to one decimal: "4", "2.5". */
  median: string | null;
  /** At least 2 value-card votes, all the same card. Special cards don't break it. */
  consensus: boolean;
  /** Set only if the lowest and highest value-card votes differ. Special-card voters are never included. */
  lowest: ExtremeGroup | null;
  highest: ExtremeGroup | null;
}

/** Round half away from zero of num/den (den > 0), exact integer arithmetic. */
function roundDiv(num: number, den: number): number {
  const abs = Math.floor((2 * Math.abs(num) + den) / (2 * den));
  return num < 0 ? -abs : abs;
}

function formatTenths(tenths: number, fixed: boolean): string {
  const abs = Math.abs(tenths);
  const int = Math.floor(abs / 10);
  const dec = abs % 10;
  const sign = tenths < 0 ? '-' : '';
  return dec === 0 && !fixed ? `${sign}${int}` : `${sign}${int}.${dec}`;
}

/** Summary of a revealed round (F01-AC15). Votes for cards not in the deck are ignored. */
export function computeSummary(deck: Deck, votes: readonly SummaryVote[]): Summary {
  const valid = votes.filter((vote) => isCardInDeck(deck, vote.card));
  const counts = new Map<string, number>();
  for (const vote of valid) counts.set(vote.card, (counts.get(vote.card) ?? 0) + 1);
  const distribution = resolveDeck(deck)
    .filter((card) => counts.has(card))
    .map((card) => ({ card, count: counts.get(card)! }));

  const valueVotes = valid.filter((vote) => !isSpecialCard(vote.card));

  let average: string | null = null;
  let median: string | null = null;
  if (isNumericDeck(deck)) {
    const hundredths = valueVotes
      .map((vote) => cardHundredths(vote.card))
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    const n = hundredths.length;
    if (n > 0) {
      const sum = hundredths.reduce((a, b) => a + b, 0);
      average = formatTenths(roundDiv(sum, 10 * n), true);
      const mid = Math.floor(n / 2);
      const medianTenths =
        n % 2 === 1
          ? roundDiv(hundredths[mid]!, 10)
          : roundDiv(hundredths[mid - 1]! + hundredths[mid]!, 20);
      median = formatTenths(medianTenths, false);
    }
  }

  const distinctValueCards = new Set(valueVotes.map((vote) => vote.card));
  const consensus = valueVotes.length >= 2 && distinctValueCards.size === 1;

  let lowest: ExtremeGroup | null = null;
  let highest: ExtremeGroup | null = null;
  if (distinctValueCards.size >= 2) {
    const ranked = [...distinctValueCards].sort((a, b) => cardRank(deck, a) - cardRank(deck, b));
    const low = ranked[0]!;
    const high = ranked[ranked.length - 1]!;
    const idsFor = (card: string) =>
      valueVotes.filter((vote) => vote.card === card).map((vote) => vote.participantId);
    lowest = { card: low, participantIds: idsFor(low) };
    highest = { card: high, participantIds: idsFor(high) };
  }

  return { totalVotes: valid.length, distribution, average, median, consensus, lowest, highest };
}
