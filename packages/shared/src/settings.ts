import * as v from 'valibot';
import {
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  DEFAULT_ROOM_NAME,
  ROOM_NAME_MAX,
  TOPIC_MAX,
} from './constants';
import { DEFAULT_DECK, DeckSchema } from './deck';
import type { Deck } from './deck';
import { textSchema } from './text';

export const CONTROL_MODES = ['facilitator', 'everyone'] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];
export const ROLES = ['voter', 'observer'] as const;
export type Role = (typeof ROLES)[number];

/** Display name input (F01-AC4/AC36). Output is the normalized base name; the server adds "(2)" suffixes (AC8). */
export const DisplayNameSchema = textSchema({ min: DISPLAY_NAME_MIN, max: DISPLAY_NAME_MAX });
/** Room name input (F01-AC3): empty after normalization falls back to the default. */
export const RoomNameSchema = v.pipe(
  textSchema({ min: 0, max: ROOM_NAME_MAX }),
  v.transform((s) => (s === '' ? DEFAULT_ROOM_NAME : s)),
);
/** Topic input (F01-AC20). Output '' means "no topic" (clears). */
export const TopicSchema = textSchema({ min: 0, max: TOPIC_MAX });
export const RoleSchema = v.picklist(ROLES);
export const ControlModeSchema = v.picklist(CONTROL_MODES);

/** Settings as a client may submit them: every field optional (create uses defaults, update changes only what is given). */
export const RoomSettingsInputSchema = v.object({
  name: v.optional(RoomNameSchema),
  deck: v.optional(DeckSchema),
  controlMode: v.optional(ControlModeSchema),
  autoReveal: v.optional(v.boolean()),
  facilitatorVotes: v.optional(v.boolean()),
});
export type RoomSettingsInput = v.InferOutput<typeof RoomSettingsInputSchema>;

/** Settings as stored and broadcast. */
export const RoomSettingsSchema = v.object({
  name: v.string(),
  deck: DeckSchema,
  controlMode: ControlModeSchema,
  autoReveal: v.boolean(),
  facilitatorVotes: v.boolean(),
});
export interface RoomSettings {
  name: string;
  deck: Deck;
  controlMode: ControlMode;
  autoReveal: boolean;
  facilitatorVotes: boolean;
}

/** Defaults from the product overview (F01-AC3). */
export const DEFAULT_SETTINGS: RoomSettings = {
  name: DEFAULT_ROOM_NAME,
  deck: DEFAULT_DECK,
  controlMode: 'facilitator',
  autoReveal: false,
  facilitatorVotes: true,
};

/** Apply a (partial) input on top of base settings. `undefined` fields keep the base value. */
export function applySettings(base: RoomSettings, input: RoomSettingsInput): RoomSettings {
  return {
    name: input.name ?? base.name,
    deck: input.deck ?? base.deck,
    controlMode: input.controlMode ?? base.controlMode,
    autoReveal: input.autoReveal ?? base.autoReveal,
    facilitatorVotes: input.facilitatorVotes ?? base.facilitatorVotes,
  };
}
