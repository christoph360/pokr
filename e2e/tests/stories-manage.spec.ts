import { MAX_STORIES } from '@pokr/shared';
import { expect, test } from '../fixtures';
import { createRoomViaUi, makeRoom } from '../fixtures/scenarios';
import { makeStoryRoom, sp } from '../fixtures/story-room';
import { expectDisabled, expectInvalid } from '../helpers/story-page';
import { estimate, expectOk, rowsOf } from '../helpers/stories';

const cross = { tag: '@cross-browser' };
const crossDesktop = { tag: ['@cross-browser', '@desktop-only'] };
const chromiumOnly = { tag: '@chromium-only' };

test.describe('F02 mode switch in the UI (AC1)', () => {
  test(
    'F02-AC1: switching to Story list replaces the topic with the active story area and keeps the topic text for the way back',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeRoom(world, [{ name: 'Vera' }]);
      const vera = others[0]!;
      await fac.room.setTopic('Free topic text');
      await expect(vera.room.topicDisplay).toHaveText('Free topic text');
      await fac.room.openSettings();
      await sp(fac).sourceSelect.selectOption({ value: 'stories' });
      for (const p of [fac, vera]) {
        await expect(p.room.topicDisplay).toHaveCount(0);
        await expect(sp(p).noActive).toBeVisible();
      }
      // Idle: the voter cannot pick a card.
      await expect(vera.room.card('5')).toHaveAttribute('aria-disabled', 'true');
      await expect(sp(vera).cardsIdle).toBeVisible();
      await sp(fac).sourceSelect.selectOption({ value: 'topic' });
      for (const p of [fac, vera]) {
        await expect(sp(p).noActive).toHaveCount(0);
        await expect(p.room.topicDisplay).toHaveText('Free topic text');
      }
    },
  );

  test(
    'F02-AC1: switching with votes in the round asks for confirmation; Cancel changes nothing, Confirm clears the round',
    cross,
    async ({ world }) => {
      const { fac, others, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Story A'],
      });
      const vera = others[0]!;
      await sp(fac).select('Story A');
      await expect(sp(vera).activeTitle).toHaveText('Story A');
      await vera.room.vote('5');
      await fac.room.openSettings();
      await sp(fac).sourceSelect.selectOption({ value: 'topic' });
      await expect(sp(fac).modeConfirm).toBeVisible();
      await sp(fac).modeConfirmCancel.click();
      await expect(sp(fac).modeConfirm).toBeHidden();
      await expect(sp(vera).activeTitle).toHaveText('Story A');
      await vera.room.expectSelected('5');
      await expect(sp(fac).sourceSelect).toHaveValue('stories');
      // Confirm.
      await sp(fac).sourceSelect.selectOption({ value: 'topic' });
      await sp(fac).modeConfirmOk.click();
      await expect(
        vera.page.getByTestId('topic-empty').or(vera.room.topicDisplay).first(),
      ).toBeVisible();
      await expect(sp(vera).activeStory).toHaveCount(0);
      await vera.room.expectSelected('5', false);
      await fac.room.expectCounter(0, 2);
      expect(ids['Story A']).toBeTruthy();
    },
  );

  test(
    'F02-AC1: the start page offers the story source and creates the room in Story list mode',
    chromiumOnly,
    async ({ world }) => {
      const fac = await createRoomViaUi(world, { name: 'Fiona' });
      // ASSUMED test id: start-story-source (select with values topic / stories); not in the plan list.
      await fac.page.goto('/');
      await fac.page.getByTestId('start-name').fill('Fiona');
      await fac.page.getByTestId('start-story-source').selectOption({ value: 'stories' });
      await fac.page.getByTestId('start-create').click();
      await fac.page.waitForURL(/\/r\/[0-9a-z]{16}$/);
      await expect(sp(fac).noActive).toBeVisible();
      await expect(sp(fac).addOpen.or(sp(fac).addTitle).first()).toBeVisible();
    },
  );
});

test.describe('F02 add a story (AC2)', () => {
  test(
    'F02-AC2: the facilitator adds a story with title only and with description and link; everyone sees them appended',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        {
          titles: ['Existing'],
        },
      );
      await sp(fac).add({ title: 'Title only' });
      await sp(fac).add({
        title: 'With extras',
        description: 'Some **markdown**',
        link: 'https://tracker.example/issue/7',
      });
      for (const p of [fac, ...others]) {
        await sp(p).expectTitles(['Existing', 'Title only', 'With extras']);
        await sp(p).expectRow('Title only', { status: 'pending', estimate: null, active: false });
      }
      // Voters and observers have no add controls.
      for (const p of others) {
        await expect(sp(p).addOpen).toHaveCount(0);
        await expect(sp(p).bulkOpen).toHaveCount(0);
      }
      // The form is ready for the next story afterwards (title cleared).
      if (await sp(fac).addTitle.isVisible()) await expect(sp(fac).addTitle).toHaveValue('');
    },
  );

  test(
    'F02-AC2: invalid titles and links are blocked with an inline error and nothing is added',
    cross,
    async ({ world }) => {
      const { fac } = await makeStoryRoom(world, []);
      const s = sp(fac);
      await s.fillAdd({ title: '' });
      await s.addSubmit.click();
      await expectInvalid(s.addTitle);
      await s.fillAdd({ title: 'x'.repeat(201) });
      await s.addSubmit.click();
      await expectInvalid(s.addTitle);
      await s.fillAdd({ title: 'Valid title', link: 'javascript:alert(1)' });
      await s.addSubmit.click();
      await expectInvalid(s.addLink);
      await s.fillAdd({ title: 'Valid title', link: 'ftp://example.com/file' });
      await s.addSubmit.click();
      await expectInvalid(s.addLink);
      await expect(s.rows).toHaveCount(0);
      // Fixing the input makes it work (the dialog was not lost).
      await s.addLink.fill('https://example.com/ok');
      await s.addSubmit.click();
      await s.expectTitles(['Valid title']);
    },
  );

  test('F02-AC2: a title with HTML is shown as text everywhere', cross, async ({ world }) => {
    const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {});
    const payload = '<img src=x onerror=alert(1)> <b>bold?</b>';
    await sp(fac).add({ title: payload });
    for (const p of [fac, ...others]) {
      await sp(p).expectTitles([payload]);
      await expect(sp(p).agenda.locator('img, b')).toHaveCount(0);
    }
  });
});

test.describe('F02 bulk add (AC3)', () => {
  test(
    'F02-AC3: pasting lines previews the count, drops blank lines and adds the stories in order for everyone',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Existing'],
      });
      const s = sp(fac);
      await s.fillBulk('First line\n\n   \nSecond  line\r\n- Third line\n');
      await expect(s.bulkPreview).toContainText('3');
      await s.bulkSubmit.click();
      for (const p of [fac, ...others]) {
        await sp(p).expectTitles(['Existing', 'First line', 'Second line', '- Third line']);
      }
    },
  );

  test(
    'F02-AC3: an invalid line or too many lines rejects the whole paste, names the line and keeps the text',
    cross,
    async ({ world }) => {
      const { fac } = await makeStoryRoom(world, [], { titles: ['Existing'] });
      const s = sp(fac);
      const tooLong = 'y'.repeat(201);
      const text = `ok one\n${tooLong}\nok three`;
      await s.fillBulk(text);
      await s.bulkSubmit.click();
      await expect(s.bulkProblem).toBeVisible();
      await expect(s.bulkProblem).toContainText('2');
      await expect(s.bulkText).toHaveValue(text);
      await s.expectTitles(['Existing']);
      // More than 100 lines.
      const many = Array.from({ length: 101 }, (_, i) => `Line ${i + 1}`).join('\n');
      await s.bulkText.fill(many);
      await s.bulkSubmit.click();
      await expect(s.bulkProblem).toBeVisible();
      await expect(s.rows).toHaveCount(1);
      // Exactly 100 works.
      await s.bulkText.fill(many.split('\n').slice(0, 100).join('\n'));
      await s.bulkSubmit.click();
      await expect(s.rows).toHaveCount(101);
    },
  );

  test(
    'F02-AC3: a paste that would exceed 200 stories is rejected as a whole',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac, raw } = await makeStoryRoom(world, []);
      await world.api.seedStories(room.roomId, { count: 150 });
      await expect(sp(fac).rows).toHaveCount(150);
      const s = sp(fac);
      await s.fillBulk(Array.from({ length: 51 }, (_, i) => `Over ${i + 1}`).join('\n'));
      await s.bulkSubmit.click();
      await expect(s.bulkProblem).toBeVisible();
      await expect(s.rows).toHaveCount(150);
      await raw.command('resync');
      expect(rowsOf(raw)).toHaveLength(150);
    },
  );
});

test.describe('F02 edit, delete, reorder in the UI (AC4)', () => {
  test(
    'F02-AC4: editing the active story updates it live for everyone and keeps the votes',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Story A', 'Story B'],
      });
      const vera = others[0]!;
      await sp(fac).select('Story A');
      await vera.room.vote('8');
      await sp(fac).doAction('Story A', 'edit');
      await sp(fac).editTitle.fill('Story A (edited)');
      await sp(fac).editDescription.fill('New description');
      await sp(fac).editLink.fill('https://example.com/edited');
      await sp(fac).editSubmit.click();
      for (const p of [fac, vera]) {
        await expect(sp(p).activeTitle).toHaveText('Story A (edited)');
        await expect(sp(p).activeDescription).toContainText('New description');
        await expect(sp(p).activeLink).toHaveAttribute('href', 'https://example.com/edited');
        await sp(p).expectTitles(['Story A (edited)', 'Story B']);
      }
      await vera.room.expectSelected('8');
      await expect(fac.room.row('Vera')).toHaveAttribute('data-voted', 'true');
    },
  );

  test(
    'F02-AC4: an invalid edit keeps the old values and shows an inline error',
    cross,
    async ({ world }) => {
      const { fac } = await makeStoryRoom(world, [], { titles: ['Keep me'] });
      await sp(fac).doAction('Keep me', 'edit');
      await sp(fac).editTitle.fill('');
      await sp(fac).editSubmit.click();
      await expectInvalid(sp(fac).editTitle);
      await sp(fac).editTitle.fill('Fixed');
      await sp(fac).editSubmit.click();
      await sp(fac).expectTitles(['Fixed']);
    },
  );

  test(
    'F02-AC4: deleting a pending story needs no confirmation; deleting an estimated one asks first (Cancel keeps it)',
    cross,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Pending', 'Estimated'],
      });
      const s = sp(fac);
      await s.doAction('Pending', 'delete');
      await expect(s.deleteConfirm).toBeHidden();
      await s.expectTitles(['Estimated']);
      await estimate(raw, ids['Estimated']!, '5');
      await s.expectRow('Estimated', { status: 'estimated', estimate: '5' });
      await expect(s.sum).toContainText('5');
      await s.doAction('Estimated', 'delete');
      await expect(s.deleteConfirm).toBeVisible();
      await s.deleteConfirmCancel.click();
      await expect(s.deleteConfirm).toBeHidden();
      await s.expectTitles(['Estimated']);
      await s.doAction('Estimated', 'delete');
      await s.deleteConfirmOk.click();
      for (const p of [fac, ...others]) {
        await expect(sp(p).rows).toHaveCount(0);
        await expect(sp(p).sum).toHaveCount(0);
      }
    },
  );

  test(
    'F02-AC4: deleting the active story with votes asks first and leaves the room idle for everyone',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Active'],
      });
      const vera = others[0]!;
      await sp(fac).select('Active');
      await vera.room.vote('3');
      await sp(fac).doAction('Active', 'delete');
      await expect(sp(fac).roundConfirm).toBeVisible();
      await sp(fac).roundConfirmOk.click();
      for (const p of [fac, vera]) {
        await expect(sp(p).rows).toHaveCount(0);
        await expect(sp(p).noActive).toBeVisible();
      }
      await vera.room.expectSelected('3', false);
    },
  );

  test(
    'F02-AC4: dragging a story with the mouse reorders the agenda for everyone',
    crossDesktop,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['One', 'Two', 'Three'],
      });
      const s = sp(fac);
      const page = fac.page;
      // Everything on screen (no page auto-scroll while dragging); dragging starts at the grip.
      await page.setViewportSize({ width: 1280, height: 1600 });
      const handle = s.row('Three').getByText('⋮⋮');
      await handle.scrollIntoViewIfNeeded();
      const source = (await handle.boundingBox())!;
      const target = (await s.row('One').boundingBox())!;
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
      await page.mouse.down();
      await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2 - 6, {
        steps: 4,
      });
      await page.mouse.move(target.x + target.width / 2, target.y + 4, { steps: 12 });
      await page.mouse.up();
      for (const p of [fac, ...others]) await sp(p).expectTitles(['Three', 'One', 'Two']);
    },
  );

  test(
    'F02-AC4: move up / down / top / bottom buttons reorder, edges are disabled, focus stays and the result is announced',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['One', 'Two', 'Three', 'Four'],
      });
      const s = sp(fac);
      // Edges.
      await expectDisabled(await s.action('One', 'move-up'));
      await expectDisabled(await s.action('Four', 'move-down'));
      // Keyboard: focus the button of "Two", press Enter.
      const downTwo = await s.action('Two', 'move-down');
      await downTwo.focus();
      await fac.page.keyboard.press('Enter');
      await s.expectTitles(['One', 'Three', 'Two', 'Four']);
      for (const p of [fac, ...others]) await sp(p).expectTitles(['One', 'Three', 'Two', 'Four']);
      // Focus stays with the moved story's control and the position is announced.
      await expect(downTwo).toBeFocused();
      await expect(s.agendaAnnouncer).toContainText(/Two/);
      await expect(s.agendaAnnouncer).toContainText(/3/);
      await (await s.action('Two', 'move-up')).click();
      await s.expectTitles(['One', 'Two', 'Three', 'Four']);
      await (await s.action('Four', 'move-top')).click();
      await s.expectTitles(['Four', 'One', 'Two', 'Three']);
      await (await s.action('Four', 'move-bottom')).click();
      await s.expectTitles(['One', 'Two', 'Three', 'Four']);
    },
  );

  test(
    'F02-AC4: reordering keeps the active story and the round (votes stay)',
    cross,
    async ({ world }) => {
      const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['One', 'Two'],
      });
      const vera = others[0]!;
      await sp(fac).select('Two');
      await vera.room.vote('5');
      await (await sp(fac).action('Two', 'move-up')).click();
      await sp(fac).expectTitles(['Two', 'One']);
      await expect(sp(vera).activeTitle).toHaveText('Two');
      await vera.room.expectSelected('5');
      await sp(vera).expectRow('Two', { active: true });
    },
  );

  test(
    'F02-AC4: on a phone the move buttons are visible without hover and the agenda does not scroll sideways',
    cross,
    async ({ world }) => {
      const { fac } = await makeStoryRoom(world, [], { titles: ['One', 'Two', 'Three'] });
      const up = await sp(fac).action('Two', 'move-up');
      await expect(up).toBeVisible();
      await up.click();
      await sp(fac).expectTitles(['Two', 'One', 'Three']);
      const overflow = await fac.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    },
  );
});

test.describe('F02 story cap in the UI (AC5)', () => {
  test(
    'F02-AC5: at 200 stories the add controls stop with a notice; a delete frees a slot',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac } = await makeStoryRoom(world, []);
      await world.api.seedStories(room.roomId, { count: MAX_STORIES - 1 });
      const s = sp(fac);
      await expect(s.rows).toHaveCount(MAX_STORIES - 1);
      await s.add({ title: 'The 200th' });
      await expect(s.rows).toHaveCount(MAX_STORIES);
      await expect(s.limitNotice).toBeVisible();
      await expectDisabled(s.addOpen);
      await expectDisabled(s.bulkOpen);
      await s.doAction('The 200th', 'delete');
      await expect(s.rows).toHaveCount(MAX_STORIES - 1);
      await expect(s.limitNotice).toBeHidden();
      await s.add({ title: 'Fits again' });
      await expect(s.rows).toHaveCount(MAX_STORIES);
    },
  );
});

test(
  'F02-AC4 (helper sanity): the raw facilitator and the browser facilitator are one participant',
  chromiumOnly,
  async ({ world }) => {
    const { fac, raw } = await makeStoryRoom(world, [], { titles: ['A'] });
    await expect(fac.room.rows).toHaveCount(1);
    expectOk(await raw.command('add_story', { title: 'B' }));
    await sp(fac).expectTitles(['A', 'B']);
  },
);
