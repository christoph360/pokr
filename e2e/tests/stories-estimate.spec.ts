import { resolveDeck } from '@pokr/shared';
import type { RoomSettingsInput } from '@pokr/shared';
import { expect, test } from '../fixtures';
import { makeStoryRoom, sp } from '../fixtures/story-room';
import { rawStoryRoom } from '../fixtures/story-room';
import { framesLeaking } from '../helpers/leak';
import {
  estimate,
  expectOk,
  expectedQuickPicks,
  expectedSum,
  selectStory,
} from '../helpers/stories';

const cross = { tag: '@cross-browser' };
const chromiumOnly = { tag: '@chromium-only' };

interface PickCase {
  name: string;
  deck: RoomSettingsInput['deck'];
  votes: string[];
}

const FIB = { id: 'fibonacci' } as const;
const TSHIRT = { id: 'tshirt' } as const;

/** F02-AC10 table. The expected picks come from the independent oracle in helpers/stories.ts. */
const PICK_CASES: PickCase[] = [
  { name: 'consensus 5,5,5', deck: FIB, votes: ['5', '5', '5'] },
  { name: 'two different values 3,5 (median 4 rounds up to 5)', deck: FIB, votes: ['3', '5'] },
  { name: 'median 5.5 rounds up to 8', deck: FIB, votes: ['3', '8'] },
  { name: 'a single vote', deck: FIB, votes: ['5'] },
  { name: 'odd count 2,3,5', deck: FIB, votes: ['2', '3', '5'] },
  { name: 'median on a card, no consensus 1,13,13,21', deck: FIB, votes: ['1', '13', '13', '21'] },
  { name: 'zero and half 0,½', deck: FIB, votes: ['0', '½'] },
  { name: 'consensus on a half ½,½', deck: FIB, votes: ['½', '½'] },
  { name: 'only question marks', deck: FIB, votes: ['?', '?'] },
  { name: 'specials do not break consensus 5,5,?', deck: FIB, votes: ['5', '5', '?'] },
  { name: 'a coffee card is ignored 5,☕', deck: FIB, votes: ['5', '☕'] },
  { name: 'no votes at all', deck: FIB, votes: [] },
  { name: 'Modified Fibonacci 13,40', deck: { id: 'modified-fibonacci' }, votes: ['13', '40'] },
  { name: 'Powers of 2 4,8,16,16', deck: { id: 'powers-of-2' }, votes: ['4', '8', '16', '16'] },
  { name: 'T-shirt upper median S,M,L', deck: TSHIRT, votes: ['S', 'M', 'L'] },
  { name: 'T-shirt even count S,L takes the higher middle', deck: TSHIRT, votes: ['S', 'L'] },
  { name: 'T-shirt consensus XL,XL', deck: TSHIRT, votes: ['XL', 'XL'] },
  {
    name: 'custom numeric deck entered unsorted, picks by value',
    deck: { id: 'custom', cards: ['8', '1', '3'] },
    votes: ['1', '3'],
  },
  {
    name: 'custom mixed deck uses deck position',
    deck: { id: 'custom', cards: ['XS', 'S', '10', '20'] },
    votes: ['S', '10', '20'],
  },
];

test.describe('F02 quick picks (AC10)', () => {
  for (const c of PICK_CASES) {
    test(`F02-AC10: quick picks ${c.name}`, chromiumOnly, async ({ world }) => {
      const deckCards = resolveDeck(c.deck ?? FIB);
      const expected = expectedQuickPicks(deckCards, c.votes);
      // Raw voters cast the votes; the browser facilitator (not a voter) judges the picks.
      const sr = await rawStoryRoom(world, {
        settings: { deck: c.deck ?? FIB, facilitatorVotes: false },
        voters: c.votes.map((_, i) => `Voter ${i + 1}`),
        titles: ['Story'],
      });
      const fac = await world.join(sr.room, {
        name: 'Fiona',
        asFacilitator: true,
        clientConfig: { pingIntervalMs: 4000 },
      });
      await sp(fac).select('Story');
      await expect(sp(fac).activeTitle).toHaveText('Story');
      for (const [i, card] of c.votes.entries()) expectOk(await sr.voters[i]!.vote(card));
      await fac.room.reveal.click();
      await expect(fac.room.summary).toBeVisible();
      await sp(fac).openPicker();
      const s = sp(fac);
      const same = expected.consensus !== null && expected.consensus === expected.median;
      if (same) {
        // Shown once when both picks are the same card.
        const shown = (await s.quickConsensus.count()) + (await s.quickMedian.count());
        expect(shown).toBe(1);
        await expect(s.quickConsensus.or(s.quickMedian).first()).toContainText(expected.median!);
      } else {
        if (expected.consensus === null) await expect(s.quickConsensus).toHaveCount(0);
        else await expect(s.quickConsensus).toContainText(expected.consensus);
        if (expected.median === null) await expect(s.quickMedian).toHaveCount(0);
        else await expect(s.quickMedian).toContainText(expected.median);
      }
      // The full picker always lists exactly the value cards.
      for (const card of deckCards) {
        const isSpecial = card === '?' || card === '☕';
        await expect(s.acceptCard(card)).toHaveCount(isSpecial ? 0 : 1);
      }
    });
  }
});

test.describe('F02 accepting an estimate in the UI (AC10, AC11)', () => {
  test(
    'F02-AC10: the picker is for the facilitator only; a quick pick stores the estimate for everyone without advancing',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        { settings: { controlMode: 'everyone' }, titles: ['Story A', 'Story B'] },
      );
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      await sp(fac).select('Story A');
      await vera.room.vote('5');
      await fac.room.vote('8');
      // Before reveal there is nothing to accept.
      await expect(sp(fac).quickMedian).toHaveCount(0);
      await expect(sp(fac).acceptOpen).toHaveCount(0);
      await vera.room.reveal.click(); // a voter reveals in "everyone" mode
      await expect(fac.room.summary).toBeVisible();
      await expect(sp(vera).acceptOpen).toHaveCount(0);
      await expect(sp(olga).acceptOpen).toHaveCount(0);
      await expect(sp(vera).quickMedian).toHaveCount(0);
      await sp(fac).acceptQuick('median'); // median of 5 and 8 = 6.5 -> 8
      for (const p of [fac, vera, olga]) {
        await sp(p).expectRow('Story A', { status: 'estimated', estimate: '8' });
        await expect(sp(p).progress).toContainText(/1 of 2 estimated/);
        await expect(sp(p).activeTitle).toHaveText('Story A'); // accepting does not advance
      }
      // The revealed votes are untouched (frozen).
      await expect(vera.room.summary).toBeVisible();
      await expect(fac.room.row('Vera').getByTestId('participant-vote')).toHaveText('5');
    },
  );

  test(
    'F02-AC10: a revealed round without votes can be accepted with any value card; specials are not offered',
    cross,
    async ({ world }) => {
      const { fac } = await makeStoryRoom(world, [], { titles: ['Story A'] });
      await sp(fac).select('Story A');
      await fac.room.reveal.click();
      await expect(fac.room.summary).toBeVisible();
      await expect(sp(fac).quickConsensus).toHaveCount(0);
      await expect(sp(fac).quickMedian).toHaveCount(0);
      await sp(fac).openPicker();
      await expect(sp(fac).acceptCard('?')).toHaveCount(0);
      await expect(sp(fac).acceptCard('☕')).toHaveCount(0);
      await sp(fac).accept('½');
      await sp(fac).expectRow('Story A', { status: 'estimated', estimate: '½' });
    },
  );

  test(
    'F02-AC11: the estimate and the final round survive a reload and are visible to a late joiner',
    cross,
    async ({ world }) => {
      const { room, fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Story A'],
      });
      const vera = others[0]!;
      await sp(fac).select('Story A');
      await vera.room.vote('5');
      await fac.room.vote('8');
      await fac.room.reveal.click();
      await sp(fac).accept('8');
      await sp(vera).expectRow('Story A', { estimate: '8' });
      await vera.page.reload();
      await vera.room.expectInRoom();
      await sp(vera).openAgenda();
      await sp(vera).expectRow('Story A', { status: 'estimated', estimate: '8' });
      const late = await world.join(room, {
        name: 'Late',
        role: 'observer',
        clientConfig: { pingIntervalMs: 4000 },
      });
      await sp(late).openAgenda();
      await sp(late).expectRow('Story A', { status: 'estimated', estimate: '8' });
      // The "Last round" detail is open to everyone, observers included.
      for (const p of [late, vera, fac]) {
        await sp(p).doAction('Story A', 'history');
        await expect(sp(p).history).toBeVisible();
        await expect(sp(p).historyVotes).toHaveCount(2);
        await expect(sp(p).history).toContainText('Vera');
        await expect(sp(p).history).toContainText('Fiona');
        await expect(sp(p).history).toContainText('5');
        await expect(sp(p).history).toContainText('8');
        await p.page.keyboard.press('Escape');
        await expect(sp(p).history).toBeHidden();
      }
    },
  );

  test(
    'F02-AC11: a participant who was removed shows as "Removed participant" in the final round, the vote stays',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Wim' }],
        { titles: ['Story A'] },
      );
      const [vera, wim] = others as [(typeof others)[0], (typeof others)[0]];
      expectOk(await selectStory(raw, ids['Story A']!));
      await vera.room.vote('5');
      await wim.room.vote('13');
      await fac.room.reveal.click();
      await sp(fac).accept('13');
      const wimId = await wim.id();
      await fac.page.getByTestId(`remove-${wimId}`).click();
      await sp(fac).doAction('Story A', 'history');
      await expect(sp(fac).history).toContainText('Removed participant');
      await expect(sp(fac).history).not.toContainText('Wim');
      await expect(sp(fac).history).toContainText('13');
      await expect(sp(fac).history).toContainText('Vera');
      expect(vera.name).toBe('Vera');
    },
  );

  test(
    'F02-AC11 / F01-AC11: during a re-vote the old final round stays visible while the new hidden votes reach nobody',
    chromiumOnly,
    async ({ world }) => {
      const first = ['q7xz', 'k3vm'];
      const second = ['p5dt', 'w8ne'];
      const { fac, others } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        { settings: { deck: { id: 'custom', cards: [...first, ...second] } }, titles: ['Story A'] },
      );
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      await sp(fac).select('Story A');
      await vera.room.vote('q7xz');
      await fac.room.vote('k3vm');
      await fac.room.reveal.click();
      await sp(fac).accept('q7xz');
      await fac.room.reset.click(); // re-vote
      await sp(olga).expectRow('Story A', { status: 'estimated', estimate: 'q7xz', active: true });
      const mark = olga.rec.mark();
      const veraMark = vera.rec.mark();
      await vera.room.vote('p5dt');
      await fac.room.vote('w8ne');
      await sp(olga).doAction('Story A', 'history');
      await expect(sp(olga).history).toContainText('q7xz'); // the old, revealed round
      await expect(sp(olga).history).not.toContainText('p5dt');
      await expect(sp(olga).history).not.toContainText('w8ne');
      expect(framesLeaking(olga.rec, second, mark)).toEqual([]);
      // Vera may see her own p5dt, never Fiona's w8ne.
      expect(framesLeaking(vera.rec, ['w8ne'], veraMark)).toEqual([]);
    },
  );
});

test.describe('F02 sum in the UI (AC15)', () => {
  const cases: { name: string; settings: RoomSettingsInput; cards: string[]; numeric: boolean }[] =
    [
      { name: 'halves 0.5+0.5+0.5 = 1.5', settings: {}, cards: ['½', '½', '½'], numeric: true },
      { name: 'integers 5+8+13 = 26', settings: {}, cards: ['5', '8', '13'], numeric: true },
      {
        name: 'custom decimals 0.1+0.2 = 0.3',
        settings: { deck: { id: 'custom', cards: ['0.1', '0.2'] } },
        cards: ['0.1', '0.2'],
        numeric: true,
      },
      {
        name: 'T-shirt shows no sum',
        settings: { deck: TSHIRT },
        cards: ['M', 'L'],
        numeric: false,
      },
    ];
  for (const c of cases) {
    test(`F02-AC15: the agenda sum for ${c.name}`, cross, async ({ world }) => {
      const { fac, others, raw } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        settings: c.settings,
        titles: c.cards.map((_, i) => `S${i + 1}`),
      });
      const vera = others[0]!;
      for (const [i, card] of c.cards.entries()) {
        await estimate(raw, await sp(fac).idOf(`S${i + 1}`), card);
      }
      const expected = expectedSum(c.numeric, c.cards);
      for (const p of [fac, vera]) {
        if (expected.value === null) await expect(sp(p).sum).toHaveCount(0);
        else await expect(sp(p).sum).toContainText(expected.value);
      }
    });
  }

  test(
    'F02-AC15: after a deck change estimates that are not numbers are flagged instead of summed',
    chromiumOnly,
    async ({ world }) => {
      const { fac, raw } = await makeStoryRoom(world, [], {
        settings: { deck: TSHIRT },
        titles: ['A', 'B'],
      });
      await estimate(raw, await sp(fac).idOf('A'), 'M');
      await fac.room.openSettings();
      await fac.room.selectDeck('fibonacci');
      await expect(sp(fac).sumExcluded).toContainText('1');
      await estimate(raw, await sp(fac).idOf('B'), '5');
      await expect(sp(fac).sum).toContainText('5');
      await expect(sp(fac).sumExcluded).toContainText('1');
    },
  );
});
