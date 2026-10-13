import { resolveDeck } from '@pokr/shared';
import { expect, test } from '../fixtures';
import { makeRoom } from '../fixtures/scenarios';
import { framesLeaking } from '../helpers/leak';

const cross = { tag: '@cross-browser' };
const FIB = resolveDeck({ id: 'fibonacci' });

test.describe('casting votes', () => {
  test(
    'F01-AC9: my card is highlighted after the ack; others see "voted" but never the value',
    cross,
    async ({ world }) => {
      const deck = { id: 'custom' as const, cards: ['q7xz', 'k3vm'] };
      const { fac, others } = await makeRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        { settings: { deck } },
      );
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      await vera.room.card('q7xz').click();
      await vera.room.expectSelected('q7xz');
      await expect(vera.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      for (const watcher of [fac, olga]) {
        await expect(watcher.room.row('Vera')).toHaveAttribute('data-voted', 'true');
        await expect(watcher.room.row('Fiona')).toHaveAttribute('data-voted', 'false');
        // The value is nowhere in the participant list: text, attributes, titles, aria-labels.
        const html = await watcher.room.participantList.evaluate((el) => el.outerHTML);
        expect(html).not.toContain('q7xz');
        // Non-colour cue: the indicator has text or an accessible name.
        const row = watcher.room.row('Vera');
        await expect(row.getByText(/voted/i).or(row.getByLabel(/voted/i)).first()).toBeAttached();
      }
      // The counter does not show values either.
      expect(await fac.room.votedCount.innerText()).not.toContain('q7xz');
      await fac.room.expectCounter(1, 2);
    },
  );

  test(
    'F01-AC10: changing a vote, withdrawing it by clicking again; others only see the indicator',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.room.vote('5');
      await vera.room.vote('8');
      await vera.room.expectSelected('5', false);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await fac.room.expectCounter(1, 2);
      await vera.room.click('8');
      await vera.room.expectSelected('8', false);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'false');
      await fac.room.expectCounter(0, 2);
    },
  );

  test(
    'F01-AC10: the reveal shows the changed vote, not the first one',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.room.vote('5');
      await vera.room.vote('8');
      await expect(vera.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await fac.room.reveal.click();
      await expect(fac.room.row('Vera').getByTestId('participant-vote')).toHaveText('8');
    },
  );

  test(
    'F01-AC10 / F01-AC33: cards select and withdraw with Space and Enter',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      const card = vera.room.card('3');
      await card.focus();
      await vera.page.keyboard.press('Space');
      await vera.room.expectSelected('3');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await vera.page.keyboard.press('Space');
      await vera.room.expectSelected('3', false);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'false');
      await vera.page.keyboard.press('Enter');
      await vera.room.expectSelected('3');
      await vera.page.keyboard.press('Enter');
      await vera.room.expectSelected('3', false);
    },
  );

  test(
    'F01-AC10: rapid select / deselect / select ends consistent on every client',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      const c = vera.room.card('13');
      await c.click();
      await c.click();
      await c.click();
      await vera.room.expectSelected('13');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
      await vera.rec.waitForState((s) => s.myVote === '13', 'server holds 13');
    },
  );

  test(
    'F01-AC9: every card of the deck is offered, including 1/2 and coffee with accessible names',
    cross,
    async ({ world }) => {
      const { others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      for (const c of FIB) await expect(vera.room.card(c)).toBeVisible();
      await expect(
        vera.room.cardGrid
          .getByRole('radio', { name: /half/i })
          .or(vera.room.cardGrid.getByRole('button', { name: /half/i })),
      ).toBeVisible();
      await expect(
        vera.room.cardGrid
          .getByRole('radio', { name: /coffee/i })
          .or(vera.room.cardGrid.getByRole('button', { name: /coffee/i })),
      ).toBeVisible();
    },
  );

  test('F01-AC12: observers have no cards; the counter ignores them', cross, async ({ world }) => {
    const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
    const vera = others[0]!;
    await fac.room.expectCounter(0, 2);
    const olga = await world.join(room, { name: 'Olga', role: 'observer' });
    await expect(olga.page.locator('[data-testid^="card-"]')).toHaveCount(0);
    await expect(fac.room.row('Olga')).toBeVisible();
    await fac.room.expectCounter(0, 2);
    await vera.room.vote('2');
    await fac.room.expectCounter(1, 2);
    await olga.room.expectCounter(1, 2);
    const raw = await world.raw(room, 'Rolf', 'observer');
    await fac.room.expectCounter(1, 2);
    const r = await raw.vote('2');
    expect(r.ok ? 'ok' : r.code).toBe('not_allowed');
  });

  test(
    'F01-AC12 / F01-AC22: an offline voter without a vote leaves the denominator, an offline voter with a vote stays in it',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { room, fac } = await makeRoom(world, []);
      const a = await world.raw(room, 'Ann');
      const b = await world.raw(room, 'Ben');
      await fac.room.expectCounter(0, 3);
      await a.vote('5');
      await fac.room.expectCounter(1, 3);
      a.close();
      await expect(fac.room.row('Ann')).toHaveAttribute('data-online', 'false');
      await fac.room.expectCounter(1, 3);
      b.close();
      await expect(fac.room.row('Ben')).toHaveAttribute('data-online', 'false');
      await fac.room.expectCounter(1, 2);
    },
  );
});

test.describe('hidden votes (F01-AC11)', () => {
  test(
    'F01-AC11: no vote value reaches any other client before reveal (WebSocket frame inspection)',
    cross,
    async ({ world }) => {
      const deck = { id: 'custom' as const, cards: ['q7xz', 'k3vm', 'w9pd', 'z4hn'] };
      const { room, fac, others } = await makeRoom(
        world,
        [{ name: 'Anna', net: true }, { name: 'Ben' }],
        { settings: { deck } },
      );
      const [anna, ben] = others as [(typeof others)[0], (typeof others)[0]];
      const cast = new Map<string, Set<string>>([
        [fac.name, new Set()],
        [anna.name, new Set()],
        [ben.name, new Set()],
      ]);
      const castVote = async (p: typeof fac, card: string) => {
        await p.room.card(card).click();
        await p.rec.waitForState((s) => s.myVote === card, `${p.name} vote acked`);
        cast.get(p.name)!.add(card);
      };

      await castVote(anna, 'q7xz');
      await castVote(ben, 'k3vm');
      await castVote(fac, 'z4hn');
      // change and withdrawal
      await castVote(anna, 'w9pd');
      await ben.room.card('k3vm').click(); // withdraw
      await ben.rec.waitForState((s) => s.myVote === null, 'ben withdrew');
      await castVote(ben, 'k3vm');
      // late join: an observer who arrives mid-round gets a snapshot
      const olga = await world.join(room, { name: 'Olga', role: 'observer' });
      // reload of a voter
      await ben.page.reload();
      await ben.room.expectSelected('k3vm');
      // connection drop and resync of a voter (route-layer drop; reconnect is automatic)
      await anna.net!.dropConnectionOnce();
      await expect
        .poll(() => anna.rec.socketsOpened, { message: 'anna reconnected' })
        .toBeGreaterThanOrEqual(2);
      await anna.room.expectSelected('w9pd');
      // everything is settled: all three voted
      await fac.room.expectCounter(3, 3);
      await expect(olga.room.row('Anna')).toHaveAttribute('data-voted', 'true');

      const everyone = [fac, anna, ben, olga];
      for (const p of everyone) {
        const own = cast.get(p.name) ?? new Set<string>();
        const forbidden = [...cast.values()].flatMap((set) => [...set]).filter((t) => !own.has(t));
        expect(p.rec.received.length, `${p.name} received frames`).toBeGreaterThan(0);
        expect(framesLeaking(p.rec, forbidden), `${p.name} saw another vote before reveal`).toEqual(
          [],
        );
        // No state frame may carry round.votes before reveal.
        for (const s of p.rec.states)
          if (s.round.phase === 'voting') expect('votes' in s.round).toBe(false);
      }

      // Positive control: after the reveal the tokens do show up (proves the detector works).
      const mark = olga.rec.mark();
      await fac.room.reveal.click();
      await expect(olga.room.row('Anna').getByTestId('participant-vote')).toHaveText('w9pd');
      const leaked = framesLeaking(olga.rec, ['w9pd', 'k3vm', 'z4hn'], mark);
      expect(leaked.length).toBeGreaterThan(0);

      // After reset, no stale votes: frames since the reset contain none of the tokens.
      const resetMark = olga.rec.mark();
      await fac.room.reset.click();
      await olga.rec.waitForState(
        (s) => s.round.phase === 'voting' && s.round.number > 1,
        'new round',
      );
      await expect(olga.room.row('Anna')).toHaveAttribute('data-voted', 'false');
      expect(framesLeaking(olga.rec, ['q7xz', 'k3vm', 'w9pd', 'z4hn'], resetMark)).toEqual([]);
    },
  );

  test(
    'F01-AC11: HTTP responses never carry votes',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const deck = { id: 'custom' as const, cards: ['q7xz', 'k3vm'] };
      const room = await world.createRoom({ settings: { deck } });
      const fac = await world.rawFacilitator(room);
      await fac.vote('q7xz');
      const res = await world.api.roomInfoRaw(room.roomId);
      expect(await res.text()).not.toContain('q7xz');
    },
  );
});
