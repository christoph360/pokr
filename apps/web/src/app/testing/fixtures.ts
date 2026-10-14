import type { Participant, RoomState } from '@pokr/shared';
import { DEFAULT_SETTINGS, EMPTY_STORIES_STATE } from '@pokr/shared';

export function participant(id: string, overrides: Partial<Participant> = {}): Participant {
  return { id, name: id, role: 'voter', online: true, hasVoted: false, ...overrides };
}

/** A voting-phase room: p1 is the facilitator and the recipient. */
export function makeState(overrides: Partial<RoomState> = {}): RoomState {
  return {
    roomId: 'abcdefghjkmnpqrs',
    version: 1,
    serverTime: Date.now(),
    selfId: 'p1',
    facilitatorId: 'p1',
    settings: { ...DEFAULT_SETTINGS, name: 'Sprint 42' },
    topic: '',
    round: { phase: 'voting', number: 1 },
    participants: [participant('p1'), participant('p2'), participant('p3')],
    myVote: null,
    canClaimAt: null,
    stories: EMPTY_STORIES_STATE,
    ...overrides,
  };
}
