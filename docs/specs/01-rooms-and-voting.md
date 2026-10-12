# F01: Rooms and voting

- Status: Draft
- Depends on: none
- Owners: backend-dev (room Durable Object, contract), frontend-dev (UI), devops-engineer (Durable Object binding, environments, CI)

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

## Acceptance criteria

### Create a room
- **F01-AC1** Given the start page, when I enter my name and optionally a room name, deck,
  and control mode, then a room is created, I join as facilitator, and the room URL is shown
  with a copy button.
- **F01-AC2** Room URLs have the form `/r/<roomId>`, where `roomId` is unguessable (≥ 80 bits).
- **F01-AC3** Settings not chosen at creation use the defaults from the [overview](00-product-overview.md#room-settings).

### Join
- **F01-AC4** Given a room link, when I open it for the first time, then I'm asked for a display
  name (1–30 chars) and whether to join as voter or observer.
- **F01-AC5** Given I have joined before from this browser, when I reopen the link, then I
  rejoin as the same participant without being asked again.
- **F01-AC6** Given a link to a room that doesn't exist or has expired, then I see a clear
  "room not found" page with a button to create a new room.
- **F01-AC7** Given a room with 50 participants, when someone else tries to join, then they see
  a "room is full" message.
- **F01-AC8** Duplicate display names are allowed. The UI tells them apart (e.g. "Alex (2)").

### Vote
- **F01-AC9** Given a round in `voting` state, when I select a card, then my card is highlighted
  for me and others see a "voted" indicator next to my name, never the value.
- **F01-AC10** Given I have voted, when I select a different card or click my card again, then my
  vote changes or is withdrawn.
- **F01-AC11** The server never sends vote values to any client before reveal. Verified by a
  backend test that inspects all outgoing messages during a `voting` round.
- **F01-AC12** Observers have no cards; they are not counted in "x of y voted".

### Reveal
- **F01-AC13** Given control mode "facilitator only", only the facilitator sees the reveal and
  reset controls. Given "everyone", all voters see them.
- **F01-AC14** When the round is revealed, all participants see every vote next to the voter's
  name at the same moment.
- **F01-AC15** The summary shows:
  - the distribution (count per card)
  - for numeric decks: average (1 decimal) and median, excluding `?` and `☕`
  - a "consensus" badge when all numeric votes are equal
  - the lowest and highest voters highlighted when they differ
- **F01-AC16** Given auto-reveal is on, when the last voter votes, then the round reveals
  automatically.
- **F01-AC17** Revealing with zero votes is allowed and shows "no votes".
- **F01-AC18** After reveal, votes can't be changed.

### Reset and topic
- **F01-AC19** When the round is reset, all votes are cleared, state returns to `voting`, and the
  topic field is kept so the facilitator can edit it.
- **F01-AC20** The facilitator can set an optional topic (max 200 chars), shown to everyone above
  the cards.

### Presence and roles
- **F01-AC21** The participant list shows name, role, online/offline, and voted state.
  Participants who disconnect show as offline immediately. They are removed from the list after
  10 minutes offline, unless they have a vote in the current round.
- **F01-AC22** Offline voters don't block auto-reveal: "all voted" counts online voters only.
- **F01-AC23** The facilitator can remove a participant. The removed participant sees "you were
  removed from the room" and can rejoin via the link.
- **F01-AC24** The facilitator can hand the role to another online participant, who becomes
  facilitator immediately. The old facilitator becomes a voter.
- **F01-AC25** If the facilitator is offline for more than 5 minutes, any online participant can
  claim the facilitator role.
- **F01-AC26** Any participant can switch themselves between voter and observer. Switching to
  observer withdraws a vote in the current round.

### Settings
- **F01-AC27** The facilitator can change name, deck, control mode, auto-reveal, and
  "facilitator votes". Changes appear for everyone immediately.
- **F01-AC28** Changing the deck while the current round has votes asks for confirmation and
  resets the round.

### Connection
- **F01-AC29** When the connection drops, a non-blocking "reconnecting…" indicator appears. The
  client retries with backoff. On reconnect it receives the full room state, and my vote in the
  current round is preserved.
- **F01-AC30** An idle room (no messages) hibernates and resumes with all state intact.
  Verified by a backend test that evicts the Durable Object and reconnects.

## UI notes

- Mobile: cards in a grid below the topic; the participant list is a collapsible panel.
  Desktop: participants in a sidebar.
- Reveal has a short card-flip animation that respects `prefers-reduced-motion`.
- The copy-link button gives visible and screen-reader feedback.

## Out of scope for F01

Story list (F02), export and expiry (F03), accounts (F04).
