import { computeSummary } from '@pokr/shared';
import type { RoomState } from '@pokr/shared';
import { makeState, participant } from '../testing/fixtures';
import {
  controlsFor,
  counterFor,
  extremesFor,
  hasUnrevealedVotes,
  parseCustomDeck,
  roundHasVotes,
} from './room-logic';

const asUser = (state: RoomState, selfId: string) => ({ ...state, selfId });

describe('controlsFor (F01-AC13 control visibility)', () => {
  const base = makeState({
    participants: [participant('p1'), participant('p2'), participant('p3', { role: 'observer' })],
  });

  it('F01-AC13 facilitator-only mode: only the facilitator reveals and resets', () => {
    expect(controlsFor(base, 0).canRevealOrReset).toBe(true);
    expect(controlsFor(asUser(base, 'p2'), 0).canRevealOrReset).toBe(false);
    expect(controlsFor(asUser(base, 'p3'), 0).canRevealOrReset).toBe(false);
  });

  it('F01-AC13 everyone mode: voters too, observers still not', () => {
    const everyone = { ...base, settings: { ...base.settings, controlMode: 'everyone' as const } };
    expect(controlsFor(asUser(everyone, 'p2'), 0).canRevealOrReset).toBe(true);
    expect(controlsFor(asUser(everyone, 'p3'), 0).canRevealOrReset).toBe(false);
  });

  it('F01-AC13 only the facilitator manages topic and settings, in both modes', () => {
    const everyone = { ...base, settings: { ...base.settings, controlMode: 'everyone' as const } };
    expect(controlsFor(everyone, 0).canManage).toBe(true);
    expect(controlsFor(asUser(everyone, 'p2'), 0).canManage).toBe(false);
  });

  it('F01-AC35 facilitator with "facilitator votes" off has no cards but keeps control', () => {
    const off = { ...base, settings: { ...base.settings, facilitatorVotes: false } };
    const c = controlsFor(off, 0);
    expect(c.canVote).toBe(false);
    expect(c.canRevealOrReset).toBe(true);
  });

  it('F01-AC12 observers have no cards', () => {
    expect(controlsFor(asUser(base, 'p3'), 0).canVote).toBe(false);
    expect(controlsFor(asUser(base, 'p2'), 0).canVote).toBe(true);
  });

  it('F01-AC25 claim appears for any online non-facilitator once canClaimAt passed', () => {
    const waiting = { ...asUser(base, 'p3'), canClaimAt: 1000 };
    expect(controlsFor(waiting, 999).canClaim).toBe(false);
    expect(controlsFor(waiting, 1000).canClaim).toBe(true);
    expect(controlsFor({ ...base, canClaimAt: 1000 }, 5000).canClaim).toBe(false);
  });
});

describe('counter and vote helpers', () => {
  it('F01-AC12 counts x of y with the shared rule', () => {
    const s = makeState({
      participants: [
        participant('p1', { hasVoted: true }),
        participant('p2', { online: false }),
        participant('p3', { role: 'observer' }),
      ],
    });
    expect(counterFor(s)).toEqual({ voted: 1, total: 1 });
  });

  it('F01-AC19 only unrevealed votes need a reset confirmation', () => {
    const none = makeState();
    const some = makeState({ participants: [participant('p1', { hasVoted: true })] });
    const revealed = makeState({
      round: {
        phase: 'revealed',
        number: 1,
        votes: [{ participantId: 'p1', card: '5' }],
        left: [],
      },
    });
    expect(hasUnrevealedVotes(none)).toBe(false);
    expect(hasUnrevealedVotes(some)).toBe(true);
    expect(hasUnrevealedVotes(revealed)).toBe(false);
    expect(roundHasVotes(revealed)).toBe(true);
  });

  it('F01-AC15 extremes come from the shared summary and skip special cards', () => {
    const summary = computeSummary({ id: 'fibonacci' }, [
      { participantId: 'a', card: '1' },
      { participantId: 'b', card: '8' },
      { participantId: 'c', card: '?' },
    ]);
    const map = extremesFor(summary);
    expect(map.get('a')).toBe('lowest');
    expect(map.get('b')).toBe('highest');
    expect(map.has('c')).toBe(false);
  });
});

describe('parseCustomDeck (F01-AC34)', () => {
  it('F01-AC34 accepts valid cards and normalizes them', () => {
    expect(parseCustomDeck(' 1 , 2,  4 ')).toEqual({
      ok: true,
      deck: { id: 'custom', cards: ['1', '2', '4'] },
    });
  });

  it.each([
    ['', 'Add at least one card.'],
    ['a, , b', 'Card 2 is empty'],
    ['1, 2,', 'Card 3 is empty'],
    [',1', 'Card 1 is empty'],
    ['1, 2, 1', 'unique'],
    ['a, A', 'unique'],
    ['1, ?', 'automatically'],
    ['1, ☕', 'automatically'],
    ['12345', 'at most 4'],
    [Array.from({ length: 21 }, (_, i) => `c${i}`).join(','), 'at most 20'],
  ])('F01-AC34 rejects %j with an inline message', (input, fragment) => {
    const result = parseCustomDeck(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(fragment);
  });
});
