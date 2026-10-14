# @pokr/shared

The contract between `apps/web` and `apps/api` for F01 (rooms and voting): schemas and types
(valibot, types are inferred), constants, and the pure logic both sides must agree on. Source
only, import from `@pokr/shared`. Spec: `docs/specs/01-rooms-and-voting.md`. ADR 0001: messages
are plain JSON discriminated unions on `type`, with no WebSocket-specific fields.

Everything free-text goes through the schemas (`DisplayNameSchema`, `RoomNameSchema`,
`TopicSchema`, `CustomCardsSchema`), which normalize (Unicode NFC first, then trim, collapse spaces), reject control
characters and newlines (a tab is rejected, not collapsed), and count graphemes. Use them on the
client for inline errors and on the server at the boundary. Use `parseClientMessage` /
`parseServerMessage` to parse frames.

## Modules

| Module        | What                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constants`   | Limits, timers, backoff, rate limits (import these; never copy numbers)                                                                                             |
| `text`        | `normalizeText`, `graphemeLength`, `textSchema`                                                                                                                     |
| `deck`        | Decks, `resolveDeck`, `isNumericDeck`, `cardSlug`, `DeckSchema`, `CustomCardsSchema`                                                                                |
| `settings`    | Settings schemas, `DEFAULT_SETTINGS`, `applySettings`, roles, control modes                                                                                         |
| `room-id`     | `generateRoomId`, `isRoomId`, `normalizeRoomId`                                                                                                                     |
| `summary`     | `computeSummary(deck, votes)`: distribution, average, median, consensus, lowest/highest                                                                             |
| `voting`      | `isVoter`, `votedCounter` ("x of y"), `shouldAutoReveal`                                                                                                            |
| `permissions` | `canRevealOrReset`, `canManageRoom`, `canClaimFacilitator`, F02: `canManageStories`, `canAcceptEstimate`, `canSelectStory`, `canStartRoundOrReveal`, `canViewStory` |
| `stories`     | F02: story schemas, `StorySource`, `parseBulkLines`, `moveStory`, `moveTarget`, `nextStoryId`, `computeProgress`, `sumEstimates`                                    |
| `estimate`    | F02: `quickPicks(deck, votes)` (consensus, rounded-up median, cards), `isEstimateCard`                                                                              |
| `backoff`     | `backoffDelayMs(attempt, config?)`                                                                                                                                  |
| `errors`      | `ERROR_CODES`, `TERMINAL_ERROR_CODES`, `ERROR_HTTP_STATUS`                                                                                                          |
| `state`       | `RoomState` snapshot                                                                                                                                                |
| `http`        | Paths and HTTP/test-hook schemas                                                                                                                                    |
| `ws`          | `ClientMessage`, `ServerMessage`, frames, parse/serialize helpers                                                                                                   |

## HTTP

| Request                               | Response                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `POST /api/rooms` `CreateRoomRequest` | 201 `{roomId, participantId, token}`; 400 `invalid_input`; 429 `rate_limited`                    |
| `GET /api/rooms/:roomId`              | 200 `{roomId, name, full}`; 404 `room_not_found` (malformed or never created; writes no storage) |
| `GET /api/rooms/:roomId/ws` (upgrade) | WebSocket; 404 `room_not_found` before upgrade                                                   |

Errors are `{error: {code, message?, field?, retryAfterMs?}}`, status from `ERROR_HTTP_STATUS`.
Room page URL: `/r/<roomId>`; IDs are 16 lowercase Crockford base32 chars, lookups are case-insensitive
(`normalizeRoomId`).

`CreateRoomRequest`: `{displayName, settings?: {name?, deck?, controlMode?, autoReveal?, facilitatorVotes?}}`.
Omitted settings use defaults. The creator is the facilitator and a voter; the response token is
used with `rejoin`.

### Test-mode hooks (`/api/__test/...`; 404 outside test mode; production must not honor them)

- `POST /api/__test/rooms/:roomId/timers` `{heartbeatTimeoutMs?, offlinePurgeMs?, facilitatorClaimMs?, joinTimeoutMs?}` -> 204. Per room.
- `POST /api/__test/rooms/:roomId/evict` `{mode: "drop_memory" | "abort"}` -> `{previousInstanceId}`.
  `drop_memory` discards in-memory state but keeps sockets (hibernation path, F01-AC30);
  `abort` closes sockets (reconnect path).
- `GET /api/__test/rooms/:roomId/instance` -> `{instanceId}`; changes when the room is re-instantiated or memory dropped.
- The hooks live under `/api/` because only `/api/*` runs the Worker first; any other path is served by the SPA fallback.
- Test mode is on only when the Worker var `POKR_TEST_MODE` is exactly `"1"` (`wrangler dev --var POKR_TEST_MODE:1`);
  it is not declared in `wrangler.jsonc`. Everything else, including the header below, is ignored otherwise.
- Rate-limit key override: in test mode, `x-pokr-test-client-key: <string>` replaces the client IP as the key
  for `POST /api/rooms` (5/min) and the WebSocket upgrade (120/min). Give each
  test a unique value. In test mode a cookie named `x-pokr-test-client-key` is also read (browser WebSocket handshakes do not carry Playwright's extra headers, but do carry cookies); the header wins over the cookie, then `CF-Connecting-IP`, then `"unknown"`. Outside test mode both are ignored. Without it the key is `CF-Connecting-IP`, or
  `"unknown"` locally.
- The client backoff is overridden by passing a `BackoffConfig` to `backoffDelayMs` (frontend decides how it is injected).

## WebSocket protocol

Connect to `/api/rooms/:roomId/ws`. **No credentials in the URL.** The first client message must
be `join` or `rejoin`, within `JOIN_TIMEOUT_MS` (10 s), otherwise the server closes.

### Lifecycle

1. **Fresh join** (no stored token for this room): check `GET /api/rooms/:id` (`full` -> show the
   room-full page), ask for name and role, connect, send `{type:"join", name, role}`.
   Server replies `joined {participantId, token}` (store the token per room) then `state`.
   Full room: `error room_full` (fatal).
2. **Rejoin** (token stored; also the creator right after `POST /api/rooms`): connect, send
   `{type:"rejoin", token}`. Server replies `joined {participantId}` then `state`. A valid token is
   always admitted, even when the room is full. Unknown token (purged, or never valid): `error invalid_token`
   (fatal): discard the token and show the name prompt (F01-AC5). A token of a participant who was removed
   (also while offline) gets `error removed` (fatal, close 4403) on every `rejoin`, never admitted: discard the
   token and show the removed screen (F01-AC23). The room keeps only the SHA-256 hash of the newest 200 removed
   tokens; an older one falls back to `invalid_token`. A fresh `join` after removal works normally.
3. Several tabs with one token are one participant; online while at least one connection is open.
4. **Steady state**: every state change produces a full `state` message to every connection
   (projected per recipient), then the sender gets `ack {id, version}`.
5. **Heartbeat** (F01-AC21): client sends the exact frame `{"type":"ping"}` every
   `HEARTBEAT_INTERVAL_MS` (10 s); server answers `{"type":"pong"}`. The server marks a connection
   dead after `HEARTBEAT_TIMEOUT_MS` (25 s) of silence; clean close shows offline at once.
   Pings are not counted against the message rate limit.
6. **Reconnect** (F01-AC29): on close without a terminal error, retry with `backoffDelayMs`, send
   `rejoin`, replace local state with the new `state`. Do not replay missed events; do not queue votes
   while disconnected. On a terminal error (`removed`, `room_not_found`, `room_full`, `invalid_token`;
   `fatal: true`) do not reconnect; show the matching screen.

### State snapshots, not deltas

Every change sends the whole `RoomState`. At <= 50 participants a snapshot is a few KB, outgoing
messages are free (ADR 0001), resync after reconnect or eviction is the same message as any update,
and there are no ordering or missed-event bugs. Clients ignore any `state` whose `version` is lower
than the one they hold (equal versions are identical). `version` starts at 1, increases by 1 per
visible change, and survives eviction.

`RoomState`: `roomId, version, serverTime, selfId, facilitatorId, settings, topic ('' = none),
round, participants[], myVote, canClaimAt, stories` (`stories`: F02, see below).

- `round` is `{phase:"voting", number}` or `{phase:"revealed", number, votes:[{participantId, card}], left:[{participantId, name}]}`.
  Card values of other participants exist **only** in `revealed.votes` (F01-AC11). In `voting`, others
  have only `participants[].hasVoted`; your own card is `myVote` (also in `revealed`).
  `left` lists removed participants whose revealed vote stays visible (F01-AC18).
- `participants[]` in join order: `{id, name (suffix "(2)" included), role, online, hasVoted}`. The
  facilitator is `facilitatorId`; compute "counts as a voter" with `isVoter`.
- `canClaimAt`: epoch ms on the server clock when claiming opens, `null` while the facilitator is
  online. Compare against `Date.now() + (serverTime - receivedAtClientTime)` or use `canClaimFacilitator`.
- Compute the summary client-side from `round.votes` with `computeSummary(settings.deck, votes)`.
  The deck's cards are `resolveDeck(settings.deck)`.

### Client -> server

| `type`               | Fields                                       | Who may send                                                                      |
| -------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `join`               | `name, role`                                 | anyone, first message                                                             |
| `rejoin`             | `token`                                      | anyone, first message                                                             |
| `ping`               | none                                         | any joined connection                                                             |
| `vote`               | `id, card` (`null` withdraws)                | voters (facilitator only if they count as a voter); `round_revealed` after reveal |
| `reveal`             | `id`                                         | facilitator; voters too if control mode is "everyone"; no-op if already revealed  |
| `reset`              | `id, topic?` (omit keeps topic, `""` clears) | same as reveal; allowed in `voting` and `revealed`                                |
| `set_topic`          | `id, topic`                                  | facilitator, any phase                                                            |
| `update_settings`    | `id, settings (partial), confirmReset?`      | facilitator                                                                       |
| `set_role`           | `id, role`                                   | any participant (for themselves)                                                  |
| `rename`             | `id, name`                                   | any participant (for themselves)                                                  |
| `remove_participant` | `id, participantId`                          | facilitator                                                                       |
| `hand_over`          | `id, participantId`                          | facilitator; target must be online                                                |
| `claim_facilitator`  | `id`                                         | any online non-facilitator, once `canClaimAt` has passed                          |

`id` is a client-chosen string (1-64 chars) echoed in `ack`/`error`. Vote toggling is the client's
job: sending the same card you hold means send `card: null`.

### Server -> client

| `type`   | Fields                                              | Notes                                                      |
| -------- | --------------------------------------------------- | ---------------------------------------------------------- |
| `joined` | `participantId, token?`                             | token only after fresh `join`                              |
| `state`  | `state: RoomState`                                  | full snapshot for this recipient                           |
| `ack`    | `id, version`                                       | command done (also for no-ops); its `state` was sent first |
| `error`  | `id?, code, message?, field?, fatal, retryAfterMs?` | `id` set when answering a command                          |
| `pong`   | none                                                | exact frame `{"type":"pong"}`                              |

A participant removed while connected receives `error {code:"removed", fatal:true}` and the
connection closes. `rate_limited` keeps the connection open (F01-AC37).

### Error codes (stable; only ever added)

| Code                    | Meaning                                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `not_allowed`           | Role or control mode doesn't permit it (AC13), incl. observer voting     |
| `room_not_found`        | Malformed or never-created room (AC6). Terminal                          |
| `room_full`             | 50 participants and not in the list (AC7). Terminal                      |
| `round_revealed`        | Vote or withdraw after reveal                                            |
| `confirmation_required` | Deck change discards votes and `confirmReset` was false (AC28)           |
| `target_offline`        | Hand-over target not online (AC24)                                       |
| `already_claimed`       | Another participant claimed first (AC25)                                 |
| `rate_limited`          | Limit exceeded (AC37); `retryAfterMs` set                                |
| `invalid_input`         | Schema failure; `field` names the field (replaces `invalid_name` etc.)   |
| `removed`               | You were removed (AC23), also on `rejoin` with a removed token. Terminal |
| `invalid_card`          | Card not in the room's deck                                              |
| `invalid_token`         | Unknown token; start a fresh join. Terminal                              |
| `not_joined`            | Command before `join`/`rejoin`                                           |
| `already_joined`        | Second `join`/`rejoin` on a connection                                   |
| `unknown_target`        | `participantId` not in the room                                          |
| `claim_not_available`   | Claim before `canClaimAt`, or the facilitator is online                  |
| `internal_error`        | Server fault                                                             |

`invalid_input` messages describe the rule and never echo the input.

## Stories (F02, spec rev 2: `docs/specs/02-story-list.md`)

### Settings and round id

- `settings.storySource: "topic" | "stories"` (default `"topic"`), through create and `update_settings`.
  `"tracker"` is rejected as `invalid_input` until F05. Changing it clears the active story, resets the
  round, keeps the list and the `topic` text.
- **Round id = `round.number`** (existing, strictly increasing, survives eviction). The server bumps it
  for every new round: reset, select, next, skip-and-next, delete or skip of the active story (room
  becomes idle), source switch. There is no separate id.
- **Idle** = `settings.storySource === "stories"` and `stories.activeId === null` (`isIdle`). Votes,
  reveal, reset and accept get `no_active_story`; auto-reveal never fires.
- **Unsaved round** (`isRoundUnsaved(state)`): at least one vote, and in `voting`, or `revealed` with
  `stories.acceptedRound !== round.number`. In Free topic mode: any vote. The server enforces; the client
  uses the helper to decide whether to show the confirmation dialog.

### Confirmation flags (one convention)

`confirmReset: boolean` (default false) acknowledges **discarding an unsaved round**, exactly as in
F01-AC28. It is on `select_story`, `next_story`, `skip_story`, `delete_story` and `update_settings`
(source switch and deck change). `delete_story` also has `confirmDelete` (acknowledges deleting an
**estimated** story). Without the needed acknowledgement the server answers `confirmation_required`
with `field` = `"confirmReset"` or `"confirmDelete"` (the first missing one, `confirmReset` first), and
changes nothing. Only the active story's round can be unsaved: skip/delete of another story needs none.

### Snapshot: `RoomState.stories`

| Field           | Type                                | Notes                                                                                                                                                                              |
| --------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agendaVersion` | int >= 0                            | +1 on any change of the agenda block (below). Persisted.                                                                                                                           |
| `activeId`      | string or null                      | null unless source is `"stories"`.                                                                                                                                                 |
| `acceptedRound` | number or null                      | round id in which the active story's current estimate was accepted.                                                                                                                |
| `progress`      | `{estimated, outOf, skipped}`       | "7 of 10 estimated, 2 skipped": `outOf` = non-skipped stories. Always present.                                                                                                     |
| `sum`           | `{value: string or null, excluded}` | `value` null on non-numeric decks or when nothing could be counted; `excluded` = estimates that are not numbers under the current deck. Exact decimals, `½` = 0.5. Always present. |
| `agenda?`       | `{rows[], activeDescription}`       | the agenda block; **absent when the recipient already holds `agendaVersion`**.                                                                                                     |

`rows[]` in order: `{id, title, link|null, hasDescription, status, estimate|null, rev, tracker|null}`.
`status` is the **stored** status `pending | estimated | skipped`; "active" is derived
(`displayStatus(row, activeId)`), so a re-voted story is active and keeps its estimate. Invariants:
`estimated` <=> `estimate !== null`; `skipped` => no estimate. `tracker` is reserved for F05/F06 (always
null, not editable). `activeDescription` is the active story's Markdown source ('' when idle or empty);
`composeActiveStory(held, activeId)` joins row and description. Other descriptions and final rounds
come from `get_story`; `rev` changes on every edit (cache key).

### Keeping the agenda in sync (AC16)

Server rules (who gets `stories.agenda`):

1. Every `state` answering `join`, `rejoin` or `resync` carries it (to that connection only).
2. A broadcast caused by a change that bumped `agendaVersion` carries it, to everyone.
3. Every other broadcast (vote, withdraw, reveal, reset of the same story, presence, role/rename,
   settings, claim, timer pushes) omits it. `agendaVersion`, `activeId`, `acceptedRound`, `progress`
   and `sum` are always sent (under 300 bytes).
   `agendaVersion` bumps on: add, bulk add, edit, delete, move, skip, restore, accept, any change of
   `activeId` (select, next, skip-advance, delete/skip of the active story, source switch), seeding by the
   test hook. It does not bump on votes, reveal, reset of the same story, deck changes (`sum` is recomputed
   and sent anyway).

Client rules: hold `HeldAgenda = {version, rows, activeDescription}`. For every accepted `state` (not older
than the held `version`) run `mergeAgenda(held, state.stories)`:

- `agenda` present: replace the held agenda;
- absent and `agendaVersion` equals the held version: keep it;
- otherwise `resync: true`: send `resync {id}`; the reply is a `state` with the agenda. Also send `resync`
  after `stale_round`.
  After a reconnect discard the held agenda: `rejoin` is answered by a `state` that carries it, so nothing
  can be missed while disconnected. Ordered delivery on one socket means the safety net should never fire.
  Budgets: the join/resync snapshot with 200 maximum-length stories (1,000-byte titles, 2,048-byte links,
  200-byte tracker keys) and a maximum description plus 50 participants is about 0.7 MB (test: below
  `SNAPSHOT_MAX_BYTES` = 1 MiB). A broadcast without agenda is a few KB. Links are limited to 2,048 UTF-8
  bytes and may not contain `"` or `\` so the JSON size equals the byte size.

### Client -> server (all carry `id`; `ack` may carry `storyIds` for adds)

All story commands are facilitator-only, in both control modes (`not_allowed`), except `get_story` and
`resync` (any joined participant). Check order: schema, permission, mode, story exists, round id
(`stale_round`), state rules, `no_next_story`, confirmations, story limit.

| `type`            | Fields                                    | Rules                                                                                                                                                                                                                                                                                                                                                |
| ----------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_story`       | `title, description?, link?`              | Appended. `story_limit_reached` beyond 200. Either mode.                                                                                                                                                                                                                                                                                             |
| `add_stories`     | `text`                                    | Raw pasted text, one title per line, split by the server with `parseBulkLines`. All or nothing: invalid line -> `invalid_input` with `field: "text.N"` (N = 1-based line, content never echoed), no non-blank line or more than 100 -> `field: "text"`, over 200 stories in total -> `story_limit_reached`. Either mode. `ack.storyIds` in order.    |
| `edit_story`      | `storyId, title?, description?, link?`    | Partial, last write wins, rev +1, never touches rounds or votes (also the active story). `""`/null clears description/link. No field -> `invalid_input`. Either mode.                                                                                                                                                                                |
| `delete_story`    | `storyId, confirmReset?, confirmDelete?`  | `confirmDelete` if estimated; `confirmReset` if active with an unsaved round. Deleting the active story discards its round and leaves the room idle.                                                                                                                                                                                                 |
| `move_story`      | `storyId, beforeId`                       | Directly before `beforeId`; null = end. Unknown id -> `unknown_story`, never applied elsewhere. Same position = no-op ack. No effect on active story or round. Either mode.                                                                                                                                                                          |
| `select_story`    | `storyId, confirmReset?`                  | Needs `"stories"` mode (`wrong_story_source`). Becomes active, new round, atomically. Already active: no-op ack. Selecting an estimated story = re-vote (estimate and final round kept). Skipped stories can be selected.                                                                                                                            |
| `next_story`      | `round, confirmReset?`                    | `nextStoryId(rows, activeId)`; `no_next_story` if none. Needs `"stories"` mode.                                                                                                                                                                                                                                                                      |
| `accept_estimate` | `storyId, round, estimate`                | Active story, phase `revealed` (`round_not_revealed`), current round id (`stale_round`), value card of the deck (`invalid_card`; `?`/coffee rejected). Stores estimate, status `estimated`, `acceptedRound`, and replaces the final round. Overwrites within the same round. Does not change the round or advance. Empty revealed round is accepted. |
| `skip_story`      | `storyId, round, advance?, confirmReset?` | Pending story -> skipped; estimated/skipped -> `invalid_story_state`. Active story: round discarded, room idle, or with `advance` the next story becomes active in one step (no `no_next_story` error; idle if none).                                                                                                                                |
| `restore_story`   | `storyId`                                 | skipped -> pending, otherwise `invalid_story_state`.                                                                                                                                                                                                                                                                                                 |
| `get_story`       | `storyId`                                 | Reply `story {id, story: StoryDetail}` then `ack` (same version). Everyone, observers included.                                                                                                                                                                                                                                                      |
| `resync`          | none                                      | Reply: your `state` with the agenda, then `ack`.                                                                                                                                                                                                                                                                                                     |

`reveal`/`reset`: facilitator, or voters (not observers) in "everyone" mode (`canStartRoundOrReveal`).
`set_topic` and `reset {topic}` in `"stories"` mode -> `wrong_story_source`. `vote`/`reveal`/`reset` while idle ->
`no_active_story`. Each story command is one message for the rate limit.

Text rules (shared schemas, identical on both sides):

- **Title**: F01 normalization, 1-200 graphemes, at most 1,000 UTF-8 bytes.
- **Description**: NFC, CRLF/CR -> LF, leading blank lines and trailing whitespace trimmed, internal spaces,
  tabs and newlines kept, other control characters rejected; at most **5,000 graphemes of the normalized
  text and 20,000 UTF-8 bytes** (a newline is one grapheme); raw input guard 20,000 UTF-16 units.
- **Link**: trimmed, absolute http/https with a host, no whitespace/control chars, no `user:pass@`, no `"` or
  `\`, at most 2,048 characters and 2,048 bytes; stored as entered; `""` clears.
- Inbound WebSocket frames: `MAX_CLIENT_FRAME_CHARS` = 65,536 (HTTP bodies stay at 16,384). The largest valid
  message (100 maximum-length titles, `BULK_TEXT_MAX_CHARS` = 56,000) is about 52 KB. `parseServerMessage`
  accepts `MAX_SERVER_FRAME_CHARS` = 4 MiB.

### Server -> client

New message `story {id, story}`: `StoryDetail` = row fields (including `tracker`) + `description` +
`finalRound: {number, votes: [{participantId, name, card}]} | null`. The final round is visible to everyone.
`name` is **null once the participant was removed** (the server erases the name, keeps the vote); the client
shows its localized "Removed participant". Renames do not change snapshots. New error codes (stable):
`story_limit_reached`, `unknown_story`, `no_active_story`, `no_next_story`, `invalid_story_state`,
`wrong_story_source`, `stale_round`, `round_not_revealed`.

### Persistence contract (AC17, what must survive `drop_memory` / `abort`)

Agenda (order, fields, statuses, estimates, rev, tracker), `activeId`, `acceptedRound`, `agendaVersion`, round
number, final-round snapshots, `storySource`. One storage row per story (final round as a JSON column of that row).
Never in logs or KV.

### Test-mode hooks for stories (404 outside test mode, under `/api/__test/`)

- `POST /api/__test/rooms/:roomId/stories` `TestSeedStoriesRequest` -> 201 `{storyIds, version}` (QA H1 and H4).
  Appends `count` stories (`Story 001 ` + filler), with optional `titleLength`, `descriptionLength`, `linkLength`
  (exact from 13 characters up: `https://a.bc/` plus `a`s), `emoji` (4-byte filler), `estimated` (first N get a deck card and a final round of `finalRoundVotes`
  synthetic voters, default 3), `skipped` (the next N). Skips the message rate limit, keeps the 200 cap
  (`409 story_limit_reached`, nothing added). Bumps the version and broadcasts like a normal add.
- `GET /api/__test/rooms/:roomId/storage` -> `{entries: [{key, bytes}], totalBytes, finalRounds: [{storyId, finalRound}]}`
  (QA H2). Keys are `<table>/<primary key>` such as `stories/<id>`; tokens are listed by size only.

## Limits and timers (see `constants.ts`)

50 participants; name 1-30, room name 0-80 (empty = "Planning session"), topic 0-200, custom deck
1-20 cards of 1-4 graphemes; heartbeat 10 s / timeout 25 s; offline purge 10 min; facilitator claim
5 min; reconnect backoff 0.5 s x2 up to 15 s, +/-20% jitter, "reconnecting" indicator after 1 s;
stories 200 per room, 100 per bulk add, title 1-200, description <= 5,000, link <= 2,048; rate limits 5 creates/min/IP, 120 joins/min/IP, 20 messages/10 s/connection.

## Tests

`pnpm --filter @pokr/shared test`. Test names carry AC IDs.

## Server behavior notes (apps/api)

- Handshake errors that are not terminal (e.g. `invalid_input` for a bad name on `join`) keep the socket open so the client can fix the input and resend `join` on the same connection. `not_joined` / `already_joined` also keep it open. Terminal errors send `error {fatal:true}` then close with `WS_CLOSE_CODES`.
- A no-op command (e.g. repeated `reveal`) answers with the sender's current `state` then `ack` (same version).
- `already_claimed` is returned for a claim within 10 s of a successful claim; otherwise a claim while the facilitator is online is `claim_not_available`.
- On claim the former facilitator's role becomes `voter`. On handover both keep their roles.
- When the claim threshold passes the server pushes a fresh `state` (same version, new `serverTime`).
- Rate-limited HTTP responses are 429 with `Retry-After`; `retryAfterMs` is the window length (the binding does not report the remainder).
- Join limit (120/min/IP) counts only the WebSocket upgrade (so reconnects count). `GET /api/rooms/:id` is not limited by the binding.
- A clean close marks the participant offline after a ~400 ms grace period, unless a connection with the same token arrives first (page reloads cause no offline flicker). Offline is still shown within 1 s.
- Join timeout: a socket that sends nothing for `JOIN_TIMEOUT_MS` is closed with 4408, enforced server-side (`joinTimeoutMs` in the timers hook shortens it). Enforced by the alarm; the server socket is closed on time. Local `wrangler dev` quirk: if the client has sent no frame at all, workerd completes the close handshake to the peer only when the object is evicted, about 10 s later, so a silent client sees the `close` event at roughly 2x the timeout (no error frame is sent). A client that has sent anything (even a ping) sees it promptly. Allow 25 s, or send a ping first.

### F02 server behavior notes (apps/api)

- Story IDs are 12 lowercase Crockford base32 characters. Storage: table `stories` (one row per story, sparse
  integer `position` 1024 apart; a move writes one row, the list is renumbered only when a gap is used up) and
  `story_meta` (`active_story_id`, `accepted_round`, `agenda_version`). Rooms stored before F02 get both lazily;
  a missing `storySource` reads as `"topic"`.
- Final rounds are cached nowhere on the server. A client that caches `get_story` results must not cache
  `finalRound` across participant removals (the server nulls the name without bumping `rev` or `agendaVersion`);
  refetch when the detail is opened.
- Purged (not removed) participants keep their names in snapshots; only `remove_participant` anonymizes.
- A no-op story command (select the active story, move to the same place, an edit that changes nothing) answers
  with the sender's `state` (without agenda) and `ack` at the same version.
- Unknown or unsupported command types are `invalid_input` (schema) and never silently ignored.
- Stress: `pnpm --filter @pokr/api stress` runs both the vote burst and the story scenario (`--scenario votes|stories`).
