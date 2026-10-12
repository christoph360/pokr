import { describe, expect, it } from 'vitest';
import { shouldAutoReveal, votedCounter } from './voting';
import type { VotingParticipant } from './voting';
import { canClaimFacilitator, canManageRoom, canRevealOrReset } from './permissions';
import { backoffDelayMs } from './backoff';
import { DEFAULT_BACKOFF } from './constants';

const p = (id: string, o: Partial<Omit<VotingParticipant, 'id'>> = {}): VotingParticipant => ({
  id,
  role: 'voter',
  online: true,
  hasVoted: false,
  ...o,
});
const on = { facilitatorVotes: true, autoReveal: true };

describe('voted counter (F01-AC12)', () => {
  it('x = voters with a vote (online or offline); y = online voters + offline voters with a vote', () => {
    const ps = [
      p('f', { hasVoted: true }),
      p('a'),
      p('b', { online: false, hasVoted: true }),
      p('c', { online: false }), // offline, no vote: excluded from y
    ];
    expect(votedCounter(ps, 'f', on)).toEqual({ voted: 2, total: 3 });
  });

  it('F01-AC12: observers are excluded from both numbers', () => {
    const ps = [
      p('f', { hasVoted: true }),
      p('o', { role: 'observer' }),
      p('o2', { role: 'observer', online: false }),
    ];
    expect(votedCounter(ps, 'f', on)).toEqual({ voted: 1, total: 1 });
  });

  it('F01-AC35: facilitator is excluded when "facilitator votes" is off', () => {
    const ps = [p('f'), p('a', { hasVoted: true })];
    expect(votedCounter(ps, 'f', { facilitatorVotes: false })).toEqual({ voted: 1, total: 1 });
    expect(votedCounter(ps, 'f', { facilitatorVotes: true })).toEqual({ voted: 1, total: 2 });
  });

  it('F01-AC12: facilitator who chose the observer role is excluded', () => {
    const ps = [p('f', { role: 'observer' }), p('a')];
    expect(votedCounter(ps, 'f', on)).toEqual({ voted: 0, total: 1 });
  });

  it('empty room', () => {
    expect(votedCounter([], 'f', on)).toEqual({ voted: 0, total: 0 });
  });
});

describe('auto-reveal predicate (F01-AC16)', () => {
  it('F01-AC16: reveals when every online voter holds a vote', () => {
    const ps = [p('f', { hasVoted: true }), p('a', { hasVoted: true })];
    expect(shouldAutoReveal('voting', ps, 'f', on)).toBe(true);
  });

  it('F01-AC16: not while an online voter has not voted', () => {
    const ps = [p('f', { hasVoted: true }), p('a')];
    expect(shouldAutoReveal('voting', ps, 'f', on)).toBe(false);
  });

  it('F01-AC16: needs at least one online voter', () => {
    expect(shouldAutoReveal('voting', [], 'f', on)).toBe(false);
    expect(shouldAutoReveal('voting', [p('f', { online: false, hasVoted: true })], 'f', on)).toBe(
      false,
    );
    expect(shouldAutoReveal('voting', [p('o', { role: 'observer' })], 'f', on)).toBe(false);
  });

  it('F01-AC22: offline voters never block', () => {
    const ps = [p('f', { hasVoted: true }), p('a', { online: false })];
    expect(shouldAutoReveal('voting', ps, 'f', on)).toBe(true);
  });

  it('F01-AC16: only in voting state and with the setting on', () => {
    const ps = [p('f', { hasVoted: true })];
    expect(shouldAutoReveal('revealed', ps, 'f', on)).toBe(false);
    expect(shouldAutoReveal('voting', ps, 'f', { ...on, autoReveal: false })).toBe(false);
  });

  it('F01-AC16: observers do not block', () => {
    const ps = [p('f', { hasVoted: true }), p('o', { role: 'observer' })];
    expect(shouldAutoReveal('voting', ps, 'f', on)).toBe(true);
  });

  it('F01-AC35: facilitator with "facilitator votes" off does not block or count', () => {
    const off = { autoReveal: true, facilitatorVotes: false };
    expect(shouldAutoReveal('voting', [p('f'), p('a', { hasVoted: true })], 'f', off)).toBe(true);
    expect(shouldAutoReveal('voting', [p('f', { hasVoted: true })], 'f', off)).toBe(false); // no online voter
  });
});

describe('permissions (F01-AC13, AC25)', () => {
  const me = (id: string, role: 'voter' | 'observer' = 'voter', online = true) => ({
    id,
    role,
    online,
  });

  it('F01-AC13: facilitator-only mode', () => {
    expect(canRevealOrReset(me('f'), 'f', 'facilitator')).toBe(true);
    expect(canRevealOrReset(me('a'), 'f', 'facilitator')).toBe(false);
  });

  it('F01-AC13: everyone mode allows voters, not observers; facilitator always', () => {
    expect(canRevealOrReset(me('a'), 'f', 'everyone')).toBe(true);
    expect(canRevealOrReset(me('o', 'observer'), 'f', 'everyone')).toBe(false);
    expect(canRevealOrReset(me('f', 'observer'), 'f', 'everyone')).toBe(true);
  });

  it('F01-AC13: only the facilitator manages topic and settings in both modes', () => {
    expect(canManageRoom(me('f'), 'f')).toBe(true);
    expect(canManageRoom(me('a'), 'f')).toBe(false);
  });

  it('F01-AC25: claim needs an online non-facilitator and the threshold reached', () => {
    expect(canClaimFacilitator(me('o', 'observer'), 'f', 1000, 1000)).toBe(true);
    expect(canClaimFacilitator(me('a'), 'f', 1000, 999)).toBe(false);
    expect(canClaimFacilitator(me('a'), 'f', null, 5000)).toBe(false);
    expect(canClaimFacilitator(me('f'), 'f', 1000, 5000)).toBe(false);
    expect(canClaimFacilitator(me('a', 'voter', false), 'f', 1000, 5000)).toBe(false);
  });
});

describe('reconnect backoff (F01-AC29)', () => {
  const mid = () => 0.5; // zero jitter
  it('F01-AC29: 0.5 s initial, x2, 15 s maximum', () => {
    const delays = [0, 1, 2, 3, 4, 5, 6, 10, 100].map((n) =>
      backoffDelayMs(n, DEFAULT_BACKOFF, mid),
    );
    expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000]);
  });

  it('F01-AC29: +/-20% jitter', () => {
    expect(backoffDelayMs(0, DEFAULT_BACKOFF, () => 0)).toBe(400);
    expect(backoffDelayMs(0, DEFAULT_BACKOFF, () => 1)).toBe(600);
    expect(backoffDelayMs(10, DEFAULT_BACKOFF, () => 0)).toBe(12000);
    for (let i = 0; i < 100; i++) {
      const d = backoffDelayMs(2, DEFAULT_BACKOFF);
      expect(d).toBeGreaterThanOrEqual(1600);
      expect(d).toBeLessThanOrEqual(2400);
    }
  });

  it('is configurable (test mode)', () => {
    expect(backoffDelayMs(3, { initialMs: 10, factor: 2, maxMs: 50, jitter: 0 })).toBe(50);
  });
});
