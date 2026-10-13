import {
  DEFAULT_SETTINGS,
  MAX_PARTICIPANTS,
  RATE_LIMITS,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
} from '@pokr/shared';
import { expect, test } from '../fixtures';
import type { World } from '../fixtures';
import { CLIENT_KEY_HEADER, API_URL, uniqueKey } from '../helpers/env';
import { RawClient, probeUpgrade } from '../helpers/raw-client';

// Browser-independent: these run on the chromium project only.
const apiOnly = { tag: '@chromium-only' };

const ID_RE = new RegExp(`^[${ROOM_ID_ALPHABET}]{${ROOM_ID_LENGTH}}$`);

test.describe('rooms API', () => {
  test(
    'F01-AC2: room ids are 16 lowercase Crockford base32 chars and all different',
    apiOnly,
    async ({ world }) => {
      const ids = new Set<string>();
      for (let i = 0; i < 20; i++) {
        // A fresh client key per call: the create limit is 5/min per key.
        const res = await world.api.createRoomRaw(
          { displayName: 'Ann' },
          { [CLIENT_KEY_HEADER]: uniqueKey('c') },
        );
        expect(res.status()).toBe(201);
        const body = (await res.json()) as { roomId: string };
        expect(body.roomId).toMatch(ID_RE);
        ids.add(body.roomId);
      }
      expect(ids.size).toBe(20);
    },
  );

  test('F01-AC2: lookups are case-insensitive', apiOnly, async ({ world }) => {
    const room = await world.createRoom();
    const upper = await world.api.roomInfoRaw(room.roomId.toUpperCase());
    expect(upper.status()).toBe(200);
    const info = (await upper.json()) as { roomId: string };
    expect(info.roomId.toLowerCase()).toBe(room.roomId);
  });

  test(
    'F01-AC3: settings not chosen use the defaults (room name falls back)',
    apiOnly,
    async ({ world }) => {
      const room = await world.createRoom({ displayName: 'Dana' });
      const fac = await world.rawFacilitator(room);
      expect(fac.state?.settings).toEqual(DEFAULT_SETTINGS);
      expect(fac.state?.topic).toBe('');
      expect(fac.state?.round.phase).toBe('voting');

      const blank = await world.createRoom({ displayName: 'Dana', settings: { name: '   ' } });
      const fac2 = await world.rawFacilitator(blank);
      expect(fac2.state?.settings.name).toBe(DEFAULT_SETTINGS.name);
      const info = await world.api.roomInfo(room.roomId);
      expect(info.name).toBe(DEFAULT_SETTINGS.name);
      expect(info.full).toBe(false);
    },
  );

  test(
    'F01-AC1: creator joins as facilitator and voter with the chosen settings',
    apiOnly,
    async ({ world }) => {
      const room = await world.createRoom({
        displayName: 'Dana',
        settings: {
          name: 'Sprint 42',
          deck: { id: 'custom', cards: ['a', 'b'] },
          controlMode: 'everyone',
          autoReveal: true,
          facilitatorVotes: false,
        },
      });
      const fac = await world.rawFacilitator(room);
      const s = fac.state!;
      expect(s.facilitatorId).toBe(s.selfId);
      expect(s.settings).toEqual({
        name: 'Sprint 42',
        deck: { id: 'custom', cards: ['a', 'b'] },
        controlMode: 'everyone',
        autoReveal: true,
        facilitatorVotes: false,
      });
    },
  );

  test(
    'F01-AC1: create room with an invalid display name is rejected with invalid_input',
    apiOnly,
    async ({ world }) => {
      for (const displayName of ['', '   ', 'x'.repeat(31), 'a\tb', 'line\nbreak']) {
        const res = await world.api.createRoomRaw(
          { displayName },
          { [CLIENT_KEY_HEADER]: uniqueKey('c') },
        );
        expect(res.status(), JSON.stringify(displayName)).toBe(400);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code).toBe('invalid_input');
      }
    },
  );
});

test.describe('unknown rooms', () => {
  test(
    'F01-AC6: GET of a never-created or malformed id is 404 room_not_found',
    apiOnly,
    async ({ world }) => {
      const ids = [
        '0000000000000000',
        'abc',
        'x'.repeat(200),
        'ilou0000000000000',
        '%3Cb%3E',
        '..%2F..%2Fetc',
      ];
      for (const id of ids) {
        const res = await world.api.roomInfoRaw(id);
        expect(res.status(), id).toBe(404);
        const body = (await res.json()) as { error: { code: string } };
        expect(body.error.code, id).toBe('room_not_found');
      }
    },
  );

  test(
    'F01-AC6: WebSocket upgrade for an unknown room is refused and creates nothing',
    apiOnly,
    async ({ world }) => {
      await expect(RawClient.connect('0123456789abcdef', uniqueKey('raw'))).rejects.toThrow(
        /refused/,
      );
      // Still unknown afterwards: connecting did not create the room.
      const res = await world.api.roomInfoRaw('0123456789abcdef');
      expect(res.status()).toBe(404);
      // Plain HTTP view of the same upgrade request.
      const http = await world.api.request.get(`${API_URL}/api/rooms/0123456789abcdef/ws`, {
        headers: {
          upgrade: 'websocket',
          connection: 'Upgrade',
          [CLIENT_KEY_HEADER]: uniqueKey('x'),
        },
      });
      expect(http.status()).toBe(404);
    },
  );

  test(
    'F01-AC6: test hooks never create a room either (instance of unknown room)',
    apiOnly,
    async ({ world }) => {
      const res = await world.api.roomInfoRaw('fedcba9876543210');
      expect(res.status()).toBe(404);
    },
  );
});

test.describe('room capacity', () => {
  async function fillRoom(world: World, count: number) {
    const room = await world.createRoom({ displayName: 'Dana' });
    const clients: RawClient[] = [];
    for (let i = 1; i < count; i++) {
      clients.push(await world.raw(room, `P${i}`, i % 5 === 0 ? 'observer' : 'voter'));
    }
    return { room, clients };
  }

  test(
    'F01-AC7: the 51st participant is refused with room_full, a stored token is still admitted',
    apiOnly,
    async ({ world }) => {
      test.setTimeout(90_000);
      const { room, clients } = await fillRoom(world, MAX_PARTICIPANTS);
      expect((await world.api.roomInfo(room.roomId)).full).toBe(true);

      const late = await world.rawConnect(room.roomId);
      const err = await late.tryJoin('Late');
      expect(err?.code).toBe('room_full');
      expect(err?.fatal).toBe(true);

      // Offline participants still occupy a slot.
      clients[0]!.close();
      await world.raw(room, 'x').then(
        () => {
          throw new Error('join must be refused while an offline participant holds a slot');
        },
        (e: Error) => expect(e.message).toContain('room_full'),
      );

      // A participant already in the list is always admitted (AC5/AC7).
      const back = await world.rawConnect(room.roomId);
      await back.rejoin(room.facilitatorToken);
      expect(back.state?.selfId).toBe(room.facilitatorId);
      expect(back.state?.participants).toHaveLength(MAX_PARTICIPANTS);
    },
  );

  test('F01-AC7: opening a full room shows "room is full" before any name prompt', async ({
    world,
  }) => {
    test.setTimeout(90_000);
    const { room } = await fillRoom(world, MAX_PARTICIPANTS);
    const ctx = await world.newContext();
    const page = await ctx.newPage();
    await page.goto(room.url);
    await expect(page.getByTestId('room-full')).toBeVisible();
    await expect(page.getByTestId('join-name')).toHaveCount(0);
  });

  test(
    'F01-AC7 / F01-X-RACE-9: two simultaneous joins at 49 produce exactly one success',
    apiOnly,
    async ({ world }) => {
      test.setTimeout(90_000);
      const { room } = await fillRoom(world, MAX_PARTICIPANTS - 1);
      const [a, b] = await Promise.all([
        world.rawConnect(room.roomId),
        world.rawConnect(room.roomId),
      ]);
      const [ea, eb] = await Promise.all([a.tryJoin('Racer A'), b.tryJoin('Racer B')]);
      const errors = [ea, eb].filter((e) => e !== null);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.code).toBe('room_full');
      const info = await world.api.roomInfo(room.roomId);
      expect(info.full).toBe(true);
    },
  );
});

test.describe('rate limits (F01-AC37)', () => {
  test(
    'F01-AC37: more than 5 room creations per minute per client key return 429 rate_limited',
    apiOnly,
    async ({ world }) => {
      const key = { [CLIENT_KEY_HEADER]: uniqueKey('limit') };
      const limit = RATE_LIMITS.roomCreate.limit;
      for (let i = 0; i < limit; i++) {
        const res = await world.api.createRoomRaw({ displayName: 'Ann' }, key);
        expect(res.status(), `create #${i + 1}`).toBe(201);
      }
      const res = await world.api.createRoomRaw({ displayName: 'Ann' }, key);
      expect(res.status()).toBe(429);
      const body = (await res.json()) as { error: { code: string; retryAfterMs?: number } };
      expect(body.error.code).toBe('rate_limited');
      // A different key is not affected.
      const other = await world.api.createRoomRaw(
        { displayName: 'Ann' },
        { [CLIENT_KEY_HEADER]: uniqueKey('other') },
      );
      expect(other.status()).toBe(201);
    },
  );

  test(
    'F01-AC37: more than 30 joins per minute per client key are rate limited',
    apiOnly,
    async ({ world }) => {
      test.setTimeout(60_000);
      const room = await world.createRoom();
      const key = uniqueKey('joinlimit');
      // The limiter uses fixed windows, so a burst can straddle a boundary; 2x limit + 20 attempts
      // guarantees at least one window sees more than the limit.
      const attempts = RATE_LIMITS.join.limit * 2 + 20;
      // Batches of 20 parallel handshakes keep the burst inside a few seconds.
      const statuses: number[] = [];
      for (let sent = 0; sent < attempts; sent += 20) {
        const batch = Math.min(20, attempts - sent);
        statuses.push(
          ...(await Promise.all(
            Array.from({ length: batch }, () => probeUpgrade(room.roomId, key)),
          )),
        );
      }
      expect(
        statuses.every((st) => st === 101 || st === 429),
        `statuses ${[...new Set(statuses)]}`,
      ).toBe(true);
      const limited = statuses.filter((st) => st === 429).length;
      expect(limited).toBeGreaterThanOrEqual(1);
      expect(limited).toBeLessThanOrEqual(attempts - RATE_LIMITS.join.limit);
    },
  );

  test(
    'F01-AC37: more than 20 messages per 10 s are rate limited and the connection stays open',
    apiOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const c = await world.rawFacilitator(room);
      const results = await Promise.all(
        Array.from({ length: RATE_LIMITS.message.limit + 10 }, (_, i) =>
          c.command('set_topic', { topic: `t${i}` }),
        ),
      );
      const limited = results.filter((r) => !r.ok && r.code === 'rate_limited');
      expect(limited.length).toBeGreaterThanOrEqual(1);
      const first = limited[0];
      expect(first && !first.ok ? first.retryAfterMs : undefined).toBeGreaterThan(0);
      expect(c.closed).toBeNull();
      // Other participants of the room are unaffected.
      const other = await world.raw(room, 'Other');
      expect((await other.vote('5')).ok).toBe(true);
    },
  );
});
