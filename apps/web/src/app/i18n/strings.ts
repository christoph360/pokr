/**
 * All user-visible UI text lives here (product overview: "all strings externalized").
 *
 * Why a constants file and not Angular's built-in i18n: much of the text is produced in TypeScript
 * (live-region announcements, validation and error messages), and build-time `i18n` markers would
 * need a separate build per locale plus `$localize` plumbing for a v1 that ships English only.
 * A typed constants object keeps templates and code on one path; when a second language arrives,
 * this module can become the single place that wraps each entry in `$localize` or loads a catalog.
 * Templates reference it as `t.<key>`; parameterised text is a function.
 */
export const STRINGS = {
  appName: 'pokr',
  skipToContent: 'Skip to main content',

  start: {
    heading: 'Start a planning session',
    intro: 'Create a room, share the link, and vote together. No account needed.',
    name: 'Your name',
    nameHint: 'Shown to everyone in the room.',
    roomName: 'Room name (optional)',
    roomNamePlaceholder: 'Planning session',
    deck: 'Deck',
    customDeck: 'Custom cards',
    customDeckHint:
      'Separate cards with commas, for example: 1, 2, 4, 8. ? and ☕ are added for you.',
    controlMode: 'Who can reveal and reset',
    autoReveal: 'Reveal automatically when everyone has voted',
    facilitatorVotes: 'I vote too',
    create: 'Create room',
    creating: 'Creating room…',
    networkError: 'Could not reach the server. Check your connection and try again.',
    serverError: 'Something went wrong while creating the room. Please try again.',
    rateLimited: (seconds: number) =>
      `Too many rooms created. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
    fixErrors: 'Fix the highlighted fields and try again.',
  },

  decks: {
    fibonacci: 'Fibonacci',
    'modified-fibonacci': 'Modified Fibonacci',
    tshirt: 'T-shirt',
    'powers-of-2': 'Powers of 2',
    custom: 'Custom',
  },
  controlModes: {
    facilitator: 'Facilitator only',
    everyone: 'Everyone',
  },
  roles: {
    voter: 'Voter',
    observer: 'Observer',
    facilitator: 'Facilitator',
  },

  validation: {
    nameRequired: 'Enter a name.',
    nameTooLong: (max: number) => `Use at most ${max} characters.`,
    tooLong: (max: number) => `Use at most ${max} characters.`,
    forbiddenChars: 'Remove line breaks, tabs and other control characters.',
    customNeedsCards: 'Add at least one card.',
    customTooMany: (max: number) => `Use at most ${max} cards.`,
    customCardEmpty: 'Cards cannot be empty.',
    customCardEmptyAt: (n: number) => `Card ${n} is empty.`,
    customCardTooLong: (max: number) => `Each card can have at most ${max} characters.`,
    customUnique: 'Cards must be unique, ignoring upper and lower case.',
    customSpecial: '? and ☕ are added automatically, so leave them out.',
    invalid: 'This value is not valid.',
  },

  join: {
    heading: 'Join this room',
    name: 'Your name',
    role: 'Join as',
    voter: 'Voter',
    voterHint: 'Pick a card each round.',
    observer: 'Observer',
    observerHint: 'Watch only, never counted.',
    submit: 'Join room',
    roomLabel: (name: string) => `Room: ${name}`,
  },

  notFound: {
    heading: 'Room not found',
    body: 'This link does not point to an existing room. Check the link, or start a new room.',
    create: 'Create a new room',
  },
  full: {
    heading: 'This room is full',
    body: 'Rooms hold up to 50 people. Ask the facilitator to remove someone who has left, then try again.',
    create: 'Create a new room',
  },
  removed: {
    heading: 'You were removed from the room',
    body: 'The facilitator removed you. You can join again with a new name prompt.',
    rejoin: 'Rejoin',
  },

  room: {
    loading: 'Joining the room…',
    connectingNoState: 'Connecting to the room…',
    linkLabel: 'Room link',
    copy: 'Copy link',
    copied: 'Link copied to the clipboard.',
    copyFailed: 'Could not copy automatically. Select the link above and copy it.',
    settings: 'Room settings',
    topic: 'Topic',
    noTopic: 'No topic set',
    topicInput: 'Topic for this round',
    topicSave: 'Set topic',
    topicHint: 'An edited topic is also applied when you reset the round.',
    cards: 'Your cards',
    cardsObserver: 'You are an observer, so you have no cards. You can still watch the votes.',
    cardsFacilitatorNoVote:
      'Facilitator voting is off for this room, so you have no cards. You still control the round.',
    cardsPaused: 'Reconnecting. Voting is paused until you are back online.',
    cardsRevealed: 'Votes are revealed. Reset the round to vote again.',
    cardsPending: 'Saving your vote…',
    voted: (voted: number, total: number) => `${voted} of ${total} voted`,
    reveal: 'Reveal votes',
    reset: 'Reset round',
    resetAndTopic: 'Reset with new topic',
    revealHintWaiting: 'Waiting for votes',
    votesRevealedAnnouncement: (summary: string) => `Votes revealed. ${summary}`,
    claim: 'Claim facilitator role',
    claimHint: 'The facilitator has been offline for a while.',
    switchToObserver: 'Switch to observer',
    switchToVoter: 'Switch to voter',
    rename: 'Change my name',
    renameLabel: 'Your name',
    renameSave: 'Save name',
    cancel: 'Cancel',
    close: 'Close',
    youMarker: '(you)',
    roundNumber: (n: number) => `Round ${n}`,
    actionFailed: 'That did not work.',
    connectionLost: 'You are not connected, so that action was not sent.',
  },

  cardNames: {
    '½': 'one half',
    '?': 'question mark',
    '☕': 'coffee break',
  } as Record<string, string>,
  cardPendingLabel: 'saving',
  cardSelectedLabel: 'selected',

  participants: {
    heading: 'Participants',
    toggle: (count: number) => `Participants (${count})`,
    online: 'Online',
    offline: 'Offline',
    voted: 'Voted',
    notVoted: 'Not voted yet',
    noVote: 'No vote',
    left: 'Left',
    lowest: 'Lowest',
    highest: 'Highest',
    facilitator: 'Facilitator',
    observer: 'Observer',
    voter: 'Voter',
    makeFacilitator: 'Make facilitator',
    remove: 'Remove',
    makeFacilitatorFor: (name: string) => `Make ${name} the facilitator`,
    removeFor: (name: string) => `Remove ${name} from the room`,
    offlineCannotHandOver: 'Only online participants can become facilitator',
    voteOf: (name: string, vote: string) => `${name}: ${vote}`,
    revealedCardLabel: (card: string) => `Card ${card}`,
  },

  summary: {
    heading: 'Results',
    noVotes: 'No votes',
    average: 'Average',
    median: 'Median',
    consensus: 'Consensus',
    distribution: 'Distribution',
    lowest: 'Lowest',
    highest: 'Highest',
    votes: (n: number) => `${n} vote${n === 1 ? '' : 's'}`,
    announcement: (parts: {
      total: number;
      average: string | null;
      median: string | null;
      consensus: boolean;
    }) => {
      if (parts.total === 0) return 'No votes.';
      const out = [`${parts.total} vote${parts.total === 1 ? '' : 's'}.`];
      if (parts.average !== null) out.push(`Average ${parts.average}.`);
      if (parts.median !== null) out.push(`Median ${parts.median}.`);
      if (parts.consensus) out.push('Consensus.');
      return out.join(' ');
    },
  },

  settings: {
    heading: 'Room settings',
    roomName: 'Room name',
    deck: 'Deck',
    customDeck: 'Custom cards',
    customApply: 'Use custom deck',
    controlMode: 'Who can reveal and reset',
    autoReveal: 'Reveal automatically when everyone has voted',
    facilitatorVotes: 'Facilitator votes',
    nonFacilitatorNote: 'Only the facilitator can change these settings.',
    summaryLine: (deck: string, mode: string) => `Deck: ${deck}. Reveal and reset: ${mode}.`,
  },

  confirm: {
    deckTitle: 'Change the deck?',
    deckBody: 'Changing the deck discards the votes of the current round.',
    deckOk: 'Change deck and reset',
    resetTitle: 'Reset the round?',
    resetBody: 'Votes that have not been revealed will be lost.',
    resetOk: 'Reset round',
    cancel: 'Cancel',
  },

  connection: {
    reconnecting: 'Reconnecting…',
    restored: 'Back online.',
  },

  errors: {
    not_allowed: 'You are not allowed to do that.',
    room_not_found: 'This room no longer exists.',
    room_full: 'This room is full.',
    round_revealed: 'Votes are already revealed.',
    confirmation_required: 'This change needs your confirmation.',
    target_offline: 'That person is offline now, so they cannot become facilitator.',
    already_claimed: 'Someone else already claimed the facilitator role.',
    rate_limited: 'You are doing that too fast. Wait a moment and try again.',
    invalid_input: 'That value is not valid.',
    removed: 'You were removed from the room.',
    invalid_card: 'That card is not in this deck.',
    invalid_token: 'Your session for this room is no longer valid.',
    not_joined: 'You have not joined the room yet.',
    already_joined: 'You are already in this room.',
    unknown_target: 'That participant is no longer in the room.',
    claim_not_available: 'The facilitator role cannot be claimed right now.',
    internal_error: 'Something went wrong on the server. Please try again.',
    disconnected: 'You are not connected, so that action was not sent.',
  } as Record<string, string>,
} as const;

export type Strings = typeof STRINGS;
