import * as v from 'valibot';
import { CARD_MAX, CARD_MIN, CUSTOM_DECK_MAX_CARDS, CUSTOM_DECK_MIN_CARDS } from './constants';
import { textSchema } from './text';

export const QUESTION_CARD = '?';
export const COFFEE_CARD = '☕';
export const HALF_CARD = '½';
export const SPECIAL_CARDS: readonly string[] = [QUESTION_CARD, COFFEE_CARD];

export const PRESET_DECK_IDS = [
  'fibonacci',
  'modified-fibonacci',
  'tshirt',
  'powers-of-2',
] as const;
export type PresetDeckId = (typeof PRESET_DECK_IDS)[number];
export const DECK_IDS = [...PRESET_DECK_IDS, 'custom'] as const;
export type DeckId = (typeof DECK_IDS)[number];

/** Value cards of the preset decks, in rank order (lowest first). Specials are not included. */
const PRESET_VALUE_CARDS: Record<PresetDeckId, readonly string[]> = {
  fibonacci: ['0', '½', '1', '2', '3', '5', '8', '13', '21'],
  'modified-fibonacci': ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100'],
  tshirt: ['XS', 'S', 'M', 'L', 'XL', 'XXL'],
  'powers-of-2': ['0', '1', '2', '4', '8', '16', '32', '64'],
};

const NUMERIC_PRESETS: ReadonlySet<DeckId> = new Set([
  'fibonacci',
  'modified-fibonacci',
  'powers-of-2',
]);

function isSpecialLike(card: string): boolean {
  // Tolerate the emoji variation selector so "☕️" cannot be entered either.
  const bare = card.replaceAll('️', '');
  return SPECIAL_CARDS.includes(bare);
}

function lower(card: string): string {
  return card.toLowerCase();
}

/**
 * Custom deck cards as entered by the user (F01-AC34): 1-20 cards of 1-4 graphemes,
 * unique case-insensitively, without the specials. Output cards are normalized.
 */
export const CustomCardsSchema = v.pipe(
  v.array(textSchema({ min: CARD_MIN, max: CARD_MAX })),
  v.minLength(CUSTOM_DECK_MIN_CARDS),
  v.maxLength(CUSTOM_DECK_MAX_CARDS),
  v.check((cards) => !cards.some(isSpecialLike), '? and ☕ are added automatically'),
  v.check((cards) => new Set(cards.map(lower)).size === cards.length, 'cards must be unique'),
);

export const DeckSchema = v.variant('id', [
  v.object({ id: v.literal('fibonacci') }),
  v.object({ id: v.literal('modified-fibonacci') }),
  v.object({ id: v.literal('tshirt') }),
  v.object({ id: v.literal('powers-of-2') }),
  v.object({ id: v.literal('custom'), cards: CustomCardsSchema }),
]);
/** A deck selection. Custom decks carry only the value cards; `resolveDeck` appends the specials. */
export type Deck = v.InferOutput<typeof DeckSchema>;

export const DEFAULT_DECK: Deck = { id: 'fibonacci' };

/** Value cards (no specials) in rank order. */
export function valueCards(deck: Deck): readonly string[] {
  return deck.id === 'custom' ? deck.cards : PRESET_VALUE_CARDS[deck.id];
}

/** Every card the deck offers, in display order, specials last. */
export function resolveDeck(deck: Deck): string[] {
  return [...valueCards(deck), ...SPECIAL_CARDS];
}

export function isSpecialCard(card: string): boolean {
  return SPECIAL_CARDS.includes(card);
}

export function isCardInDeck(deck: Deck, card: string): boolean {
  return resolveDeck(deck).includes(card);
}

/** Selecting the current deck is not a change (F01-AC28). Custom decks compare cards in order, exactly. */
export function decksEqual(a: Deck, b: Deck): boolean {
  if (a.id !== b.id) return false;
  if (a.id === 'custom' && b.id === 'custom') {
    return a.cards.length === b.cards.length && a.cards.every((c, i) => c === b.cards[i]);
  }
  return true;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Value of a card in hundredths (integers keep rounding exact), or null if it is not a decimal.
 * `½` is 0.5. Only `.` as separator, no exponent.
 */
export function cardHundredths(card: string): number | null {
  if (card === HALF_CARD) return 50;
  const m = DECIMAL.exec(card);
  if (!m) return null;
  const frac = m[3] ?? '';
  if (frac.length > 2) return null; // cannot happen within the 4-grapheme card limit
  const abs = Number(m[2]) * 100 + Number(frac.padEnd(2, '0'));
  return m[1] === '-' && abs !== 0 ? -abs : abs;
}

/**
 * Numeric deck (F01 Definitions): Fibonacci, Modified Fibonacci, Powers of 2; never T-shirt.
 * Custom is numeric only if every value card is a plain decimal (so `½` makes a custom deck
 * non-numeric; only the presets treat `½` as 0.5).
 */
export function isNumericDeck(deck: Deck): boolean {
  if (deck.id !== 'custom') return NUMERIC_PRESETS.has(deck.id);
  return deck.cards.every((c) => c !== HALF_CARD && cardHundredths(c) !== null);
}

/** Position of a value card in the deck's rank order, or -1 for specials and unknown cards. */
export function cardRank(deck: Deck, card: string): number {
  return valueCards(deck).indexOf(card);
}

/** Stable test-id slug (QA R-F1): `?` -> question, `☕` -> coffee, `½` -> half. */
export function cardSlug(card: string): string {
  if (card === QUESTION_CARD) return 'question';
  if (card === COFFEE_CARD) return 'coffee';
  if (card === HALF_CARD) return 'half';
  let out = '';
  for (const ch of card.toLowerCase()) {
    out += /[a-z0-9]/.test(ch) ? ch : `_u${ch.codePointAt(0)!.toString(16)}_`;
  }
  return out;
}
