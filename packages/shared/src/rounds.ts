import type { RoomState } from './state';

/**
 * Unsaved round (F02 Definitions): the current round has at least one vote and is either in
 * `voting`, or `revealed` with no estimate accepted in this round. Every command that would
 * discard it needs `confirmReset: true` (else `confirmation_required`, `field: "confirmReset"`):
 * `select_story`, `next_story`, `skip_story` and `delete_story` of the active story, and a
 * `storySource` change through `update_settings`. Idle rooms have no round to lose.
 *
 * The server decides; clients use this to show the confirmation dialog.
 */
export function isRoundUnsaved(
  state: Pick<RoomState, 'round' | 'participants' | 'stories' | 'settings'>,
): boolean {
  const { round, stories, settings, participants } = state;
  if (settings.storySource === 'stories') {
    if (stories.activeId === null) return false;
    if (stories.acceptedRound === round.number) return false;
  }
  return round.phase === 'voting' ? participants.some((p) => p.hasVoted) : round.votes.length > 0;
}
