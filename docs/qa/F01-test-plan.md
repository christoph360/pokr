# F01 test plan: Rooms and voting

- Spec: `docs/specs/01-rooms-and-voting.md` (rev 2), `docs/specs/00-product-overview.md`
- ADRs: 0001 (WebSockets + Hibernation), 0002 (EU jurisdiction)
- Author: qa-engineer
- Status: v2 (spec rev 2). All 29 spec issues (section 6) are resolved; rows marked
  "(pending SI-nn)" are settled by the rev 2 wording summarised in section 2a. E2E tests are
  written (`e2e/tests`); the traceability table in the report maps AC to test names.

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

## 2. Coverage table (F01-AC1 to F01-AC30, original rows)

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

## 2a. Rev 2 changes to the coverage table

Settled by the rev 2 spec (the original rows above remain valid with these decisions applied):

| AC | Rev 2 decision | Test approach |
| --- | --- | --- |
| AC1 | Start page also takes auto-reveal and facilitator votes; custom deck per AC34 | e2e `create-join.spec.ts` |
| AC2 | 16 lowercase Crockford base32, `crypto.getRandomValues`, case-insensitive lookup | e2e (format, case) + backend (source of randomness) |
| AC3 | Room name 1-80, empty falls back to "Planning session" | e2e + raw API |
| AC4/AC5 | Grapheme counting, whitespace-only invalid; tabs share one participant; purged/removed means fresh join | e2e + raw (`protocol.spec.ts`) |
| AC6 | HTTP 404, WS upgrade refused, no storage written | e2e + raw; "no storage" = backend test |
| AC7 | Cap counts offline too; returning token always admitted; "room is full" before name prompt | raw (50 clients) + e2e |
| AC8 | Join-order suffix, case-insensitive, stable | e2e |
| AC9/AC10 | Highlight only after server ack; Space/Enter withdraw | e2e |
| AC11 | Own vote allowed (`myVote`); frame inspection excludes `settings.deck` and own `myVote` | e2e frames + backend |
| AC12 | x/y definition fixed | e2e |
| AC13 | Observers never reveal/reset; topic/settings facilitator only | e2e + raw |
| AC14 | 2 s e2e bound | e2e |
| AC15 | Rounding, median, consensus, extremes (all holders) as specified | e2e table with independent oracle |
| AC16/AC22 | Predicate re-evaluated on every event incl. disconnect, removal, role switch, setting change | raw + e2e |
| AC17/AC18 | No-op second reveal; nothing changes after reveal; `left` marker | raw + e2e |
| AC19 | Reset in both phases; confirmation only when unrevealed votes would be lost; optional atomic topic | e2e + raw |
| AC20 | Topic any state, no newlines | e2e + raw |
| AC21 | 1 s clean close, 30 s silent, purge rules, facilitator never purged, test-mode timers | e2e + raw |
| AC23/AC24/AC25 | Removal, `target_offline`, claim with `already_claimed`, former facilitator becomes voter | e2e + raw |
| AC27/AC28 | `confirmReset`, `confirmation_required`, same deck is not a change | e2e + raw |
| AC29 | Indicator after 1 s, cards disabled while disconnected, backoff 0.5 s x2 max 15 s +/-20 % (test config shortens) | e2e (route-layer network control) |
| AC30 | `drop_memory` and `abort` hooks | e2e + raw; backend test |
| AC31 | Single EU helper, backend unit test with fake namespace. Not observable locally (workerd has no jurisdiction): e2e part deferred to staging | backend + manual/deferred |
| AC32 | IDs only in logs | backend test (review); e2e not applicable |
| AC33 | axe, keyboard-only, live regions, non-colour cues, reduced motion | e2e `a11y.spec.ts`; screen reader pass manual |
| AC34 | Custom deck 1-20 unique cards of 1-4 graphemes; specials appended | e2e + raw |
| AC35 | Facilitator votes off | e2e + raw |
| AC36 | Rename with AC4/AC8 rules | raw (UI has `rename-*` ids; UI test is a gap, see report) |
| AC37 | 5 creates/min per IP, joins limit (now 120 WebSocket upgrades/min per IP, from `RATE_LIMITS`; info requests are not limited), 20 msgs/10 s, connection stays open | raw API with a dedicated client key per test |

### Implementation notes (e2e)
- Servers: Playwright `webServer` starts `wrangler dev --var POKR_TEST_MODE:1` (via the api `dev`
  script) and `ng serve`. `global-setup.ts` fails fast when the API is not in test mode.
  `E2E_API_PORT`/`E2E_WEB_PORT` override ports to avoid stale servers.
- Rate limits: every context and raw client uses its own `x-pokr-test-client-key`.
- Network loss: `NetControl` (route layer) closes or black-holes the page WebSocket; frames are
  recorded at the same layer for those contexts. Other contexts record with `page.on("websocket")`.
- Tags: `@cross-browser` (also firefox/webkit/mobile-chrome), `@chromium-only` (races, heavy and
  API-only specs).

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

**Resolved.** All 29 issues (SI-01 to SI-29) were resolved in spec rev 2 (Definitions section and
AC31-AC37). The original issue text is kept in the git history of this file; the decisions are
summarised in section 2a. New observations while writing the tests are listed in the report.

## 7. Out of scope and deferred
- Story list, export/expiry, accounts (F02-F04); room expiry for AC6 (F03).
- Real-device iOS/Edge testing, production jurisdiction placement, p95 latency on real network: manual/deferred.
- Load beyond 50 participants per room.

## 8. Entry/exit criteria
- Entry for e2e writing: SI blockers resolved, `packages/shared` contract published, R-B1..R-F2 delivered.
- Exit (sign-off): every AC has a passing test or an explicit manual/deferred mark with reason; no open critical or major defects; axe clean (no serious/critical); the test suite
  passes three consecutive full runs without retries (flake check); backend tests for AC2, 7, 11, 21-25, 30, ADR 0002 exist and pass.
