import * as v from 'valibot';
import { ErrorCodeSchema } from './errors';
import {
  MAX_PARTICIPANTS,
  MAX_STORIES,
  STORY_DESCRIPTION_MAX,
  STORY_LINK_MAX,
  STORY_TITLE_MAX,
} from './constants';
import { DisplayNameSchema, RoomSettingsInputSchema } from './settings';
import { FinalRoundSchema } from './stories';

/** Paths. Room IDs are lowercase Crockford base32; lookups accept any case. */
export const API_PATHS = {
  createRoom: '/api/rooms',
  roomInfo: (roomId: string) => `/api/rooms/${roomId}`,
  /** WebSocket upgrade (GET with `Upgrade: websocket`). The token is NOT in the URL; see ws.ts. */
  roomSocket: (roomId: string) => `/api/rooms/${roomId}/ws`,
  /** Test mode only; 404 everywhere else. */
  testTimers: (roomId: string) => `/api/__test/rooms/${roomId}/timers`,
  testEvict: (roomId: string) => `/api/__test/rooms/${roomId}/evict`,
  testInstance: (roomId: string) => `/api/__test/rooms/${roomId}/instance`,
  testSeedStories: (roomId: string) => `/api/__test/rooms/${roomId}/stories`,
  testStorage: (roomId: string) => `/api/__test/rooms/${roomId}/storage`,
} as const;

/** Browser URL of a room (F01-AC2). */
export const roomPagePath = (roomId: string) => `/r/${roomId}`;

/** Error body for every non-2xx JSON response. Status per code: see ERROR_HTTP_STATUS. */
export const ErrorResponseSchema = v.object({
  error: v.object({
    code: ErrorCodeSchema,
    message: v.optional(v.string()),
    field: v.optional(v.string()),
    retryAfterMs: v.optional(v.number()),
  }),
});
export type ErrorResponse = v.InferOutput<typeof ErrorResponseSchema>;

// POST /api/rooms -> 201 CreateRoomResponse | 400 invalid_input | 429 rate_limited
export const CreateRoomRequestSchema = v.object({
  /** The creator's display name; they join as facilitator and voter (F01-AC1). */
  displayName: DisplayNameSchema,
  /** Any omitted setting uses the default (F01-AC3). */
  settings: v.optional(RoomSettingsInputSchema, {}),
});
export type CreateRoomRequest = v.InferInput<typeof CreateRoomRequestSchema>;

export const CreateRoomResponseSchema = v.object({
  roomId: v.string(),
  participantId: v.string(),
  /** The creator's participant token. Store it per room; send it only in the `rejoin` message. */
  token: v.string(),
});
export type CreateRoomResponse = v.InferOutput<typeof CreateRoomResponseSchema>;

// GET /api/rooms/:roomId -> 200 RoomInfoResponse | 404 room_not_found (malformed or never created; no storage is written)
export const RoomInfoResponseSchema = v.object({
  roomId: v.string(),
  name: v.string(),
  /** MAX_PARTICIPANTS reached. A stored-token holder is still admitted by `rejoin` (F01-AC7). */
  full: v.boolean(),
});
export type RoomInfoResponse = v.InferOutput<typeof RoomInfoResponseSchema>;

// ---- Test-mode-only hooks (404 unless the Worker runs with test mode on) ----

/**
 * POST /api/__test/rooms/:roomId/timers (R-B2). Per-room overrides, so parallel tests don't interfere.
 * Takes effect for subsequent timer evaluations. 204 on success.
 */
export const TestTimersRequestSchema = v.object({
  /** Time an unjoined connection may stay open (default JOIN_TIMEOUT_MS). */
  joinTimeoutMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(50), v.maxValue(60_000))),
  heartbeatTimeoutMs: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(50), v.maxValue(3_600_000)),
  ),
  offlinePurgeMs: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(50), v.maxValue(86_400_000)),
  ),
  facilitatorClaimMs: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(50), v.maxValue(86_400_000)),
  ),
});
export type TestTimersRequest = v.InferOutput<typeof TestTimersRequestSchema>;

/**
 * POST /api/__test/rooms/:roomId/evict (R-B3, F01-AC30).
 * - `drop_memory`: discard all in-memory room state and caches but keep sockets open, simulating
 *   hibernation. The next message must be served from storage + socket attachments.
 * - `abort`: abort the Durable Object, closing sockets (exercises AC29 resume).
 */
export const TestEvictRequestSchema = v.object({ mode: v.picklist(['drop_memory', 'abort']) });
export type TestEvictRequest = v.InferOutput<typeof TestEvictRequestSchema>;
export const TestEvictResponseSchema = v.object({ previousInstanceId: v.string() });
export type TestEvictResponse = v.InferOutput<typeof TestEvictResponseSchema>;

/** GET /api/__test/rooms/:roomId/instance: a per-instance ID that changes whenever the room is re-instantiated or its memory dropped. */
export const TestInstanceResponseSchema = v.object({ instanceId: v.string() });
export type TestInstanceResponse = v.InferOutput<typeof TestInstanceResponseSchema>;

/**
 * POST /api/__test/rooms/:roomId/stories (QA H1, with H4 folded in). Appends `count` deterministic
 * stories to the end of the agenda without the message rate limit, but still honoring the
 * MAX_STORIES cap (nothing is added and 409 `story_limit_reached` is returned if it would be
 * exceeded). Works in either story source mode. Bumps the room version and agendaVersion and
 * broadcasts like a normal add.
 *
 * Story n (1-based, zero-padded to 3 digits) is titled `Story 001 ` followed by filler up to
 * `titleLength` graphemes (default: just the prefix). Filler is `x`, or a simple emoji (4 UTF-8
 * bytes each) with `emoji`. Description: `descriptionLength` graphemes of Markdown-safe filler
 * (default none). Link: `https://example.com/<filler>` of exactly `linkLength` characters (default none).
 * Lengths are capped by the normal limits (title 200 and 1,000 bytes, description 5,000 and 20,000
 * bytes, link 2,048). The first `estimated` stories of this call get a card of the room's deck as
 * estimate (cycling through the value cards, status `estimated`) and a final-round snapshot of
 * `finalRoundVotes` synthetic voters (names `Seed voter 1..`, cards cycling), taken as if accepted in
 * a past round; the next `skipped` stories are `skipped`. Response 201.
 */
export const TestSeedStoriesRequestSchema = v.object({
  count: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(MAX_STORIES)),
  titleLength: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(STORY_TITLE_MAX)),
  ),
  descriptionLength: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(STORY_DESCRIPTION_MAX)),
  ),
  linkLength: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(STORY_LINK_MAX)),
  ),
  emoji: v.optional(v.boolean(), false),
  estimated: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_STORIES)), 0),
  skipped: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_STORIES)), 0),
  finalRoundVotes: v.optional(
    v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_PARTICIPANTS)),
    3,
  ),
});
export type TestSeedStoriesRequest = v.InferInput<typeof TestSeedStoriesRequestSchema>;
export const TestSeedStoriesResponseSchema = v.object({
  storyIds: v.array(v.string()),
  version: v.number(),
});
export type TestSeedStoriesResponse = v.InferOutput<typeof TestSeedStoriesResponseSchema>;

/**
 * GET /api/__test/rooms/:roomId/storage (QA H2). What the room persists, for size and privacy
 * assertions. `entries` has one item per persisted row/key, keyed `<table>/<primary key>` (e.g.
 * `room/1`, `participants/<id>`, `stories/<storyId>`; token hashes are listed by size only, never
 * by value) with its serialized size in UTF-8 bytes, so a test can assert the one-row-per-story
 * layout and the per-row size. `finalRounds` lists every stored final-round record verbatim.
 */
export const TestStorageResponseSchema = v.object({
  entries: v.array(v.object({ key: v.string(), bytes: v.number() })),
  totalBytes: v.number(),
  finalRounds: v.array(v.object({ storyId: v.string(), finalRound: FinalRoundSchema })),
});
export type TestStorageResponse = v.InferOutput<typeof TestStorageResponseSchema>;
