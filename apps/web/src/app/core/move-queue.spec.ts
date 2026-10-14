import { MoveQueue } from './move-queue';

describe('MoveQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const ids = ['a', 'b', 'c', 'd', 'e'];

  function make(ok = true) {
    const sent: [string, string | null][] = [];
    let failures = 0;
    const queue = new MoveQueue({
      delayMs: 300,
      send: (storyId, beforeId) => {
        sent.push([storyId, beforeId]);
        return Promise.resolve(ok);
      },
      failed: () => failures++,
    });
    return { queue, sent, failures: () => failures };
  }

  it('F02-AC20 25 quick key presses send one message with the final position', async () => {
    const { queue, sent } = make();
    for (let i = 0; i < 25; i++) {
      queue.step(ids, 'e', i % 2 === 0 ? 'up' : 'down');
      vi.advanceTimersByTime(20);
    }
    // 25 presses: 13 ups and 12 downs end one step above the end.
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual([['e', 'd']]);
    expect(queue.order()).toBeNull();
  });

  it('F02-AC4 the local order changes at once and reports the new position', () => {
    const { queue } = make();
    expect(queue.step(ids, 'c', 'top')).toEqual({ changed: true, position: 1, total: 5 });
    expect(queue.order()).toEqual(['c', 'a', 'b', 'd', 'e']);
    expect(queue.step(ids, 'c', 'up')).toMatchObject({ changed: false, position: 1 });
  });

  it('F02-AC4 moving to the bottom anchors on null (the end)', async () => {
    const { queue, sent } = make();
    queue.step(ids, 'b', 'bottom');
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual([['b', null]]);
  });

  it('F02-AC4 a drag drop is sent without waiting for the quiet period', async () => {
    const { queue, sent } = make();
    queue.drop(ids, 'd', 'a');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([['d', 'a']]);
  });

  it('F02-AC4 a rejected move drops the optimistic order and reports the failure', async () => {
    const { queue, failures } = make(false);
    queue.step(ids, 'b', 'down');
    await vi.advanceTimersByTimeAsync(300);
    expect(queue.order()).toBeNull();
    expect(failures()).toBe(1);
  });

  it('F02-AC4 two moved stories are sent one after the other', async () => {
    const { queue, sent } = make();
    queue.step(ids, 'a', 'down');
    queue.step(ids, 'e', 'top');
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual([
      ['a', 'c'],
      ['e', 'b'],
    ]);
  });
});
