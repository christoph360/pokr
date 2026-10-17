import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { RoomState } from '@pokr/shared';
import { makeStoryState, participant, story } from '../testing/fixtures';
import { CommandError, RoomConnection } from './room-connection';
import type { CommandInput } from './room-connection';
import { StoryActions } from './story-actions';

const rows = [story('a'), story('b', { status: 'estimated', estimate: '5' }), story('c')];

function setup(
  state: RoomState,
  reply: (cmd: CommandInput) => Promise<number> = () => Promise.resolve(1),
) {
  const sent: CommandInput[] = [];
  const resync = vi.fn();
  const stub = {
    state: signal<RoomState | null>(state),
    connected: signal(true),
    resync,
    send: (cmd: CommandInput) => {
      sent.push(cmd);
      return reply(cmd);
    },
  };
  TestBed.configureTestingModule({ providers: [{ provide: RoomConnection, useValue: stub }] });
  return { actions: TestBed.inject(StoryActions), sent, resync };
}

const unsavedVoting = (activeId = 'a') =>
  makeStoryState(
    rows,
    { activeId },
    {
      participants: [participant('p1', { hasVoted: true }), participant('p2')],
      myVote: '5',
    },
  );

describe('StoryActions', () => {
  it('F02-AC7 select sends select_story without confirmation when nothing is unsaved', async () => {
    const { actions, sent } = setup(makeStoryState(rows, { activeId: 'a' }));
    actions.select(rows[2]!);
    await Promise.resolve();
    expect(sent).toEqual([{ type: 'select_story', storyId: 'c', confirmReset: false }]);
    expect(actions.confirm()).toBeNull();
  });

  it('F02-AC7 selecting the active story is a no-op', () => {
    const { actions, sent } = setup(makeStoryState(rows, { activeId: 'a' }));
    actions.select(rows[0]!);
    expect(sent).toEqual([]);
  });

  it('F02 unsaved round: select asks first, then sends confirmReset', async () => {
    const { actions, sent } = setup(unsavedVoting());
    actions.select(rows[2]!);
    expect(sent).toEqual([]);
    expect(actions.confirm()).toMatchObject({ kind: 'select', needsReset: true });
    actions.confirmOk();
    await Promise.resolve();
    expect(sent).toEqual([{ type: 'select_story', storyId: 'c', confirmReset: true }]);
    expect(actions.confirm()).toBeNull();
  });

  it('F02 accepted round: a revealed round whose estimate was accepted needs no confirmation', async () => {
    const state = makeStoryState(
      rows,
      { activeId: 'b', acceptedRound: 1 },
      {
        round: {
          phase: 'revealed',
          number: 1,
          votes: [{ participantId: 'p1', card: '5' }],
          left: [],
        },
      },
    );
    const { actions, sent } = setup(state);
    actions.select(rows[2]!);
    await Promise.resolve();
    expect(sent).toHaveLength(1);
  });

  it('F02-AC9 next sends the round id the client based it on', async () => {
    const { actions, sent } = setup(
      makeStoryState(rows, { activeId: 'a' }, { round: { phase: 'voting', number: 7 } }),
    );
    actions.next();
    await Promise.resolve();
    expect(sent).toEqual([{ type: 'next_story', round: 7, confirmReset: false }]);
  });

  it('F02-AC13 skip and skip-and-next carry round and advance', async () => {
    const { actions, sent } = setup(
      makeStoryState(rows, { activeId: 'a' }, { round: { phase: 'voting', number: 3 } }),
    );
    actions.skip(rows[0]!, false);
    actions.skip(rows[0]!, true);
    await Promise.resolve();
    expect(sent).toEqual([
      { type: 'skip_story', storyId: 'a', round: 3, advance: false, confirmReset: false },
      { type: 'skip_story', storyId: 'a', round: 3, advance: true, confirmReset: false },
    ]);
  });

  it('F02-AC4 deleting an estimated story asks, then sends confirmDelete', async () => {
    const { actions, sent } = setup(makeStoryState(rows, { activeId: 'a' }));
    actions.remove(rows[1]!);
    expect(sent).toEqual([]);
    expect(actions.confirm()).toMatchObject({
      kind: 'delete',
      needsDelete: true,
      needsReset: false,
    });
    actions.confirmOk();
    await Promise.resolve();
    expect(sent).toEqual([
      { type: 'delete_story', storyId: 'b', confirmReset: false, confirmDelete: true },
    ]);
  });

  it('F02-AC4 deleting a pending, inactive story needs no confirmation', async () => {
    const { actions, sent } = setup(makeStoryState(rows, { activeId: 'a' }));
    actions.remove(rows[2]!);
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(actions.confirm()).toBeNull();
  });

  it('F02 confirmation_required from the server (a vote the client did not know) opens the dialog and retries with the flag', async () => {
    let first = true;
    const { actions, sent } = setup(makeStoryState(rows, { activeId: 'a' }), () => {
      if (first) {
        first = false;
        return Promise.reject(new CommandError('confirmation_required', 'confirmReset'));
      }
      return Promise.resolve(2);
    });
    actions.next();
    await vi.waitFor(() => expect(actions.confirm()).not.toBeNull());
    expect(actions.confirm()).toMatchObject({ kind: 'next', needsReset: true });
    actions.confirmOk();
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toEqual({ type: 'next_story', round: 1, confirmReset: true });
  });

  it('F02-AC7 stale_round resyncs and shows a message', async () => {
    const { actions, resync } = setup(makeStoryState(rows, { activeId: 'a' }), () =>
      Promise.reject(new CommandError('stale_round')),
    );
    actions.next();
    await vi.waitFor(() => expect(actions.error()).toContain('round changed'));
    expect(resync).toHaveBeenCalled();
  });

  it('F02-AC6 not_allowed is reported, not thrown', async () => {
    const { actions } = setup(makeStoryState(rows, { activeId: 'a' }), () =>
      Promise.reject(new CommandError('not_allowed')),
    );
    actions.next();
    await vi.waitFor(() => expect(actions.error()).toContain('not allowed'));
  });

  it('F02-AC10 accept sends the current round id', async () => {
    const { actions, sent } = setup(
      makeStoryState(rows, { activeId: 'a' }, { round: { phase: 'voting', number: 4 } }),
    );
    expect(await actions.accept('a', '8')).toEqual({ ok: true });
    expect(sent).toEqual([{ type: 'accept_estimate', storyId: 'a', round: 4, estimate: '8' }]);
  });
});
