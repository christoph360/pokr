import * as v from 'valibot';
import { COMMAND_ID_MAX, MAX_MESSAGE_CHARS, TOKEN_PATTERN } from './constants';
import { ErrorCodeSchema } from './errors';
import type { ErrorCode } from './errors';
import { DisplayNameSchema, RoleSchema, RoomSettingsInputSchema, TopicSchema } from './settings';
import { RoomStateSchema } from './state';

/**
 * Room protocol messages (ADR 0001). Plain JSON discriminated unions on `type`; nothing here is
 * WebSocket-specific, so the same messages can ride SSE+POST later. `WS_CLOSE_CODES` is the only
 * transport binding and lives apart from the message types.
 *
 * Connection: GET API_PATHS.roomSocket(roomId) with a WebSocket upgrade, no credentials in the URL.
 * The first client message must be `join` or `rejoin`. See packages/shared/README.md.
 */

const CommandId = v.pipe(v.string(), v.minLength(1), v.maxLength(COMMAND_ID_MAX));
const Token = v.pipe(v.string(), v.regex(TOKEN_PATTERN));
const ParticipantId = v.pipe(v.string(), v.minLength(1), v.maxLength(64));
/** Card references are checked against the deck by the server (`invalid_card`); here only bounded. */
const CardRef = v.pipe(v.string(), v.minLength(1), v.maxLength(32));

// ---- client -> server ----

export const ClientMessageSchema = v.variant('type', [
  // Handshake (no `id`; answered by `joined` or a terminal `error`)
  /** Fresh join: becomes a new participant (subject to the room cap). */
  v.object({ type: v.literal('join'), name: DisplayNameSchema, role: RoleSchema }),
  /** Resume as an existing participant with the stored token. Always admitted if the token is valid. */
  v.object({ type: v.literal('rejoin'), token: Token }),
  // Heartbeat. Send exactly the string PING_FRAME so the server can answer without waking the room.
  v.object({ type: v.literal('ping') }),
  // Commands (all carry `id`, answered by `ack` or `error` with the same id)
  v.object({ type: v.literal('vote'), id: CommandId, card: v.nullable(CardRef) }), // null withdraws (F01-AC10)
  v.object({ type: v.literal('reveal'), id: CommandId }),
  v.object({ type: v.literal('reset'), id: CommandId, topic: v.optional(TopicSchema) }),
  v.object({ type: v.literal('set_topic'), id: CommandId, topic: TopicSchema }),
  v.object({
    type: v.literal('update_settings'),
    id: CommandId,
    settings: RoomSettingsInputSchema,
    confirmReset: v.optional(v.boolean(), false),
  }),
  v.object({ type: v.literal('set_role'), id: CommandId, role: RoleSchema }),
  v.object({ type: v.literal('rename'), id: CommandId, name: DisplayNameSchema }),
  v.object({ type: v.literal('remove_participant'), id: CommandId, participantId: ParticipantId }),
  v.object({ type: v.literal('hand_over'), id: CommandId, participantId: ParticipantId }),
  v.object({ type: v.literal('claim_facilitator'), id: CommandId }),
]);
export type ClientMessage = v.InferOutput<typeof ClientMessageSchema>;
export type ClientMessageType = ClientMessage['type'];
export type CommandMessage = Exclude<ClientMessage, { type: 'join' | 'rejoin' | 'ping' }>;

// ---- server -> client ----

export const ServerMessageSchema = v.variant('type', [
  /** Handshake complete. `token` only on a fresh `join`; a `state` message follows immediately. */
  v.object({ type: v.literal('joined'), participantId: v.string(), token: v.optional(v.string()) }),
  /** Full snapshot for this recipient. Sent after joined, and after every state change, to every connection. */
  v.object({ type: v.literal('state'), state: RoomStateSchema }),
  /** Command succeeded (or was an idempotent no-op). `version` is the room version after it; the matching `state` was sent first. */
  v.object({ type: v.literal('ack'), id: v.string(), version: v.number() }),
  v.object({
    type: v.literal('error'),
    /** Present when answering a command. */
    id: v.optional(v.string()),
    code: ErrorCodeSchema,
    /** Developer text, never personal data. */
    message: v.optional(v.string()),
    /** Offending input field for invalid_input, e.g. "settings.deck.cards". */
    field: v.optional(v.string()),
    /** True when the connection is about to be closed and the client must not auto-reconnect (see TERMINAL_ERROR_CODES). */
    fatal: v.boolean(),
    /** For rate_limited. */
    retryAfterMs: v.optional(v.number()),
  }),
  /** Heartbeat reply. Exactly PONG_FRAME on the wire. */
  v.object({ type: v.literal('pong') }),
]);
export type ServerMessage = v.InferOutput<typeof ServerMessageSchema>;
export type ServerMessageType = ServerMessage['type'];

/** Exact wire strings for the heartbeat, so a transport may auto-respond (WebSocket: setWebSocketAutoResponse). */
export const PING_FRAME = '{"type":"ping"}';
export const PONG_FRAME = '{"type":"pong"}';

/** Commands each role may send. `facilitator` is the participant with facilitatorId, whatever their voter/observer role. */
export const COMMAND_PERMISSIONS = {
  vote: 'voter', // voters only (facilitator too if voting); observers get not_allowed; after reveal round_revealed
  reveal: 'control-mode', // facilitator always; voters too when controlMode is "everyone"
  reset: 'control-mode',
  set_topic: 'facilitator',
  update_settings: 'facilitator',
  remove_participant: 'facilitator',
  hand_over: 'facilitator',
  set_role: 'any',
  rename: 'any',
  claim_facilitator: 'any-online-after-threshold',
} as const satisfies Record<Exclude<ClientMessageType, 'join' | 'rejoin' | 'ping'>, string>;

/** Transport binding: WebSocket close codes (application range). Message-level `error` is primary; these are the fallback. */
export const WS_CLOSE_CODES = {
  protocolError: 4400, // unparsable/oversized/invalid first message
  invalidToken: 4401,
  removed: 4403,
  roomNotFound: 4404,
  joinTimeout: 4408,
  roomFull: 4409,
} as const;

// ---- parse / serialize helpers (use at every boundary) ----

export type ParseResult<T> =
  { ok: true; message: T } | { ok: false; code: ErrorCode; field?: string; message: string };

function parseWith<T>(schema: v.GenericSchema<unknown, T>, raw: string): ParseResult<T> {
  if (raw.length > MAX_MESSAGE_CHARS) {
    return { ok: false, code: 'invalid_input', message: 'message too large' };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'invalid_input', message: 'not valid JSON' };
  }
  const result = v.safeParse(schema, json);
  if (result.success) return { ok: true, message: result.output };
  const issue = result.issues[0]!;
  const field = v.getDotPath(issue);
  // Messages describe the rule, never echo the input (it may contain personal data).
  return {
    ok: false,
    code: 'invalid_input',
    ...(field ? { field } : {}),
    message: issue.message.replace(/Received: .*$/s, '').trim(),
  };
}

/** Parse and normalize an inbound frame. Failure -> reply with an `invalid_input` error. */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  return parseWith(ClientMessageSchema, raw);
}

/** Parse a frame from the server (clients and the QA raw client). */
export function parseServerMessage(raw: string): ParseResult<ServerMessage> {
  return parseWith(ServerMessageSchema, raw);
}

export function serializeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}
