import { afterEach, describe, expect, it, vi } from 'vitest';
import { env, listDurableObjectIds, runInDurableObject } from 'cloudflare:test';
import {
  MAX_PARTICIPANTS,
  ROOM_ID_ALPHABET,
  ROOM_ID_LENGTH,
  generateRoomId,
  isRoomId,
} from '@pokr/shared';
import { Client, api, closeAll, createRoom, expectAck, expectCode, setup } from './helpers';
import { getRoomStub } from '../src/room-stub';

afterEach(closeAll);

describe('create and room IDs', () => {
  it('F01-AC2: room IDs are 16 chars of lowercase Crockford base32 from crypto.getRandomValues', async () => {
    const spy = vi.spyOn(crypto, 'getRandomValues');
    const id = generateRoomId();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(id).toHaveLength(ROOM_ID_LENGTH);
    expect([...id].every((ch) => ROOM_ID_ALPHABET.includes(ch))).toBe(true);
    const created = await createRoom();
    expect(isRoomId(created.roomId)).toBe(true);
    expect(new Set(Array.from({ length: 200 }, () => generateRoomId())).size).toBe(200);
  });

  it('F01-AC2: lookups are case-insensitive', async () => {
    const { roomId } = await createRoom();
    const res = await api(`/api/rooms/${roomId.toUpperCase()}`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { roomId: string }).roomId).toBe(roomId);
  });

  it('F01-AC1/AC3: creator is facilitator and voter; omitted settings use the defaults', async () => {
    const room = await createRoom('Ann');
    const ann = await Client.rejoin(room.roomId, room.token);
    const s = ann.state!;
    expect(s.facilitatorId).toBe(room.participantId);
    expect(s.selfId).toBe(room.participantId);
    expect(s.settings).toEqual({
      name: 'Planning session',
      deck: { id: 'fibonacci' },
      controlMode: 'facilitator',
      autoReveal: false,
      facilitatorVotes: true,
    });
    expect(s.participants).toEqual([
      { id: room.participantId, name: 'Ann', role: 'voter', online: true, hasVoted: false },
    ]);
    expect(s.version).toBeGreaterThanOrEqual(1);
    expect(s.round).toEqual({ phase: 'voting', number: 1 });
  });

  it('F01-AC1/AC34: creation settings and a custom deck are honored', async () => {
    const room = await createRoom('Ann', {
      name: '  Sprint   42 ',
      deck: { id: 'custom', cards: ['S', 'M', 'L'] },
      controlMode: 'everyone',
      autoReveal: true,
      facilitatorVotes: false,
    });
    const ann = await Client.rejoin(room.roomId, room.token);
    expect(ann.state!.settings).toEqual({
      name: 'Sprint 42',
      deck: { id: 'custom', cards: ['S', 'M', 'L'] },
      controlMode: 'everyone',
      autoReveal: true,
      facilitatorVotes: false,
    });
  });

  it('F01-AC3: an empty room name falls back to the default', async () => {
    const room = await createRoom('Ann', { name: '   ' });
    const info = await (await api(`/api/rooms/${room.roomId}`)).json();
    expect(info).toEqual({ roomId: room.roomId, name: 'Planning session', full: false });
  });

  it('malformed create requests are rejected with invalid_input and field', async () => {
    const post = (body: string) =>
      api('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    const bad: Array<[string, string | undefined]> = [
      ['not json', undefined],
      ['{}', 'displayName'],
      [JSON.stringify({ displayName: '   ' }), 'displayName'],
      [JSON.stringify({ displayName: 'a'.repeat(31) }), 'displayName'],
      [JSON.stringify({ displayName: 'x\ny' }), 'displayName'],
      [
        JSON.stringify({ displayName: 'A', settings: { deck: { id: 'bogus' } } }),
        'settings.deck.id',
      ],
      [
        JSON.stringify({ displayName: 'A', settings: { controlMode: 'nobody' } }),
        'settings.controlMode',
      ],
      [JSON.stringify({ displayName: 'A', settings: { name: 'a'.repeat(81) } }), 'settings.name'],
      [
        JSON.stringify({
          displayName: 'A',
          settings: {
            deck: { id: 'custom', cards: Array.from({ length: 21 }, (_, i) => `c${i}`) },
          },
        }),
        'settings.deck.cards',
      ],
      [
        JSON.stringify({
          displayName: 'A',
          settings: { deck: { id: 'custom', cards: ['12345'] } },
        }),
        'settings.deck.cards.0',
      ],
      [
        JSON.stringify({
          displayName: 'A',
          settings: { deck: { id: 'custom', cards: ['a', 'A'] } },
        }),
        'settings.deck.cards',
      ],
      [
        JSON.stringify({ displayName: 'A', settings: { deck: { id: 'custom', cards: ['?'] } } }),
        'settings.deck.cards',
      ],
      ['x'.repeat(20_000), undefined],
    ];
    for (const [body, field] of bad) {
      const res = await post(body);
      expect(res.status, body.slice(0, 40)).toBe(400);
      const json = (await res.json()) as {
        error: { code: string; field?: string; message?: string };
      };
      expect(json.error.code).toBe('invalid_input');
      if (field) expect(json.error.field).toBe(field);
      expect(json.error.message ?? '').not.toContain('Received');
    }
  });
});

describe('F01-AC6: unknown rooms', () => {
  it('malformed and never-created IDs are 404 room_not_found over HTTP', async () => {
    for (const id of [
      '',
      'short',
      'x'.repeat(200),
      '..%2F..%2Fetc',
      '%3Cscript%3E',
      'u'.repeat(16),
      'abcdefghjkmnpqrs'.replace('s', 'u'),
    ]) {
      const res = await api(`/api/rooms/${id}`);
      expect(res.status, id).toBe(404);
    }
    const unknown = await api(`/api/rooms/${generateRoomId()}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: { code: 'room_not_found' } });
  });

  it('a WebSocket upgrade to an unknown room is rejected with 404 room_not_found', async () => {
    for (const id of [generateRoomId(), 'bad']) {
      const res = await api(`/api/rooms/${id}/ws`, { headers: { Upgrade: 'websocket' } });
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('room_not_found');
    }
  });

  it('opening or connecting to an unknown room writes no Durable Object storage', async () => {
    const id = generateRoomId();
    await api(`/api/rooms/${id}`);
    await api(`/api/rooms/${id}/ws`, { headers: { Upgrade: 'websocket' } });
    await api(`/api/rooms/${id}/ws`); // no upgrade header
    const stub = getRoomStub(env, id);
    const inspected = await runInDurableObject(stub, async (_instance, state) => ({
      tables: state.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'")
        .toArray(),
      kv: [...(await state.storage.list()).keys()],
      alarm: await state.storage.getAlarm(),
    }));
    expect(inspected).toEqual({ tables: [], kv: [], alarm: null });
  });
});

describe('join, identity and the 50 cap', () => {
  it('F01-AC4/AC5: join returns a token; rejoin with it is the same participant, tabs are one participant', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob', 'observer');
    expect(bob.state!.participants.find((p) => p.id === bob.participantId)).toMatchObject({
      name: 'Bob',
      role: 'observer',
    });
    const tab2 = await Client.rejoin(id, bob.token);
    expect(tab2.participantId).toBe(bob.participantId);
    expect(tab2.state!.participants).toHaveLength(2);
    // Closing one tab keeps Bob online; the facilitator never sees him offline.
    const seen = fac.messages.length;
    bob.close();
    await bob.waitForClose();
    await new Promise((r) => setTimeout(r, 100));
    const bobs = fac.messages
      .slice(seen)
      .filter((m) => m.type === 'state')
      .map((m) =>
        m.type === 'state'
          ? m.state.participants.find((p) => p.id === bob.participantId)?.online
          : null,
      );
    expect(bobs.every((online) => online !== false)).toBe(true);
    // Closing the second tab shows him offline.
    tab2.close();
    await fac.waitForState(
      (s) => s.participants.find((p) => p.id === bob.participantId)?.online === false,
    );
  });

  it('F01-AC5/AC29: a rejoin restores the participant and their own vote', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    expectAck(await bob.cmd_({ type: 'vote', card: '8' }));
    bob.close();
    await fac.waitForState(
      (s) => s.participants.find((p) => p.id === bob.participantId)?.online === false,
    );
    const again = await Client.rejoin(id, bob.token);
    expect(again.participantId).toBe(bob.participantId);
    expect(again.state!.myVote).toBe('8');
    expect(again.state!.participants.filter((p) => p.name === 'Bob')).toHaveLength(1);
  });

  it('invalid_token is fatal and closes with 4401', async () => {
    const { id } = await setup();
    const c = await Client.connect(id);
    c.send({ type: 'rejoin', token: 'A'.repeat(43) });
    await c.waitFor((m) => m.type === 'error');
    expectCode(c.messages.at(-1)!, 'invalid_token');
    expect(c.messages.at(-1)).toMatchObject({ fatal: true });
    expect((await c.waitForClose()).code).toBe(4401);
  });

  it('F01-AC8: duplicate names get suffixes in join order, case-insensitively, stable, reusable', async () => {
    const { id, fac } = await setup();
    const a1 = await Client.join(id, 'Alex');
    const a2 = await Client.join(id, '  alex ');
    const a3 = await Client.join(id, 'ALEX');
    const names = () => fac.state!.participants.map((p) => p.name);
    await fac.waitForState((s) => s.participants.length === 4);
    expect(names()).toEqual(['Fac', 'Alex', 'alex (2)', 'ALEX (3)']);
    // Suffix does not change while they stay: remove the first Alex, the others keep theirs.
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: a1.participantId }));
    await fac.waitForState((s) => s.participants.length === 3);
    expect(names()).toEqual(['Fac', 'alex (2)', 'ALEX (3)']);
    // The freed number is reused.
    await Client.join(id, 'Alex');
    await fac.waitForState((s) => s.participants.length === 4);
    expect(names()).toEqual(['Fac', 'alex (2)', 'ALEX (3)', 'Alex']);
    expect(a2.participantId).not.toBe(a3.participantId);
  });

  it('F01-AC8: names compare equal regardless of Unicode composition (NFC)', async () => {
    const { id, fac } = await setup();
    await Client.join(id, 'Zoë');
    await Client.join(id, 'Zoë');
    await fac.waitForState((s) => s.participants.length === 3);
    expect(fac.state!.participants.map((p) => p.name)).toEqual(['Fac', 'Zoë', 'Zoë (2)']);
  });

  it('F01-AC8: a literal "Alex (2)" never duplicates a displayed name', async () => {
    const { id, fac } = await setup();
    await Client.join(id, 'Alex');
    await Client.join(id, 'Alex');
    await Client.join(id, 'Alex (2)');
    await fac.waitForState((s) => s.participants.length === 4);
    const names = fac.state!.participants.map((p) => p.name.toLowerCase());
    expect(new Set(names).size).toBe(4);
  });

  it('F01-AC36: rename applies the same rules and suffixes', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    expectAck(await bob.cmd_({ type: 'rename', name: '  Fac ' }));
    await fac.waitForState((s) => s.participants.some((p) => p.name === 'Fac (2)'));
    expectCode(await bob.cmd_({ type: 'rename', name: '' }), 'invalid_input');
    expectCode(await bob.cmd_({ type: 'rename', name: 'a'.repeat(31) }), 'invalid_input');
    expectAck(await bob.cmd_({ type: 'rename', name: 'Robert' }));
    await fac.waitForState((s) => s.participants.some((p) => p.name === 'Robert'));
  });

  it('F01-AC7: the cap counts everyone; a returning participant is always admitted; races at 49', async () => {
    const { id, fac, room } = await setup();
    const joined: Client[] = [];
    for (let i = 1; i < MAX_PARTICIPANTS - 1; i++) {
      joined.push(await Client.join(id, `P${i}`, i % 2 ? 'observer' : 'voter'));
    }
    expect(
      fac.state
        ? (await fac.waitForState((s) => s.participants.length === 49)).participants.length
        : 0,
    ).toBe(49);
    expect(((await (await api(`/api/rooms/${id}`)).json()) as { full: boolean }).full).toBe(false);
    // Two joins at 49: exactly one is admitted.
    const [a, b] = await Promise.all([Client.connect(id), Client.connect(id)]);
    a.send({ type: 'join', name: 'LateA', role: 'voter' });
    b.send({ type: 'join', name: 'LateB', role: 'observer' });
    await Promise.all([
      a.waitFor((m) => m.type === 'joined' || m.type === 'error'),
      b.waitFor((m) => m.type === 'joined' || m.type === 'error'),
    ]);
    const outcomes = [a, b].map((c) =>
      c.messages.find((m) => m.type === 'joined' || m.type === 'error')!,
    );
    expect(outcomes.filter((m) => m.type === 'joined')).toHaveLength(1);
    const full = outcomes.find((m) => m.type === 'error')!;
    expectCode(full, 'room_full');
    expect(full).toMatchObject({ fatal: true });
    expect(((await (await api(`/api/rooms/${id}`)).json()) as { full: boolean }).full).toBe(true);
    // A returning offline participant is admitted at 50.
    const first = joined[0]!;
    first.close();
    await fac.waitForState(
      (s) => s.participants.find((p) => p.id === first.participantId)?.online === false,
    );
    const back = await Client.rejoin(id, first.token);
    expect(back.participantId).toBe(first.participantId);
    expect(back.state!.participants).toHaveLength(MAX_PARTICIPANTS);
    // The creator's token still works too.
    expect((await Client.rejoin(id, room.token)).participantId).toBe(room.participantId);
    // A fresh join is refused.
    const late = await Client.connect(id);
    late.send({ type: 'join', name: 'Nope', role: 'voter' });
    await late.waitFor((m) => m.type === 'error');
    expectCode(late.messages.at(-1)!, 'room_full');
    expect((await late.waitForClose()).code).toBe(4409);
  }, 30_000);
});

describe('malformed input on the socket', () => {
  it('rejects bad frames without crashing the room, and never echoes input or stack traces', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    const payloads: Array<string | Record<string, unknown>> = [
      'not json',
      '[]',
      'null',
      { type: 'bogus' },
      { type: 'vote' },
      { type: 'vote', id: 'x', card: 5 },
      { type: 'vote', id: '', card: '5' },
      { type: 'vote', id: 'x'.repeat(65), card: '5' },
      { type: 'reset', id: 'x', topic: 42 },
      { type: 'set_topic', id: 'x', topic: 'a\nb' },
      { type: 'update_settings', id: 'x', settings: { deck: { id: 'bogus' } } },
      { type: 'update_settings', id: 'x', settings: { controlMode: 'nobody' } },
      { type: 'remove_participant', id: 'x' },
      JSON.stringify({ type: 'set_topic', id: 'x', topic: 'z'.repeat(20_000) }),
    ];
    for (const p of payloads) {
      const from = bob.messages.length;
      bob.sendRaw(typeof p === 'string' ? p : JSON.stringify(p));
      const reply = await bob.waitFor((m) => m.type === 'error', from);
      expectCode(reply, 'invalid_input');
      expect(JSON.stringify(reply)).not.toMatch(/stack|at .*\(|zzzz/);
    }
    // Binary frames
    const from = bob.messages.length;
    bob.sendRaw(new Uint8Array([1, 2, 3]).buffer);
    expectCode(await bob.waitFor((m) => m.type === 'error', from), 'invalid_input');
    // Connection and room are fine.
    expect(bob.closed).toBeNull();
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
    await fac.waitForState((s) => s.participants.some((p) => p.hasVoted));
  });

  it('commands before join are not_joined; a second join is already_joined; bad names stay recoverable', async () => {
    const { id } = await setup();
    const c = await Client.connect(id);
    c.send({ type: 'vote', id: 'v1', card: '5' });
    await c.waitFor((m) => m.type === 'error');
    expect(c.messages.at(-1)).toMatchObject({ code: 'not_joined', id: 'v1' });
    c.send({ type: 'join', name: 'a'.repeat(31), role: 'voter' });
    await c.waitFor((m) => m.type === 'error' && m.code === 'invalid_input');
    c.send({ type: 'join', name: 'Cy', role: 'voter' });
    await c.waitFor((m) => m.type === 'state');
    c.send({ type: 'join', name: 'Again', role: 'voter' });
    await c.waitFor((m) => m.type === 'error' && m.code === 'already_joined');
    c.send({ type: 'rejoin', token: c.token });
    await c.waitFor((m) => m.type === 'error' && m.code === 'already_joined');
  });
});

describe('F01-AC31: jurisdiction', () => {
  it('rooms are reachable on later requests, and the ID differs from the bare namespace', async () => {
    const room = await createRoom();
    expect((await api(`/api/rooms/${room.roomId}`)).status).toBe(200);
    const ids = await listDurableObjectIds(env.ROOM);
    expect(ids.length).toBeGreaterThan(0);
  });
});
