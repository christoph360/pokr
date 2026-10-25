import * as v from 'valibot';
import {
  CUSTOM_DECK_MAX_CARDS,
  CARD_MAX,
  DECK_IDS,
  DISPLAY_NAME_MAX,
  DeckSchema,
  ROOM_NAME_MAX,
  TOPIC_MAX,
  canClaimFacilitator,
  canManageRoom,
  canManageStories,
  canRevealOrReset,
  isVoter,
  votedCounter,
} from '@pokr/shared';
import type { Deck, DeckId, Participant, RoomState, Summary } from '@pokr/shared';
import { STRINGS } from '../i18n/strings';

export const DECK_OPTIONS: readonly DeckId[] = DECK_IDS;

export type TextKind = 'name' | 'roomName' | 'topic';
const LIMITS: Record<TextKind, number> = {
  name: DISPLAY_NAME_MAX,
  roomName: ROOM_NAME_MAX,
  topic: TOPIC_MAX,
};

/** Turn a shared-schema issue into UI text. The rules themselves stay in `@pokr/shared`. */
function describeIssue(issue: v.BaseIssue<unknown>, kind: TextKind): string {
  const t = STRINGS.validation;
  const m = issue.message;
  if (/control characters/.test(m)) return t.forbiddenChars;
  if (/at least/.test(m)) return t.nameRequired;
  if (/at most/.test(m) || /Invalid length/.test(m)) return t.tooLong(LIMITS[kind]);
  return t.invalid;
}

export type TextResult = { ok: true; value: string } | { ok: false; message: string };

/** Validate and normalize free text with one of the shared schemas. */
export function checkText(
  schema: v.GenericSchema<unknown, string>,
  kind: TextKind,
  input: string,
): TextResult {
  const result = v.safeParse(schema, input);
  if (result.success) return { ok: true, value: result.output };
  return { ok: false, message: describeIssue(result.issues[0]!, kind) };
}

export type DeckResult = { ok: true; deck: Deck } | { ok: false; message: string };

/** Comma-separated custom cards -> a validated custom deck (F01-AC34). */
export function parseCustomDeck(text: string): DeckResult {
  const t = STRINGS.validation;
  if (text.trim() === '') return { ok: false, message: t.customNeedsCards };
  const cards = text.split(',');
  const emptyAt = cards.findIndex((c) => c.trim() === '');
  if (emptyAt >= 0) return { ok: false, message: t.customCardEmptyAt(emptyAt + 1) };
  const result = v.safeParse(DeckSchema, { id: 'custom', cards });
  if (result.success) return { ok: true, deck: result.output };
  const issue = result.issues[0]!;
  const m = issue.message;
  let message: string = t.invalid;
  if (/automatically/.test(m)) message = t.customSpecial;
  else if (/unique/.test(m)) message = t.customUnique;
  else if (/control characters/.test(m)) message = t.forbiddenChars;
  else if (/at least/.test(m)) message = t.customCardEmpty;
  else if (/at most/.test(m)) message = t.customCardTooLong(CARD_MAX);
  else if (/>=/.test(m)) message = t.customNeedsCards;
  else if (/<=/.test(m)) message = t.customTooMany(CUSTOM_DECK_MAX_CARDS);
  return { ok: false, message };
}

export function deckId(deck: Deck): DeckId {
  return deck.id;
}

/** Accessible name of a card: spoken names for symbols, the face value otherwise. */
export function cardName(card: string): string {
  return STRINGS.cardNames[card] ?? card;
}

export interface Controls {
  self: Participant | undefined;
  isFacilitator: boolean;
  /** Shows reveal and reset (F01-AC13). */
  canRevealOrReset: boolean;
  /** Topic, settings, remove, hand over. */
  canManage: boolean;
  /** Add, edit, delete, reorder, select, skip, Next, accept (F02-AC6): facilitator only. */
  canManageStories: boolean;
  /** Has cards (voter, and not a facilitator with "facilitator votes" off). */
  canVote: boolean;
  /** The claim button is available now (F01-AC25). */
  canClaim: boolean;
}

/** Which controls the current participant sees, from the snapshot alone. */
export function controlsFor(state: RoomState, serverNow: number): Controls {
  const self = state.participants.find((p) => p.id === state.selfId);
  if (!self) {
    return {
      self,
      isFacilitator: false,
      canRevealOrReset: false,
      canManage: false,
      canManageStories: false,
      canVote: false,
      canClaim: false,
    };
  }
  const actor = { id: self.id, role: self.role, online: true };
  return {
    self,
    isFacilitator: self.id === state.facilitatorId,
    canRevealOrReset: canRevealOrReset(actor, state.facilitatorId, state.settings.controlMode),
    canManage: canManageRoom(actor, state.facilitatorId),
    canManageStories: canManageStories(actor, state.facilitatorId),
    canVote: isVoter(self, state.facilitatorId, state.settings),
    canClaim: canClaimFacilitator(actor, state.facilitatorId, state.canClaimAt, serverNow),
  };
}

export function counterFor(state: RoomState): { voted: number; total: number } {
  return votedCounter(state.participants, state.facilitatorId, state.settings);
}

/** Does the current round hold any vote (either phase)? Used before a deck change (F01-AC28). */
export function roundHasVotes(state: RoomState): boolean {
  if (state.round.phase === 'revealed') return state.round.votes.length > 0;
  return state.participants.some((p) => p.hasVoted) || state.myVote !== null;
}

/** Unrevealed votes that a reset would discard (F01-AC19). */
export function hasUnrevealedVotes(state: RoomState): boolean {
  return state.round.phase === 'voting' && roundHasVotes(state);
}

export type Extreme = 'lowest' | 'highest';

/** participantId -> lowest/highest marker, from the shared summary (F01-AC15). */
export function extremesFor(summary: Summary | null): Map<string, Extreme> {
  const out = new Map<string, Extreme>();
  if (!summary) return out;
  for (const id of summary.lowest?.participantIds ?? []) out.set(id, 'lowest');
  for (const id of summary.highest?.participantIds ?? []) out.set(id, 'highest');
  return out;
}
