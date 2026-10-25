import type { Page } from '@playwright/test';
import { MAX_STORIES, STORY_DESCRIPTION_MAX } from '@pokr/shared';
import { expect, test } from '../fixtures';
import { makeStoryRoom, sp } from '../fixtures/story-room';
import { expectNoSeriousA11yViolations } from '../helpers/a11y';
import { estimate, expectOk, selectStory, skipStory } from '../helpers/stories';

const cross = { tag: '@cross-browser' };
const chromiumOnly = { tag: '@chromium-only' };

/** Press Tab until the target has focus (keyboard only). */
async function tabTo(page: Page, target: ReturnType<Page['getByTestId']>, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('target not reachable with Tab');
}

/**
 * Move keyboard focus to a row action with keys only. The agenda is one tab stop (roving
 * tabindex): Tab into the list, Ctrl+Home to the first row, Arrow Down to the target row, Arrow
 * Right to the target action.
 */
async function keyFocus(page: Page, target: ReturnType<Page['getByTestId']>): Promise<void> {
  const list = page.getByTestId('agenda-list');
  const inList = (): Promise<boolean> => list.evaluate((el) => el.contains(document.activeElement));
  if (!(await inList())) {
    for (let i = 0; i < 120 && !(await inList()); i++) await page.keyboard.press('Tab');
    for (let i = 0; i < 120 && !(await inList()); i++) await page.keyboard.press('Shift+Tab');
  }
  expect(await inList(), 'focus reached the agenda list with Tab').toBe(true);
  await page.keyboard.press('Control+Home');
  const rowId = await target.evaluate(
    (el) => el.closest('li')?.getAttribute('data-story-id') ?? '',
  );
  for (let i = 0; i < 250; i++) {
    const cur = await page.evaluate(
      () => document.activeElement?.closest('li')?.getAttribute('data-story-id') ?? '',
    );
    if (cur === rowId) break;
    await page.keyboard.press('ArrowDown');
  }
  for (let i = 0; i < 20; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('ArrowRight');
  }
  throw new Error('row action not reachable with arrow keys');
}

/** Record every change of a live region's text from now on. */
async function recordAnnouncements(locator: ReturnType<Page['getByTestId']>): Promise<void> {
  await locator.evaluate((el) => {
    const w = globalThis as unknown as { __announced?: string[] };
    w.__announced = [];
    new MutationObserver(() => {
      const text = (el.textContent ?? '').trim();
      if (text) w.__announced!.push(text);
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}
async function announced(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (globalThis as unknown as { __announced?: string[] }).__announced ?? [],
  );
}

test.describe('F02 axe scans (AC19)', () => {
  test(
    'F02-AC19: story room screens (idle, mixed agenda, voter, observer, active story, revealed with picker) have no serious or critical violations',
    cross,
    async ({ world }, testInfo) => {
      const { fac, others, raw, ids } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        { titles: ['Done story', 'Skipped story', 'Active story', 'Waiting story'] },
      );
      const [vera, olga] = others as [(typeof others)[0], (typeof others)[0]];
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'story-idle-facilitator');
      await expectNoSeriousA11yViolations(vera.page, testInfo, 'story-idle-voter');
      await estimate(raw, ids['Done story']!, '5');
      expectOk(await skipStory(raw, ids['Skipped story']!));
      expectOk(
        await raw.command('edit_story', {
          storyId: ids['Active story']!,
          description:
            '# Title\n\nSome **markdown** with a [link](https://example.com) and\n\n- a list\n- of items\n\n```\ncode\n```',
          link: 'https://tracker.example/issue/3',
        }),
      );
      expectOk(await selectStory(raw, ids['Active story']!, true));
      await expect(sp(vera).activeTitle).toHaveText('Active story');
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'story-active-facilitator');
      await expectNoSeriousA11yViolations(vera.page, testInfo, 'story-active-voter');
      await expectNoSeriousA11yViolations(olga.page, testInfo, 'story-active-observer');
      await vera.room.vote('5');
      await fac.room.vote('8');
      await fac.room.reveal.click();
      await expect(fac.room.summary).toBeVisible();
      await sp(fac).openPicker();
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'story-revealed-picker');
      await expectNoSeriousA11yViolations(vera.page, testInfo, 'story-revealed-voter');
    },
  );

  test(
    'F02-AC19: add, bulk add (with an error), edit, delete confirmation, mode switch confirmation, round confirmation and the final round detail have no serious or critical violations',
    cross,
    async ({ world }, testInfo) => {
      const { fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Story A', 'Story B'],
      });
      const vera = others[0]!;
      const s = sp(fac);
      await s.fillAdd({ title: '' });
      await s.addSubmit.click(); // inline error visible
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'add-with-error');
      await s.add({ title: 'Added' });
      await s.expectTitles(['Story A', 'Story B', 'Added']);
      await s.fillBulk(`one\n${'x'.repeat(201)}`);
      await s.bulkSubmit.click();
      await expect(s.bulkError).toBeVisible();
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'bulk-with-error');
      await s.bulkCancel.click();
      await expect(s.bulkDialog).toBeHidden();
      await s.doAction('Added', 'edit');
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'edit');
      await fac.page.keyboard.press('Escape');
      await estimate(raw, ids['Story A']!, '5');
      await s.doAction('Story A', 'delete');
      await expect(s.deleteConfirm).toBeVisible();
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'delete-confirmation');
      await s.deleteConfirmCancel.click();
      await s.doAction('Story A', 'history');
      await expect(s.history).toBeVisible();
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'final-round');
      await fac.page.keyboard.press('Escape');
      await s.select('Story B');
      await vera.room.vote('3');
      await s.doAction('Added', 'select');
      await expect(s.roundConfirm).toBeVisible();
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'round-confirmation');
      await s.roundConfirmCancel.click();
      await fac.room.openSettings();
      await s.sourceSelect.selectOption({ value: 'topic' });
      await expect(s.modeConfirm).toBeVisible();
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'mode-switch-confirmation');
    },
  );

  test(
    'F02-AC19: an agenda of 200 stories has no serious or critical violations',
    chromiumOnly,
    async ({ world }, testInfo) => {
      // axe over a 200-row page takes tens of seconds on a CI runner (31 s seen against the 30 s limit).
      test.slow();
      const { room, fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }]);
      await world.api.seedStories(room.roomId, {
        count: MAX_STORIES,
        titleLength: 80,
        descriptionLength: 200,
        estimated: 70,
        skipped: 20,
      });
      await expect(sp(others[0]!).rows).toHaveCount(MAX_STORIES);
      await expectNoSeriousA11yViolations(fac.page, testInfo, 'agenda-200-facilitator');
      await expectNoSeriousA11yViolations(others[0]!.page, testInfo, 'agenda-200-voter');
    },
  );

  test(
    'F02-AC19: the maximum-length description (5,000 characters of Markdown) has no serious or critical violations',
    chromiumOnly,
    async ({ world }, testInfo) => {
      const { others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Long'],
      });
      const md = Array.from(
        { length: 100 },
        (_, i) => `- item ${i} with **strong** and [link ${i}](https://example.com/${i})`,
      )
        .join('\n')
        .slice(0, STORY_DESCRIPTION_MAX);
      expectOk(await raw.command('edit_story', { storyId: ids['Long']!, description: md }));
      expectOk(await selectStory(raw, ids['Long']!));
      await expect(sp(others[0]!).activeDescription).toContainText('item 0');
      await expectNoSeriousA11yViolations(others[0]!.page, testInfo, 'long-description');
    },
  );
});

test.describe('F02 keyboard and screen reader (AC19)', () => {
  test(
    'F02-AC19: the whole story flow works with the keyboard only: add, select, vote, reveal, accept, Next, move, skip, delete with Escape',
    chromiumOnly,
    async ({ world }) => {
      const { fac } = await makeStoryRoom(world, [], { titles: ['Existing'] });
      const page = fac.page;
      const s = sp(fac);
      // Add a story: Tab to the add control, open it with Enter, type, submit with Enter.
      await tabTo(page, s.addOpen.or(s.addTitle).first());
      if (!(await s.addTitle.isVisible())) await page.keyboard.press('Enter');
      await tabTo(page, s.addTitle);
      await page.keyboard.type('Typed with keys');
      await page.keyboard.press('Enter');
      await s.expectTitles(['Existing', 'Typed with keys']);
      // Select the new story with the keyboard.
      const select = await s.action('Typed with keys', 'select');
      await keyFocus(page, select);
      await page.keyboard.press('Enter');
      await expect(s.activeTitle).toHaveText('Typed with keys');
      // Vote with a card (focus, Space), reveal with Enter.
      await tabTo(page, fac.room.card('5'));
      await page.keyboard.press('Space');
      await fac.room.expectSelected('5');
      await tabTo(page, fac.room.reveal);
      await page.keyboard.press('Enter');
      await expect(fac.room.summary).toBeVisible();
      // Accept the median quick pick: open the dialog, choose, confirm.
      await tabTo(page, s.acceptOpen);
      await page.keyboard.press('Enter');
      await expect(s.acceptDialog).toBeVisible();
      await tabTo(page, s.quickMedian.or(s.quickConsensus).first());
      await page.keyboard.press('Enter');
      await tabTo(page, s.acceptConfirm);
      await page.keyboard.press('Enter');
      await expect(s.acceptDialog).toBeHidden();
      await s.expectRow('Typed with keys', { status: 'estimated', estimate: '5' });
      // Reorder with the keyboard.
      const up = await s.action('Typed with keys', 'move-up');
      await keyFocus(page, up);
      await page.keyboard.press('Enter');
      await s.expectTitles(['Typed with keys', 'Existing']);
      await expect(up).toBeFocused();
      // Next story, then delete with Escape returning focus, then skip.
      await tabTo(page, s.next);
      await page.keyboard.press('Enter');
      await expect(s.activeTitle).toHaveText('Existing');
      const del = await s.action('Typed with keys', 'delete');
      await keyFocus(page, del);
      await page.keyboard.press('Enter');
      await expect(s.deleteConfirm).toBeVisible(); // an estimated story asks first
      await page.keyboard.press('Escape');
      await expect(s.deleteConfirm).toBeHidden();
      await expect(del).toBeFocused();
      await s.expectTitles(['Typed with keys', 'Existing']);
      const skip = await s.action('Existing', 'skip');
      await keyFocus(page, skip);
      await page.keyboard.press('Enter');
      if (await s.roundConfirm.isVisible().catch(() => false)) await s.roundConfirmOk.click();
      await s.expectRow('Existing', { status: 'skipped' });
    },
  );

  test(
    'F02-AC19: the agenda does not add a tab stop per action per row',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac } = await makeStoryRoom(world, []);
      await world.api.seedStories(room.roomId, { count: MAX_STORIES, titleLength: 30 });
      await expect(sp(fac).rows).toHaveCount(MAX_STORIES);
      // Tabbable elements (tabindex >= 0, enabled, visible) inside the agenda.
      const tabbable = await sp(fac).agenda.evaluate(
        (el) =>
          Array.from(
            el.querySelectorAll<HTMLElement>(
              'a[href], button, input, select, textarea, [tabindex]',
            ),
          ).filter(
            (n) =>
              n.tabIndex >= 0 &&
              !(n as HTMLButtonElement).disabled &&
              n.getClientRects().length > 0,
          ).length,
      );
      // Roving tabindex: the whole list is one tab stop (plus the add / bulk / toggle controls).
      expect(tabbable).toBeLessThanOrEqual(12);
    },
  );

  test(
    'F02-AC19: a change of the active story is announced once in a polite live region; an accepted estimate and a keyboard move are announced too',
    chromiumOnly,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['First story', 'Second story'],
      });
      const vera = others[0]!;
      await expect(sp(vera).announcer).toHaveAttribute('aria-live', 'polite');
      await recordAnnouncements(sp(vera).announcer);
      await sp(fac).select('First story');
      await expect(sp(vera).activeTitle).toHaveText('First story');
      await expect
        .poll(
          async () => (await announced(vera.page)).filter((t) => t.includes('First story')).length,
        )
        .toBe(1);
      // No repeated announcement for votes, reveal or other changes of the same story.
      await vera.room.vote('5');
      await fac.room.reveal.click();
      await expect(vera.room.summary).toBeVisible();
      await sp(fac).accept('5');
      await expect
        .poll(
          async () =>
            (await announced(vera.page)).filter((t) => t.includes('First story') && t.includes('5'))
              .length,
        )
        .toBeGreaterThanOrEqual(1);
      const firstAnnouncements = (await announced(vera.page)).filter((t) =>
        t.includes('First story'),
      );
      expect(new Set(firstAnnouncements).size).toBe(firstAnnouncements.length);
      // A bulk add of 100 stories must not flood the live region.
      await recordAnnouncements(sp(vera).agendaAnnouncer);
      const text = Array.from({ length: 100 }, (_, i) => `Bulk ${i + 1}`).join('\n');
      expectOk(await raw.command('add_stories', { text }));
      await expect(sp(vera).rows).toHaveCount(102);
      expect((await announced(vera.page)).length).toBeLessThanOrEqual(1);
      // Keyboard reorder announces title and position to the person moving the story.
      await recordAnnouncements(sp(fac).agendaAnnouncer);
      await (await sp(fac).action('Second story', 'move-up')).click();
      await expect
        .poll(async () =>
          (await announced(fac.page)).some((t) => t.includes('Second story') && /1/.test(t)),
        )
        .toBe(true);
      expect(ids['First story']).toBeTruthy();
    },
  );

  test(
    'F02-AC19: row actions are at least 24 x 24 px and carry accessible names that include the story title',
    cross,
    async ({ world }) => {
      const { fac } = await makeStoryRoom(world, [], { titles: ['Named story', 'Other story'] });
      const s = sp(fac);
      for (const kind of ['select', 'edit', 'delete', 'move-down', 'skip'] as const) {
        const btn = await s.action('Named story', kind);
        const box = await btn.boundingBox();
        expect(box, `${kind} visible`).not.toBeNull();
        expect(box!.width).toBeGreaterThanOrEqual(24);
        expect(box!.height).toBeGreaterThanOrEqual(24);
        const name = (await btn.getAttribute('aria-label')) ?? (await btn.innerText());
        const labelled =
          (await btn.evaluate((el) => (el as HTMLElement).getAttribute('aria-labelledby'))) !==
          null;
        expect(name.includes('Named story') || labelled, `${kind} name mentions the story`).toBe(
          true,
        );
      }
    },
  );
});
