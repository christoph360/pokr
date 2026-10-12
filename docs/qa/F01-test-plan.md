# F01 test plan: Rooms and voting

- Spec: `docs/specs/01-rooms-and-voting.md` (Draft), `docs/specs/00-product-overview.md`
- ADRs: 0001 (WebSockets + Hibernation), 0002 (EU jurisdiction)
- Author: qa-engineer
- Status: Draft v1, written before implementation. Section 6 (spec issues) must be resolved
  before implementation starts. Rows marked "(pending SI-nn)" may change with the resolution.

## 1. Approach and levels

| Level | Meaning | Written by |
| --- | --- | --- |
| e2e | Playwright, real browsers, local `wrangler dev` + `ng serve` | qa-engineer, `e2e/` |
| backend | Vitest on the room Durable Object / Worker, plus raw WebSocket clients | backend-dev (QA reviews coverage) |
| frontend unit | Angular component / service tests | frontend-dev (QA reviews coverage) |
| manual | Cannot be automated reliably; checklist in the F01 report | qa-engineer |

Principles:
- Every e2e test creates its own room and is independent (parallel-safe). Test names start with
  the criterion IDs, e.g. `F01-AC14: all participants see votes at the same moment`.
- Locators: role, label, `data-testid` only. No fixed sleeps; wait on visible state or on a
  state version exposed by the app.
- Where the UI can't force a race or a rare state (50 participants, 10-minute timers, message
  interleaving), e2e drives raw WebSocket clients built on the types in `packages/shared`, in
  addition to the browser contexts. A browser context is expensive; use at most 4 per test.
- Flaky tests are reported as defects, never retried until green.

## 2. Coverage table (F01-AC1 to F01-AC30)

"Ctx" = number of browser contexts (separate participants) needed for the e2e part. "+raw" means
additional raw WebSocket clients are used.

| AC | Level | Scenario(s) | Ctx |
| --- | --- | --- | --- |
| AC1 | e2e; frontend unit (form validation) | Start page: enter name only, create, land on `/r/<id>` as facilitator (facilitator badge, reveal/reset/settings visible); room URL shown, copy button works and gives visible + `aria-live` feedback (clipboard content asserted on Chromium only). Variant: name + room name + non-default deck + "everyone" control mode, assert each is reflected in the room. Negative: empty name blocked; 31-char name blocked. | 1 |
| AC2 | backend; e2e (format only) | Backend: generator test (length/alphabet per SI-19, 10k IDs, no collisions, uses CSPRNG, not `Math.random`). e2e: URL matches `^/r/[A-Za-z0-9_-]{N,}$`; 20 created rooms all different. Negative: `/r/` with invalid characters or wrong length shows "room not found", not a crash. | 1 |
| AC3 | e2e; backend | Create with only a name; open settings: name "Planning session", Fibonacci deck (0, ½, 1, 2, 3, 5, 8, 13, 21, ?, ☕), Facilitator only, auto-reveal off, facilitator votes on, free topic. Backend asserts the persisted default object. | 1 |
| AC4 | e2e; frontend unit | Second context opens link: name prompt with voter/observer choice. Boundaries: 0 chars (blocked), whitespace-only (blocked, SI-17), 1 char ok, 30 ok, 31 blocked (and server rejects a 31-char name sent via raw WS). Default role selection is voter. Join as observer: no cards. | 2 |
| AC5 | e2e; backend | Join, close page, reopen same link in same context: no prompt, same participant (one list entry, same role, vote retained). Reload mid-round keeps vote. New context (cleared storage) is a new participant. Two tabs in one context: one participant (pending SI-13). Joined as observer, return: still observer. | 2 |
| AC6 | e2e; backend | Open `/r/<well-formed random id>` never created: "room not found" page with "create new room" button that leads to start page. Backend: connecting to a never-created ID does not create a room or write storage (idFromName always resolves, see SI-20) and responds with a distinct not-found signal. Expiry: deferred to F03 (SI-20). | 1 |
| AC7 | backend; e2e (+raw) | Backend: 50 joins succeed, 51st refused with `room_full` code; mix of voters/observers; after one leaves/purged, a join succeeds; two simultaneous joins at 49 produce exactly one success. e2e: 49 raw clients + 1 browser fill the room; second browser sees "room is full" and no name form after submitting (or before, per SI-12). Offline-but-retained participants counted per SI-12 resolution. | 2 +49 raw |
| AC8 | e2e; frontend unit | Three contexts all named "Alex": list shows three distinguishable entries (suffix scheme per SI-21), in the participant list, in the revealed votes, and in the lowest/highest highlight. Also "alex" vs "Alex" and trailing space. Suffix stable when the first Alex leaves (pending SI-21). Accessible names distinguish them. | 3 |
| AC9 | e2e | Facilitator + voter. Voter selects 5: own card has selected state (`aria-checked`/`aria-pressed` plus non-color cue); facilitator's list shows "voted" next to the voter, no value anywhere in DOM text, attributes, or title/aria-label. Observer context also sees the indicator and no value. | 3 |
| AC10 | e2e; backend | Change 5 to 8: others still see only "voted", reveal shows 8. Click the same card again: vote withdrawn, indicator disappears for others, "x of y" decrements. Same via keyboard (Space/Enter). Vote for a card not in deck, via raw WS: rejected with error code. Rapid select/deselect/select: final state consistent on all clients. | 2 (+raw) |
| AC11 | e2e (frame inspection); backend (required by spec) | Backend (spec-mandated): during a `voting` round with N voters, collect every outgoing message to every connection, including initial state, resync after reconnect, and HTTP responses; assert vote values appear only in the owner's own "my vote" field (SI-01). e2e: `page.on("websocket")` recorder on every context, custom deck with unique tokens (e.g. `q7xz`, `k3vm`), each voter picks a distinct token, assert no other client's frames (text or binary), outside the deck definition and the client's own vote field, contain any token. Also checked across: late join, reload, reconnect, vote change, withdrawal, reset after reveal (no stale votes). After reveal, tokens are expected. | 4 |
| AC12 | e2e; frontend unit | Observer sees no card grid (cards absent from DOM, not just hidden). Counter "x of y voted": observer joins, y unchanged; observer cannot vote via raw WS (error code). Observer shown in list with role "observer" and no voted state. Denominator rule per SI-07. | 3 |
| AC13 | e2e; backend | Facilitator-only: voter sees no reveal/reset buttons; raw WS reveal/reset by voter rejected (`not_allowed`). Everyone: voter sees both and can use them. Observer in "everyone" mode (pending SI-09). Change mode live: voter's controls appear/disappear without reload. | 3 |
| AC14 | e2e; backend | Facilitator + 2 voters + observer. Reveal: each page shows all values next to names. Same-moment is asserted structurally: backend sends one state-version transition to all connections; e2e records the `framereceived` timestamp of the reveal in each context and asserts spread within a tolerance (SI-22), plus identical final content. No client shows values while another still shows hidden for longer than the tolerance. | 4 |
| AC15 | frontend unit (pure summary function, table-driven); e2e | Unit table: all-equal, two values, even/odd median, ½ values, `?` and `☕` excluded, rounding .x5 cases, all special cards, one vote, non-numeric deck (T-shirt: distribution only), custom numeric and custom mixed deck (pending SI-02..05). e2e: 3 voters 3/5/8 on Fibonacci: distribution, average 5.3 (rounding rule per SI-03), median 5, no consensus badge, lowest (3) and highest (8) voters highlighted with text/icon, not color only. 5/5/5: consensus badge, no highlight. T-shirt deck: no average/median. Observer sees summary. | 4 |
| AC16 | e2e; backend | Auto-reveal on, 3 voters: reveal fires on last vote only, not before; with changed vote before the last; does not fire when a voter withdraws to a non-complete state. Single voter alone. Triggers other than a vote event (disconnect, observer switch, removal, toggling the setting on with all voted, withdrawal) pending SI-06. Auto-reveal off: never auto. | 3 |
| AC17 | e2e; backend | Reveal immediately with zero votes: summary shows "no votes", no average/median/consensus/NaN. One vote: summary sensible. Revealing twice is a no-op. | 2 |
| AC18 | e2e; backend | After reveal: cards disabled in UI (not just styled); raw WS vote / withdraw rejected with code; revealed values unchanged. Late joiner as voter after reveal sees values but cannot vote. Interaction with observer switch, removal (SI-08). | 3 (+raw) |
| AC19 | e2e; backend | Set topic "T1", vote, reveal, reset: votes cleared everywhere (indicators gone, own card deselected, summary gone), state back to `voting`, topic still "T1" in facilitator's input, visible to others until edited (SI-26). Edit and save: all see new topic. Reset during `voting` (pending SI-26). Reset clears votes of offline participants. | 3 |
| AC20 | e2e; backend | Set topic: all contexts (including observer) see it above the cards. Boundaries: 0 (clears), 200 ok, 201 rejected server-side. Topic `<img src=x onerror=alert(1)>` and `<b>` rendered as literal text. Long unbroken string wraps without horizontal overflow on mobile viewport. Non-facilitator cannot set it in facilitator-only mode (pending SI-09). Multi-line/whitespace behavior per SI-17. | 3 |
| AC21 | e2e; backend | List shows name, role, online/offline, voted. Clean close (page.close) shows offline for others. Silent drop (`context.setOffline(true)`) shows offline within the documented timeout (SI-10). Purge after 10 min: backend test with injectable clock or short configured timeout; e2e uses the test-mode timeout (request R-B2). Offline participant without vote is removed after the timeout; with a vote in current round is kept; after reset the retained voter is purged (SI-11). Facilitator offline is never purged (SI-11). | 3 |
| AC22 | e2e; backend | 3 voters, auto-reveal on, one voter context goes offline before voting: other two vote, reveal fires. Offline voter who already voted: vote is included in the reveal. Offline voter returning after reveal cannot vote. Counter denominator per SI-07. | 3 |
| AC23 | e2e; backend | Facilitator removes voter: removed context shows "you were removed from the room" and does not silently reconnect in a loop (SI-14); list updates for others; removed voter's vote disappears (SI-14); rejoin via link works (new name prompt or same identity per SI-14). Non-facilitator remove via raw WS rejected. Cannot remove self or (as facilitator) be removed. Remove an offline participant. Remove frees a slot (AC7). | 3 (+raw) |
| AC24 | e2e; backend | Facilitator hands over to online voter: new facilitator controls appear immediately, old facilitator's controls disappear, old is voter, list shows one facilitator at all times. Handover target offline/ self/ nonexistent/ observer: rejected or per SI-15. Old facilitator's in-flight commands after handover rejected. Handover while old facilitator's page has settings dialog open: dialog closes or submit fails gracefully. | 3 |
| AC25 | e2e; backend | Facilitator context offline; claim control absent before threshold, present after (test-mode timeout, R-B2); online voter claims: becomes facilitator, all see it. Two simultaneous claims: exactly one wins, the other gets an error and sees the winner. Original facilitator returns after claim: is a voter (SI-16). Claim while facilitator is online (raw WS) rejected. Facilitator reconnects just before claim: claim rejected. Observer claim (SI-16). | 3 (+raw) |
| AC26 | e2e; backend | Voter votes, switches to observer: vote withdrawn for all, cards disappear, counter updates. Switch back: cards return, no vote. Facilitator switches themselves to observer. Switch after reveal (SI-08). Switch triggering auto-reveal (SI-06). | 2 |
| AC27 | e2e; backend | Facilitator changes each setting (name, deck, control mode, auto-reveal, facilitator votes); every other context updates within the realtime tolerance, no reload. Non-facilitator cannot change settings in either control mode (raw WS). Room name 80/81 chars. Invalid custom decks (SI-18). Effects of facilitator-votes off mid-round (SI-18). | 3 (+raw) |
| AC28 | e2e; backend | Votes cast, facilitator picks a new deck: confirmation dialog; Cancel: deck and votes unchanged; Confirm: new deck for all, votes cleared everywhere. No votes cast: no dialog, deck changes. Revealed round with votes (SI-23). Race: vote arrives after dialog opened (SI-23). Selecting the same deck is not a change. Raw WS deck change without confirmation flag when votes exist: rejected. | 3 (+raw) |
| AC29 | e2e (offline via `context.setOffline`); frontend unit (backoff); backend | Voter votes, context offline: non-blocking "reconnecting..." indicator (page remains interactive, no modal); others see voter offline but still "voted". Back online: indicator disappears, state resynced, own card still selected, facilitator still sees voted. While offline: round was revealed / reset / settings changed / topic changed by others: after reconnect client shows the final state, not stale. Vote cast while offline (SI-24). Repeated offline/online flapping 5x. Backoff intervals: frontend unit with fake timers. Server-side connection closed (not network): same behavior. | 2 |
| AC30 | backend (spec-mandated); e2e (smoke, via test hook) | Backend: set topic, settings, votes, roles, offline participant; abort/evict DO; reconnect; assert identical state. Because abort closes sockets, also need the true hibernation path (open sockets survive, memory dropped): see SI-25 and request R-B3. e2e smoke: room with 2 participants, force eviction through the test hook, both clients still connected or reconnect, votes intact, a new vote works. | 2 |

## 3. Additional scenarios (implied by the spec, not listed)

IDs: `X-<area>-n`. Level in brackets. These get test names `F01-X-...` and are mapped to the
nearest AC in the report.

### 3.1 Races and ordering (the DO serializes messages, so assert invariants)
- X-RACE-1 [backend + e2e raw]: two participants (everyone mode) send `reveal` at once. Exactly one
  transition to `revealed`; second is a no-op or harmless error; both clients end in identical
  state; no duplicate "revealed" announcement for screen readers.
- X-RACE-2 [backend + raw]: a vote and a reveal are sent at the same time from different
  clients, repeated 200 times. Invariant: every vote is either included in the reveal or
  rejected with an error to the sender; never silently dropped, never accepted after reveal.
  Sender's UI ends up consistent with the server (selected card equals server's value or deselected).
- X-RACE-3 [backend]: vote and reset concurrently. After reset no stale vote survives.
- X-RACE-4 [backend]: reveal and reset concurrently; reset and deck change concurrently.
- X-RACE-5 [e2e]: auto-reveal; last two voters vote at the same instant. Reveal once, both votes included.
- X-RACE-6 [e2e]: facilitator hands over to B while B simultaneously switches to observer or goes
  offline. Defined outcome per SI-15, never two or zero facilitators.
- X-RACE-7 [e2e]: facilitator handover while the old facilitator is offline: the offline
  facilitator's handover cannot occur (offline), but a claim (AC25) and the returning
  facilitator's reconnect cross; exactly one facilitator at all times.
- X-RACE-8 [e2e]: handover to a participant whose connection dropped between click and server
  processing: rejected with message, facilitator unchanged.
- X-RACE-9 [backend + raw]: two joins at 49 participants; join at 50 vs. a returning offline
  participant (AC7 and AC5).
- X-RACE-10 [e2e]: remove participant while they are casting a vote.
- X-RACE-11 [e2e]: facilitator changes deck (dialog open) while a voter votes (AC28, SI-23).
- X-RACE-12 [e2e]: two facilitators' commands crossing during handover: command from old
  facilitator processed after handover is rejected.

### 3.2 Negative paths and server-side validation (raw WS, backend + e2e)
- Malformed JSON, unknown message type, missing fields, wrong field types, oversize frame
  (> agreed limit), binary frame: connection survives or closes with defined code; room state
  unaffected; no stack trace to the client.
- Message before joining (no `join`), double `join`, `join` with another participant's token.
- Vote by observer, vote for a non-deck card, vote with value as number vs string, vote after reveal.
- reveal/reset/settings/topic/remove/handover by non-authorized participant (both control modes).
- Remove self, remove facilitator, remove nonexistent ID, hand over to self/offline/nonexistent.
- Claim facilitator while facilitator online / not yet 5 minutes / by offline participant.
- Settings values outside enums (deck "bogus", control mode "nobody"); room name 81 chars; custom
  deck with 21 cards, empty card, 5-char card, duplicate cards, whitespace-only card.
- Invalid room IDs in URL: empty, very long, path traversal characters, URL-encoded HTML.
- Expired/never-existing rooms must not be created implicitly by a WebSocket connect or a GET.
- Rate limits (NFR): exceed message rate on one connection; expect throttling response and room still
  usable by others. Thresholds unspecified, see SI-27.

### 3.3 Input and rendering (all free text: participant name, room name, topic, custom cards)
- Boundaries: name 1, 30, 31; room name 80, 81; topic 200, 201; custom card 4, 5; 20 cards, 21.
- Unicode: emoji (multi-code-point, ZWJ), combining marks, RTL text, full-width, `½` and `☕` as
  typed input. Counting unit per SI-17.
- Leading/trailing whitespace, internal runs of spaces, tabs, newlines, control characters, zero-width characters, names that
  look identical (homoglyphs): allowed or normalized per SI-17.
- HTML/script payloads in every text field: rendered as inert text in every place they appear
  (list, summary highlight, removed notice, document title, aria-labels, toasts).
- Very long unbroken names (30 chars of "W") and long topics: no layout break at 320 px width.
- Duplicate names with differing case/whitespace.

### 3.4 Lifecycle and state combinations
- Participant joins (as voter) during a revealed round: sees values, cannot vote, "x of y" sensible.
- Participant joins during voting: sees voted indicators, no values; their own join does not change others' votes.
- Round with all voters offline; reveal with only offline voters' votes.
- Facilitator votes off: facilitator has no cards, excluded from counter and auto-reveal (SI-18).
- Facilitator switches to observer and auto-reveal on; only observer + one voter.
- Room with only observers: reveal shows "no votes"; auto-reveal never fires.
- Reload during each state (voting, revealed, deck dialog open, name prompt).
- Browser back/forward between start page and room; opening room link while on the start page.
- Same participant identity in two tabs (SI-13): vote in tab A reflected in tab B; closing A keeps online.
- Clearing storage, then opening the link: new participant, old one remains (offline) until purged.
- Two rooms open in one browser: identity and votes do not cross rooms (same-origin storage keys).
- Returning purged participant (> 10 min offline) when room is full.
- 3 consecutive rounds (reveal, reset, reveal): no state bleeding (distribution, highlights, topic).
- Window resize between desktop and mobile layout mid-round; participant panel collapse state does not reset the vote.

### 3.5 Presence
- Page close, tab crash (`page.close({runBeforeUnload:false})`), `setOffline`, server closes connection, DO eviction: all show offline for others within the documented time.
- Browser sleep/wake equivalent: offline for longer than heartbeat timeout, then online.
- Facilitator offline and purge interplay (SI-11).

### 3.6 Copy link and UI notes
- Copy button: visible "Copied" state and screen-reader announcement; clipboard failure path (permission denied) shows the URL for manual copy.
- `prefers-reduced-motion: reduce` (`page.emulateMedia`): reveal has no flip animation, values still visible; default motion: animation runs but content is readable at end. Test asserts computed `animation-name`/duration is none under reduced motion (needs hook R-F7).
- Mobile: card grid below topic, participant list collapsed by default, expandable via button, no horizontal scroll at 320 and 390 px.

## 4. Cross-cutting checks

### 4.1 Hidden-vote frame inspection (F01-AC11)
- Fixture attaches a recorder on every context before navigation (`context.on("page", p => p.on("websocket", ws => ws.on("framereceived"/"framesent")))`), storing parsed frames per participant.
- Uses a custom deck of unique 4-char tokens so that raw text search is reliable, then strips the deck definition and the client's own `myVote` field before searching.
- Asserts on: all frames received by each non-owner client in `voting` state, including join snapshot, reconnect resync, late join, reload, vote change, withdrawal, observer switch, deck change, handover; plus HTTP responses of any room endpoint.
- After reveal, tokens present exactly as in the revealed payload; after reset, absent again.
- Runs on Chromium, Firefox and WebKit. Requires: the web app opens the socket from the page (not a worker or service worker, which Playwright's `page.on("websocket")` does not see). If the app moves the socket to a worker, tell QA.
- Server side (backend test, spec-mandated) covers the same, and additionally that logs contain no vote values.

### 4.2 Reconnects and offline
- `context.setOffline(true/false)` for the voter, for the facilitator, and for all contexts at once.
- Asserts: indicator visible and non-blocking, others see offline, vote survives, full state resync (changes made by others during the outage appear), no duplicate participant entry after reconnect, no unbounded retry storm (count reconnection attempts per time window against documented backoff, SI-24).
- Limit: `setOffline` does not close the WebSocket; the server notices only through its timeout. The plan therefore also uses `page.close()` and server-side close for immediate offline, and the test-mode heartbeat timeout (R-B2) for silent drops.

### 4.3 Accessibility
- axe-core (`@axe-core/playwright`, tags wcag2a, wcag2aa, wcag21aa, wcag22aa) on every screen and state: start page, name prompt, room (voting, voted, revealed with summary, observer view, facilitator view), settings dialog, deck-change confirmation, removed notice, room not found, room full, reconnecting state. Fail on serious or critical. Run on desktop and mobile viewport.
- Keyboard-only pass (no mouse): create room via Tab/Enter, copy link, join via second context, select card with arrow keys/Space/Enter, withdraw, reveal, reset, open settings, change deck and confirm the dialog, switch to observer. Assert visible focus indicator (WCAG 2.4.7, 2.4.11), logical tab order, focus trap and return in dialogs, no keyboard traps, card group semantics (radiogroup or buttons with `aria-pressed`).
- Screen reader: live region announces reveal ("Votes revealed", summary) exactly once, announces copy feedback, announces reconnecting/reconnected politely. Cards have accessible names for `½` ("one half") and `☕` ("coffee break"), `?`. Asserted via accessible-name locators (`getByRole("radio", {name})`) and live region content.
- Color not the only signal: voted indicator, selected card, offline, lowest/highest, consensus all have text or icon with accessible name. Check with emulated `forced-colors` and grayscale screenshot comparison is manual.
- Reflow at 320 px, 400% zoom (manual check), target size >= 24 px for cards and buttons (WCAG 2.5.8, asserted via bounding boxes).
- Manual: one pass with VoiceOver (Safari) for reveal announcement.

### 4.4 Browsers and devices
- Projects: `chromium`, `firefox`, `webkit` (Desktop), plus `mobile` = iPhone 14 emulation on WebKit (Safari iOS is in the NFR). Optionally `Pixel 7` on Chromium as a second mobile check (nightly only).
- Full suite on chromium; core flow (AC1, 4, 5, 9, 10, 11, 14, 15, 18, 19, 29), a11y, and AC11 frame inspection on all four projects; heavy multi-context race tests on chromium only (documented gap, reason: runtime).
- Edge and real iOS devices are not covered by Playwright; declared manual/deferred (smoke on real devices before release).
- Clipboard assertions are Chromium-only (Firefox/WebKit lack `clipboard-read` permission in Playwright).

### 4.5 ADR 0001 (transport) checks
- Backend review/grep (QA, manual at report time): room code uses `ctx.acceptWebSocket()`, handlers `webSocketMessage`/`webSocketClose`, never `ws.accept()`; per-connection data in `serializeAttachment()`; room state in DO storage.
- `packages/shared` message types contain no WebSocket-specific fields and are schema validated on both sides (backend test with invalid payloads).
- Client resyncs by full state on reconnect, not replay: asserted by AC29 tests where changes during outage are visible after reconnect.
- Idle rooms hibernate: AC30 and R-B3.

### 4.6 ADR 0002 (EU jurisdiction)
- Backend test (required by ADR): every stub obtained through the room helper has `id.jurisdiction === "eu"`; a stub for the same name obtained via the unrestricted namespace has a different ID (documents why mixing is wrong). Test is on the single helper; it also exercises the real create-room and join/WebSocket paths so no route bypasses the helper.
- Static check by QA in review (manual, repeatable grep, added to the report): no call to `.idFromName(`, `.newUniqueId(`, `.get(` on `env.ROOM` outside the helper module.
- Integration: a room created through the API is reachable on a later request (guards against the silent empty-room problem when jurisdiction is mixed).
- Logs: backend test captures `console` output during create/join/vote/remove and asserts no display name, topic, room name, or vote value appears (only IDs). QA also greps for `console.` calls that interpolate names.
- Local limitation: `wrangler dev` may not enforce or expose jurisdiction; e2e cannot verify it. Verification of production placement is manual/deferred (staging check by DevOps, outside this plan).
- No KV or D1 use in F01 for personal data: review `wrangler.jsonc` bindings.

### 4.7 Non-functional
- Latency (NFR 500 ms p95): non-gating perf test; 100 votes/reveals between two contexts, in-page timestamps, report p95. Local numbers are indicative only; real verification is deferred to staging.
- Room size 50: backend + raw clients; e2e one real browser in a room of 49 raw clients; check UI list of 50 remains usable (scroll, perf) at mobile viewport.
- Rate limits: SI-27.
- i18n: manual review that UI strings are externalized (no hard-coded strings in templates), with a spot check of a pseudo-locale if frontend provides one.

## 5. Test data, fixtures, helpers and requests to dev agents

### 5.1 QA-owned (in `e2e/`, to be written after bootstrap)
- `fixtures/room.ts`: `createRoomViaUi(page, opts)` (used by AC1-3 tests only) and
  `createRoom(opts)` via the HTTP API (fast path for everything else), returning `{roomId, url}`.
- `fixtures/participants.ts`: `joinAs(browser, url, {name, role})` returns `{context, page, name}`;
  `makeRoom(n, {roles, settings})` returns the facilitator plus n-1 participants, all with the recorder attached; auto-closes contexts.
- `helpers/ws-recorder.ts`: frame recorder per context (4.1) and `expectNoVoteLeak()`.
- `helpers/raw-client.ts`: raw WS client using `packages/shared` types (join, vote, reveal, send arbitrary payload), used for 50-participant, race and malformed-message tests.
- `helpers/a11y.ts`: axe wrapper that fails on serious/critical and attaches report.
- `helpers/net.ts`: `goOffline(ctx)` / `goOnline(ctx)`, wait for indicator.
- `helpers/summary.ts`: expected average/median calculator (independent from app code) for table tests.
- Config: projects chromium/firefox/webkit/mobile; `webServer` entries for `wrangler dev` and `ng serve` (ports from DevOps); `workers` > 1; `retries: 0`; trace on failure; test mode env var passed to wrangler.

### 5.2 Requests to backend-dev (apps/api, packages/shared)
- R-B1: Define the contract in `packages/shared` first and include: message and error code
  catalog with stable machine-readable `code` strings (`not_allowed`, `room_full`, `room_not_found`,
  `round_revealed`, `invalid_card`, `invalid_name`, `confirmation_required`, `rate_limited`, ...), a monotonically increasing `version` on every state message (lets tests wait on state without sleeps), and which messages may carry votes (only the revealed round payload and the owner's own `myVote`).
- R-B2: A test mode (e.g. `ENVIRONMENT=test` var in wrangler dev config, absent in staging and production) that lets timers be overridden: offline-purge (default 10 min), facilitator-claim threshold (default 5 min), heartbeat/offline-detection timeout (default per SI-10). Production must not honor the overrides; QA will assert that config at report time.
- R-B3: A test-only way to force eviction of a room Durable Object and to see that it was re-instantiated: e.g. `POST /__test/rooms/:id/evict` and `GET /__test/rooms/:id/instance` returning a per-instance id set in the constructor. Ideally two modes: abort (sockets closed, tests AC29 resume) and hibernate-with-open-sockets (the Hibernation path, if feasible locally; otherwise document how AC30 is exercised, SI-25). Endpoint must return 404 outside test mode.
- R-B4: Documented HTTP endpoint to create a room (`POST /api/rooms` with the same settings as the UI) returning `roomId` and a participant token, so fixtures skip the UI; plus a lightweight room-exists check used for AC6.
- R-B5: Make the 50 cap, name/topic/room-name/card limits constants exported from `packages/shared` so tests import them rather than duplicating numbers.
- R-B6: Backend tests that QA will review for coverage (list): AC2 entropy/format, AC7 cap, AC11 outgoing-message inspection (including resync and HTTP), AC13/18/23/24/25/27 authorization, AC21-22 timers, AC30 eviction, ADR 0002 jurisdiction, ADR 0002 logs, schema validation of malformed input, rate limiting, race tests X-RACE-2/3/4/9.
- R-B7: Structured logs with IDs only (roomId, participantId); no names or vote values (ADR 0002).

### 5.3 Requests to frontend-dev (apps/web)
- R-F1: Stable `data-testid`s (in addition to roles and labels), at least:
  start page `start-name`, `start-room-name`, `start-deck`, `start-custom-deck`, `start-control-mode`, `start-create`;
  room `room-url`, `copy-link`, `copy-feedback`, `topic-display`, `topic-input`, `topic-save`;
  join `join-name`, `join-role-voter`, `join-role-observer`, `join-submit`;
  cards `card-grid`, `card-<slug>` (slug for `?` = `question`, `☕` = `coffee`, `½` = `half`) with `aria-checked`/`aria-pressed` for selection and `aria-disabled` after reveal;
  participants `participant-list`, `participant-row` with `data-participant-id`, `data-role`, `data-online`, `data-voted`, `data-you`, and inner `participant-name`, `participant-vote`;
  counter `voted-count` (text "x of y");
  controls `reveal`, `reset`, `settings-open`, `role-switch`, `handover-<participantId>` or per-row action menu, `remove-<participantId>`, `claim-facilitator`;
  settings `setting-room-name`, `setting-deck`, `setting-control-mode`, `setting-auto-reveal`, `setting-facilitator-votes`, `deck-confirm`, `deck-confirm-ok`, `deck-confirm-cancel`;
  summary `summary`, `summary-average`, `summary-median`, `summary-consensus`, `summary-no-votes`, `summary-distribution-<slug>`, and `data-extreme="lowest|highest"` on participant rows;
  pages `room-not-found`, `room-not-found-create`, `room-full`, `removed-notice`, `removed-rejoin`;
  `connection-indicator` with `data-state="connected|reconnecting"`; `reveal-announcer` (the live region).
- R-F2: Expose room state version in the DOM (`data-state-version` on the room root) so tests wait for state, not time.
- R-F3: Open the WebSocket from the main page context (not a worker) so Playwright can observe frames. If the transport uses a connection abstraction (ADR 0001), keep it on the main thread.
- R-F4: Test-mode override of reconnect backoff base/max (query param or injected config), so reconnect tests are fast; default backoff documented (SI-24).
- R-F5: Non-color cues for every state (4.3) and `aria-live` regions for reveal, copy, connection status.
- R-F6: Server-rendered or client-rendered titles: `<title>` includes room name for orientation (affects XSS and a11y checks).
- R-F7: A way to detect the flip animation: class or `data-animated="true|false"` on the revealed cards, honoring `prefers-reduced-motion`.
- R-F8: Unit tests QA will review: summary computation (AC15), name suffix logic (AC8), backoff (AC29), validation (AC4, AC20), role-based control visibility (AC13).

### 5.4 Requests to devops-engineer (via orchestrator)
- R-D1: `pnpm --filter e2e test` brings up `wrangler dev` (with test-mode vars) and `ng serve` via Playwright `webServer`, ports fixed; state persisted in a temp dir per run.
- R-D2: Install Playwright browsers (chromium, firefox, webkit) in CI image; confirm WebKit runs on the CI runner.
- R-D3: Ensure the Durable Object binding is declared with the migration for the Room class (SQLite or KV backed, decided by backend-dev) and that test-mode vars exist only in the local/test environment, not staging/production.

## 6. Spec issues

Severity: **B** = blocks writing a correct test or implementation (resolve before implementation);
**M** = ambiguity likely to cause rework; **m** = minor/clarification.

**SI-01 (B) AC11 contradicts AC9 / AC29.**
Quote AC11: "The server never sends vote values to any client before reveal." AC9: "my card is
highlighted for me" and AC29: "my vote in the current round is preserved ... On reconnect it
receives the full room state." After a reload or reconnect the server must send the voter their own
card, otherwise the highlight cannot be restored. Taken literally, AC11 forbids this.
Also "backend test that inspects all outgoing messages" excludes HTTP responses and logs.
Proposed: "Before reveal, the server sends a vote value only to the participant who cast it
(as that participant's own current vote, including on reconnect). No other client receives
it in any message, HTTP response, or log line. Verified by a backend test that inspects all outgoing
messages to every connection during a `voting` round, including resync and join snapshots, and by an
e2e frame inspection."

**SI-02 (B) AC15: "numeric decks" undefined.**
Quote: "for numeric decks: average (1 decimal) and median, excluding `?` and `☕`". Fibonacci contains
`½`; T-shirt is non-numeric; a Custom deck can be mixed ("S", "3", "12"). Not stated whether the
average is shown on mixed decks or how `½` and non-ASCII values are parsed.
Proposed: "Each deck card has a numeric value or none. Fibonacci, Modified Fibonacci and Powers of 2
are numeric (`½` = 0.5); T-shirt is not numeric. A Custom deck is numeric only if every card other
than `?` and `☕` parses as a decimal number (`.` separator, no exponent). Average and median are shown
only for numeric decks and are computed over numeric votes only. If no numeric votes exist, they
are omitted."

**SI-03 (B) AC15: rounding and median rules.**
"average (1 decimal) and median": rounding mode unspecified (2.25: 2.3 or 2.2?), median of an even
number of votes unspecified (3 and 5 = 4; 2 and 3 = 2.5), median display precision unspecified,
and `½` display ("0.5" or "½").
Proposed: "Average is rounded half away from zero to one decimal, always shown with one decimal
(e.g. `5.0`). Median of an even count is the mean of the two middle values, shown with up to one
decimal (`2.5`, `4`). Halves are shown as decimals in the summary."

**SI-04 (M) AC15: consensus edge cases.**
Quote: "a 'consensus' badge when all numeric votes are equal". Undefined for: a single numeric vote,
mix of equal numbers and `?`/`☕`, all `?`, and non-numeric decks (T-shirt consensus is the most
natural use). Also ties up with AC17 (zero votes).
Proposed: "Consensus is shown when there are at least 2 votes with a deck value (excluding `?`
and `☕`) and all of them are the same card, on any deck. `?` and `☕` votes do not break
consensus but are listed in the distribution. Never shown with zero or one such votes."

**SI-05 (M) AC15: lowest/highest voters.**
Quote: "the lowest and highest voters highlighted when they differ". Undefined: ties (all voters
holding the min), non-numeric decks (order by deck position?), treatment of `?`/`☕`, and
that colour is not the sole indicator (NFR).
Proposed: "Among voters with a non-special card, rank by deck position. If lowest and highest
differ, every voter holding the lowest card and every voter holding the highest card is marked
with a text label (Lowest/Highest) and a visual highlight. `?` and `☕` voters are never marked."

**SI-06 (B) AC16 / AC22: "all voted" definition and triggers.**
AC16: "when the last voter votes, then the round reveals". AC22: "'all voted' counts online voters
only". Undefined: (a) does reveal also fire when the last non-voting voter goes offline, is removed,
or switches to observer (AC22 "don't block" implies yes, AC16 literally says no); (b) turning
auto-reveal on when everyone has already voted; (c) withdrawal after reveal; (d) minimum of one vote
(zero online voters or only observers must not reveal an empty round); (e) a flaky connection of
a not-yet-voted voter would reveal everyone's votes prematurely, which is a product risk (grace period?);
(f) facilitator-votes off.
Proposed: "In `voting` state with auto-reveal on, the round reveals as soon as: at least one online
voter exists and every online voter (a participant with role voter, excluding the facilitator when
facilitator-votes is off) holds a vote. This is re-evaluated on every vote, withdrawal, disconnect, removal,
role switch, join and settings change. Disconnects count only after the offline-detection timeout
(SI-10)." Product owner decides on (e).

**SI-07 (M) AC12 vs AC22: meaning of "x of y voted".**
AC12: "not counted in 'x of y voted'". Is y all voters, or only online voters (AC22)? Is an
offline voter who voted counted in x? Is the facilitator counted when facilitator-votes is off?
Proposed: "x = voters (any presence) with a vote in the current round; y = voters currently online
plus offline voters who have a vote. Observers, and the facilitator when facilitator-votes is off, are
excluded from both." (Or any consistent rule; auto-reveal then uses y online-only.)

**SI-08 (B) AC18 vs AC26 (and AC23, AC27): changes to a revealed round.**
AC18: "After reveal, votes can't be changed." AC26: "Switching to observer withdraws a vote in the
current round." Which wins after reveal? Same for removing a participant (AC23) who has a revealed vote,
and turning facilitator-votes off, and an offline voter's purge.
Proposed: "After reveal, no action changes the revealed votes or the summary: role switches,
removals and setting changes take effect for the next round only; a removed participant's revealed
vote stays visible until reset (shown under their name with a 'left' marker). Withdrawal on
role switch applies in `voting` state only."

**SI-09 (B) Who may do what in "everyone" mode, and observers.**
AC13: "Given 'everyone', all voters see them." Overview: observers "See everything, never votes";
the overview says voters reveal/reset only in "everyone" mode. Unclear whether observers get
reveal/reset, and whether the facilitator's role in AC19 ("so the facilitator can edit it"), AC20
("The facilitator can set an optional topic") and user story 5 ("optionally set a new topic") extends to
other participants in everyone mode. AC27 says only the facilitator changes settings, but not
explicitly that this holds in everyone mode.
Proposed: "In everyone mode every participant with role voter or facilitator may reveal and reset;
observers may not. Topic and settings can be changed only by the facilitator in both modes. Reset
takes an optional new topic (one action)."

**SI-10 (B) AC21: "immediately" is untestable and not guaranteed.**
Quote: "Participants who disconnect show as offline immediately." A dropped network (Wi-Fi off, laptop
sleep, `setOffline`) sends no close frame; the server only learns through a ping/timeout. No
heartbeat or timeout is specified.
Proposed: "A clean close marks the participant offline within 1 s. Without a close frame, the server
detects loss via a heartbeat and marks the participant offline within 30 s (configurable, default
stated here)." Also specify how reconnecting within that window is handled (no flicker).

**SI-11 (B) AC21: purge timing, facilitator, and interplay with AC25 and AC7.**
Quote: "removed from the list after 10 minutes offline, unless they have a vote in the current
round." Undefined: (a) what happens to a retained voter at reset (purged immediately if >10 min offline, or
10 minutes restart?); (b) the facilitator: after 10 minutes offline, AC25 allows claiming but AC21 would purge the
facilitator (who may not have voted, or has facilitator-votes off), leaving no facilitator; (c) an
offline observer; (d) "10 minutes" is not testable in e2e.
Proposed: "Offline time is measured from the last disconnect. A participant is purged at
`max(10 min after disconnect, next reset)` if they hold no vote in the current round,
or at the next reset if they hold one and 10 min have passed. The current facilitator is never purged;
the role moves only by AC24/AC25. Durations are configurable in test mode (R-B2)."

**SI-12 (M) AC7: what counts toward 50.**
Quote: "Given a room with 50 participants". Overview adds "observers included". Not stated whether
offline-but-retained participants count (they hold a slot up to 10+ min), nor the check order
(before or after the name form), nor whether a returning participant (AC5) is admitted when full.
Proposed: "The cap of 50 counts every participant in the list (online or offline, voter or observer). A
returning participant already in the list is always admitted. The 'room is full' check happens when the
link is opened, before asking for a name."

**SI-13 (M) AC5: identity scope and edge states.**
Quote: "joined before from this browser ... rejoin as the same participant". Undefined: token scope
(per room or per browser), two tabs with the same token (one participant, two connections: when is
it offline?), return after being purged (AC21) or removed (AC23), and a changed name.
Proposed: "The browser stores one token per room. Tabs sharing the token are one participant who is online
while at least one connection is open. If the participant was purged, returning is a fresh join
(name prompt, subject to the cap). Name and role can be changed after joining" (or state that they can't).

**SI-14 (B) AC23: removed participants and AC5/AC29 auto-rejoin.**
Quote: "The removed participant sees 'you were removed from the room' and can rejoin via the link."
With AC5 (stored token rejoins silently) and AC29 (client reconnects) the removed client either
rejoins at once or loops. What is "rejoin": new participant, same identity? Is the removed participant's
vote deleted? Is there a cool-off (rate limit vs abuse)?
Proposed: "Removal deletes the participant's token and their vote (pre-reveal; see SI-08 after reveal). The
removed client shows the notice and does not auto-reconnect. Opening the link again (or pressing 'Rejoin') starts a fresh join with the name prompt."

**SI-15 (M) AC24: handover details.**
Quote: "hand the role to another online participant ... The old facilitator becomes a voter." Undefined:
can the target be an observer (then becomes facilitator and observer? facilitator-votes?), what if the old
facilitator was an observer (forced into voter?), how facilitator-votes applies to the new facilitator,
what happens to a vote the old facilitator already cast, and the race where the target goes offline
or switches role.
Proposed: "The target may be any online participant; each keeps their own voter/observer role. The old
facilitator keeps their voter/observer role (no forced change). Handover is atomic: if the target is not online when
processed, it is rejected with `target_offline`. Existing votes stay."

**SI-16 (M) AC25: claim rules and testability.**
Quote: "If the facilitator is offline for more than 5 minutes, any online participant can claim the
facilitator role." Undefined: who measures (client clocks drift: server should say `canClaimAt`), may observers
claim, what happens to the returning facilitator (voter, as in AC24?), the simultaneous claim winner,
multiple facilitator tabs, and "offline for 5 minutes" if facilitator-offline lasts through
a purge (SI-11). Also 5 minutes is not testable without a test-mode override.
Proposed: "Server-side rule, threshold configurable in test mode. Any online participant including observers may
claim; first claim wins, later ones get `already_claimed`. The previous facilitator becomes a voter on return."

**SI-17 (M) Free-text limits: unit and normalization.**
AC4 "(1–30 chars)", AC20 "max 200 chars", overview "max 80 chars", "each max 4 characters". Not stated:
counting unit (UTF-16 code units vs code points vs graphemes: 4-char custom card "👨‍👩‍👧‍👦" or "½☕12"), trimming,
whitespace-only names, newlines/control characters, Unicode normalization. Names are also required for creating
a room (AC1) but the 1-30 limit is only in AC4. Counting must match between server and client.
Proposed: "All lengths count Unicode grapheme clusters after trimming leading/trailing whitespace; internal whitespace is
collapsed to single spaces; control characters and newlines are rejected for names, room names and cards, topics may contain no newlines;
an empty result after trimming is invalid for names and valid (cleared) for topics. Same rules for create and join."

**SI-18 (M) AC1/AC27: creation inputs, custom deck rules, facilitator-votes.**
AC1 lists only "name, optional room name, deck, control mode" but the overview says auto-reveal and
facilitator votes are chosen at creation too. There is no AC for the Custom deck input: duplicates, empty cards,
`?`/`☕` typed manually, whether "up to 20" includes the two automatic cards, minimum count. There is no AC on what
"Facilitator votes: off" does (no cards, excluded from counters, vote withdrawal if toggled mid-round).
Proposed: add criteria: "Custom deck: 1-20 unique cards (case-insensitive), each 1-4 graphemes; `?` and `☕` are
appended and cannot be entered; duplicates are rejected with an inline error. Facilitator votes off: the facilitator sees
no cards, is excluded from x/y and auto-reveal, and a vote already cast is withdrawn in `voting` state."

**SI-19 (m) AC2: "unguessable (>= 80 bits)" not directly testable; format unspecified.**
Proposed: "roomId is 16 characters of Crockford base32 (80 bits) from a CSPRNG, e.g. `/r/7k3m9q2x4h8d5tnw`
(overview/ADR 0002 mention 'short random slugs'). Backend test asserts the generator's length, alphabet and use of
`crypto.getRandomValues`." Also state URL case sensitivity.

**SI-20 (M) AC6: "does not exist or has expired".**
Expiry is F03, so it can't be tested in F01. Also, with `idFromName` every name maps to a Durable Object,
so "does not exist" requires the DO to track whether it was ever created and not create state on
read. Distinguish malformed IDs from valid-but-unknown IDs, and say whether the result is HTTP 404 and what a WebSocket upgrade returns.
Proposed: "F01 covers non-existent rooms only; expired rooms are an F03 criterion. A room exists only after an
explicit create request. Opening or connecting to an unknown or malformed ID shows 'room not found' and creates nothing
(no DO storage written)."

**SI-21 (M) AC8: disambiguation scheme.**
Quote: "e.g. 'Alex (2)'". Undefined: who gets the suffix, whether numbers are stable when the first Alex leaves, case-insensitive
matching, and where it appears (list, votes, highlights, announcements).
Proposed: "Suffix is assigned by the server by join order among current list members with the same
case-insensitive trimmed name; the first keeps the plain name; a participant's suffix does not change while they stay in the list;
a purged participant's number may be reused. Shown everywhere the name appears, and in accessible names."

**SI-22 (M) AC14: "at the same moment" cannot be asserted.**
Proposed: "The reveal is a single state change broadcast to all connections; each online client displays the votes
within 500 ms (p95) of each other and of the reveal (NFR). The animation does not delay screen-reader availability."
E2E asserts a fixed bound (e.g. 2 s locally) and identical content; the 500 ms p95 is a perf measurement.

**SI-23 (M) AC28: confirmation protocol and scope.**
Quote: "asks for confirmation and resets the round". Undefined: does it apply to a revealed round (votes exist, results lost),
what others see while the dialog is open, and the race where the dialog was shown with zero votes but votes arrive before submission
(or vice versa). A client-side-only confirmation can be bypassed.
Proposed: "A deck change request carries `confirmReset: boolean`. If votes exist (voting or revealed state) and `confirmReset` is false the server
rejects with `confirmation_required`; with true it resets the round and applies the deck. The client shows the dialog when
votes exist and re-sends if the server answers `confirmation_required`. Selecting the current deck is not a change."

**SI-24 (B) AC29: reconnect behavior under-specified.**
Quote: "The client retries with backoff" (no parameters); "non-blocking 'reconnecting...' indicator" (when does it appear: immediately or after a
delay?); "my vote ... is preserved". Gaps: a vote sent while offline (selected locally, never delivered): is it queued,
rejected, or the card disabled while offline? When does the highlighted card reflect the server rather than local intent?
What after N failed attempts (give up state)? Reconnect after the participant was purged/removed/room gone.
Proposed: "Cards show as selected only after server acknowledgement; while disconnected cards are disabled (with the
indicator) and no vote is queued. Backoff: 0.5 s start, x2, max 15 s, +/-20% jitter, retried forever; indicator shows
after 1 s of disconnect and hides after resync. If the server reports removed/not found on reconnect, show the AC23/AC6 screen. The
indicator is a polite live region."

**SI-25 (B) AC30: neither "idle" nor the verification is well-defined or feasible as worded.**
Quote: "An idle room (no messages) hibernates ... Verified by a backend test that evicts the Durable Object and reconnects."
(a) Idle duration is platform-defined; the spec gives no threshold. (b) Evicting the DO (e.g., `abort()`) closes sockets and so
tests recovery (AC29), not the Hibernation API path where sockets stay open and in-memory state is dropped (ADR 0001:
`serializeAttachment`, state in storage). A test that only evicts and reconnects may pass with code that would break
on real hibernation. It also isn't clear that Miniflare/vitest-pool-workers can force that path.
Proposed: "After >= 10 s without messages the room may be evicted from memory. A message
sent on an existing connection after eviction is processed with all room state (settings, topic, round state,
votes, participants, roles, presence of connected sockets restored from attachments) intact. Verified by (1) a backend
test that discards in-memory state while keeping sockets open, or documents why this can't be done, plus
(2) an e2e/wrangler-dev smoke test using the test hook R-B3."

**SI-26 (M) AC19 / AC20 / user story 5: reset semantics.**
AC19: "the topic field is kept so the facilitator can edit it." Is the old topic still shown to everyone until the facilitator edits? Can reset happen in
`voting` state (before reveal) and does it need confirmation? Does "optionally set a new topic" happen in the same action as reset? When can the
topic be changed (any state)? Offline voters' retained votes cleared?
Proposed: "Reset is available in both states (confirmation only when votes would be lost, optional). It clears all votes (including those of offline
participants) and keeps the current topic visible to everyone until the facilitator saves a new one. Reset takes an optional topic and applies both atomically.
Topic can be edited in any state."

**SI-27 (M) NFRs referenced by F01 lack testable numbers.**
"Rate limits on room creation, joins, and messages per connection" has no thresholds or response behavior, so QA can't
test or report a defect. "within 500 ms (p95) under normal network conditions" lacks a definition of normal
conditions and a measuring point. "last two versions of Chrome, Edge, Firefox, Safari (macOS and iOS)": Edge and real
iOS can't be run by Playwright.
Proposed: state limits (e.g. 5 room creations / minute / IP, 30 joins / minute / IP, 20 messages / 10 s / connection)
and the response (`rate_limited`, connection stays open). Define normal as <= 100 ms RTT, measured server-receive to client-render
in a staging environment. Accept Chromium/Firefox/WebKit + iPhone emulation as proxies, with manual real-device smoke.

**SI-28 (m) AC9/AC10/AC17 small gaps.**
AC10 "click my card again" has no keyboard equivalent stated (NFR needs keyboard operability); AC17 does not say whether revealing an already revealed round
is a no-op; AC9 does not say whether the voter's own "voted" indicator appears in the list.
Proposed: "Pressing the selected card by pointer or Space/Enter withdraws the vote. Reveal in `revealed` state is a no-op. The voter sees their own
indicator in the list."

**SI-29 (m) ADR rules with no acceptance criteria.**
ADR 0002 requires a backend test of `id.jurisdiction === "eu"` and no personal data in logs; ADR 0001 requires hibernation API use and full resync.
They are not criteria in F01, so they will not appear in the traceability table or the sign-off.
Proposed: add F01-AC31 ("Room Durable Objects are created in the EU jurisdiction via a single helper, verified by a backend test asserting `id.jurisdiction === "eu"`")
and F01-AC32 ("Logs contain IDs only; no names, topics, or votes"), and an AC33 for accessibility (axe, keyboard, reveal announcement) taken from the NFR,
since UI notes mention it (copy feedback, reduced motion) without IDs.

Summary: 29 spec issues (11 blocking: SI-01, 06, 08, 09, 10, 11, 14, 24, 25, plus SI-02 and SI-03 for AC15; the rest major/minor).

## 7. Out of scope and deferred
- Story list, export/expiry, accounts (F02-F04); room expiry for AC6 (F03).
- Real-device iOS/Edge testing, production jurisdiction placement, p95 latency on real network: manual/deferred.
- Load beyond 50 participants per room.

## 8. Entry/exit criteria
- Entry for e2e writing: SI blockers resolved, `packages/shared` contract published, R-B1..R-F2 delivered.
- Exit (sign-off): every AC has a passing test or an explicit manual/deferred mark with reason; no open critical or major defects; axe clean (no serious/critical); the test suite
  passes three consecutive full runs without retries (flake check); backend tests for AC2, 7, 11, 21-25, 30, ADR 0002 exist and pass.
