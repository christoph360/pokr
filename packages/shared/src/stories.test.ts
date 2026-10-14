import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  BULK_ADD_MAX,
  MAX_CLIENT_FRAME_CHARS,
  MAX_STORIES,
  STORY_DESCRIPTION_MAX,
  STORY_TITLE_MAX,
  BulkTitlesSchema,
  StoryDescriptionSchema,
  StoryLinkInputSchema,
  StoryTitleSchema,
  computeProgress,
  isHttpUrl,
  moveStory,
  moveTarget,
  nextStoryId,
  parseBulkLines,
  parseClientMessage,
  sumEstimates,
} from './index';
import type { AgendaStory, Deck } from './index';

const story = (
  id: string,
  status: AgendaStory['status'] = 'pending',
  estimate: string | null = null,
): Pick<AgendaStory, 'id' | 'status' | 'estimate'> => ({ id, status, estimate });

describe('story fields', () => {
  it('F02-AC2: title is 1-200 graphemes, normalized like F01 text', () => {
    expect(v.parse(StoryTitleSchema, '  Login   page ')).toBe('Login page');
    expect(v.safeParse(StoryTitleSchema, '   ').success).toBe(false);
    expect(v.safeParse(StoryTitleSchema, 'a\nb').success).toBe(false);
    expect(v.safeParse(StoryTitleSchema, 'a'.repeat(STORY_TITLE_MAX)).success).toBe(true);
    expect(v.safeParse(StoryTitleSchema, 'a'.repeat(STORY_TITLE_MAX + 1)).success).toBe(false);
    // 200 family emoji are 200 graphemes, far more than 200 UTF-16 units
    expect(v.safeParse(StoryTitleSchema, '👨‍👩‍👧'.repeat(STORY_TITLE_MAX)).success).toBe(true);
  });

  it('F02-AC2: description counts graphemes, allows newlines and tabs, keeps Markdown whitespace', () => {
    const md = '# Goal\n\n- one\n\t- two  \n\n```\ncode\n```';
    expect(v.parse(StoryDescriptionSchema, md)).toBe(md);
    expect(v.parse(StoryDescriptionSchema, '\n\nA\r\nB  \n\n')).toBe('A\nB');
    expect(v.parse(StoryDescriptionSchema, '')).toBe('');
    expect(v.parse(StoryDescriptionSchema, 'é')).toBe('é');
    expect(v.safeParse(StoryDescriptionSchema, 'a'.repeat(STORY_DESCRIPTION_MAX)).success).toBe(
      true,
    );
    expect(v.safeParse(StoryDescriptionSchema, 'a'.repeat(STORY_DESCRIPTION_MAX + 1)).success).toBe(
      false,
    );
    expect(v.safeParse(StoryDescriptionSchema, '👍'.repeat(STORY_DESCRIPTION_MAX)).success).toBe(
      true,
    );
    expect(v.safeParse(StoryDescriptionSchema, 'a\u0000b').success).toBe(false);
    expect(v.safeParse(StoryDescriptionSchema, 'a b').success).toBe(false);
  });

  it('F02-AC2: link is an http(s) URL, trimmed; empty clears; no credentials or other schemes', () => {
    expect(v.parse(StoryLinkInputSchema, ' https://example.com/a?b=1 ')).toBe(
      'https://example.com/a?b=1',
    );
    expect(v.parse(StoryLinkInputSchema, 'http://localhost:3000')).toBe('http://localhost:3000');
    expect(v.parse(StoryLinkInputSchema, '  ')).toBeNull();
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html,x',
      'ftp://example.com',
      'example.com',
      'https://',
      'https://user:pw@example.com',
      'https://exa mple.com',
      `https://example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(isHttpUrl(bad), bad).toBe(false);
      expect(v.safeParse(StoryLinkInputSchema, bad).success, bad).toBe(false);
    }
  });
});

describe('bulk add', () => {
  it('F02-AC3: one title per line, blank lines skipped, line endings and tabs tolerated', () => {
    const r = parseBulkLines('  First  \r\n\r\nSecond\n\tThird\tx\rFourth Fifth');
    expect(r.titles).toEqual(['First', 'Second', 'Third x', 'Fourth', 'Fifth']);
    expect(r.errors).toEqual([]);
    expect(r.tooMany).toBe(false);
  });

  it('F02-AC3: reports the line of an over-long title instead of truncating', () => {
    const r = parseBulkLines(`ok\n${'x'.repeat(STORY_TITLE_MAX + 1)}\nok2`);
    expect(r.titles).toEqual(['ok', 'ok2']);
    expect(r.errors).toEqual([{ line: 2, reason: 'too_long' }]);
  });

  it('F02-AC3: max 100 per paste', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `Story ${i}`);
    expect(parseBulkLines(lines(BULK_ADD_MAX).join('\n')).tooMany).toBe(false);
    expect(parseBulkLines(lines(BULK_ADD_MAX + 1).join('\n')).tooMany).toBe(true);
    expect(v.safeParse(BulkTitlesSchema, lines(BULK_ADD_MAX)).success).toBe(true);
    expect(v.safeParse(BulkTitlesSchema, lines(BULK_ADD_MAX + 1)).success).toBe(false);
    expect(v.safeParse(BulkTitlesSchema, []).success).toBe(false);
  });

  it('F02-AC3/AC5: a worst-case bulk frame fits the client frame limit', () => {
    const titles = Array.from({ length: BULK_ADD_MAX }, () => 'é'.repeat(STORY_TITLE_MAX));
    const frame = JSON.stringify({ type: 'add_stories', id: 'x', titles });
    expect(frame.length).toBeLessThan(MAX_CLIENT_FRAME_CHARS);
    expect(parseClientMessage(frame).ok).toBe(true);
    expect(MAX_STORIES).toBe(200);
  });
});

describe('reorder (F02-AC4)', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const ids = (l: readonly { id: string }[] | null) => l?.map((s) => s.id).join('');

  it('F02-AC4: move before an anchor, or to the end with null', () => {
    expect(ids(moveStory(list, 'd', 'b'))).toBe('adbc');
    expect(ids(moveStory(list, 'a', 'd'))).toBe('bcad');
    expect(ids(moveStory(list, 'a', null))).toBe('bcda');
    expect(ids(moveStory(list, 'c', 'a'))).toBe('cabd');
  });

  it('F02-AC4: moves that change nothing return the same list', () => {
    expect(moveStory(list, 'b', 'c')).toBe(list);
    expect(moveStory(list, 'b', 'b')).toBe(list);
    expect(moveStory(list, 'd', null)).toBe(list);
  });

  it('F02-AC4: a stale story or anchor is rejected (null), never guessed', () => {
    expect(moveStory(list, 'zz', 'a')).toBeNull();
    expect(moveStory(list, 'a', 'zz')).toBeNull();
  });

  it('F02-AC4: a move is anchored, so concurrent changes elsewhere do not misplace it', () => {
    // client saw a,b,c,d and asked: c before b. Meanwhile "a" was deleted and "e" appended.
    const now = [{ id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    expect(ids(moveStory(now, 'c', 'b'))).toBe('cbde');
  });

  it('F02-AC4: keyboard move up/down/top/bottom map to anchors', () => {
    const apply = (id: string, dir: Parameters<typeof moveTarget>[2]) => {
      const t = moveTarget(list, id, dir);
      return t === undefined ? undefined : ids(moveStory(list, id, t));
    };
    expect(apply('c', 'up')).toBe('acbd');
    expect(apply('b', 'down')).toBe('acbd');
    expect(apply('c', 'down')).toBe('abdc');
    expect(apply('c', 'top')).toBe('cabd');
    expect(apply('b', 'bottom')).toBe('acdb');
    expect(apply('a', 'up')).toBeUndefined();
    expect(apply('a', 'top')).toBeUndefined();
    expect(apply('d', 'down')).toBeUndefined();
    expect(apply('d', 'bottom')).toBeUndefined();
    expect(moveTarget(list, 'zz', 'up')).toBeUndefined();
  });
});

describe('next story (F02-AC9)', () => {
  const agenda = [
    story('a', 'estimated', '3'),
    story('b', 'active'),
    story('c', 'skipped'),
    story('d', 'pending'),
    story('e', 'estimated', '5'),
    story('f', 'pending'),
  ];

  it('F02-AC9: first pending story after the active one in agenda order', () => {
    expect(nextStoryId(agenda, 'b')).toBe('d');
    expect(nextStoryId(agenda, 'd')).toBe('f');
  });

  it('F02-AC9: without an active story it starts at the top', () => {
    expect(nextStoryId([story('x', 'estimated', '1'), story('y')], null)).toBe('y');
  });

  it('F02-AC9: wraps to earlier pending stories, null when none is left', () => {
    expect(nextStoryId(agenda, 'f')).toBe('d');
    expect(nextStoryId(agenda, 'f', { wrap: false })).toBeNull();
    const done = [story('a', 'estimated', '3'), story('b', 'active'), story('c', 'estimated', '2')];
    expect(nextStoryId(done, 'b')).toBeNull();
    expect(nextStoryId([], null)).toBeNull();
  });

  it('F02-AC9/AC13: skipped stories are excluded unless asked for', () => {
    expect(nextStoryId([story('a', 'active'), story('b', 'skipped')], 'a')).toBeNull();
    expect(
      nextStoryId([story('a', 'active'), story('b', 'skipped')], 'a', { includeSkipped: true }),
    ).toBe('b');
  });

  it('F02-AC12: a re-voted story keeps its estimate and is not "next"', () => {
    expect(nextStoryId([story('a', 'estimated', '3'), story('b', 'active', '5')], 'b')).toBeNull();
  });
});

describe('progress and sum', () => {
  it('F02-AC14: progress counts estimates (also on a re-voted active story) and skipped', () => {
    const agenda = [
      story('a', 'estimated', '3'),
      story('b', 'active', '5'),
      story('c', 'skipped'),
      story('d'),
    ];
    expect(computeProgress(agenda)).toEqual({ estimated: 2, skipped: 1, total: 4 });
    expect(computeProgress([])).toEqual({ estimated: 0, skipped: 0, total: 0 });
  });

  it('F02-AC15: sum on numeric decks is exact, with halves and no trailing zeros', () => {
    const fib: Deck = { id: 'fibonacci' };
    expect(sumEstimates(fib, [])).toBe('0');
    expect(sumEstimates(fib, [story('a', 'estimated', '3'), story('b', 'estimated', '13')])).toBe(
      '16',
    );
    expect(
      sumEstimates(fib, [
        story('a', 'estimated', '½'),
        story('b', 'estimated', '½'),
        story('c', 'estimated', '½'),
      ]),
    ).toBe('1.5');
    expect(sumEstimates(fib, [story('a'), story('b', 'estimated', '8')])).toBe('8');
    const custom: Deck = { id: 'custom', cards: ['0.25', '1'] };
    expect(
      sumEstimates(custom, [story('a', 'estimated', '0.25'), story('b', 'estimated', '1')]),
    ).toBe('1.25');
  });

  it('F02-AC15: no sum on non-numeric decks; estimates that are not numbers are ignored', () => {
    expect(sumEstimates({ id: 'tshirt' }, [story('a', 'estimated', 'M')])).toBeNull();
    expect(
      sumEstimates({ id: 'custom', cards: ['S', '1'] }, [story('a', 'estimated', '1')]),
    ).toBeNull();
    expect(
      sumEstimates({ id: 'powers-of-2' }, [
        story('a', 'estimated', 'M'),
        story('b', 'estimated', '4'),
      ]),
    ).toBe('4');
  });
});
