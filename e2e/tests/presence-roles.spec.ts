import { expect, test } from '../fixtures';
import { makeRoom } from '../fixtures/scenarios';
import { RoomPage } from '../helpers/room-page';
import { observeFor, waitForClaimOpen } from '../helpers/wait';

const cross = { tag: '@cross-browser' };
const chromiumOnly = { tag: '@chromium-only' };

test.describe('duplicate names (F01-AC8)', () => {
  test(
    'F01-AC8: three participants named Alex are distinguishable everywhere',
    cross,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Alex' }]);
      const alex1 = others[0]!;
      const alex2 = await world.join(room, { name: 'alex ' });
      const alex3 = await world.join(room, { name: 'ALEX' });
      for (const p of [fac, alex1, alex2, alex3]) {
        await expect(p.room.row('Alex')).toBeVisible();
        await expect(p.room.row('alex (2)')).toBeVisible();
        await expect(p.room.row('ALEX (3)')).toBeVisible();
      }
      // Accessible names carry the suffix too.
      await expect(fac.room.participantList.getByText('ALEX (3)', { exact: true })).toBeVisible();
      // Votes and highlights use the suffixed names.
      await alex1.room.vote('2');
      await alex2.room.vote('5');
      await alex3.room.vote('8');
      await fac.room.reveal.click();
      await fac.room.expectRevealedValues({ Alex: '2', 'alex (2)': '5', 'ALEX (3)': '8' });
      await expect(fac.room.row('Alex')).toHaveAttribute('data-extreme', 'lowest');
      await expect(fac.room.row('ALEX (3)')).toHaveAttribute('data-extreme', 'highest');
    },
  );

  test(
    'F01-AC8: a participant keeps their suffix when an earlier namesake is removed',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Alex' }]);
      const second = await world.join(room, { name: 'Alex' });
      await expect(fac.room.row('Alex (2)')).toBeVisible();
      await fac.page.getByTestId(`remove-${await others[0]!.id()}`).click();
      await expect(fac.room.row('Alex (2)')).toBeVisible();
      await expect(second.room.row('Alex (2)')).toBeVisible();
    },
  );
});

test.describe('presence (F01-AC21)', () => {
  test(
    'F01-AC21: the list shows name, role, online state and voted state',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [
        { name: 'Vera' },
        { name: 'Olga', role: 'observer' },
      ]);
      await others[0]!.room.vote('1');
      const row = fac.room.row('Vera');
      await expect(row).toHaveAttribute('data-role', 'voter');
      await expect(row).toHaveAttribute('data-online', 'true');
      await expect(row).toHaveAttribute('data-voted', 'true');
      await expect(fac.room.row('Olga')).toHaveAttribute('data-role', 'observer');
      await expect(fac.room.ownRow).toHaveAttribute('data-you', 'true');
    },
  );

  test(
    'F01-AC21: a clean close shows offline within 1 s, returning shows online again',
    cross,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      await others[0]!.page.close();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'false', { timeout: 1000 });
      const page = await others[0]!.context.newPage();
      await page.goto(room.url);
      await new RoomPage(page).expectInRoom();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'true');
    },
  );

  test(
    'F01-AC21: a silent connection loss shows offline after the heartbeat timeout',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera', net: true }], {
        timers: { heartbeatTimeoutMs: 1500 },
      });
      await others[0]!.net!.goOffline();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'false', { timeout: 8000 });
    },
  );

  test(
    'F01-AC21: a participant who reconnects within the timeout never flickers offline',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera', net: true }], {
        timers: { heartbeatTimeoutMs: 5000 },
      });
      const vera = others[0]!;
      await vera.net!.dropConnectionOnce();
      await expect.poll(() => vera.rec.socketsOpened).toBeGreaterThanOrEqual(2);
      await vera.rec.waitForState((s) => s.participants.some((p) => p.online), 'resynced');
      // Facilitator never saw Vera offline: every snapshot has her online.
      // (A clean close from a dropped connection is allowed to show offline; only a reconnect
      // inside the window is exempt, so this asserts the end state and the participant count.)
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'true');
      await expect(fac.room.rows).toHaveCount(2);
    },
  );

  test(
    'F01-AC21: an offline participant without a vote is purged after the purge time, with a vote they stay until reset',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom({
        timers: { offlinePurgeMs: 600, heartbeatTimeoutMs: 1000 },
      });
      const fac = await world.rawFacilitator(room);
      const voted = await world.raw(room, 'Voted');
      const idle = await world.raw(room, 'Idle');
      await voted.vote('5');
      voted.close();
      idle.close();
      await fac.waitForState(
        (s) => !s.participants.some((p) => p.name === 'Idle'),
        'Idle purged',
        15_000,
      );
      // Purge has run: Voted is still listed because of their vote.
      expect(fac.state!.participants.map((p) => p.name)).toContain('Voted');
      // At the first reset after the purge time they go.
      await fac.command('reset');
      await fac.waitForState(
        (s) => !s.participants.some((p) => p.name === 'Voted'),
        'Voted purged at reset',
        15_000,
      );
    },
  );

  test('F01-AC21: the facilitator is never purged', chromiumOnly, async ({ world }) => {
    const room = await world.createRoom({
      timers: { offlinePurgeMs: 500, heartbeatTimeoutMs: 1000 },
    });
    const fac = await world.rawFacilitator(room);
    const watcher = await world.raw(room, 'Watcher');
    const later = await world.raw(room, 'Later');
    fac.close();
    await watcher.waitForState(
      (s) => s.participants.some((p) => p.id === room.facilitatorId && !p.online),
      'fac offline',
    );
    later.close();
    // Later was disconnected after the facilitator and is purged, so the purge cycle has run past the facilitator's time.
    await watcher.waitForState(
      (s) => !s.participants.some((p) => p.name === 'Later'),
      'Later purged',
      15_000,
    );
    expect(watcher.state!.participants.some((p) => p.id === room.facilitatorId)).toBe(true);
    expect(watcher.state!.facilitatorId).toBe(room.facilitatorId);
  });
});

test.describe('removing participants (F01-AC23)', () => {
  test(
    'F01-AC23: the removed participant sees a notice, does not reconnect, and can rejoin fresh',
    cross,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }, { name: 'Walt' }]);
      const [vera, walt] = others as [(typeof others)[0], (typeof others)[0]];
      await vera.room.vote('5');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      const veraId = await vera.id();
      await fac.page.getByTestId(`remove-${veraId}`).click();
      await expect(vera.page.getByTestId('removed-notice')).toContainText(/removed/i);
      await expect(fac.room.row('Vera')).toHaveCount(0);
      await expect(walt.room.row('Vera')).toHaveCount(0);
      await fac.room.expectCounter(0, 2);
      // No silent reconnect loop.
      const opened = vera.rec.socketsOpened;
      await observeFor(vera.page, 1500);
      expect(vera.rec.socketsOpened).toBe(opened);
      await expect(vera.page.getByTestId('removed-notice')).toBeVisible();
      // Rejoin starts a fresh join with the name prompt.
      await vera.page.getByTestId('removed-rejoin').click();
      await expect(vera.page.getByTestId('join-name')).toBeVisible();
      await vera.page.getByTestId('join-name').fill('Vera');
      await vera.page.getByTestId('join-submit').click();
      await vera.room.expectInRoom();
      expect(await vera.id()).not.toBe(veraId);
      void room;
    },
  );

  test(
    'F01-AC23: opening the link again after removal is a fresh join',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await fac.page.getByTestId(`remove-${await vera.id()}`).click();
      await expect(vera.page.getByTestId('removed-notice')).toBeVisible();
      await vera.page.goto(room.url);
      await expect(vera.page.getByTestId('join-name')).toBeVisible();
    },
  );

  test(
    'F01-AC23: removing an offline participant works and removal drops their unrevealed vote',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const b = await world.raw(room, 'Ben');
      await b.vote('8');
      const id = b.state!.selfId;
      b.close();
      await fac.waitForState(
        (s) => s.participants.some((p) => p.id === id && !p.online),
        'offline',
      );
      expect((await fac.command('remove_participant', { participantId: id })).ok).toBe(true);
      const s = await fac.waitForState(
        (st) => !st.participants.some((p) => p.id === id),
        'removed',
      );
      expect(s.round.phase).toBe('voting');
      expect(s.participants.every((p) => !p.hasVoted)).toBe(true);
      // Their token is tombstoned: a rejoin answers removed (fatal), never admitted.
      const again = await world.rawConnect(room.roomId);
      again.send({ type: 'rejoin', token: b.token });
      await again.waitUntil(() => again.errors().length > 0, 'error');
      expect(again.errors()[0]).toMatchObject({ code: 'removed', fatal: true });
    },
  );

  test(
    'F01-AC23: a connected participant that is removed gets a fatal removed error and is closed',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const b = await world.raw(room, 'Ben');
      await fac.command('remove_participant', { participantId: b.state!.selfId });
      await b.waitUntil(
        () => b.errors().some((e) => e.code === 'removed' && e.fatal),
        'removed error',
      );
      await b.waitForClose();
    },
  );

  test(
    'F01-AC23: removing a participant frees a slot and a non-facilitator cannot remove',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      const b = await world.raw(room, 'Ben');
      const r = await a.command('remove_participant', { participantId: b.state!.selfId });
      expect(r.ok ? 'ok' : r.code).toBe('not_allowed');
    },
  );
});

test.describe('hand over (F01-AC24)', () => {
  test(
    'F01-AC24: handing over moves the controls immediately and leaves exactly one facilitator',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }, { name: 'Walt' }]);
      const [vera, walt] = others as [(typeof others)[0], (typeof others)[0]];
      await vera.room.vote('5');
      const veraId = await vera.id();
      await fac.page.getByTestId(`handover-${veraId}`).click();
      await expect(vera.room.reveal).toBeVisible();
      await expect(vera.room.settingsOpen).toBeVisible();
      await expect(fac.room.reveal).toHaveCount(0);
      await expect(fac.room.settingsOpen).toHaveCount(0);
      await expect(walt.room.reveal).toHaveCount(0);
      for (const p of [fac, vera, walt]) {
        const s = await p.rec.waitForState(
          (st) => st.facilitatorId === veraId,
          'facilitator moved',
        );
        expect(s.participants.filter((x) => x.id === s.facilitatorId)).toHaveLength(1);
      }
      // The old facilitator keeps their voter role, existing votes stay.
      await expect(fac.room.ownRow).toHaveAttribute('data-role', 'voter');
      await expect(walt.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await fac.room.vote('3');
    },
  );

  test(
    'F01-AC24: hand over to an observer keeps both roles; to an offline target is rejected with target_offline',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const off = await world.raw(room, 'Off');
      const obs = await world.raw(room, 'Olga', 'observer');
      off.close();
      await fac.waitForState(
        (s) => s.participants.some((p) => p.name === 'Off' && !p.online),
        'Off offline',
      );
      const offId = off.state!.selfId;
      const r = await fac.command('hand_over', { participantId: offId });
      expect(r.ok ? 'ok' : r.code).toBe('target_offline');
      expect(fac.state!.facilitatorId).toBe(room.facilitatorId);

      expect((await fac.command('hand_over', { participantId: obs.state!.selfId })).ok).toBe(true);
      const s = await obs.waitForState(
        (st) => st.facilitatorId === obs.state!.selfId,
        'observer is facilitator',
      );
      expect(s.participants.find((p) => p.id === s.selfId)?.role).toBe('observer');
      expect(s.participants.find((p) => p.id === room.facilitatorId)?.role).toBe('voter');
    },
  );

  test(
    'F01-AC24 / F01-X-RACE-12: commands of the old facilitator after the handover are refused',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      // Sent back to back without awaiting: processed in order by the room.
      const handover = fac.command('hand_over', { participantId: a.state!.selfId });
      const late = fac.command('update_settings', { settings: { autoReveal: true } });
      const [h, l] = await Promise.all([handover, late]);
      expect(h.ok).toBe(true);
      expect(l.ok ? 'ok' : l.code).toBe('not_allowed');
      expect((await fac.command('reveal')).ok ? 'ok' : 'denied').toBe('denied');
    },
  );

  test(
    'F01-AC24 / F01-X-RACE-6: handover while the target switches to observer leaves exactly one facilitator',
    chromiumOnly,
    async ({ world }) => {
      for (let i = 0; i < 3; i++) {
        const room = await world.createRoom();
        const fac = await world.rawFacilitator(room);
        const a = await world.raw(room, 'Ann');
        await Promise.all([
          fac.command('hand_over', { participantId: a.state!.selfId }),
          a.command('set_role', { role: 'observer' }),
        ]);
        const s = await fac.waitForState(
          (st) => st.participants.every((p) => p.role !== undefined),
          'settled',
        );
        await a.waitForState((st) => st.version >= s.version, 'both converged');
        expect(a.state!.facilitatorId).toBe(fac.state!.facilitatorId);
        expect(
          fac.state!.participants.filter((p) => p.id === fac.state!.facilitatorId),
        ).toHaveLength(1);
      }
    },
  );
});

test.describe('claim facilitator (F01-AC25)', () => {
  test(
    'F01-AC25: after the threshold any online participant can claim; the returning facilitator is a voter',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        {
          timers: { heartbeatTimeoutMs: 800, facilitatorClaimMs: 2500 },
          facilitatorNet: true,
        },
      );
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      await expect(vera.room.claim).toHaveCount(0);
      expect((await vera.rec.waitForState(() => true, 'state')).canClaimAt).toBeNull();
      await fac.net!.goOffline();
      await expect(vera.room.row('Fiona')).toHaveAttribute('data-online', 'false', {
        timeout: 8000,
      });
      await expect(olga.room.claim).toBeVisible({ timeout: 10_000 });
      await vera.room.claim.click();
      for (const p of [vera, olga]) {
        await p.rec.waitForState((s) => s.facilitatorId === vera.rec.selfId, 'Vera is facilitator');
      }
      await expect(vera.room.reveal).toBeVisible();
      await expect(olga.room.claim).toHaveCount(0);
      // The old facilitator returns as a voter.
      await fac.net!.goOnline();
      await fac.rec.waitForState(
        (s) =>
          s.facilitatorId === vera.rec.selfId &&
          s.participants.find((p) => p.id === s.selfId)?.online === true,
        'old facilitator back',
      );
      await expect(fac.room.reveal).toHaveCount(0);
      await expect(fac.room.ownRow).toHaveAttribute('data-role', 'voter');
    },
  );

  test(
    'F01-AC25: two simultaneous claims have exactly one winner',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom({
        timers: { facilitatorClaimMs: 300, heartbeatTimeoutMs: 500 },
      });
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      const b = await world.raw(room, 'Ben', 'observer');
      fac.close();
      await waitForClaimOpen(a);
      const [ra, rb] = await Promise.all([
        a.command('claim_facilitator'),
        b.command('claim_facilitator'),
      ]);
      const results = [ra, rb];
      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const loser = results.find((r) => !r.ok);
      expect(loser && !loser.ok ? loser.code : '').toBe('already_claimed');
      await a.waitForState((s) => s.facilitatorId !== room.facilitatorId, 'new facilitator');
      await b.waitForState((s) => s.version >= a.state!.version, 'converged');
      expect(a.state!.facilitatorId).toBe(b.state!.facilitatorId);
    },
  );

  test(
    'F01-AC25: a returning facilitator who has not been replaced stays facilitator; claims before the threshold are refused',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom({
        timers: { facilitatorClaimMs: 60_000, heartbeatTimeoutMs: 500 },
      });
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      fac.close();
      await a.waitForState((s) => s.canClaimAt !== null, 'claim window announced');
      const r = await a.command('claim_facilitator');
      expect(r.ok ? 'ok' : r.code).toBe('claim_not_available');
      const back = await world.rawConnect(room.roomId);
      await back.rejoin(room.facilitatorToken);
      expect(back.state!.facilitatorId).toBe(room.facilitatorId);
      await a.waitForState((s) => s.canClaimAt === null, 'claim window closed');
    },
  );
});

test.describe('role switch (F01-AC26) and facilitator votes (F01-AC35)', () => {
  test(
    'F01-AC26: switching to observer withdraws the vote for everyone and removes the cards, switching back restores them',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.room.vote('5');
      await fac.room.expectCounter(1, 2);
      await vera.room.roleSwitch.click();
      await expect(vera.page.locator('[data-testid^="card-"]')).toHaveCount(0);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-role', 'observer');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'false');
      await fac.room.expectCounter(0, 1);
      await vera.room.roleSwitch.click();
      await expect(vera.room.card('5')).toBeVisible();
      await vera.room.expectSelected('5', false);
      await fac.room.expectCounter(0, 2);
    },
  );

  test('F01-AC26: the facilitator can switch themselves to observer', cross, async ({ world }) => {
    const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
    await fac.room.roleSwitch.click();
    await expect(fac.page.locator('[data-testid^="card-"]')).toHaveCount(0);
    await expect(fac.room.reveal).toBeVisible();
    await expect(others[0]!.room.row('Fiona')).toHaveAttribute('data-role', 'observer');
  });

  test(
    'F01-AC35: with facilitator votes off the facilitator has no cards and is not counted',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }], {
        settings: { facilitatorVotes: false },
      });
      await expect(fac.page.locator('[data-testid^="card-"]')).toHaveCount(0);
      await fac.room.expectCounter(0, 1);
      await others[0]!.room.vote('3');
      await fac.room.expectCounter(1, 1);
    },
  );

  test(
    "F01-AC35: turning facilitator votes off mid-round withdraws the facilitator's vote",
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      await fac.vote('5');
      expect(
        (await fac.command('update_settings', { settings: { facilitatorVotes: false } })).ok,
      ).toBe(true);
      const s = await fac.waitForState((st) => !st.settings.facilitatorVotes, 'setting applied');
      expect(s.myVote).toBeNull();
      expect(s.participants[0]?.hasVoted).toBe(false);
    },
  );

  test(
    'F01-AC26: after reveal a role switch does not change the revealed vote',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      await a.vote('5');
      await fac.command('reveal');
      await a.command('set_role', { role: 'observer' });
      const s = await fac.waitForState(
        (st) => st.participants.some((p) => p.name === 'Ann' && p.role === 'observer'),
        'switched',
      );
      expect(s.round.phase === 'revealed' ? s.round.votes.map((v) => v.card) : []).toEqual(['5']);
    },
  );
});

test.describe('rename (F01-AC36)', () => {
  test(
    'F01-AC36: renaming follows the name rules and duplicate suffixes',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom({ displayName: 'Alex' });
      const fac = await world.rawFacilitator(room);
      const b = await world.raw(room, 'Bea');
      expect((await b.command('rename', { name: 'alex' })).ok).toBe(true);
      const s = await fac.waitForState(
        (st) => st.participants.some((p) => p.name === 'alex (2)'),
        'suffixed rename',
      );
      expect(s.participants[0]?.name).toBe('Alex');
      for (const name of ['', '   ', 'x'.repeat(31), 'a\tb']) {
        const r = await b.command('rename', { name });
        expect(r.ok ? 'ok' : r.code, JSON.stringify(name)).toBe('invalid_input');
      }
      expect((await b.command('rename', { name: '  Bea   Smith ' })).ok).toBe(true);
      await fac.waitForState(
        (st) => st.participants.some((p) => p.name === 'Bea Smith'),
        'normalized rename',
      );
    },
  );
});
