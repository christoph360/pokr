import { afterEach, describe, expect, it } from 'vitest';
import { createExecutionContext, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { PING_FRAME, PONG_FRAME, RATE_LIMITS, generateRoomId } from '@pokr/shared';
import app from '../src/index';
import { getRoomId, getRoomStub } from '../src/room-stub';
import {
  BASE,
  Client,
  api,
  closeAll,
  createRoom,
  env,
  expectAck,
  expectCode,
  freshKey,
  setTimers,
  setup,
  sleep,
} from './helpers';

afterEach(closeAll);

const online = (c: Client, pid: string) => c.state!.participants.find((p) => p.id === pid)?.online;

/** The app with test mode switched off (the variable is absent, as in staging and production). */
function envWithout(...names: string[]) {
  return new Proxy(env, {
    get: (t, p) =>
      names.includes(String(p)) ? undefined : (t as unknown as Record<string | symbol, unknown>)[p],
  });
}
async function appFetch(e: object, path: string, init: RequestInit = {}): Promise<Response> {
  return app.fetch(new Request(`${BASE}${path}`, init), e as typeof env, createExecutionContext());
}

describe('F01-AC21: presence', () => {
  it('a clean close shows offline within 1 s', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    const t0 = Date.now();
    bob.close();
    await fac.waitForState(
      (s) => online(fac, bob.participantId) === false && s.participants.length === 2,
      1000,
    );
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('F01-AC21: close and reconnect within the grace window never broadcasts offline', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    const seen = fac.messages.length;
    bob.close();
    const back = await Client.rejoin(id, bob.token); // a page reload
    await sleep(900); // past the grace window and the alarm
    const offline = fac.messages
      .slice(seen)
      .some((m) => m.type === 'state' && m.state.participants.some((p) => !p.online));
    expect(offline).toBe(false);
    expect(back.state!.participants.every((p) => p.online)).toBe(true);
  });

  it('F01-AC21: close without reconnect shows offline within 1 s via the alarm', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    const t0 = Date.now();
    bob.close();
    await fac.waitForState(() => online(fac, bob.participantId) === false, 1000);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('pings are answered with the exact pong frame and are not rate limited', async () => {
    const { id } = await setup();
    const bob = await Client.join(id, 'Bob');
    for (let i = 0; i < 60; i++) bob.sendRaw(PING_FRAME);
    for (let i = 0; i < 50 && bob.frames.filter((f) => f === PONG_FRAME).length < 60; i++)
      await sleep(20);
    expect(bob.frames.filter((f) => f === PONG_FRAME)).toHaveLength(60);
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
  });

  it('silent loss is detected after the heartbeat timeout; a reconnect before that causes no offline flicker', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { heartbeatTimeoutMs: 500 });
    const bob = await Client.join(id, 'Bob');
    const seen = fac.messages.length;
    // Bob's second connection takes over while the first is still (silently) counted.
    const bob2 = await Client.rejoin(id, bob.token);
    const keepAlive = setInterval(() => {
      bob2.send({ type: 'ping' });
      fac.send({ type: 'ping' });
    }, 100);
    try {
      await sleep(1200); // first connection goes stale and is closed by the server
      expect((await bob.waitForClose()).code).toBe(1001);
    } finally {
      clearInterval(keepAlive);
    }
    const flicker = fac.messages
      .slice(seen)
      .some(
        (m) =>
          m.type === 'state' &&
          m.state.participants.find((p) => p.id === bob.participantId)?.online === false,
      );
    expect(flicker).toBe(false);
    // Then both go silent: Bob is offline.
    const keepFac = setInterval(() => fac.send({ type: 'ping' }), 100);
    try {
      await fac.waitForState(() => online(fac, bob.participantId) === false, 4000);
    } finally {
      clearInterval(keepFac);
    }
  });

  it('purge: offline voters without a vote are removed after the purge time; their token is then invalid', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 200 });
    const bob = await Client.join(id, 'Bob');
    bob.close();
    await fac.waitForState((s) => s.participants.length === 1, 3000);
    const c = await Client.connect(id);
    c.send({ type: 'rejoin', token: bob.token });
    await c.waitFor((m) => m.type === 'error');
    expectCode(c.messages.at(-1)!, 'invalid_token');
  });

  it('purge: an offline participant with a vote stays until the first reset after the purge time', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 200 });
    const bob = await Client.join(id, 'Bob');
    await bob.cmd_({ type: 'vote', card: '5' });
    bob.close();
    await fac.waitForState(() => online(fac, bob.participantId) === false);
    await sleep(500);
    expect(fac.state!.participants).toHaveLength(2);
    expectAck(await fac.cmd_({ type: 'reset' }));
    expect(fac.state!.participants).toHaveLength(1);
  });

  it('purge: a reset before the purge time keeps an offline voter', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    await bob.cmd_({ type: 'vote', card: '5' });
    bob.close();
    await fac.waitForState(() => online(fac, bob.participantId) === false);
    expectAck(await fac.cmd_({ type: 'reset' }));
    expect(fac.state!.participants).toHaveLength(2);
  });

  it('purge: the facilitator is never purged', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 100 });
    const bob = await Client.join(id, 'Bob');
    fac.close();
    await bob.waitForState(() => online(bob, fac.participantId) === false);
    await sleep(500);
    expect(bob.state!.participants.map((p) => p.name)).toContain('Fac');
    expectAck(await bob.cmd_({ type: 'set_role', role: 'observer' }));
  });

  it('purge is applied lazily when nobody is connected (no wake-ups for idle rooms)', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 100 });
    const bob = await Client.join(id, 'Bob');
    bob.close();
    fac.close();
    await fac.waitForClose();
    await sleep(400);
    const stub = getRoomStub(env, id);
    expect(await runInDurableObject(stub, (_i, s) => s.storage.getAlarm())).toBeNull();
    const info = await (await api(`/api/rooms/${id}`)).json();
    expect(info).toMatchObject({ full: false });
    const back = await Client.rejoin(id, fac.token);
    expect(back.state!.participants.map((p) => p.name)).toEqual(['Fac']);
  });
});

describe('F01-AC25: facilitator claim', () => {
  it('opens after the threshold; first claim wins; the returning facilitator is a voter', async () => {
    const { id, fac, room } = await setup();
    await setTimers(id, { facilitatorClaimMs: 1000 });
    const bob = await Client.join(id, 'Bob');
    const cy = await Client.join(id, 'Cy', 'observer');
    expect(bob.state!.canClaimAt).toBeNull();
    expectCode(await bob.cmd_({ type: 'claim_facilitator' }), 'claim_not_available'); // facilitator online
    fac.close();
    const s = await bob.waitForState((st) => st.canClaimAt !== null);
    expect(s.canClaimAt! - s.serverTime).toBeLessThanOrEqual(1000);
    expectCode(await bob.cmd_({ type: 'claim_facilitator' }), 'claim_not_available'); // too early
    // The server pushes a fresh snapshot when claiming opens.
    const n = bob.messages.length;
    await bob.waitFor((m) => m.type === 'state' && m.state.serverTime >= s.canClaimAt!, n, 3000);
    const [a, b] = await Promise.all([
      bob.cmd_({ type: 'claim_facilitator' }),
      cy.cmd_({ type: 'claim_facilitator' }),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.type === 'ack')).toHaveLength(1);
    expectCode(
      results.find((r) => r.type === 'error')!,
      'already_claimed',
    );
    const winner = a.type === 'ack' ? bob : cy;
    expect(winner.state!.facilitatorId).toBe(winner.participantId);
    const back = await Client.rejoin(id, room.token);
    expect(back.state!.facilitatorId).toBe(winner.participantId);
    expect(back.state!.participants.find((p) => p.id === back.participantId)).toMatchObject({
      role: 'voter',
    });
    expectCode(await back.cmd_({ type: 'reveal' }), 'not_allowed');
    // A claim attempt long after the race window would be claim_not_available (facilitator online).
  });
});

describe('F01-AC30: state survives eviction with sockets open', () => {
  async function populated() {
    const s = await setup({ deck: { id: 'custom', cards: ['a1', 'b2'] }, controlMode: 'everyone' });
    const bob = await Client.join(s.id, 'Bob');
    const obs = await Client.join(s.id, 'Obs', 'observer');
    await s.fac.cmd_({ type: 'set_topic', topic: 'Persisted topic' });
    await bob.cmd_({ type: 'vote', card: 'b2' });
    return { ...s, bob, obs };
  }

  it('real hibernation (evictDurableObject): next messages use stored state and socket attachments', async () => {
    const { id, fac, bob, obs } = await populated();
    const before = fac.state!;
    await evictDurableObject(getRoomStub(env, id));
    // Bob (voter) changes his vote on the existing socket; identity comes from the attachment.
    expectAck(await bob.cmd_({ type: 'vote', card: 'a1' }));
    const after = await fac.waitForState((s) => s.version > before.version);
    expect(after.topic).toBe('Persisted topic');
    expect(after.settings).toEqual(before.settings);
    expect(after.participants.map((p) => [p.name, p.role, p.online])).toEqual([
      ['Fac', 'voter', true],
      ['Bob', 'voter', true],
      ['Obs', 'observer', true],
    ]);
    expectCode(await obs.cmd_({ type: 'reveal' }), 'not_allowed'); // observer role survived
    await evictDurableObject(getRoomStub(env, id));
    expectAck(await bob.cmd_({ type: 'reveal' })); // everyone-mode voter
    expect(fac.state!.round).toMatchObject({
      phase: 'revealed',
      votes: [{ participantId: bob.participantId, card: 'a1' }],
    });
    expect(bob.state!.myVote).toBe('a1');
  });

  it('test hook drop_memory: instance id changes, sockets stay, state intact', async () => {
    const { id, fac, bob } = await populated();
    const get = async () =>
      ((await (await api(`/api/__test/rooms/${id}/instance`)).json()) as { instanceId: string })
        .instanceId;
    const first = await get();
    const res = await api(`/api/__test/rooms/${id}/evict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'drop_memory' }),
    });
    expect(await res.json()).toEqual({ previousInstanceId: first });
    expect(await get()).not.toBe(first);
    expect(bob.closed).toBeNull();
    expectAck(await bob.cmd_({ type: 'vote', card: null }));
    const s = await fac.waitForState(
      (st) => !st.participants.find((p) => p.name === 'Bob')!.hasVoted,
    );
    expect(s.topic).toBe('Persisted topic');
    expect(s.participants).toHaveLength(3);
  });

  it('test hook abort: sockets close, state persists, rejoin works on a new instance', async () => {
    const { id, fac, bob, room } = await populated();
    const get = async () =>
      ((await (await api(`/api/__test/rooms/${id}/instance`)).json()) as { instanceId: string })
        .instanceId;
    const first = await get();
    const res = await api(`/api/__test/rooms/${id}/evict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'abort' }),
    });
    expect(res.status).toBe(200);
    await fac.waitForClose();
    await bob.waitForClose();
    const back = await Client.rejoin(id, room.token);
    expect(back.state!.topic).toBe('Persisted topic');
    expect(back.state!.participants.find((p) => p.name === 'Bob')).toMatchObject({
      hasVoted: true,
      online: false,
    });
    expect(await get()).not.toBe(first);
  });

  it('the version survives eviction and keeps increasing', async () => {
    const { id, fac } = await populated();
    const v = fac.state!.version;
    await evictDurableObject(getRoomStub(env, id));
    expectAck(await fac.cmd_({ type: 'set_topic', topic: 'again' }));
    expect(fac.state!.version).toBe(v + 1);
  });
});

describe('join timeout', () => {
  it('F01-AC29: a connection that never joins is closed after the (test-mode) join timeout', async () => {
    const { id } = await setup();
    await setTimers(id, { joinTimeoutMs: 300 });
    const idle = await Client.connect(id);
    const other = await Client.join(id, 'Bob'); // joined connections are not affected
    const close = await idle.waitForClose(3000);
    expect(close.code).toBe(4408);
    await sleep(300);
    expect(other.closed).toBeNull();
    // A connection that joins in time stays.
    const quick = await Client.connect(id);
    quick.send({ type: 'join', name: 'Quick', role: 'voter' });
    await quick.waitFor((m) => m.type === 'state');
    await sleep(600);
    expect(quick.closed).toBeNull();
  });
});

describe('F01-AC31: jurisdiction', () => {
  function fakeEnv() {
    const calls: string[] = [];
    const bare = env.ROOM;
    const boom = (n: string) => () => {
      throw new Error(`bare namespace used: ${n}`);
    };
    const ROOM = {
      idFromName: boom('idFromName'),
      newUniqueId: boom('newUniqueId'),
      get: boom('get'),
      jurisdiction(j: string) {
        calls.push(j);
        return {
          idFromName: (name: string) => ({ name, jurisdiction: j, real: bare.idFromName(name) }),
          get: (id: { real: DurableObjectId }) => bare.get(id.real),
        };
      },
    };
    return {
      calls,
      e: new Proxy(env, {
        get: (t, p) =>
          p === 'ROOM' ? ROOM : (t as unknown as Record<string | symbol, unknown>)[p],
      }),
    };
  }

  it('the helper returns an ID with jurisdiction "eu"', () => {
    const { e, calls } = fakeEnv();
    const id = getRoomId(e as typeof env, generateRoomId());
    expect(id.jurisdiction).toBe('eu');
    expect(calls).toEqual(['eu']);
  });

  it('create, info and WebSocket connect never touch the bare namespace', async () => {
    const { e, calls } = fakeEnv();
    const key = { 'x-pokr-test-client-key': freshKey() };
    const created = await appFetch(e, '/api/rooms', {
      method: 'POST',
      headers: { ...key, 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ann' }),
    });
    expect(created.status).toBe(201);
    const { roomId } = (await created.json()) as { roomId: string };
    expect((await appFetch(e, `/api/rooms/${roomId}`, { headers: key })).status).toBe(200);
    const ws = await appFetch(e, `/api/rooms/${roomId}/ws`, {
      headers: { ...key, Upgrade: 'websocket' },
    });
    expect(ws.status).toBe(101);
    ws.webSocket?.accept();
    ws.webSocket?.close();
    expect(await appFetch(e, `/api/__test/rooms/${roomId}/instance`)).toHaveProperty('status', 200);
    expect(calls.length).toBeGreaterThanOrEqual(4);
    expect(new Set(calls)).toEqual(new Set(['eu']));
  });

  it('a room created through the API is reachable on a later request (no silent second room)', async () => {
    const room = await createRoom('Ann');
    expect((await api(`/api/rooms/${room.roomId}`)).status).toBe(200);
    expect((await Client.rejoin(room.roomId, room.token)).state!.participants).toHaveLength(1);
  });
});

describe('test mode (hooks)', () => {
  it('all /api/__test routes are 404 unless POKR_TEST_MODE is "1"', async () => {
    const { id } = await setup();
    const off = envWithout('POKR_TEST_MODE');
    const paths: Array<[string, string]> = [
      ['POST', `/api/__test/rooms/${id}/timers`],
      ['POST', `/api/__test/rooms/${id}/evict`],
      ['GET', `/api/__test/rooms/${id}/instance`],
    ];
    for (const [method, path] of paths) {
      const res = await appFetch(off, path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'POST'
          ? { body: JSON.stringify({ mode: 'abort', heartbeatTimeoutMs: 100 }) }
          : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    // Other values are not test mode either.
    for (const value of ['0', 'true', 'yes', '']) {
      const e = new Proxy(env, {
        get: (t, p) =>
          p === 'POKR_TEST_MODE' ? value : (t as unknown as Record<string | symbol, unknown>)[p],
      });
      expect((await appFetch(e, `/api/__test/rooms/${id}/instance`)).status).toBe(404);
    }
    // ...and the room was not touched: no abort happened and the original connection still works.
    expect((await appFetch(env, `/api/__test/rooms/${id}/instance`)).status).toBe(200);
  });

  it('timer and evict hooks validate input and 404 for unknown rooms', async () => {
    const { id } = await setup();
    const post = (path: string, body: unknown) =>
      api(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post(`/api/__test/rooms/${id}/timers`, { heartbeatTimeoutMs: 1 })).status).toBe(
      400,
    );
    expect((await post(`/api/__test/rooms/${id}/timers`, { offlinePurgeMs: 'x' })).status).toBe(
      400,
    );
    expect((await post(`/api/__test/rooms/${id}/timers`, { offlinePurgeMs: 5000 })).status).toBe(
      204,
    );
    expect((await post(`/api/__test/rooms/${id}/evict`, { mode: 'explode' })).status).toBe(400);
    const other = generateRoomId();
    expect((await post(`/api/__test/rooms/${other}/timers`, { offlinePurgeMs: 5000 })).status).toBe(
      404,
    );
    expect((await post(`/api/__test/rooms/nope/timers`, {})).status).toBe(404);
  });

  it('the old /__test path is not served by the Worker', async () => {
    const { id } = await setup();
    expect((await appFetch(env, `/__test/rooms/${id}/instance`)).status).toBe(404);
  });
});

describe('F01-AC37: rate limits', () => {
  const create = (key: string, e: object = env, headers: Record<string, string> = {}) =>
    appFetch(e, '/api/rooms', {
      method: 'POST',
      headers: { 'x-pokr-test-client-key': key, 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ displayName: 'Ann' }),
    });

  it('5 room creations per minute per client key; the 6th is rate_limited', async () => {
    const key = freshKey();
    for (let i = 0; i < 5; i++) expect((await create(key)).status).toBe(201);
    const limited = await create(key);
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: { code: string; retryAfterMs: number } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterMs).toBeGreaterThan(0);
    expect(limited.headers.get('Retry-After')).not.toBeNull();
    expect((await create(freshKey())).status).toBe(201); // another client is unaffected
  });

  it('120 joins per minute count WebSocket upgrades only; GET info is not limited', async () => {
    const room = await createRoom();
    const key = freshKey();
    const get = () => api(`/api/rooms/${room.roomId}`, { key });
    for (let i = 0; i < 40; i++) expect((await get()).status).toBe(200);
    for (let i = 0; i < RATE_LIMITS.join.limit; i++) {
      const upgrade = await exports_ws(room.roomId, key);
      expect(upgrade.status).toBe(101);
      upgrade.webSocket?.accept();
      upgrade.webSocket?.close();
    }
    const limited = await exports_ws(room.roomId, key);
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
    expect((await get()).status).toBe(200);
  });

  it('outside test mode the x-pokr-test-client-key header is ignored (the IP is the key)', async () => {
    const off = envWithout('POKR_TEST_MODE');
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}-${freshKey()}`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await create(freshKey(), off, { 'CF-Connecting-IP': ip })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    // And without any IP header the key is "unknown", shared by everyone.
    const unknownStatuses: number[] = [];
    for (let i = 0; i < 7; i++) unknownStatuses.push((await create(freshKey(), off)).status);
    expect(unknownStatuses).toContain(429);
  });

  it('the cookie works as the key in test mode only; the header wins over the cookie', async () => {
    const cookie = `x-pokr-test-client-key=${freshKey()}`;
    const viaCookie = () =>
      appFetch(env, '/api/rooms', {
        method: 'POST',
        headers: { Cookie: `a=b; ${cookie}`, 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: 'Ann' }),
      });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await viaCookie()).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    // A header with another key takes precedence over the exhausted cookie key.
    expect((await create(freshKey(), env, { Cookie: cookie })).status).toBe(201);
    // Outside test mode the cookie is ignored: the IP is the key.
    const off = envWithout('POKR_TEST_MODE');
    const ip = `192.0.2.1-${freshKey()}`;
    const out: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await appFetch(off, '/api/rooms', {
        method: 'POST',
        headers: {
          Cookie: `x-pokr-test-client-key=${freshKey()}`,
          'CF-Connecting-IP': ip,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ displayName: 'Ann' }),
      });
      out.push(res.status);
    }
    expect(out).toEqual([201, 201, 201, 201, 201, 429]);
  });

  it('in test mode the header replaces the IP', async () => {
    const ip = `198.51.100.1-${freshKey()}`;
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++)
      statuses.push((await create(freshKey(), env, { 'CF-Connecting-IP': ip })).status);
    expect(statuses.every((s) => s === 201)).toBe(true);
  });

  it('a failing limiter binding fails open instead of breaking the API', async () => {
    const broken = new Proxy(env, {
      get: (t, p) =>
        p === 'RATE_LIMIT_CREATE'
          ? { limit: () => Promise.reject(new Error('down')) }
          : (t as unknown as Record<string | symbol, unknown>)[p],
    });
    expect((await create(freshKey(), broken)).status).toBe(201);
  });

  it('20 messages per 10 s per connection: rate_limited, connection stays open, others unaffected', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    const replies = await Promise.all(
      Array.from({ length: 25 }, () => bob.cmd_({ type: 'vote', card: '3' })),
    );
    // The join consumed one slot; 19 votes fit, the rest are limited.
    const limited = replies.filter((r) => r.type === 'error' && r.code === 'rate_limited');
    expect(limited.length).toBeGreaterThanOrEqual(5);
    expect(limited[0]).toMatchObject({ fatal: false });
    expect((limited[0] as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
    expect(bob.closed).toBeNull();
    expectAck(await fac.cmd_({ type: 'vote', card: '1' })); // another connection is fine
  });
});

async function exports_ws(roomId: string, key: string): Promise<Response> {
  return appFetch(env, `/api/rooms/${roomId}/ws`, {
    headers: { Upgrade: 'websocket', 'x-pokr-test-client-key': key },
  });
}
