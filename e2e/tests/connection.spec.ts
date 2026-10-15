import { expect, test } from '../fixtures';
import { RoomPage } from '../helpers/room-page';
import { makeRoom } from '../fixtures/scenarios';
import { observeFor } from '../helpers/wait';

const cross = { tag: '@cross-browser' };
const chromiumOnly = { tag: '@chromium-only' };
const FAST = { heartbeatTimeoutMs: 1200 };

test.describe('reconnect (F01-AC29)', () => {
  test(
    'F01-AC29: offline shows a non-blocking reconnecting indicator, then resyncs with my vote intact',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera', net: true }], {
        timers: FAST,
      });
      const vera = others[0]!;
      await vera.room.vote('5');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');

      await vera.net!.goOffline();
      await expect(vera.room.connection).toBeVisible();
      await expect(vera.room.connection).toHaveAttribute('data-state', 'reconnecting');
      // Non-blocking: no modal, page still interactive, cards disabled and nothing queued.
      await expect(vera.page.getByRole('dialog')).toHaveCount(0);
      await expect(vera.room.card('8')).toHaveAttribute('aria-disabled', 'true');
      await expect(vera.room.root).toBeVisible();
      // The indicator is a polite live region.
      const live = await vera.room.connection.evaluate(
        (el) => el.closest('[aria-live]')?.getAttribute('aria-live') ?? el.getAttribute('role'),
      );
      expect(['polite', 'status']).toContain(live);
      // Others see Vera offline but still voted.
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'false', { timeout: 8000 });
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');

      await vera.net!.goOnline();
      await expect(vera.room.connection)
        .toHaveAttribute('data-state', 'connected')
        .catch(async () => {
          await expect(vera.room.connection).toHaveCount(0);
        });
      await vera.room.expectSelected('5');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'true');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await expect(fac.room.rows).toHaveCount(2);
      expect(vera.rec.lastState!.myVote).toBe('5');
    },
  );

  test(
    'F01-AC29: changes made by others while offline (reveal, reset, topic, settings) appear after reconnect, not stale state',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera', net: true }], {
        timers: FAST,
      });
      const vera = others[0]!;
      await vera.room.vote('5');
      await vera.net!.goOffline();
      await expect(vera.room.connection).toHaveAttribute('data-state', 'reconnecting');
      await fac.room.reveal.click();
      await expect(fac.room.summary).toBeVisible();
      await fac.room.reset.click();
      await fac.room.setTopic('Changed while you were away');
      await fac.room.openSettings();
      await fac.room.selectDeck('tshirt');
      await vera.net!.goOnline();
      await expect(vera.room.topicDisplay).toHaveText('Changed while you were away');
      await expect(vera.room.card('xl')).toBeVisible();
      await expect(vera.room.summary).toHaveCount(0);
      const s = await vera.rec.waitForState((st) => st.settings.deck.id === 'tshirt', 'resynced');
      expect(s.round.phase).toBe('voting');
      expect(s.myVote).toBeNull();
      await expect.poll(() => vera.room.version()).toBe(await fac.room.version());
    },
  );

  test(
    'F01-AC29: the reveal that happened while offline is shown after reconnect',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera', net: true }], {
        timers: FAST,
      });
      const vera = others[0]!;
      await vera.room.vote('5');
      await vera.net!.goOffline();
      await fac.room.reveal.click();
      await vera.net!.goOnline();
      await expect(vera.room.row('Vera').getByTestId('participant-vote')).toHaveText('5');
      await expect(vera.room.summary).toBeVisible();
    },
  );

  test(
    'F01-AC29: a server-side close reconnects by itself and keeps the vote',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera', net: true }]);
      const vera = others[0]!;
      await vera.room.vote('13');
      await vera.net!.dropConnectionOnce();
      await expect.poll(() => vera.rec.socketsOpened).toBeGreaterThanOrEqual(2);
      await vera.room.expectSelected('13');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await expect(fac.room.rows).toHaveCount(2);
    },
  );

  test(
    'F01-AC29: five offline/online flaps leave one participant entry and the vote intact',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera', net: true }], {
        timers: FAST,
      });
      const vera = others[0]!;
      await vera.room.vote('21');
      for (let i = 0; i < 5; i++) {
        await vera.net!.goOffline({ clean: true });
        await expect(vera.room.connection).toHaveAttribute('data-state', 'reconnecting');
        await vera.net!.goOnline();
        await vera.rec.waitForState(() => true, 'state');
        await expect.poll(() => vera.rec.lastState?.myVote, { message: `flap ${i}` }).toBe('21');
      }
      await vera.room.expectSelected('21');
      await expect(fac.room.rows).toHaveCount(2);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'true');
    },
  );

  test(
    'F01-AC29: reconnect attempts back off and never stop (configured backoff 100 ms x2 up to 400 ms)',
    chromiumOnly,
    async ({ world }) => {
      const { others } = await makeRoom(world, [{ name: 'Vera', net: true }]);
      const vera = others[0]!;
      const before = vera.rec.socketsOpened;
      await vera.net!.goOffline();
      await expect(vera.room.connection).toHaveAttribute('data-state', 'reconnecting');
      await observeFor(vera.page, 3000);
      const attempts = vera.rec.socketsOpened - before;
      // 100, 200, 400, 400, ...: about 9 attempts in 3 s. Bounds are generous but catch a tight loop or no retries.
      expect(attempts).toBeGreaterThanOrEqual(3);
      expect(attempts).toBeLessThanOrEqual(15);
      await vera.net!.goOnline();
      await vera.rec.waitForState(() => true, 'state');
      await expect(vera.room.rows).toHaveCount(2);
    },
  );

  test(
    'F01-AC29: the reconnecting indicator appears only after about one second, not on a blip',
    chromiumOnly,
    async ({ world }) => {
      const { others } = await makeRoom(world, [{ name: 'Vera', net: true }], {});
      const vera = others[0]!;
      await vera.net!.goOffline();
      // Not yet (default delay is 1 s; the check below runs right away).
      const early = await vera.room.connection.isVisible();
      expect(early).toBe(false);
      await expect(vera.room.connection).toBeVisible({ timeout: 3000 });
    },
  );

  test(
    'F01-AC29: a participant removed while offline sees the removed screen after reconnect, not a rejoin',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera', net: true }], {
        timers: FAST,
      });
      const vera = others[0]!;
      const id = await vera.id();
      await vera.net!.goOffline();
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'false', { timeout: 8000 });
      await fac.page.getByTestId(`remove-${id}`).click();
      await vera.net!.goOnline();
      await expect(vera.page.getByTestId('removed-notice')).toBeVisible();
    },
  );
});

test.describe('removed screen (F01-AC23, F01-AC29)', () => {
  test(
    'F01-AC23 / F01-AC29: after the removed screen a reload is a fresh join, and a second tab with the same token also sees removed',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      const tab2 = await vera.context.newPage();
      await tab2.goto(room.url);
      await new RoomPage(tab2).expectInRoom();
      await fac.page.getByTestId(`remove-${await vera.id()}`).click();
      await expect(vera.page.getByTestId('removed-notice')).toBeVisible();
      await expect(tab2.getByTestId('removed-notice')).toBeVisible();
      await vera.page.reload();
      await expect(vera.page.getByTestId('join-name')).toBeVisible();
      await expect(vera.page.getByTestId('removed-notice')).toHaveCount(0);
    },
  );
});

test.describe('hibernation (F01-AC30)', () => {
  test(
    'F01-AC30: after the room memory is dropped, open sockets keep working with all state intact',
    cross,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }], {
        settings: { autoReveal: false },
      });
      const vera = others[0]!;
      await fac.room.setTopic('Persisted topic');
      await vera.room.vote('8');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      const instanceBefore = await world.api.instanceId(room.roomId);
      const versionBefore = await fac.room.version();
      const socketsBefore = [fac.rec.socketsOpened, vera.rec.socketsOpened];

      const previous = await world.api.evict(room.roomId, 'drop_memory');
      expect(previous).toBe(instanceBefore);
      expect(await world.api.instanceId(room.roomId)).not.toBe(instanceBefore);

      // A message on the existing connection is processed with all state intact.
      await vera.room.vote('3');
      await vera.room.expectSelected('3');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await expect(fac.room.topicDisplay).toHaveText('Persisted topic');
      await expect(vera.room.topicDisplay).toHaveText('Persisted topic');
      await fac.room.waitForVersionAtLeast(versionBefore + 1);
      await expect(fac.room.rows).toHaveCount(2);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'true');
      // Sockets stayed open: nobody had to reconnect.
      expect([fac.rec.socketsOpened, vera.rec.socketsOpened]).toEqual(socketsBefore);
      // Roles and permissions survived: the facilitator can still reveal, the voter cannot.
      await expect(vera.room.reveal).toHaveCount(0);
      await fac.room.reveal.click();
      await expect(vera.room.row('Vera').getByTestId('participant-vote')).toHaveText('3');
    },
  );

  test(
    'F01-AC30: server state is identical before and after dropping memory (raw snapshot compare)',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom({
        displayName: 'Dana',
        settings: { name: 'Hibernating', controlMode: 'everyone', autoReveal: false },
      });
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      const o = await world.raw(room, 'Olga', 'observer');
      await fac.command('set_topic', { topic: 'T' });
      await a.vote('5');
      await fac.vote('2');
      const b = await world.raw(room, 'Ben');
      b.close();
      await fac.waitForState(
        (s) => s.participants.some((p) => p.name === 'Ben' && !p.online),
        'Ben offline',
      );
      // The observer must have seen the same presence before it is used as the baseline.
      await o.waitForState(
        (s) => s.participants.some((p) => p.name === 'Ben' && !p.online),
        'Ben offline for the observer',
      );
      const before = structuredClone(o.state!);

      await world.api.evict(room.roomId, 'drop_memory');
      // A harmless message forces the room to wake: a ping is auto-answered, so use a no-op reveal-free command.
      expect((await o.command('set_role', { role: 'observer' })).ok).toBe(true);
      const after = o.state!;
      const strip = (s: typeof before) => ({ ...s, version: 0, serverTime: 0, canClaimAt: null });
      expect(strip(after)).toEqual(strip(before));
      expect(after.version).toBeGreaterThanOrEqual(before.version);
      // The identity of the connected sockets survived: Ann is still online and still herself.
      expect((await a.vote('8')).ok).toBe(true);
      await fac.waitForState(
        (s) => s.participants.find((p) => p.name === 'Ann')?.online === true,
        'Ann online',
      );
    },
  );

  test(
    'F01-AC30 / F01-AC29: aborting the room closes sockets, clients reconnect and votes are intact',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.room.vote('5');
      await fac.room.setTopic('Abort me');
      const before = vera.rec.socketsOpened;
      await world.api.evict(room.roomId, 'abort');
      await expect.poll(() => vera.rec.socketsOpened).toBeGreaterThan(before);
      await vera.room.expectSelected('5');
      await expect(fac.room.topicDisplay).toHaveText('Abort me');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-online', 'true');
      await vera.room.vote('8');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
    },
  );

  test(
    'F01-AC30: the state version survives eviction and never goes backwards',
    chromiumOnly,
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      await fac.vote('5');
      const before = fac.state!.version;
      await world.api.evict(room.roomId, 'drop_memory');
      await fac.vote('3');
      await fac.waitForState((s) => s.myVote === '3', 'vote after eviction');
      expect(fac.state!.version).toBeGreaterThan(before);
    },
  );
});
