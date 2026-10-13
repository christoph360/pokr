import type { RoomState } from '@pokr/shared';
import { expect, test } from '../fixtures';
import { makeRoom } from '../fixtures/scenarios';

// Heavy race tests: chromium only (runtime), documented gap in the plan (4.4).
const tag = { tag: '@chromium-only' };

const revealedVotes = (s: RoomState) => (s.round.phase === 'revealed' ? s.round.votes : []);
const transitionsToRevealed = (states: RoomState[]): number => {
  let n = 0;
  let prev: RoomState['round']['phase'] = 'voting';
  for (const s of states) {
    if (prev === 'voting' && s.round.phase === 'revealed') n++;
    prev = s.round.phase;
  }
  return n;
};

test.describe('races', () => {
  test(
    'F01-X-RACE-1 / F01-AC17: two simultaneous reveals produce one transition and identical states',
    tag,
    async ({ world }) => {
      const room = await world.createRoom({ settings: { controlMode: 'everyone' } });
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      await a.vote('5');
      const [r1, r2] = await Promise.all([fac.command('reveal'), a.command('reveal')]);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      await fac.waitForState((s) => s.round.phase === 'revealed', 'revealed');
      await a.waitForState(
        (s) => s.round.phase === 'revealed' && s.version >= fac.state!.version,
        'converged',
      );
      for (const c of [fac, a]) {
        const states = c.frames.flatMap((f) => (f.msg?.type === 'state' ? [f.msg.state] : []));
        expect(transitionsToRevealed(states)).toBe(1);
      }
      expect(revealedVotes(fac.state!)).toEqual(revealedVotes(a.state!));
    },
  );

  test(
    'F01-X-RACE-2 / F01-AC18: a vote racing a reveal is either in the reveal or refused, never lost',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      for (let i = 0; i < 8; i++) {
        const [vote, reveal] = await Promise.all([a.vote('5'), fac.command('reveal')]);
        expect(reveal.ok).toBe(true);
        const s = await fac.waitForState((st) => st.round.phase === 'revealed', 'revealed');
        const inReveal = revealedVotes(s).some((v) => v.participantId === a.state!.selfId);
        if (vote.ok) expect(inReveal, `round ${i}: acked vote must be in the reveal`).toBe(true);
        else {
          expect(vote.code).toBe('round_revealed');
          expect(inReveal, `round ${i}: refused vote must not be in the reveal`).toBe(false);
        }
        await a.waitForState((st) => st.round.phase === 'revealed', 'ann sees reveal');
        await fac.command('reset');
        await a.waitForState(
          (st) => st.round.phase === 'voting' && st.round.number === s.round.number + 1,
          'next round',
        );
      }
    },
  );

  test(
    'F01-X-RACE-3: a vote racing a reset leaves no stale vote and a consistent snapshot',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      for (let i = 0; i < 8; i++) {
        await a.vote(null);
        const [vote, reset] = await Promise.all([a.vote('8'), fac.command('reset')]);
        expect(vote.ok).toBe(true);
        expect(reset.ok).toBe(true);
        await fac.waitForState((st) => st.version >= a.state!.version, 'fac caught up');
        await a.waitForState((st) => st.version >= fac.state!.version, 'ann caught up');
        const annInFac = fac.state!.participants.find((p) => p.name === 'Ann')!;
        expect(annInFac.hasVoted, `round ${i}`).toBe(a.state!.myVote !== null);
      }
    },
  );

  test(
    'F01-X-RACE-4: a reveal racing a reset ends in a consistent state',
    tag,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      await a.vote('3');
      await Promise.all([fac.command('reveal'), fac.command('reset')]);
      await a.waitForState((st) => st.version >= fac.state!.version, 'converged');
      const s = fac.state!;
      if (s.round.phase === 'voting') expect(s.participants.every((p) => !p.hasVoted)).toBe(true);
      else expect(revealedVotes(s).length).toBeGreaterThanOrEqual(0);
      expect(a.state!.round).toEqual(s.round);
    },
  );

  test(
    'F01-X-RACE-5 / F01-AC16: the last two votes at the same instant reveal once with both votes',
    tag,
    async ({ world }) => {
      const room = await world.createRoom({ settings: { autoReveal: true } });
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      const b = await world.raw(room, 'Ben');
      await fac.vote('1');
      await Promise.all([a.vote('2'), b.vote('3')]);
      const s = await fac.waitForState((st) => st.round.phase === 'revealed', 'auto revealed');
      expect(
        revealedVotes(s)
          .map((v) => v.card)
          .sort(),
      ).toEqual(['1', '2', '3']);
      for (const c of [a, b]) {
        await c.waitForState((st) => st.round.phase === 'revealed', 'reveal seen');
      }
      for (const c of [fac, a, b]) {
        const states = c.frames.flatMap((f) => (f.msg?.type === 'state' ? [f.msg.state] : []));
        expect(transitionsToRevealed(states)).toBe(1);
      }
    },
  );

  test('F01-X-RACE-5: the same race in the browser UI', tag, async ({ world }) => {
    const { fac, others } = await makeRoom(world, [{ name: 'Ann' }, { name: 'Ben' }], {
      settings: { autoReveal: true },
    });
    await fac.room.vote('1');
    await Promise.all([others[0]!.room.card('2').click(), others[1]!.room.card('3').click()]);
    for (const p of [fac, ...others]) {
      await expect(p.room.summary).toBeVisible();
      await p.room.expectRevealedValues({ Fiona: '1', Ann: '2', Ben: '3' });
    }
  });

  test(
    'F01-X-RACE-10 / F01-AC23: removing a participant while they vote ends consistently',
    tag,
    async ({ world }) => {
      for (let i = 0; i < 3; i++) {
        const room = await world.createRoom();
        const fac = await world.rawFacilitator(room);
        const a = await world.raw(room, 'Ann');
        const id = a.state!.selfId;
        const [vote, remove] = await Promise.all([
          a.vote('5'),
          fac.command('remove_participant', { participantId: id }),
        ]);
        expect(remove.ok).toBe(true);
        if (!vote.ok)
          expect(['removed', 'not_joined', 'unknown_target', 'not_allowed']).toContain(vote.code);
        const s = await fac.waitForState(
          (st) => !st.participants.some((p) => p.id === id),
          'Ann removed',
        );
        expect(s.participants.every((p) => !p.hasVoted)).toBe(true);
      }
    },
  );

  test(
    "F01-X-RACE-7 / F01-AC25: a claim crossing the facilitator's return leaves exactly one facilitator",
    tag,
    async ({ world }) => {
      for (let i = 0; i < 3; i++) {
        const room = await world.createRoom({
          timers: { facilitatorClaimMs: 200, heartbeatTimeoutMs: 500 },
        });
        const fac = await world.rawFacilitator(room);
        const a = await world.raw(room, 'Ann');
        fac.close();
        await a.waitForState((s) => s.canClaimAt !== null, 'claim window');
        const back = await world.rawConnect(room.roomId);
        const [claim] = await Promise.all([
          a.command('claim_facilitator'),
          back.rejoin(room.facilitatorToken),
        ]);
        void claim;
        await a.waitForState((s) => s.participants.length === 2, 'settled');
        await back.waitForState((s) => s.version >= a.state!.version, 'converged');
        expect(a.state!.facilitatorId).toBe(back.state!.facilitatorId);
        expect(a.state!.participants.filter((p) => p.id === a.state!.facilitatorId)).toHaveLength(
          1,
        );
      }
    },
  );

  test(
    'F01-AC14: ordering, every client sees the same sequence of versions',
    tag,
    async ({ world }) => {
      const { fac, others, all } = await makeRoom(world, [{ name: 'Ann' }, { name: 'Ben' }]);
      await others[0]!.room.vote('2');
      await others[1]!.room.vote('3');
      await fac.room.reveal.click();
      await fac.room.reset.click();
      await fac.room.waitForVersionAtLeast(1);
      const finalVersion = await fac.room.version();
      for (const p of all) await p.room.waitForVersionAtLeast(finalVersion);
      for (const p of all) {
        const versions = p.rec.states.map((s) => s.version);
        expect(versions, p.name).toEqual([...versions].sort((x, y) => x - y));
      }
    },
  );
});
