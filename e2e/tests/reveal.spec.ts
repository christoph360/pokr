import type { RoomState } from '@pokr/shared';
import { expect, test } from '../fixtures';
import { makeRoom } from '../fixtures/scenarios';
import type { RawClient } from '../helpers/raw-client';
import { expectedSummary } from '../helpers/summary';

const cross = { tag: '@cross-browser' };
const revealed = (s: RoomState): boolean => s.round.phase === 'revealed';

test.describe('reveal', () => {
  test(
    'F01-AC13: in facilitator-only mode a voter has no reveal or reset controls',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [
        { name: 'Vera' },
        { name: 'Olga', role: 'observer' },
      ]);
      await expect(fac.room.reveal).toBeVisible();
      await expect(fac.room.reset).toBeVisible();
      for (const p of others) {
        await expect(p.room.reveal).toHaveCount(0);
        await expect(p.room.reset).toHaveCount(0);
        await expect(p.room.settingsOpen).toHaveCount(0);
        await expect(p.room.topicInput).toHaveCount(0);
      }
    },
  );

  test(
    'F01-AC13: in everyone mode voters get reveal and reset, observers do not, and live changes need no reload',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [
        { name: 'Vera' },
        { name: 'Olga', role: 'observer' },
      ]);
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      await fac.room.openSettings();
      await fac.room.setControlMode('everyone');
      await expect(vera.room.reveal).toBeVisible();
      await expect(vera.room.reset).toBeVisible();
      await expect(olga.room.reveal).toHaveCount(0);
      await expect(vera.room.topicInput).toHaveCount(0); // topic stays facilitator-only
      await expect(vera.room.settingsOpen).toHaveCount(0);
      await vera.room.reveal.click();
      await expect(fac.room.summary).toBeVisible();
      await vera.room.reset.click();
      await expect(fac.room.summary).toHaveCount(0);
      await fac.room.setControlMode('facilitator');
      await expect(vera.room.reveal).toHaveCount(0);
    },
  );

  test(
    'F01-AC14: all clients show identical votes and summary within 2 s of the reveal',
    cross,
    async ({ world }) => {
      const { fac, others, all } = await makeRoom(world, [
        { name: 'Anna' },
        { name: 'Ben' },
        { name: 'Olga', role: 'observer' },
      ]);
      await fac.room.vote('3');
      await others[0]!.room.vote('5');
      await others[1]!.room.vote('8');
      await fac.room.expectCounter(3, 3);
      await fac.room.reveal.click();
      await Promise.all(all.map((p) => expect(p.room.summary).toBeVisible({ timeout: 2000 })));
      const expected = { Fiona: '3', Anna: '5', Ben: '8' };
      for (const p of all) {
        await p.room.expectRevealedValues(expected);
      }
      // One state change: every client received a revealed snapshot with the same votes.
      const snapshots = all.map((p) => p.rec.states.find(revealed)!);
      const votesOf = (s: RoomState) =>
        s.round.phase === 'revealed'
          ? [...s.round.votes].sort((a, b) => a.participantId.localeCompare(b.participantId))
          : [];
      for (const s of snapshots) expect(votesOf(s)).toEqual(votesOf(snapshots[0]!));
      for (const s of snapshots) expect(s.version).toBe(snapshots[0]!.version);
      const times = all.map((p) => p.rec.firstReceivedAt(revealed)!);
      expect(Math.max(...times) - Math.min(...times)).toBeLessThan(2000);
    },
  );

  test(
    'F01-AC14: the reveal is announced through a live region (F01-AC33)',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      await others[0]!.room.vote('2');
      await fac.room.reveal.click();
      for (const p of [fac, ...others]) {
        await expect(p.room.announcer).toContainText(/reveal/i);
        const live = await p.room.announcer.evaluate(
          (el) => el.getAttribute('aria-live') ?? el.getAttribute('role'),
        );
        expect(['polite', 'assertive', 'status', 'alert']).toContain(live);
      }
    },
  );

  test(
    'F01-AC17: revealing with zero votes shows "no votes" and no numbers',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      await fac.room.reveal.click();
      for (const p of [fac, ...others]) {
        await expect(p.room.summary).toBeVisible();
        await expect(p.page.getByTestId('summary-no-votes')).toBeVisible();
        await expect(p.page.getByTestId('summary-average')).toHaveCount(0);
        await expect(p.page.getByTestId('summary-median')).toHaveCount(0);
        await expect(p.page.getByTestId('summary-consensus')).toHaveCount(0);
        expect(await p.room.summary.innerText()).not.toMatch(/NaN|undefined|null/);
      }
    },
  );

  test(
    'F01-AC17: revealing an already revealed round is a no-op',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      await a.vote('5');
      expect((await fac.command('reveal')).ok).toBe(true);
      const first = await fac.waitForState(revealed, 'revealed');
      const again = await fac.command('reveal');
      expect(again.ok).toBe(true);
      expect(fac.state!.round).toEqual(first.round);
    },
  );

  test(
    'F01-AC18: after reveal cards are disabled and votes are refused with round_revealed',
    cross,
    async ({ world }) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.room.vote('5');
      await fac.room.reveal.click();
      await expect(vera.room.summary).toBeVisible();
      await expect(vera.room.card('8')).toHaveAttribute('aria-disabled', 'true');
      await vera.room.card('8').click({ force: true });
      await expect(vera.room.row('Vera').getByTestId('participant-vote')).toHaveText('5');
      // Raw clients: vote and withdraw are refused.
      const raw = await world.raw(room, 'Rolf');
      for (const card of ['3', null]) {
        const r = await raw.vote(card);
        expect(r.ok ? 'ok' : r.code).toBe('round_revealed');
      }
      // A voter who joins after the reveal sees the values but cannot vote.
      const late = await world.join(room, { name: 'Lena' });
      await expect(late.room.row('Vera').getByTestId('participant-vote')).toHaveText('5');
      await expect(late.room.card('8')).toHaveAttribute('aria-disabled', 'true');
    },
  );

  test(
    'F01-AC18: after reveal role switches, settings changes and removals do not alter the revealed votes',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const room = await world.createRoom();
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      const b = await world.raw(room, 'Ben');
      await fac.vote('3');
      await a.vote('5');
      await b.vote('8');
      await fac.command('reveal');
      const before = await a.waitForState(revealed, 'revealed');
      const votes = before.round.phase === 'revealed' ? before.round.votes : [];
      expect(votes).toHaveLength(3);

      expect((await a.command('set_role', { role: 'observer' })).ok).toBe(true);
      expect(
        (await fac.command('update_settings', { settings: { facilitatorVotes: false } })).ok,
      ).toBe(true);
      expect((await fac.command('remove_participant', { participantId: b.state!.selfId })).ok).toBe(
        true,
      );
      const after = await fac.waitForState((s) => s.participants.length === 2, 'Ben removed');
      expect(after.round.phase).toBe('revealed');
      if (after.round.phase === 'revealed') {
        expect(after.round.votes).toEqual(votes);
        expect(after.round.left.map((l) => l.name)).toEqual(['Ben']);
      }
    },
  );

  test(
    'F01-AC18: a removed participant\'s revealed vote stays visible with a "left" marker',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }, { name: 'Walt' }]);
      const [vera, walt] = others as [(typeof others)[0], (typeof others)[0]];
      await vera.room.vote('5');
      await walt.room.vote('8');
      await fac.room.reveal.click();
      await expect(fac.room.summary).toBeVisible();
      await fac.page.getByTestId(`remove-${await walt.id()}`).click();
      await expect(walt.page.getByTestId('removed-notice')).toBeVisible();
      await expect(fac.room.participantList).toContainText(/Walt/);
      await expect(fac.room.participantList).toContainText(/left/i);
      await expect(fac.room.participantList).toContainText('8');
    },
  );
});

test.describe('summary (F01-AC15)', () => {
  interface Scenario {
    label: string;
    deck: 'fibonacci' | 'tshirt';
    cards: string[]; // first card is the facilitator's, the rest are raw voters
    numeric: boolean;
    lowest?: number[]; // indexes of voters holding the lowest card
    highest?: number[];
  }
  const scenarios: Scenario[] = [
    {
      label: 'fibonacci 3,5,8',
      deck: 'fibonacci',
      cards: ['3', '5', '8'],
      numeric: true,
      lowest: [0],
      highest: [2],
    },
    {
      label: 'fibonacci 5,5,5 (consensus, no extremes)',
      deck: 'fibonacci',
      cards: ['5', '5', '5'],
      numeric: true,
    },
    {
      label: 'fibonacci 1/2 and 1 (halves as decimals, .75 rounds up)',
      deck: 'fibonacci',
      cards: ['½', '1'],
      numeric: true,
      lowest: [0],
      highest: [1],
    },
    {
      label: 'fibonacci 2,3 with ? and coffee excluded',
      deck: 'fibonacci',
      cards: ['2', '3', '?', '☕'],
      numeric: true,
      lowest: [0],
      highest: [1],
    },
    {
      label: 'fibonacci 5,5,? (special does not break consensus)',
      deck: 'fibonacci',
      cards: ['5', '5', '?'],
      numeric: true,
    },
    {
      label: 'fibonacci 13,21,21 (average 18.3, median 21)',
      deck: 'fibonacci',
      cards: ['13', '21', '21'],
      numeric: true,
      lowest: [0],
      highest: [1, 2],
    },
    {
      label: 'fibonacci only ? votes (no average)',
      deck: 'fibonacci',
      cards: ['?', '?'],
      numeric: true,
    },
    {
      label: 't-shirt S,M,M (no average or median)',
      deck: 'tshirt',
      cards: ['S', 'M', 'M'],
      numeric: false,
      lowest: [0],
      highest: [1, 2],
    },
    {
      label: 't-shirt L,L (consensus on a non-numeric deck)',
      deck: 'tshirt',
      cards: ['L', 'L'],
      numeric: false,
    },
  ];

  for (const sc of scenarios) {
    test(`F01-AC15: summary for ${sc.label}`, { tag: '@chromium-only' }, async ({ world }) => {
      const { room, fac } = await makeRoom(world, [], { settings: { deck: { id: sc.deck } } });
      const olga = await world.join(room, { name: 'Olga', role: 'observer' });
      const raws: RawClient[] = [];
      for (let i = 1; i < sc.cards.length; i++) raws.push(await world.raw(room, `Rae${i}`));
      await fac.room.vote(sc.cards[0]!);
      for (let i = 1; i < sc.cards.length; i++) await raws[i - 1]!.vote(sc.cards[i]!);
      await fac.room.expectCounter(sc.cards.length, sc.cards.length);
      await fac.room.reveal.click();
      const exp = expectedSummary(sc.cards, sc.numeric);

      for (const p of [fac, olga]) {
        await expect(p.room.summary).toBeVisible();
        const avg = p.page.getByTestId('summary-average');
        const med = p.page.getByTestId('summary-median');
        if (exp.average === null) {
          await expect(avg).toHaveCount(0);
          await expect(med).toHaveCount(0);
        } else {
          await expect(avg).toContainText(exp.average);
          await expect(med).toContainText(
            new RegExp(`(^|[^\\d.])${exp.median!.replace('.', '\\.')}($|[^\\d])`),
          );
        }
        await expect(p.page.getByTestId('summary-consensus')).toHaveCount(exp.consensus ? 1 : 0);
        const counts = new Map<string, number>();
        for (const c of sc.cards) counts.set(c, (counts.get(c) ?? 0) + 1);
        for (const [card, n] of counts) {
          const slug =
            card === '?'
              ? 'question'
              : card === '☕'
                ? 'coffee'
                : card === '½'
                  ? 'half'
                  : card.toLowerCase();
          await expect(p.page.getByTestId(`summary-distribution-${slug}`)).toContainText(String(n));
        }
      }

      // Lowest / highest markers, as an attribute and as text.
      const names = ['Fiona', ...raws.map((_, i) => `Rae${i + 1}`)];
      for (let i = 0; i < names.length; i++) {
        const row = fac.room.row(names[i]!);
        const want = sc.lowest?.includes(i) ? 'lowest' : sc.highest?.includes(i) ? 'highest' : null;
        if (sc.lowest === undefined) {
          await expect(row).not.toHaveAttribute('data-extreme', /.+/);
        } else if (want) {
          await expect(row).toHaveAttribute('data-extreme', want);
          await expect(row).toContainText(want === 'lowest' ? /lowest/i : /highest/i);
        } else {
          await expect(row).not.toHaveAttribute('data-extreme', /.+/);
        }
      }
    });
  }

  test(
    'F01-AC15: every voter holding the lowest or highest card is marked; special-card voters never',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { room, fac } = await makeRoom(world, []);
      const names = ['A', 'B', 'C', 'D', 'E'];
      const cards = ['2', '2', '8', '?', '5'];
      const raws: RawClient[] = [];
      for (const n of names) raws.push(await world.raw(room, n));
      for (let i = 0; i < names.length; i++) await raws[i]!.vote(cards[i]!);
      await fac.room.expectCounter(5, 6);
      await fac.room.reveal.click();
      await expect(fac.room.summary).toBeVisible();
      await expect(fac.room.row('A')).toHaveAttribute('data-extreme', 'lowest');
      await expect(fac.room.row('B')).toHaveAttribute('data-extreme', 'lowest');
      await expect(fac.room.row('C')).toHaveAttribute('data-extreme', 'highest');
      await expect(fac.room.row('D')).not.toHaveAttribute('data-extreme', /.+/);
      await expect(fac.room.row('E')).not.toHaveAttribute('data-extreme', /.+/);
    },
  );

  test(
    'F01-AC15: three consecutive rounds do not bleed state',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { fac } = await makeRoom(world, []);
      await fac.room.vote('3');
      await fac.room.reveal.click();
      await expect(fac.page.getByTestId('summary-average')).toContainText('3.0');
      await fac.room.reset.click();
      await expect(fac.room.summary).toHaveCount(0);
      await fac.room.expectSelected('3', false);
      await fac.room.vote('8');
      await fac.room.reveal.click();
      await expect(fac.page.getByTestId('summary-average')).toContainText('8.0');
      await expect(fac.page.getByTestId('summary-distribution-3')).toHaveCount(0);
      await fac.room.reset.click();
      await fac.room.reveal.click();
      await expect(fac.page.getByTestId('summary-no-votes')).toBeVisible();
    },
  );
});

test.describe('auto-reveal (F01-AC16, F01-AC22)', () => {
  async function trio(world: Parameters<typeof makeRoom>[0], autoReveal = true) {
    const room = await world.createRoom({ settings: { autoReveal } });
    const fac = await world.rawFacilitator(room);
    const a = await world.raw(room, 'Ann');
    const b = await world.raw(room, 'Ben');
    await fac.waitForState((s) => s.participants.length === 3, 'all joined');
    return { room, fac, a, b };
  }

  test(
    'F01-AC16: reveals on the last vote only, a changed vote before it does not reveal',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { fac, a, b } = await trio(world);
      await fac.vote('3');
      await a.vote('5');
      await a.vote('8');
      expect(fac.state!.round.phase).toBe('voting');
      await b.vote('13');
      const s = await fac.waitForState(revealed, 'auto-revealed');
      expect(s.round.phase === 'revealed' ? s.round.votes : []).toHaveLength(3);
    },
  );

  test(
    'F01-AC16: a withdrawal does not reveal; auto-reveal off never reveals',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { fac, a, b } = await trio(world);
      await fac.vote('3');
      await a.vote('5');
      await b.vote('13');
      // already revealed by the last vote; use a fresh room for the withdrawal case
      const second = await trio(world);
      await second.fac.vote('3');
      await second.a.vote('5');
      await second.a.vote(null);
      await second.b.vote('2');
      expect(second.fac.state!.round.phase).toBe('voting');

      const off = await trio(world, false);
      await off.fac.vote('3');
      await off.a.vote('5');
      await off.b.vote('8');
      await off.fac.waitForState((s) => s.participants.every((p) => p.hasVoted), 'all voted');
      expect(off.fac.state!.round.phase).toBe('voting');
    },
  );

  test(
    'F01-AC16: a single voter alone reveals on their own vote',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const room = await world.createRoom({ settings: { autoReveal: true } });
      const fac = await world.rawFacilitator(room);
      await fac.vote('5');
      await fac.waitForState(revealed, 'auto-revealed');
    },
  );

  test(
    'F01-AC16: turning auto-reveal on when everyone has voted reveals',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { fac, a, b } = await trio(world, false);
      await fac.vote('3');
      await a.vote('5');
      await b.vote('8');
      await fac.waitForState((s) => s.participants.every((p) => p.hasVoted), 'all voted');
      expect((await fac.command('update_settings', { settings: { autoReveal: true } })).ok).toBe(
        true,
      );
      await fac.waitForState(revealed, 'revealed after enabling');
    },
  );

  test(
    'F01-AC16 / F01-AC22: an offline voter who has not voted does not block, and their leaving triggers the reveal',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { fac, a, b } = await trio(world);
      await fac.vote('3');
      await a.vote('5');
      expect(fac.state!.round.phase).toBe('voting');
      b.close();
      await fac.waitForState(revealed, 'revealed once Ben went offline');
    },
  );

  test(
    'F01-AC16 / F01-AC22: an offline voter who voted keeps their vote in the reveal',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { room, fac, a, b } = await trio(world);
      await fac.vote('3');
      await b.vote('8');
      b.close();
      await fac.waitForState(
        (s) => s.participants.some((p) => p.name === 'Ben' && !p.online),
        'Ben offline',
      );
      expect(fac.state!.round.phase).toBe('voting');
      await a.vote('5');
      const s = await fac.waitForState(revealed, 'revealed');
      const cards = s.round.phase === 'revealed' ? s.round.votes.map((v) => v.card).sort() : [];
      expect(cards).toEqual(['3', '5', '8']);
      // Ben returns after the reveal and cannot vote.
      const back = await world.rawConnect(room.roomId);
      await back.rejoin(b.token!);
      const r = await back.vote('2');
      expect(r.ok ? 'ok' : r.code).toBe('round_revealed');
    },
  );

  test(
    'F01-AC16: switching the last non-voter to observer or removing them reveals',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const one = await trio(world);
      await one.fac.vote('3');
      await one.a.vote('5');
      expect((await one.b.command('set_role', { role: 'observer' })).ok).toBe(true);
      await one.fac.waitForState(revealed, 'revealed after role switch');

      const two = await trio(world);
      await two.fac.vote('3');
      await two.a.vote('5');
      expect(
        (await two.fac.command('remove_participant', { participantId: two.b.state!.selfId })).ok,
      ).toBe(true);
      await two.fac.waitForState(revealed, 'revealed after removal');
    },
  );

  test(
    'F01-AC16: with only observers present nothing is auto-revealed',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const room = await world.createRoom({ settings: { autoReveal: true } });
      const fac = await world.rawFacilitator(room);
      expect((await fac.command('set_role', { role: 'observer' })).ok).toBe(true);
      const o = await world.raw(room, 'Olga', 'observer');
      await o.waitForState((s) => s.participants.length === 2, 'joined');
      expect(fac.state!.round.phase).toBe('voting');
    },
  );

  test(
    'F01-AC35 / F01-AC16: with facilitator votes off the facilitator is excluded from auto-reveal and the counter',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const room = await world.createRoom({
        settings: { autoReveal: true, facilitatorVotes: false },
      });
      const fac = await world.rawFacilitator(room);
      const a = await world.raw(room, 'Ann');
      const own = await fac.vote('5');
      expect(own.ok ? 'ok' : own.code).toBe('not_allowed');
      await a.vote('3');
      await fac.waitForState(revealed, 'revealed on Ann alone');
    },
  );

  test('F01-AC16: auto-reveal shows up in every browser', cross, async ({ world }) => {
    const { fac, others } = await makeRoom(world, [{ name: 'Vera' }], {
      settings: { autoReveal: true },
    });
    await fac.room.vote('3');
    await expect(fac.room.summary).toHaveCount(0);
    await others[0]!.room.vote('5');
    await expect(fac.room.summary).toBeVisible();
    await expect(others[0]!.room.summary).toBeVisible();
  });
});
