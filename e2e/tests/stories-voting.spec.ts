import { expect, test } from '../fixtures';
import { makeStoryRoom, sp } from '../fixtures/story-room';
import { estimate, expectOk, selectStory } from '../helpers/stories';

const cross = { tag: '@cross-browser' };
const chromiumOnly = { tag: '@chromium-only' };

test.describe('F02 who sees which controls (AC6)', () => {
  test(
    'F02-AC6: voters and observers see no story management controls in either control mode; in "everyone" mode voters get reveal and reset only',
    cross,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        { settings: { controlMode: 'everyone' }, titles: ['A', 'B'] },
      );
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      expectOk(await selectStory(raw, ids['A']!));
      await expect(sp(vera).activeTitle).toHaveText('A');
      const forbidden = async (p: typeof vera): Promise<void> => {
        const s = sp(p);
        for (const loc of [s.addOpen, s.bulkOpen, s.next, s.acceptOpen])
          await expect(loc).toHaveCount(0);
        for (const kind of ['select', 'edit', 'delete', 'move-up', 'move-down', 'skip'] as const) {
          await expect(p.page.getByTestId(new RegExp(`^story-${kind}-`))).toHaveCount(0);
        }
        await expect(p.room.settingsOpen).toHaveCount(0);
      };
      await forbidden(vera);
      await forbidden(olga);
      await expect(vera.room.reveal).toBeVisible();
      await expect(vera.room.reset).toBeVisible();
      await expect(olga.room.reveal).toHaveCount(0);
      await expect(olga.room.reset).toHaveCount(0);
      // A voter reveals; accepting stays with the facilitator.
      await vera.room.vote('5');
      await vera.room.reveal.click();
      for (const p of [fac, vera, olga]) await expect(p.room.summary).toBeVisible();
      await expect(sp(vera).acceptOpen).toHaveCount(0);
      await expect(sp(vera).quickMedian).toHaveCount(0);
      await expect(sp(fac).acceptOpen.or(sp(fac).quickMedian).first()).toBeVisible();
      // Live switch to "facilitator only": the voter's reveal/reset disappear without reload.
      await fac.room.openSettings();
      await fac.room.setControlMode('facilitator');
      await expect(vera.room.reveal).toHaveCount(0);
      await expect(vera.room.reset).toHaveCount(0);
    },
  );

  test('F02-AC6: the facilitator has all story controls on every row', cross, async ({ world }) => {
    const { fac } = await makeStoryRoom(world, [], { titles: ['A', 'B'] });
    const s = sp(fac);
    await expect(s.addOpen.or(s.addTitle).first()).toBeVisible();
    for (const kind of ['select', 'edit', 'delete', 'skip'] as const) {
      await expect(await s.action('A', kind)).toBeVisible();
    }
  });

  test(
    'F02-AC6: after a hand-over the new facilitator gets the story controls and the old one loses them',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], { titles: ['A'] });
      const vera = others[0]!;
      await expect(sp(vera).addOpen).toHaveCount(0);
      const veraId = await vera.id();
      await fac.page.getByTestId(`handover-${veraId}`).click();
      await expect(sp(vera).addOpen.or(sp(vera).addTitle).first()).toBeVisible();
      await expect(sp(fac).addOpen).toHaveCount(0);
      await expect(sp(fac).addTitle).toHaveCount(0);
      await sp(vera).add({ title: 'Added by the new facilitator' });
      await sp(fac).expectTitles(['A', 'Added by the new facilitator']);
    },
  );
});

test.describe('F02 selecting a story (AC7, AC8 basics)', () => {
  test(
    'F02-AC7: selecting a story makes it active for everyone and starts a fresh round',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        { titles: ['Story A', 'Story B'] },
      );
      const vera = others[0]!;
      // Idle first: nobody can vote.
      for (const p of [fac, ...others]) await expect(sp(p).noActive).toBeVisible();
      await expect(vera.room.card('5')).toHaveAttribute('aria-disabled', 'true');
      await sp(fac).select('Story A');
      for (const p of [fac, ...others]) {
        await expect(sp(p).activeTitle).toHaveText('Story A');
        await expect(sp(p).noActive).toHaveCount(0);
        await sp(p).expectRow('Story A', { active: true });
        await sp(p).expectRow('Story B', { active: false });
      }
      await expect(vera.room.card('5')).not.toHaveAttribute('aria-disabled', 'true');
      await vera.room.vote('5');
      await fac.room.vote('8');
      await fac.room.expectCounter(2, 2);
      // Select B with votes in the round: confirm first; Cancel keeps everything.
      await sp(fac).doAction('Story B', 'select');
      await expect(sp(fac).roundConfirm).toBeVisible();
      await sp(fac).roundConfirmCancel.click();
      await expect(sp(vera).activeTitle).toHaveText('Story A');
      await vera.room.expectSelected('5');
      await sp(fac).doAction('Story B', 'select');
      await sp(fac).roundConfirmOk.click();
      for (const p of [fac, ...others]) {
        await expect(sp(p).activeTitle).toHaveText('Story B');
        await sp(p).expectRow('Story B', { active: true });
        await sp(p).expectRow('Story A', { active: false });
      }
      await vera.room.expectSelected('5', false);
      await fac.room.expectCounter(0, 2);
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'false');
    },
  );

  test(
    'F02-AC7: a late joiner sees the active story, the agenda and an empty round',
    cross,
    async ({ world }) => {
      const { room, fac, raw, ids } = await makeStoryRoom(world, [], {
        titles: ['Story A', 'Story B'],
      });
      expectOk(await selectStory(raw, ids['Story A']!));
      await expect(sp(fac).activeTitle).toHaveText('Story A');
      const late = await world.join(room, { name: 'Late' });
      await sp(late).openAgenda();
      await expect(sp(late).activeTitle).toHaveText('Story A');
      await sp(late).expectTitles(['Story A', 'Story B']);
      await late.room.vote('3');
      await expect(fac.room.row('Late')).toHaveAttribute('data-voted', 'true');
    },
  );

  test(
    'F02-AC8: the active story shows title, description and link above the cards for everyone and follows edits',
    cross,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        { titles: ['Story A'] },
      );
      expectOk(
        await raw.command('edit_story', {
          storyId: ids['Story A']!,
          description: 'Plain description',
          link: 'https://tracker.example/issue/1',
        }),
      );
      expectOk(await selectStory(raw, ids['Story A']!));
      for (const p of [fac, ...others]) {
        const s = sp(p);
        await expect(s.activeTitle).toHaveText('Story A');
        await expect(s.activeDescription).toContainText('Plain description');
        await expect(s.activeLink).toHaveAttribute('href', 'https://tracker.example/issue/1');
        // Above the cards.
        const story = await s.activeStory.boundingBox();
        const cards = await p.room.cardGrid.boundingBox().catch(() => null);
        if (story && cards) expect(story.y).toBeLessThan(cards.y);
      }
      expectOk(
        await raw.command('edit_story', { storyId: ids['Story A']!, description: 'Changed' }),
      );
      for (const p of [fac, ...others])
        await expect(sp(p).activeDescription).toContainText('Changed');
    },
  );

  test(
    'F02-X-F01-1: with auto-reveal on, the round reveals when the last online voter has voted, not when a story is selected',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        settings: { autoReveal: true },
        titles: ['A'],
      });
      const vera = others[0]!;
      expectOk(await selectStory(raw, ids['A']!));
      await expect(sp(fac).activeTitle).toHaveText('A');
      await expect(fac.room.summary).toHaveCount(0);
      await vera.room.vote('5');
      await expect(fac.room.summary).toHaveCount(0);
      await fac.room.vote('8');
      for (const p of [fac, vera]) await expect(p.room.summary).toBeVisible();
      // The estimate is not accepted automatically.
      await sp(fac).expectRow('A', { status: 'pending', estimate: null });
    },
  );

  test(
    'F02-X-F01-2: with "facilitator votes" off the facilitator sees no cards but still selects, reveals and accepts',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        settings: { facilitatorVotes: false },
        titles: ['A'],
      });
      const vera = others[0]!;
      await sp(fac).select('A');
      await expect(fac.room.cardGrid).toHaveCount(0);
      await vera.room.vote('5');
      await fac.room.expectCounter(1, 1);
      await fac.room.reveal.click();
      await expect(sp(fac).quickMedian.or(sp(fac).quickConsensus).first()).toBeVisible();
      await sp(fac).acceptQuick('median');
      await sp(vera).expectRow('A', { status: 'estimated', estimate: '5' });
    },
  );
});

test.describe('F02 Next story (AC9)', () => {
  test(
    'F02-AC9: Next activates the next pending story for everyone, skips skipped ones, and is disabled with a message when nothing is left',
    cross,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['A', 'B', 'C'],
      });
      const vera = others[0]!;
      await sp(fac).doAction('B', 'skip');
      await sp(fac).expectRow('B', { status: 'skipped' });
      await sp(fac).next.click(); // no active story: first pending
      await expect(sp(vera).activeTitle).toHaveText('A');
      await estimate(raw, ids['A']!, '5');
      await sp(fac).expectRow('A', { status: 'estimated', estimate: '5' });
      await sp(fac).next.click();
      await expect(sp(vera).activeTitle).toHaveText('C');
      await estimate(raw, ids['C']!, '8');
      await expect(sp(fac).next).toBeDisabled();
      await expect(fac.page.getByText(/All stories are estimated or skipped/i)).toBeVisible();
      // Voters never get a Next button, also in "everyone" mode (covered by AC6).
      await expect(sp(vera).next).toHaveCount(0);
    },
  );

  test(
    'F02-AC9: Next with an unsaved round asks for confirmation; the story left behind stays pending',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['A', 'B'],
      });
      const vera = others[0]!;
      await sp(fac).select('A');
      await vera.room.vote('5');
      await sp(fac).next.click();
      await expect(sp(fac).roundConfirm).toBeVisible();
      await sp(fac).roundConfirmCancel.click();
      await expect(sp(vera).activeTitle).toHaveText('A');
      await sp(fac).next.click();
      await sp(fac).roundConfirmOk.click();
      await expect(sp(vera).activeTitle).toHaveText('B');
      await sp(vera).expectRow('A', { status: 'pending', active: false });
      await vera.room.expectSelected('5', false);
    },
  );

  test('F02-AC9: Next is disabled for an empty agenda', cross, async ({ world }) => {
    const { fac } = await makeStoryRoom(world, []);
    await expect(sp(fac).next).toBeDisabled();
  });
});

test.describe('F02 re-vote, skip and restore in the UI (AC12, AC13)', () => {
  test(
    'F02-AC12: selecting an estimated story re-votes it: it is active, keeps its old estimate in the agenda and the sum until a new one is accepted',
    cross,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['A', 'B'],
      });
      const vera = others[0]!;
      await estimate(raw, ids['A']!, '5');
      await sp(fac).select('B');
      await sp(fac).select('A');
      for (const p of [fac, vera]) {
        await expect(sp(p).activeTitle).toHaveText('A');
        await sp(p).expectRow('A', { status: 'estimated', estimate: '5', active: true });
        await expect(sp(p).sum).toContainText('5');
        await expect(sp(p).progress).toContainText(/1 of 2/);
      }
      await vera.room.vote('13');
      await fac.room.reveal.click();
      await sp(fac).accept('8');
      for (const p of [fac, vera]) {
        await sp(p).expectRow('A', { status: 'estimated', estimate: '8' });
        await expect(sp(p).sum).toContainText('8');
      }
    },
  );

  test(
    'F02-AC13: skip marks a story skipped (with a text status), restore brings it back, a skipped story can still be voted',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['A', 'B'],
      });
      const vera = others[0]!;
      await sp(fac).doAction('A', 'skip');
      for (const p of [fac, vera]) {
        await sp(p).expectRow('A', { status: 'skipped', estimate: null });
        await expect(sp(p).row('A')).toContainText(/skipped/i);
        await expect(sp(p).progress).toContainText(/0 of 1 estimated, 1 skipped/);
      }
      await sp(fac).doAction('A', 'restore');
      await sp(fac).expectRow('A', { status: 'pending' });
      await sp(fac).doAction('A', 'skip');
      await sp(fac).select('A');
      await expect(sp(vera).activeTitle).toHaveText('A');
      await sp(vera).expectRow('A', { status: 'skipped', active: true });
      await vera.room.vote('3');
      await fac.room.reveal.click();
      await sp(fac).accept('3');
      await sp(vera).expectRow('A', { status: 'estimated', estimate: '3' });
    },
  );

  test(
    'F02-AC13: skipping the active story with votes asks for confirmation and leaves the room idle',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], { titles: ['A'] });
      const vera = others[0]!;
      await sp(fac).select('A');
      await vera.room.vote('5');
      await sp(fac).doAction('A', 'skip');
      await expect(sp(fac).roundConfirm).toBeVisible();
      await sp(fac).roundConfirmOk.click();
      for (const p of [fac, vera]) await expect(sp(p).noActive).toBeVisible();
      await sp(vera).expectRow('A', { status: 'skipped' });
    },
  );
});

test.describe('F02 facilitator availability (X-F01-8)', () => {
  test(
    'F02-X-F01-8: with the facilitator offline in "everyone" mode the voters can still reveal and reset, but not move on',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Wim' }],
        { settings: { controlMode: 'everyone' }, titles: ['A', 'B'] },
      );
      const [vera, wim] = others as [(typeof others)[0], (typeof others)[0]];
      expectOk(await selectStory(raw, ids['A']!));
      await expect(sp(vera).activeTitle).toHaveText('A');
      raw.close();
      await fac.page.close();
      await vera.room.vote('5');
      await wim.room.vote('8');
      await vera.room.reveal.click();
      await expect(wim.room.summary).toBeVisible();
      await vera.room.reset.click();
      await expect(wim.room.summary).toBeHidden();
      await expect(sp(vera).next).toHaveCount(0);
    },
  );
});
