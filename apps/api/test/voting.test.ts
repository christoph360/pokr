import { afterEach, describe, expect, it, vi } from 'vitest';
import { votedCounter } from '@pokr/shared';
import type { RoomState, ServerMessage } from '@pokr/shared';
import { env, evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { getRoomStub } from '../src/room-stub';
import { TOMBSTONE_MAX } from '../src/store';
import type { RoomStore } from '../src/store';
import { Client, api, closeAll, expectAck, expectCode, setTimers, setup } from './helpers';

afterEach(closeAll);

const me = (s: RoomState) => s.participants.find((p) => p.id === s.selfId)!;

describe('vote, withdraw, change (F01-AC9, AC10)', () => {
  it('F01-AC9/AC10: vote, change, withdraw; others only see hasVoted', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expect(bob.state!.myVote).toBe('5');
    await fac.waitForState((s) => s.participants.find((p) => p.name === 'Bob')!.hasVoted);
    expect(fac.state!.myVote).toBeNull();
    expectAck(await bob.cmd_({ type: 'vote', card: '8' }));
    expect(bob.state!.myVote).toBe('8');
    expectAck(await bob.cmd_({ type: 'vote', card: null }));
    expect(bob.state!.myVote).toBeNull();
    await fac.waitForState((s) => !s.participants.find((p) => p.name === 'Bob')!.hasVoted);
  });

  it('votes must be in the deck (specials included); numbers are invalid input', async () => {
    const { id } = await setup();
    const bob = await Client.join(id, 'Bob');
    expectCode(await bob.cmd_({ type: 'vote', card: '4' }), 'invalid_card');
    expectCode(await bob.cmd_({ type: 'vote', card: 'XL' }), 'invalid_card');
    expectCode(await bob.cmd_({ type: 'vote', card: 5 }), 'invalid_input');
    expectAck(await bob.cmd_({ type: 'vote', card: '?' }));
    expectAck(await bob.cmd_({ type: 'vote', card: '☕' }));
    expectAck(await bob.cmd_({ type: 'vote', card: '½' }));
  });

  it('F01-AC12: the shared counter matches server participants', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    await Client.join(id, 'Obs', 'observer');
    await bob.cmd_({ type: 'vote', card: '1' });
    const s = await fac.waitForState((st) => st.participants.some((p) => p.hasVoted));
    expect(votedCounter(s.participants, s.facilitatorId, s.settings)).toEqual({
      voted: 1,
      total: 2,
    });
  });
});

describe('F01-AC11: vote secrecy', () => {
  it('no vote value reaches another connection, in any frame, HTTP response or log line, before reveal', async () => {
    const logs: string[] = [];
    const capture = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    spies.forEach((s) => s.mockImplementation(capture));

    const deck = { id: 'custom' as const, cards: ['q7x1', 'w2e9', 'r5t6', 'y8u3'] };
    const { id, fac, room } = await setup({ deck });
    const httpBodies: string[] = [JSON.stringify(room)];
    const bob = await Client.join(id, 'Bobsecretname');
    const carol = await Client.join(id, 'Carol', 'observer');
    const dave = await Client.join(id, 'Dave');
    expectAck(await fac.cmd_({ type: 'vote', card: 'q7x1' }));
    expectAck(await bob.cmd_({ type: 'vote', card: 'w2e9' }));
    expectAck(await dave.cmd_({ type: 'vote', card: 'r5t6' }));
    expectAck(await dave.cmd_({ type: 'vote', card: 'y8u3' })); // change
    expectAck(await dave.cmd_({ type: 'vote', card: 'r5t6' }));
    // Join and resync snapshots while votes exist: a late joiner and a rejoin of Bob.
    const late = await Client.join(id, 'Late');
    const bobAgain = await Client.rejoin(id, bob.token);
    // Role switch, topic and settings changes while voting.
    expectAck(await carol.cmd_({ type: 'set_role', role: 'observer' }));
    expectAck(await fac.cmd_({ type: 'set_topic', topic: 'Topic w/ no votes' }));
    expectAck(await fac.cmd_({ type: 'update_settings', settings: { controlMode: 'everyone' } }));
    httpBodies.push(await (await api(`/api/rooms/${id}`)).text());
    httpBodies.push(await (await api(`/api/rooms/${id}`)).text());

    // A rename and a removal also log IDs only.
    expectAck(await carol.cmd_({ type: 'rename', name: 'Carolrenamedsecret' }));
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: late.participantId }));
    await late.waitForClose();

    const tokens = ['q7x1', 'w2e9', 'r5t6', 'y8u3'];
    const ownVote: Record<string, string | null> = {};
    for (const [name, c] of Object.entries({ fac, bob, carol, dave, late, bobAgain })) {
      for (const raw of c.frames) {
        const msg = JSON.parse(raw) as ServerMessage;
        let scrubbed = raw;
        if (msg.type === 'state') {
          expect(msg.state.round.phase).toBe('voting');
          // Remove the deck definition and the recipient's own vote, then look for any card token.
          const { settings, myVote, ...rest } = msg.state;
          ownVote[name] = myVote;
          expect(settings.deck).toEqual(deck);
          scrubbed = JSON.stringify(rest);
        }
        for (const t of tokens) expect(scrubbed, `${name} received ${t}`).not.toContain(t);
      }
    }
    // Each recipient's own vote is delivered to them only.
    expect(fac.state!.myVote).toBe('q7x1');
    expect(bob.state!.myVote).toBe('w2e9');
    expect(dave.state!.myVote).toBe('r5t6');
    expect(carol.state!.myVote).toBeNull();
    expect(late.state!.myVote).toBeNull();
    for (const body of httpBodies) for (const t of tokens) expect(body).not.toContain(t);

    // Logs: IDs only. No names, topics, tokens, or votes.
    expect(logs.length).toBeGreaterThan(0);
    const all = logs.join('\n');
    for (const secret of [
      ...tokens,
      'Bobsecretname',
      'Carol',
      'Carolrenamedsecret',
      'Dave',
      'Late',
      'Topic w/ no votes',
      bob.token,
      late.token,
      room.token,
    ]) {
      expect(all).not.toContain(secret);
    }
    spies.forEach((s) => s.mockRestore());

    // After reveal the values are in the snapshot for everyone.
    expectAck(await fac.cmd_({ type: 'reveal' }));
    const revealed = await carol.waitForState((s) => s.round.phase === 'revealed');
    if (revealed.round.phase !== 'revealed') throw new Error('unreachable');
    expect(Object.fromEntries(revealed.round.votes.map((v) => [v.participantId, v.card]))).toEqual({
      [fac.participantId]: 'q7x1',
      [bob.participantId]: 'w2e9',
      [dave.participantId]: 'r5t6',
    });
    // Reset: the values are gone again.
    expectAck(await fac.cmd_({ type: 'reset' }));
    const after = await carol.waitForState((s) => s.round.phase === 'voting');
    expect(JSON.stringify(after.round)).not.toContain('q7x1');
  });
});

describe('F01-AC13: permission matrix', () => {
  type Who = 'facilitator' | 'voter' | 'observer';
  const commands: Array<[string, (c: Client, other: string) => Record<string, unknown>]> = [
    ['reveal', () => ({ type: 'reveal' })],
    ['reset', () => ({ type: 'reset' })],
    ['set_topic', () => ({ type: 'set_topic', topic: 'x' })],
    ['update_settings', () => ({ type: 'update_settings', settings: { autoReveal: true } })],
    ['remove_participant', (_c, other) => ({ type: 'remove_participant', participantId: other })],
    ['hand_over', (_c, other) => ({ type: 'hand_over', participantId: other })],
  ];
  const allowed: Record<string, Record<'facilitator' | 'everyone', Who[]>> = {
    reveal: { facilitator: ['facilitator'], everyone: ['facilitator', 'voter'] },
    reset: { facilitator: ['facilitator'], everyone: ['facilitator', 'voter'] },
    set_topic: { facilitator: ['facilitator'], everyone: ['facilitator'] },
    update_settings: { facilitator: ['facilitator'], everyone: ['facilitator'] },
    remove_participant: { facilitator: ['facilitator'], everyone: ['facilitator'] },
    hand_over: { facilitator: ['facilitator'], everyone: ['facilitator'] },
  };

  for (const mode of ['facilitator', 'everyone'] as const) {
    for (const [name, build] of commands) {
      it(`${name} in "${mode}" mode`, async () => {
        for (const who of ['facilitator', 'voter', 'observer'] as const) {
          const { id, fac } = await setup({ controlMode: mode });
          const voter = await Client.join(id, 'Voter');
          const observer = await Client.join(id, 'Obs', 'observer');
          const target = await Client.join(id, 'Target');
          const actor = { facilitator: fac, voter, observer }[who];
          // Hand-over/remove need a target that is not the actor.
          const reply = await actor.cmd_(build(actor, target.participantId));
          if (allowed[name]![mode].includes(who)) {
            expectAck(reply);
          } else {
            expectCode(reply, 'not_allowed');
          }
        }
      });
    }
  }

  it('claim_facilitator, remove self and remove facilitator are refused', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    expectCode(
      await fac.cmd_({ type: 'remove_participant', participantId: fac.participantId }),
      'not_allowed',
    );
    expectCode(
      await bob.cmd_({ type: 'remove_participant', participantId: fac.participantId }),
      'not_allowed',
    );
    expectCode(
      await fac.cmd_({ type: 'remove_participant', participantId: 'nope' }),
      'unknown_target',
    );
    expectCode(await fac.cmd_({ type: 'hand_over', participantId: 'nope' }), 'unknown_target');
    expectCode(
      await fac.cmd_({ type: 'hand_over', participantId: fac.participantId }),
      'not_allowed',
    );
    expectCode(await bob.cmd_({ type: 'claim_facilitator' }), 'claim_not_available');
    expectCode(await fac.cmd_({ type: 'claim_facilitator' }), 'claim_not_available');
  });

  it('observers cannot vote; the facilitator cannot vote when facilitator votes is off', async () => {
    const { id, fac } = await setup({ facilitatorVotes: false });
    const obs = await Client.join(id, 'Obs', 'observer');
    expectCode(await obs.cmd_({ type: 'vote', card: '1' }), 'not_allowed');
    expectCode(await fac.cmd_({ type: 'vote', card: '1' }), 'not_allowed');
  });
});

describe('reveal and reset (F01-AC14, AC17, AC18, AC19, AC20)', () => {
  it('F01-AC14/AC17: reveal is one state change for everyone; zero votes and repeats are fine', async () => {
    const { id, fac } = await setup({ controlMode: 'everyone' });
    const bob = await Client.join(id, 'Bob');
    const obs = await Client.join(id, 'Obs', 'observer');
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
    const v0 = obs.state!.version;
    expectAck(await fac.cmd_({ type: 'reveal' }));
    const revealed = await obs.waitForState((s) => s.round.phase === 'revealed');
    expect(revealed.version).toBe(v0 + 1);
    expect(revealed.round).toMatchObject({
      phase: 'revealed',
      votes: [{ participantId: bob.participantId, card: '3' }],
    });
    // Second reveal: no-op, no version change, still acked.
    const second = await bob.cmd_({ type: 'reveal' });
    expectAck(second);
    expect(second).toMatchObject({ version: revealed.version });
    expect(obs.state!.version).toBe(revealed.version);
    // Zero votes
    const room2 = await setup();
    expectAck(await room2.fac.cmd_({ type: 'reveal' }));
    expect(room2.fac.state!.round).toMatchObject({ phase: 'revealed', votes: [] });
  });

  it('F01-AC18: after reveal nothing changes the votes; role switch, settings and removal apply next round', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    const cy = await Client.join(id, 'Cy');
    await fac.cmd_({ type: 'vote', card: '1' });
    await bob.cmd_({ type: 'vote', card: '2' });
    await cy.cmd_({ type: 'vote', card: '3' });
    expectAck(await fac.cmd_({ type: 'reveal' }));
    const votes = () => {
      const r = fac.state!.round;
      return r.phase === 'revealed'
        ? r.votes.map((v) => `${v.participantId}:${v.card}`).sort()
        : [];
    };
    const before = votes();
    expect(before).toHaveLength(3);
    expectCode(await bob.cmd_({ type: 'vote', card: '5' }), 'round_revealed');
    expectCode(await bob.cmd_({ type: 'vote', card: null }), 'round_revealed');
    expectAck(await bob.cmd_({ type: 'set_role', role: 'observer' }));
    expectAck(await fac.cmd_({ type: 'update_settings', settings: { facilitatorVotes: false } }));
    expect(votes()).toEqual(before);
    // Removal: the vote stays under the name with a "left" marker.
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: cy.participantId }));
    expect(votes()).toEqual(before);
    expect(fac.state!.round).toMatchObject({
      left: [{ participantId: cy.participantId, name: 'Cy' }],
    });
    expect(fac.state!.participants.map((p) => p.name)).toEqual(['Fac', 'Bob']);
    // Next round: the new rules apply and the left marker is gone.
    expectAck(await fac.cmd_({ type: 'reset' }));
    expect(fac.state!.round).toEqual({ phase: 'voting', number: 2 });
    expectCode(await fac.cmd_({ type: 'vote', card: '1' }), 'not_allowed');
    expectCode(await bob.cmd_({ type: 'vote', card: '1' }), 'not_allowed');
  });

  it('F01-AC19/AC20: reset clears all votes, keeps or replaces the topic atomically; topic editable in any state', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    expectAck(await fac.cmd_({ type: 'set_topic', topic: '  First   topic ' }));
    expect(fac.state!.topic).toBe('First topic');
    await bob.cmd_({ type: 'vote', card: '2' });
    expectAck(await fac.cmd_({ type: 'reset' })); // from voting
    expect(fac.state!.topic).toBe('First topic');
    expect(fac.state!.round).toEqual({ phase: 'voting', number: 2 });
    await bob.waitForState((s) => s.myVote === null);
    await bob.cmd_({ type: 'vote', card: '2' });
    expectAck(await fac.cmd_({ type: 'reveal' }));
    expectAck(await fac.cmd_({ type: 'set_topic', topic: 'Edited after reveal' })); // any state
    const v = fac.state!.version;
    expectAck(await fac.cmd_({ type: 'reset', topic: 'Next' }));
    expect(fac.state!.topic).toBe('Next');
    expect(fac.state!.version).toBe(v + 1); // one atomic change
    expectAck(await fac.cmd_({ type: 'reset', topic: '' }));
    expect(fac.state!.topic).toBe('');
    expectAck(await fac.cmd_({ type: 'set_topic', topic: 'a'.repeat(200) }));
    expectCode(await fac.cmd_({ type: 'set_topic', topic: 'a'.repeat(201) }), 'invalid_input');
    expectCode(await fac.cmd_({ type: 'set_topic', topic: 'a\nb' }), 'invalid_input');
    expectAck(await fac.cmd_({ type: 'set_topic', topic: '   ' }));
    expect(fac.state!.topic).toBe('');
  });
});

describe('F01-AC16: auto-reveal triggers', () => {
  const room = async () => {
    const s = await setup({ autoReveal: true });
    const bob = await Client.join(s.id, 'Bob');
    return { ...s, bob };
  };

  it('reveals as soon as the last online voter votes, once, with all votes', async () => {
    const { fac, bob } = await room();
    await fac.cmd_({ type: 'vote', card: '5' });
    expect(fac.state!.round.phase).toBe('voting');
    expectAck(await bob.cmd_({ type: 'vote', card: '8' }));
    expect(bob.state!.round).toMatchObject({ phase: 'revealed' });
    expect(fac.state!.round).toMatchObject({
      phase: 'revealed',
      votes: expect.arrayContaining([expect.anything()]),
    });
    // A single transition: exactly one snapshot with phase revealed per recipient.
    expect(
      bob.messages.filter((m) => m.type === 'state' && m.state.round.phase === 'revealed'),
    ).toHaveLength(1);
  });

  it('withdrawal does not reveal; never reveals with no votes', async () => {
    const { fac, bob } = await room();
    await bob.cmd_({ type: 'vote', card: '8' });
    await bob.cmd_({ type: 'vote', card: null });
    await fac.cmd_({ type: 'vote', card: '1' });
    await fac.cmd_({ type: 'vote', card: null });
    expect(fac.state!.round.phase).toBe('voting');
  });

  it('a disconnect of the only unvoted voter reveals (after the connection is gone)', async () => {
    const { fac, bob } = await room();
    await fac.cmd_({ type: 'vote', card: '5' });
    bob.close();
    await fac.waitForState((s) => s.round.phase === 'revealed');
  });

  it('removal of the only unvoted voter reveals', async () => {
    const { fac, bob } = await room();
    await fac.cmd_({ type: 'vote', card: '5' });
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: bob.participantId }));
    expect(fac.state!.round.phase).toBe('revealed');
  });

  it('a role switch to observer of the only unvoted voter reveals', async () => {
    const { fac, bob } = await room();
    await fac.cmd_({ type: 'vote', card: '5' });
    expectAck(await bob.cmd_({ type: 'set_role', role: 'observer' }));
    expect(fac.state!.round.phase).toBe('revealed');
  });

  it('turning auto-reveal on, or facilitator votes off, re-evaluates', async () => {
    const s = await setup({ autoReveal: false });
    const bob = await Client.join(s.id, 'Bob');
    await s.fac.cmd_({ type: 'vote', card: '5' });
    await bob.cmd_({ type: 'vote', card: '8' });
    expect(s.fac.state!.round.phase).toBe('voting');
    expectAck(await s.fac.cmd_({ type: 'update_settings', settings: { autoReveal: true } }));
    expect(s.fac.state!.round.phase).toBe('revealed');

    const t = await setup({ autoReveal: true });
    const cy = await Client.join(t.id, 'Cy');
    await cy.cmd_({ type: 'vote', card: '1' });
    expect(t.fac.state!.round.phase).toBe('voting'); // facilitator has not voted
    expectAck(await t.fac.cmd_({ type: 'update_settings', settings: { facilitatorVotes: false } }));
    expect(t.fac.state!.round.phase).toBe('revealed');
  });

  it('a room with only observers (or only offline voters) never auto-reveals; a join does not reveal', async () => {
    const s = await setup({ autoReveal: true, facilitatorVotes: false });
    await Client.join(s.id, 'Obs', 'observer');
    expect(s.fac.state!.round.phase).toBe('voting');
  });

  it('a silent connection loss counts only after the heartbeat timeout', async () => {
    const { setTimers } = await import('./helpers');
    const { id, fac, bob } = await room();
    await fac.cmd_({ type: 'vote', card: '5' });
    // Bob goes silent (no pings, no messages); the facilitator keeps talking.
    await setTimers(id, { heartbeatTimeoutMs: 400 });
    await new Promise((r) => setTimeout(r, 150));
    expect(fac.state!.round.phase).toBe('voting');
    const keepAlive = setInterval(() => fac.send({ type: 'ping' }), 100);
    try {
      await fac.waitForState((s) => s.round.phase === 'revealed', 5000);
    } finally {
      clearInterval(keepAlive);
    }
    expect((await bob.waitForClose()).code).toBe(1001);
  });
});

describe('F01-AC26, AC27, AC28, AC35: roles and settings', () => {
  it('F01-AC26: switching to observer withdraws the vote in voting', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    await bob.cmd_({ type: 'vote', card: '5' });
    expectAck(await bob.cmd_({ type: 'set_role', role: 'observer' }));
    expect(bob.state!.myVote).toBeNull();
    await fac.waitForState(
      (s) => s.participants.find((p) => p.name === 'Bob')!.role === 'observer',
    );
    expect(fac.state!.participants.find((p) => p.name === 'Bob')!.hasVoted).toBe(false);
  });

  it('F01-AC35: facilitator votes off withdraws the facilitator vote in voting', async () => {
    const { fac } = await setup();
    await fac.cmd_({ type: 'vote', card: '5' });
    expectAck(await fac.cmd_({ type: 'update_settings', settings: { facilitatorVotes: false } }));
    expect(fac.state!.myVote).toBeNull();
  });

  it('F01-AC27: settings change for everyone immediately', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    expectAck(
      await fac.cmd_({
        type: 'update_settings',
        settings: { name: ' New  name ', controlMode: 'everyone', autoReveal: true },
      }),
    );
    expect(bob.state!.settings).toMatchObject({
      name: 'New name',
      controlMode: 'everyone',
      autoReveal: true,
    });
  });

  it('F01-AC28: a deck change that would discard votes needs confirmReset', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    // No votes: applies without reset.
    expectAck(await fac.cmd_({ type: 'update_settings', settings: { deck: { id: 'tshirt' } } }));
    expect(fac.state!.round).toEqual({ phase: 'voting', number: 1 });
    // Same deck: not a change, even with votes.
    await bob.cmd_({ type: 'vote', card: 'M' });
    expectAck(await fac.cmd_({ type: 'update_settings', settings: { deck: { id: 'tshirt' } } }));
    expect(bob.state!.myVote).toBe('M');
    // Votes: refused, nothing changes.
    const refused = await fac.cmd_({
      type: 'update_settings',
      settings: { deck: { id: 'powers-of-2' } },
    });
    expectCode(refused, 'confirmation_required');
    expect(fac.state!.settings.deck).toEqual({ id: 'tshirt' });
    expect(bob.state!.myVote).toBe('M');
    // Confirmed: applies the deck and resets the round.
    expectAck(
      await fac.cmd_({
        type: 'update_settings',
        settings: { deck: { id: 'powers-of-2' } },
        confirmReset: true,
      }),
    );
    expect(fac.state!.settings.deck).toEqual({ id: 'powers-of-2' });
    expect(fac.state!.round).toEqual({ phase: 'voting', number: 2 });
    await bob.waitForState((s) => s.myVote === null);
    // Votes in a revealed round count too.
    await bob.cmd_({ type: 'vote', card: '4' });
    await fac.cmd_({ type: 'reveal' });
    expectCode(
      await fac.cmd_({ type: 'update_settings', settings: { deck: { id: 'fibonacci' } } }),
      'confirmation_required',
    );
  });
});

describe('F01-AC23, AC24, AC25: removal, handover, claim', () => {
  it('F01-AC23: removal deletes the participant and their token and vote; the client gets a fatal removed', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    await bob.cmd_({ type: 'vote', card: '5' });
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: bob.participantId }));
    await bob.waitFor((m) => m.type === 'error' && m.code === 'removed');
    expect(bob.messages.find((m) => m.type === 'error' && m.code === 'removed')).toMatchObject({
      fatal: true,
    });
    expect((await bob.waitForClose()).code).toBe(4403);
    expect(fac.state!.participants.map((p) => p.name)).toEqual(['Fac']);
    // The old token is tombstoned: reconnecting is `removed`, then a fresh join works.
    const again = await Client.connect(id);
    again.send({ type: 'rejoin', token: bob.token });
    await again.waitFor((m) => m.type === 'error');
    expectCode(again.messages.at(-1)!, 'removed');
    const fresh = await Client.join(id, 'Bob');
    expect(fresh.participantId).not.toBe(bob.participantId);
    expect(fresh.state!.myVote).toBeNull();
  });

  const rejoinError = async (id: string, token: string) => {
    const c = await Client.connect(id);
    c.send({ type: 'rejoin', token });
    await c.waitFor((m) => m.type === 'error');
    return { msg: c.messages.at(-1)!, close: await c.waitForClose() };
  };

  it('F01-AC23/AC29: removed while offline, a rejoin gets removed (fatal, 4403), every time, even with room to spare', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    bob.close();
    await fac.waitForState((s) => s.participants[1]!.online === false);
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: bob.participantId }));
    for (let i = 0; i < 2; i++) {
      const { msg, close } = await rejoinError(id, bob.token);
      expectCode(msg, 'removed');
      expect(msg).toMatchObject({ fatal: true });
      expect(close.code).toBe(4403);
    }
    expect(fac.state!.participants.map((p) => p.name)).toEqual(['Fac']); // never admitted
    // A fresh join works as before.
    const fresh = await Client.join(id, 'Bob');
    expect(fresh.participantId).not.toBe(bob.participantId);
  });

  it('F01-AC21/AC23: a purged participant still gets invalid_token (no tombstone)', async () => {
    const { id, fac } = await setup();
    await setTimers(id, { offlinePurgeMs: 200 });
    const bob = await Client.join(id, 'Bob');
    bob.close();
    await fac.waitForState((s) => s.participants.length === 1, 3000);
    expectCode((await rejoinError(id, bob.token)).msg, 'invalid_token');
  });

  it('F01-AC23: tombstones keep only hashes, are capped at the newest 200, and survive eviction', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: bob.participantId }));
    const stub = getRoomStub(env, id);
    const dump = await runInDurableObject(stub, (_i, state) => ({
      tables: state.storage.sql
        .exec<Record<string, string>>("SELECT sql FROM sqlite_master WHERE name = 'tombstones'")
        .one()['sql'],
    }));
    expect(dump.tables).not.toMatch(/name|participant|display/i);
    // Memory drop and real eviction keep the tombstone.
    await api(`/api/__test/rooms/${id}/evict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'drop_memory' }),
    });
    await evictDurableObject(stub);
    expectCode((await rejoinError(id, bob.token)).msg, 'removed');
    // Cap: insert past the limit; the oldest (Bob's) falls back to invalid_token.
    const count = await runInDurableObject(stub, (instance) => {
      const store = (instance as unknown as { store: RoomStore }).store;
      for (let i = 0; i < TOMBSTONE_MAX + 5; i++) store.addTombstone(`filler-${i}`, Date.now());
      return store.tombstoneCount();
    });
    expect(count).toBe(TOMBSTONE_MAX);
    expectCode((await rejoinError(id, bob.token)).msg, 'invalid_token');
  });

  it('F01-AC24: handover moves the role, keeps roles and votes; the old facilitator loses control', async () => {
    const { id, fac } = await setup();
    const obs = await Client.join(id, 'Obs', 'observer');
    await fac.cmd_({ type: 'vote', card: '5' });
    expectAck(await fac.cmd_({ type: 'hand_over', participantId: obs.participantId }));
    expect(obs.state!.facilitatorId).toBe(obs.participantId);
    expect(me(fac.state!)).toMatchObject({ role: 'voter', hasVoted: true });
    expect(me(obs.state!)).toMatchObject({ role: 'observer' });
    // X-RACE-12: a command from the old facilitator after handover is rejected.
    expectCode(await fac.cmd_({ type: 'set_topic', topic: 'late' }), 'not_allowed');
    expectCode(await fac.cmd_({ type: 'reveal' }), 'not_allowed');
    expectAck(await obs.cmd_({ type: 'reveal' })); // the observer is now the facilitator
  });

  it('F01-AC24: handover to an offline target is refused with target_offline', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    bob.close();
    await fac.waitForState((s) => s.participants[1]!.online === false);
    expectCode(
      await fac.cmd_({ type: 'hand_over', participantId: bob.participantId }),
      'target_offline',
    );
    expect(fac.state!.facilitatorId).toBe(fac.participantId);
  });

  it('X-RACE-6: handover racing a target disconnect leaves exactly one online facilitator or a clean refusal', async () => {
    for (let i = 0; i < 8; i++) {
      const { id, fac } = await setup();
      const bob = await Client.join(id, 'Bob');
      const reply = fac.cmd_({ type: 'hand_over', participantId: bob.participantId });
      bob.close();
      const result = await reply;
      await fac.waitForState((s) => s.participants[1]!.online === false);
      if (result.type === 'ack') {
        expect(fac.state!.facilitatorId).toBe(bob.participantId);
      } else {
        expectCode(result, 'target_offline');
        expect(fac.state!.facilitatorId).toBe(fac.participantId);
      }
    }
  });
});

describe('races', () => {
  it('X-RACE-1: two reveals at once transition once; both clients end identical', async () => {
    const { id, fac } = await setup({ controlMode: 'everyone' });
    const bob = await Client.join(id, 'Bob');
    await bob.cmd_({ type: 'vote', card: '3' });
    const v = fac.state!.version;
    const [a, b] = await Promise.all([fac.cmd_({ type: 'reveal' }), bob.cmd_({ type: 'reveal' })]);
    expectAck(a);
    expectAck(b);
    await fac.waitForState((s) => s.round.phase === 'revealed');
    expect(fac.state!.version).toBe(v + 1);
    expect(JSON.stringify({ ...bob.state!, serverTime: 0, selfId: '', myVote: null })).toBe(
      JSON.stringify({ ...fac.state!, serverTime: 0, selfId: '', myVote: null }),
    );
    expect(
      fac.messages.filter((m) => m.type === 'state' && m.state.round.phase === 'revealed'),
    ).toHaveLength(1);
  });

  it('X-RACE-2: a vote racing a reveal is either in the reveal or rejected, never dropped or late', async () => {
    for (let i = 0; i < 12; i++) {
      const { id, fac } = await setup();
      const bob = await Client.join(id, 'Bob');
      const [reveal, vote] = await Promise.all([
        fac.cmd_({ type: 'reveal' }),
        bob.cmd_({ type: 'vote', card: '5' }),
      ]);
      expectAck(reveal);
      const finalState = await fac.waitForState((s) => s.round.phase === 'revealed');
      if (finalState.round.phase !== 'revealed') throw new Error('unreachable');
      const included = finalState.round.votes.some((v) => v.participantId === bob.participantId);
      if (vote.type === 'ack') expect(included).toBe(true);
      else {
        expectCode(vote, 'round_revealed');
        expect(included).toBe(false);
      }
      await bob.waitForState((s) => s.round.phase === 'revealed');
      expect(bob.state!.myVote).toBe(included ? '5' : null);
    }
  });

  it('X-RACE-3/4: vote/reset and reveal/reset races end consistent', async () => {
    for (let i = 0; i < 8; i++) {
      const { id, fac } = await setup();
      const bob = await Client.join(id, 'Bob');
      await bob.cmd_({ type: 'vote', card: '2' });
      const [r1, v1] = await Promise.all([
        fac.cmd_({ type: 'reset' }),
        bob.cmd_({ type: 'vote', card: '5' }),
      ]);
      expectAck(r1);
      expectAck(v1);
      await bob.waitForState((s) => s.round.number === 2);
      // Bob's vote is either from after the reset (5) or was wiped by it; never the stale '2'.
      expect(['5', null]).toContain(bob.state!.myVote);
      const fb = await fac.waitForState((s) => s.round.number === 2);
      expect(fb.participants.find((p) => p.name === 'Bob')!.hasVoted).toBe(
        bob.state!.myVote !== null,
      );
      const [rv, rs] = await Promise.all([
        fac.cmd_({ type: 'reveal' }),
        fac.cmd_({ type: 'reset' }),
      ]);
      expectAck(rv);
      expectAck(rs);
      const end = await fac.waitForState((s) => s.round.number >= 3);
      expect(end.round.phase).toBe('voting');
    }
  });

  it('X-RACE-4: reset racing a deck change leaves no vote outside the deck', async () => {
    const { id, fac } = await setup();
    const bob = await Client.join(id, 'Bob');
    await bob.cmd_({ type: 'vote', card: '5' });
    const [a, b] = await Promise.all([
      fac.cmd_({ type: 'reset' }),
      fac.cmd_({ type: 'update_settings', settings: { deck: { id: 'tshirt' } } }),
    ]);
    expectAck(a);
    // Either order: the deck change after the reset needs no confirmation; before it, it is refused.
    if (b.type === 'error') expectCode(b, 'confirmation_required');
    await bob.waitForState((s) => s.round.number >= 2);
    expect(bob.state!.myVote).toBeNull();
  });
});
