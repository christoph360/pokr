import * as v from 'valibot';
import { ErrorCodeSchema } from './errors';
import { DisplayNameSchema, RoomSettingsInputSchema } from './settings';

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
