import * as v from 'valibot';
import { RoleSchema, RoomSettingsSchema } from './settings';

/**
 * Room state snapshot, projected for one recipient.
 *
 * Vote secrecy (F01-AC11) is structural: while `round.phase === 'voting'` the type has no field
 * that can carry another participant's vote. Others appear only as `hasVoted`. The recipient's
 * own card is `myVote`. Card values of everyone appear only in `round.votes` after reveal.
 */

export const ParticipantSchema = v.object({
  id: v.string(),
  /** Display name including any "(2)" suffix assigned by the server (F01-AC8). */
  name: v.string(),
  role: RoleSchema,
  online: v.boolean(),
  /** Holds a vote in the current round. False for observers in `voting` (switching withdraws the vote); after reveal an observer who switched keeps their revealed vote (F01-AC18) and shows true. Never carries the value. */
  hasVoted: v.boolean(),
});
export type Participant = v.InferOutput<typeof ParticipantSchema>;

export const RevealedVoteSchema = v.object({ participantId: v.string(), card: v.string() });
export type RevealedVote = v.InferOutput<typeof RevealedVoteSchema>;

export const RoundSchema = v.variant('phase', [
  v.object({ phase: v.literal('voting'), number: v.number() }),
  v.object({
    phase: v.literal('revealed'),
    number: v.number(),
    /** All votes of the round, including those of offline and removed participants. */
    votes: v.array(RevealedVoteSchema),
    /** Removed participants whose revealed vote is still shown, with a "left" marker (F01-AC18). */
    left: v.array(v.object({ participantId: v.string(), name: v.string() })),
  }),
]);
export type Round = v.InferOutput<typeof RoundSchema>;

export const RoomStateSchema = v.object({
  roomId: v.string(),
  /** Monotonic per room, +1 for every change visible in any snapshot. Survives eviction. Starts at 1. */
  version: v.pipe(v.number(), v.integer(), v.minValue(1)),
  /** Server clock (epoch ms) at send time, for computing clock offset against `canClaimAt`. */
  serverTime: v.number(),
  /** The recipient's own participant ID. */
  selfId: v.string(),
  facilitatorId: v.string(),
  settings: RoomSettingsSchema,
  /** '' when there is no topic. Persists across reset unless reset supplied a new one. */
  topic: v.string(),
  round: RoundSchema,
  /** In join order. Online and offline, voters and observers, at most MAX_PARTICIPANTS. */
  participants: v.array(ParticipantSchema),
  /** The recipient's own current card, or null. Present in every phase (also on join and resync). */
  myVote: v.nullable(v.string()),
  /** Epoch ms (server clock) when claiming the facilitator role becomes available; null while the facilitator is online (F01-AC25). */
  canClaimAt: v.nullable(v.number()),
});
export type RoomState = v.InferOutput<typeof RoomStateSchema>;
