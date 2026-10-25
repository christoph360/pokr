import { cardHundredths, cardRank, isNumericDeck, valueCards } from './deck';
import type { Deck } from './deck';
import { computeSummary } from './summary';
import type { SummaryVote } from './summary';

/** Quick picks for accepting a final estimate (F02-AC10). Both are null when there is no suggestion. */
export interface QuickPicks {
  /** The one value card all value-card votes agree on; null unless `computeSummary(...).consensus`. */
  consensus: string | null;
  /**
   * Median of the value-card votes, rounded up to the next deck card:
   * - numeric decks: the lowest value card that is >= the exact median (the median itself when it is a deck card);
   * - other decks (T-shirt, non-numeric custom): the vote at the upper middle of the votes sorted by deck rank
   *   (the higher of the two middle votes when the count is even).
   * Null with no value-card votes. `?` and the coffee card are ignored, as in the summary.
   */
  median: string | null;
  /** "Any card from the deck": the value cards, in deck order. Specials cannot be accepted as an estimate. */
  cards: readonly string[];
}

export function quickPicks(deck: Deck, votes: readonly SummaryVote[]): QuickPicks {
  const summary = computeSummary(deck, votes);
  const cards = valueCards(deck);
  const valueVotes = votes.filter((vote) => cards.includes(vote.card));
  const consensus = summary.consensus ? valueVotes[0]!.card : null;
  if (valueVotes.length === 0) return { consensus: null, median: null, cards };

  let median: string | null;
  if (isNumericDeck(deck)) {
    const sorted = valueVotes.map((vote) => cardHundredths(vote.card)!).sort((a, b) => a - b);
    const n = sorted.length;
    const mid = Math.floor(n / 2);
    // Twice the median, an exact integer.
    const twice = n % 2 === 1 ? 2 * sorted[mid]! : sorted[mid - 1]! + sorted[mid]!;
    let best: { card: string; value: number } | null = null;
    for (const card of cards) {
      const value = cardHundredths(card)!;
      if (2 * value >= twice && (best === null || value < best.value)) best = { card, value };
    }
    median = best?.card ?? null;
  } else {
    const sorted = valueVotes
      .map((vote) => vote.card)
      .sort((a, b) => cardRank(deck, a) - cardRank(deck, b));
    median = sorted[Math.floor(sorted.length / 2)]!;
  }
  return { consensus, median, cards };
}

/** A card the facilitator may accept as final estimate: a value card of the deck (no `?`, no coffee). */
export function isEstimateCard(deck: Deck, card: string): boolean {
  return valueCards(deck).includes(card);
}
