import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  MAX_MESSAGE_CHARS,
  PING_FRAME,
  PONG_FRAME,
  RATE_LIMITS,
  TERMINAL_ERROR_CODES,
  parseClientMessage,
  parseServerMessage,
  serializeMessage,
  CreateRoomRequestSchema,
  RoomStateSchema,
  TestEvictRequestSchema,
  TestTimersRequestSchema,
  API_PATHS,
} from './index';
import type { RoomState } from './index';
import * as v from 'valibot';

const TOKEN = 'A'.repeat(43);

const state = (over: Partial<RoomState> = {}): RoomState => ({
  roomId: 'abcdefghjkmnpqrs',
  version: 1,
  serverTime: 1_700_000_000_000,
  selfId: 'p1',
  facilitatorId: 'p1',
  settings: {
    name: 'Planning session',
    deck: { id: 'fibonacci' },
    controlMode: 'facilitator',
    autoReveal: false,
    facilitatorVotes: true,
  },
  topic: '',
  round: { phase: 'voting', number: 1 },
  participants: [{ id: 'p1', name: 'Ann', role: 'voter', online: true, hasVoted: true }],
  myVote: '5',
  canClaimAt: null,
  ...over,
});

describe('client messages', () => {
  it('parses a fresh join and normalizes the name', () => {
    const r = parseClientMessage(
      JSON.stringify({ type: 'join', name: '  Ann   Lee ', role: 'voter' }),
    );
    expect(r).toEqual({ ok: true, message: { type: 'join', name: 'Ann Lee', role: 'voter' } });
  });

  it('F01-AC4: join rejects empty/too long names and unknown roles', () => {
    expect(parseClientMessage('{"type":"join","name":"","role":"voter"}').ok).toBe(false);
    expect(
      parseClientMessage(JSON.stringify({ type: 'join', name: 'x'.repeat(31), role: 'voter' })).ok,
    ).toBe(false);
    expect(parseClientMessage('{"type":"join","name":"a","role":"facilitator"}').ok).toBe(false);
  });

  it('rejoin carries the token; a malformed token is invalid_input', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'rejoin', token: TOKEN })).ok).toBe(true);
    const bad = parseClientMessage('{"type":"rejoin","token":"short"}');
    expect(bad).toMatchObject({ ok: false, code: 'invalid_input', field: 'token' });
  });

  it('invalid_input messages never echo the input', () => {
    const r = parseClientMessage(
      JSON.stringify({ type: 'join', name: 'Secret\nName', role: 'voter' }),
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('Secret');
  });

  it('F01-AC10: vote takes a card or null (withdraw)', () => {
    expect(parseClientMessage('{"type":"vote","id":"1","card":"5"}').ok).toBe(true);
    expect(parseClientMessage('{"type":"vote","id":"1","card":null}').ok).toBe(true);
    expect(parseClientMessage('{"type":"vote","id":"1"}').ok).toBe(false);
    expect(parseClientMessage('{"type":"vote","card":"5"}').ok).toBe(false); // id required
  });

  it('F01-AC19: reset has an optional topic, empty clears', () => {
    expect(parseClientMessage('{"type":"reset","id":"1"}')).toMatchObject({
      ok: true,
      message: { type: 'reset' },
    });
    expect(parseClientMessage('{"type":"reset","id":"1","topic":" New "}')).toMatchObject({
      ok: true,
      message: { topic: 'New' },
    });
    expect(parseClientMessage('{"type":"reset","id":"1","topic":""}')).toMatchObject({
      ok: true,
      message: { topic: '' },
    });
    expect(parseClientMessage('{"type":"reset","id":"1","topic":"a\\nb"}').ok).toBe(false);
  });

  it('F01-AC28: update_settings defaults confirmReset to false and validates the custom deck', () => {
    const r = parseClientMessage(
      '{"type":"update_settings","id":"1","settings":{"deck":{"id":"tshirt"}}}',
    );
    expect(r).toMatchObject({ ok: true, message: { confirmReset: false } });
    const bad = parseClientMessage(
      '{"type":"update_settings","id":"1","settings":{"deck":{"id":"custom","cards":["a","A"]}}}',
    );
    expect(bad).toMatchObject({ ok: false, code: 'invalid_input' });
    expect(
      parseClientMessage('{"type":"update_settings","id":"1","settings":{"name":""}}'),
    ).toMatchObject({
      ok: true,
      message: { settings: { name: 'Planning session' } },
    });
  });

  it('rejects unknown types, non-JSON, non-objects and oversized frames', () => {
    expect(parseClientMessage('{"type":"drop_tables"}').ok).toBe(false);
    expect(parseClientMessage('nope').ok).toBe(false);
    expect(parseClientMessage('[]').ok).toBe(false);
    expect(parseClientMessage('null').ok).toBe(false);
    expect(parseClientMessage(' '.repeat(MAX_MESSAGE_CHARS + 1)).ok).toBe(false);
  });

  it('heartbeat: PING_FRAME parses and the frames are exact', () => {
    expect(parseClientMessage(PING_FRAME)).toEqual({ ok: true, message: { type: 'ping' } });
    expect(serializeMessage({ type: 'ping' })).toBe(PING_FRAME);
    expect(serializeMessage({ type: 'pong' })).toBe(PONG_FRAME);
  });

  it('F01-AC24 / AC23: participant targets are required', () => {
    expect(parseClientMessage('{"type":"hand_over","id":"1"}').ok).toBe(false);
    expect(
      parseClientMessage('{"type":"remove_participant","id":"1","participantId":"p2"}').ok,
    ).toBe(true);
  });
});

describe('server messages', () => {
  it('F01-AC11: a voting-round snapshot has no field that can carry other participants votes', () => {
    const msg = parseServerMessage(
      JSON.stringify({
        type: 'state',
        state: {
          ...state(),
          round: { phase: 'voting', number: 1, votes: [{ participantId: 'p2', card: '8' }] },
        },
      }),
    );
    expect(msg.ok).toBe(true);
    if (msg.ok && msg.message.type === 'state') {
      // valibot strips unknown keys: a leaked `votes` array cannot survive a client-side parse.
      expect(msg.message.state.round).toEqual({ phase: 'voting', number: 1 });
    }
  });

  it('revealed snapshot carries votes and left participants (F01-AC18)', () => {
    const s = state({
      round: {
        phase: 'revealed',
        number: 2,
        votes: [{ participantId: 'p2', card: '8' }],
        left: [{ participantId: 'p2', name: 'Bob' }],
      },
    });
    expect(v.safeParse(RoomStateSchema, s).success).toBe(true);
  });

  it('round-trips ack, error, joined', () => {
    for (const m of [
      { type: 'joined', participantId: 'p1', token: TOKEN },
      { type: 'joined', participantId: 'p1' },
      { type: 'ack', id: '1', version: 7 },
      { type: 'error', id: '1', code: 'not_allowed', fatal: false },
      { type: 'error', code: 'rate_limited', fatal: false, retryAfterMs: 1000 },
      { type: 'state', state: state() },
      { type: 'pong' },
    ] as const) {
      expect(parseServerMessage(serializeMessage(m))).toEqual({ ok: true, message: m });
    }
  });

  it('F01-AC25: canClaimAt is a number or null; version starts at 1', () => {
    expect(v.safeParse(RoomStateSchema, state({ canClaimAt: 123 })).success).toBe(true);
    expect(v.safeParse(RoomStateSchema, state({ version: 0 })).success).toBe(false);
  });

  it('rejects an unknown error code', () => {
    expect(parseServerMessage('{"type":"error","code":"boom","fatal":false}').ok).toBe(false);
  });
});

describe('error codes', () => {
  it('include the required stable codes', () => {
    for (const code of [
      'not_allowed',
      'room_not_found',
      'room_full',
      'round_revealed',
      'confirmation_required',
      'target_offline',
      'already_claimed',
      'rate_limited',
      'invalid_input',
      'removed',
    ]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('every code has an HTTP status; terminal codes are known codes', () => {
    for (const c of ERROR_CODES) expect(ERROR_HTTP_STATUS[c]).toBeGreaterThanOrEqual(400);
    for (const c of TERMINAL_ERROR_CODES) expect(ERROR_CODES).toContain(c);
    expect(ERROR_HTTP_STATUS.room_not_found).toBe(404); // F01-AC6
    expect(ERROR_HTTP_STATUS.rate_limited).toBe(429);
  });
});

describe('HTTP schemas and constants', () => {
  it('F01-AC1/AC3: create request defaults settings and normalizes', () => {
    const r = v.parse(CreateRoomRequestSchema, { displayName: ' Ann ' });
    expect(r).toEqual({ displayName: 'Ann', settings: {} });
    expect(v.safeParse(CreateRoomRequestSchema, { displayName: '' }).success).toBe(false);
    expect(
      v.safeParse(CreateRoomRequestSchema, { displayName: 'a', settings: { controlMode: 'x' } })
        .success,
    ).toBe(false);
  });

  it('F01-AC37: rate limits', () => {
    expect(RATE_LIMITS.roomCreate).toMatchObject({ limit: 5, windowMs: 60_000 });
    expect(RATE_LIMITS.join).toMatchObject({ limit: 120, windowMs: 60_000 });
    expect(RATE_LIMITS.message).toMatchObject({ limit: 20, windowMs: 10_000 });
  });

  it('test-mode hooks validate their bodies (R-B2, R-B3)', () => {
    expect(v.safeParse(TestTimersRequestSchema, { offlinePurgeMs: 500 }).success).toBe(true);
    expect(v.safeParse(TestTimersRequestSchema, { offlinePurgeMs: -1 }).success).toBe(false);
    expect(v.safeParse(TestEvictRequestSchema, { mode: 'drop_memory' }).success).toBe(true);
    expect(v.safeParse(TestEvictRequestSchema, { mode: 'x' }).success).toBe(false);
  });

  it('the WebSocket path has no credentials in it (token goes in the first message)', () => {
    expect(API_PATHS.roomSocket('abc')).toBe('/api/rooms/abc/ws');
    expect(API_PATHS.roomSocket('abc')).not.toMatch(/token|\?/);
  });
});
