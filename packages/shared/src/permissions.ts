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
