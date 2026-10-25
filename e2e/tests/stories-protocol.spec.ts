import {
  MAX_STORIES,
  SNAPSHOT_MAX_BYTES,
  STORY_DESCRIPTION_MAX,
  STORY_LINK_MAX,
} from '@pokr/shared';
import { expect, test } from '../fixtures';
import { rawStoryRoom } from '../fixtures/story-room';
import { RawClient } from '../helpers/raw-client';
import { uniqueKey } from '../helpers/env';
import {
  acceptEstimate,
  activeOf,
  estimate,
  addStories,
  addStory,
  expectError,
  expectOk,
  expectedProgress,
  expectedSum,
  frameBytes,
  getStory,
  nextStory,
  playRound,
  reveal,
  rawFramesLeaking,
  roundOf,
  rowByTitle,
  rowsOf,
  selectStory,
  setSource,
  skipStory,
  titlesOf,
} from '../helpers/stories';

// Raw protocol clients: browser independent, run on the chromium project only.
const apiOnly = { tag: '@chromium-only' };

test.describe('F02 mode (AC1)', () => {
  test(
    'F02-AC1: select, Next, accept and skip are rejected in Free topic mode with wrong_story_source; management still works',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world, { settings: { storySource: 'topic' } });
      // Agenda preparation works before switching: add, bulk add, edit, move, delete.
      const a = await addStory(fac, 'Prepared A');
      const [b, c] = await addStories(fac, ['Prepared B', 'Prepared C']);
      expectOk(await fac.command('edit_story', { storyId: a, title: 'Prepared A2' }), 'edit');
      expectOk(await fac.command('move_story', { storyId: c, beforeId: a }), 'move');
      expect(titlesOf(fac)).toEqual(['Prepared C', 'Prepared A2', 'Prepared B']);
      expectOk(await fac.command('delete_story', { storyId: b!, confirmReset: false }), 'delete');
      expect(titlesOf(fac)).toEqual(['Prepared C', 'Prepared A2']);
      // Story rounds need Story list mode.
      expectError(await selectStory(fac, a), 'wrong_story_source');
      expectError(await nextStory(fac), 'wrong_story_source');
      expectError(await acceptEstimate(fac, a, '5'), 'wrong_story_source');
      expectError(await skipStory(fac, a), 'wrong_story_source');
      expect(activeOf(fac)).toBeNull();
      expect(rowByTitle(fac, 'Prepared A2').status).toBe('pending');
    },
  );

  test(
    'F02-AC1: in Story list mode set_topic and reset with a topic are rejected with wrong_story_source',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A'] });
      expectOk(await selectStory(fac, ids['A']!), 'select');
      expectError(await fac.command('set_topic', { topic: 'nope' }), 'wrong_story_source');
      expectError(await fac.command('reset', { topic: 'nope' }), 'wrong_story_source');
      // A plain reset restarts the round of the same story.
      const before = roundOf(fac);
      expectOk(await fac.command('reset'), 'reset');
      expect(roundOf(fac)).toBe(before + 1);
      expect(activeOf(fac)).toBe(ids['A']);
    },
  );

  test(
    'F02-AC1: switching keeps stories and estimates, clears the active story, starts a new round and keeps the topic text',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, {
        settings: { storySource: 'topic' },
        titles: ['A', 'B'],
      });
      expectOk(await fac.command('set_topic', { topic: 'Free topic text' }), 'topic');
      expectOk(await setSource(fac, 'stories'), 'to stories');
      expect(activeOf(fac)).toBeNull();
      await estimate(fac, ids['A']!, '5');
      const roundBefore = roundOf(fac);
      // The accepted round is saved: leaving it needs no confirmation.
      expectOk(await setSource(fac, 'topic'), 'to topic');
      expect(fac.state!.settings.storySource).toBe('topic');
      expect(activeOf(fac)).toBeNull();
      expect(roundOf(fac)).toBeGreaterThan(roundBefore);
      expect(fac.state!.round.phase).toBe('voting');
      expect(fac.state!.topic).toBe('Free topic text');
      expect(titlesOf(fac)).toEqual(['A', 'B']);
      expect(rowByTitle(fac, 'A')).toMatchObject({ status: 'estimated', estimate: '5' });
      // And back: idle, stories and estimate intact.
      expectOk(await setSource(fac, 'stories'), 'back to stories');
      expect(activeOf(fac)).toBeNull();
      expect(rowByTitle(fac, 'A')).toMatchObject({ status: 'estimated', estimate: '5' });
      expect(fac.state!.stories.progress).toEqual({ estimated: 1, outOf: 2, skipped: 0 });
    },
  );

  test(
    'F02-AC1: switching source with an unsaved round needs confirmReset; selecting the same source is not a change',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, { voters: ['Vera'], titles: ['A'] });
      const vera = voters[0]!;
      expectOk(await selectStory(fac, ids['A']!), 'select');
      expectOk(await vera.vote('5'), 'vote');
      // Voting round with a vote: unsaved.
      expectError(await setSource(fac, 'topic'), 'confirmation_required', 'confirmReset');
      expect(fac.state!.settings.storySource).toBe('stories');
      expect(activeOf(fac)).toBe(ids['A']);
      // Revealed but not accepted: still unsaved.
      await reveal(fac);
      expectError(await setSource(fac, 'topic'), 'confirmation_required', 'confirmReset');
      // Same source: no change, no confirmation, no new round.
      const round = roundOf(fac);
      expectOk(await setSource(fac, 'stories'), 'same source');
      expect(roundOf(fac)).toBe(round);
      // With the acknowledgement the switch happens and the votes are gone.
      expectOk(await setSource(fac, 'topic', true), 'confirmed switch');
      await vera.waitForState((s) => s.settings.storySource === 'topic', 'vera sees topic mode');
      expect(vera.state!.round.phase).toBe('voting');
      expect(vera.state!.myVote).toBeNull();
      expect(fac.state!.participants.every((p) => !p.hasVoted)).toBe(true);
    },
  );

  test(
    'F02-AC1: Issue tracker is rejected until F05; only the facilitator changes the source',
    apiOnly,
    async ({ world }) => {
      for (const controlMode of ['facilitator', 'everyone'] as const) {
        const { fac, voters, observers } = await rawStoryRoom(world, {
          settings: { controlMode },
          voters: ['Vera'],
          observers: ['Olga'],
        });
        const res = await fac.command('update_settings', { settings: { storySource: 'tracker' } });
        expectError(res, 'invalid_input');
        expect(fac.state!.settings.storySource).toBe('stories');
        expectError(await setSource(voters[0]!, 'topic'), 'not_allowed');
        expectError(await setSource(observers[0]!, 'topic'), 'not_allowed');
      }
    },
  );

  test(
    'F02-AC1: a new room can be created with the story source set',
    apiOnly,
    async ({ world }) => {
      const room = await world.createRoom({ settings: { storySource: 'stories' } });
      const fac = await world.rawFacilitator(room);
      expect(fac.state!.settings.storySource).toBe('stories');
      expect(fac.state!.stories.activeId).toBeNull();
      const plain = await world.createRoom();
      const fac2 = await world.rawFacilitator(plain);
      expect(fac2.state!.settings.storySource).toBe('topic');
    },
  );
});

test.describe('F02 add story (AC2)', () => {
  test(
    'F02-AC2: a new story is appended with status pending, no estimate, no tracker reference and rev 1',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world, { titles: ['First'] });
      const id = await addStory(fac, 'Second', {
        description: '# Heading\n\nBody',
        link: 'https://tracker.example/issue/2',
      });
      expect(titlesOf(fac)).toEqual(['First', 'Second']);
      expect(rowByTitle(fac, 'Second')).toEqual({
        id,
        title: 'Second',
        link: 'https://tracker.example/issue/2',
        hasDescription: true,
        status: 'pending',
        estimate: null,
        rev: 1,
        tracker: null,
      });
      expect(rowByTitle(fac, 'First').hasDescription).toBe(false);
      expect(rowByTitle(fac, 'First').link).toBeNull();
    },
  );

  const titleCases: { name: string; title: string; ok: boolean; stored?: string }[] = [
    { name: 'empty', title: '', ok: false },
    { name: 'whitespace only', title: '   \t ', ok: false },
    { name: '1 character', title: 'x', ok: true, stored: 'x' },
    { name: '200 characters', title: 'a'.repeat(200), ok: true, stored: 'a'.repeat(200) },
    { name: '201 characters', title: 'a'.repeat(201), ok: false },
    {
      name: '200 emoji (graphemes, 800 bytes)',
      title: '😀'.repeat(200),
      ok: true,
      stored: '😀'.repeat(200),
    },
    { name: '201 emoji', title: '😀'.repeat(201), ok: false },
    { name: '200 ZWJ family emoji exceed the 1,000 byte cap', title: '👨‍👩‍👧'.repeat(200), ok: false },
    { name: 'newline', title: 'two\nlines', ok: false },
    { name: 'control character', title: 'bell\u0007', ok: false },
    { name: 'NUL', title: 'nul\u0000', ok: false },
    { name: 'trim and collapse', title: '  a   b    c  ', ok: true, stored: 'a b c' },
    // A tab is a control character (F01 text normalization), not whitespace to collapse.
    { name: 'tab', title: 'a\tb', ok: false },
    {
      name: 'HTML stays text',
      title: '<img src=x onerror=alert(1)>',
      ok: true,
      stored: '<img src=x onerror=alert(1)>',
    },
  ];
  for (const c of titleCases) {
    test(`F02-AC2: title ${c.name}`, apiOnly, async ({ world }) => {
      const { fac } = await rawStoryRoom(world);
      const res = await fac.command('add_story', { title: c.title });
      if (c.ok) {
        expectOk(res);
        expect(titlesOf(fac)).toEqual([c.stored]);
      } else {
        expectError(res, 'invalid_input');
        expect(rowsOf(fac)).toHaveLength(0);
      }
    });
  }

  test('F02-AC2: duplicate titles are allowed and get distinct ids', apiOnly, async ({ world }) => {
    const { fac } = await rawStoryRoom(world);
    const a = await addStory(fac, 'Same');
    const b = await addStory(fac, 'Same');
    expect(a).not.toBe(b);
    expect(titlesOf(fac)).toEqual(['Same', 'Same']);
  });

  test(
    'F02-AC2: description limits (5,000 graphemes, 20,000 bytes), newlines kept, CRLF becomes LF',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world);
      expectOk(
        await fac.command('add_story', {
          title: 'ok5000',
          description: 'd'.repeat(STORY_DESCRIPTION_MAX),
        }),
      );
      expectError(
        await fac.command('add_story', {
          title: 'too long',
          description: 'd'.repeat(STORY_DESCRIPTION_MAX + 1),
        }),
        'invalid_input',
      );
      // Few graphemes but more than 20,000 bytes (1,200 x 18 bytes).
      expectError(
        await fac.command('add_story', { title: 'bytes', description: '👨‍👩‍👧'.repeat(1_200) }),
        'invalid_input',
      );
      // 5,000 emoji = 5,000 graphemes and exactly 20,000 bytes: allowed.
      expectOk(
        await fac.command('add_story', { title: 'emoji5000', description: '😀'.repeat(5_000) }),
      );
      expectError(
        await fac.command('add_story', { title: 'control', description: 'bell\u0007' }),
        'invalid_input',
      );
      const id = await addStory(fac, 'multi', { description: 'line 1\r\nline 2\r\n\ttabbed\n\n' });
      const detail = await getStory(fac, id);
      expect(detail.description).toBe('line 1\nline 2\n\ttabbed');
      // Empty description means none.
      const none = await addStory(fac, 'none', { description: '' });
      expect(rowByTitle(fac, 'none').hasDescription).toBe(false);
      expect((await getStory(fac, none)).description).toBe('');
    },
  );

  const goodLinks = [
    'https://tracker.example/issue/42',
    'http://tracker.example',
    'HTTPS://EXAMPLE.COM/Path?q=1#frag',
    'http://localhost:3000/x',
    `https://example.com/${'a'.repeat(STORY_LINK_MAX - 'https://example.com/'.length)}`,
  ];
  for (const link of goodLinks) {
    test(
      `F02-AC2: link accepted: ${link.slice(0, 40)} (${link.length} chars)`,
      apiOnly,
      async ({ world }) => {
        const { fac } = await rawStoryRoom(world);
        const id = await addStory(fac, 'linked', { link: ` ${link} ` });
        expect(rowByTitle(fac, 'linked').link).toBe(link);
        expect((await getStory(fac, id)).link).toBe(link);
      },
    );
  }

  const badLinks = [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://example.com/file',
    'mailto:a@example.com',
    '//example.com/x',
    'example.com',
    'http://',
    'https://exa mple.com',
    'https://user:pass@example.com/',
    'https://example.com/"quoted"',
    'https://example.com/back\\slash',
    `https://example.com/${'a'.repeat(STORY_LINK_MAX)}`,
  ];
  for (const link of badLinks) {
    test(`F02-AC2: link rejected: ${link.slice(0, 40)}`, apiOnly, async ({ world }) => {
      const { fac } = await rawStoryRoom(world);
      expectError(await fac.command('add_story', { title: 'bad link', link }), 'invalid_input');
      expect(rowsOf(fac)).toHaveLength(0);
    });
  }

  test(
    'F02-AC2: malformed story payloads are rejected without side effects',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world);
      for (const fields of [
        {},
        { title: 5 },
        { title: ['a'] },
        { title: 'ok', description: 5 },
        { title: 'ok', link: 5 },
        { title: 'ok', link: ['https://a.example'] },
      ]) {
        expectError(await fac.command('add_story', fields), 'invalid_input');
      }
      expect(rowsOf(fac)).toHaveLength(0);
      expect(fac.closed).toBeNull();
    },
  );
});

test.describe('F02 bulk add (AC3)', () => {
  test(
    'F02-AC3: lines become stories in order; blank lines dropped; CRLF, LF and CR; list markers kept; titles normalized',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world, { titles: ['Existing'] });
      const text = [
        '- bullet item',
        '',
        '   ',
        '1.  numbered   item',
        '[ ] todo',
        '  spaced   out  ',
      ].join('\r\n');
      const res = await fac.command('add_stories', { text: `${text}\r\n\rlast\n` });
      expectOk(res);
      expect(res.storyIds).toHaveLength(5);
      expect(titlesOf(fac)).toEqual([
        'Existing',
        '- bullet item',
        '1. numbered item',
        '[ ] todo',
        'spaced out',
        'last',
      ]);
      expect(rowsOf(fac).every((r) => r.status === 'pending')).toBe(true);
      // A single line is a single story.
      expectOk(await fac.command('add_stories', { text: 'solo' }));
      expect(titlesOf(fac).at(-1)).toBe('solo');
    },
  );

  test(
    'F02-AC3: 100 lines are accepted, 101 are rejected as a whole',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world);
      const lines = (n: number): string =>
        Array.from({ length: n }, (_, i) => `Story ${i + 1}`).join('\n');
      expectError(await fac.command('add_stories', { text: lines(101) }), 'invalid_input', 'text');
      expect(rowsOf(fac)).toHaveLength(0);
      // Blank lines do not count towards the 100.
      const padded = lines(100)
        .split('\n')
        .flatMap((l) => [l, ''])
        .join('\n');
      expectOk(await fac.command('add_stories', { text: padded }));
      expect(rowsOf(fac)).toHaveLength(100);
    },
  );

  test(
    'F02-AC3: an invalid line rejects the whole paste, names its 1-based line number and echoes no content',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world, { titles: ['Existing'] });
      const secret = 'SECRET-LINE-CONTENT';
      const tooLong = `${secret}${'x'.repeat(201)}`;
      // Physical line numbers count blank lines: the long line is line 4.
      const res = await fac.command('add_stories', {
        text: `ok one\n\nok two\n${tooLong}\nok three`,
      });
      expectError(res, 'invalid_input', 'text.4');
      const withControl = await fac.command('add_stories', { text: 'fine\nbell\u0007 here' });
      expectError(withControl, 'invalid_input', 'text.2');
      expect(titlesOf(fac)).toEqual(['Existing']);
      for (const e of fac.errors()) expect(e.message ?? '').not.toContain(secret);
    },
  );

  test('F02-AC3: text without a single non-blank line is rejected', apiOnly, async ({ world }) => {
    const { fac } = await rawStoryRoom(world);
    for (const text of ['', '\n\n', '   \r\n\t\n']) {
      expectError(await fac.command('add_stories', { text }), 'invalid_input', 'text');
    }
    expect(rowsOf(fac)).toHaveLength(0);
  });

  test(
    'F02-AC3: exceeding 200 stories rejects the whole paste; exactly 200 is allowed',
    apiOnly,
    async ({ world }) => {
      const { room, fac } = await rawStoryRoom(world);
      await world.api.seedStories(room.roomId, { count: 150 });
      await fac.command('resync');
      expect(rowsOf(fac)).toHaveLength(150);
      const lines = (n: number): string =>
        Array.from({ length: n }, (_, i) => `Bulk ${i + 1}`).join('\n');
      expectError(await fac.command('add_stories', { text: lines(51) }), 'story_limit_reached');
      expect(rowsOf(fac)).toHaveLength(150);
      expectOk(await fac.command('add_stories', { text: lines(50) }));
      expect(rowsOf(fac)).toHaveLength(MAX_STORIES);
    },
  );

  test(
    'F02-AC3: two bulk pastes racing for the last slots: one applies entirely, the other not at all',
    apiOnly,
    async ({ world }) => {
      const { room, fac } = await rawStoryRoom(world);
      await world.api.seedStories(room.roomId, { count: 100 });
      const second = await world.rawFacilitator(room);
      second.paced = true;
      const lines = (tag: string): string =>
        Array.from({ length: 60 }, (_, i) => `${tag} ${i + 1}`).join('\n');
      const [r1, r2] = await Promise.all([
        fac.command('add_stories', { text: lines('A') }),
        second.command('add_stories', { text: lines('B') }),
      ]);
      const oks = [r1, r2].filter((r) => r.ok);
      expect(oks).toHaveLength(1);
      const failed = [r1, r2].find((r) => !r.ok)!;
      expectError(failed, 'story_limit_reached');
      await fac.command('resync');
      expect(rowsOf(fac)).toHaveLength(160);
      const tags = new Set(
        rowsOf(fac)
          .filter((r) => /^[AB] \d+$/.test(r.title))
          .map((r) => r.title[0]),
      );
      expect(tags.size).toBe(1);
    },
  );
});

test.describe('F02 edit, delete, reorder (AC4)', () => {
  test(
    'F02-AC4: edit changes only the given fields, bumps rev, clears with empty values, and rejects empty patches',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world);
      const id = await addStory(fac, 'Original', {
        description: 'desc',
        link: 'https://a.example',
      });
      expectOk(await fac.command('edit_story', { storyId: id, title: 'Renamed' }));
      expect(rowByTitle(fac, 'Renamed')).toMatchObject({
        link: 'https://a.example',
        hasDescription: true,
        rev: 2,
      });
      expect((await getStory(fac, id)).description).toBe('desc');
      expectOk(
        await fac.command('edit_story', {
          storyId: id,
          description: 'new desc',
          link: 'https://b.example',
        }),
      );
      expect(rowByTitle(fac, 'Renamed')).toMatchObject({ link: 'https://b.example', rev: 3 });
      expect((await getStory(fac, id)).description).toBe('new desc');
      // Clear both optional fields.
      expectOk(await fac.command('edit_story', { storyId: id, description: '', link: '' }));
      expect(rowByTitle(fac, 'Renamed')).toMatchObject({
        link: null,
        hasDescription: false,
        rev: 4,
      });
      // Failures change nothing.
      expectError(await fac.command('edit_story', { storyId: id }), 'invalid_input');
      expectError(await fac.command('edit_story', { storyId: id, title: '' }), 'invalid_input');
      expectError(
        await fac.command('edit_story', { storyId: id, link: 'javascript:alert(1)' }),
        'invalid_input',
      );
      expectError(
        await fac.command('edit_story', { storyId: 'nope', title: 'x' }),
        'unknown_story',
      );
      expect(rowByTitle(fac, 'Renamed').rev).toBe(4);
    },
  );

  test(
    'F02-AC4: editing the active story never touches the round or the votes, also after reveal',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['Active'],
      });
      const vera = voters[0]!;
      expectOk(await selectStory(fac, ids['Active']!));
      expectOk(await vera.vote('5'));
      const round = roundOf(fac);
      expectOk(
        await fac.command('edit_story', {
          storyId: ids['Active']!,
          title: 'Active 2',
          description: 'now with text',
        }),
      );
      await vera.waitForState(
        (s) => s.stories.agenda?.rows[0]?.title === 'Active 2',
        'edit visible',
      );
      expect(vera.state!.myVote).toBe('5');
      expect(vera.state!.round).toMatchObject({ phase: 'voting', number: round });
      expect(vera.held!.activeDescription).toBe('now with text');
      await reveal(fac);
      const votes = JSON.stringify(fac.state!.round);
      expectOk(await fac.command('edit_story', { storyId: ids['Active']!, title: 'Active 3' }));
      expect(JSON.stringify(fac.state!.round)).toBe(votes);
    },
  );

  test(
    'F02-AC4: delete confirmation is enforced by the server (estimated story, active story with an unsaved round)',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, {
        titles: ['Pending', 'Estimated', 'Active'],
      });
      // Pending and not active: no confirmation.
      expectOk(await fac.command('delete_story', { storyId: ids['Pending']! }));
      expect(titlesOf(fac)).toEqual(['Estimated', 'Active']);
      // Estimated: needs confirmDelete (and the field says which flag is missing).
      await estimate(fac, ids['Estimated']!, '5');
      expectOk(await selectStory(fac, ids['Active']!, true));
      expectError(
        await fac.command('delete_story', { storyId: ids['Estimated']! }),
        'confirmation_required',
        'confirmDelete',
      );
      expect(titlesOf(fac)).toEqual(['Estimated', 'Active']);
      expectOk(
        await fac.command('delete_story', { storyId: ids['Estimated']!, confirmDelete: true }),
      );
      expect(titlesOf(fac)).toEqual(['Active']);
      expect(fac.state!.stories.progress).toEqual({ estimated: 0, outOf: 1, skipped: 0 });
      // Active with an unsaved round: needs confirmReset; without votes it does not.
      expectOk(await fac.command('vote', { card: '5' }));
      expectError(
        await fac.command('delete_story', { storyId: ids['Active']! }),
        'confirmation_required',
        'confirmReset',
      );
      const round = roundOf(fac);
      expectOk(await fac.command('delete_story', { storyId: ids['Active']!, confirmReset: true }));
      // Idle afterwards: no active story, a new round, no votes.
      expect(activeOf(fac)).toBeNull();
      expect(roundOf(fac)).toBeGreaterThan(round);
      expect(fac.state!.myVote).toBeNull();
      expectError(await fac.command('delete_story', { storyId: ids['Active']! }), 'unknown_story');
    },
  );

  test(
    'F02-AC4: deleting an estimated story that is also active asks for confirmDelete first, then confirmReset',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['Both'] });
      await estimate(fac, ids['Both']!, '3');
      // Re-vote with a vote in the round: estimated AND active with an unsaved round.
      expectOk(await fac.command('reset')); // same story, new round
      expect(activeOf(fac)).toBe(ids['Both']);
      expectOk(await fac.command('vote', { card: '8' }));
      expectError(
        await fac.command('delete_story', { storyId: ids['Both']! }),
        'confirmation_required',
        'confirmReset',
      );
      expectError(
        await fac.command('delete_story', { storyId: ids['Both']!, confirmReset: true }),
        'confirmation_required',
        'confirmDelete',
      );
      expectOk(
        await fac.command('delete_story', {
          storyId: ids['Both']!,
          confirmReset: true,
          confirmDelete: true,
        }),
      );
      expect(rowsOf(fac)).toHaveLength(0);
    },
  );

  test(
    'F02-AC4: move_story places a story before another or at the end; unknown ids are rejected and change nothing',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B', 'C', 'D'] });
      expectOk(await fac.command('move_story', { storyId: ids['D']!, beforeId: ids['A']! }));
      expect(titlesOf(fac)).toEqual(['D', 'A', 'B', 'C']);
      expectOk(await fac.command('move_story', { storyId: ids['D']!, beforeId: null }));
      expect(titlesOf(fac)).toEqual(['A', 'B', 'C', 'D']);
      expectOk(await fac.command('move_story', { storyId: ids['A']!, beforeId: ids['D']! }));
      expect(titlesOf(fac)).toEqual(['B', 'C', 'A', 'D']);
      // Already there: no-op.
      expectOk(await fac.command('move_story', { storyId: ids['A']!, beforeId: ids['D']! }));
      expect(titlesOf(fac)).toEqual(['B', 'C', 'A', 'D']);
      expectError(
        await fac.command('move_story', { storyId: 'gone', beforeId: ids['A']! }),
        'unknown_story',
      );
      expectError(
        await fac.command('move_story', { storyId: ids['A']!, beforeId: 'gone' }),
        'unknown_story',
      );
      expect(titlesOf(fac)).toEqual(['B', 'C', 'A', 'D']);
    },
  );

  test(
    'F02-AC4: a move relative to a story that was deleted meanwhile is rejected, never applied to another story',
    apiOnly,
    async ({ world }) => {
      const { room, fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B', 'C', 'D'] });
      const other = await world.rawFacilitator(room); // second tab of the facilitator
      other.paced = true;
      expectOk(await fac.command('delete_story', { storyId: ids['C']! }));
      // The other tab still believed C existed and moves D before it.
      expectError(
        await other.command('move_story', { storyId: ids['D']!, beforeId: ids['C']! }),
        'unknown_story',
      );
      await other.command('resync');
      expect(titlesOf(other)).toEqual(['A', 'B', 'D']);
      expect(titlesOf(other)).toEqual(titlesOf(fac));
    },
  );

  test(
    'F02-AC4: moving never affects the active story, the round or the votes',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B', 'C'],
      });
      const vera = voters[0]!;
      expectOk(await selectStory(fac, ids['B']!));
      expectOk(await vera.vote('8'));
      const round = roundOf(fac);
      expectOk(await fac.command('move_story', { storyId: ids['B']!, beforeId: ids['A']! }));
      expectOk(await fac.command('move_story', { storyId: ids['A']!, beforeId: null }));
      await vera.waitUntil(() => vera.held?.rows[0]?.title === 'B', 'move visible');
      expect(vera.state!.stories.activeId).toBe(ids['B']);
      expect(vera.state!.round).toMatchObject({ phase: 'voting', number: round });
      expect(vera.state!.myVote).toBe('8');
    },
  );

  test(
    'F02-X-RACE-6: concurrent moves and deletes from two facilitator tabs converge to one order with no duplicates or lost stories',
    apiOnly,
    async ({ world }) => {
      test.slow();
      const titles = Array.from({ length: 12 }, (_, i) => `S${String(i + 1).padStart(2, '0')}`);
      const { room, fac, ids } = await rawStoryRoom(world, { titles });
      const tab = await world.rawFacilitator(room);
      tab.paced = true;
      const all = titles.map((t) => ids[t]!);
      const deleted = new Set<string>();
      for (let round = 0; round < 5; round++) {
        const ops: Promise<unknown>[] = [];
        for (let k = 0; k < 3; k++) {
          const a = all[(round * 5 + k * 3) % all.length]!;
          const b = all[(round * 7 + k * 2 + 1) % all.length]!;
          ops.push(fac.command('move_story', { storyId: a, beforeId: k === 2 ? null : b }));
          ops.push(tab.command('move_story', { storyId: b, beforeId: a }));
        }
        if (round === 2) {
          const victim = all[4]!;
          deleted.add(victim);
          ops.push(tab.command('delete_story', { storyId: victim }));
        }
        await Promise.all(ops);
      }
      await fac.command('resync');
      await tab.command('resync');
      const order = rowsOf(fac).map((r) => r.id);
      expect(rowsOf(tab).map((r) => r.id)).toEqual(order);
      expect(new Set(order).size).toBe(order.length);
      expect([...order].sort()).toEqual(all.filter((id) => !deleted.has(id)).sort());
    },
  );
});

test.describe('F02 story cap (AC5)', () => {
  test(
    'F02-AC5: the 200th story is accepted, the 201st gets story_limit_reached, a delete frees a slot',
    apiOnly,
    async ({ world }) => {
      const { room, fac } = await rawStoryRoom(world);
      await world.api.seedStories(room.roomId, { count: MAX_STORIES - 1 });
      await fac.command('resync');
      expectOk(await fac.command('add_story', { title: 'Number 200' }));
      expect(rowsOf(fac)).toHaveLength(MAX_STORIES);
      expectError(await fac.command('add_story', { title: 'Number 201' }), 'story_limit_reached');
      expect(rowsOf(fac)).toHaveLength(MAX_STORIES);
      expectOk(await fac.command('delete_story', { storyId: rowsOf(fac)[0]!.id }));
      expectOk(await fac.command('add_story', { title: 'Fits again' }));
      expect(rowsOf(fac)).toHaveLength(MAX_STORIES);
      expect(fac.state!.stories.progress.outOf).toBe(MAX_STORIES);
    },
  );

  test(
    'F02-AC5: pending, estimated and skipped stories all count towards the cap',
    apiOnly,
    async ({ world }) => {
      const { room, fac } = await rawStoryRoom(world);
      await world.api.seedStories(room.roomId, { count: MAX_STORIES, estimated: 60, skipped: 60 });
      await fac.command('resync');
      expect(fac.state!.stories.progress).toEqual({ estimated: 60, outOf: 140, skipped: 60 });
      expectError(await fac.command('add_story', { title: 'one too many' }), 'story_limit_reached');
    },
  );

  test(
    'F02-AC5: two simultaneous adds at 199 stories: exactly one wins',
    apiOnly,
    async ({ world }) => {
      const { room, fac } = await rawStoryRoom(world);
      await world.api.seedStories(room.roomId, { count: MAX_STORIES - 1 });
      const tab = await world.rawFacilitator(room);
      const [a, b] = await Promise.all([
        fac.command('add_story', { title: 'racer A' }),
        tab.command('add_story', { title: 'racer B' }),
      ]);
      expect([a, b].filter((r) => r.ok)).toHaveLength(1);
      expectError(
        [a, b].find((r) => !r.ok)!,
        'story_limit_reached',
      );
      await fac.command('resync');
      expect(rowsOf(fac)).toHaveLength(MAX_STORIES);
    },
  );

  test(
    'F02-AC5: the seeding hook honors the cap too (409, nothing added)',
    apiOnly,
    async ({ world }) => {
      const { room, fac } = await rawStoryRoom(world);
      await world.api.seedStories(room.roomId, { count: 100 });
      const res = await world.api.seedStoriesRaw(room.roomId, { count: 101 });
      expect(res.status()).toBe(409);
      await fac.command('resync');
      expect(rowsOf(fac)).toHaveLength(100);
    },
  );
});

test.describe('F02 authorization (AC6)', () => {
  for (const controlMode of ['facilitator', 'everyone'] as const) {
    test(
      `F02-AC6: voters and observers cannot use any story command, control mode "${controlMode}"`,
      apiOnly,
      async ({ world }) => {
        const { fac, voters, observers, ids } = await rawStoryRoom(world, {
          settings: { controlMode },
          voters: ['Vera'],
          observers: ['Olga'],
          titles: ['A', 'B'],
        });
        expectOk(await selectStory(fac, ids['A']!));
        expectOk(await fac.command('vote', { card: '5' }));
        await reveal(fac);
        const round = roundOf(fac);
        for (const who of [voters[0]!, observers[0]!]) {
          const a = ids['A']!;
          const b = ids['B']!;
          const attempts: [string, Record<string, unknown>][] = [
            ['add_story', { title: 'x' }],
            ['add_stories', { text: 'x\ny' }],
            ['edit_story', { storyId: a, title: 'hijack' }],
            ['delete_story', { storyId: b, confirmReset: true, confirmDelete: true }],
            ['move_story', { storyId: b, beforeId: a }],
            ['select_story', { storyId: b, confirmReset: true }],
            ['next_story', { round, confirmReset: true }],
            ['skip_story', { storyId: b, round, advance: false, confirmReset: true }],
            ['restore_story', { storyId: b }],
            ['accept_estimate', { storyId: a, round, estimate: '5' }],
            ['update_settings', { settings: { storySource: 'topic' }, confirmReset: true }],
          ];
          for (const [type, fields] of attempts) {
            expectError(await who.command(type, fields), 'not_allowed');
          }
        }
        // Nothing changed.
        expect(titlesOf(fac)).toEqual(['A', 'B']);
        expect(rowByTitle(fac, 'A').status).toBe('pending');
        expect(activeOf(fac)).toBe(ids['A']);
        expect(roundOf(fac)).toBe(round);
      },
    );
  }

  test(
    'F02-AC6: everyone can read: get_story and resync work for voters and observers',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, observers, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        observers: ['Olga'],
        titles: ['A'],
      });
      expectOk(await fac.command('edit_story', { storyId: ids['A']!, description: 'readable' }));
      for (const who of [voters[0]!, observers[0]!]) {
        expect((await getStory(who, ids['A']!)).description).toBe('readable');
        expectOk(await who.command('resync'));
        expect(who.state!.stories.agenda?.rows).toHaveLength(1);
      }
    },
  );

  test(
    'F02-AC6: in control mode "everyone" voters may reveal and reset the active story, observers may not; Next, select, skip and accept stay facilitator-only',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, observers, ids } = await rawStoryRoom(world, {
        settings: { controlMode: 'everyone' },
        voters: ['Vera'],
        observers: ['Olga'],
        titles: ['A', 'B'],
      });
      const [vera, olga] = [voters[0]!, observers[0]!];
      expectOk(await selectStory(fac, ids['A']!));
      expectOk(await vera.vote('5'));
      expectError(await olga.command('reveal'), 'not_allowed');
      expectOk(await vera.command('reveal'));
      await fac.waitForState((s) => s.round.phase === 'revealed', 'revealed by voter');
      expectError(await olga.command('reset'), 'not_allowed');
      expectError(await acceptEstimate(vera, ids['A']!, '5'), 'not_allowed');
      expectError(await nextStory(vera), 'not_allowed');
      expectOk(await vera.command('reset'));
      await fac.waitForState((s) => s.round.phase === 'voting', 'reset by voter');
      expect(activeOf(fac)).toBe(ids['A']);
      expect(fac.state!.participants.every((p) => !p.hasVoted)).toBe(true);
    },
  );

  test(
    'F02-AC6: control mode "facilitator only": voters cannot reveal or reset in story mode',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, { voters: ['Vera'], titles: ['A'] });
      expectOk(await selectStory(fac, ids['A']!));
      expectError(await voters[0]!.command('reveal'), 'not_allowed');
      expectError(await voters[0]!.command('reset'), 'not_allowed');
    },
  );

  test(
    'F02-AC6 / F02-X-F01-7: rights are checked when the command is processed; after a hand-over the new facilitator manages stories and the old one cannot',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, { voters: ['Vera'], titles: ['A'] });
      const vera = voters[0]!;
      const veraId = vera.state!.selfId;
      expectOk(await fac.command('hand_over', { participantId: veraId }));
      await vera.waitForState((s) => s.facilitatorId === veraId, 'vera is facilitator');
      expectError(await fac.command('add_story', { title: 'late' }), 'not_allowed');
      expectError(
        await fac.command('edit_story', { storyId: ids['A']!, title: 'late' }),
        'not_allowed',
      );
      expectError(await selectStory(fac, ids['A']!), 'not_allowed');
      expectOk(await vera.command('add_story', { title: 'new facilitator story' }));
      expectOk(await selectStory(vera, ids['A']!));
      expect(titlesOf(vera)).toEqual(['A', 'new facilitator story']);
    },
  );
});

test.describe('F02 select a story (AC7)', () => {
  test(
    'F02-AC7: selecting makes the story active for everyone and starts a new round with no votes',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, observers, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        observers: ['Olga'],
        titles: ['A', 'B'],
      });
      const [vera, olga] = [voters[0]!, observers[0]!];
      expectOk(await selectStory(fac, ids['A']!));
      expect(activeOf(fac)).toBe(ids['A']);
      expectOk(await vera.vote('8'));
      await reveal(fac);
      const round = roundOf(fac);
      // Revealed and not accepted: unsaved, needs confirmation. The failed attempt changes nothing.
      expectError(await selectStory(fac, ids['B']!), 'confirmation_required', 'confirmReset');
      expect(activeOf(fac)).toBe(ids['A']);
      expect(roundOf(fac)).toBe(round);
      expectOk(await selectStory(fac, ids['B']!, true));
      for (const c of [fac, vera, olga]) {
        await c.waitForState((s) => s.stories.activeId === ids['B'], 'B active');
        expect(c.state!.round).toEqual({ phase: 'voting', number: round + 1 });
        expect(c.state!.participants.every((p) => !p.hasVoted)).toBe(true);
      }
      expect(vera.state!.myVote).toBeNull();
      // Selecting the active story again is a no-op: same round, votes stay.
      expectOk(await vera.vote('3'));
      expectOk(await selectStory(fac, ids['B']!));
      expect(roundOf(fac)).toBe(round + 1);
      await vera.waitForState(() => true, 'state');
      expect(vera.state!.myVote).toBe('3');
      expectError(await selectStory(fac, 'gone'), 'unknown_story');
    },
  );

  test(
    'F02-AC7: after an accepted estimate the round is saved: moving on needs no confirmation',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B'],
      });
      await playRound(fac, ids['A']!, [{ client: voters[0]!, card: '5' }]);
      expectOk(await acceptEstimate(fac, ids['A']!, '5'));
      expect(fac.state!.stories.acceptedRound).toBe(roundOf(fac));
      expectOk(await selectStory(fac, ids['B']!));
      expect(activeOf(fac)).toBe(ids['B']);
      expect(fac.state!.stories.acceptedRound).toBeNull();
    },
  );

  test(
    'F02-AC7: idle (Story list mode, no active story): vote, reveal, reset and accept get no_active_story',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, { voters: ['Vera'], titles: ['A'] });
      expect(activeOf(fac)).toBeNull();
      expectError(await voters[0]!.vote('5'), 'no_active_story');
      expectError(await fac.command('reveal'), 'no_active_story');
      expectError(await fac.command('reset'), 'no_active_story');
      expectError(await acceptEstimate(fac, ids['A']!, '5'), 'no_active_story');
      // Empty agenda is idle as well.
      const empty = await rawStoryRoom(world);
      expectError(await empty.fac.vote('5'), 'no_active_story');
    },
  );

  test(
    'F02-X-F01-1: auto-reveal never fires while idle or when a story is selected, only when the last online voter has voted',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        settings: { autoReveal: true },
        voters: ['Vera'],
        titles: ['A'],
      });
      const vera = voters[0]!;
      expect(fac.state!.round.phase).toBe('voting');
      expectOk(await selectStory(fac, ids['A']!));
      expect(fac.state!.round.phase).toBe('voting');
      expectOk(await vera.vote('5'));
      expect(fac.state!.round.phase).toBe('voting');
      expectOk(await fac.command('vote', { card: '8' }));
      await fac.waitForState((s) => s.round.phase === 'revealed', 'auto-revealed');
      // Auto-reveal does not accept.
      expect(rowByTitle(fac, 'A').status).toBe('pending');
      expect(fac.state!.stories.acceptedRound).toBeNull();
    },
  );

  test(
    'F02-X-RACE-5: two selects at once leave every client in one consistent state',
    apiOnly,
    async ({ world }) => {
      const { room, fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B'],
      });
      const tab = await world.rawFacilitator(room);
      tab.paced = true;
      for (let i = 0; i < 4; i++) {
        const [x, y] = [ids['A']!, ids['B']!];
        const before = roundOf(fac);
        const [r1, r2] = await Promise.all([
          selectStory(fac, i % 2 === 0 ? x : y, true),
          selectStory(tab, i % 2 === 0 ? y : x, true),
        ]);
        expectOk(r1);
        expectOk(r2);
        // Quiesce: a resync is ordered after everything the server processed before it.
        for (const c of [fac, tab, voters[0]!]) expectOk(await c.command('resync'));
        const settled = fac.state!;
        expect(settled.round.number).toBeGreaterThan(before);
        expect(voters[0]!.state!.round.number).toBe(settled.round.number);
        expect(tab.state!.round.number).toBe(settled.round.number);
        expect([x, y]).toContain(settled.stories.activeId);
        expect(voters[0]!.state!.stories.activeId).toBe(settled.stories.activeId);
        expect(tab.state!.stories.activeId).toBe(settled.stories.activeId);
        expect(settled.round.phase).toBe('voting');
      }
    },
  );
});

test.describe('F02 Next story (AC9)', () => {
  test(
    'F02-AC9: Next picks the first pending story after the active one, wraps, and never picks skipped or estimated stories',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B', 'C', 'D', 'E'] });
      await estimate(fac, ids['A']!, '5'); // A estimated, active
      expectOk(await skipStory(fac, ids['D']!)); // D skipped (not active: no confirmation)
      expectOk(await nextStory(fac));
      expect(activeOf(fac)).toBe(ids['B']);
      expectOk(await nextStory(fac));
      expect(activeOf(fac)).toBe(ids['C']);
      expectOk(await nextStory(fac));
      expect(activeOf(fac)).toBe(ids['E']); // D skipped
      // Wraps to the first pending story before the active one (B and C were left pending).
      expectOk(await nextStory(fac));
      expect(activeOf(fac)).toBe(ids['B']);
      // Each Next starts a new round.
      expect(fac.state!.round.phase).toBe('voting');
    },
  );

  test(
    'F02-AC9: with no active story Next picks the first pending story; none left gives no_next_story',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B'] });
      expectOk(await skipStory(fac, ids['A']!));
      expectOk(await nextStory(fac));
      expect(activeOf(fac)).toBe(ids['B']);
      await reveal(fac);
      expectOk(await acceptEstimate(fac, ids['B']!, '3'));
      // A is skipped, B estimated: nothing pending.
      expectError(await nextStory(fac), 'no_next_story');
      expect(activeOf(fac)).toBe(ids['B']);
      // Empty agenda.
      const empty = await rawStoryRoom(world);
      expectError(await nextStory(empty.fac), 'no_next_story');
    },
  );

  test(
    'F02-AC9: Next with an unsaved round needs confirmReset; the left story keeps its stored status; no votes means no confirmation',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B', 'C'],
      });
      expectOk(await selectStory(fac, ids['A']!));
      // No votes: free to move on.
      expectOk(await nextStory(fac));
      expect(activeOf(fac)).toBe(ids['B']);
      expectOk(await voters[0]!.vote('5'));
      const round = roundOf(fac);
      expectError(await nextStory(fac), 'confirmation_required', 'confirmReset');
      expect(activeOf(fac)).toBe(ids['B']);
      expectOk(await nextStory(fac, true));
      expect(activeOf(fac)).toBe(ids['C']);
      expect(roundOf(fac)).toBe(round + 1);
      expect(rowByTitle(fac, 'B').status).toBe('pending');
      expect(fac.state!.participants.every((p) => !p.hasVoted)).toBe(true);
    },
  );

  test(
    'F02-AC9: Next follows the current order after a reorder or after the active story was deleted',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B', 'C'] });
      expectOk(await selectStory(fac, ids['A']!));
      expectOk(await fac.command('move_story', { storyId: ids['C']!, beforeId: ids['B']! }));
      expectOk(await nextStory(fac));
      expect(activeOf(fac)).toBe(ids['C']);
      expectOk(await fac.command('delete_story', { storyId: ids['C']! }));
      expect(activeOf(fac)).toBeNull();
      expectOk(await nextStory(fac));
      expect(activeOf(fac)).toBe(ids['A']); // first pending
    },
  );

  test(
    'F02-AC9 / F02-X-RACE-1: two Next commands based on the same round advance exactly once',
    apiOnly,
    async ({ world }) => {
      const { room, fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B', 'C', 'D'] });
      const tab = await world.rawFacilitator(room);
      tab.paced = true;
      expectOk(await selectStory(fac, ids['A']!));
      await tab.waitForState((s) => s.stories.activeId === ids['A'], 'tab sees A');
      const round = roundOf(fac);
      const [r1, r2] = await Promise.all([
        fac.command('next_story', { round, confirmReset: false }),
        tab.command('next_story', { round, confirmReset: false }),
      ]);
      expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
      expectError(
        [r1, r2].find((r) => !r.ok)!,
        'stale_round',
      );
      expect(activeOf(fac)).toBe(ids['B']); // not C: no story was skipped
      // A stale Next on its own.
      expectError(
        await fac.command('next_story', { round: round - 1, confirmReset: true }),
        'stale_round',
      );
      expect(activeOf(fac)).toBe(ids['B']);
    },
  );
});

test.describe('F02 final estimate (AC10)', () => {
  test(
    'F02-AC10: accept rules: only a value card of the deck, only revealed, only the active story, only the current round',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B'],
      });
      expectOk(await selectStory(fac, ids['A']!));
      expectOk(await voters[0]!.vote('5'));
      const round = roundOf(fac);
      expectError(await acceptEstimate(fac, ids['A']!, '5'), 'round_not_revealed');
      await reveal(fac);
      expectError(await acceptEstimate(fac, ids['A']!, '?'), 'invalid_card');
      expectError(await acceptEstimate(fac, ids['A']!, '☕'), 'invalid_card');
      expectError(await acceptEstimate(fac, ids['A']!, '99'), 'invalid_card');
      expectError(await acceptEstimate(fac, ids['A']!, 'XL'), 'invalid_card');
      expectError(await acceptEstimate(fac, ids['B']!, '5'), 'invalid_story_state'); // not the active story
      expectError(await acceptEstimate(fac, 'gone', '5'), 'unknown_story');
      expectError(await acceptEstimate(fac, ids['A']!, '5', round - 1), 'stale_round');
      expectError(await acceptEstimate(fac, ids['A']!, '5', round + 1), 'stale_round');
      expect(rowByTitle(fac, 'A').estimate).toBeNull();
      // The real thing; the round stays revealed and the story stays active.
      const votesBefore = JSON.stringify(fac.state!.round);
      expectOk(await acceptEstimate(fac, ids['A']!, '8'));
      expect(rowByTitle(fac, 'A')).toMatchObject({ status: 'estimated', estimate: '8' });
      expect(JSON.stringify(fac.state!.round)).toBe(votesBefore);
      expect(activeOf(fac)).toBe(ids['A']);
      expect(fac.state!.stories.acceptedRound).toBe(round);
      // Accepting again in the same round overwrites.
      expectOk(await acceptEstimate(fac, ids['A']!, '13'));
      expect(rowByTitle(fac, 'A').estimate).toBe('13');
    },
  );

  test(
    'F02-AC10: a revealed round with no votes can be accepted with any value card',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A'] });
      expectOk(await selectStory(fac, ids['A']!));
      await reveal(fac);
      expectOk(await acceptEstimate(fac, ids['A']!, '21'));
      expect(rowByTitle(fac, 'A').estimate).toBe('21');
      const detail = await getStory(fac, ids['A']!);
      expect(detail.finalRound).toEqual({ number: roundOf(fac), votes: [] });
    },
  );

  test(
    'F02-AC10: the estimate must be a value card of the current (custom) deck',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, {
        settings: { deck: { id: 'custom', cards: ['a1', 'b2'] } },
        titles: ['A'],
      });
      expectOk(await selectStory(fac, ids['A']!));
      await reveal(fac);
      expectError(await acceptEstimate(fac, ids['A']!, '5'), 'invalid_card');
      expectError(await acceptEstimate(fac, ids['A']!, '?'), 'invalid_card');
      expectOk(await acceptEstimate(fac, ids['A']!, 'b2'));
    },
  );

  test(
    'F02-X-RACE-2: accept racing a reset never stores an estimate for a round that is no longer the current one',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        settings: { controlMode: 'everyone' },
        voters: ['Vera'],
        titles: ['A'],
      });
      const vera = voters[0]!;
      let accepted = 0;
      let rejected = 0;
      test.slow();
      for (let i = 0; i < 6; i++) {
        expectOk(await selectStory(fac, ids['A']!, true));
        // A fresh round: select on the active story is a no-op, so reset starts the next one.
        if (i > 0) expectOk(await fac.command('reset'));
        expectOk(await vera.vote('5'));
        expectOk(await fac.command('vote', { card: '8' }));
        await reveal(fac);
        const round = roundOf(fac);
        const [acc, rst] = await Promise.all([
          acceptEstimate(fac, ids['A']!, '5', round),
          vera.command('reset'),
        ]);
        expectOk(rst);
        const detail = await getStory(fac, ids['A']!);
        if (acc.ok) {
          accepted += 1;
          // Accepted in the round it was based on, with exactly that round's two votes.
          expect(detail.finalRound?.number).toBe(round);
          expect(detail.finalRound?.votes).toHaveLength(2);
          expect(detail.estimate).toBe('5');
        } else {
          rejected += 1;
          expect(['stale_round', 'round_not_revealed']).toContain(acc.code);
          // The estimate of an earlier iteration (if any) is untouched; this round stored nothing new.
          expect(detail.finalRound === null || detail.finalRound.number < round).toBe(true);
        }
      }
      expect(accepted + rejected).toBe(6);
    },
  );
});

test.describe('F02 final round (AC11)', () => {
  test(
    'F02-AC11: the accepted estimate keeps the final round: participant id, name at that time and card; observers and non-voters absent',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, observers, ids } = await rawStoryRoom(world, {
        voters: ['Vera', 'Wim', 'Zed'],
        observers: ['Olga'],
        titles: ['A'],
      });
      const [vera, wim] = [voters[0]!, voters[1]!];
      expectOk(await selectStory(fac, ids['A']!));
      expectOk(await vera.vote('5'));
      expectOk(await wim.vote('?')); // special cards are part of the round; Zed does not vote
      expectOk(await fac.command('vote', { card: '8' }));
      await reveal(fac);
      expectOk(await acceptEstimate(fac, ids['A']!, '8'));
      const round = roundOf(fac);
      // Everyone, observers included, can read it.
      for (const reader of [observers[0]!, vera, fac]) {
        const detail = await getStory(reader, ids['A']!);
        expect(detail).toMatchObject({ status: 'estimated', estimate: '8' });
        expect(detail.finalRound?.number).toBe(round);
        expect([...detail.finalRound!.votes].sort((a, b) => a.card.localeCompare(b.card))).toEqual(
          [
            { participantId: fac.state!.selfId, name: 'Facilitator', card: '8' },
            { participantId: vera.state!.selfId, name: 'Vera', card: '5' },
            { participantId: wim.state!.selfId, name: 'Wim', card: '?' },
          ].sort((a, b) => a.card.localeCompare(b.card)),
        );
      }
    },
  );

  test(
    'F02-AC11: a story without estimate has no final round; reset rounds are never kept',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, { voters: ['Vera'], titles: ['A'] });
      expectOk(await selectStory(fac, ids['A']!));
      expect((await getStory(fac, ids['A']!)).finalRound).toBeNull();
      expectOk(await voters[0]!.vote('3'));
      await reveal(fac);
      expectOk(await fac.command('reset'));
      expectOk(await voters[0]!.vote('13'));
      await reveal(fac);
      expect((await getStory(fac, ids['A']!)).finalRound).toBeNull(); // revealed, not accepted
      expectOk(await acceptEstimate(fac, ids['A']!, '13'));
      const votes = (await getStory(fac, ids['A']!)).finalRound!.votes;
      expect(votes.map((v) => v.card)).toEqual(['13']); // the final round only (Vera; the facilitator did not vote)
    },
  );

  test(
    'F02-AC11 / AC12: a re-vote keeps the old estimate and final round until a new one is accepted, which replaces both',
    apiOnly,
    async ({ world }) => {
      const tokens1 = { vera: 'q7xz', fac: 'k3vm' };
      const tokens2 = { vera: 'p5dt', fac: 'w8ne' };
      const { fac, voters, observers, ids } = await rawStoryRoom(world, {
        settings: {
          deck: { id: 'custom', cards: [...Object.values(tokens1), ...Object.values(tokens2)] },
        },
        voters: ['Vera'],
        observers: ['Olga'],
        titles: ['A'],
      });
      const [vera, olga] = [voters[0]!, observers[0]!];
      expectOk(await selectStory(fac, ids['A']!));
      expectOk(await vera.vote(tokens1.vera));
      expectOk(await fac.command('vote', { card: tokens1.fac }));
      await reveal(fac);
      expectOk(await acceptEstimate(fac, ids['A']!, tokens1.vera));
      const first = (await getStory(olga, ids['A']!)).finalRound!;
      // Re-vote: select the estimated story again (it is active, so reset starts the new round).
      expectOk(await fac.command('reset'));
      const mark = olga.frames.length;
      expectOk(await vera.vote(tokens2.vera));
      expectOk(await fac.command('vote', { card: tokens2.fac }));
      const stillThere = await getStory(olga, ids['A']!);
      expect(stillThere).toMatchObject({ status: 'estimated', estimate: tokens1.vera });
      expect(stillThere.finalRound).toEqual(first);
      // The new round's hidden votes appear nowhere on the observer's connection.
      expect(rawFramesLeaking(olga, Object.values(tokens2), mark)).toEqual([]);
      await reveal(fac);
      // Revealed but not accepted: old estimate and final round remain.
      expect((await getStory(olga, ids['A']!)).estimate).toBe(tokens1.vera);
      expectOk(await acceptEstimate(fac, ids['A']!, tokens2.fac));
      const replaced = await getStory(olga, ids['A']!);
      expect(replaced.estimate).toBe(tokens2.fac);
      expect(replaced.finalRound?.number).toBe(roundOf(fac));
      expect(replaced.finalRound?.votes.map((v) => v.card).sort()).toEqual(
        [tokens2.fac, tokens2.vera].sort(),
      );
    },
  );

  test(
    'F02-AC11: a rename does not change the snapshot; removing a participant erases the name and keeps the vote',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera', 'Wim'],
        titles: ['A'],
      });
      const [vera, wim] = [voters[0]!, voters[1]!];
      await playRound(fac, ids['A']!, [
        { client: vera, card: '5' },
        { client: wim, card: '8' },
      ]);
      expectOk(await acceptEstimate(fac, ids['A']!, '8'));
      expectOk(await vera.command('rename', { name: 'Vera Renamed' }));
      let votes = (await getStory(fac, ids['A']!)).finalRound!.votes;
      expect(votes.find((v) => v.participantId === vera.state!.selfId)?.name).toBe('Vera');
      expectOk(await fac.command('remove_participant', { participantId: wim.state!.selfId }));
      votes = (await getStory(fac, ids['A']!)).finalRound!.votes;
      expect(votes.find((v) => v.participantId === wim.state!.selfId)).toEqual({
        participantId: wim.state!.selfId,
        name: null,
        card: '8',
      });
      expect(votes.find((v) => v.participantId === vera.state!.selfId)?.name).toBe('Vera');
    },
  );

  test(
    'F02-AC11: persisted layout (hook): one row per story, the final round is stored with its votes',
    apiOnly,
    async ({ world }) => {
      const { room, fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B'],
      });
      await playRound(fac, ids['A']!, [{ client: voters[0]!, card: '5' }]);
      expectOk(await acceptEstimate(fac, ids['A']!, '5'));
      const storage = await world.api.storage(room.roomId);
      const storyKeys = storage.entries.filter((e) => e.key.startsWith('stories/'));
      expect(storyKeys.map((e) => e.key).sort()).toEqual(
        [`stories/${ids['A']}`, `stories/${ids['B']}`].sort(),
      );
      expect(storage.finalRounds).toHaveLength(1);
      expect(storage.finalRounds[0]).toMatchObject({ storyId: ids['A'] });
      expect(storage.finalRounds[0]!.finalRound.votes.map((v) => v.card)).toEqual(['5']);
      // The in-progress round of B stores no final round.
      expect(storage.finalRounds.some((f) => f.storyId === ids['B'])).toBe(false);
    },
  );
});

test.describe('F02 re-vote (AC12)', () => {
  test(
    'F02-AC12: selecting an estimated story re-votes it; the estimate counts until replaced; leaving without accepting keeps it',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B'],
      });
      await estimate(fac, ids['A']!, '5');
      expect(fac.state!.stories.sum.value).toBe('5');
      expectOk(await selectStory(fac, ids['B']!)); // no votes in A's saved round
      expectOk(await selectStory(fac, ids['A']!)); // re-vote
      expect(activeOf(fac)).toBe(ids['A']);
      expect(rowByTitle(fac, 'A')).toMatchObject({ status: 'estimated', estimate: '5' });
      expect(fac.state!.stories.progress).toEqual({ estimated: 1, outOf: 2, skipped: 0 });
      expect(fac.state!.stories.sum.value).toBe('5');
      expect(fac.state!.stories.acceptedRound).toBeNull();
      expectOk(await voters[0]!.vote('13'));
      expectOk(await fac.command('reset'));
      expect(rowByTitle(fac, 'A').estimate).toBe('5');
      expectOk(await voters[0]!.vote('13'));
      await reveal(fac);
      expectOk(await nextStory(fac, true));
      expect(activeOf(fac)).toBe(ids['B']);
      expect(rowByTitle(fac, 'A')).toMatchObject({ status: 'estimated', estimate: '5' });
      expect((await getStory(fac, ids['A']!)).estimate).toBe('5');
      // Re-vote and replace.
      expectOk(await selectStory(fac, ids['A']!));
      await reveal(fac);
      expectOk(await acceptEstimate(fac, ids['A']!, '8'));
      expect(fac.state!.stories.sum.value).toBe('8');
    },
  );
});

test.describe('F02 skip and restore (AC13)', () => {
  test(
    'F02-AC13: skip marks a pending story skipped; skipping an estimated story is rejected; restore returns it to pending',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B'] });
      expectOk(await skipStory(fac, ids['A']!));
      expect(rowByTitle(fac, 'A')).toMatchObject({ status: 'skipped', estimate: null });
      expect(fac.state!.stories.progress).toEqual({ estimated: 0, outOf: 1, skipped: 1 });
      expectError(await skipStory(fac, ids['A']!), 'invalid_story_state'); // already skipped
      expectOk(await fac.command('restore_story', { storyId: ids['A']! }));
      expect(rowByTitle(fac, 'A').status).toBe('pending');
      expectError(
        await fac.command('restore_story', { storyId: ids['A']! }),
        'invalid_story_state',
      );
      await estimate(fac, ids['B']!, '3');
      expectError(await skipStory(fac, ids['B']!), 'invalid_story_state');
      expect(rowByTitle(fac, 'B')).toMatchObject({ status: 'estimated', estimate: '3' });
      expectError(await skipStory(fac, 'gone'), 'unknown_story');
      expectError(await fac.command('restore_story', { storyId: 'gone' }), 'unknown_story');
    },
  );

  test(
    'F02-AC13: skipping the active story discards its round and leaves the room idle (confirmReset when unsaved); a stale round is rejected',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B'],
      });
      expectOk(await selectStory(fac, ids['A']!));
      expectOk(await voters[0]!.vote('5'));
      const round = roundOf(fac);
      expectError(await skipStory(fac, ids['A']!), 'confirmation_required', 'confirmReset');
      expectError(
        await skipStory(fac, ids['A']!, { round: round - 1, confirmReset: true }),
        'stale_round',
      );
      // Skipping another story needs no confirmation even though the active round is unsaved.
      expectOk(await skipStory(fac, ids['B']!));
      expectOk(await skipStory(fac, ids['A']!, { confirmReset: true }));
      expect(activeOf(fac)).toBeNull();
      expect(roundOf(fac)).toBeGreaterThan(round);
      expect(fac.state!.participants.every((p) => !p.hasVoted)).toBe(true);
    },
  );

  test(
    'F02-AC13: skip and next makes the next pending story active in one step, or leaves the room idle when none is left',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B', 'C'],
      });
      expectOk(await selectStory(fac, ids['A']!));
      expectOk(await voters[0]!.vote('5'));
      expectError(
        await skipStory(fac, ids['A']!, { advance: true }),
        'confirmation_required',
        'confirmReset',
      );
      expectOk(await skipStory(fac, ids['A']!, { advance: true, confirmReset: true }));
      expect(rowByTitle(fac, 'A').status).toBe('skipped');
      expect(activeOf(fac)).toBe(ids['B']);
      expect(fac.state!.round.phase).toBe('voting');
      expectOk(await skipStory(fac, ids['B']!, { advance: true }));
      expect(activeOf(fac)).toBe(ids['C']);
      // Nothing pending after C: advance leaves the room idle without an error.
      expectOk(await skipStory(fac, ids['C']!, { advance: true }));
      expect(activeOf(fac)).toBeNull();
      expect(fac.state!.stories.progress).toEqual({ estimated: 0, outOf: 0, skipped: 3 });
    },
  );

  test(
    'F02-AC13: a skipped story can still be selected and estimated; leaving it without accepting keeps it skipped',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B'] });
      expectOk(await skipStory(fac, ids['A']!));
      expectOk(await selectStory(fac, ids['A']!));
      expect(activeOf(fac)).toBe(ids['A']);
      expect(rowByTitle(fac, 'A').status).toBe('skipped');
      expectOk(await selectStory(fac, ids['B']!));
      expect(rowByTitle(fac, 'A').status).toBe('skipped');
      await estimate(fac, ids['A']!, '2');
      expect(rowByTitle(fac, 'A')).toMatchObject({ status: 'estimated', estimate: '2' });
      expect(fac.state!.stories.progress).toEqual({ estimated: 1, outOf: 2, skipped: 0 });
    },
  );
});

test.describe('F02 agenda progress and sum (AC14, AC15)', () => {
  test(
    'F02-AC14: progress counts non-skipped stories and follows every change',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B', 'C', 'D'] });
      const check = (statuses: ('pending' | 'estimated' | 'skipped')[]): void => {
        expect(fac.state!.stories.progress).toEqual(expectedProgress(statuses));
      };
      check(['pending', 'pending', 'pending', 'pending']);
      await estimate(fac, ids['A']!, '5');
      check(['estimated', 'pending', 'pending', 'pending']);
      expectOk(await skipStory(fac, ids['C']!));
      check(['estimated', 'pending', 'skipped', 'pending']);
      await estimate(fac, ids['A']!, '8'); // re-accept: no change
      check(['estimated', 'pending', 'skipped', 'pending']);
      expectOk(await fac.command('delete_story', { storyId: ids['B']! }));
      check(['estimated', 'skipped', 'pending']);
      expectOk(
        await fac.command('delete_story', {
          storyId: ids['A']!,
          confirmDelete: true,
          confirmReset: true,
        }),
      );
      check(['skipped', 'pending']);
      expectOk(await fac.command('restore_story', { storyId: ids['C']! }));
      check(['pending', 'pending']);
      const empty = await rawStoryRoom(world);
      expect(empty.fac.state!.stories.progress).toEqual({ estimated: 0, outOf: 0, skipped: 0 });
    },
  );

  const sumCases: {
    name: string;
    deck: Parameters<typeof rawStoryRoom>[1];
    cards: string[];
    numeric?: false;
  }[] = [
    { name: 'halves 0.5 x 3 = 1.5', deck: {}, cards: ['½', '½', '½'] },
    { name: 'integers 1+2+3 = 6', deck: {}, cards: ['1', '2', '3'] },
    { name: 'zeros', deck: {}, cards: ['0', '0'] },
    { name: 'Fibonacci 21+13+8 = 42', deck: {}, cards: ['21', '13', '8'] },
    {
      name: 'Modified Fibonacci 100+40+20 = 160',
      deck: { settings: { deck: { id: 'modified-fibonacci' } } },
      cards: ['100', '40', '20'],
    },
    {
      name: 'Powers of 2 64+32 = 96',
      deck: { settings: { deck: { id: 'powers-of-2' } } },
      cards: ['64', '32'],
    },
    {
      name: 'custom decimals 0.1+0.2 = 0.3 (exact)',
      deck: { settings: { deck: { id: 'custom', cards: ['0.1', '0.2'] } } },
      cards: ['0.1', '0.2'],
    },
    {
      name: 'custom decimals 0.25 x 2 = 0.5',
      deck: { settings: { deck: { id: 'custom', cards: ['0.25', '1'] } } },
      cards: ['0.25', '0.25'],
    },
    {
      name: 'T-shirt deck has no sum',
      deck: { settings: { deck: { id: 'tshirt' } } },
      cards: ['M', 'L'],
      numeric: false,
    },
    {
      name: 'custom non-numeric deck has no sum',
      deck: { settings: { deck: { id: 'custom', cards: ['1', 'XL'] } } },
      cards: ['1', 'XL'],
      numeric: false,
    },
  ];
  for (const c of sumCases) {
    test(`F02-AC15: sum of accepted estimates: ${c.name}`, apiOnly, async ({ world }) => {
      const numeric = c.numeric !== false;
      const { fac } = await rawStoryRoom(world, {
        ...c.deck,
        titles: c.cards.map((_, i) => `S${i}`),
      });
      expect(fac.state!.stories.sum).toEqual({ value: null, excluded: 0 }); // nothing estimated yet
      for (const [i, card] of c.cards.entries()) await estimate(fac, rowsOf(fac)[i]!.id, card);
      expect(fac.state!.stories.sum).toEqual(expectedSum(numeric, c.cards));
    });
  }

  test(
    'F02-AC15: after a deck change estimates are kept as text; those that are not numbers are flagged, not summed',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, {
        settings: { deck: { id: 'tshirt' } },
        titles: ['A', 'B', 'C'],
      });
      await estimate(fac, ids['A']!, 'M');
      await estimate(fac, ids['B']!, 'L');
      expect(fac.state!.stories.sum).toEqual({ value: null, excluded: 0 });
      // The accepted round (no votes) is saved, so the deck can change without confirmation here.
      expectOk(await fac.command('update_settings', { settings: { deck: { id: 'fibonacci' } } }));
      expect(rowByTitle(fac, 'A').estimate).toBe('M'); // never re-mapped
      expect(fac.state!.stories.sum).toEqual({ value: null, excluded: 2 });
      await estimate(fac, ids['C']!, '5');
      expect(fac.state!.stories.sum).toEqual({ value: '5', excluded: 2 });
      expectOk(await fac.command('update_settings', { settings: { deck: { id: 'tshirt' } } }));
      expect(fac.state!.stories.sum).toEqual({ value: null, excluded: 0 });
      expectOk(await fac.command('update_settings', { settings: { deck: { id: 'fibonacci' } } }));
      expect(fac.state!.stories.sum).toEqual({ value: '5', excluded: 2 });
    },
  );

  test(
    'F02-AC15: the sum drops an estimate when its story is deleted',
    apiOnly,
    async ({ world }) => {
      const { fac, ids } = await rawStoryRoom(world, { titles: ['A', 'B'] });
      await estimate(fac, ids['A']!, '3');
      await estimate(fac, ids['B']!, '8');
      expect(fac.state!.stories.sum.value).toBe('11');
      expectOk(await fac.command('delete_story', { storyId: ids['A']!, confirmDelete: true }));
      expect(fac.state!.stories.sum.value).toBe('8');
    },
  );
});

test.describe('F02 deck change (AC21)', () => {
  test(
    'F02-AC21: a deck change with votes in the round needs confirmReset even after an estimate was accepted; estimates are kept',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, { voters: ['Vera'], titles: ['A'] });
      await playRound(fac, ids['A']!, [{ client: voters[0]!, card: '5' }]);
      expectOk(await acceptEstimate(fac, ids['A']!, '5'));
      const round = roundOf(fac);
      expectError(
        await fac.command('update_settings', { settings: { deck: { id: 'powers-of-2' } } }),
        'confirmation_required',
        'confirmReset',
      );
      expect(fac.state!.settings.deck).toEqual({ id: 'fibonacci' });
      expect(roundOf(fac)).toBe(round);
      expectOk(
        await fac.command('update_settings', {
          settings: { deck: { id: 'powers-of-2' } },
          confirmReset: true,
        }),
      );
      expect(roundOf(fac)).toBeGreaterThan(round);
      expect(fac.state!.round.phase).toBe('voting');
      expect(rowByTitle(fac, 'A')).toMatchObject({ status: 'estimated', estimate: '5' });
      expect(activeOf(fac)).toBe(ids['A']);
      // The final round is history and survives the deck change.
      expect((await getStory(fac, ids['A']!)).finalRound?.votes.map((v) => v.card)).toEqual(['5']);
    },
  );
});

test.describe('F02 size and on-demand loading (AC16)', () => {
  test(
    'F02-AC16: the join snapshot with 200 maximum-length stories stays under 1 MiB and carries only the active description',
    apiOnly,
    async ({ world }) => {
      const { room, fac } = await rawStoryRoom(world);
      await world.api.seedStories(room.roomId, {
        count: MAX_STORIES,
        titleLength: 200,
        descriptionLength: STORY_DESCRIPTION_MAX,
        linkLength: STORY_LINK_MAX,
        estimated: 100,
        finalRoundVotes: 50,
      });
      await fac.command('resync');
      const first = rowsOf(fac)[0]!;
      expectOk(await selectStory(fac, first.id));
      // A new participant joins: its first state frame is the join snapshot.
      const joiner = await world.rawConnect(room.roomId);
      await joiner.join('Newcomer');
      const joinFrame = joiner.frames.find((f) => f.msg?.type === 'state')!;
      expect(frameBytes(joinFrame.text)).toBeLessThan(SNAPSHOT_MAX_BYTES);
      const json = JSON.parse(joinFrame.text) as {
        state: {
          stories: { agenda: { rows: Record<string, unknown>[]; activeDescription: string } };
        };
      };
      const agenda = json.state.stories.agenda;
      expect(agenda.rows).toHaveLength(MAX_STORIES);
      expect(agenda.activeDescription.length).toBeGreaterThan(1_000);
      expect(agenda.rows.every((r) => !('description' in r) && !('finalRound' in r))).toBe(true);
      expect(agenda.rows.every((r) => r['hasDescription'] === true)).toBe(true);
      // Resync is bounded the same way.
      const mark = joiner.frames.length;
      expectOk(await joiner.command('resync'));
      const resyncFrame = joiner.frames.slice(mark).find((f) => f.msg?.type === 'state')!;
      expect(frameBytes(resyncFrame.text)).toBeLessThan(SNAPSHOT_MAX_BYTES);
      expect(joiner.agendaGaps).toBe(0);
    },
  );

  test('F02-AC16: the same budget holds with 4-byte emoji titles', apiOnly, async ({ world }) => {
    const { room } = await rawStoryRoom(world);
    await world.api.seedStories(room.roomId, {
      count: MAX_STORIES,
      titleLength: 200,
      emoji: true,
      descriptionLength: STORY_DESCRIPTION_MAX,
      linkLength: STORY_LINK_MAX,
      estimated: 100,
      finalRoundVotes: 50,
    });
    const joiner = await world.rawConnect(room.roomId);
    await joiner.join('Newcomer');
    const joinFrame = joiner.frames.find((f) => f.msg?.type === 'state')!;
    expect(frameBytes(joinFrame.text)).toBeLessThan(SNAPSHOT_MAX_BYTES);
    expect(rowsOf(joiner)).toHaveLength(MAX_STORIES);
  });

  test(
    'F02-AC16: a vote, a reveal and a presence change do not carry the agenda; an agenda change does',
    apiOnly,
    async ({ world }) => {
      const { room, fac, voters } = await rawStoryRoom(world, { voters: ['Vera'] });
      await world.api.seedStories(room.roomId, {
        count: MAX_STORIES,
        titleLength: 200,
        descriptionLength: STORY_DESCRIPTION_MAX,
        linkLength: 200,
      });
      await fac.command('resync');
      const vera = voters[0]!;
      await vera.command('resync');
      const firstId = rowsOf(fac)[0]!.id;
      expectOk(await selectStory(fac, firstId));
      await vera.waitForState((s) => s.stories.activeId === firstId, 'vera sees the selection');
      const version = vera.state!.stories.agendaVersion;
      const mark = vera.frames.length;
      expectOk(await fac.command('vote', { card: '5' })); // someone else votes
      expectOk(await vera.vote('3'));
      expectOk(await fac.command('reveal'));
      await vera.waitForState((s) => s.round.phase === 'revealed', 'revealed');
      const late = await world.rawConnect(room.roomId); // presence change
      await late.join('Late');
      await vera.waitForState((s) => s.participants.length === 3, 'presence broadcast');
      expectOk(await fac.command('reset')); // reset of the same story is not an agenda change
      await vera.waitForState((s) => s.round.phase === 'voting', 'reset');
      const plain = vera.frames
        .slice(mark)
        .filter((f) => f.msg?.type === 'state')
        .map((f) => ({
          bytes: frameBytes(f.text),
          state: (f.msg as { state: typeof vera.state }).state!,
        }));
      expect(plain.length).toBeGreaterThanOrEqual(4);
      for (const p of plain) {
        expect(p.state.stories.agenda).toBeUndefined();
        expect(p.state.stories.agendaVersion).toBe(version);
        expect(p.bytes).toBeLessThan(16_384);
      }
      // An edit bumps agendaVersion and carries the agenda.
      const mark2 = vera.frames.length;
      expectOk(await fac.command('edit_story', { storyId: firstId, title: 'Edited' }));
      await vera.waitForState((s) => s.stories.agendaVersion > version, 'edit broadcast');
      const withAgenda = vera.frames
        .slice(mark2)
        .map((f) => f.msg)
        .find((m) => m?.type === 'state' && m.state.stories.agendaVersion > version);
      expect(withAgenda?.type === 'state' && withAgenda.state.stories.agenda?.rows[0]?.title).toBe(
        'Edited',
      );
      expect(vera.agendaGaps).toBe(0);
    },
  );

  test(
    'F02-AC16: other descriptions and final rounds are loaded on demand with get_story; unknown ids are rejected',
    apiOnly,
    async ({ world }) => {
      const { room, fac, observers } = await rawStoryRoom(world, { observers: ['Olga'] });
      await world.api.seedStories(room.roomId, {
        count: 3,
        descriptionLength: 120,
        estimated: 2,
        finalRoundVotes: 4,
      });
      await fac.command('resync');
      const olga = observers[0]!;
      await olga.command('resync');
      const rows = rowsOf(olga);
      const detail = await getStory(olga, rows[0]!.id);
      expect(detail).toMatchObject({ id: rows[0]!.id, rev: rows[0]!.rev, status: 'estimated' });
      expect(detail.description.length).toBe(120);
      expect(detail.finalRound?.votes).toHaveLength(4);
      const pending = await getStory(olga, rows[2]!.id);
      expect(pending.finalRound).toBeNull();
      expectError(await olga.command('get_story', { storyId: 'gone' }), 'unknown_story');
    },
  );

  test(
    'F02-AC16: every story is its own storage row and no row comes near the platform value limit',
    apiOnly,
    async ({ world }) => {
      const { room } = await rawStoryRoom(world);
      await world.api.seedStories(room.roomId, {
        count: MAX_STORIES,
        titleLength: 200,
        emoji: true,
        descriptionLength: STORY_DESCRIPTION_MAX,
        linkLength: STORY_LINK_MAX,
        estimated: MAX_STORIES,
        finalRoundVotes: 50,
      });
      const storage = await world.api.storage(room.roomId);
      const storyRows = storage.entries.filter((e) => e.key.startsWith('stories/'));
      expect(storyRows).toHaveLength(MAX_STORIES);
      // Per-value limit of the Durable Object KV API is 128 KiB; stay well below.
      expect(Math.max(...storage.entries.map((e) => e.bytes))).toBeLessThan(65_536);
      expect(storage.finalRounds).toHaveLength(MAX_STORIES);
      test
        .info()
        .annotations.push({ type: 'storage-total-bytes', description: String(storage.totalBytes) });
    },
  );

  test(
    'F02-AC16: a long mixed session never leaves a client with an agenda gap (no resync needed)',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, observers, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        observers: ['Olga'],
        titles: ['A', 'B', 'C'],
      });
      const [vera, olga] = [voters[0]!, observers[0]!];
      await playRound(fac, ids['A']!, [{ client: vera, card: '5' }]);
      expectOk(await acceptEstimate(fac, ids['A']!, '5'));
      expectOk(await fac.command('edit_story', { storyId: ids['B']!, title: 'B2' }));
      expectOk(await fac.command('move_story', { storyId: ids['C']!, beforeId: ids['A']! }));
      expectOk(await nextStory(fac));
      expectOk(
        await fac.command('delete_story', {
          storyId: ids['A']!,
          confirmDelete: true,
          confirmReset: true,
        }),
      );
      expectOk(await skipStory(fac, ids['C']!));
      await olga.waitForState((s) => s.stories.progress.skipped === 1, 'olga caught up');
      expect(titlesOf(olga)).toEqual(titlesOf(fac));
      expect(titlesOf(vera)).toEqual(titlesOf(fac));
      for (const c of [fac, vera, olga]) expect(c.agendaGaps).toBe(0);
    },
  );
});

test.describe('F02 persistence (AC17)', () => {
  async function snapshotOf(c: RawClient, ids: string[]): Promise<unknown> {
    await c.command('resync');
    const s = c.state!;
    const details = [];
    for (const id of ids) details.push(await getStory(c, id));
    return {
      rows: c.held!.rows,
      activeDescription: c.held!.activeDescription,
      activeId: s.stories.activeId,
      acceptedRound: s.stories.acceptedRound,
      agendaVersion: s.stories.agendaVersion,
      progress: s.stories.progress,
      sum: s.stories.sum,
      source: s.settings.storySource,
      round: s.round,
      details,
    };
  }

  async function prepare(world: Parameters<typeof rawStoryRoom>[0]) {
    const sr = await rawStoryRoom(world, {
      voters: ['Vera'],
      titles: ['Done', 'Skipped', 'Active'],
    });
    const { fac, voters, ids } = sr;
    await playRound(fac, ids['Done']!, [{ client: voters[0]!, card: '8' }]);
    expectOk(await acceptEstimate(fac, ids['Done']!, '8'));
    expectOk(await skipStory(fac, ids['Skipped']!));
    expectOk(
      await fac.command('edit_story', {
        storyId: ids['Active']!,
        description: '**bold** text',
        link: 'https://a.example/x',
      }),
    );
    await playRound(fac, ids['Active']!, [{ client: voters[0]!, card: '3' }]);
    return { ...sr, all: [ids['Done']!, ids['Skipped']!, ids['Active']!] };
  }

  test(
    'F02-AC17: agenda, active story, round, statuses, estimates and final rounds survive dropping the room memory (open sockets)',
    apiOnly,
    async ({ world }) => {
      test.slow();
      const { room, fac, voters, all, ids } = await prepare(world);
      const before = await snapshotOf(fac, all);
      const instance = await world.api.instanceId(room.roomId);
      await world.api.evict(room.roomId, 'drop_memory');
      expect(await world.api.instanceId(room.roomId)).not.toBe(instance);
      // The next message on the existing connection is served from storage.
      const after = await snapshotOf(fac, all);
      expect(after).toEqual(before);
      // Revealed round votes survive; commands keep working.
      expectOk(await acceptEstimate(fac, ids['Active']!, '3'));
      expectOk(await fac.command('add_story', { title: 'After eviction' }));
      await voters[0]!.command('resync');
      expect(titlesOf(voters[0]!)).toEqual(['Done', 'Skipped', 'Active', 'After eviction']);
      expect(fac.closed).toBeNull();
    },
  );

  test(
    'F02-AC17: the same state survives an abort of the room object after the clients reconnect',
    apiOnly,
    async ({ world }) => {
      test.slow();
      const { room, fac, all } = await prepare(world);
      const before = await snapshotOf(fac, all);
      await world.api.evict(room.roomId, 'abort');
      await fac.waitForClose();
      const again = await world.rawFacilitator(room);
      again.paced = true;
      expect(await snapshotOf(again, all)).toEqual(before);
    },
  );

  test(
    'F02-AC17: a client that was offline sees the changes made meanwhile when it rejoins',
    apiOnly,
    async ({ world }) => {
      const { room, fac, voters, ids } = await rawStoryRoom(world, {
        voters: ['Vera'],
        titles: ['A', 'B'],
      });
      const vera = voters[0]!;
      const token = vera.token!;
      vera.close();
      await vera.waitForClose();
      expectOk(await fac.command('edit_story', { storyId: ids['A']!, title: 'A edited' }));
      expectOk(await selectStory(fac, ids['B']!));
      expectOk(await fac.command('add_story', { title: 'C added' }));
      const back = await RawClient.connect(room.roomId, uniqueKey('raw'));
      await back.rejoin(token);
      expect(titlesOf(back)).toEqual(['A edited', 'B', 'C added']);
      expect(back.state!.stories.activeId).toBe(ids['B']);
      expect(back.agendaGaps).toBe(0);
      back.close();
    },
  );
});

test.describe('F02 hidden votes (F01-AC11 regression in story mode)', () => {
  test(
    "F02-AC16 / F01-AC11: no client receives another participant's vote value during a story round, through join, get_story, resync and agenda changes",
    apiOnly,
    async ({ world }) => {
      const cards = ['q7xz', 'k3vm', 'p5dt'];
      const { room, fac, voters, observers, ids } = await rawStoryRoom(world, {
        settings: { deck: { id: 'custom', cards } },
        voters: ['Vera', 'Wim'],
        observers: ['Olga'],
        titles: ['A', 'B'],
      });
      const [vera, wim] = voters as [RawClient, RawClient];
      const olga = observers[0]!;
      const marks = new Map<RawClient, number>([
        [fac, 0],
        [vera, 0],
        [wim, 0],
        [olga, 0],
      ]);
      expectOk(await selectStory(fac, ids['A']!));
      expectOk(await vera.vote('q7xz'));
      expectOk(await wim.vote('k3vm'));
      // Activity that produces snapshots: edit, resync, get_story, move, presence, late join, reset-less.
      expectOk(await fac.command('edit_story', { storyId: ids['A']!, title: 'A!' }));
      expectOk(await fac.command('move_story', { storyId: ids['B']!, beforeId: ids['A']! }));
      expectOk(await olga.command('resync'));
      await getStory(olga, ids['A']!);
      await getStory(wim, ids['B']!);
      const late = await world.rawConnect(room.roomId);
      await late.join('Late', 'observer');
      expectOk(await vera.vote('p5dt'));
      expectOk(await vera.vote('q7xz'));
      // Each connection may hold only its own value.
      expect(rawFramesLeaking(olga, ['q7xz', 'k3vm', 'p5dt'], marks.get(olga)!)).toEqual([]);
      expect(rawFramesLeaking(late, ['q7xz', 'k3vm', 'p5dt'])).toEqual([]);
      expect(rawFramesLeaking(wim, ['q7xz', 'p5dt'], 0)).toEqual([]); // Wim's own k3vm is allowed (myVote)
      expect(rawFramesLeaking(vera, ['k3vm'], 0)).toEqual([]);
      // Sanity: the facilitator did not vote, so it sees no tokens at all either.
      expect(rawFramesLeaking(fac, ['q7xz', 'k3vm', 'p5dt'], 0)).toEqual([]);
      // After the reveal the values are public.
      expectOk(await fac.command('reveal'));
      await olga.waitForState((s) => s.round.phase === 'revealed', 'revealed');
      expect(rawFramesLeaking(olga, ['q7xz'], marks.get(olga)!).length).toBeGreaterThan(0);
    },
  );
});

test.describe('F02 rate limits (AC20)', () => {
  test(
    'F02-AC20: a bulk add of 100 maximum-length titles passes the frame limit and counts as one message',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world);
      fac.paced = false;
      const text = Array.from(
        { length: 100 },
        (_, i) => `${String(i + 1).padStart(3, '0')} ${'x'.repeat(196)}`,
      ).join('\n');
      expect(text.length).toBeGreaterThan(20_000);
      expectOk(await fac.command('add_stories', { text }));
      expect(rowsOf(fac)).toHaveLength(100);
      // The same connection still has the rest of its 20 messages (join + bulk used 2).
      for (let i = 0; i < 17; i++) expectOk(await fac.command('resync'));
      const burst = await Promise.all(Array.from({ length: 6 }, () => fac.command('resync')));
      expect(burst.some((r) => !r.ok && r.code === 'rate_limited')).toBe(true);
      expect(fac.closed).toBeNull();
    },
  );

  test(
    'F02-AC20: a maximum 4-byte-character bulk (about 40,000 UTF-16 units) fits the 65,536 character frame limit',
    apiOnly,
    async ({ world }) => {
      const { fac } = await rawStoryRoom(world);
      const text = Array.from({ length: 100 }, () => '😀'.repeat(200)).join('\n');
      expect(text.length).toBeGreaterThan(40_000);
      expect(text.length).toBeLessThan(65_536);
      expectOk(await fac.command('add_stories', { text }));
      expect(rowsOf(fac)).toHaveLength(100);
      expect(fac.closed).toBeNull();
    },
  );
});

test.describe('F02 races with votes (X-RACE-4)', () => {
  test(
    'F02-X-RACE-4: a vote racing the deletion of the active story is accepted before it or rejected after it, never stored for a deleted story',
    apiOnly,
    async ({ world }) => {
      const { fac, voters, ids } = await rawStoryRoom(world, { voters: ['Vera'], titles: ['A'] });
      const vera = voters[0]!;
      for (let i = 0; i < 5; i++) {
        const id = i === 0 ? ids['A']! : await addStory(fac, `A${i}`);
        expectOk(await selectStory(fac, id, true));
        const [v, d] = await Promise.all([
          vera.vote('5'),
          fac.command('delete_story', { storyId: id, confirmReset: true, confirmDelete: true }),
        ]);
        expectOk(d);
        if (!v.ok) expect(v.code).toBe('no_active_story');
        await fac.waitForState((s) => s.stories.activeId === null, 'idle');
        expect(fac.state!.participants.every((p) => !p.hasVoted)).toBe(true);
        expect(rowsOf(fac).some((r) => r.id === id)).toBe(false);
      }
    },
  );
});
