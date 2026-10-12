import type { Role, RoomSettings } from './settings';

/** The slice of a participant that voting rules need. */
export interface VotingParticipant {
  id: string;
  role: Role;
  online: boolean;
  hasVoted: boolean;
}

/**
 * Voter (F01 Definitions): role voter, except the facilitator when "facilitator votes" is off.
 * (A facilitator who chose the observer role has role 'observer'.)
 */
export function isVoter(
  p: Pick<VotingParticipant, 'id' | 'role'>,
  facilitatorId: string,
  settings: Pick<RoomSettings, 'facilitatorVotes'>,
): boolean {
  if (p.role !== 'voter') return false;
  return !(p.id === facilitatorId && !settings.facilitatorVotes);
}

/**
 * "x of y voted" (F01-AC12). x = voters (online or offline) with a vote; y = online voters
 * plus offline voters who have a vote.
 */
export function votedCounter(
  participants: readonly VotingParticipant[],
  facilitatorId: string,
  settings: Pick<RoomSettings, 'facilitatorVotes'>,
): { voted: number; total: number } {
  let voted = 0;
  let total = 0;
  for (const p of participants) {
    if (!isVoter(p, facilitatorId, settings)) continue;
    if (p.hasVoted) voted++;
    if (p.online || p.hasVoted) total++;
  }
  return { voted, total };
}

/**
 * Auto-reveal predicate (F01-AC16, AC22, AC35): setting on, round in `voting`, at least one
 * online voter, and every online voter holds a vote. Offline voters never block.
 * The server must re-evaluate it after every state-changing event.
 */
export function shouldAutoReveal(
  phase: 'voting' | 'revealed',
  participants: readonly VotingParticipant[],
  facilitatorId: string,
  settings: Pick<RoomSettings, 'facilitatorVotes' | 'autoReveal'>,
): boolean {
  if (!settings.autoReveal || phase !== 'voting') return false;
  let online = 0;
  for (const p of participants) {
    if (!p.online || !isVoter(p, facilitatorId, settings)) continue;
    if (!p.hasVoted) return false;
    online++;
  }
  return online >= 1;
}
