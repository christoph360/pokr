import type { Page } from '@playwright/test';
import { expect, fillJoinForm, test } from '../fixtures';
import { createRoomViaUi, makeRoom } from '../fixtures/scenarios';
import { expectNoSeriousA11yViolations } from '../helpers/a11y';
import { RoomPage } from '../helpers/room-page';
import { MAX_PARTICIPANTS } from '@pokr/shared';

const cross = { tag: '@cross-browser' };

/** Press Tab until the target has focus (keyboard only). */
async function tabTo(page: Page, target: ReturnType<Page['getByTestId']>, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target not reachable with Tab');
}

async function hasVisibleFocus(loc: ReturnType<Page['getByTestId']>): Promise<boolean> {
  return loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return (
      el.matches(':focus-visible') &&
      ((cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none')
    );
  });
}

test.describe('axe scans (F01-AC33)', () => {
  test(
    'F01-AC33: start page has no serious or critical violations',
    cross,
    async ({ world }, testInfo) => {
      const ctx = await world.newContext();
      const page = await ctx.newPage();
      await page.goto('/');
      await expect(page.getByTestId('start-name')).toBeVisible();
      await expectNoSeriousA11yViolations(page, testInfo, 'start');
    },
  );

  test(
    'F01-AC33: join prompt, room (voting, voted, revealed), observer view',
    cross,
    async ({ world }, testInfo) => {
      const room = await world.createRoom({ settings: { deck: { id: 'fibonacci' } } });
      const joiner = await world.join(room, { name: 'Vera', noJoinForm: true });
      await expect(joiner.page.getByTestId('join-name')).toBeVisible();
      await expectNoSeriousA11yViolations(joiner.page, testInfo, 'join-prompt');
      await fillJoinForm(joiner.page, 'Vera', 'voter');
      await joiner.room.expectInRoom();
      const fac = await world.join(room, { name: 'Fiona', asFacilitator: true });
      const olga = await world.join(room, { name: 'Olga', role: 'observer' });
      await expectNoSeriousA11yViolations(joiner.page, testInfo, 'room-voting');
      await joiner.room.vote('5');
      await fac.room.vote('8');
      await expectNoSeriousA11yViolations(joiner.page, testInfo, 'room-voted');
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'room-facilitator');
      await expectNoSeriousA11yViolations(olga.page, testInfo, 'room-observer');
      await fac.room.topicInput.fill('Topic for axe');
      await fac.room.topicSave.click();
      await fac.room.reveal.click();
      await expect(fac.room.summary).toBeVisible();
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'room-revealed');
      await expectNoSeriousA11yViolations(olga.page, testInfo, 'room-revealed-observer');
    },
  );

  test('F01-AC33: settings dialog and deck confirmation', cross, async ({ world }, testInfo) => {
    const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
    await others[0]!.room.vote('3');
    await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
    await fac.room.openSettings();
    await expectNoSeriousA11yViolations(fac.page, testInfo, 'settings');
    await fac.room.selectDeck('tshirt');
    await expect(fac.page.getByTestId('deck-confirm')).toBeVisible();
    await expectNoSeriousA11yViolations(fac.page, testInfo, 'deck-confirm');
  });

  test(
    'F01-AC33: removed notice, room not found, room full, reconnecting state',
    { tag: '@chromium-only' },
    async ({ world }, testInfo) => {
      const { room, fac, others } = await makeRoom(world, [
        { name: 'Vera', net: true },
        { name: 'Walt' },
      ]);
      const walt = others[1]!;
      await others[0]!.net!.goOffline();
      await expect(others[0]!.room.connection).toBeVisible();
      await expectNoSeriousA11yViolations(others[0]!.page, testInfo, 'reconnecting');
      await fac.page.getByTestId(`remove-${await walt.id()}`).click();
      await expect(walt.page.getByTestId('removed-notice')).toBeVisible();
      await expectNoSeriousA11yViolations(walt.page, testInfo, 'removed');

      const ctx = await world.newContext();
      const page = await ctx.newPage();
      await page.goto('/r/0123456789abcdef');
      await expect(page.getByTestId('room-not-found')).toBeVisible();
      await expectNoSeriousA11yViolations(page, testInfo, 'room-not-found');
      void room;
    },
  );

  test('F01-AC33: room full screen', { tag: '@chromium-only' }, async ({ world }, testInfo) => {
    test.setTimeout(90_000);
    const room = await world.createRoom();
    for (let i = 1; i < MAX_PARTICIPANTS; i++) await world.raw(room, `P${i}`);
    const ctx = await world.newContext();
    const page = await ctx.newPage();
    await page.goto(room.url);
    await expect(page.getByTestId('room-full')).toBeVisible();
    await expectNoSeriousA11yViolations(page, testInfo, 'room-full');
  });

  test(
    'F01-AC33: mobile layout has no serious violations and no horizontal scroll at 320 and 390 px',
    { tag: '@chromium-only' },
    async ({ world }, testInfo) => {
      const { room, fac, others } = await makeRoom(world, [{ name: 'W'.repeat(30) }]);
      void fac;
      const m = others[0]!;
      for (const width of [320, 390]) {
        await m.page.setViewportSize({ width, height: 800 });
        await m.room.vote('5');
        const overflow = await m.page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
        await expectNoSeriousA11yViolations(m.page, testInfo, `mobile-${width}`);
        await m.room.click('5'); // withdraw for the next loop
        await m.room.expectSelected('5', false);
      }
      void room;
    },
  );
});

test.describe('keyboard (F01-AC33)', () => {
  test(
    'F01-AC33: create, join, vote, withdraw, reveal and reset using only the keyboard',
    { tag: '@chromium-only' },
    async ({ world }) => {
      // Create with the keyboard.
      const ctx = await world.newContext();
      const page = await ctx.newPage();
      await page.goto('/');
      await page.getByTestId('start-name').focus();
      await page.keyboard.type('Fiona');
      await tabTo(page, page.getByTestId('start-create'));
      expect(await hasVisibleFocus(page.getByTestId('start-create'))).toBe(true);
      await page.keyboard.press('Enter');
      await page.waitForURL(/\/r\/[0-9a-z]{16}$/);
      const fac = new RoomPage(page);
      await fac.expectInRoom();

      // Copy the link with the keyboard.
      await tabTo(page, page.getByTestId('copy-link'));
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('copy-feedback')).toBeVisible();

      // Second participant joins with the keyboard.
      const room = { url: new URL(page.url()).pathname } as { url: string };
      const joinerCtx = await world.newContext();
      const jp = await joinerCtx.newPage();
      await jp.goto(room.url);
      await jp.getByTestId('join-name').focus();
      await jp.keyboard.type('Vera');
      await tabTo(jp, jp.getByTestId('join-submit'));
      await jp.keyboard.press('Enter');
      const vera = new RoomPage(jp);
      await vera.expectInRoom();

      // Vote with Space, withdraw with Space, vote again, using Tab to reach the card.
      await tabTo(jp, vera.card('5'));
      expect(await hasVisibleFocus(vera.card('5'))).toBe(true);
      await jp.keyboard.press('Space');
      await vera.expectSelected('5');
      await expect(fac.row('Vera')).toHaveAttribute('data-voted', 'true');
      await jp.keyboard.press('Space');
      await vera.expectSelected('5', false);
      await jp.keyboard.press('Space');
      await vera.expectSelected('5');

      // Reveal and reset by keyboard on the facilitator page.
      await tabTo(page, fac.reveal);
      expect(await hasVisibleFocus(fac.reveal)).toBe(true);
      await page.keyboard.press('Enter');
      await expect(fac.summary).toBeVisible();
      await tabTo(page, fac.reset);
      await page.keyboard.press('Enter');
      await expect(fac.summary).toHaveCount(0);

      // Settings dialog: open, trap focus, close with Escape and return focus.
      await tabTo(page, fac.settingsOpen);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('setting-deck')).toBeVisible();
      for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"], dialog'),
      );
      expect(inside, 'focus stays inside the open dialog').toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('setting-deck')).toHaveCount(0);
      await expect(fac.settingsOpen).toBeFocused();

      // Switch role to observer by keyboard.
      await tabTo(jp, vera.roleSwitch);
      await jp.keyboard.press('Enter');
      await expect(jp.locator('[data-testid^="card-"]')).toHaveCount(0);
    },
  );

  test('F01-AC33: arrow keys move between cards in the group', cross, async ({ world }) => {
    const { others } = await makeRoom(world, [{ name: 'Vera' }]);
    const vera = others[0]!;
    const radios = vera.room.cardGrid.getByRole('radio');
    if ((await radios.count()) === 0)
      test.info().annotations.push({
        type: 'note',
        description: 'cards are not a radiogroup; arrow keys not applicable',
      });
    else {
      await radios.first().focus();
      await vera.page.keyboard.press('ArrowRight');
      await expect(radios.nth(1)).toBeFocused();
    }
  });
});

test.describe('non-visual and motion cues (F01-AC33)', () => {
  test(
    'F01-AC33: voted, offline and lowest/highest have text or accessible-name cues, not colour only',
    { tag: '@chromium-only' },
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }, { name: 'Walt' }]);
      await others[0]!.room.vote('2');
      await others[1]!.room.vote('8');
      const cue = (row: ReturnType<typeof fac.room.row>, re: RegExp) =>
        row
          .getByText(re)
          .or(row.getByLabel(re))
          .or(row.getByRole('img', { name: re }))
          .first();
      await expect(cue(fac.room.row('Vera'), /voted/i)).toBeAttached();
      await others[1]!.page.close();
      await expect(fac.room.row('Walt')).toHaveAttribute('data-online', 'false');
      await expect(cue(fac.room.row('Walt'), /offline/i)).toBeAttached();
      await fac.room.reveal.click();
      await expect(cue(fac.room.row('Vera'), /lowest/i)).toBeVisible();
      await expect(cue(fac.room.row('Walt'), /highest/i)).toBeVisible();
    },
  );

  test(
    'F01-AC33: the reveal animation respects prefers-reduced-motion',
    { tag: '@chromium-only' },
    async ({ world }) => {
      for (const [motion, animated] of [
        ['reduce', 'false'],
        ['no-preference', 'true'],
      ] as const) {
        const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
        await fac.page.emulateMedia({ reducedMotion: motion });
        await others[0]!.room.vote('5');
        await fac.room.reveal.click();
        await expect(fac.room.summary).toBeVisible();
        const flagged = fac.page.locator('[data-animated]');
        await expect(flagged.first(), `data-animated present (${motion})`).toBeAttached();
        for (const el of await flagged.all())
          await expect(el).toHaveAttribute('data-animated', animated);
        await expect(fac.room.row('Vera').getByTestId('participant-vote')).toHaveText('5');
      }
    },
  );

  test('F01-AC33: interactive targets are at least 24x24 px', cross, async ({ world }) => {
    const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
    for (const loc of [
      others[0]!.room.card('5'),
      others[0]!.room.card('½'),
      fac.room.reveal,
      fac.room.reset,
      fac.room.settingsOpen,
    ]) {
      const box = await loc.boundingBox();
      expect(box, 'visible').not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(24);
      expect(box!.height).toBeGreaterThanOrEqual(24);
    }
  });

  test(
    'F01-AC33: on a phone the participant list is a collapsible panel and the cards sit below the topic',
    cross,
    async ({ world }, testInfo) => {
      test.skip(!testInfo.project.use.isMobile, 'mobile layout only');
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await vera.page.reload();
      await vera.room.expectInRoom({ expandList: false });
      await expect(vera.page.getByTestId('participants-toggle')).toBeVisible();
      await expect(vera.room.participantList).toBeHidden();
      await vera.page.getByTestId('participants-toggle').click();
      await expect(vera.room.participantList).toBeVisible();
      await fac.room.setTopic('Layout topic');
      await expect(vera.room.topicDisplay).toHaveText('Layout topic');
      await vera.room.vote('5');
      const topic = await vera.room.topicDisplay.boundingBox();
      const grid = await vera.room.cardGrid.boundingBox();
      expect(grid!.y).toBeGreaterThanOrEqual(topic!.y);
    },
  );

  test('F01-AC1: creating a room works on the mobile viewport', cross, async ({ world }) => {
    const fac = await createRoomViaUi(world, { name: 'Fiona' });
    await expect(fac.room.root).toBeVisible();
  });
});
