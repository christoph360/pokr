import { TestBed } from '@angular/core/testing';
import { PING_FRAME, backoffDelayMs } from '@pokr/shared';
import type { RoomState, ServerMessage } from '@pokr/shared';
import { makeState } from '../testing/fixtures';
import { RoomApi } from './room-api';
import type { RoomInfoResult } from './room-api';
import { CommandError, RoomConnection } from './room-connection';
import { ROOM_SOCKET_FACTORY } from './room-socket';
import type { RoomSocketHandlers } from './room-socket';
import { TokenStore } from './token-store';

const ROOM = 'abcdefghjkmnpqrs';
const TOKEN = 'a'.repeat(40);

class FakeSocket {
  sent: string[] = [];
  closed = false;
  constructor(readonly handlers: RoomSocketHandlers) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  open() {
    this.handlers.open();
  }
  receive(message: ServerMessage) {
    this.handlers.message(JSON.stringify(message));
  }
  drop(code = 1006) {
    this.handlers.close(code);
  }
  get frames() {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

describe('RoomConnection', () => {
  let sockets: FakeSocket[];
  let conn: RoomConnection;
  let tokens: TokenStore;
  let probe: RoomInfoResult;

  const last = () => sockets[sockets.length - 1]!;
  const state = (version: number, overrides: Partial<RoomState> = {}) =>
    ({ type: 'state', state: makeState({ version, ...overrides }) }) as const;

  /** Connect and finish the rejoin handshake. */
  function connected() {
    tokens.set(ROOM, TOKEN);
    conn.open(ROOM, { kind: 'rejoin' });
    last().open();
    last().receive({ type: 'joined', participantId: 'p1' });
    last().receive(state(1));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sockets = [];
    probe = { kind: 'error' };
    (globalThis as { __pokrTestConfig?: unknown }).__pokrTestConfig = {
      backoff: { initialMs: 100, factor: 2, maxMs: 400, jitter: 0 },
      pingIntervalMs: 1000,
      reconnectIndicatorDelayMs: 1000,
    };
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ROOM_SOCKET_FACTORY,
          useValue: (_id: string, handlers: RoomSocketHandlers) => {
            const s = new FakeSocket(handlers);
            sockets.push(s);
            return s;
          },
        },
        { provide: RoomApi, useValue: { roomInfo: () => Promise.resolve(probe) } },
      ],
    });
    conn = TestBed.inject(RoomConnection);
    tokens = TestBed.inject(TokenStore);
  });

  afterEach(() => {
    delete (globalThis as { __pokrTestConfig?: unknown }).__pokrTestConfig;
    vi.useRealTimers();
  });

  it('F01-AC5 fresh join sends join, stores the token, later connections send rejoin', () => {
    conn.open(ROOM, { kind: 'join', name: 'Alex', role: 'voter' });
    last().open();
    expect(last().frames[0]).toEqual({ type: 'join', name: 'Alex', role: 'voter' });
    last().receive({ type: 'joined', participantId: 'p1', token: TOKEN });
    last().receive(state(1));
    expect(tokens.get(ROOM)).toBe(TOKEN);
    expect(conn.status()).toBe('connected');

    last().drop();
    vi.advanceTimersByTime(100);
    last().open();
    expect(last().frames[0]).toEqual({ type: 'rejoin', token: TOKEN });
  });

  it('F01-AC29 reconnects with exponential backoff, capped, and resets after success', () => {
    connected();
    const delays = [100, 200, 400, 400];
    // Reference the shared function so the test follows the contract, not a copy of the formula.
    expect(delays).toEqual(
      [0, 1, 2, 3].map((n) =>
        backoffDelayMs(n, { initialMs: 100, factor: 2, maxMs: 400, jitter: 0 }),
      ),
    );
    last().drop();
    expect(conn.status()).toBe('reconnecting');
    for (const [i, delay] of delays.entries()) {
      const before = sockets.length;
      vi.advanceTimersByTime(delay - 1);
      expect(sockets.length).toBe(before);
      vi.advanceTimersByTime(1);
      expect(sockets.length).toBe(before + 1);
      if (i < delays.length - 1) last().drop();
    }
    last().open();
    last().receive({ type: 'joined', participantId: 'p1' });
    last().receive(state(2));
    expect(conn.status()).toBe('connected');
    last().drop();
    const n = sockets.length;
    vi.advanceTimersByTime(100);
    expect(sockets.length).toBe(n + 1);
  });

  it('F01-AC29 shows the reconnecting indicator only after the delay and resyncs state', () => {
    connected();
    last().drop();
    expect(conn.indicator()).toBe('connected');
    vi.advanceTimersByTime(999);
    expect(conn.indicator()).toBe('connected');
    vi.advanceTimersByTime(1);
    expect(conn.indicator()).toBe('reconnecting');
    vi.advanceTimersByTime(0);
    last().open();
    last().receive({ type: 'joined', participantId: 'p1' });
    last().receive(state(7, { topic: 'after outage' }));
    expect(conn.indicator()).toBe('connected');
    expect(conn.state()?.topic).toBe('after outage');
    expect(conn.restored()).toBe(true);
  });

  it('F01-AC29 commands are rejected, not queued, while disconnected', async () => {
    connected();
    last().drop();
    await expect(conn.send({ type: 'vote', card: '5' })).rejects.toMatchObject({
      code: 'disconnected',
    });
    expect(sockets.every((s) => s.frames.every((f) => f['type'] !== 'vote'))).toBe(true);
  });

  it.each(['removed', 'room_not_found', 'room_full', 'invalid_token'] as const)(
    'F01-AC23 %s is terminal: no reconnect',
    (code) => {
      connected();
      last().receive({ type: 'error', code, fatal: true });
      expect(conn.terminal()).toBe(code);
      expect(conn.status()).toBe('terminal');
      const n = sockets.length;
      last().drop();
      vi.advanceTimersByTime(60_000);
      expect(sockets.length).toBe(n);
    },
  );

  it('F01-AC23 removed and invalid_token discard the stored token', () => {
    connected();
    last().receive({ type: 'error', code: 'removed', fatal: true });
    expect(tokens.get(ROOM)).toBeNull();
  });

  it('F01-AC29 a close code for a vanished room is terminal', () => {
    connected();
    last().drop(4404);
    expect(conn.terminal()).toBe('room_not_found');
  });

  it('F01-AC29 a failed attempt for a room that is gone ends in room not found', async () => {
    connected();
    probe = { kind: 'not_found' };
    last().drop();
    vi.advanceTimersByTime(100);
    last().drop(); // the retry fails before joining
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.terminal()).toBe('room_not_found');
  });

  it('F01-AC29 ignores state with a lower version within a connection', () => {
    connected();
    last().receive(state(5, { topic: 'five' }));
    last().receive(state(4, { topic: 'stale' }));
    expect(conn.state()?.topic).toBe('five');
    last().receive(state(6, { topic: 'six' }));
    expect(conn.state()?.topic).toBe('six');
  });

  it('F01-AC29 the first state after a reconnect replaces local state', () => {
    connected();
    last().receive(state(9, { topic: 'nine' }));
    last().drop();
    vi.advanceTimersByTime(100);
    last().open();
    last().receive({ type: 'joined', participantId: 'p1' });
    last().receive(state(9, { topic: 'resynced' }));
    expect(conn.state()?.topic).toBe('resynced');
  });

  it('correlates ack with the command id', async () => {
    connected();
    const first = conn.send({ type: 'vote', card: '3' });
    const second = conn.send({ type: 'reveal' });
    const [voteFrame, revealFrame] = last().frames.slice(-2) as { id: string }[];
    last().receive({ type: 'ack', id: revealFrame!.id, version: 3 });
    await expect(second).resolves.toBe(3);
    last().receive({ type: 'ack', id: voteFrame!.id, version: 2 });
    await expect(first).resolves.toBe(2);
  });

  it('correlates command errors with the command id and keeps the connection', async () => {
    connected();
    const p = conn.send({ type: 'vote', card: '99' });
    const frame = last().frames.at(-1) as { id: string };
    last().receive({ type: 'error', id: frame.id, code: 'invalid_card', fatal: false });
    await expect(p).rejects.toBeInstanceOf(CommandError);
    await expect(p).rejects.toMatchObject({ code: 'invalid_card' });
    expect(conn.status()).toBe('connected');
  });

  it('F01-AC37 rate_limited without a command id is a notice, not a disconnect', () => {
    connected();
    last().receive({ type: 'error', code: 'rate_limited', fatal: false, retryAfterMs: 2000 });
    expect(conn.notice()?.code).toBe('rate_limited');
    expect(conn.status()).toBe('connected');
  });

  it('F01-AC21 sends the exact ping frame every interval', () => {
    connected();
    vi.advanceTimersByTime(1000);
    expect(last().sent).toContain(PING_FRAME);
    last().receive({ type: 'pong' });
    vi.advanceTimersByTime(1000);
    expect(last().sent.filter((s) => s === PING_FRAME).length).toBe(2);
  });

  it('F01-AC21 a silently dead connection (no pong) is dropped and retried', () => {
    connected();
    const n = sockets.length;
    vi.advanceTimersByTime(3000);
    expect(conn.status()).toBe('reconnecting');
    vi.advanceTimersByTime(100);
    expect(sockets.length).toBeGreaterThan(n);
  });
});
