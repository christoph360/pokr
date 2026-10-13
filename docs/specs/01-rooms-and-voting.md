# F01: Rooms and voting

- Status: Ready for implementation (rev 2, spec issues SI-01 to SI-29 from `docs/qa/F01-test-plan.md` resolved)
- Depends on: none
- Owners: backend-dev (room Durable Object, contract), frontend-dev (UI), devops-engineer (Durable Object binding, environments, CI), qa-engineer (test plan, e2e, sign-off)

## Goal

Create a room, share the link, join with a name, vote on a free-text topic, reveal, and reset.
This is the core loop. Every later feature builds on it.

## User stories

1. As a facilitator, I create a room in one step and get a link to share.
2. As a participant, I open the link, enter my name, and I'm in the room.
3. As a voter, I pick a card, and others see that I have voted but not what I voted.
4. As the facilitator (or anyone, depending on control mode), I reveal the votes and see a summary.
5. As the facilitator, I reset the round and optionally set a new topic.
6. As a participant, I see who is online and who has voted.
7. As a participant whose connection drops, I'm back in the room with my vote intact once it
   recovers.

## Definitions

- **Voter**: a participant with role voter. The facilitator counts as a voter unless
  "facilitator votes" is off or the facilitator has chosen the observer role.
- **Special cards**: `?` and `☕`. All other cards are **value cards**.
- **Numeric deck**: Fibonacci, Modified Fibonacci, and Powers of 2 (`½` = 0.5). T-shirt is not
  numeric. A Custom deck is numeric only if every value card parses as a decimal number (`.` as
  separator, no exponent).
- **Text normalization** (all free text: participant names, room names, topics, custom cards):
  - Trim leading and trailing whitespace and collapse internal whitespace to single spaces.
  - Count length in Unicode grapheme clusters, after normalization.
  - Reject control characters and newlines.
  - An empty result is invalid for names and cards. For topics, an empty result clears the topic.
    For room names, it falls back to the default.
  - Client and server apply identical rules, using the shared validation schemas.
- **Offline**: a participant with no open connection. See F01-AC21 for detection timing.
- **Test mode**: a configuration that exists only in local and test environments, never in
  staging or production. It shortens the timers named below and enables test-only hooks.

## Acceptance criteria

### Create a room
- **F01-AC1** Given the start page, when I enter my name and optionally a room name, deck
  (including a Custom deck, see AC34), control mode, auto-reveal, and "facilitator votes", then a
  room is created, I join as facilitator, and the room URL is shown with a copy button.
- **F01-AC2** Room URLs have the form `/r/<roomId>`. `roomId` is 16 characters of lowercase
  Crockford base32 (80 bits) generated with `crypto.getRandomValues`. Lookups are
  case-insensitive. A backend test asserts length, alphabet, and the random source.
- **F01-AC3** Settings not chosen at creation use the defaults from the [overview](00-product-overview.md#room-settings).
  Room name: 1–80 graphemes; empty falls back to "Planning session".

### Join
- **F01-AC4** Given a room link, when I open it for the first time, then I'm asked for a display
  name (1–30 graphemes) and whether to join as voter or observer.
- **F01-AC5** The browser stores one participant token per room.
  - When I reopen the link, I rejoin as the same participant without being asked again.
  - Several tabs with the same token are one participant, who is online while at least one
    connection is open.
  - If my participant was purged (AC21) or removed (AC23), reopening the link is a fresh join.
- **F01-AC6** Given a link with a malformed ID or the ID of a room that was never created, I see
  a "room not found" page with a button to create a new room. A room exists only after an
  explicit create request: opening or connecting to an unknown ID writes no Durable Object
  storage. The HTTP response is 404, and a WebSocket upgrade is rejected with a `room_not_found`
  error. (Expired rooms are covered by F03.)
- **F01-AC7** The 50-participant cap counts everyone in the participant list, online or offline,
  voter or observer.
  - A participant already in the list (AC5) is always admitted.
  - Otherwise, when the room is full, opening the link shows "room is full" before the name prompt.
- **F01-AC8** Duplicate display names are allowed.
  - The server assigns suffixes in join order among current participants whose normalized names
    match case-insensitively. The first keeps the plain name; later ones become "Alex (2)",
    "Alex (3)".
  - A participant's suffix doesn't change while they stay in the list. Numbers of purged
    participants may be reused.
  - The suffixed name is shown everywhere the name appears, including accessible names.

### Vote
- **F01-AC9** Given a round in `voting` state, when I select a card, then:
  - after the server acknowledges it, my card is highlighted for me;
  - everyone, including me, sees a "voted" indicator next to my name, never the value.
- **F01-AC10** Given I have voted, selecting a different card changes my vote. Activating my
  selected card again, by pointer or Space/Enter, withdraws it.
- **F01-AC11** Before reveal, the server sends a vote value only to the participant who cast it
  (as their own current vote, including on join and resync). No other client receives it in any
  WebSocket message or HTTP response, and it never appears in a log line. Verified by:
  - a backend test that inspects all outgoing messages to every connection during a `voting`
    round, including join and resync snapshots;
  - an e2e WebSocket frame inspection.
- **F01-AC12** Observers have no cards. The counter shows "x of y voted":
  - x = voters (online or offline) with a vote in the current round;
  - y = online voters plus offline voters who have a vote.
  - Observers, and the facilitator when "facilitator votes" is off, are excluded from both.

### Reveal
- **F01-AC13** Given control mode "facilitator only", only the facilitator sees and may use reveal
  and reset. Given "everyone", the facilitator and all voters may; observers may not. In both modes,
  only the facilitator can change the topic and settings. The server enforces this and rejects
  other attempts with `not_allowed`.
- **F01-AC14** Reveal is a single state change broadcast to all connections. Every online client
  shows identical votes and summary. In e2e, all clients show it within 2 s of the reveal action;
  the 500 ms p95 target is a separate performance measurement. The animation doesn't delay
  screen-reader availability.
- **F01-AC15** The summary shows:
  - **Distribution**: count per card, special cards included.
  - **Average and median** (numeric decks only, over numeric votes only; omitted if there are
    none). The average is rounded half away from zero and always shown with one decimal (`5.0`).
    The median of an even count is the mean of the two middle values, shown with up to one
    decimal (`2.5`, `4`). Halves are shown as decimals.
  - **Consensus badge** (any deck): at least 2 value-card votes, all the same card. Special
    cards don't break consensus.
  - **Lowest/highest**: value-card votes are ranked by deck position. If lowest and highest
    differ, every voter holding the lowest card and every voter holding the highest card is
    marked with a text label ("Lowest"/"Highest") and a visual highlight. Special-card voters are
    never marked.
- **F01-AC16** With auto-reveal on, in `voting` state, the round reveals as soon as there is at
  least one online voter and every online voter holds a vote.
  - The rule is re-evaluated on every vote, withdrawal, disconnect, removal, role switch, join,
    and settings change, including turning auto-reveal on.
  - A silent connection loss only counts after the heartbeat timeout (AC21).
- **F01-AC17** Revealing with zero votes is allowed and shows "no votes". Revealing an already
  revealed round is a no-op.
- **F01-AC18** After reveal, nothing changes the revealed votes or the summary.
  - Role switches, removals, and setting changes take effect from the next round.
  - A removed participant's revealed vote stays visible until reset, under their name with a
    "left" marker.

### Reset and topic
- **F01-AC19** Reset is available in `voting` and `revealed` state.
  - It asks for confirmation only when unrevealed votes would be lost.
  - It clears all votes, including those of offline participants, and returns to `voting`.
  - It takes an optional new topic and applies both atomically. Without a new topic, the
    current topic stays visible.
- **F01-AC20** The facilitator can set or clear the topic (max 200 graphemes, no newlines) in any
  state. It is shown to everyone above the cards.

### Presence and roles
- **F01-AC21** The participant list shows name, role, online/offline, and voted state.
  - **Clean close**: the participant shows offline within 1 s.
  - **Silent loss** (no close frame): detected by a heartbeat; offline within 30 s.
  - Reconnecting within those windows causes no offline flicker.
  - **Purge**: offline participants without a vote in the current round are removed from the
    list 10 minutes after disconnecting. Offline participants with a vote are removed at the
    first reset after their 10 minutes have passed.
  - The current facilitator is never purged; the role only moves via AC24 or AC25.
  - All three durations are configurable in test mode.
- **F01-AC22** Offline voters don't block auto-reveal (see AC16).
- **F01-AC23** The facilitator can remove a participant. Removal deletes the participant, their
  token, and, in `voting` state, their vote (after reveal, see AC18).
  - The removed client shows "you were removed from the room" and doesn't reconnect
    automatically.
  - Opening the link again or pressing "Rejoin" starts a fresh join with the name prompt.
- **F01-AC24** The facilitator can hand the role to any other online participant.
  - Both keep their own voter/observer role and existing votes.
  - The handover is atomic: if the target isn't online when the server processes it, the
    request is rejected with `target_offline`.
- **F01-AC25** If the facilitator has been offline for more than 5 minutes, any online
  participant, observers included, can claim the role. The server measures the time and tells
  clients when claiming becomes available.
  - The first claim wins; later claims get `already_claimed`.
  - A returning former facilitator becomes a voter.
  - The threshold is configurable in test mode.
- **F01-AC26** Any participant can switch themselves between voter and observer. In `voting`
  state, switching to observer withdraws their vote; after reveal, AC18 applies.

### Settings
- **F01-AC27** The facilitator can change name, deck, control mode, auto-reveal, and
  "facilitator votes". Changes appear for everyone immediately.
- **F01-AC28** A deck change request carries `confirmReset`.
  - If the current round has votes (in either state) and `confirmReset` is false, the server
    rejects it with `confirmation_required`. With `confirmReset: true` it applies the deck and
    resets the round.
  - The client shows a confirmation dialog when votes exist, and also when the server answers
    `confirmation_required`.
  - Selecting the current deck is not a change.

### Connection
- **F01-AC29** Reconnect behavior:
  - When the connection drops, a non-blocking "reconnecting…" indicator (polite live region)
    appears after 1 s.
  - While disconnected, cards are disabled and no vote is queued.
  - The client retries with exponential backoff: 0.5 s initial, ×2, 15 s maximum, ±20% jitter,
    forever. The backoff is configurable in test mode.
  - On reconnect the client receives the full room state, including its own vote, and the
    indicator hides.
  - If the server reports the participant removed or the room not found, the client shows the
    AC23 or AC6 screen instead.
- **F01-AC30** After 10 s or more without messages, the room may be evicted from memory while
  connections stay open (hibernation). A message on an existing connection after eviction is
  processed with all room state intact: settings, topic, round state, votes, participants,
  roles, and the identity of connected sockets. Verified by:
  - a backend test that discards in-memory state while keeping sockets open, or documents why
    the test runtime can't do this;
  - an e2e smoke test using a test-mode eviction hook.

### Cross-cutting
- **F01-AC31** Room Durable Objects are only obtained through a single helper that uses the EU
  jurisdiction ([ADR 0002](../decisions/0002-eu-data-residency.md)). A backend test asserts
  `id.jurisdiction === "eu"`.
- **F01-AC32** Logs contain IDs only: no names, topics, votes, or tokens.
- **F01-AC33** Accessibility (WCAG 2.2 AA):
  - No serious or critical axe violations on any F01 screen.
  - Keyboard-only users can create, join, vote, reveal, and reset.
  - Reveal, copy-link feedback, and connection status are announced via live regions.
  - Lowest/highest, voted, and online states have non-color cues.
  - Animations respect `prefers-reduced-motion`.
- **F01-AC34** Custom deck: 1–20 value cards, unique case-insensitively, each 1–4 graphemes.
  `?` and `☕` are appended automatically and can't be entered. Invalid input shows an inline
  error.
- **F01-AC35** With "facilitator votes" off:
  - The facilitator sees no cards and is excluded from x/y and auto-reveal.
  - Turning it off in `voting` state withdraws the facilitator's vote. After reveal, AC18 applies.
- **F01-AC36** A participant can change their own display name after joining, with the same
  rules as AC4 and AC8.
- **F01-AC37** Rate limits:
  - 5 room creations per minute per IP;
  - 120 joins (WebSocket upgrades) per minute per IP, sized for teams sharing an office IP;
  - 20 messages per 10 s per connection.

  Exceeding a limit returns a `rate_limited` error. The connection stays open.

## UI notes

- Mobile: cards in a grid below the topic; the participant list is a collapsible panel.
  Desktop: participants in a sidebar.
- Reveal has a short card-flip animation that respects `prefers-reduced-motion`.
- The page title includes the room name.

## Out of scope for F01

Story list (F02), export and expiry (F03), accounts (F04).
