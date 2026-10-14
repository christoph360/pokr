import { describe, expect, it } from 'vitest';
import * as v from 'valibot';
import {
  BULK_ADD_MAX,
  EMPTY_STORIES_STATE,
  MAX_STORIES,
  MAX_SERVER_FRAME_CHARS,
  SNAPSHOT_MAX_BYTES,
  STORY_DESCRIPTION_MAX_BYTES,
  RoomStateSchema,
  TestSeedStoriesRequestSchema,
  TestStorageResponseSchema,
  composeActiveStory,
  isIdle,
  isRoundUnsaved,
  mergeAgenda,
  parseServerMessage,
  serializeMessage,
  utf8ByteLength,
} from './index';
import type { AgendaStory, HeldAgenda, RoomState, StoriesState } from './index';

const row = (id: string, over: Partial<AgendaStory> = {}): AgendaStory => ({
  id,
  title: `Story ${id}`,
  link: null,
  hasDescription: false,
  status: 'pending',
  estimate: null,
  rev: 1,
  tracker: null,
  ...over,
});
const stories = (over: Partial<StoriesState> = {}): StoriesState => ({
  ...EMPTY_STORIES_STATE,
  ...over,
});
/** The same snapshot as the server sends it when the recipient already holds the agenda. */
const withoutAgenda = (s: StoriesState): StoriesState => {
  const { agenda: _agenda, ...rest } = s; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
};

function baseState(s: StoriesState, over: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'abcdefghjkmnpqrs',
    version: 5,
    serverTime: 1,
    selfId: 'p1',
    facilitatorId: 'p1',
    settings: {
      name: 'Room',
      deck: { id: 'fibonacci' },
      controlMode: 'facilitator',
      autoReveal: false,
      facilitatorVotes: true,
      storySource: 'stories',
    },
    topic: '',
    round: { phase: 'voting', number: 2 },
    participants: [{ id: 'p1', name: 'Ann', role: 'voter', online: true, hasVoted: false }],
    myVote: null,
    canClaimAt: null,
    stories: s,
    ...over,
  };
}

describe('agenda sync (F02-AC16)', () => {
  it('F02-AC16: a snapshot with an agenda replaces what the client holds (join, rejoin, resync, change)', () => {
    const block = { rows: [row('a')], activeDescription: '' };
    const next = mergeAgenda(null, stories({ agendaVersion: 7, agenda: block }));
    expect(next.resync).toBe(false);
    expect(next.held).toEqual({ version: 7, ...block });
    const held: HeldAgenda = { version: 9, rows: [], activeDescription: '' };
    const other = { rows: [row('b')], activeDescription: 'x' };
    expect(mergeAgenda(held, stories({ agendaVersion: 7, agenda: other })).held?.rows).toEqual([
      row('b'),
    ]);
  });

  it('F02-AC16: a vote/reveal/presence snapshot omits the agenda and the held one is kept', () => {
    const held: HeldAgenda = { version: 7, rows: [row('a')], activeDescription: 'd' };
    const r = mergeAgenda(held, withoutAgenda(stories({ agendaVersion: 7 })));
    expect(r).toEqual({ held, resync: false });
  });

  it('F02-AC16: an omitted agenda that does not match the held version, or nothing held, asks for a resync', () => {
    const held: HeldAgenda = { version: 7, rows: [row('a')], activeDescription: '' };
    expect(mergeAgenda(held, withoutAgenda(stories({ agendaVersion: 8 }))).resync).toBe(true);
    expect(mergeAgenda(null, withoutAgenda(stories())).resync).toBe(true);
  });

  it('F02-AC16: an omitted agenda is valid on the wire and the stories part stays tiny', () => {
    const small = withoutAgenda(stories({ agendaVersion: 3, activeId: 'a' }));
    expect(v.safeParse(RoomStateSchema, baseState(small)).success).toBe(true);
    expect(JSON.stringify(small).length).toBeLessThan(300);
  });

  it('F02-AC8: the active story is composed from its row and the active description', () => {
    const block = {
      rows: [row('a'), row('b', { hasDescription: true })],
      activeDescription: '# Hi',
    };
    expect(composeActiveStory(block, 'b')).toEqual({
      ...row('b', { hasDescription: true }),
      description: '# Hi',
    });
    expect(composeActiveStory(block, null)).toBeNull();
    expect(composeActiveStory(block, 'zz')).toBeNull();
    expect(composeActiveStory(null, 'a')).toBeNull();
  });

  it('F02-AC7: story list mode without an active story is idle', () => {
    expect(isIdle({ storySource: 'stories' }, { activeId: null })).toBe(true);
    expect(isIdle({ storySource: 'stories' }, { activeId: 'a' })).toBe(false);
    expect(isIdle({ storySource: 'topic' }, { activeId: null })).toBe(false);
  });
});

describe('unsaved round (F02 Definitions)', () => {
  const voted = [{ id: 'p1', name: 'Ann', role: 'voter' as const, online: true, hasVoted: true }];
  const revealed = {
    phase: 'revealed' as const,
    number: 2,
    votes: [{ participantId: 'p1', card: '5' }],
    left: [],
  };

  it('F02-AC7: a voting round with a vote is unsaved; without votes it is not', () => {
    expect(isRoundUnsaved(baseState(stories({ activeId: 'a' }), { participants: voted }))).toBe(
      true,
    );
    expect(isRoundUnsaved(baseState(stories({ activeId: 'a' })))).toBe(false);
  });

  it('F02-AC11: a revealed round is unsaved until an estimate is accepted in it', () => {
    const base = { participants: voted, round: revealed };
    const at = (acceptedRound: number | null) =>
      isRoundUnsaved(baseState(stories({ activeId: 'a', acceptedRound }), base));
    expect(at(null)).toBe(true);
    expect(at(1)).toBe(true); // accepted in an earlier round (re-vote in progress)
    expect(at(2)).toBe(false);
    const empty = { round: { ...revealed, votes: [] } };
    expect(isRoundUnsaved(baseState(stories({ activeId: 'a' }), empty))).toBe(false);
  });

  it('F02-AC1: idle rooms never have an unsaved round; in Free topic mode any votes count', () => {
    expect(isRoundUnsaved(baseState(stories(), { participants: voted }))).toBe(false);
    const topic = baseState(stories(), { participants: voted });
    topic.settings.storySource = 'topic';
    expect(isRoundUnsaved(topic)).toBe(true);
  });
});

describe('snapshot budget (F02-AC16)', () => {
  // Longest rows the schemas allow: 200 graphemes / 1,000 bytes of title (a quote needs escaping in
  // JSON), a 2,048-byte link, the longest ids.
  const title = '"' + '́'.repeat(499);
  const link = `https://example.com/${'a'.repeat(2048 - 20)}`;
  const maxRow = (i: number): AgendaStory => ({
    id: `story-${String(i).padStart(4, '0')}`.padEnd(64, 'x'),
    title,
    link,
    hasDescription: true,
    status: 'estimated',
    estimate: '1000',
    rev: 99_999,
    tracker: { provider: 'jira', key: 'K'.repeat(200) },
  });

  it('F02-AC16: the join snapshot with 200 maximum-length stories and a maximum description is below 1 MiB', () => {
    expect(utf8ByteLength(title)).toBeLessThanOrEqual(1000);
    expect(link.length).toBe(2048);
    const description = '\n'.repeat(4999) + '"'; // JSON doubles every newline: the worst case for 5,000 graphemes
    expect(utf8ByteLength(description)).toBeLessThanOrEqual(STORY_DESCRIPTION_MAX_BYTES);
    const rows = Array.from({ length: MAX_STORIES }, (_, i) => maxRow(i));
    const participants = Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      name: 'N'.repeat(30),
      role: 'voter' as const,
      online: true,
      hasVoted: true,
    }));
    const state = baseState(
      stories({
        agendaVersion: 1000,
        activeId: rows[0]!.id,
        agenda: { rows, activeDescription: description },
      }),
      { participants },
    );
    const frame = serializeMessage({ type: 'state', state });
    expect(utf8ByteLength(frame)).toBeLessThan(SNAPSHOT_MAX_BYTES);
    expect(frame.length).toBeLessThan(MAX_SERVER_FRAME_CHARS);
    expect(parseServerMessage(frame).ok).toBe(true);
    expect(BULK_ADD_MAX).toBe(100);
  });
});

describe('test-mode story hooks', () => {
  it('F02-AC5: the seed hook cannot ask for more than the cap and has sane defaults', () => {
    const ok = v.parse(TestSeedStoriesRequestSchema, { count: 200 });
    expect(ok).toMatchObject({
      count: 200,
      emoji: false,
      estimated: 0,
      skipped: 0,
      finalRoundVotes: 3,
    });
    expect(v.safeParse(TestSeedStoriesRequestSchema, { count: 201 }).success).toBe(false);
    expect(v.safeParse(TestSeedStoriesRequestSchema, { count: 0 }).success).toBe(false);
    const full = {
      count: 5,
      titleLength: 200,
      descriptionLength: 5000,
      linkLength: 2048,
      emoji: true,
      estimated: 2,
      skipped: 1,
    };
    expect(v.safeParse(TestSeedStoriesRequestSchema, full).success).toBe(true);
    expect(v.safeParse(TestSeedStoriesRequestSchema, { count: 1, titleLength: 201 }).success).toBe(
      false,
    );
  });

  it('F02-AC16/AC17: the storage report lists keys with byte sizes and final-round records', () => {
    const report = {
      entries: [{ key: 'stories/s1', bytes: 123 }],
      totalBytes: 123,
      finalRounds: [
        {
          storyId: 's1',
          finalRound: { number: 2, votes: [{ participantId: 'p', name: null, card: '5' }] },
        },
      ],
    };
    expect(v.safeParse(TestStorageResponseSchema, report).success).toBe(true);
  });
});
