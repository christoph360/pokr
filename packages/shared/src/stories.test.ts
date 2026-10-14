import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  BULK_ADD_MAX,
  MAX_CLIENT_FRAME_CHARS,
  MAX_STORIES,
  STORY_DESCRIPTION_MAX,
  STORY_TITLE_MAX,
  BulkTextSchema,
  STORY_DESCRIPTION_MAX_BYTES,
  STORY_TITLE_MAX_BYTES,
  utf8ByteLength,
  StoryDescriptionSchema,
  StoryLinkInputSchema,
  StoryTitleSchema,
  computeProgress,
  displayStatus,
  isHttpUrl,
  moveStory,
  moveTarget,
  nextStoryId,
  parseBulkLines,
  parseClientMessage,
  sumEstimates,
} from './index';
import type { AgendaStory, Deck } from './index';

const parse = (m: object) => parseClientMessage(JSON.stringify(m));

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
    // 200 emoji are 200 graphemes but 400 UTF-16 units and 800 bytes
    expect(v.safeParse(StoryTitleSchema, '😀'.repeat(STORY_TITLE_MAX)).success).toBe(true);
  });

  it('F02-AC2: title and description also have UTF-8 byte caps', () => {
    // 60 family emoji are 60 graphemes but 18 bytes each (1,080 bytes)
    const family = '👨‍👩‍👧';
    expect(utf8ByteLength(family)).toBe(18);
    expect(v.safeParse(StoryTitleSchema, family.repeat(55)).success).toBe(true); // 990 bytes
    expect(v.safeParse(StoryTitleSchema, family.repeat(56)).success).toBe(false); // 1,008 bytes
    expect(STORY_TITLE_MAX_BYTES).toBe(1000);
    expect(v.safeParse(StoryDescriptionSchema, '€'.repeat(6666)).success).toBe(false); // 5,000 graphemes max
    expect(v.safeParse(StoryDescriptionSchema, '€'.repeat(5000)).success).toBe(true); // 15,000 bytes
    expect(v.safeParse(StoryDescriptionSchema, '😀'.repeat(5000)).success).toBe(true); // exactly 20,000 bytes
    expect(v.safeParse(StoryDescriptionSchema, `${family.repeat(1112)}`).success).toBe(false); // 20,016 bytes, 1,112 graphemes
    expect(STORY_DESCRIPTION_MAX_BYTES).toBe(20000);
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
      'https://example.com/a"b',
      'https://example.com/a\\b',
      `https://example.com/${'é'.repeat(1100)}`, // 2,200 bytes within 2,048 characters
      'https://exa mple.com',
      `https://example.com/${'a'.repeat(2048)}`,
    ]) {
      expect(isHttpUrl(bad), bad).toBe(false);
      expect(v.safeParse(StoryLinkInputSchema, bad).success, bad).toBe(false);
    }
  });
});

describe('bulk add', () => {
  it('F02-AC3: one title per line, blank lines dropped, line endings and tabs tolerated, markers kept', () => {
    const r = parseBulkLines('  First  \r\n\r\n- Second\n\tThird\tx\rFourth\u2028Fifth');
    expect(r.titles).toEqual(['First', '- Second', 'Third x', 'Fourth', 'Fifth']);
    expect(r.errors).toEqual([]);
    expect(r.tooMany).toBe(false);
  });

  it('F02-AC3: reports the 1-based line (blank lines count) of an invalid line instead of truncating', () => {
    const r = parseBulkLines(`ok\n\n${'x'.repeat(STORY_TITLE_MAX + 1)}\nok2`);
    expect(r.titles).toEqual(['ok', 'ok2']);
    expect(r.errors).toEqual([{ line: 3, reason: 'too_long' }]);
    const bytes = parseBulkLines('👨‍👩‍👧'.repeat(56));
    expect(bytes.errors).toEqual([{ line: 1, reason: 'too_long' }]);
  });

  it('F02-AC3: the server schema rejects the whole paste and names the line, never the content', () => {
    const bad = parse({ type: 'add_stories', id: '1', text: 'one\ntwo\n' + 'y'.repeat(300) });
    expect(bad).toMatchObject({ ok: false, code: 'invalid_input', field: 'text.3' });
    expect(JSON.stringify(bad)).not.toContain('yyyy');
    expect(parse({ type: 'add_stories', id: '1', text: 'one\n\n  \ntwo' }).ok).toBe(true);
    expect(parse({ type: 'add_stories', id: '1', text: ' \n\n' })).toMatchObject({
      ok: false,
      field: 'text',
    });
  });

  it('F02-AC3: max 100 non-blank lines per paste', () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `Story ${i}`);
    expect(parseBulkLines(lines(BULK_ADD_MAX).join('\n')).tooMany).toBe(false);
    expect(parseBulkLines(lines(BULK_ADD_MAX + 1).join('\n')).tooMany).toBe(true);
    expect(v.safeParse(BulkTextSchema, lines(BULK_ADD_MAX).join('\n\n')).success).toBe(true);
    expect(v.safeParse(BulkTextSchema, lines(BULK_ADD_MAX + 1).join('\n')).success).toBe(false);
  });

  it('F02-AC20: the largest valid bulk add fits the frame limit', () => {
    // 100 titles of 1,000 bytes: 1 grapheme of `"` (escaped in JSON) plus 2-byte combining marks.
    const title = '"' + '\u0301'.repeat(499);
    expect(utf8ByteLength(title)).toBe(999);
    expect(v.safeParse(StoryTitleSchema, title).success).toBe(true);
    const text = Array.from({ length: BULK_ADD_MAX }, () => title).join('\n');
    const frame = JSON.stringify({ type: 'add_stories', id: 'x'.repeat(64), text });
    expect(frame.length).toBeLessThan(MAX_CLIENT_FRAME_CHARS);
    expect(parseClientMessage(frame).ok).toBe(true);
    // the same with plain emoji titles and a worst-case description
    const emoji = JSON.stringify({
      type: 'add_stories',
      id: 'x',
      text: Array.from({ length: BULK_ADD_MAX }, () => '😀'.repeat(200)).join('\n'),
    });
    expect(parseClientMessage(emoji).ok).toBe(true);
    const description = JSON.stringify({
      type: 'add_story',
      id: 'x',
      title: 'T',
      description: '\n'.repeat(4999) + 'a',
    });
    expect(description.length).toBeLessThan(MAX_CLIENT_FRAME_CHARS);
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
    story('b'), // pending, active
    story('c', 'skipped'),
    story('d'),
    story('e', 'estimated', '5'),
    story('f'),
  ];

  it('F02-AC9: first pending story after the active one in agenda order', () => {
    expect(nextStoryId(agenda, 'b')).toBe('d');
    expect(nextStoryId(agenda, 'd')).toBe('f');
    expect(nextStoryId(agenda, 'a')).toBe('b');
  });

  it('F02-AC9: with no active story it starts at the first pending one', () => {
    expect(nextStoryId([story('x', 'estimated', '1'), story('y')], null)).toBe('y');
    expect(nextStoryId(agenda, null)).toBe('b');
  });

  it('F02-AC9: wraps to the first pending story before the active one', () => {
    expect(nextStoryId(agenda, 'f')).toBe('b');
    expect(nextStoryId(agenda, 'e')).toBe('f');
  });

  it('F02-AC9: null when no pending story remains (no_next_story)', () => {
    const done = [
      story('a', 'estimated', '3'),
      story('b', 'estimated', '4'),
      story('c', 'skipped'),
    ];
    expect(nextStoryId(done, 'b')).toBeNull();
    expect(nextStoryId(done, null)).toBeNull();
    expect(nextStoryId([], null)).toBeNull();
    // the only pending story is the active one itself
    expect(nextStoryId([story('a', 'estimated', '3'), story('b')], 'b')).toBeNull();
  });

  it('F02-AC9/AC13: skipped stories are never picked', () => {
    expect(nextStoryId([story('a'), story('b', 'skipped')], 'a')).toBeNull();
  });

  it('F02-AC12: an estimated story being re-voted is not "next"', () => {
    expect(
      nextStoryId([story('a', 'estimated', '3'), story('b', 'estimated', '5')], 'b'),
    ).toBeNull();
  });
});

describe('status, progress and sum', () => {
  it('F02-AC14: status in text is derived: active wins over the stored status', () => {
    const rows = [story('a', 'estimated', '3'), story('b', 'skipped')];
    expect(displayStatus(rows[0]!, 'a')).toBe('active');
    expect(displayStatus(rows[0]!, null)).toBe('estimated');
    expect(displayStatus(rows[1]!, 'a')).toBe('skipped');
  });

  it('F02-AC14: progress counts non-skipped stories: "7 of 10 estimated, 2 skipped"', () => {
    const agenda = [
      story('a', 'estimated', '3'),
      story('b', 'estimated', '5'),
      story('c', 'skipped'),
      story('d'),
    ];
    expect(computeProgress(agenda)).toEqual({ estimated: 2, outOf: 3, skipped: 1 });
    expect(computeProgress([])).toEqual({ estimated: 0, outOf: 0, skipped: 0 });
  });

  it('F02-AC15: sum on numeric decks is exact, ½ is 0.5, no trailing zeros', () => {
    const fib: Deck = { id: 'fibonacci' };
    const est = (...cards: string[]) => cards.map((c, i) => story(`s${i}`, 'estimated', c));
    expect(sumEstimates(fib, est('3', '13'))).toEqual({ value: '16', excluded: 0 });
    expect(sumEstimates(fib, est('½', '½', '½'))).toEqual({ value: '1.5', excluded: 0 });
    expect(sumEstimates(fib, [story('a'), ...est('8')])).toEqual({ value: '8', excluded: 0 });
    const custom: Deck = { id: 'custom', cards: ['0.1', '0.2', '1.05'] };
    expect(sumEstimates(custom, est('0.1', '0.2'))).toEqual({ value: '0.3', excluded: 0 });
    expect(sumEstimates(custom, est('1.05', '1.05'))).toEqual({ value: '2.1', excluded: 0 });
    expect(sumEstimates({ id: 'powers-of-2' }, est('0', '0'))).toEqual({ value: '0', excluded: 0 });
  });

  it('F02-AC15: no sum without estimates, and none on non-numeric decks', () => {
    expect(sumEstimates({ id: 'fibonacci' }, [])).toEqual({ value: null, excluded: 0 });
    expect(sumEstimates({ id: 'fibonacci' }, [story('a')])).toEqual({ value: null, excluded: 0 });
    expect(sumEstimates({ id: 'tshirt' }, [story('a', 'estimated', 'M')])).toEqual({
      value: null,
      excluded: 0,
    });
    const mixed: Deck = { id: 'custom', cards: ['S', '1'] };
    expect(sumEstimates(mixed, [story('a', 'estimated', '1')])).toEqual({
      value: null,
      excluded: 0,
    });
  });

  it('F02-AC15: estimates that are not numbers after a deck change are excluded and counted', () => {
    const powers: Deck = { id: 'powers-of-2' };
    const rows = [
      story('a', 'estimated', 'M'),
      story('b', 'estimated', '4'),
      story('c', 'estimated', 'XL'),
    ];
    expect(sumEstimates(powers, rows)).toEqual({ value: '4', excluded: 2 });
    expect(sumEstimates(powers, [story('a', 'estimated', 'M')])).toEqual({
      value: null,
      excluded: 1,
    });
  });
});
