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

## Stories (F02, draft contract, spec `docs/specs/02-story-list.md`)

Behaviors marked _proposed_ are answers to open questions in the F02 handoff and are not final until
the spec is updated.

**Settings.** `settings.storySource: "topic" | "stories"` (default `"topic"`; `"tracker"` is added by
F05/F06). Set through `create` / `update_settings` like any setting. Any change resets the round
(F02-AC1) and needs `confirmReset: true` when the round has votes (_proposed_, same as a deck change).
Leaving `"stories"` clears the active story, the list is kept (_proposed_). The `topic` text is kept
but unused while the source is `"stories"` (_proposed_).

**Snapshot.** `RoomState.stories`: `{agenda[], activeId, active, progress, sum}`.

- `agenda[]` in order: `{id, title, link|null, hasDescription, status, estimate|null, rev}`.
  `status` is derived: `active` for the active story (even when it still holds an earlier estimate,
  F02-AC12), else `estimated` (has an estimate), `skipped`, or `pending`.
- `active`: the agenda row plus `description` (Markdown source; render it sanitized, F02-AC8), or null.
  `activeId` is its id. Both null unless `storySource` is `"stories"`.
- `progress`: `{estimated, skipped, total}`; `estimated` counts stories holding an estimate
  (`computeProgress`). "7 of 12 estimated" is `estimated` of `total`; whether skipped stories leave
  the denominator is open.
- `sum`: sum of estimates for numeric decks, else null (`sumEstimates`). Exact, "34", "34.5".
- Descriptions are **not** in the agenda (size). A story's description and final round are fetched
  with `get_story`; `rev` changes on every edit, use it as the cache key.
- `round` is unchanged. In stories mode, `round.number` still counts rounds of the room; the round
  belongs to `stories.activeId`.

**Client -> server** (all carry `id`; `ack` has an optional `storyIds` for adds):

| `type`            | Fields                                 | Who                             | Notes                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_story`       | `title, description?, link?`           | facilitator                     | Appended at the end. Max 200 stories (`story_limit_reached`). Allowed in either source.                                                                                                                                                                                                           |
| `add_stories`     | `titles[1..100]`                       | facilitator                     | Atomic: one bad title or exceeding 200 rejects all. Use `parseBulkLines` for inline errors.                                                                                                                                                                                                       |
| `edit_story`      | `storyId, title?, description?, link?` | facilitator                     | Partial. `description:""` and `link:""`/`null` clear. No field -> `invalid_input`. Active story updates live, round unchanged (_proposed_). Estimate kept.                                                                                                                                        |
| `delete_story`    | `storyId, confirm?`                    | facilitator                     | `confirmation_required` if estimated (AC4), or (_proposed_) active with votes. Deleting the active story leaves none active and starts a fresh round.                                                                                                                                             |
| `move_story`      | `storyId, beforeId`                    | facilitator                     | Move directly before `beforeId`; `null` = to the end. Unknown id -> `unknown_story`, no guessing. Same position = no-op ack. `moveTarget` maps keyboard up/down/top/bottom. No effect on the active story or round.                                                                               |
| `select_story`    | `storyId`                              | facilitator (_proposed_)        | `storySource` must be `"stories"` (`wrong_story_source`). Becomes active, new round (votes discarded, no confirmation). Re-vote of an estimated story = select it (estimate kept until a new one is accepted). Already active: no-op, use `reset`.                                                |
| `next_story`      | none                                   | facilitator                     | `nextStoryId(agenda, activeId)`. `no_next_story` if none. Wraps; skipped are not "unestimated" (_proposed_).                                                                                                                                                                                      |
| `accept_estimate` | `storyId, round, estimate`             | facilitator, also in "everyone" | Needs the active story, phase `revealed`, `round` = current round number (`stale_round` otherwise), `estimate` a value card of the deck (`isEstimateCard`; else `invalid_card`). Stores the final round's votes (names snapshotted). Replaces an earlier estimate. Does not advance (_proposed_). |
| `skip_story`      | `storyId, advance?`                    | facilitator                     | Marks skipped. An estimated story cannot be skipped (`invalid_story_state`, _proposed_). Skipping the active story deactivates it; with `advance` it atomically continues like `next_story` (no error when nothing is left).                                                                      |
| `get_story`       | `storyId`                              | any joined participant          | Reply `story {id, story}` (agenda row + `description` + `finalRound: {number, votes[{participantId,name,card}]} \| null`), then `ack`. Not a state change.                                                                                                                                        |

There is deliberately no `revote` message: re-voting the active story is `reset`, re-voting another
estimated story is `select_story`. Existing `vote`, `reveal` and `reset` keep working, with
`no_active_story` when `storySource` is `"stories"` and nothing is active (_proposed_).
`set_topic` and `reset {topic}` in stories mode -> `wrong_story_source`. `reveal`/`reset`: facilitator,
or voters in "everyone" mode (F02-AC6), via `canStartRoundOrReveal`.

**Server -> client.** New message `story` (reply to `get_story`). New error codes:
`story_limit_reached`, `unknown_story`, `no_active_story`, `no_next_story`, `invalid_story_state`,
`wrong_story_source`, `stale_round`.

**Text rules.** Title: like all F01 text (NFC, trim, collapse, no control chars/newlines), 1-200
graphemes. Description: NFC, CRLF/CR -> LF, leading blank lines and trailing whitespace trimmed,
internal spaces, indentation, tabs and newlines kept (Markdown is whitespace-sensitive), other control
characters rejected, **max 5,000 graphemes** of the normalized text (graphemes like every F01 limit, so
5,000 emoji fit; a newline is one grapheme), raw input guard 20,000 UTF-16 units. Link: trimmed, <= 2,048
units, `http:`/`https:` with a host, no whitespace/control chars, no `user:pass@`; stored as entered.

**Frame sizes.** Inbound WebSocket frames may be up to `MAX_CLIENT_FRAME_CHARS` (65,536; was
`MAX_MESSAGE_CHARS` = 16,384, which stays the HTTP body limit): a 100-line bulk add is up to ~40 KB.
`parseServerMessage` accepts up to `MAX_SERVER_FRAME_CHARS` (4 MiB; was 16,384, too small for a
snapshot with a full agenda).

**Snapshot size.** Typical agenda row ~150 bytes -> 200 stories ~30 KB. Worst realistic row (200
four-byte emoji title, 2,048-char link) ~3 KB -> ~0.6 MB. Absolute bound (titles at the 4,096-unit raw
guard) ~3 MB, under the 4 MiB client limit and far under the 32 MiB WebSocket message limit. Because
descriptions stay out of the agenda, the large item is at most the active description (<= 60 KB
bound, ~1 KB typical). Durable Object SQLite limits a row/value to 2 MB: **store one row per story**
(a single JSON blob of 200 x 5,000-char descriptions would not fit).

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
