import { MAX_MESSAGE_CHARS, TOPIC_MAX } from '@pokr/shared';
import { expect, test } from '../fixtures';

// Server-side validation and handshake negatives, driven by raw clients (browser independent).
const tag = { tag: '@chromium-only' };

test.describe('handshake', () => {
  test(
    'F01-AC4: server rejects invalid display names on join (31 chars, blank, tab, newline)',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      for (const name of ['x'.repeat(31), '   ', '', 'a\tb', 'a\nb']) {
        const c = await world.rawConnect(room.roomId);
        const err = await c.tryJoin(name);
        expect(err?.code, JSON.stringify(name)).toBe('invalid_input');
      }
      const ok = await world.rawConnect(room.roomId);
      expect(await ok.tryJoin('x'.repeat(30))).toBeNull();
      const one = await world.rawConnect(room.roomId);
      expect(await one.tryJoin('x')).toBeNull();
    },
  );

  test(
    'F01-AC4: text normalization trims and collapses whitespace in names',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const c = await world.raw(room, '  Ann    Lee  ');
      const me = c.state!.participants.find((p) => p.id === c.state!.selfId);
      expect(me?.name).toBe('Ann Lee');
    },
  );

  test('F01-AC4: join with an invalid role is rejected', tag, async ({ world }) => {
    const room = await world.createRoom();
    const c = await world.rawConnect(room.roomId);
    c.send({ type: 'join', name: 'Bob', role: 'facilitator' });
    await c.waitUntil(() => c.errors().length > 0, 'error');
    expect(c.errors()[0]?.code).toBe('invalid_input');
  });

  test(
    'F01-AC29: commands before join get not_joined; a second join gets already_joined',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const c = await world.rawConnect(room.roomId);
      const early = await c.command('vote', { card: '5' });
      expect(early.ok ? 'ok' : early.code).toBe('not_joined');
      await c.join('Bob');
      c.send({ type: 'join', name: 'Bob2', role: 'voter' });
      await c.waitUntil(
        () => c.errors().some((e) => e.code === 'already_joined'),
        'already_joined',
      );
      const rejoin = await c.command('set_topic', { topic: 'still works?' });
      expect(rejoin.ok ? 'ok' : rejoin.code).toBe('not_allowed');
    },
  );

  test(
    'F01-AC5: rejoin with an unknown token gets a fatal invalid_token',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const c = await world.rawConnect(room.roomId);
      c.send({ type: 'rejoin', token: 'A'.repeat(43) });
      await c.waitUntil(() => c.errors().length > 0, 'error');
      expect(c.errors()[0]).toMatchObject({ code: 'invalid_token', fatal: true });
      await c.waitForClose();
    },
  );

  test('F01-AC5: a token of another room is not valid here', tag, async ({ world }) => {
    const a = await world.createRoom();
    const b = await world.createRoom();
    const c = await world.rawConnect(b.roomId);
    c.send({ type: 'rejoin', token: a.facilitatorToken });
    await c.waitUntil(() => c.errors().length > 0, 'error');
    expect(c.errors()[0]?.code).toBe('invalid_token');
  });

  test(
    'F01-AC29: a connection that never joins is closed after the join timeout',
    tag,
    async ({ world }) => {
      test.setTimeout(40_000);
      const room = await world.createRoom({ timers: { joinTimeoutMs: 500 } });
      const c = await world.rawConnect(room.roomId);
      // Under wrangler dev a client that sent no frame observes the close about 10 s late
      // (workerd quirk, verify on staging), so the window is generous.
      const closed = await c.waitForClose(25_000);
      expect(closed.code).toBe(4408);
    },
  );
});

test.describe('malformed input after join', () => {
  test(
    'F01-AC10: malformed JSON, unknown type, wrong field types and binary frames leave the room intact',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const before = fac.state!;
      const probes: string[] = [
        '{not json',
        '[]',
        'null',
        JSON.stringify({ type: 'nope', id: '1' }),
        JSON.stringify({ type: 'vote' }),
        JSON.stringify({ type: 'vote', id: 5, card: '5' }),
        JSON.stringify({ type: 'vote', id: 'a', card: 5 }),
        JSON.stringify({ type: 'set_topic', id: 'a', topic: { $ne: 1 } }),
      ];
      for (const p of probes) fac.sendRaw(p);
      const after = await fac.command('set_topic', { topic: 'alive' });
      expect(after.ok).toBe(true);
      await fac.waitForState((s) => s.topic === 'alive', 'topic set');
      expect(fac.closed).toBeNull();
      expect(fac.state!.round).toEqual(before.round);
      expect(fac.state!.settings).toEqual(before.settings);
      for (const f of fac.frames) {
        // No stack traces or internals to the client.
        expect(f.text).not.toMatch(/\bat \S+ \(|node_modules|\.ts:\d+|stack/i);
      }
    },
  );

  test(
    'F01-AC10: an oversize frame and a binary frame are refused without corrupting state',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      fac.sendRaw(
        JSON.stringify({ type: 'set_topic', id: 'big', topic: 'x'.repeat(MAX_MESSAGE_CHARS + 10) }),
      );
      fac.ws.send(new Uint8Array([1, 2, 3, 4]));
      // Either the connection stays usable or it is closed with a defined code; state is intact.
      const probe = await world.raw(room, 'Probe');
      await probe.waitForState((s) => s.participants.length === 2, 'both listed');
      expect(probe.state!.topic).toBe('');
      if (fac.closed === null) {
        const r = await fac.command('set_topic', { topic: 'after' }).catch(() => null);
        if (r) expect(r.ok).toBe(true);
      }
    },
  );

  test(
    'F01-AC11 / F01-AC10: voting for a card outside the deck is rejected with invalid_card',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const c = await world.rawFacilitator(room);
      for (const card of ['99', '4', 'xl', '☕️x']) {
        const r = await c.vote(card);
        expect(r.ok ? 'ok' : r.code, card).toBe('invalid_card');
      }
      expect(c.state!.myVote).toBeNull();
      expect((await c.vote('½')).ok).toBe(true);
      await c.waitForState((s) => s.myVote === '½', 'half vote stored');
    },
  );

  test('F01-AC12: observers cannot vote (not_allowed)', tag, async ({ world }) => {
    const room = await world.createRoom();
    const obs = await world.raw(room, 'Olga', 'observer');
    const r = await obs.vote('5');
    expect(r.ok ? 'ok' : r.code).toBe('not_allowed');
    expect(obs.state!.myVote).toBeNull();
  });

  test(
    'F01-AC20: topic limit 200 graphemes, newlines rejected, empty clears',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      expect((await fac.command('set_topic', { topic: 'é'.repeat(TOPIC_MAX) })).ok).toBe(true);
      const long = await fac.command('set_topic', { topic: 'é'.repeat(TOPIC_MAX + 1) });
      expect(long.ok ? 'ok' : long.code).toBe('invalid_input');
      const nl = await fac.command('set_topic', { topic: 'a\nb' });
      expect(nl.ok ? 'ok' : nl.code).toBe('invalid_input');
      expect(fac.state!.topic).toHaveLength(TOPIC_MAX);
      expect((await fac.command('set_topic', { topic: '   ' })).ok).toBe(true);
      await fac.waitForState((s) => s.topic === '', 'topic cleared');
    },
  );

  test('F01-AC20: emoji (ZWJ sequences) count as one grapheme', tag, async ({ world }) => {
    const room = await world.createRoom();
    const fac = await world.rawFacilitator(room);
    const family = '👨‍👩‍👧‍👦';
    expect((await fac.command('set_topic', { topic: family.repeat(TOPIC_MAX) })).ok).toBe(true);
    const over = await fac.command('set_topic', { topic: family.repeat(TOPIC_MAX + 1) });
    expect(over.ok ? 'ok' : over.code).toBe('invalid_input');
  });

  test('F01-AC3: room name limit 80, 81 rejected', tag, async ({ world }) => {
    const room = await world.createRoom();
    const fac = await world.rawFacilitator(room);
    expect((await fac.command('update_settings', { settings: { name: 'n'.repeat(80) } })).ok).toBe(
      true,
    );
    const r = await fac.command('update_settings', { settings: { name: 'n'.repeat(81) } });
    expect(r.ok ? 'ok' : r.code).toBe('invalid_input');
    expect((await fac.command('update_settings', { settings: { name: '' } })).ok).toBe(true);
    await fac.waitForState((s) => s.settings.name === 'Planning session', 'fallback name');
  });

  test('F01-AC27: settings outside the enums are rejected', tag, async ({ world }) => {
    const room = await world.createRoom();
    const fac = await world.rawFacilitator(room);
    for (const settings of [
      { deck: { id: 'bogus' } },
      { controlMode: 'nobody' },
      { autoReveal: 'yes' },
      { facilitatorVotes: 1 },
    ]) {
      const r = await fac.command('update_settings', { settings });
      expect(r.ok ? 'ok' : r.code, JSON.stringify(settings)).toBe('invalid_input');
    }
  });

  test(
    'F01-AC34: custom deck validation (count, length, duplicates, specials, blanks)',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const bad: unknown[] = [
        [],
        Array.from({ length: 21 }, (_, i) => `c${i}`),
        ['ok', ''],
        ['ok', '   '],
        ['12345'],
        ['A', 'a'],
        ['x', '?'],
        ['x', '☕'],
      ];
      for (const cards of bad) {
        const r = await fac.command('update_settings', {
          settings: { deck: { id: 'custom', cards } },
        });
        expect(r.ok ? 'ok' : r.code, JSON.stringify(cards)).toBe('invalid_input');
      }
      const good = ['a', 'bbbb', ...Array.from({ length: 18 }, (_, i) => `c${i}`)];
      expect(
        (
          await fac.command('update_settings', {
            settings: { deck: { id: 'custom', cards: good } },
          })
        ).ok,
      ).toBe(true);
      await fac.waitForState((s) => s.settings.deck.id === 'custom', 'custom deck applied');
      // 4 graphemes: a ZWJ family emoji counts as one.
      const emoji = ['👨‍👩‍👧‍👦', '½☕12'];
      const r = await fac.command('update_settings', {
        settings: { deck: { id: 'custom', cards: emoji } },
        confirmReset: true,
      });
      expect(r.ok).toBe(true);
    },
  );

  test(
    'F01-AC13: reveal, reset, topic, settings, remove, hand over by an unauthorised participant are not_allowed',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const voter = await world.raw(room, 'Vera');
      const obs = await world.raw(room, 'Olga', 'observer');
      const target = fac.state!.selfId;
      for (const who of [voter, obs]) {
        for (const [type, fields] of [
          ['reveal', {}],
          ['reset', {}],
          ['set_topic', { topic: 'x' }],
          ['update_settings', { settings: { autoReveal: true } }],
          ['remove_participant', { participantId: target }],
          ['hand_over', { participantId: who.state!.selfId }],
        ] as const) {
          const r = await who.command(type, { ...fields });
          expect(r.ok ? 'ok' : r.code, `${type} by ${who === voter ? 'voter' : 'observer'}`).toBe(
            'not_allowed',
          );
        }
      }
      expect(fac.state!.round.phase).toBe('voting');
    },
  );

  test(
    'F01-AC13: in everyone mode voters reveal and reset, observers still cannot, topic and settings stay facilitator-only',
    tag,
    async ({ world }) => {
      const room = await world.createRoom({ settings: { controlMode: 'everyone' } });
      await world.rawFacilitator(room);
      const voter = await world.raw(room, 'Vera');
      const obs = await world.raw(room, 'Olga', 'observer');
      const o = await obs.command('reveal');
      expect(o.ok ? 'ok' : o.code).toBe('not_allowed');
      const t = await voter.command('set_topic', { topic: 'x' });
      expect(t.ok ? 'ok' : t.code).toBe('not_allowed');
      const s = await voter.command('update_settings', {
        settings: { controlMode: 'facilitator' },
      });
      expect(s.ok ? 'ok' : s.code).toBe('not_allowed');
      expect((await voter.command('reveal')).ok).toBe(true);
      await voter.waitForState((st) => st.round.phase === 'revealed', 'revealed');
      expect((await voter.command('reset')).ok).toBe(true);
      await voter.waitForState((st) => st.round.phase === 'voting', 'voting again');
    },
  );

  test(
    'F01-AC23 / F01-AC24: unknown targets are rejected with unknown_target',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      for (const type of ['remove_participant', 'hand_over']) {
        const r = await fac.command(type, { participantId: 'does-not-exist' });
        expect(r.ok ? 'ok' : r.code, type).toBe('unknown_target');
      }
    },
  );

  test('F01-AC25: claiming while the facilitator is online is rejected', tag, async ({ world }) => {
    const room = await world.createRoom();
    await world.rawFacilitator(room);
    const voter = await world.raw(room, 'Vera');
    const r = await voter.command('claim_facilitator');
    expect(r.ok ? 'ok' : r.code).toBe('claim_not_available');
    expect(voter.state!.canClaimAt).toBeNull();
  });
});
