import { describe, expect, it } from 'vitest';
import {
  COMMAND_PERMISSIONS,
  DEFAULT_SETTINGS,
  EMPTY_STORIES_STATE,
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  RoomSettingsInputSchema,
  applySettings,
  canAcceptEstimate,
  canManageStories,
  canSelectStory,
  canStartRoundOrReveal,
  canViewStory,
  parseClientMessage,
  parseServerMessage,
} from './index';
import * as v from 'valibot';
import type { Actor } from './permissions';

const parse = (m: object) => parseClientMessage(JSON.stringify(m));

describe('story client messages', () => {
  it('F02-AC2: add_story normalizes fields and defaults description/link to absent', () => {
    const r = parse({
      type: 'add_story',
      id: '1',
      title: '  Login   page ',
      description: '# A\r\nB',
      link: ' https://example.com ',
    });
    expect(r).toMatchObject({
      ok: true,
      message: {
        title: 'Login page',
        description: '# A\nB',
        link: 'https://example.com',
      },
    });
    expect(parse({ type: 'add_story', id: '1', title: 'Only a title' }).ok).toBe(true);
    expect(parse({ type: 'add_story', id: '1', title: '' }).ok).toBe(false);
    const bad = parse({ type: 'add_story', id: '1', title: 'x', link: 'javascript:alert(1)' });
    expect(bad).toMatchObject({ ok: false, code: 'invalid_input', field: 'link' });
  });

  it('F02-AC3: add_stories needs 1-100 valid titles', () => {
    expect(parse({ type: 'add_stories', id: '1', titles: ['a', 'b'] }).ok).toBe(true);
    expect(parse({ type: 'add_stories', id: '1', titles: [] }).ok).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => `s${i}`);
    expect(parse({ type: 'add_stories', id: '1', titles: many }).ok).toBe(false);
    expect(parse({ type: 'add_stories', id: '1', titles: ['ok', ''] }).ok).toBe(false);
  });

  it('F02-AC4: edit_story is partial; a null or empty link clears it', () => {
    expect(parse({ type: 'edit_story', id: '1', storyId: 's1', link: '' })).toMatchObject({
      ok: true,
      message: { link: null },
    });
    expect(parse({ type: 'edit_story', id: '1', storyId: 's1', description: '' })).toMatchObject({
      ok: true,
      message: { description: '' },
    });
    expect(parse({ type: 'edit_story', id: '1', storyId: 's1', title: 'T' }).ok).toBe(true);
  });

  it('F02-AC4: delete_story defaults confirm to false; move_story takes beforeId or null', () => {
    expect(parse({ type: 'delete_story', id: '1', storyId: 's1' })).toMatchObject({
      ok: true,
      message: { confirm: false },
    });
    expect(parse({ type: 'move_story', id: '1', storyId: 's1', beforeId: null }).ok).toBe(true);
    expect(parse({ type: 'move_story', id: '1', storyId: 's1', beforeId: 's2' }).ok).toBe(true);
    expect(parse({ type: 'move_story', id: '1', storyId: 's1' }).ok).toBe(false);
  });

  it('F02-AC7/AC9/AC10/AC13: select, next, accept, skip, get', () => {
    expect(parse({ type: 'select_story', id: '1', storyId: 's1' }).ok).toBe(true);
    expect(parse({ type: 'next_story', id: '1' }).ok).toBe(true);
    expect(
      parse({ type: 'accept_estimate', id: '1', storyId: 's1', round: 3, estimate: '5' }).ok,
    ).toBe(true);
    expect(
      parse({ type: 'accept_estimate', id: '1', storyId: 's1', round: 0, estimate: '5' }).ok,
    ).toBe(false);
    expect(parse({ type: 'skip_story', id: '1', storyId: 's1' })).toMatchObject({
      message: { advance: false },
    });
    expect(parse({ type: 'get_story', id: '1', storyId: 's1' }).ok).toBe(true);
    expect(parse({ type: 'select_story', id: '1' }).ok).toBe(false);
  });

  it('F02: every story command has a permission entry', () => {
    for (const t of [
      'add_story',
      'add_stories',
      'edit_story',
      'delete_story',
      'move_story',
      'select_story',
      'next_story',
      'accept_estimate',
      'skip_story',
    ] as const) {
      expect(COMMAND_PERMISSIONS[t]).toBe('facilitator');
    }
    expect(COMMAND_PERMISSIONS.get_story).toBe('any');
  });
});

describe('story server messages and error codes', () => {
  it('F02-AC11: story detail carries the final round', () => {
    const detail = {
      id: 's1',
      title: 'T',
      link: null,
      hasDescription: true,
      status: 'estimated',
      estimate: '5',
      rev: 2,
      description: 'D',
      finalRound: { number: 2, votes: [{ participantId: 'p1', name: 'Ann', card: '5' }] },
    };
    const r = parseServerMessage(JSON.stringify({ type: 'story', id: '1', story: detail }));
    expect(r.ok).toBe(true);
  });

  it('F02: ack may list new story IDs; older acks still parse', () => {
    expect(parseServerMessage('{"type":"ack","id":"1","version":4,"storyIds":["a","b"]}').ok).toBe(
      true,
    );
    expect(parseServerMessage('{"type":"ack","id":"1","version":4}').ok).toBe(true);
  });

  it('F02: new error codes have HTTP statuses and parse', () => {
    for (const code of [
      'story_limit_reached',
      'unknown_story',
      'no_active_story',
      'no_next_story',
      'invalid_story_state',
      'wrong_story_source',
      'stale_round',
    ] as const) {
      expect(ERROR_CODES).toContain(code);
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(
        parseServerMessage(JSON.stringify({ type: 'error', id: '1', code, fatal: false })).ok,
      ).toBe(true);
    }
  });
});

describe('story source setting (F02-AC1)', () => {
  it('F02-AC1: defaults to topic and can be set through the settings input', () => {
    expect(DEFAULT_SETTINGS.storySource).toBe('topic');
    const input = v.parse(RoomSettingsInputSchema, { storySource: 'stories' });
    expect(applySettings(DEFAULT_SETTINGS, input).storySource).toBe('stories');
    expect(applySettings(DEFAULT_SETTINGS, {}).storySource).toBe('topic');
    expect(v.safeParse(RoomSettingsInputSchema, { storySource: 'jira' }).success).toBe(false);
  });

  it('F02-AC1: an empty stories state is the default for rooms without a list', () => {
    expect(EMPTY_STORIES_STATE.agenda).toEqual([]);
    expect(EMPTY_STORIES_STATE.active).toBeNull();
  });
});

describe('story permissions (F02-AC6)', () => {
  const actor = (id: string, role: Actor['role'] = 'voter'): Actor => ({ id, role, online: true });
  const fac = actor('f');
  const voter = actor('v');
  const observer = actor('o', 'observer');

  it('F02-AC6: only the facilitator manages stories and accepts estimates, in both control modes', () => {
    for (const fn of [canManageStories, canAcceptEstimate, canSelectStory]) {
      expect(fn(fac, 'f')).toBe(true);
      expect(fn(voter, 'f')).toBe(false);
      expect(fn(observer, 'f')).toBe(false);
    }
  });

  it('F02-AC6: in "everyone" mode voters may also start rounds and reveal, observers may not', () => {
    expect(canStartRoundOrReveal(voter, 'f', 'everyone')).toBe(true);
    expect(canStartRoundOrReveal(observer, 'f', 'everyone')).toBe(false);
    expect(canStartRoundOrReveal(voter, 'f', 'facilitator')).toBe(false);
    expect(canStartRoundOrReveal(fac, 'f', 'facilitator')).toBe(true);
  });

  it('F02-AC8: everybody may read a story', () => {
    expect(canViewStory(observer)).toBe(true);
  });
});
