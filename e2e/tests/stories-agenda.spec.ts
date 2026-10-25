import {
  MAX_STORIES,
  SNAPSHOT_MAX_BYTES,
  STORY_DESCRIPTION_MAX,
  STORY_LINK_MAX,
} from '@pokr/shared';
import { expect, test } from '../fixtures';
import { makeStoryRoom, sp } from '../fixtures/story-room';
import { framesLeaking } from '../helpers/leak';
import { estimate, expectOk, rowsOf, selectStory, skipStory } from '../helpers/stories';

const cross = { tag: '@cross-browser' };
const chromiumOnly = { tag: '@chromium-only' };

test.describe('F02 agenda view (AC14)', () => {
  test(
    'F02-AC14: everyone sees the same agenda with a text status, the estimates and the progress, live',
    cross,
    async ({ world }) => {
      const { fac, others, raw, ids } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Olga', role: 'observer' }],
        { titles: ['Done', 'Skipped', 'Active', 'Waiting'] },
      );
      await estimate(raw, ids['Done']!, '5');
      expectOk(await skipStory(raw, ids['Skipped']!));
      expectOk(await selectStory(raw, ids['Active']!, true));
      for (const p of [fac, ...others]) {
        const s = sp(p);
        await s.expectTitles(['Done', 'Skipped', 'Active', 'Waiting']);
        await s.expectRow('Done', { status: 'estimated', estimate: '5', active: false });
        await s.expectRow('Skipped', { status: 'skipped', estimate: null, active: false });
        await s.expectRow('Active', { status: 'pending', active: true });
        await s.expectRow('Waiting', { status: 'pending', active: false });
        // Status is text, not only colour.
        await expect(s.row('Done')).toContainText(/estimated/i);
        await expect(s.row('Skipped')).toContainText(/skipped/i);
        await expect(s.row('Active')).toContainText(/active/i);
        await expect(s.row('Waiting')).toContainText(/pending/i);
        await expect(s.row('Active')).toHaveAttribute('aria-current', /true|step|location/);
        await expect(s.progress).toContainText('1 of 3 estimated, 1 skipped');
      }
      // Live progress.
      await estimate(raw, ids['Active']!, '8');
      for (const p of [fac, ...others]) {
        await expect(sp(p).progress).toContainText('2 of 3 estimated, 1 skipped');
      }
    },
  );

  test('F02-AC14: an empty agenda says so instead of showing zeros', cross, async ({ world }) => {
    const { fac, others } = await makeStoryRoom(world, [{ name: 'Vera' }]);
    for (const p of [fac, ...others]) {
      await expect(sp(p).progress).toContainText(/No stories yet/i);
      await expect(sp(p).progress).not.toContainText(/NaN|undefined/);
    }
  });

  test(
    'F02-AC14: a re-voted story shows both active and its estimate',
    cross,
    async ({ world }) => {
      const { fac, raw, ids } = await makeStoryRoom(world, [], { titles: ['A'] });
      await estimate(raw, ids['A']!, '13');
      expectOk(await raw.command('reset'));
      await sp(fac).expectRow('A', { status: 'estimated', estimate: '13', active: true });
      await expect(sp(fac).row('A')).toContainText(/active/i);
    },
  );

  test(
    'F02-AC14: 200 stories render, stay usable, and the active story is scrolled into view',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac, others, raw } = await makeStoryRoom(world, [{ name: 'Vera' }]);
      await world.api.seedStories(room.roomId, {
        count: MAX_STORIES,
        titleLength: 60,
        estimated: 50,
      });
      await raw.command('resync');
      const vera = others[0]!;
      await expect(sp(vera).rows).toHaveCount(MAX_STORIES);
      const target = rowsOf(raw)[150]!;
      expectOk(await selectStory(raw, target.id, true));
      await expect(sp(vera).activeTitle).toHaveText(target.title);
      await expect(sp(vera).rowById(target.id)).toBeInViewport();
      await expect(sp(fac).progress).toContainText('50 of 200 estimated');
    },
  );

  test(
    'F02-AC14: at 320 px wide a long unbroken title and many rows do not overflow the page',
    cross,
    async ({ world }) => {
      const { fac } = await makeStoryRoom(world, [], {
        titles: ['W'.repeat(120), 'https://example.com/' + 'a'.repeat(100), 'Short'],
      });
      await fac.page.setViewportSize({ width: 320, height: 640 });
      await sp(fac).expectTitles([
        'W'.repeat(120),
        'https://example.com/' + 'a'.repeat(100),
        'Short',
      ]);
      const overflow = await fac.page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    },
  );
});

test.describe('F02 size and loading in the browser (AC16)', () => {
  test(
    'F02-AC16: a participant joining a room with 200 maximum-length stories is in the room with a snapshot under 1 MiB',
    chromiumOnly,
    async ({ world }) => {
      const { room, raw } = await makeStoryRoom(world, []);
      await world.api.seedStories(room.roomId, {
        count: MAX_STORIES,
        titleLength: 200,
        descriptionLength: STORY_DESCRIPTION_MAX,
        linkLength: STORY_LINK_MAX,
        estimated: 100,
        finalRoundVotes: 50,
      });
      await raw.command('resync');
      expectOk(await selectStory(raw, rowsOf(raw)[150]!.id, true));
      const started = Date.now();
      const late = await world.join(room, { name: 'Late', clientConfig: { pingIntervalMs: 4000 } });
      await sp(late).openAgenda();
      await expect(sp(late).rows).toHaveCount(MAX_STORIES);
      // Indicative on a local machine: interactive within a few seconds.
      expect(Date.now() - started).toBeLessThan(15_000);
      const join = late.rec.received.find((f) => f.msg?.type === 'state')!;
      expect(Buffer.byteLength(join.text, 'utf8')).toBeLessThan(SNAPSHOT_MAX_BYTES);
      // A vote after joining does not resend the agenda.
      const mark = late.rec.mark();
      await late.room.vote('5');
      await expect(late.room.ownRow).toHaveAttribute('data-voted', 'true');
      expect(late.rec.since(mark).every((f) => !f.text.includes('"rows"'))).toBe(true);
    },
  );
});

test.describe('F02 persistence in the browser (AC17)', () => {
  test(
    'F02-AC17: after the room memory is dropped the agenda, the active story and the votes are intact and everything keeps working',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac, others, raw, ids } = await makeStoryRoom(world, [{ name: 'Vera' }], {
        titles: ['Done', 'Active', 'Later'],
      });
      const vera = others[0]!;
      await estimate(raw, ids['Done']!, '5');
      await sp(fac).select('Active');
      await vera.room.vote('8');
      const before = await world.api.instanceId(room.roomId);
      await world.api.evict(room.roomId, 'drop_memory');
      expect(await world.api.instanceId(room.roomId)).not.toBe(before);
      await vera.room.vote('3');
      await vera.room.expectSelected('3');
      for (const p of [fac, vera]) {
        await sp(p).expectTitles(['Done', 'Active', 'Later']);
        await sp(p).expectRow('Done', { status: 'estimated', estimate: '5' });
        await expect(sp(p).activeTitle).toHaveText('Active');
      }
      await fac.room.reveal.click();
      await sp(fac).accept('3');
      await sp(vera).expectRow('Active', { status: 'estimated', estimate: '3' });
    },
  );

  test(
    'F02-AC17: a voter who was offline sees the agenda changes made meanwhile after reconnecting',
    chromiumOnly,
    async ({ world }) => {
      const { room, fac, raw } = await makeStoryRoom(world, []);
      const vera = await world.join(room, { name: 'Vera', net: true });
      await sp(vera).openAgenda();
      expectOk(await raw.command('add_stories', { text: 'One\nTwo' }));
      await sp(vera).expectTitles(['One', 'Two']);
      await vera.net!.goOffline();
      await expect(vera.room.connection).toHaveAttribute('data-state', 'reconnecting');
      expectOk(await raw.command('add_story', { title: 'Three (while offline)' }));
      await sp(fac).expectTitles(['One', 'Two', 'Three (while offline)']);
      await raw.command('resync');
      expectOk(await selectStory(raw, rowsOf(raw)[1]!.id));
      await vera.net!.goOnline();
      await expect(vera.room.connection).toHaveAttribute('data-state', 'connected');
      await sp(vera).expectTitles(['One', 'Two', 'Three (while offline)']);
      await expect(sp(vera).activeTitle).toHaveText('Two');
    },
  );
});

test.describe('F02 hidden votes in the browser (F01-AC11 in story mode)', () => {
  test(
    'F02-AC16 / F01-AC11: browser frames of other participants never contain a vote value before reveal, including join, reload and story changes',
    chromiumOnly,
    async ({ world }) => {
      const tokens = ['q7xz', 'k3vm', 'p5dt'];
      const { room, fac, others, raw, ids } = await makeStoryRoom(
        world,
        [{ name: 'Vera' }, { name: 'Wim' }, { name: 'Olga', role: 'observer' }],
        { settings: { deck: { id: 'custom', cards: tokens } }, titles: ['A', 'B'] },
      );
      const [vera, wim, olga] = others as [
        (typeof others)[0],
        (typeof others)[0],
        (typeof others)[0],
      ];
      await sp(fac).select('A');
      await vera.room.vote('q7xz');
      await wim.room.vote('k3vm');
      await fac.room.vote('p5dt');
      await vera.room.vote('k3vm'); // change
      await vera.room.click('k3vm'); // withdraw
      expectOk(
        await raw.command('edit_story', { storyId: ids['A']!, description: 'edit during voting' }),
      );
      await olga.page.reload();
      await olga.room.expectInRoom();
      const late = await world.join(room, {
        name: 'Late',
        role: 'observer',
        clientConfig: { pingIntervalMs: 4000 },
      });
      await sp(late).openAgenda();
      await expect(sp(late).activeTitle).toHaveText('A');
      expect(framesLeaking(olga.rec, tokens)).toEqual([]);
      expect(framesLeaking(late.rec, tokens)).toEqual([]);
      // Each voter sees only their own card: Wim's k3vm may appear for Wim, never q7xz / p5dt.
      expect(framesLeaking(wim.rec, ['q7xz', 'p5dt'])).toEqual([]);
      expect(framesLeaking(vera.rec, ['p5dt'])).toEqual([]);
      // After the reveal the tokens are in the revealed payload.
      await fac.room.reveal.click();
      await expect(olga.room.summary).toBeVisible();
      expect(framesLeaking(olga.rec, tokens).length).toBeGreaterThan(0);
    },
  );
});
