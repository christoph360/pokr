import { afterEach, describe, expect, it, vi } from 'vitest';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import {
  MAX_STORIES,
  SNAPSHOT_MAX_BYTES,
  computeProgress,
  nextStoryId,
  sumEstimates,
  utf8ByteLength,
} from '@pokr/shared';
import { getRoomStub } from '../src/room-stub';
import {
  Client,
  addStories,
  addStory,
  api,
  closeAll,
  env,
  expectAck,
  expectCode,
  roundOf,
  seedStories,
  setTimers,
  setup,
  setupStories,
  sleep,
  storageReport,
} from './helpers';

afterEach(closeAll);

/** A Story list room with a facilitator, Bob (voter) and Obs (observer), three stories A, B, C. */
async function room(settings: Record<string, unknown> = {}) {
  const s = await setupStories(settings);
  const bob = await Client.join(s.id, 'Bob');
  const obs = await Client.join(s.id, 'Obs', 'observer');
  const [a, b, c] = await addStories(s.fac, 'A', 'B', 'C');
  return { ...s, bob, obs, a: a!, b: b!, c: c! };
}

async function select(c: Client, storyId: string, extra: Record<string, unknown> = {}) {
  return c.cmd_({ type: 'select_story', storyId, ...extra });
}

/** Reveal and accept `estimate` for the active story. */
async function accept(c: Client, storyId: string, estimate: string) {
  expectAck(await c.cmd_({ type: 'reveal' }));
  return c.cmd_({ type: 'accept_estimate', storyId, round: roundOf(c), estimate });
}

const row = (c: Client, id: string) => c.rows.find((r) => r.id === id)!;
const detail = async (c: Client, storyId: string) => {
  const from = c.messages.length;
  expectAck(await c.cmd_({ type: 'get_story', storyId }));
  const m = c.messages.slice(from).find((x) => x.type === 'story');
  if (m?.type !== 'story') throw new Error('no story reply');
  return m.story;
};

describe('F02-AC1: story source and idle', () => {
  it('F02-AC1: a Story list room starts idle: vote, reveal and reset are rejected with no_active_story', async () => {
    const { bob, fac } = await room();
    expect(fac.state!.settings.storySource).toBe('stories');
    expect(fac.state!.stories.activeId).toBeNull();
    expectCode(await bob.cmd_({ type: 'vote', card: '5' }), 'no_active_story');
    expectCode(await fac.cmd_({ type: 'reveal' }), 'no_active_story');
    expectCode(await fac.cmd_({ type: 'reset' }), 'no_active_story');
  });

  it('F02-AC1: switching the source keeps the list and estimates, clears the active story, resets the round, keeps the topic', async () => {
    const s = await setup();
    await s.fac.cmd_({ type: 'set_topic', topic: 'Free topic' });
    const [a] = await addStories(s.fac, 'A', 'B');
    const round = roundOf(s.fac);
    expectAck(await s.fac.cmd_({ type: 'update_settings', settings: { storySource: 'stories' } }));
    expect(s.fac.state!.settings.storySource).toBe('stories');
    expect(roundOf(s.fac)).toBe(round + 1);
    expect(s.fac.titles).toEqual(['A', 'B']);
    expectAck(await select(s.fac, a!));
    expectAck(await accept(s.fac, a!, '5'));
    expectAck(await s.fac.cmd_({ type: 'update_settings', settings: { storySource: 'topic' } }));
    expect(s.fac.state!.stories.activeId).toBeNull();
    expect(row(s.fac, a!)).toMatchObject({ estimate: '5', status: 'estimated' });
    expect(s.fac.state!.topic).toBe('Free topic');
    expect(s.fac.state!.stories.progress).toEqual({ estimated: 1, outOf: 2, skipped: 0 });
  });

  it('F02-AC1: switching with an unsaved round needs confirmReset; after an accepted estimate it does not', async () => {
    const { fac, bob, a } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    const r = await fac.cmd_({ type: 'update_settings', settings: { storySource: 'topic' } });
    expectCode(r, 'confirmation_required');
    expect(r.type === 'error' && r.field).toBe('confirmReset');
    expect(fac.state!.settings.storySource).toBe('stories');
    expectAck(await accept(fac, a, '5'));
    expectAck(await fac.cmd_({ type: 'update_settings', settings: { storySource: 'topic' } }));
    expect(fac.state!.settings.storySource).toBe('topic');
    // Free topic mode: any vote makes the round unsaved
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
    const back = await fac.cmd_({ type: 'update_settings', settings: { storySource: 'stories' } });
    expectCode(back, 'confirmation_required');
    expectAck(
      await fac.cmd_({
        type: 'update_settings',
        settings: { storySource: 'stories' },
        confirmReset: true,
      }),
    );
  });

  it('F02-AC1: in Story list mode set_topic and reset with a topic are wrong_story_source; Issue tracker is rejected', async () => {
    const { fac, a } = await room();
    expectCode(await fac.cmd_({ type: 'set_topic', topic: 'x' }), 'wrong_story_source');
    expectAck(await select(fac, a));
    expectCode(await fac.cmd_({ type: 'reset', topic: 'x' }), 'wrong_story_source');
    expectAck(await fac.cmd_({ type: 'reset' }));
    expectCode(
      await fac.cmd_({ type: 'update_settings', settings: { storySource: 'tracker' } }),
      'invalid_input',
    );
  });

  it('F02-AC1: select, next, accept and skip need Story list mode; managing stories works in both modes', async () => {
    const s = await setup(); // Free topic
    const [a] = await addStories(s.fac, 'A', 'B');
    expectCode(await select(s.fac, a!), 'wrong_story_source');
    expectCode(await s.fac.cmd_({ type: 'next_story', round: 1 }), 'wrong_story_source');
    expectCode(
      await s.fac.cmd_({ type: 'accept_estimate', storyId: a, round: 1, estimate: '1' }),
      'wrong_story_source',
    );
    expectCode(
      await s.fac.cmd_({ type: 'skip_story', storyId: a, round: 1 }),
      'wrong_story_source',
    );
    expectAck(await s.fac.cmd_({ type: 'edit_story', storyId: a, title: 'A2' }));
    expectAck(await s.fac.cmd_({ type: 'move_story', storyId: a, beforeId: null }));
    expect(s.fac.titles).toEqual(['B', 'A2']);
  });

  it('F02-AC1: auto-reveal never fires while idle', async () => {
    const { fac, bob, a } = await room({ autoReveal: true });
    expectAck(await select(fac, a));
    // The only voters are Fac and Bob; delete the active story: idle, round fresh and unrevealed
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
    expectAck(await fac.cmd_({ type: 'delete_story', storyId: a, confirmReset: true }));
    expect(fac.state!.round.phase).toBe('voting');
    expectCode(await fac.cmd_({ type: 'vote', card: '3' }), 'no_active_story');
    expect(fac.state!.round.phase).toBe('voting');
  });
});

describe('F02-AC2/AC3: adding stories', () => {
  it('F02-AC2: add a story with title, description and link; ids are server generated; appended', async () => {
    const { fac, bob } = await room();
    const r = await fac.cmd_({
      type: 'add_story',
      title: '  Login   page ',
      description: '# Goal\r\n\r\n- one  ',
      link: ' https://example.com/x ',
    });
    expectAck(r);
    const id = r.type === 'ack' ? r.storyIds![0]! : '';
    expect(id).toMatch(/^[0-9a-z]{12}$/);
    expect(fac.titles).toEqual(['A', 'B', 'C', 'Login page']);
    expect(row(fac, id)).toMatchObject({
      title: 'Login page',
      link: 'https://example.com/x',
      hasDescription: true,
      status: 'pending',
      estimate: null,
      rev: 1,
      tracker: null,
    });
    expect((await detail(bob, id)).description).toBe('# Goal\n\n- one');
    expect(bob.titles).toEqual(fac.titles);
  });

  it('F02-AC2: invalid fields are rejected without echoing the input', async () => {
    const { fac } = await room();
    const secret = 'SeCrEt-text';
    for (const [msg, field] of [
      [{ title: '' }, 'title'],
      [{ title: 'x'.repeat(201) }, 'title'],
      [{ title: 'ok', link: `javascript:alert('${secret}')` }, 'link'],
      [{ title: 'ok', link: 'https://u:p@example.com' }, 'link'],
      [{ title: 'ok', description: 'a'.repeat(5001) }, 'description'],
      [{ title: `bad\u0000${secret}` }, 'title'],
    ] as const) {
      const r = await fac.cmd_({ type: 'add_story', ...msg });
      expectCode(r, 'invalid_input');
      expect(r.type === 'error' && r.field).toBe(field);
      expect(JSON.stringify(r)).not.toContain(secret);
    }
    expect(fac.titles).toEqual(['A', 'B', 'C']);
  });

  it('F02-AC3: bulk add is all or nothing and reports the line without content', async () => {
    const { fac } = await room();
    const ids = await addStories(fac, 'D', 'E', '  F  ');
    expect(ids).toHaveLength(3);
    expect(fac.titles).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    const version = fac.state!.version;
    const bad = await fac.cmd_({ type: 'add_stories', text: `ok\n\n${'y'.repeat(300)}\nfine` });
    expectCode(bad, 'invalid_input');
    expect(bad.type === 'error' && bad.field).toBe('text.3');
    expect(JSON.stringify(bad)).not.toContain('yyyy');
    expect(fac.state!.version).toBe(version);
    expect(fac.titles).toHaveLength(6);
    expectCode(await fac.cmd_({ type: 'add_stories', text: '  \n \n' }), 'invalid_input');
  });

  it('F02-AC3: 100 lines are accepted in one message, 101 are not', async () => {
    const { fac } = await room();
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`).join('\n');
    expectCode(await fac.cmd_({ type: 'add_stories', text: lines(101) }), 'invalid_input');
    const ok = await fac.cmd_({ type: 'add_stories', text: lines(100) });
    expectAck(ok);
    expect(ok.type === 'ack' && ok.storyIds).toHaveLength(100);
    expect(fac.rows).toHaveLength(103);
  });

  it('F02-AC5: a room holds at most 200 stories; the failing add changes nothing', async () => {
    const s = await setupStories();
    const res = await seedStories(s.id, { count: 199 });
    expect(res.status).toBe(201);
    await s.fac.waitForState((st) => st.stories.progress.outOf === 199);
    expectAck(await s.fac.cmd_({ type: 'add_story', title: 'last' }));
    const version = s.fac.state!.version;
    expectCode(
      await s.fac.cmd_({ type: 'add_story', title: 'one too many' }),
      'story_limit_reached',
    );
    expectCode(await s.fac.cmd_({ type: 'add_stories', text: 'a\nb' }), 'story_limit_reached');
    expect(s.fac.state!.version).toBe(version);
    expect(s.fac.rows).toHaveLength(MAX_STORIES);
    expect((await seedStories(s.id, { count: 1 })).status).toBe(409);
  });

  it('F02-AC5: a bulk add that would exceed 200 stories is rejected as a whole', async () => {
    const s = await setupStories();
    await seedStories(s.id, { count: 150 });
    await s.fac.waitForState((st) => st.stories.progress.outOf === 150);
    const text = Array.from({ length: 60 }, (_, i) => `n${i}`).join('\n');
    expectCode(await s.fac.cmd_({ type: 'add_stories', text }), 'story_limit_reached');
    expect(s.fac.rows).toHaveLength(150);
  });
});

describe('F02-AC4: edit, delete, reorder', () => {
  it('F02-AC4: edit changes only the given fields, bumps rev, and never touches rounds or votes (also the active story)', async () => {
    const { fac, bob, a } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '8' }));
    const round = roundOf(fac);
    expectAck(
      await fac.cmd_({
        type: 'edit_story',
        storyId: a,
        title: 'A!',
        description: 'desc',
        link: 'http://x.io',
      }),
    );
    expect(row(fac, a)).toMatchObject({
      title: 'A!',
      link: 'http://x.io',
      hasDescription: true,
      rev: 2,
    });
    expect(fac.held!.activeDescription).toBe('desc');
    expect(roundOf(fac)).toBe(round);
    expect(fac.state!.participants.find((p) => p.name === 'Bob')!.hasVoted).toBe(true);
    expectAck(await fac.cmd_({ type: 'edit_story', storyId: a, title: 'A!!' }));
    expect(row(fac, a)).toMatchObject({
      title: 'A!!',
      hasDescription: true,
      link: 'http://x.io',
      rev: 3,
    });
    expectAck(await fac.cmd_({ type: 'edit_story', storyId: a, description: '', link: '' }));
    expect(row(fac, a)).toMatchObject({ hasDescription: false, link: null, rev: 4 });
    expect(fac.held!.activeDescription).toBe('');
  });

  it('F02-AC4: an edit that changes nothing, or has no field, is a no-op or invalid; unknown stories are rejected', async () => {
    const { fac, a } = await room();
    const v = fac.state!.version;
    expectAck(await fac.cmd_({ type: 'edit_story', storyId: a, title: 'A' }));
    expect(fac.state!.version).toBe(v);
    expect(row(fac, a).rev).toBe(1);
    expectCode(await fac.cmd_({ type: 'edit_story', storyId: a }), 'invalid_input');
    expectCode(
      await fac.cmd_({ type: 'edit_story', storyId: 'nope', title: 'x' }),
      'unknown_story',
    );
  });

  it('F02-AC4: delete needs confirmDelete for an estimated story and confirmReset for an active story with an unsaved round', async () => {
    const { fac, bob, a, c } = await room();
    expectAck(await fac.cmd_({ type: 'delete_story', storyId: c })); // pending: no confirmation
    expect(fac.titles).toEqual(['A', 'B']);
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    const unsaved = await fac.cmd_({ type: 'delete_story', storyId: a });
    expectCode(unsaved, 'confirmation_required');
    expect(unsaved.type === 'error' && unsaved.field).toBe('confirmReset');
    expectAck(await accept(fac, a, '5'));
    const estimated = await fac.cmd_({ type: 'delete_story', storyId: a });
    expectCode(estimated, 'confirmation_required');
    expect(estimated.type === 'error' && estimated.field).toBe('confirmDelete');
    expect(row(fac, a)).toBeDefined();
    const round = roundOf(fac);
    expectAck(await fac.cmd_({ type: 'delete_story', storyId: a, confirmDelete: true }));
    expect(fac.titles).toEqual(['B']);
    // deleting the active story leaves the room idle with a fresh round
    expect(fac.state!.stories.activeId).toBeNull();
    expect(roundOf(fac)).toBe(round + 1);
    expectCode(await fac.cmd_({ type: 'vote', card: '1' }), 'no_active_story');
    expectCode(await fac.cmd_({ type: 'delete_story', storyId: a }), 'unknown_story');
  });

  it('F02-AC4: reordering is relative; stale ids are rejected and never applied to another story', async () => {
    const { fac, bob, a, b, c } = await room();
    expectAck(await fac.cmd_({ type: 'move_story', storyId: c, beforeId: a }));
    expect(fac.titles).toEqual(['C', 'A', 'B']);
    expectAck(await fac.cmd_({ type: 'move_story', storyId: c, beforeId: null }));
    expect(fac.titles).toEqual(['A', 'B', 'C']);
    const v = fac.state!.version;
    expectAck(await fac.cmd_({ type: 'move_story', storyId: b, beforeId: c })); // already there
    expectAck(await fac.cmd_({ type: 'move_story', storyId: b, beforeId: b }));
    expect(fac.state!.version).toBe(v);
    expectAck(await fac.cmd_({ type: 'delete_story', storyId: b }));
    const stale = await fac.cmd_({ type: 'move_story', storyId: a, beforeId: b });
    expectCode(stale, 'unknown_story');
    expect(stale.type === 'error' && stale.field).toBe('beforeId');
    expectCode(await fac.cmd_({ type: 'move_story', storyId: b, beforeId: null }), 'unknown_story');
    expect(fac.titles).toEqual(['A', 'C']);
    expect(bob.titles).toEqual(['A', 'C']);
  });

  it('F02-AC4: many moves between the same neighbours keep the order (positions are renumbered when the gap is used up)', async () => {
    const s = await setupStories();
    const ids = await addStories(s.fac, 'A', 'B', 'C');
    // C before B, then B before C, ...: the gap between the neighbours halves every time
    for (let i = 0; i < 16; i++) {
      const [moved, before] = i % 2 === 0 ? [ids[2], ids[1]] : [ids[1], ids[2]];
      expectAck(await s.fac.cmd_({ type: 'move_story', storyId: moved, beforeId: before }));
      expect(s.fac.titles).toEqual(i % 2 === 0 ? ['A', 'C', 'B'] : ['A', 'B', 'C']);
    }
    expect(s.fac.titles).toEqual(['A', 'B', 'C']);
  });

  it('F02-AC4: moving never changes the active story or the round', async () => {
    const { fac, bob, a, c } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
    const round = roundOf(fac);
    expectAck(await fac.cmd_({ type: 'move_story', storyId: a, beforeId: null }));
    expect(fac.state!.stories.activeId).toBe(a);
    expect(roundOf(fac)).toBe(round);
    expect(fac.state!.participants.find((p) => p.name === 'Bob')!.hasVoted).toBe(true);
    void c;
  });
});

describe('F02-AC6: permissions', () => {
  const asVoter = async (control: 'facilitator' | 'everyone') => {
    const r = await room({ controlMode: control });
    return r;
  };

  it('F02-AC6: voters and observers cannot manage stories or accept estimates, in both control modes', async () => {
    for (const control of ['facilitator', 'everyone'] as const) {
      const { bob, obs, a, fac } = await asVoter(control);
      expectAck(await select(fac, a));
      for (const c of [bob, obs]) {
        const round = roundOf(fac);
        for (const msg of [
          { type: 'add_story', title: 'x' },
          { type: 'add_stories', text: 'x' },
          { type: 'edit_story', storyId: a, title: 'x' },
          { type: 'delete_story', storyId: a, confirmReset: true, confirmDelete: true },
          { type: 'move_story', storyId: a, beforeId: null },
          { type: 'select_story', storyId: a },
          { type: 'next_story', round },
          { type: 'accept_estimate', storyId: a, round, estimate: '5' },
          { type: 'skip_story', storyId: a, round },
          { type: 'restore_story', storyId: a },
        ]) {
          expectCode(await c.cmd_(msg), 'not_allowed');
        }
      }
      expect(fac.titles).toEqual(['A', 'B', 'C']);
    }
  });

  it('F02-AC6: in "everyone" mode voters (not observers) may reveal and reset the active story', async () => {
    const { bob, obs, a, fac } = await asVoter('everyone');
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectCode(await obs.cmd_({ type: 'reveal' }), 'not_allowed');
    expectAck(await bob.cmd_({ type: 'reveal' }));
    expect(fac.state!.round.phase).toBe('revealed');
    expectCode(
      await bob.cmd_({ type: 'accept_estimate', storyId: a, round: roundOf(fac), estimate: '5' }),
      'not_allowed',
    );
    expectAck(await bob.cmd_({ type: 'reset' }));
    expect(fac.state!.round.phase).toBe('voting');
    expect(fac.state!.stories.activeId).toBe(a);
  });

  it('F02-AC6: permission is checked when the command is processed: a command sent before a handover is rejected', async () => {
    const { fac, bob, a } = await room();
    // handover then immediately a story command from the former facilitator, same tick
    fac.send({ type: 'hand_over', id: 'h', participantId: bob.participantId });
    fac.send({ type: 'select_story', id: 's', storyId: a });
    const r = await fac.waitFor((m) => (m.type === 'ack' || m.type === 'error') && m.id === 's');
    expectCode(r, 'not_allowed');
    expect(fac.state!.stories.activeId).toBeNull();
    expectAck(await select(bob, a)); // the new facilitator may
  });
});

describe('F02-AC7/AC9: selecting and Next', () => {
  it('F02-AC7: select makes the story active for everyone and starts a new round; the active story again is a no-op', async () => {
    const { fac, bob, a, b } = await room();
    const round = roundOf(fac);
    expectAck(await select(fac, a));
    expect(bob.state!.stories.activeId).toBe(a);
    expect(roundOf(bob)).toBe(round + 1);
    const v = fac.state!.version;
    expectAck(await select(fac, a));
    expect(fac.state!.version).toBe(v);
    expectCode(await select(fac, 'nope'), 'unknown_story');
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    const sw = await select(fac, b);
    expectCode(sw, 'confirmation_required');
    expect(sw.type === 'error' && sw.field).toBe('confirmReset');
    expect(fac.state!.stories.activeId).toBe(a);
    expectAck(await select(fac, b, { confirmReset: true }));
    expect(fac.state!.stories.activeId).toBe(b);
    expect(fac.state!.participants.every((p) => !p.hasVoted)).toBe(true);
    expect(roundOf(fac)).toBe(round + 2);
  });

  it('F02-AC7: a revealed round with an accepted estimate does not need confirmReset; without one it does', async () => {
    const { fac, bob, a, b, c } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectAck(await fac.cmd_({ type: 'reveal' }));
    expectCode(await select(fac, b), 'confirmation_required');
    expectAck(
      await fac.cmd_({ type: 'accept_estimate', storyId: a, round: roundOf(fac), estimate: '5' }),
    );
    expectAck(await select(fac, b)); // saved
    expectAck(await bob.cmd_({ type: 'vote', card: '2' }));
    expectAck(await select(fac, c, { confirmReset: true }));
  });

  it('F02-AC9: Next picks the first pending story after the active one, wraps, never picks skipped or estimated ones', async () => {
    const { fac, a, b, c } = await room();
    const next = async (extra: Record<string, unknown> = {}) =>
      fac.cmd_({ type: 'next_story', round: roundOf(fac), ...extra });
    expectAck(await next()); // none active: first pending
    expect(fac.state!.stories.activeId).toBe(a);
    expectAck(await fac.cmd_({ type: 'skip_story', storyId: b, round: roundOf(fac) }));
    expectAck(await next());
    expect(fac.state!.stories.activeId).toBe(c);
    expectAck(await next()); // wraps to a (pending, before c)
    expect(fac.state!.stories.activeId).toBe(a);
    expect(nextStoryId(fac.rows, fac.state!.stories.activeId)).toBe(c);
  });

  it('F02-AC9: with nothing pending left Next is no_next_story and changes nothing; a stale round is stale_round', async () => {
    const { fac, a, b, c } = await room();
    expectAck(await select(fac, a));
    expectAck(await fac.cmd_({ type: 'skip_story', storyId: b, round: roundOf(fac) }));
    expectAck(await fac.cmd_({ type: 'skip_story', storyId: c, round: roundOf(fac) }));
    const v = fac.state!.version;
    const stale = await fac.cmd_({ type: 'next_story', round: roundOf(fac) - 1 });
    expectCode(stale, 'stale_round');
    expect(stale.type === 'error' && stale.field).toBe('round');
    expectCode(await fac.cmd_({ type: 'next_story', round: roundOf(fac) }), 'no_next_story');
    expect(fac.state!.version).toBe(v);
    expect(fac.state!.stories.activeId).toBe(a);
  });

  it('F02-AC9: Next with an unsaved round needs confirmReset', async () => {
    const { fac, bob, a } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectCode(
      await fac.cmd_({ type: 'next_story', round: roundOf(fac) }),
      'confirmation_required',
    );
    expectAck(await fac.cmd_({ type: 'next_story', round: roundOf(fac), confirmReset: true }));
    expect(fac.state!.stories.activeId).not.toBe(a);
  });
});

describe('F02-AC8: the active story in the snapshot', () => {
  it('F02-AC8: everyone gets the active story row and its description; other descriptions come from get_story', async () => {
    const { fac, bob, obs, a, b } = await room();
    expectAck(
      await fac.cmd_({
        type: 'edit_story',
        storyId: a,
        description: 'Active *text*',
        link: 'https://e.io',
      }),
    );
    expectAck(await fac.cmd_({ type: 'edit_story', storyId: b, description: 'Other' }));
    expectAck(await select(fac, a));
    for (const c of [fac, bob, obs]) {
      expect(c.held!.activeDescription).toBe('Active *text*');
      expect(row(c, a)).toMatchObject({ link: 'https://e.io', hasDescription: true });
      expect(JSON.stringify(c.held)).not.toContain('Other'); // never in the agenda
    }
    const d = await detail(obs, b);
    expect(d).toMatchObject({ id: b, description: 'Other', finalRound: null });
    expectCode(await obs.cmd_({ type: 'get_story', storyId: 'nope' }), 'unknown_story');
  });
});

describe('F02-AC10/AC11/AC12: final estimate', () => {
  it('F02-AC10: accept needs the facilitator, an active story, a revealed round, the current round id and a value card', async () => {
    const { fac, bob, a, b } = await room();
    const acc = (storyId: string, round: number, estimate: string) =>
      fac.cmd_({ type: 'accept_estimate', storyId, round, estimate });
    expectCode(await acc(a, 1, '5'), 'no_active_story'); // idle
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectCode(await acc(a, roundOf(fac), '5'), 'round_not_revealed');
    expectAck(await fac.cmd_({ type: 'reveal' }));
    expectCode(await acc(a, roundOf(fac) - 1, '5'), 'stale_round');
    expectCode(await acc(b, roundOf(fac), '5'), 'invalid_story_state');
    expectCode(await acc('nope', roundOf(fac), '5'), 'unknown_story');
    expectCode(await acc(a, roundOf(fac), '?'), 'invalid_card');
    expectCode(await acc(a, roundOf(fac), '☕'), 'invalid_card');
    expectCode(await acc(a, roundOf(fac), '4'), 'invalid_card');
    expectAck(await acc(a, roundOf(fac), '½'));
    expect(row(fac, a).estimate).toBe('½');
  });

  it('F02-AC10: a revealed round without votes can be accepted', async () => {
    const { fac, a } = await room();
    expectAck(await select(fac, a));
    expectAck(await accept(fac, a, '3'));
    expect(row(fac, a)).toMatchObject({ estimate: '3', status: 'estimated' });
    expect((await detail(fac, a)).finalRound).toMatchObject({ votes: [] });
  });

  it('F02-AC11: accept stores the estimate and a final round snapshot; the round and story stay put; accepting again overwrites', async () => {
    const { fac, bob, a } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectAck(await fac.cmd_({ type: 'vote', card: '8' }));
    const r = await accept(fac, a, '8');
    expectAck(r);
    expect(fac.state!.round.phase).toBe('revealed'); // accept does not change the round (F01-AC18)
    expect(fac.state!.stories.activeId).toBe(a);
    expect(fac.state!.stories.acceptedRound).toBe(roundOf(fac));
    expect(row(bob, a)).toMatchObject({ estimate: '8', status: 'estimated' });
    const d = await detail(bob, a); // everyone can read it
    expect(d.finalRound).toEqual({
      number: roundOf(fac),
      votes: expect.arrayContaining([
        { participantId: fac.participantId, name: 'Fac', card: '8' },
        { participantId: bob.participantId, name: 'Bob', card: '5' },
      ]),
    });
    expectAck(
      await fac.cmd_({ type: 'accept_estimate', storyId: a, round: roundOf(fac), estimate: '5' }),
    );
    expect(row(fac, a).estimate).toBe('5');
    // a rename does not change the snapshot
    expectAck(await bob.cmd_({ type: 'rename', name: 'Robert' }));
    expect((await detail(fac, a)).finalRound!.votes.map((v) => v.name).sort()).toEqual([
      'Bob',
      'Fac',
    ]);
  });

  it('F02-AC11: removing a participant erases their name in every snapshot and keeps the vote', async () => {
    const { fac, bob, a, id } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectAck(await accept(fac, a, '5'));
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: bob.participantId }));
    const votes = (await detail(fac, a)).finalRound!.votes;
    expect(votes).toContainEqual({ participantId: bob.participantId, name: null, card: '5' });
    const stored = await storageReport(id);
    expect(JSON.stringify(stored.finalRounds)).not.toContain('Bob');
  });

  it('F02-AC11: a vote of a participant removed after the reveal is in the snapshot without a name', async () => {
    const { fac, bob, a } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '3' }));
    expectAck(await fac.cmd_({ type: 'reveal' }));
    expectAck(await fac.cmd_({ type: 'remove_participant', participantId: bob.participantId }));
    expectAck(
      await fac.cmd_({ type: 'accept_estimate', storyId: a, round: roundOf(fac), estimate: '3' }),
    );
    expect((await detail(fac, a)).finalRound!.votes).toEqual([
      { participantId: bob.participantId, name: null, card: '3' },
    ]);
  });

  it('F02-AC12: re-voting an estimated story keeps its estimate and final round until a new one is accepted', async () => {
    const { fac, bob, a, b } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectAck(await accept(fac, a, '5'));
    expectAck(await select(fac, b));
    expectAck(await select(fac, a)); // re-vote by selecting
    expect(row(fac, a)).toMatchObject({ estimate: '5', status: 'estimated' });
    expect(fac.state!.stories.activeId).toBe(a);
    expect(fac.state!.stories.acceptedRound).toBeNull();
    expect((await detail(fac, a)).finalRound!.votes).toHaveLength(2 - 1);
    expectAck(await bob.cmd_({ type: 'vote', card: '13' }));
    expectAck(await fac.cmd_({ type: 'reset' })); // re-vote by reset keeps it too
    expect(row(fac, a).estimate).toBe('5');
    expectAck(await bob.cmd_({ type: 'vote', card: '13' }));
    expectAck(await accept(fac, a, '13'));
    expect(row(fac, a).estimate).toBe('13');
    expect((await detail(fac, a)).finalRound!.votes).toContainEqual(
      expect.objectContaining({ card: '13' }),
    );
    expect(fac.state!.stories.progress.estimated).toBe(1);
  });
});

describe('F02-AC13: skip and restore', () => {
  it('F02-AC13: skip a pending story, restore it, and select a skipped one', async () => {
    const { fac, a, b } = await room();
    expectAck(await fac.cmd_({ type: 'skip_story', storyId: a, round: roundOf(fac) }));
    expect(row(fac, a).status).toBe('skipped');
    expect(fac.state!.stories.progress).toEqual({ estimated: 0, outOf: 2, skipped: 1 });
    expectCode(
      await fac.cmd_({ type: 'skip_story', storyId: a, round: roundOf(fac) }),
      'invalid_story_state',
    );
    expectAck(await fac.cmd_({ type: 'restore_story', storyId: a }));
    expect(row(fac, a).status).toBe('pending');
    expectCode(await fac.cmd_({ type: 'restore_story', storyId: a }), 'invalid_story_state');
    expectAck(await fac.cmd_({ type: 'skip_story', storyId: b, round: roundOf(fac) }));
    expectAck(await select(fac, b)); // skipped stories can be selected ...
    expectAck(await accept(fac, b, '2')); // ... and estimated
    expect(row(fac, b)).toMatchObject({ status: 'estimated', estimate: '2' });
  });

  it('F02-AC13: an estimated story cannot be skipped; skip needs the current round id', async () => {
    const { fac, a } = await room();
    expectAck(await select(fac, a));
    expectAck(await accept(fac, a, '3'));
    expectCode(
      await fac.cmd_({ type: 'skip_story', storyId: a, round: roundOf(fac) }),
      'invalid_story_state',
    );
    expectCode(await fac.cmd_({ type: 'skip_story', storyId: a, round: 99 }), 'stale_round');
  });

  it('F02-AC13: skipping the active story discards its round and leaves the room idle; with advance the next story is active in one step', async () => {
    const { fac, bob, a, b, c } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    const unsaved = await fac.cmd_({ type: 'skip_story', storyId: a, round: roundOf(fac) });
    expectCode(unsaved, 'confirmation_required');
    expect(unsaved.type === 'error' && unsaved.field).toBe('confirmReset');
    const round = roundOf(fac);
    expectAck(await fac.cmd_({ type: 'skip_story', storyId: a, round, confirmReset: true }));
    expect(fac.state!.stories.activeId).toBeNull();
    expect(roundOf(fac)).toBe(round + 1);
    expectAck(await select(fac, b));
    expectAck(
      await fac.cmd_({ type: 'skip_story', storyId: b, round: roundOf(fac), advance: true }),
    );
    expect(fac.state!.stories.activeId).toBe(c);
    expectAck(
      await fac.cmd_({ type: 'skip_story', storyId: c, round: roundOf(fac), advance: true }),
    );
    expect(fac.state!.stories.activeId).toBeNull(); // nothing pending is left: idle, no error
  });
});

describe('F02-AC14/AC15: progress and sum', () => {
  it('F02-AC14/AC15: progress and sum follow the estimates; the shared helpers agree with the server', async () => {
    const { fac, a, b, c } = await room();
    expectAck(await select(fac, a));
    expectAck(await accept(fac, a, '½'));
    expectAck(await select(fac, b));
    expectAck(await accept(fac, b, '3'));
    expectAck(await fac.cmd_({ type: 'skip_story', storyId: c, round: roundOf(fac) }));
    const st = fac.state!.stories;
    expect(st.progress).toEqual({ estimated: 2, outOf: 2, skipped: 1 });
    expect(st.progress).toEqual(computeProgress(fac.rows));
    expect(st.sum).toEqual({ value: '3.5', excluded: 0 });
    expect(st.sum).toEqual(sumEstimates(fac.state!.settings.deck, fac.rows));
  });

  it('F02-AC15: no sum on a non-numeric deck; after a deck change estimates that are not numbers are excluded', async () => {
    const { fac, a, b } = await room({ deck: { id: 'tshirt' } });
    expectAck(await select(fac, a));
    expectAck(await accept(fac, a, 'M'));
    expect(fac.state!.stories.sum).toEqual({ value: null, excluded: 0 });
    expectAck(
      await fac.cmd_({
        type: 'update_settings',
        settings: { deck: { id: 'fibonacci' } },
        confirmReset: true,
      }),
    );
    expect(fac.state!.stories.sum).toEqual({ value: null, excluded: 1 });
    expectAck(await select(fac, b));
    expectAck(await accept(fac, b, '5'));
    expect(fac.state!.stories.sum).toEqual({ value: '5', excluded: 1 });
    expect(row(fac, a).estimate).toBe('M'); // kept as text
  });

  it('F02-AC21: a deck change keeps the F01-AC28 rule: confirmation whenever the round has votes, also after an accept', async () => {
    const { fac, bob, a } = await room();
    expectAck(await select(fac, a));
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    expectAck(await accept(fac, a, '5'));
    const r = await fac.cmd_({ type: 'update_settings', settings: { deck: { id: 'tshirt' } } });
    expectCode(r, 'confirmation_required');
    expectAck(
      await fac.cmd_({
        type: 'update_settings',
        settings: { deck: { id: 'tshirt' } },
        confirmReset: true,
      }),
    );
    expect(row(fac, a).estimate).toBe('5');
    expect(fac.state!.stories.activeId).toBe(a);
  });
});

describe('F02-AC16: agenda sync and size', () => {
  it('F02-AC16: join, rejoin and resync carry the agenda', async () => {
    const { fac, id, a } = await room();
    expectAck(await select(fac, a));
    const late = await Client.join(id, 'Late');
    const first = late.stateFrames()[0]!;
    expect(first.stories['agenda']).toBeDefined();
    expect(late.titles).toEqual(['A', 'B', 'C']);
    expect(late.held!.activeDescription).toBe('');
    const again = await Client.rejoin(id, late.token);
    void again;
    const back = await Client.connect(id);
    back.send({ type: 'rejoin', token: fac.token });
    await back.waitFor((m) => m.type === 'state');
    expect(back.stateFrames()[0]!.stories['agenda']).toBeDefined();
    const from = late.frames.length;
    expectAck(await late.cmd_({ type: 'resync' }));
    const frames = late.frames.slice(from).filter((f) => f.startsWith('{"type":"state"'));
    expect(frames).toHaveLength(1);
    expect(JSON.parse(frames[0]!).state.stories.agenda.rows).toHaveLength(3);
    // order: state, then ack
    expect(late.frames.at(-1)).toContain('"type":"ack"');
  });

  it('F02-AC16: votes, reveal and presence broadcasts do not carry the agenda; story changes do', async () => {
    const { fac, bob, a, id } = await room();
    expectAck(await select(fac, a));
    const mark = fac.frames.length;
    expectAck(await bob.cmd_({ type: 'vote', card: '5' })); // vote
    expectAck(await fac.cmd_({ type: 'reveal' })); // reveal
    expectAck(await bob.cmd_({ type: 'set_role', role: 'observer' })); // role change
    const extra = await Client.join(id, 'Pat'); // presence: a join
    extra.close();
    await sleep(600); // clean close -> offline after the grace period
    const frames = fac.stateFrames().slice(-5);
    const sinceMark = fac.frames.slice(mark).filter((f) => f.startsWith('{"type":"state"'));
    expect(sinceMark.length).toBeGreaterThanOrEqual(4);
    for (const f of sinceMark) {
      const j = JSON.parse(f);
      expect(j.state.stories.agenda).toBeUndefined();
      expect(f.length).toBeLessThan(3000);
      expect(j.state.stories.agendaVersion).toBe(fac.held!.version);
    }
    void frames;
    // a story change carries it, to everyone
    const before = fac.held!.version;
    expectAck(await fac.cmd_({ type: 'edit_story', storyId: a, title: 'A2' }));
    const last = JSON.parse(bob.frames.filter((f) => f.startsWith('{"type":"state"')).at(-1)!);
    expect(last.state.stories.agenda.rows[0].title).toBe('A2');
    expect(last.state.stories.agendaVersion).toBeGreaterThan(before);
    // a plain reset of the same story does not
    expectAck(await fac.cmd_({ type: 'reset' }));
    const reset = JSON.parse(bob.frames.filter((f) => f.startsWith('{"type":"state"')).at(-1)!);
    expect(reset.state.stories.agenda).toBeUndefined();
    expect(fac.resyncs).toBe(0);
    expect(bob.resyncs).toBe(0);
  });

  it('F02-AC16: a stale-version state without agenda makes the client rule ask for a resync, and resync repairs it', async () => {
    const { fac, id } = await room();
    const late = await Client.join(id, 'Late');
    late.held = null; // simulate a client that lost its agenda
    expectAck(await fac.cmd_({ type: 'set_role', role: 'observer' }));
    await sleep(100);
    expect(late.resyncs).toBeGreaterThan(0);
    expectAck(await late.cmd_({ type: 'resync' }));
    expect(late.titles).toEqual(['A', 'B', 'C']);
  });

  it('F02-AC16: the join snapshot with 200 maximum-length stories is at most 1 MiB; a vote broadcast is small', async () => {
    const s = await setupStories();
    const seeded = await seedStories(s.id, {
      count: 200,
      titleLength: 200,
      emoji: true,
      descriptionLength: 5000,
      linkLength: 2048,
      estimated: 100,
      skipped: 20,
    });
    expect(seeded.status).toBe(201);
    await s.fac.waitForState((st) => st.stories.progress.outOf === 180);
    const bob = await Client.join(s.id, 'Bob');
    const join = bob.stateFrames()[0]!;
    expect(join.stories['agenda']).toBeDefined();
    expect(bob.rows).toHaveLength(200);
    expect(utf8ByteLength(bob.frames.find((f) => f.startsWith('{"type":"state"'))!)).toBeLessThan(
      SNAPSHOT_MAX_BYTES,
    );
    expectAck(await select(s.fac, bob.rows[0]!.id));
    const active = bob.held!.activeDescription;
    expect(utf8ByteLength(active)).toBe(20000); // 5,000 emoji
    // a join snapshot with a maximum-length active description is still below 1 MiB
    const late = await Client.join(s.id, 'Late');
    expect(utf8ByteLength(late.frames.find((f) => f.startsWith('{"type":"state"'))!)).toBeLessThan(
      SNAPSHOT_MAX_BYTES,
    );
    const mark = s.fac.frames.length;
    expectAck(await bob.cmd_({ type: 'vote', card: '5' }));
    const vote = s.fac.frames.slice(mark).find((f) => f.startsWith('{"type":"state"'))!;
    expect(vote.length).toBeLessThan(3000);
  });

  it('F02-AC16: one storage row per story, each below the 2 MB row limit', async () => {
    const s = await setupStories();
    await seedStories(s.id, { count: 5, descriptionLength: 5000, emoji: true, estimated: 2 });
    await s.fac.waitForState((st) => st.stories.progress.outOf === 5);
    const report = await storageReport(s.id);
    const rows = report.entries.filter((e) => e.key.startsWith('stories/'));
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r.bytes).toBeLessThan(2_000_000);
    expect(report.finalRounds).toHaveLength(2);
    expect(report.entries.some((e) => e.key === 'story_meta/1')).toBe(true);
  });
});

describe('F02-AC17: persistence', () => {
  async function populated() {
    const r = await room();
    expectAck(await select(r.fac, r.a));
    expectAck(await r.bob.cmd_({ type: 'vote', card: '5' }));
    expectAck(await accept(r.fac, r.a, '5'));
    expectAck(
      await r.fac.cmd_({
        type: 'edit_story',
        storyId: r.b,
        description: 'Persisted *md*',
        link: 'https://e.io',
      }),
    );
    return r;
  }

  const check = async (c: Client, r: Awaited<ReturnType<typeof populated>>) => {
    const s = c.state!;
    expect(s.stories.activeId).toBe(r.a);
    expect(s.stories.acceptedRound).toBe(s.round.number);
    expect(c.titles).toEqual(['A', 'B', 'C']);
    expect(row(c, r.a)).toMatchObject({ estimate: '5', status: 'estimated' });
    expect(row(c, r.b)).toMatchObject({ hasDescription: true, link: 'https://e.io', rev: 2 });
    expect((await detail(c, r.b)).description).toBe('Persisted *md*');
    expect((await detail(c, r.a)).finalRound!.votes).toContainEqual(
      expect.objectContaining({ name: 'Bob', card: '5' }),
    );
    expect(s.settings.storySource).toBe('stories');
  };

  it('F02-AC17: real hibernation keeps the agenda, active story, accepted round, round id and final rounds', async () => {
    const r = await populated();
    const version = r.fac.held!.version;
    await evictDurableObject(getRoomStub(env, r.id));
    await check(r.fac, r);
    expect(r.fac.held!.version).toBe(version);
    expectAck(await r.fac.cmd_({ type: 'edit_story', storyId: r.c, title: 'C2' }));
    expect(r.fac.held!.version).toBeGreaterThan(version); // monotonic across eviction
  });

  it('F02-AC17: drop_memory and abort keep everything; rejoin gets the agenda back', async () => {
    const r = await populated();
    await api(`/api/__test/rooms/${r.id}/evict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'drop_memory' }),
    });
    await check(r.bob, r);
    await api(`/api/__test/rooms/${r.id}/evict`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'abort' }),
    });
    await r.fac.waitForClose();
    const back = await Client.rejoin(r.id, r.room.token);
    await check(back, r);
  });

  it('F02-AC17: a room stored before F02 (no storySource, no story tables) works with explicit defaults', async () => {
    const s = await setup();
    await runInDurableObject(getRoomStub(env, s.id), (_i, state) => {
      state.storage.sql.exec("UPDATE room SET settings = json_remove(settings, '$.storySource')");
      state.storage.sql.exec('DROP TABLE IF EXISTS stories');
      state.storage.sql.exec('DROP TABLE IF EXISTS story_meta');
    });
    await evictDurableObject(getRoomStub(env, s.id));
    const back = await Client.rejoin(s.id, s.room.token);
    expect(back.state!.settings.storySource).toBe('topic');
    expect(back.state!.stories).toMatchObject({ agendaVersion: 0, activeId: null });
    expect(back.rows).toEqual([]);
    const id = await addStory(back, 'First story');
    expect(back.titles).toEqual(['First story']);
    expect(id).toBeTruthy();
  });
});

describe('F02-AC18: no story content in logs or errors', () => {
  it('F02-AC18: titles, descriptions, links, estimates and snapshot names never reach the logs', async () => {
    const logs: string[] = [];
    const capture = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    const spies = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    spies.forEach((spy) => spy.mockImplementation(capture));
    try {
      const r = await setupStories({ deck: { id: 'custom', cards: ['q7x1', 'w2e9'] } });
      const bob = await Client.join(r.id, 'Zebulon-Quux');
      const id = await addStory(r.fac, 'TitleNeedle9', {
        description: 'DescriptionNeedle9',
        link: 'https://example.com/LinkNeedle9',
      });
      await addStories(r.fac, 'BulkNeedle9a', 'BulkNeedle9b');
      expectAck(await select(r.fac, id));
      expectAck(await bob.cmd_({ type: 'vote', card: 'q7x1' }));
      expectAck(await accept(r.fac, id, 'q7x1'));
      expectCode(
        await r.fac.cmd_({ type: 'edit_story', storyId: id, link: 'ftp://LinkNeedle9' }),
        'invalid_input',
      );
      expectAck(await r.fac.cmd_({ type: 'remove_participant', participantId: bob.participantId }));
      await seedStories(r.id, { count: 2, estimated: 1 });
      await storageReport(r.id);
      await sleep(50);
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
    const all = logs.join('\n');
    for (const needle of [
      'TitleNeedle9',
      'DescriptionNeedle9',
      'LinkNeedle9',
      'BulkNeedle9',
      'Zebulon',
      'q7x1',
      'w2e9',
    ]) {
      expect(all).not.toContain(needle);
    }
  });
});

describe('F02-AC20: rate limits', () => {
  it('F02-AC20: a bulk add of 100 maximum-length lines is one message and fits the frame limit', async () => {
    const { fac } = await room();
    const text = Array.from(
      { length: 100 },
      (_, i) => `${i}`.padEnd(200, '😀').slice(0, 2) + '😀'.repeat(198),
    ).join('\n');
    const ok = await fac.cmd_({ type: 'add_stories', text });
    expectAck(ok);
    expect(fac.rows).toHaveLength(103);
  });
});

describe('F02: rounds and purge', () => {
  it('F02-AC7: every command that starts a round counts as a reset for the F01-AC21 purge', async () => {
    const { fac, id, a, b } = await room();
    await setTimers(id, { offlinePurgeMs: 100 });
    const carl = await Client.join(id, 'Carl');
    expectAck(await select(fac, a));
    expectAck(await carl.cmd_({ type: 'vote', card: '5' }));
    carl.close();
    await sleep(700); // offline, past the purge time, but his vote protects him within the round
    expect(fac.state!.participants.some((p) => p.name === 'Carl')).toBe(true);
    expectAck(await select(fac, b, { confirmReset: true })); // new round: purge applies now
    expect(fac.state!.participants.some((p) => p.name === 'Carl')).toBe(false);
  });
});

describe('F02: protocol hygiene', () => {
  it('F02: unknown command types are rejected explicitly, not ignored', async () => {
    const { fac } = await room();
    const r = await fac.cmd_({ type: 'frobnicate' });
    expectCode(r, 'invalid_input');
  });

  it('F02-AC4: two facilitator tabs adding and moving concurrently end in the same agenda for everyone', async () => {
    const { fac, id, room: created, bob } = await room();
    const tab2 = await Client.rejoin(id, created.token);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => [
        fac.cmd_({ type: 'add_story', title: `F${i}` }),
        tab2.cmd_({ type: 'add_story', title: `T${i}` }),
      ]).flat(),
    );
    const total = 3 + 16;
    await bob.waitForState((s) => s.stories.progress.outOf === total);
    expect(new Set(bob.rows.map((r) => r.id)).size).toBe(total);
    const ids = bob.rows.map((r) => r.id);
    await Promise.all([
      fac.cmd_({ type: 'move_story', storyId: ids[0], beforeId: ids[5] }),
      tab2.cmd_({ type: 'move_story', storyId: ids[1], beforeId: ids[5] }),
      fac.cmd_({ type: 'delete_story', storyId: ids[5] }),
    ]);
    await sleep(50);
    expect(fac.titles).toEqual(bob.titles);
    expect(tab2.titles).toEqual(bob.titles);
    expect(bob.rows).toHaveLength(total - 1);
  });
});

describe('F02 test hooks', () => {
  it('F02-AC5: the seed hook validates its input and reports unknown rooms', async () => {
    const s = await setupStories();
    expect((await seedStories(s.id, { count: 0 })).status).toBe(400);
    expect((await seedStories(s.id, { count: 3, estimated: 3, skipped: 1 })).status).toBe(400);
    expect((await seedStories('0123456789abcdef', { count: 1 })).status).toBe(404);
    const ok = await seedStories(s.id, {
      count: 4,
      estimated: 2,
      skipped: 1,
      titleLength: 20,
      linkLength: 40,
      descriptionLength: 10,
    });
    expect(ok.status).toBe(201);
    const body = (await ok.json()) as { storyIds: string[]; version: number };
    expect(body.storyIds).toHaveLength(4);
    await s.fac.waitForState((st) => st.stories.progress.outOf === 3);
    expect(s.fac.rows.map((r) => r.status)).toEqual([
      'estimated',
      'estimated',
      'skipped',
      'pending',
    ]);
    expect(s.fac.rows[0]!.title).toMatch(/^Story 001 x+$/);
    expect(s.fac.rows[0]!.link).toHaveLength(40);
    expect((await detail(s.fac, body.storyIds[0]!)).finalRound!.votes).toHaveLength(3);
  });

  it('F02-AC17: the storage hook lists keys with sizes and never token hashes', async () => {
    const s = await setupStories();
    const report = await storageReport(s.id);
    expect(report.entries.map((e) => e.key)).toEqual(
      expect.arrayContaining(['room/1', `participants/${s.room.participantId}`, 'story_meta/1']),
    );
    expect(report.totalBytes).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toContain(s.room.token);
  });
});
