import type { ControlMode, Role } from './settings';

export interface Actor {
  id: string;
  role: Role;
  online: boolean;
}

/** Reveal and reset (F01-AC13): facilitator always; with control mode "everyone", also voters. Observers never (unless facilitator). */
export function canRevealOrReset(
  actor: Actor,
  facilitatorId: string,
  controlMode: ControlMode,
): boolean {
  if (actor.id === facilitatorId) return true;
  return controlMode === 'everyone' && actor.role === 'voter';
}

/** Topic, settings, remove, hand over: facilitator only (F01-AC13, AC23, AC24, AC27). */
export function canManageRoom(actor: Pick<Actor, 'id'>, facilitatorId: string): boolean {
  return actor.id === facilitatorId;
}

/**
 * Claim (F01-AC25): any online participant other than the facilitator, once `now` has reached
 * the server-computed `canClaimAt`. The server is authoritative; clients use this to show the button.
 */
export function canClaimFacilitator(
  actor: Actor,
  facilitatorId: string,
  canClaimAt: number | null,
  now: number,
): boolean {
  return actor.online && actor.id !== facilitatorId && canClaimAt !== null && now >= canClaimAt;
}

/**
 * Add, bulk add, edit, delete, reorder stories and accept an estimate (F02-AC6): facilitator only,
 * whatever the control mode. Also: select, next, skip (a decision, see README).
 */
export function canManageStories(actor: Pick<Actor, 'id'>, facilitatorId: string): boolean {
  return actor.id === facilitatorId;
}

/** Accepting the final estimate (F02-AC6): facilitator only, also with control mode "everyone". */
export const canAcceptEstimate = canManageStories;

/** Choosing the active story: select, next, skip (F02-AC7, AC9, AC13): facilitator only. */
export const canSelectStory = canManageStories;

/**
 * Starting a new round of the current subject and revealing it (F02-AC6). Same rule as F01:
 * with control mode "everyone", voters too. In story-list mode this is `reset` (a re-vote of the
 * active story, F02-AC12) and `reveal`; it never changes which story is active.
 */
export const canStartRoundOrReveal = canRevealOrReset;

/** Reading a story's description and final round (`get_story`): every joined participant, observers included. */
export function canViewStory(_actor: Pick<Actor, 'id'>): boolean {
  return true;
}
