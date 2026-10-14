import * as v from 'valibot';

/**
 * Stable machine-readable error codes, shared by HTTP and WebSocket. Never rename or reuse;
 * only add. Human-readable `message` fields are for developers and must not contain personal data.
 */
export const ERROR_CODES = [
  'not_allowed', // role/control-mode does not permit the command (F01-AC13)
  'room_not_found', // malformed or never-created room ID (F01-AC6)
  'room_full', // 50 participants and the joiner is not in the list (F01-AC7)
  'round_revealed', // vote/withdraw after reveal
  'confirmation_required', // deck change would discard votes and confirmReset was false (F01-AC28)
  'target_offline', // hand-over target is not online (F01-AC24)
  'already_claimed', // someone else claimed the facilitator role first (F01-AC25)
  'rate_limited', // F01-AC37; connection stays open
  'invalid_input', // schema/normalization failure; `field` names the offending field when known
  'removed', // the participant was removed by the facilitator (F01-AC23)
  'invalid_card', // card is not in the room's deck
  'invalid_token', // unknown participant token (purged or never valid; a removed participant's token gets `removed`): start a fresh join
  'not_joined', // a command arrived before join/rejoin completed
  'already_joined', // join/rejoin on a connection that is already joined
  'unknown_target', // target participant ID is not in the room
  'claim_not_available', // facilitator claim before canClaimAt, or the facilitator is online
  // F02 (additions)
  'story_limit_reached', // more than MAX_STORIES would result (F02-AC5)
  'unknown_story', // storyId (or reorder anchor) is not in the room: deleted meanwhile
  'no_active_story', // vote/reveal/accept in story-list mode with no active story
  'no_next_story', // next_story with nothing left to estimate (F02-AC9)
  'invalid_story_state', // e.g. accept before reveal, accept for a story that is not active, skip an estimated story
  'wrong_story_source', // story-round command in topic mode, or set_topic / reset with topic in story-list mode
  'stale_round', // accept_estimate / next_story / skip_story refer to a round that is no longer the current one
  'round_not_revealed', // accept_estimate while the round is still in voting
  'internal_error',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
export const ErrorCodeSchema = v.picklist(ERROR_CODES);

/** Errors after which the client must not reconnect automatically; it shows a dedicated screen instead. */
export const TERMINAL_ERROR_CODES: readonly ErrorCode[] = [
  'removed',
  'room_not_found',
  'room_full',
  'invalid_token',
];

export function isTerminalError(code: ErrorCode): boolean {
  return TERMINAL_ERROR_CODES.includes(code);
}

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  not_allowed: 403,
  room_not_found: 404,
  room_full: 409,
  round_revealed: 409,
  confirmation_required: 409,
  target_offline: 409,
  already_claimed: 409,
  rate_limited: 429,
  invalid_input: 400,
  removed: 403,
  invalid_card: 400,
  invalid_token: 401,
  not_joined: 401,
  already_joined: 409,
  unknown_target: 404,
  claim_not_available: 409,
  story_limit_reached: 409,
  unknown_story: 404,
  no_active_story: 409,
  no_next_story: 409,
  invalid_story_state: 409,
  wrong_story_source: 409,
  stale_round: 409,
  round_not_revealed: 409,
  internal_error: 500,
};
