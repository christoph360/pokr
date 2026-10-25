import type { AgendaStory, HeldAgenda, Participant, RoomState, StoriesState } from '@pokr/shared';
import {
  DEFAULT_SETTINGS,
  EMPTY_STORIES_STATE,
  computeProgress,
  resolveDeck,
  sumEstimates,
} from '@pokr/shared';

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

export function story(id: string, overrides: Partial<AgendaStory> = {}): AgendaStory {
  return {
    id,
    title: `Story ${id}`,
    link: null,
    hasDescription: false,
    status: 'pending',
    estimate: null,
    rev: 1,
    tracker: null,
    ...overrides,
  };
}

interface StoriesOptions {
  activeId?: string | null;
  acceptedRound?: number | null;
  activeDescription?: string;
  agendaVersion?: number;
  /** Leave the agenda block out, like a broadcast that did not change the agenda. */
  withoutAgenda?: boolean;
}

/** The `stories` part of a snapshot for `rows`, with progress and sum computed like the server does. */
export function makeStories(
  rows: readonly AgendaStory[],
  options: StoriesOptions = {},
  deck: RoomState['settings']['deck'] = DEFAULT_SETTINGS.deck,
): StoriesState {
  const base: StoriesState = {
    agendaVersion: options.agendaVersion ?? 1,
    activeId: options.activeId ?? null,
    acceptedRound: options.acceptedRound ?? null,
    progress: computeProgress(rows),
    sum: sumEstimates(deck, rows),
  };
  return options.withoutAgenda
    ? base
    : { ...base, agenda: { rows: [...rows], activeDescription: options.activeDescription ?? '' } };
}

/** A room in Story list mode with the given agenda (p1 is the facilitator). */
export function makeStoryState(
  rows: readonly AgendaStory[],
  options: StoriesOptions = {},
  overrides: Partial<RoomState> = {},
): RoomState {
  const base = makeState(overrides);
  const settings = { ...base.settings, storySource: 'stories' as const };
  return { ...base, settings, stories: makeStories(rows, options, settings.deck) };
}

/** The held agenda a connection would hold for `state` (what `RoomView` receives as input). */
export function heldFrom(state: RoomState): HeldAgenda | null {
  const a = state.stories.agenda;
  return a ? { version: state.stories.agendaVersion, ...a } : null;
}

export const FIB_CARDS = resolveDeck(DEFAULT_SETTINGS.deck);
